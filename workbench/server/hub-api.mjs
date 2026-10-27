/**
 * 本机界面（/api/hub/...）：配置、令牌、写盘队列、索引重建、自检。
 * 这些接口默认只在本机可用；带 admin 作用域的令牌也能调用，方便自动化运维。
 */
import path from 'node:path';
import {readFile, stat} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {atomicJson, readJson, safeName, ensureDir} from './store.mjs';
import {files, paths} from './paths.mjs';
import {ASSET_TYPES, applyTemplate, buildVariables, timeParts} from './naming.mjs';
import {resolveNodeBinary, resolvePythonBinary, findCodexBinary, ensureCodexHome} from './engines.mjs';
import {fileToText} from './script-library.mjs';

/** 把 dataURL 或裸 base64 解成字节 */
function decodeDataUrl(value) {
  const text = String(value || '').trim();
  const match = /^data:[^,]*;base64,([A-Za-z0-9+/=\s]+)$/.exec(text);
  return Buffer.from(match ? match[1].replace(/\s/g, '') : text.replace(/\s/g, ''), 'base64');
}

/** 列表里不返回正文，避免一次传几 MB */
function summarizeScript(record) {
  const {text, chapters, ...rest} = record;
  return {...rest, firstChapter: chapters?.[0]?.title || '', lastChapter: chapters?.[chapters.length - 1]?.title || ''};
}

/** 预览用：文件 → 文本 */
async function textFromFile({fileName, bytes}) {
  return fileToText({fileName, bytes});
}

