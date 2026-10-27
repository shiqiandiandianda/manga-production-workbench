/**
 * 资产生成工作台 · 入口
 *
 *   node server/main.mjs                 正常启动
 *   node server/main.mjs --check         只做自检并打印结果
 *   node server/main.mjs --port 8890     临时改端口
 *   node server/main.mjs --host 127.0.0.1  只允许本机访问
 */
import path from 'node:path';
import {mkdir, appendFile, stat, readFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {createConfig, createTokenStore} from './config.mjs';
import {createAssetIndex} from './asset-index.mjs';
import {createArchive} from './archive.mjs';
import {createJobManager} from './jobs.mjs';
import {createScriptLibrary} from './script-library.mjs';
import {createSceneEngine, createWorkshopEngine, resolveNodeBinary, resolvePythonBinary, findCodexBinary, ensureCodexHome, createAssistantToken} from './engines.mjs';
import {registerHubRoutes, localAddresses} from './hub-api.mjs';
import {registerLanRoutes} from './lan-api.mjs';
import {registerProjectCenter} from './project-api.mjs';
import {createHubServer, serveStatic, createProxyHandler, createRequestContext} from './web.mjs';
import {paths, files} from './paths.mjs';
import {ensureDir, acquireLock, sleep} from './store.mjs';

const VERSION = '3.0.0';

function parseArgs(argv) {
  const args = {check: false};
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    if (token === '--check') args.check = true;
    else if (token === '--port') args.port = Number(argv[++index]);
    else if (token === '--host') args.host = argv[++index];
    else if (token === '--no-engines') args.noEngines = true;
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const startedAt = Date.now();

/* --------------------------------- 日志 --------------------------------- */

const logFile = path.join(files.logs, 'workbench.log');

async function rotateLog() {
  try {
    const info = await stat(logFile);
    if (info.size > 5 * 1024 * 1024) {
      const {rename} = await import('node:fs/promises');
      await rename(logFile, `${logFile}.1`).catch(() => {});
    }
  } catch {
    /* 文件不存在时无需轮转 */
  }
}

function makeLogger(scope = 'hub') {
  return {
    info: (message, data) => write('info', message, data),
    warn: (message, data) => write('warn', message, data),
    error: (message, data) => write('error', message, data)
  };
  function write(level, message, data) {
    const line = JSON.stringify({time: new Date().toISOString(), level, scope, message, ...(data ? {data} : {})});
    const stream = level === 'error' ? process.stderr : process.stdout;
    stream.write(`[${level}] ${message}${data ? ' ' + JSON.stringify(data) : ''}\n`);
    appendFile(logFile, line + '\n', 'utf8').catch(() => {});
  }
}

/* -------------------------------- 组装服务 -------------------------------- */

async function build() {
  await ensureDir(paths.data);
  await ensureDir(files.logs);
  await rotateLog();

  const logger = makeLogger();
  const config = createConfig();
  const settings = await config.read();
  if (args.port) await config.update({port: args.port});
  if (args.host) await config.update({bindHost: args.host});

  const tokens = createTokenStore();
  await tokens.list();
  const index = createAssetIndex();
  await index.load();
  const archive = createArchive({config, index, logger: makeLogger('archive')});
  const engines = {
    scene: createSceneEngine({config, logger: makeLogger('engine:scene')}),
    workshop: createWorkshopEngine({config, logger: makeLogger('engine:workshop')})
  };
  const jobs = createJobManager({config, archive, scene: engines.scene, workshop: engines.workshop, logger: makeLogger('jobs')});
  await jobs.init();
  // 剧本库：全工作台唯一的剧本来源，导入一次再分发给两个模块
  const scripts = createScriptLibrary({config, logger: makeLogger('scripts')});

  // 本机 AI 助手（Codex）不需要用户配令牌：启动时自动签发一份并写到 data/assistant-token.txt
  const assistant = createAssistantToken({tokens, logger: makeLogger('assistant'), file: files.assistantToken});
  await assistant.rotate().catch(error => makeLogger('assistant').warn('自动签发助手令牌失败', {error: error.message}));

  const context = {config, tokens, index, archive, jobs, scripts, engines, assistant, logger, version: VERSION, requestShutdown: null};

  const sceneDist = path.join(paths.sceneApp, 'dist');
  const archiveEngineUpload=async(request,bytes,route)=>{
    const cookie=/(?:^|;\s*)production-project=([^;]+)/.exec(String(request.headers.cookie||''));
    if(!cookie)throw Object.assign(new Error('请先在项目中心选择项目，再上传资料。'),{status:409});
    const p=decodeURIComponent(cookie[1]),core=context.projectCenter.core;core.get('project',p);
    if(String(request.headers['content-type']).includes('application/json')){
      const input=JSON.parse(bytes.toString('utf8'));let originals=0;
      const scan=value=>{if(!value||typeof value!=='object')return;if(typeof value.data==='string'&&value.filename){core.upload(p,{name:value.filename,mime:/^data:([^;,]+)/.exec(value.data)?.[1]||'application/octet-stream',type:'tool-upload'},Buffer.from(value.data.replace(/^data:[^,]+,/,''),'base64'));originals++;}for(const child of Object.values(value))if(child&&typeof child==='object')scan(child);};scan(input);
      if(!originals)core.upload(p,{name:'import-'+Date.now()+'.json',mime:'application/json',type:'tool-upload'},bytes);
     }else if(String(request.headers['content-type']).includes('multipart/form-data')){
      const requestContext=createRequestContext({headers:request.headers,async *[Symbol.asyncIterator](){yield bytes;}},null,{remoteAddress:'127.0.0.1'});
      const multipart=await requestContext.multipart(128*1024*1024);let count=0;
      for(const part of multipart.parts.filter(part=>part.filename)){core.upload(p,{name:part.filename,mime:part.contentType,type:'tool-upload'},part.data);count++;}
      if(!count)throw Object.assign(Error('上传请求没有原始文件'),{status:400});
    }else core.upload(p,{name:'tool-upload-'+Date.now()+'.bin',mime:request.headers['content-type'],type:'tool-upload'},bytes);
  };
  const workshopPublic = path.join(paths.workshopEngine, 'public');
  const sceneProxy = await createProxyHandler({prefix: '/api/scene', targetPort: s => s.scene.port, config, logger,onUpload:archiveEngineUpload});
  const workshopProxy = await createProxyHandler({prefix: '/api/workshop', targetPort: s => s.workshop.port, config, logger,onUpload:archiveEngineUpload});
  const scenePageProxy = await createProxyHandler({prefix: '/scene', targetPort: s => s.scene.port, config, logger, rewriteHtml: true,onUpload:archiveEngineUpload});  const workshopPageProxy = await createProxyHandler({prefix: '/workshop', targetPort: s => s.workshop.port, config, logger, rewriteHtml: true,onUpload:archiveEngineUpload});

  const staticScene = async (req, res, request) => {
    const pathname = decodeURIComponent(request.url.pathname);
    const relative = pathname.slice('/scene'.length) || '/';
    const rewritten = {...request, url: new URL(relative + request.url.search, request.url.origin)};
    return serveStatic(req, res, {root: sceneDist, spaFallback: true, request: rewritten});
  };
  const staticWorkshop = async (req, res, request) => {
    const pathname = decodeURIComponent(request.url.pathname);
    const relative = pathname.slice('/workshop'.length) || '/';
    const rewritten = {...request, url: new URL(relative + request.url.search, request.url.origin)};
    return serveStatic(req, res, {root: workshopPublic, spaFallback: false, request: rewritten});
  };

  const routes = [
    ...await registerProjectCenter(context),
    ...registerHubRoutes(context),
    ...registerLanRoutes(context),
    {method: 'GET', pattern: /^\/healthz$/, handler: async () => ({body: {ok: true, version: VERSION}}), options: {scope: null}}
  ];
  const push = (method, pattern, handler) => routes.push({method, pattern, handler, options: {scope: null}});
  push('GET',/^\/open-comic$/,async(request,res)=>{let port=18896;if(request.loopback){try{const service=JSON.parse(await readFile(process.env.COMIC_SERVICE_FILE||path.join(paths.root,'../comic-service.local.json'),'utf8'));port=Number(service.port)||18898;}catch{port=18898;}}res.writeHead(302,{Location:'http://127.0.0.1:'+port+'/','Cache-Control':'no-store'});res.end();});
  push('GET',/^\/$/,async(request,res)=>{let port=18909;try{const service=JSON.parse(await readFile(process.env.COMIC_SERVICE_FILE||path.join(paths.root,'../comic-service.local.json'),'utf8'));port=Number(service.port)||18909;}catch{}res.writeHead(302,{Location:'http://127.0.0.1:'+port+'/project-center.html','Cache-Control':'no-store'});res.end();});
  push('GET',/^\/tools\/?$/,async()=>({file:{path:path.join(paths.webDist,'index.html'),mime:'text/html; charset=utf-8'},cacheControl:'no-store'}));
  push('GET',/^\/api-guide$/,async()=>({file:{path:path.join(paths.root,'PROJECT-API.md'),mime:'text/plain; charset=utf-8'},cacheControl:'no-store'}));
  push('GET',/^\/worker-guide$/,async()=>({file:{path:path.join(paths.root,'WORKER.md'),mime:'text/plain; charset=utf-8'},cacheControl:'no-store'}));
  for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']) {
    push(method, /^\/api\/scene(\/.*)?$/, (request, res) => sceneProxy(request.req, res, request));
    push(method, /^\/api\/workshop(\/.*)?$/, (request, res) => workshopProxy(request.req, res, request));
  }
  push('GET', /^\/scene(\/.*)?$/, (request, res) => (path.extname(decodeURIComponent(request.url.pathname)) ? staticScene(request.req, res, request) : scenePageProxy(request.req, res, request)));
  push('GET', /^\/workshop(\/.*)?$/, (request, res) => (path.extname(decodeURIComponent(request.url.pathname)) ? staticWorkshop(request.req, res, request) : workshopPageProxy(request.req, res, request)));
  // 内嵌页面会把 /api/... 请求改写到 /scene/... 与 /workshop/... 前缀下，
  // 因此这两个前缀必须支持全部动词（否则上传/提交类请求会得到 405）。
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    push(method, /^\/scene(\/.*)?$/, (request, res) => scenePageProxy(request.req, res, request));
    push(method, /^\/workshop(\/.*)?$/, (request, res) => workshopPageProxy(request.req, res, request));
  }

  // 文档直接发布出来，界面上点得到、Codex 也能直接抓
  const docs = new Map([
    ['/AGENTS.md', path.join(paths.root, 'AGENTS.md')],
    ['/README.md', path.join(paths.root, 'README.md')],
    ['/接口文档.md', path.join(paths.root, '接口文档.md')],
    ['/合并说明.md', path.join(paths.root, '合并说明.md')]
  ]);
  for (const [routePath, file] of docs) {
    push('GET', new RegExp(`^${routePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`), async () => {
      if (!existsSync(file)) throw Object.assign(new Error('文档不存在。'), {status: 404});
      return {file: {path: file, mime: 'text/markdown; charset=utf-8', downloadName: path.basename(file)}, cacheControl: 'no-cache'};
    });
  }

  const {server} = createHubServer({
    config,
    tokens,
    logger,
    registerRoutes: () => routes,
    fallbackStatic: async (req, res, request) => serveStatic(req, res, {root: paths.webDist, spaFallback: true, request})
  });

  return {context, server, routes};
}

