import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {spawn, spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import catalog from './catalog.mjs';
import {classifyOutcome} from './outcomes.mjs';
import {privilegedFixtureReason} from './privileged-fixtures.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const args = process.argv.slice(2);
const get = (name, fallback) => { const i = args.indexOf('--' + name); return i < 0 ? fallback : args[i + 1]; };
const mode = get('suite', args[0] || 'small');
const modes = ['core-functions', 'all-functions', 'core-flows', 'all-flows', 'small', 'large'];
if (!modes.includes(mode)) throw Error('suite: ' + modes.join(', '));
if (Number(process.versions.node.split('.')[0]) < 24) throw Error('需要 Node.js 24 或更新版本');
const plan = JSON.parse(fs.readFileSync(path.join(here, 'suites.json'), 'utf8'));
const ignored = new Set(['.git', 'node_modules', 'runtime', 'runtime-data', '.runtime', '.quality-deps', 'audit-data', 'audit', 'verification', 'outputs', 'cache', 'data', 'quality-runs', '__pycache__']);
const found = [];
function scan(dir) {
  for (const ent of fs.readdirSync(dir, {withFileTypes:true})) {
    if (ent.isSymbolicLink() || ignored.has(ent.name)) continue;
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) scan(p);
    else if (/\.(?:test|spec)\.[cm]?js$/.test(ent.name) || /^test_.*\.py$/.test(ent.name)) found.push(path.relative(root, p).replaceAll('\\', '/'));
  }
}
scan(root);
const unique = list => [...new Set(list)].sort();
const flowFiles = unique(catalog.flows.flatMap(row => row.tests));
const suites = {
  'core-functions': unique(plan.coreFunctions),
  'all-functions': unique(found),
  'core-flows': unique(catalog.flows.filter(f => f.core).flatMap(f => f.tests)),
  'all-flows': flowFiles,
};
suites.small = unique([...suites['core-functions'], ...suites['core-flows']]);
suites.large = unique([...suites['all-functions'], ...suites['all-flows']]);
const filter = get('filter', '');
const available = suites[mode].filter(f => f.includes(filter));
const ranged=args.includes('--start')||args.includes('--end'),start=Number(get('start','0')),end=Number(get('end',String(available.length)));
if(!Number.isInteger(start)||!Number.isInteger(end)||start<0||end<=start||end>available.length)throw Error('测试范围无效：使用 --start 0 --end '+available.length+'，结束序号不包含在范围内');
const selected = available.slice(start,end);
const missing = unique([...plan.coreFunctions, ...catalog.features.flatMap(f => f.tests), ...flowFiles]).filter(f => !fs.existsSync(path.join(root, f)));
const inventory = {mode, node: process.version, discovered: found.length, suiteCounts: Object.fromEntries(Object.entries(suites).map(([k,v]) => [k,v.length])), selected: selected.length, available:available.length,range:{start,end},missing, files: selected};
if (args.includes('--list')) { console.log(JSON.stringify(inventory, null, 2)); process.exit(missing.length || !selected.length ? 1 : 0); }
if (missing.length || !selected.length) throw Error('测试清单为空或包含不存在的文件: ' + missing.join(', '));
const id = new Date().toISOString().replace(/[:.]/g, '-') + '-' + process.pid;
const output = path.resolve(get('output', path.join(path.dirname(root), 'q', id)));
const internalRunRoot = path.join(root, 'quality-runs');
if (output === root || output.startsWith(root + path.sep) && !output.startsWith(internalRunRoot + path.sep) || fs.existsSync(output)) throw Error('输出目录必须是新目录；仓库内只允许 quality-runs 子目录: ' + output);
fs.mkdirSync(output, {recursive:true});
const workers = Math.max(1,Math.min(2,Number(get('jobs','1'))||1));
const stages=Array.from({length:workers},(_,i)=>path.join(output,'source-'+(i+1)));
function copy(src, dest) {
  const stat = fs.lstatSync(src), name = path.basename(src);
  if (stat.isSymbolicLink() || ignored.has(name)) return;
  if (stat.isDirectory()) { fs.mkdirSync(dest, {recursive:true}); for (const child of fs.readdirSync(src)) copy(path.join(src,child),path.join(dest,child)); return; }
  if (/(?:^\.env(?:\..*)?$|^auth\.json$|^.*\.local\.json$|^id_rsa$|^id_ed25519$|\.(?:zip|7z|gz|exe|dll|db|sqlite|pem|key)$)/i.test(name)) return;
  fs.copyFileSync(src, dest);
}
for(const stage of stages){console.log('复制源码至隔离目录：' + stage);copy(root, stage);}
const dep = process.env.QUALITY_NODE_MODULES || path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules');
const python = process.env.QUALITY_PYTHON || path.join(path.dirname(path.dirname(dep)), 'python', process.platform === 'win32' ? 'python.exe' : 'bin/python3');
if (!fs.existsSync(path.join(dep, 'playwright')) || !fs.existsSync(path.join(dep, '@napi-rs/canvas')) || !fs.existsSync(python)) throw Error('缺少测试依赖：设置 QUALITY_NODE_MODULES 与 QUALITY_PYTHON；需要 Playwright、Canvas、Python。');
let mokuStage='';
if(selected.includes('comic/quality/cases/moku-real-contract.test.mjs')&&process.env.QUALITY_MOKU_SOURCE){
  const source=path.resolve(process.env.QUALITY_MOKU_SOURCE),manifest=JSON.parse(fs.readFileSync(path.join(source,'package.json'),'utf8'));
  const supportedBuilds={'1.1.0-20261027-global1':23,'2.0.1-20261028-recovery1':24},schemaVersion=supportedBuilds[manifest.buildId];
  if(manifest.name!=='comic-library'||!schemaVersion||!fs.existsSync(path.join(source,'node_modules/@electric-sql/pglite')))throw Error('QUALITY_MOKU_SOURCE 必须指向带测试依赖的受支持墨库源码：'+Object.keys(supportedBuilds).join('、'));
  mokuStage=path.join(output,'moku-source');console.log('复制墨库测试源码至：'+mokuStage);copy(source,mokuStage);
  fs.symlinkSync(path.join(source,'node_modules'),path.join(mokuStage,'node_modules'),process.platform==='win32'?'junction':'dir');
  inventory.mokuSource={version:manifest.version,buildId:manifest.buildId,schemaVersion,mode:'isolated source and synthetic ordinary account'};
}
if(selected.includes('comic/python/test_local_region_tools.py')&&process.env.QUALITY_U2NET_MODEL){
  const model=path.resolve(process.env.QUALITY_U2NET_MODEL),hash=createHash('md5');
  for await(const chunk of fs.createReadStream(model))hash.update(chunk);
  if(hash.digest('hex')!=='60024c5c889badc19c04ad937298a77b')throw Error('U2NET_MODEL_HASH_MISMATCH: 测试模型与已知 U²-Net 原件不一致');
  for(const stage of stages){const folder=path.join(stage,'.runtime/image-tools/AI工具/models');fs.mkdirSync(folder,{recursive:true});fs.copyFileSync(model,path.join(folder,'u2net.onnx'));}
  inventory.u2netModel={md5:'60024c5c889badc19c04ad937298a77b',mode:'verified copy inside isolated test source'};
}
const nodeRuntime = path.dirname(dep);
for(const stage of stages){
  fs.symlinkSync(dep, path.join(stage,'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  fs.mkdirSync(path.join(stage,'verification'),{recursive:true});
  fs.mkdirSync(path.join(stage, 'runtime'), {recursive:true});
  // Browser and API fixtures create temporary directories below comic/.runtime.
  // The source copier intentionally omits runtime data, so recreate only the
  // empty test parent in each isolated worker before any fixture starts.
  fs.mkdirSync(path.join(stage, 'comic/.runtime/temp'), {recursive:true});
  fs.symlinkSync(nodeRuntime, path.join(stage, 'runtime/node'), process.platform === 'win32' ? 'junction' : 'dir');
  fs.symlinkSync(path.dirname(python), path.join(stage, 'runtime/python'), process.platform === 'win32' ? 'junction' : 'dir');
  fs.mkdirSync(path.join(stage,'.runtime/image-tools'),{recursive:true});
  fs.symlinkSync(path.dirname(python),path.join(stage,'.runtime/image-tools/python'),process.platform==='win32'?'junction':'dir');
}
fs.mkdirSync(path.join(output,'runtime'),{recursive:true});
fs.symlinkSync(nodeRuntime,path.join(output,'runtime/node'),process.platform==='win32'?'junction':'dir');
fs.symlinkSync(path.dirname(python),path.join(output,'runtime/python'),process.platform==='win32'?'junction':'dir');
fs.mkdirSync(path.join(output,'logs'), {recursive:true});
fs.writeFileSync(path.join(output,'inventory.json'), JSON.stringify(inventory,null,2));
const results = [];
let interrupted = false;
let stoppedReason = '';
const active = new Set();
function kill(child) {
  if (!child.pid) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], {windowsHide:true, stdio:'ignore'});
  else child.kill('SIGKILL');
}
process.on('SIGINT', () => { interrupted = true; for (const c of active) kill(c); });
process.on('SIGTERM', () => { interrupted = true; for (const c of active) kill(c); });
process.on('uncaughtException', error => {console.error(error.stack||error);interrupted=true;for(const c of active)kill(c);report();process.exitCode=1;});
const escape = text => String(text ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function coverage(rows) {
  return rows.map(row => ({...row, testFiles:row.tests.map(file => ({file, status:results.find(r => r.file === file)?.status || (selected.includes(file) ? 'pending' : 'not-run')})), evidenceLevel:'关联到测试文件；文件通过不等于此条功能已逐项验收'}));
}
function report() {
  const counts = {}; for (const result of results) counts[result.status] = (counts[result.status] || 0) + 1;
  const complete = !interrupted && results.length === selected.length;
  const passed = complete && results.every(r => r.status === 'passed');
  const summary = {mode, complete, passed, counts, total:selected.length, filtered:!!filter||ranged,range:{start,end,available:available.length},interrupted, stoppedReason, results, limits:plan.limits};
  const mapped = {features:coverage(catalog.features), flows:coverage(catalog.flows)};
  fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(summary,null,2));
  fs.writeFileSync(path.join(output,'coverage.json'),JSON.stringify(mapped,null,2));
  fs.writeFileSync(path.join(output,'results.csv'),'\ufefffile,status,kind,seconds,pass,fail,skip,log\n'+results.map(r=>[r.file,r.status,r.kind,r.seconds,r.pass,r.fail,r.skip,r.log].map(v=>'"'+String(v??'').replaceAll('"','""')+'"').join(',')).join('\n'));
  fs.writeFileSync(path.join(output,'report.html'),`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>工作台测试报告</title><style>body{font:15px/1.6 system-ui;max-width:1400px;margin:2em auto;padding:0 1em;background:#f3f5f8}table{border-collapse:collapse;width:100%;background:white}td,th{padding:7px;border:1px solid #cbd3df;text-align:left}.failed,.timeout,.blocked,.skipped{color:#ac1f1f}input{padding:8px;width:60%}</style><h1>工作台 ${escape(mode)} 测试</h1><p>${complete?(passed?'通过':'未通过'):'运行中或中断'} · 完成 ${results.length}/${selected.length}${filter||ranged?' · 仅运行选定范围 '+start+'—'+end+' / '+available.length:''}</p><pre>${escape(JSON.stringify(counts,null,2))}</pre><p>使用合成数据；部分测试使用模拟墨库；本次实际墨库源码构建：${escape(inventory.mokuSource?.buildId || "未配置")}。生产墨库、真实生图、真实协作与上线不属于本次结论。文件级通过不能直接说明每项功能完成验收。</p><input placeholder="筛选测试文件或结果" oninput="for(const r of document.querySelectorAll('tbody tr'))r.hidden=!r.textContent.toLowerCase().includes(this.value.toLowerCase())"><table><thead><tr><th>文件</th><th>结果</th><th>类型</th><th>秒</th><th>通过/失败/跳过</th><th>日志</th></tr></thead><tbody>${results.map(r=>`<tr><td>${escape(r.file)}</td><td class="${escape(r.status)}">${escape(r.status)}</td><td>${escape(r.kind)}</td><td>${r.seconds}</td><td>${r.pass}/${r.fail}/${r.skip}</td><td><a href="${escape(r.log)}">查看</a></td></tr>`).join('')}</tbody></table><p>逐项关联：<a href="coverage.json">coverage.json</a>；列表：<a href="inventory.json">inventory.json</a></p></html>`);
  return summary;
}
function proxyFor(portFile) {
  const permitted = port => { try { return fs.readFileSync(portFile,'utf8').split(/\s+/).includes(String(port)); } catch { return false; } };
  const server = http.createServer((req,res) => {
    req.on('error',()=>{});res.on('error',()=>{});
    let target; try { target = new URL(req.url); } catch { res.writeHead(400); return res.end(); }
    if (!['127.0.0.1','localhost','[::1]'].includes(target.hostname) || !permitted(target.port || 80) || target.protocol !== 'http:') { res.writeHead(403); return res.end('QUALITY_GUARD: blocked browser destination'); }
    const upstream = http.request({hostname:target.hostname === '[::1]' ? '::1' : target.hostname,port:target.port||80,path:target.pathname+target.search,method:req.method,headers:req.headers}, response => { res.writeHead(response.statusCode,response.headers); response.pipe(res); });
    upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); }); req.pipe(upstream);
  });
  server.on('connection',socket=>socket.on('error',()=>{}));
  server.on('clientError',(_error,socket)=>socket.destroy());
  server.on('connect', (_req,socket) => { socket.on('error',()=>{});socket.end('HTTP/1.1 403 Forbidden\r\n\r\n'); });
  return new Promise(resolve => server.listen(0,'127.0.0.1',() => resolve(server)));
}
const timeout = Math.max(1, Number(get('timeout','150'))) * 1000;
async function run(file,index,stage) {
  const name = String(index+1).padStart(3,'0') + '-' + path.basename(file);
  const blockedReason=privilegedFixtureReason(file);
  if(blockedReason){
    const log='logs/'+name+'.log';fs.writeFileSync(path.join(output,log),blockedReason+'\n');
    results.push({file,status:'blocked',kind:'privileged_fixture',exitCode:null,seconds:0,pass:0,fail:0,skip:0,log});
    report();console.log(`[${results.length}/${selected.length}] blocked ${file} (privileged fixture)`);return;
  }
  const runDir = path.join(output,'d',String(index+1)), home = path.join(runDir,'h'), portFile = path.join(runDir,'ports.txt');
  fs.mkdirSync(path.join(home,'.codex'),{recursive:true});
  fs.mkdirSync(path.join(home,'.cache/codex-runtimes/codex-primary-runtime'),{recursive:true});
  fs.symlinkSync(path.dirname(path.dirname(dep)),path.join(home,'.cache/codex-runtimes/codex-primary-runtime/dependencies'),process.platform==='win32'?'junction':'dir');
  for (const d of ['t','appdata','localappdata']) fs.mkdirSync(path.join(home,d),{recursive:true});
  fs.writeFileSync(portFile,'');
  const proxy = await proxyFor(portFile);
  const env = {};
  for (const key of ['PATH','PATHEXT','SYSTEMROOT','WINDIR','COMSPEC','PROGRAMFILES','PROGRAMFILES(X86)','PROGRAMW6432','PROCESSOR_ARCHITECTURE','NUMBER_OF_PROCESSORS']) if (process.env[key]) env[key] = process.env[key];
  Object.assign(env,{QUALITY_STAGE:stage,QUALITY_RUN_DIR:output,QUALITY_PORTS_FILE:portFile,QUALITY_BROWSER_PROXY:'http://127.0.0.1:'+proxy.address().port,
    NODE_OPTIONS:'--require '+JSON.stringify(path.join(stage,'comic/quality/guard.cjs')),NODE_PATH:dep,
    PYTHONPATH:[path.join(stage,'comic/quality/python'),process.env.QUALITY_PYTHON_DEPS||path.join(root,'.quality-deps/python')].filter(p=>fs.existsSync(p)).join(path.delimiter),PYTHONDONTWRITEBYTECODE:'1',HOME:home,USERPROFILE:home,APPDATA:path.join(home,'appdata'),LOCALAPPDATA:path.join(home,'localappdata'),TEMP:path.join(home,'t'),TMP:path.join(home,'t'),TMPDIR:path.join(home,'t'),CODEX_HOME:path.join(home,'.codex'),
    COMIC_DATA_DIR:path.join(runDir,'comic-data'),COMIC_SLOT_DIR:path.join(runDir,'slots'),COMIC_LIBRARY_CONFIG:path.join(runDir,'missing-moku-config.json'),COMIC_PROJECT_SYNC:'0',COMIC_TEAM_AUTO_SYNC:'0',
    COMIC_CODEX_BIN:process.execPath,COMIC_PYTHON_BIN:python,CODEX_PRIMARY_RUNTIME_PYTHON:python,IMAGE_REPAIR_PYTHON:python,COMIC_TEST_CANVAS_MODULE:path.join(dep,'@napi-rs/canvas'),COMIC_CANVAS_MODULE:path.join(dep,'@napi-rs/canvas'),ASSET_CANVAS_MODULE:path.join(dep,'@napi-rs/canvas'),COMIC_TEST_PLAYWRIGHT_MODULE:path.join(dep,'playwright'),CODEX_TEST_NODE_MODULES:dep+path.sep,QUALITY_EVIDENCE_DIR:path.join(runDir,'evidence')});
  if(process.env.QUALITY_BROWSER_EXECUTABLE) env.QUALITY_BROWSER_EXECUTABLE=process.env.QUALITY_BROWSER_EXECUTABLE;
  if(mokuStage){env.QUALITY_MOKU_TEST_SOURCE=mokuStage;env.QUALITY_MOKU_SCHEMA_VERSION=String(inventory.mokuSource.schemaVersion);}
  const font=process.env.QUALITY_TEST_FONT||(process.platform==='win32'&&process.env.WINDIR?path.join(process.env.WINDIR,'Fonts','arial.ttf'):'');
  if(font&&fs.existsSync(font))env.QUALITY_TEST_FONT=font;
  env.QUALITY_READ_ROOTS=JSON.stringify([dep,path.dirname(python),...env.PYTHONPATH.split(path.delimiter).filter(Boolean),...(mokuStage?[path.join(process.env.QUALITY_MOKU_SOURCE,'node_modules')]:[]),...(font?[font]:[]),...(process.platform==='win32'&&process.env.WINDIR?[path.join(process.env.WINDIR,'Fonts')]:[])]);
  if (file==='comic/tests/project-sync.test.mjs') env.COMIC_PROJECT_SYNC='1'; // this file supplies a fake library and tests the enabled path
  const isPython = file.endsWith('.py');
  const cwd = path.join(stage,file.startsWith('comic/')?'comic':path.dirname(file).replace(/\/(tests?|__tests__)$/,''));
  const log = 'logs/'+name+'.log', dest = fs.createWriteStream(path.join(output,log));
  const start = Date.now(); let raw='', timed=false;
  return new Promise(resolve => {
    let child;
    try{child=spawn(isPython?python:process.execPath,isPython?[path.join(stage,'comic/quality/python/test-runner.py'),path.join(stage,file)]:['--test','--test-isolation=none',path.join(stage,file)],{cwd,env,windowsHide:true,stdio:['ignore','pipe','pipe']});}
    catch(error){dest.end(String(error.stack||error));proxy.close();results.push({file,status:'failed',kind:'spawn_error',exitCode:null,seconds:0,pass:0,fail:1,skip:0,log});report();resolve();return;}
    active.add(child);
    const append = value => {dest.write(value);raw=(raw+String(value)).slice(-4*1024*1024);};
    child.stdout.on('data',append);child.stderr.on('data',append);child.on('error',e=>append(String(e.stack||e)));
    const timer=setTimeout(()=>{timed=true;kill(child);},timeout);
    child.on('close',code=>{
      active.delete(child);clearTimeout(timer);dest.end();proxy.closeAllConnections();proxy.close();
      const outcome=classifyOutcome({raw,code,timed,interrupted,isPython});
      const row={file,...outcome,exitCode:code,seconds:Math.round((Date.now()-start)/100)/10,log};results.push(row);report();console.log(`[${results.length}/${selected.length}] ${row.status} ${file} (${row.seconds}s)`);resolve();
    });
  });
}
function checkDiskSpace(){
  for(const [label,directory] of [['测试输出盘',output],['源码盘',root]]){
    try{const stat=fs.statfsSync(directory),free=Number(stat.bavail)*Number(stat.bsize);if(Number.isFinite(free)&&free<3*1024**3){stoppedReason=label+'可用空间不足 3 GiB，已停止启动后续测试；已完成结果保留。';interrupted=true;console.error(stoppedReason);return false;}}catch(error){console.warn('无法读取'+label+'剩余空间：'+error.message);}
  }
  return true;
}
report();let cursor=0;
await Promise.all(Array.from({length:workers},async(_,worker)=>{for(;;){const index=cursor++;if(interrupted||index>=selected.length||!checkDiskSpace())return;await run(selected[index],index,stages[worker]);}}));
const result=report();console.log('报告：'+path.join(output,'report.html'));process.exitCode=result.passed?0:1;