export function registerHubRoutes(ctx) {
  const {config, tokens, index, archive, jobs, scripts, engines, logger, version} = ctx;
  const routes = [];
  const route = (method, pattern, handler, options = {}) => routes.push({method, pattern, handler, options});

  route('GET', /^\/api\/hub\/session$/, async (request) => ({
    body: {
      version,
      local: request.loopback,
      remoteAddress: request.remoteAddress,
      addresses: await localAddresses(),
      dataDirectory: paths.data,
      settingsFile: files.settings,
      tokenRequired: (await config.read()).requireToken,
      hasTokens: (await tokens.list()).length > 0
    }
  }), {scope: null});

  route('GET', /^\/api\/hub\/settings$/, async () => ({
    body: {settings: await config.safe(), assetTypes: ASSET_TYPES}
  }), {scope: null});

  route('PUT', /^\/api\/hub\/settings$/, async request => {
    const patch = await request.json(2 * 1024 * 1024);
    const settings = await config.update(patch);
    await applyWorkshopConcurrency(settings, logger);
    return {body: {settings: await config.safe()}};
  }, {scope: 'admin'});

  route('POST', /^\/api\/hub\/settings\/reload$/, async () => ({body: {settings: await config.safe()}}), {scope: 'admin'});

  /* --------------------------------- 存储位置 --------------------------------- */

  route('GET', /^\/api\/hub\/destinations$/, async () => ({
    body: {destinations: await archive.checkDestinations(), outbox: await archive.pending()}
  }), {scope: null});

  route('POST', /^\/api\/hub\/destinations\/check$/, async () => ({
    body: {destinations: await archive.checkDestinations()}
  }), {scope: 'admin'});

  route('POST', /^\/api\/hub\/outbox\/flush$/, async () => ({body: await archive.flushOutbox()}), {scope: 'admin'});

  /* ---------------------------------- 令牌 ---------------------------------- */

  /* ---------------------------------- 令牌 ---------------------------------- */

  /**
   * 给本机 AI 助手（Codex 等）用：直接返回当前有效的访问令牌。
   * 只认本机回环，所以不会给局域网留后门；无需用户配置任何东西。
   */
  route('GET', /^\/api\/hub\/assistant-token$/, async request => {
    if (!request.loopback) throw Object.assign(new Error('该接口只允许本机调用。'), {status: 403, code: 'admin_local_only'});
    let token = await ctx.assistant?.read();
    if (!token) token = await ctx.assistant?.rotate();
    return {
      body: {
        token,
        scopes: ['intake', 'read', 'write'],
        file: files.assistantToken,
        baseUrl: `http://127.0.0.1:${(await config.read()).port}`,
        hint: '本机回环访问本来就免令牌；从其他机器调用时把它放到 Authorization: Bearer <token>。'
      }
    };
  });

  route('POST', /^\/api\/hub\/assistant-token\/rotate$/, async request => {
    if (!request.loopback) throw Object.assign(new Error('该接口只允许本机调用。'), {status: 403, code: 'admin_local_only'});
    const token = await ctx.assistant?.rotate();
    logger?.info('已轮换本机助手令牌');
    return {body: {token, file: files.assistantToken}};
  });

  route('GET', /^\/api\/hub\/tokens$/, async () => ({body: {tokens: await tokens.list()}}), {scope: 'admin'});

  route('POST', /^\/api\/hub\/tokens$/, async request => {
    const payload = await request.json();
    const created = await tokens.create({
      label: payload?.label,
      scopes: Array.isArray(payload?.scopes) ? payload.scopes : ['intake', 'read'],
      expiresInDays: Number(payload?.expiresInDays) || 0
    });
    return {body: created, status: 201};
  }, {scope: 'admin'});

  route('DELETE', /^\/api\/hub\/tokens\/([^/]+)$/, async request => ({body: await tokens.remove(request.params[0])}), {scope: 'admin'});

  route('PATCH', /^\/api\/hub\/tokens\/([^/]+)$/, async request => {
    const payload = await request.json();
    if (typeof payload?.enabled === 'boolean') return {body: await tokens.setEnabled(request.params[0], payload.enabled)};
    throw Object.assign(new Error('只支持修改 enabled。'), {status: 400});
  }, {scope: 'admin'});

  /* --------------------------------- 作业中心 --------------------------------- */

  route('GET', /^\/api\/hub\/jobs$/, async request => {
    const query = request.url.searchParams;
    return {
      body: {
        ...(await jobs.list({status: query.get('status') || '', limit: Number(query.get('limit') || 50), offset: Number(query.get('offset') || 0)})),
        stats: await jobs.stats()
      }
    };
  }, {scope: null});

  route('GET', /^\/api\/hub\/jobs\/([^/]+)$/, async request => {
    const job = await jobs.get(request.params[0]);
    if (!job) throw Object.assign(new Error('作业不存在。'), {status: 404, code: 'job_missing'});
    return {body: job};
  }, {scope: null});

  route('POST', /^\/api\/hub\/jobs$/, async request => {
    const payload = await request.json(64 * 1024 * 1024);
    const result = await jobs.create(payload, {token: null});
    return {body: result.job, status: 202};
  }, {scope: null});

  route('POST', /^\/api\/hub\/jobs\/([^/]+)\/cancel$/, async request => ({body: await jobs.cancel(request.params[0])}), {scope: null});
  route('POST', /^\/api\/hub\/jobs\/([^/]+)\/retry$/, async request => ({body: await jobs.retryFailed(request.params[0])}), {scope: null});

  /* -------------------------------- 素材中心 -------------------------------- */

  route('GET', /^\/api\/hub\/assets$/, async request => {
    const query = request.url.searchParams;
    const result = await index.query({
      q: query.get('q') || '',
      type: query.get('type') || '',
      project: query.get('project') || '',
      character: query.get('character') || '',
      outfit: query.get('outfit') || '',
      style: query.get('style') || '',
      kind: query.get('kind') || '',
      tags: query.get('tags') || '',
      destinationId: query.get('destinationId') || '',
      since: query.get('since') || '',
      until: query.get('until') || '',
      sort: query.get('sort') || 'createdAt',
      order: query.get('order') || 'desc',
      limit: Number(query.get('limit') || 60),
      offset: Number(query.get('offset') || 0)
    });
    return {body: {...result, stats: index.stats()}};
  }, {scope: null});

  route('GET', /^\/api\/hub\/assets\/([^/]+)\/file$/, async request => {
    const asset = index.get(request.params[0]);
    if (!asset || asset.deletedAt) throw Object.assign(new Error('素材不存在。'), {status: 404, code: 'asset_missing'});
    const copy = preferReadableCopy(asset);
    if (!copy) throw Object.assign(new Error('素材文件在磁盘上不存在。'), {status: 404, code: 'asset_file_missing'});
    return {file: {path: copy.path, mime: mimeOf(asset.extension), downloadName: asset.name}, cacheControl: 'private, max-age=600'};
  }, {scope: null});

  route('DELETE', /^\/api\/hub\/assets\/([^/]+)$/, async request => ({body: {deleted: (await index.markDeleted(request.params[0]))?.assetId}}), {scope: null});

  route('POST', /^\/api\/hub\/assets\/scan$/, async request => {
    const settings = await config.read();
    const roots = [
      ...settings.destinations.filter(entry => entry.enabled).map(entry => ({id: entry.id, path: entry.path})),
      ...settings.additionalRoots.map(entry => ({id: entry.id, path: entry.path}))
    ];
    const result = await index.scan(roots, {onProgress: () => {}});
    return {body: result};
  }, {scope: 'admin'});

  route('POST', /^\/api\/hub\/archive$/, async request => {
    const payload = await request.json(96 * 1024 * 1024);
    if (!payload?.data && !payload?.sourcePath) throw Object.assign(new Error('需要 data（base64/dataURL）或 sourcePath。'), {status: 400, code: 'archive_no_content'});
    let bytes;
    if (payload.data) {
      const match = /^data:([\w.+-]+\/[\w.+-]+);base64,([A-Za-z0-9+/=]+)$/.exec(String(payload.data).trim());
      bytes = Buffer.from(match ? match[2] : String(payload.data).replace(/\s+/g, ''), 'base64');
    }
    const result = await archive.store({...payload, bytes, origin: payload.origin || 'hub:manual'});
    return {body: result, status: result.skipped ? 200 : 201};
  }, {scope: null});

  /* -------------------------------- 剧本中心 -------------------------------- */

  route('GET', /^\/api\/hub\/scripts$/, async () => ({body: {scripts: await scripts.list()}}), {scope: null});

  route('GET', /^\/api\/hub\/scripts\/([^/]+)$/, async request => {
    const record = await scripts.get(request.params[0]);
    if (!record) throw Object.assign(new Error('剧本不存在。'), {status: 404, code: 'script_missing'});
    return {body: {script: record}};
  }, {scope: null});

  /** 只解析不保存：导入前先看看切出来几章、切得对不对 */
  route('POST', /^\/api\/hub\/scripts\/preview$/, async request => {
    const payload = await request.json(80 * 1024 * 1024);
    let text = String(payload?.text || '');
    let fileName = '';
    if (!text && payload?.data) {
      fileName = String(payload.filename || '');
      const bytes = decodeDataUrl(payload.data);
      text = await textFromFile({fileName, bytes});
    }
    if (!text.trim()) throw Object.assign(new Error('没有可解析的正文。'), {status: 400, code: 'script_empty'});
    const {chapters, method} = await scripts.splitChapters(text);
    return {
      body: {
        fileName,
        chars: text.length,
        splitMethod: method,
        chapters: chapters.map(chapter => ({
          index: chapter.index,
          title: chapter.title,
          chars: chapter.text.length,
          preview: chapter.text.slice(0, 120)
        }))
      }
    };
  }, {scope: null});

  route('POST', /^\/api\/hub\/scripts$/, async request => {
    const payload = await request.json(80 * 1024 * 1024);
    if (payload?.data) {
      const bytes = decodeDataUrl(payload.data);
      const record = await scripts.importFile({fileName: payload.filename, bytes, title: payload.title});
      return {body: {script: summarizeScript(record)}, status: 201};
    }
    const text = String(payload?.text || '');
    if (!text.trim()) throw Object.assign(new Error('请提供正文（text）或上传文件（data）。'), {status: 400, code: 'script_empty'});
    const record = await scripts.importText({text, title: payload?.title, format: 'paste'});
    return {body: {script: summarizeScript(record)}, status: 201};
  }, {scope: null});

  route('DELETE', /^\/api\/hub\/scripts\/([^/]+)$/, async request => {
    const removed = await scripts.remove(request.params[0]);
    if (!removed) throw Object.assign(new Error('剧本不存在。'), {status: 404, code: 'script_missing'});
    return {body: {removed: removed.id, title: removed.title}};
  }, {scope: null});

  /** 一键分发：同一份剧本同时喂给场记和角色工房 */
  route('POST', /^\/api\/hub\/scripts\/([^/]+)\/distribute$/, async request => {
    const payload = await request.json(1024 * 1024);
    const targets = Array.isArray(payload?.targets) && payload.targets.length ? payload.targets : ['scene', 'workshop'];
    const report = await scripts.distribute(request.params[0], {
      targets,
      rangeStart: payload?.rangeStart,
      rangeEnd: payload?.rangeEnd,
      title: payload?.title
    });
    const failed = report.results.filter(item => !item.ok);
    return {body: report, status: failed.length && failed.length === report.results.length ? 502 : 200};
  }, {scope: null});

  /* ------------------------------ 命名模板预览 ------------------------------ */

  route('POST', /^\/api\/hub\/naming\/preview$/, async request => {
    const payload = await request.json(64 * 1024);
    const settings = await config.read();
    const template = payload?.template || settings.naming.template;
    const samples = Array.isArray(payload?.samples) && payload.samples.length ? payload.samples : [payload?.sample || {}];
    const rendered = samples.map(sample => {
      const variables = buildVariables({...sample, ext: sample?.ext || 'png'}, {timeZone: settings.naming.timeZone});
      const relative = applyTemplate(template, variables);
      const single = /\.(png|jpe?g|webp|json|txt|mp4)$/i.test(relative) ? relative : `${relative}.png`;
      return {
        input: sample,
        variables,
        relativePath: single,
        targets: settings.destinations.filter(entry => entry.enabled).map(entry => ({
          destinationId: entry.id,
          label: entry.label,
          path: path.join(entry.path, single)
        }))
      };
    });
    return {body: {template, time: timeParts(new Date(), settings.naming.timeZone), rendered}};
  }, {scope: null});

  /* --------------------------------- 引擎管理 --------------------------------- */

  route('GET', /^\/api\/hub\/engines$/, async () => ({
    body: {
      engines: {
        scene: await engines.scene.status(),
        workshop: await engines.workshop.status()
      },
      binaries: {
        node: resolveNodeBinary(),
        python: resolvePythonBinary((await config.read()).workshop.pythonPath),
        codex: findCodexBinary((await config.read()).scene.codexPath) || '(未找到 codex.exe)'
      }
    }
  }), {scope: null});

  route('POST', /^\/api\/hub\/engines\/(scene|workshop)\/(start|stop|restart)$/, async request => {
    const [engine, action] = request.params;
    const target = engines[engine];
    if (!target) throw Object.assign(new Error(`未知引擎：${engine}`), {status: 400});
    if (action === 'stop' || action === 'restart') await target.stop();
    const result = action === 'stop' ? {stopped: true} : await target.start();
    return {body: {engine, action, result}};
  }, {scope: null});

  /* ---------------------------------- 自检 ---------------------------------- */

  route('GET', /^\/api\/hub\/selfcheck$/, async () => {
    const settings = await config.read();
    const checks = [];
    const push = (name, ok, detail) => checks.push({name, ok, detail});
    push('数据目录可写', existsSync(paths.data), paths.data);
    const destinations = await archive.checkDestinations();
    for (const destination of destinations) {
      push(`存储位置：${destination.label}`, destination.ok || !destination.enabled, destination.ok ? destination.path : `${destination.path} — ${destination.error || '不可写'}`);
    }
    const scene = await engines.scene.status();
    const workshop = await engines.workshop.status();
    push('场景引擎（场记）', !!scene.running, scene.running ? `端口 ${scene.port}` : scene.error || '未运行');
    push('角色引擎（角色工房）', !!workshop.running, workshop.running ? `端口 ${workshop.port}` : workshop.error || '未运行');
    const node = resolveNodeBinary();
    push('Node 运行时', existsSync(node) || node === 'node', node);
    const python = resolvePythonBinary(settings.workshop.pythonPath);
    push('Python 运行时', existsSync(python) || python === 'python', python);
    const codex = findCodexBinary(settings.scene.codexPath);
    push('Codex 命令行（生图必需）', !!codex, codex || '未找到。请安装 Codex CLI 或在设置里填写 codexPath。');
    try {
      const codexHome = await ensureCodexHome({logger, configured: settings.scene.codexHome});
      const managed = codexHome.startsWith(paths.data);
      const hasAuth = existsSync(path.join(codexHome, 'auth.json'));
      push('Codex 运行目录可写', true, `${codexHome}${managed ? '（工作台托管，已复制登录信息）' : '（使用用户目录）'}${hasAuth ? '' : '，但未找到 auth.json，请先执行 codex login'}`);
    } catch (error) {
      push('Codex 运行目录可写', false, error.message);
    }
    const tokenList = await tokens.list();
    push('接口令牌', tokenList.length > 0, tokenList.length ? `已配置 ${tokenList.length} 个` : '尚未创建；局域网调用需要至少一个 intake/read 令牌。');
    const indexStats = index.stats();
    push('素材索引', true, `已登记 ${indexStats.total} 个素材`);
    const indexExists = existsSync(files.assetIndex);
    push('索引文件', indexExists || indexStats.total === 0, files.assetIndex);
    return {body: {ok: checks.every(check => check.ok), checks, version, checkedAt: new Date().toISOString()}};
  }, {scope: null});

  /* ---------------------------------- 退出 ---------------------------------- */

  route('POST', /^\/api\/hub\/shutdown$/, async request => {
    if (!request.loopback) throw Object.assign(new Error('只允许本机停止服务。'), {status: 403, code: 'admin_local_only'});
    setTimeout(() => ctx.requestShutdown?.('api'), 200).unref?.();
    return {body: {ok: true, message: '工作台正在退出。'}};
  }, {scope: null});

  /* ---------------------------------- 日志 ---------------------------------- */

  route('GET', /^\/api\/hub\/logs$/, async request => {
    const limit = Math.min(Number(request.url.searchParams.get('limit') || 200), 1000);
    const file = path.join(files.logs, 'workbench.log');
    if (!existsSync(file)) return {body: {lines: []}};
    const text = await readFile(file, 'utf8');
    const lines = text.split('\n').filter(Boolean).slice(-limit);
    return {body: {lines}};
  }, {scope: null});

  route('POST', /^\/api\/hub\/open-folder$/, async request => {    const payload = await request.json(64 * 1024);
    const settings = await config.read();
    const known = [
      {id: 'data', path: paths.data},
      {id: 'assets', path: path.join(paths.data, 'assets')},
      ...settings.destinations.filter(entry => entry.enabled).map(entry => ({id: entry.id, path: entry.path})),
      {id: 'logs', path: files.logs}
    ];
    const target = known.find(entry => entry.id === payload?.id);
    if (!target) throw Object.assign(new Error('未知的目录编号。'), {status: 400});
    await ensureDir(target.path);
    if (process.platform === 'win32') {
      spawn('explorer.exe', [target.path], {detached: true, stdio: 'ignore', windowsHide: false}).unref();
    } else if (process.platform === 'darwin') {
      spawn('open', [target.path], {detached: true, stdio: 'ignore'}).unref();
    } else {
      spawn('xdg-open', [target.path], {detached: true, stdio: 'ignore'}).unref();
    }
    return {body: {opened: target.path}};
  }, {scope: null});

  return routes;
}

async function applyWorkshopConcurrency(settings, logger) {
  try {
    const response = await fetch(`http://127.0.0.1:${settings.workshop.port}/api/settings`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({maxConcurrentJobs: settings.workshop.maxConcurrentJobs})
    });
    if (!response.ok) logger?.warn('角色引擎并发设置未能应用', {status: response.status});
  } catch {
    /* 引擎未启动时忽略：启动后由用户再次触发或重启生效 */
  }
}

function preferReadableCopy(asset) {
  const copies = (asset.copies || []).filter(copy => copy.path);
  return copies.find(copy => existsSync(copy.path)) || null;
}

function mimeOf(extension) {
  const ext = String(extension || '').toLowerCase().replace(/^\./, '');
  return {png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', json: 'application/json', txt: 'text/plain; charset=utf-8', mp4: 'video/mp4'}[ext] || 'application/octet-stream';
}

export async function localAddresses() {
  const os = await import('node:os');
  const addresses = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const entry of list || []) {
      if (entry.family === 'IPv4' && !entry.internal) addresses.push({name, address: entry.address});
    }
  }
  return addresses;
}

export {safeName, readJson, atomicJson, stat};