/* --------------------------------- 启动 --------------------------------- */

async function printBanner(context) {
  const settings = await context.config.read();
  const addresses = await localAddresses();
  const lines = [];
  lines.push('');
  lines.push('资产生成工作台已启动');
  lines.push(`  本机界面:      http://127.0.0.1:${settings.port}/`);
  for (const entry of addresses) lines.push(`  局域网接入:    http://${entry.address}:${settings.port}/   (${entry.name})`);
  lines.push(`  接单接口:      POST http://<本机IP>:${settings.port}/api/lan/v1/jobs`);
  lines.push(`  素材检索:      GET  http://<本机IP>:${settings.port}/api/lan/v1/assets?q=关键词`);
  lines.push(`  数据目录:      ${paths.data}`);
  lines.push(`  引擎端口:      场记 ${settings.scene.port} / 角色工房 ${settings.workshop.port}（仅本机回环）`);
  lines.push('');
  process.stdout.write(lines.join('\n') + '\n');
}

async function selfCheck(context) {
  const settings = await context.config.read();
  const checks = [];
  const push = (name, ok, detail) => checks.push({name, ok, detail});
  push('数据目录', existsSync(paths.data), paths.data);
  const destinations = await context.archive.checkDestinations();
  for (const destination of destinations) {
    push(`存储位置 ${destination.id}${destination.enabled ? '' : '（未启用）'}`, destination.ok || !destination.enabled, destination.ok ? destination.path : `${destination.path} → ${destination.error || '不可写'}`);
  }
  const node = resolveNodeBinary();
  const python = resolvePythonBinary(settings.workshop.pythonPath);
  const codex = findCodexBinary(settings.scene.codexPath);
  push('Node 运行时', existsSync(node) || node === 'node', node);
  push('Python 运行时', existsSync(python) || python === 'python', python);
  push('Codex 命令行', !!codex, codex || '未找到');
  try {
    const codexHome = await ensureCodexHome({logger: context.logger, configured: settings.scene.codexHome});
    push('Codex 运行目录可写', true, codexHome);
  } catch (error) {
    push('Codex 运行目录可写', false, error.message);
  }
  push('场记源码', existsSync(path.join(paths.sceneApp, 'server', 'index.mjs')), path.join(paths.sceneApp, 'server', 'index.mjs'));
  push('角色工房源码', existsSync(path.join(paths.workshopEngine, 'server.py')), path.join(paths.workshopEngine, 'server.py'));
  push('接口令牌', (await context.tokens.list()).length > 0, `${(await context.tokens.list()).length} 个`);
  const lines = checks.map(check => `${check.ok ? '  [通过]' : '  [待办]'} ${check.name}：${check.detail}`);
  process.stdout.write(`\n自检结果（${new Date().toLocaleString('zh-CN')}）\n${lines.join('\n')}\n`);
  return checks.every(check => check.ok);
}

async function main() {
  const built = await build();
  const {context, server} = built;

  if (args.check) {
    const ok = await selfCheck(context);
    await context.jobs.shutdown();
    await context.projectCenter.close();
    process.exit(ok ? 0 : 2);
  }

  const settings = await context.config.read();
  let lock = null;
  try {
    lock = await acquireLock(path.join(paths.data, 'workbench.lock'), {staleMs: 120_000});
  } catch (error) {
    context.logger.error(error.message);
    process.exitCode = 3;
    return;
  }

  const host = settings.bindHost || '0.0.0.0';
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(settings.port, host, resolve);
  }).catch(error => {
    context.logger.error(`端口 ${settings.port} 无法监听：${error.message}`, {code: error.code});
    process.exitCode = 4;
    throw error;
  });

  context.archive.start();
  await printBanner(context);

  if (!args.noEngines && settings.workshop.autostart) {
    context.engines.workshop.start()
      .then(result => context.logger.info('角色引擎就绪', result))
      .catch(error => context.logger.warn('角色引擎未能自动启动（可在界面里手动启动）', {error: error.message}));
  }
  if (!args.noEngines) {
    context.engines.scene.start()
      .then(result => context.logger.info('场记引擎就绪', result))
      .catch(error => context.logger.warn('场记引擎未能自动启动（可在界面里手动启动）', {error: error.message}));
  }

  const shutdown = async signal => {
    context.logger.info(`收到 ${signal}，正在退出…`);
    context.archive.stop();
    await context.projectCenter.close();
    await context.jobs.shutdown();
    await context.index.flush();
    await Promise.allSettled([context.engines.scene.stop(), context.engines.workshop.stop()]);
    server.close();
    await lock?.release();
    await sleep(50);
    process.exit(0);
  };
  context.requestShutdown = shutdown;
  if(process.send){const {installShutdown}=await import('../../distribution/ipc.mjs');installShutdown({busy:async()=>{const s=await context.jobs.stats();if(s.running>0||s.queued>0)return true;const engines=await Promise.all([context.engines.scene.status(),context.engines.workshop.status()]);return engines.some(e=>e.info?.busy);},close:()=>shutdown('distribution-update'),forceClose:async()=>{await context.jobs.forceStop();await shutdown('forced-team-update');}});}
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => shutdown(signal).catch(() => process.exit(1)));

  // 定期保存索引快照，避免只依赖追加日志
  const snapshotTimer = setInterval(() => {
    context.index.flush().catch(() => {});
  }, 120_000);
  snapshotTimer.unref?.();

  void startedAt;
}

main().catch(error => {
  process.stderr.write(`启动失败：${error?.message || error}\n${error?.stack || ''}\n`);
  process.exit(1);
});
