import {LocalFolderBrowser} from './folder-browser.mjs';
import {BoundedCache} from '../public/bounded-cache.js';
import http from 'node:http';
import { readFile, writeFile, mkdir, readdir, stat, lstat, rename,copyFile,rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync,createReadStream,openSync,closeSync } from 'node:fs';
import {pipeline} from 'node:stream/promises';
import {importPage,sourceMetadata,makeRegion,createSourceJob,adoptPage,setPageRevision,exportPage,importReference,copyReferences,composeLayers,prepareDisplayCache,runPageTool,extractLayerPicture,validateReferenceIds,removeJobDir} from './page-service.mjs';
import os from 'node:os';
import {RepairQueue,IMAGE_GENERATION_CONCURRENCY} from './repair-queue.mjs';
import {ArchiveStorage} from './archive-storage.mjs';
import {ExportFolders} from './export-folders.mjs';
import {jobBaseFile} from './job-images.mjs';
import {ProjectStore,readFinalCompanionManifest} from './project-store.mjs';
import {assetFile} from './project-assets.mjs';
import {RegionSubmissionGuard,assertRepairRegion} from './region-submissions.mjs';
import {replaceFile} from './safe-files.mjs';
import {PromptPresets} from './prompt-presets.mjs';
import {GenerationSlotsClient} from '../lib/generation-slots.mjs';

import {ProjectBundles} from './project-bundle.mjs';
import {TextReviewService,TEXT_REVIEW_STATUSES,requiresTextReview} from './text-review-service.mjs';

export async function createRepairEngine({dataDir,apiOrigin,localTools}) {
const codeRoot=path.dirname(fileURLToPath(import.meta.url));
process.env.COMIC_REPAIR_CODE_ROOT=codeRoot;
const root=dataDir;
const taskTempDir=path.join(root,'临时文件');await mkdir(taskTempDir,{recursive:true});process.env.PYTHONUTF8='1';process.env.PYTHONIOENCODING='utf-8';
const publicDir=path.join(codeRoot,'public');
const folderBrowser=new LocalFolderBrowser();
const jobsDir = path.join(root, 'jobs');
const exportsDir = path.join(root, 'exports');
const exportFolders = new ExportFolders();
const origin=apiOrigin;const port=Number(new URL(origin).port);
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.json': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.ttf':'font/ttf', '.otf':'font/otf', '.ttc':'font/collection', '.woff2':'font/woff2' };
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const validId = value => /^\d{8}-\d{6}-[a-f0-9]{8}$/.test(value);
const activeRepairs = new Map();
const sharedGenerationSlots = new GenerationSlotsClient({origin});
const repairStartLocks = new Map();
const acceptingAttempts = new Set();
const repairQueue = new RepairQueue(IMAGE_GENERATION_CONCURRENCY, error => console.error('后台修图任务异常：', error.message));
const storage = new ArchiveStorage(root);
await storage.init();
const projects=new ProjectStore(root,storage);
const projectBundles=new ProjectBundles(root,projects);
const regionSubmissions=new RegionSubmissionGuard(()=>projects.jobIndex());
const promptPresets=new PromptPresets(root);
const preparationQueue=new RepairQueue(2);
const textReviews=new TextReviewService({root,readRequest:id=>projects.job(id),readAutomation,writeAutomation,validateRequest:validateRepairRequest,startRepair,runtime:ocrRuntime,archive:archiveTask});
function prepareJob(body){return new Promise((resolve,reject)=>{preparationQueue.enqueue(randomUUID(),async()=>{try{resolve(await createSourceJob(root,body,png));}catch(error){reject(error);}});});}
const archivePending=new Set();
// The job list is polled every 2 seconds; only re-archive a task when its result or state changed.
const archivedSignatures=new BoundedCache({name:'repair-archive-signatures',maxEntries:512,maxBytes:1024*1024,ttl:1800000});
function archiveIfChanged(id,job){const signature=JSON.stringify([job.result?.version??null,job.earlyText?.version??null,job.automation?.status??null,job.automation?.attemptId??null,job.automation?.updatedAt??null]);if(archivedSignatures.get(id)===signature)return;archivedSignatures.set(id,signature);archiveTask(id);}
function archiveTask(id){if(archivePending.has(id))return;archivePending.add(id);storage.background(storage.task(id).finally(()=>archivePending.delete(id)));}
let codexProbeCache = null;
let codexProbePending = null;
const fail = (message, code = 400) => Object.assign(new Error(message), { statusCode: code });
const sendJSON = (res, data, code = 200) => { res.writeHead(code, { 'Content-Type': mime['.json'], 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data).replace(/"\/(sources|project-assets|project-fonts|references|jobs|exports)\//g,'"/repair/$1/')); };

function png(dataURL) {
  if (typeof dataURL !== 'string' || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(dataURL)) throw fail('需要 PNG 图片');
  const bytes = Buffer.from(dataURL.split(',')[1], 'base64');
  if (bytes.length > 48 * 1024 * 1024 || !bytes.subarray(0, 8).equals(pngSignature) || bytes.length < 33) throw fail('PNG 无效或太大');
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  if (!width || !height || width * height > 40_000_000) throw fail('图片最多支持 4000 万像素');
  return { bytes, width, height };
}

async function bodyJSON(req) {
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 150 * 1024 * 1024) throw fail('请求图片太大', 413);
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8').replace(/"\/repair\/(sources|project-assets|project-fonts|references|jobs|exports)\//g,'"/$1/')); } catch { throw fail('请求格式不正确'); }
}



async function resultFile(dir, known = {}) {
  const automation=known.automation!==undefined?known.automation:await readAutomation(dir);if(automation&&automation.status!=='completed')return null;
  const id=path.basename(dir),request=known.request||await projects.job(id),finalText=await readFinalCompanionManifest(dir,'editable-text.json',id,request,automation),finalBubbles=await readFinalCompanionManifest(dir,'bubble-layers.json',id,request,automation);if(request.autoText&&request.workflowVersion!==3&&!finalText?.layers.length||request.separateBubble&&!finalBubbles?.layers.length)return null;
  for (const name of ['repaired.png', 'repaired.webp', 'repaired.jpg']) {
    try {
      const p = path.join(dir, name), info = await stat(p);
      // Wait for a producer to finish writing. Prefer writing a temporary file then renaming.
      // Automated attempts publish atomically; manual drops (e.g. an external Codex chat) may still be writing.
      if (info.size && (automation?.status === 'completed' || Date.now() - info.mtimeMs > 1000))return { name, version: `${info.size}-${info.mtimeMs}`,editableText:finalText?.layers||[],bubbleLayers:finalBubbles?.layers||[] };
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return null;
}

function pythonRuntime() {
  const candidates = [process.env.IMAGE_REPAIR_PYTHON, path.resolve(codeRoot,'../../.runtime/image-tools/python/python.exe'), path.resolve(path.dirname(process.execPath), '..', '..', 'python', 'python.exe'), path.join(os.homedir(), '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'python', 'python.exe')];
  return candidates.find(candidate => candidate && existsSync(candidate)) || 'python';
}
function ocrRuntime(){return process.env.IMAGE_REPAIR_OCR_PYTHON||pythonRuntime();}
async function readAutomation(dir) {
  try { return JSON.parse(await readFile(path.join(dir, 'automation.json'), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function writeAutomation(dir, state) {
  const temp = path.join(dir, `automation-${randomUUID()}.tmp`);
  await writeFile(temp, JSON.stringify(state, null, 2), 'utf8'); await replaceFile(temp, path.join(dir, 'automation.json'));
}
async function probeCodex(fresh = false, {allowStale = false} = {}) {
  // Submitting work reuses the last positive check and refreshes it in the background:
  // every pipeline verifies login and image capability again before it generates.
  if (allowStale && !fresh && codexProbeCache?.data?.ready === true) {
    if (Date.now() - codexProbeCache.time >= 30000 && !codexProbePending) void probeCodex().catch(() => {});
    return codexProbeCache.data;
  }
  if (fresh) codexProbeCache = null;
  if (codexProbeCache && Date.now() - codexProbeCache.time < 30000) return codexProbeCache.data;
  if (codexProbePending) return codexProbePending;
  codexProbePending = new Promise(resolve => {
    const child = spawn(pythonRuntime(), [path.join(process.env.COMIC_REPAIR_CODE_ROOT||root,'python', 'codex_client.py')], {cwd:root, windowsHide:true, stdio:['ignore','pipe','ignore'], env:{...process.env, PYTHONIOENCODING:'utf-8'}});
    let output = '', settled = false;
    const finish = data => { if (settled) return; settled = true; clearTimeout(timer); codexProbeCache = { time:Date.now(), data }; resolve(data); };
    const timer = setTimeout(() => { child.kill(); finish({ready:false, error:'Codex 连接检查超时'}); }, 35000);
    child.stdout.on('data', chunk => { output = (output + chunk.toString('utf8')).slice(-20000); });
    child.on('error', () => finish({ready:false, error:'无法启动 Python，请检查本地运行环境'}));
    child.on('close', () => {
      try { const data = JSON.parse(output.trim().split(/\r?\n/).at(-1)); finish({...data, ready:data.loggedIn === true && ['chatgpt','chatgptAuthTokens'].includes(data.accountType) && data.imageGeneration === true}); }
      catch { finish({ready:false, error:'无法读取 Codex 登录与生图能力'}); }
    });
  });
  try { return await codexProbePending; } finally { codexProbePending = null; }
}
async function validateRepairRequest(request){
 if(!request.sourceId)return;
 const meta=await sourceMetadata(root,request.sourceId),project=request.regionId?await projects.get(request.sourceId):null;
 assertRepairRegion(request,meta,project);
}
async function assertNoReviewAttempt(request,exceptId){if(!request.sourceId||!request.regionId)return;const jobs=await projects.jobIndex();if(jobs.some(job=>job.id!==exceptId&&job.sourceId===request.sourceId&&job.regionId===request.regionId&&TEXT_REVIEW_STATUSES.has(job.automation?.status)))throw fail('这个选区还有待校对或识字任务，请先校对或取消该任务',409);}
async function startRepairLocked(id) {
  const dir = path.join(jobsDir, id);
  await stat(path.join(dir, 'request.json'));
  const request=await textReviews.ensureWorkflow(id);
  try{await validateRepairRequest(request);}catch(error){await writeAutomation(dir,{jobId:id,status:'cancelled',phase:'cancelled',message:error.message});throw error;}
  if(requiresTextReview(request)&&!await textReviews.confirmed(id,request)){
    const reviewState=await readAutomation(dir);
    if(TEXT_REVIEW_STATUSES.has(reviewState?.status))return reviewState;
    return textReviews.begin(id);
  }
  if (repairQueue.has(id)) return (await readAutomation(dir)) || {status:'queued'};
  const previous = await readAutomation(dir);
  if (previous?.status === 'completed' && existsSync(path.join(dir, 'repaired.png'))) return previous;
  const attemptId = randomUUID().replaceAll('-', '');
  const queued = {jobId:id, attemptId, status:'queued', phase:'queued', message:'已加入后台队列，可继续圈选下一处', startedAt:Date.now()/1000};
  await writeAutomation(dir, queued);
  repairQueue.enqueue(id, () => runRepair(id, queued));
  return queued;
}
async function runRepair(id, queued) {
  const dir = path.join(jobsDir, id), attemptId = queued.attemptId;
  const current = await readAutomation(dir);
  if (current?.attemptId !== attemptId || current.status === 'cancelled') return;
  const request=await textReviews.ensureWorkflow(id);
  try{await validateRepairRequest(request);}catch(error){await writeAutomation(dir,{...queued,status:'cancelled',phase:'cancelled',message:error.message});return;}
  if(requiresTextReview(request)&&!await textReviews.confirmed(id,request)){await writeAutomation(dir,{...queued,status:'failed',phase:'text_confirmation_required',message:'原文尚未确认或原图选区已变化，请重新校对；未启动修图'});return;}
  const failed = async message => {
    const status = await readAutomation(dir);
    if (!status || (status.attemptId === attemptId && ['running','queued'].includes(status.status))) await writeAutomation(dir, {...queued, status:'failed', phase:'failed', message});
  };
  let child, lease;
  const controller = new AbortController();
  let checking = false, attachedEarly = false;
  const checkCancellation = async () => {
    if (checking || controller.signal.aborted) return;
    checking = true;
    try {
      const status = await readAutomation(dir);
      let cancellation;
      try { cancellation = JSON.parse(await readFile(path.join(dir,'cancel-requested.json'),'utf8')); } catch (error) { if(error.code!=='ENOENT')throw error; }
      if(status?.attemptId!==attemptId || status.status==='cancelled' || cancellation?.attemptId===attemptId)controller.abort();
      else if(status.status==='completed'&&!attachedEarly){attachedEarly=true;projects.attachJob(id).then(()=>{if(request.regionId)projects.scheduleComposite(request.sourceId);}).catch(error=>console.error('项目接回暂未完成：',error.message));}
    } finally { checking = false; }
  };
  const cancellationTimer = setInterval(() => checkCancellation().catch(error => console.error('取消检查失败：', error.message)), 200);
  const earlyTextTimer=request.workflowVersion>=2?null:setInterval(()=>projects.attachEarlyText(id).catch(error=>console.error('早期文字接回失败：',error.message)),500);
  const stopChild = () => {
    if(!child?.pid || child.exitCode!==null)return;
    if(process.platform==='win32')spawn('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});
    else { try { process.kill(-child.pid,'SIGTERM'); } catch { child.kill('SIGTERM'); } }
  };
  controller.signal.addEventListener('abort', stopChild);
  try {
    if(sharedGenerationSlots) {
      await writeAutomation(dir,{...queued,message:'正在等待统一生图队列，可继续修改其他位置'});
      lease = await sharedGenerationSlots.acquire({ownerId:`repair:${id}`,ownerPid:process.pid,requestId:attemptId,signal:controller.signal});
    }
    await checkCancellation();
    if(controller.signal.aborted)throw Object.assign(new Error('修图任务已取消'),{name:'AbortError'});
    const pipelineScript=path.join(process.env.COMIC_REPAIR_CODE_ROOT||root,'python','repair_pipeline.py');
    const args=lease ? [path.join(process.env.COMIC_REPAIR_CODE_ROOT||root,'python','generation_worker.py'),'--pipeline',pipelineScript,'--job',dir,'--attempt-id',attemptId] : [pipelineScript,'--job',dir,'--attempt-id',attemptId];
    const workerEnv={...process.env,PYTHONIOENCODING:'utf-8',...(lease?{COMIC_GENERATION_SLOT_ORIGIN:lease.origin,COMIC_GENERATION_SLOT_TOKEN:lease.token}:{})};
    // Keep worker tracebacks: a crash before automation.json is updated otherwise leaves only a generic message.
    const stderrLog=openSync(path.join(dir,'worker-stderr.log'),'a');
    try{child=spawn(pythonRuntime(),args,{cwd:root,windowsHide:true,detached:true,stdio:['ignore','ignore',stderrLog],env:workerEnv});}finally{closeSync(stderrLog);}
    activeRepairs.set(id,child);
    const completion=new Promise(resolve=>{
      child.on('error',()=>failed('无法启动 Python 修图程序').catch(error=>console.error(error.message)).finally(resolve));
      child.on('close',()=>failed(controller.signal.aborted?'修图任务已取消':'Python 修图程序异常退出，请重试或使用当前对话方式').catch(error=>console.error(error.message)).finally(resolve));
    });
    if(child.pid) {
      await writeFile(path.join(dir,'worker.json'),JSON.stringify({pid:child.pid,attemptId}),'utf8');
      try { await lease?.trackPid(child.pid); } catch(error) { stopChild(); await completion; throw error; }
    }
    await completion;
    if(controller.signal.aborted)throw Object.assign(new Error('修图任务已取消'),{name:'AbortError'});
  } catch(error) {
    if(controller.signal.aborted || error.name==='AbortError') {
      const status=await readAutomation(dir);
      if(status?.attemptId===attemptId)await writeAutomation(dir,{...queued,status:'cancelled',phase:'cancelled',message:'修图任务已取消'});
    } else await failed(error.message || '统一生图队列不可用，未启动新的生成');
  } finally {
    clearInterval(cancellationTimer);
    clearInterval(earlyTextTimer);
    controller.signal.removeEventListener('abort',stopChild);
    // Wrapper explicitly releases only after app-server children are stopped.
    // If this Node service dies first, recorded live Python/app-server PIDs keep
    // occupying the shared slot until safely reclaimed.
    if(lease)await lease.release(child ? {} : {completed:true}).catch(error=>console.error('统一队列释放待恢复：',error.message));
    if(activeRepairs.get(id)===child)activeRepairs.delete(id);
    archiveTask(id);
    try{await projects.attachJob(id);const request=await projects.job(id);if(request.regionId)projects.scheduleComposite(request.sourceId);}catch(error){console.error('项目接回失败：',error.message);}
  }
}
async function startRepair(id) {
  if (acceptingAttempts.has(id)) throw fail('这个任务正在采用结果，请稍后再生成', 409);
  if (repairStartLocks.has(id)) return repairStartLocks.get(id);
  const promise = startRepairLocked(id); repairStartLocks.set(id,promise);
  try { return await promise; } finally { repairStartLocks.delete(id); }
}

await mkdir(jobsDir, { recursive: true });
await mkdir(exportsDir, { recursive: true });
await mkdir(path.join(root,'sources'),{recursive:true});
await mkdir(path.join(root,'references'),{recursive:true});
await projects.initializeCompletedVersions();
await textReviews.recover((await readdir(jobsDir)).filter(validId));
// Waiting jobs survive a service restart. A detached worker can finish without its browser tab.
const recoveredWaiting=[];
for (const id of (await readdir(jobsDir)).filter(validId).sort()) {
  const dir = path.join(jobsDir,id), automation = await readAutomation(dir);
  if (['queued','running'].includes(automation?.status)) {
    const request=await projects.job(id);
    if(requiresTextReview(request)&&!await textReviews.confirmed(id,request)){await writeAutomation(dir,{...automation,status:'failed',phase:'text_confirmation_required',message:'服务重启时此任务尚未确认原文，请重新校对；未自动启动修图'});continue;}
    let worker;
    try { worker = JSON.parse(await readFile(path.join(dir,'worker.json'),'utf8')); } catch {}
    const alive = () => { try { if(worker?.attemptId!==automation.attemptId||!worker.pid)return false;process.kill(worker.pid,0);return true; } catch { return false; } };
    if (alive()) repairQueue.adopt(id, () => new Promise(resolve => {
      const timer = setInterval(async () => {
        try{const status = await readAutomation(dir);if(!(request.workflowVersion>=2))projects.attachEarlyText(id).catch(error=>console.error('早期文字接回失败：',error.message));
          if (status && !['queued','running'].includes(status.status)) { clearInterval(timer);await projects.attachJob(id);const request=await projects.job(id);if(request.regionId)projects.scheduleComposite(request.sourceId);resolve(); }
          else if (!alive()) { clearInterval(timer); await writeAutomation(dir,{...automation,status:'failed',phase:'failed',message:'修图进程已中断，可单独重试此任务'}); resolve(); }
        }catch(error){console.error(error.message);}
      },2000);
    }));
    else if(automation.status==='queued')recoveredWaiting.push({id,automation});
    else await writeAutomation(dir,{...automation,status:'failed',phase:'failed',message:'服务重启时修图进程已中断，可单独重试此任务'});
  }
}
for(const {id,automation} of recoveredWaiting)repairQueue.enqueue(id,()=>runRepair(id,automation));
for(const id of (await readdir(jobsDir)).filter(validId)){try{const request=await projects.job(id),automation=await readAutomation(path.join(jobsDir,id));if(request.regionId&&request.mode==='auto'&&!automation)await startRepair(id);else if(request.regionId&&(!automation||automation.status==='completed'&&!automation.projectAttached))projects.attachJob(id).catch(error=>console.error(error.message));}catch(error){if(error.code!=='ENOENT')throw error;}}
const guidePending=new Map();
function ensureGuide(dir){if(!guidePending.has(dir)){const work=runPageTool(root,['guide','--job',dir]).finally(()=>guidePending.delete(dir));guidePending.set(dir,work);}return guidePending.get(dir);}
const thumbnailPending=new Map(),thumbnailQueue=new RepairQueue(2);
async function jobThumbnail(id){
  if(thumbnailPending.has(id))return thumbnailPending.get(id);const promise=new Promise((resolve,reject)=>thumbnailQueue.enqueue(id,async()=>{try{const directory=path.join(jobsDir,id),result=await resultFile(directory);if(!result)throw fail('生成图尚未返回',404);const target=path.join(directory,'result-thumb.png'),stamp=path.join(directory,'result-thumb.json');try{const saved=JSON.parse(await readFile(stamp,'utf8'));if(saved.version===result.version&&existsSync(target)){resolve(target);return;}}catch{}const temporary=target+'.'+randomUUID()+'.tmp';try{await runPageTool(root,['job-thumb','--input',path.join(directory,result.name),'--out',temporary]);await replaceFile(temporary,target);await writeFile(stamp,JSON.stringify({version:result.version}),'utf8');resolve(target);}finally{await rm(temporary,{force:true});}}catch(error){reject(error);}}));thumbnailPending.set(id,promise);try{return await promise;}finally{thumbnailPending.delete(id);}
}

async function handleLocalTools(req,res,url){
 if(url.pathname==='/api/local-tools/history'&&req.method==='GET')return sendJSON(res,{items:localTools.list()});
 if(url.pathname==='/api/local-tools/status'&&req.method==='GET')return sendJSON(res,localTools.status());
 if(url.pathname==='/api/local-tools'&&req.method==='POST'){const input=await bodyJSON(req);if(input.selection||input.operation==='inpaint')throw fail('选框处理请从左侧去框或抠图入口打开',400);const meta=await sourceMetadata(root,input.sourceId);if(meta.deletedAt)throw fail('修图原图已删除',410);const exported=await exportPage(root,{sourceId:meta.id,sourceRevision:input.sourceRevision??meta.revision,layers:input.layers||[],sectionMode:input.sectionMode,pageSections:input.pageSections,pageGaps:input.pageGaps});return sendJSON(res,localTools.start({...input,input:exported.file}),202);}
 const open=url.pathname.match(/^\/api\/local-tools\/([a-f0-9-]{36})\/open$/);if(open&&req.method==='POST'){const input=await bodyJSON(req),task=localTools.get(open[1]),file=await localTools.validatedResult(open[1]);let name=String(input.name||'本地处理 · '+task.id.slice(0,8)).slice(0,200);if(task.sourceId&&!input.name){const original=await sourceMetadata(root,task.sourceId);name=original.name+(task.operation==='upscale'?' · 高清':' · 抠图');}const stream=createReadStream(file);stream.headers={'x-source-name':encodeURIComponent(name)};const meta=await importPage(stream,root);return sendJSON(res,{...meta,localTool:{taskId:task.id,operation:task.operation,model:task.model,scale:task.scale}},201);}
 const match=url.pathname.match(/^\/api\/local-tools\/([a-f0-9-]{36})(?:\/(result))?$/);if(match&&req.method==='GET'){if(match[2]){const file=await localTools.validatedResult(match[1]);res.writeHead(200,{'Content-Type':'image/png','Cache-Control':'no-store'});return pipeline(createReadStream(file),res);}return sendJSON(res,localTools.get(match[1]));}throw fail('本地任务不存在',404);
}

const handle=async (req,res)=>{
  try {
    if (![ `127.0.0.1:${port}`, `localhost:${port}` ].includes(req.headers.host)) throw fail('仅允许本地访问', 403);
    if (req.headers.origin && ![origin, `http://localhost:${port}`].includes(req.headers.origin)) throw fail('禁止跨站请求', 403);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'");
    const url = new URL(req.url, origin), pathname = decodeURIComponent(url.pathname);
    if(pathname.startsWith('/api/local-tools'))return handleLocalTools(req,res,url);
    if (pathname === '/api/health' && req.method === 'GET') return sendJSON(res, { ok: true, jobsDir, version: '0.8.18', displayVersion:'V18', workflowVersion:3,textReviewVersion:2, runtime:{node:process.execPath,python:pythonRuntime(),ocrPython:ocrRuntime(),temporaryDirectory:taskTempDir}, recognitionQueue:{running:textReviews.queue.running.size,waiting:textReviews.queue.waiting.size,concurrency:textReviews.queue.limit}, queue:{running:repairQueue.running.size,waiting:repairQueue.waiting.size,concurrency:repairQueue.limit} });
    if(pathname==='/api/prompt-presets'&&req.method==='GET')return sendJSON(res,await promptPresets.get());
    if(pathname==='/api/prompt-presets'&&req.method==='POST')return sendJSON(res,await promptPresets.save(await bodyJSON(req)));
    if(pathname==='/api/projects'&&req.method==='GET')return sendJSON(res,{projects:await projects.summaries(url.searchParams.get('deleted')==='1'),queue:{running:repairQueue.running.size,waiting:repairQueue.waiting.size,concurrency:repairQueue.limit}});
    if(pathname==='/api/storage'&&req.method==='GET')return sendJSON(res,storage.status());
    if(pathname==='/api/storage'&&req.method==='POST')return sendJSON(res,await storage.configure(await bodyJSON(req)));
    if(pathname==='/api/storage/folders'&&req.method==='GET')return sendJSON(res,await folderBrowser.list(url.searchParams.get('path')||''));
    if(pathname==='/api/storage/pick-folder'&&req.method==='POST')throw fail('文件夹选择器已更新，请刷新网页后重新选择，或直接填写目录路径。',409);
    if(pathname==='/api/storage/archive'&&req.method==='POST')return sendJSON(res,await storage.archive((await bodyJSON(req)).sourceId));
    const projectFileMatch=pathname.match(/^\/api\/sources\/([a-f0-9]{32})\/project-file$/);
    if(projectFileMatch&&['GET','POST'].includes(req.method)){
      const saved=await projectBundles.export(projectFileMatch[1]);if(req.method==='POST')return sendJSON(res,exportFolders.registerResult(saved),201);
      res.writeHead(200,{'Content-Type':'application/zip','Content-Length':saved.bytes,'Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(saved.name)}`,'Cache-Control':'no-store'});await pipeline(createReadStream(saved.file),res);return;
    }
    if(pathname==='/api/project-files'&&req.method==='POST'){const imported=await projectBundles.import(req);storage.background(storage.page(imported.sourceId));return sendJSON(res,imported,201);}
    const projectDownload=pathname.match(/^\/api\/project-files\/download\/([^/]+)$/);
    if(projectDownload&&req.method==='GET'){const name=projectDownload[1],file=await projectBundles.downloadFile(name);res.writeHead(200,{'Content-Type':'application/zip','Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(name)}`,'Cache-Control':'no-store'});await pipeline(createReadStream(file),res);return;}
    const extractMatch=pathname.match(/^\/api\/sources\/([a-f0-9]{32})\/extract-layer$/);
    if(extractMatch&&req.method==='POST')return sendJSON(res,await extractLayerPicture(root,{...await bodyJSON(req),sourceId:extractMatch[1]}),201);
    if(pathname==='/api/sources'&&req.method==='POST'){const page=await importPage(req,root);storage.background(storage.page(page.id));return sendJSON(res,page,201);}
    if(pathname==='/api/sources'&&req.method==='GET'){const dir=path.join(root,'sources');await mkdir(dir,{recursive:true});const pages=[];for(const id of (await readdir(dir)).filter(value=>/^[a-f0-9]{32}$/.test(value))){try{pages.push(await sourceMetadata(root,id));}catch(error){if(error.code!=='ENOENT')throw error;}}return sendJSON(res,pages.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)));}
    if(pathname==='/api/references'&&req.method==='POST'){const reference=await importReference(req,root);storage.background(storage.reference(reference.id));return sendJSON(res,reference,201);}
    if(pathname==='/api/references'&&req.method==='GET'){const dir=path.join(root,'references');await mkdir(dir,{recursive:true});const refs=[];for(const id of (await readdir(dir)).filter(value=>/^[a-f0-9]{32}$/.test(value))){try{const meta=JSON.parse(await readFile(path.join(dir,id,'metadata.json'),'utf8'));if(!!meta.deletedAt===(url.searchParams.get('deleted')==='1'))refs.push(meta);}catch(error){if(error.code!=='ENOENT')throw error;}}return sendJSON(res,refs.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)));}
    if(['/api/references/delete','/api/references/restore'].includes(pathname)&&req.method==='POST'){const body=await bodyJSON(req);if(!Array.isArray(body.ids)||body.ids.length>100||body.ids.some(id=>!/^[a-f0-9]{32}$/.test(id)))throw fail('参考图选择无效');for(const id of body.ids){const file=path.join(root,'references',id,'metadata.json'),meta=JSON.parse(await readFile(file,'utf8'));meta.deletedAt=pathname.endsWith('/delete')?new Date().toISOString():null;const temporary=file+'.'+randomUUID()+'.tmp';await writeFile(temporary,JSON.stringify(meta),'utf8');await replaceFile(temporary,file);}return sendJSON(res,{ok:true,count:body.ids.length});}
    const sourceApi=pathname.match(/^\/api\/sources\/([a-f0-9]{32})(?:\/(region|adopt|revision|project|delete|restore))?$/);
    if(sourceApi){
      const id=sourceApi[1],action=sourceApi[2];
      if(action==='restore'&&req.method==='POST')throw fail('项目现在直接删除，不再保留恢复副本',410);
      if(action==='delete'&&req.method==='POST')return sendJSON(res,await projects.deletePermanently(id,{cancelJobs:async jobs=>{
        for(const job of jobs){if(await textReviews.cancel(job.id,'项目已删除，文字识别或校对任务已取消'))continue;if(!['queued','running'].includes(job.automation?.status))continue;const dir=path.join(jobsDir,job.id);if(repairQueue.cancel(job.id))await writeAutomation(dir,{...job.automation,status:'cancelled',phase:'cancelled',message:'项目已删除，排队任务已取消'});else await writeFile(path.join(dir,'cancel-requested.json'),JSON.stringify({attemptId:job.automation.attemptId}),'utf8');}
        const started=Date.now();while(jobs.some(job=>repairQueue.running.has(job.id)||repairStartLocks.has(job.id)||acceptingAttempts.has(job.id)||textReviews.queue.running.has(job.id)||textReviews.locks.has(job.id))){if(Date.now()-started>30000)throw fail('任务正在取消，请稍后重试删除',409);await new Promise(resolve=>setTimeout(resolve,100));}
      }}));
      if(!action&&req.method==='GET'){const meta=await sourceMetadata(root,id);if(!meta.deletedAt)void prepareDisplayCache(root,meta).catch(()=>{});return sendJSON(res,meta);}
      if(action==='project'){if(req.method==='GET')return sendJSON(res,await projects.get(id));if(req.method==='POST'){const saved=await projects.save(id,await bodyJSON(req));return sendJSON(res,{ok:true,version:saved.version,project:saved});}}
      if(action==='adopt'&&req.method==='POST')return sendJSON(res,await adoptPage(root,id,await bodyJSON(req),png));
      if(action==='revision'&&req.method==='POST')return sendJSON(res,await setPageRevision(root,id,(await bodyJSON(req)).revision));
      if(action==='region'&&req.method==='GET'){const file=await makeRegion(root,id,url.searchParams);res.writeHead(200,{'Content-Type':'image/png','Cache-Control':'private, max-age=31536000'});await pipeline(createReadStream(file),res);return;}
    }
    if (pathname === '/api/codex/status' && req.method === 'GET') return sendJSON(res, await probeCodex(url.searchParams.get('fresh') === '1'));
    if(pathname==='/api/exports/open-folder'&&req.method==='POST')return sendJSON(res,await exportFolders.open((await bodyJSON(req)).folderToken));
    if (pathname === '/api/exports' && req.method === 'POST') {
      const body = await bodyJSON(req);if(body.exportMode&&!['repaired','original'].includes(body.exportMode))throw fail('导出模式无效');
      if(body.sourceId){const saved=await exportPage(root,body);saved.archivePath=await storage.export(saved.file,await sourceMetadata(root,body.sourceId));return sendJSON(res,exportFolders.registerResult(saved),201);}
      const payload = png(body.image);
      const label = String(body.sourceName || 'image').replace(/\.[^.]+$/, '').replace(/[^\p{L}\p{N} _-]/gu, '-').slice(0,80) || 'image';
      const name = `${label}-${body.exportMode==='original'?'原图':'修复'}-${Date.now()}-${randomUUID().slice(0,8)}.png`;
      const file = path.join(exportsDir, name); await writeFile(file, payload.bytes);
      {const base=file+'.base.png';try{await copyFile(file,base);await composeLayers(root,base,file,body.exportMode==='original'?[]:body.layers||[],6);}finally{await rm(base,{force:true});}}
      const archivePath=await storage.export(file,{sourceName:body.sourceName});return sendJSON(res,exportFolders.registerResult({ ok: true, file, archivePath, name,lossless:true,compressionLevel:6, url: `/exports/${encodeURIComponent(name)}` }),201);
    }
    if (pathname === '/api/jobs' && req.method === 'POST') {
      const body = await bodyJSON(req);
      if(body.sourceId){const job=await regionSubmissions.run(body,async()=>{await assertNoReviewAttempt(body);let prepared=await prepareJob(body);if(prepared.autoText===true||prepared.separateBubble===true)prepared={...prepared,...await textReviews.ensureWorkflow(prepared.id)};try{await projects.bindJob(prepared);}catch(error){await writeAutomation(path.join(jobsDir,prepared.id),{jobId:prepared.id,status:'cancelled',phase:'cancelled',message:'任务未提交，裁图准备已取消'});throw error;}archiveTask(prepared.id);if(prepared.regionId&&prepared.mode==='auto')prepared.automation=await startRepair(prepared.id);return prepared;});return sendJSON(res,job,201);}
      const { crop, original, mask } = body;
      if (!crop || !original || !['x','y','width','height'].every(key => Number.isInteger(crop[key])) || !['width','height'].every(key => Number.isInteger(original[key]))) throw fail('缺少原图坐标');
      if (original.width <= 0 || original.height <= 0 || original.width * original.height > 40_000_000 || crop.width <= 0 || crop.height <= 0 || crop.x < 0 || crop.y < 0 || crop.x + crop.width > original.width || crop.y + crop.height > original.height) throw fail('局部坐标无效');
      if (typeof body.prompt !== 'string' || !body.prompt.trim() || body.prompt.length > 12000) throw fail('请输入修图要求');
      const image = png(body.image), apiMask = png(mask), guide = png(body.guide), base = png(body.base);
      for (const item of [image, apiMask, guide]) if (item.width !== crop.width || item.height !== crop.height) throw fail('任务图片尺寸不一致');
      if (base.width !== original.width || base.height !== original.height) throw fail('原图尺寸不一致');
      const id = new Date().toISOString().replace(/[-:T]/g, '').slice(0,14).replace(/^(\d{8})(\d{6})$/, '$1-$2') + '-' + randomUUID().slice(0, 8);
      await validateReferenceIds(root,body.references);
      const dir = path.join(jobsDir, id); await mkdir(dir);
      try {
      const request = { generationMode:body.generationMode==='configured'?'configured':'low',schemaVersion: 1, id, createdAt: new Date().toISOString(), editorKey:String(body.editorKey||'').slice(0,100), mode:body.mode, label:String(body.label||'').slice(0,200), sourceName: String(body.sourceName || 'image').slice(0, 200), sourceRevision: body.sourceRevision, original, crop, frame:body.frame, aspectRatio:body.aspectRatio, featherMode:body.featherMode||'gaussian', feather: body.feather, sourceHash: createHash('sha256').update(base.bytes).digest('hex'), prompt: body.prompt, expectedResult: 'repaired.png', resultScope: 'context-crop', instructions: 'Edit crop.png using guide.png as a location reference. Keep the original framing, perspective and style. Return the entire crop at the same aspect ratio. Save the result as repaired.png in this directory. The app composites only the stored human mask with feathering.' };
      await writeFile(path.join(dir, 'crop.png'), image.bytes);
      await writeFile(path.join(dir, 'mask.png'), apiMask.bytes);
      await writeFile(path.join(dir, 'guide.png'), guide.bytes);
      await writeFile(path.join(dir, 'base.png'), base.bytes);
      request.referenceFiles=await copyReferences(root,dir,body.references);
      await writeFile(path.join(dir, 'prompt.txt'), body.prompt, 'utf8');
      await writeFile(path.join(dir, 'request.json'), JSON.stringify(request, null, 2), 'utf8');
      archiveTask(id);
      return sendJSON(res, { ...request, folder: dir, result: null }, 201);
      } catch (error) { await removeJobDir(root, dir); throw error; }
    }
    if (pathname === '/api/jobs' && req.method === 'GET') {
      const names = (await readdir(jobsDir)).filter(validId).sort().reverse();
      const jobs = [], index = new Map((await projects.jobIndex()).map(job => [job.id, job]));
      for (const id of names) {
        // Filter on the light index first; only matching jobs load their full request.
        const light = index.get(id); if (!light) continue;
        if (url.searchParams.has('sourceId') && light.sourceId !== url.searchParams.get('sourceId')) continue;
        if (url.searchParams.has('editorKey') && light.editorKey !== url.searchParams.get('editorKey')) continue;
        try { const request = await projects.job(id); if(url.searchParams.has('sourceId')&&request.sourceId!==url.searchParams.get('sourceId'))continue;if(url.searchParams.has('editorKey')&&request.editorKey!==url.searchParams.get('editorKey'))continue;const earlyText=request.workflowVersion>=2?null:await projects.earlyTextForJob(id).catch(error=>{console.error('早期文字读取失败：',error.message);return null;});let receiveError=null;const result=await resultFile(path.join(jobsDir,id),{request,automation:light.automation}).catch(error=>{if(error.code!=='ENOENT')receiveError=error.message;return null;}),job={ ...request, folder:path.join(jobsDir,id),result,receiveError,automation:light.automation,earlyText }; jobs.push(job); archiveIfChanged(id,job);if(jobs.length>=200)break; }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
      return sendJSON(res, jobs);
    }
    const thumbMatch=pathname.match(/^\/api\/jobs\/([^/]+)\/thumbnail$/);
    if(thumbMatch&&req.method==='GET'){if(!validId(thumbMatch[1]))throw fail('任务不存在',404);const file=await jobThumbnail(thumbMatch[1]);res.writeHead(200,{'Content-Type':'image/png','Cache-Control':'private, max-age=31536000'});await pipeline(createReadStream(file),res);return;}
    const reviewMatch=pathname.match(/^\/api\/jobs\/([^/]+)\/text-review(?:\/(confirm|draft|refine))?$/);
    if(reviewMatch){const id=reviewMatch[1],action=reviewMatch[2];if(!validId(id))throw fail('任务不存在',404);
      if(!action&&req.method==='GET')return sendJSON(res,await textReviews.read(id));
      if(action&&req.method==='POST'){if(acceptingAttempts.has(id))throw fail('这个任务正在采用结果，请稍后再校对',409);const body=await bodyJSON(req);
        if(action==='draft')return sendJSON(res,await textReviews.saveDraft(id,body));
        if(action==='refine'){const status=await probeCodex(false,{allowStale:true});if(!status.loggedIn)throw fail('Codex 尚未登录，无法视觉复核；可以先手工校对',409);return sendJSON(res,await textReviews.refine(id,body),202);}
        const status=await probeCodex(false,{allowStale:true});if(!status.ready)throw fail(status.error||'Codex 生图连接尚未就绪；确认内容仍保留在校对窗口',409);
        return sendJSON(res,await textReviews.confirm(id,body),202);
      }
    }
    const repairMatch = pathname.match(/^\/api\/jobs\/([^/]+)\/(repair|cancel)$/);
    if (repairMatch && req.method === 'POST') {
      const id = repairMatch[1]; if (!validId(id)) throw fail('任务不存在', 404);
      if (repairMatch[2] === 'repair') {
        const request=await projects.job(id);await validateRepairRequest(request);
        const previous=await readAutomation(path.join(jobsDir,id));
        if(['queued','running'].includes(previous?.status)||request.separateBubble!==true&&TEXT_REVIEW_STATUSES.has(previous?.status)||(previous?.status==='completed'&&request.autoText!==true&&request.separateBubble!==true&&existsSync(path.join(jobsDir,id,'repaired.png'))))return sendJSON(res,{ok:true,automation:previous},202);
        const automation=await regionSubmissions.run(request,async()=>{
          await assertNoReviewAttempt(request,id);
          if(request.autoText===true&&request.separateBubble!==true&&(!await textReviews.confirmed(id,request)||request.workflowVersion!==2))return startRepair(id);
          const status=await probeCodex(false,{allowStale:true});
          if(!status.ready)throw fail(status.error||(!status.loggedIn?'本地 Codex CLI 未使用 ChatGPT 登录，请在本机完成 codex login':'当前 Codex 没有启用内置生图能力'),409);
          return startRepair(id);
        });
        return sendJSON(res,{ok:true,automation},202);
      }
      const dir = path.join(jobsDir,id), automation = await readAutomation(dir);
      if(await textReviews.cancel(id))return sendJSON(res,{ok:true});
      if (automation && ['running','queued'].includes(automation.status)) {
        if(repairQueue.cancel(id))await writeAutomation(dir,{...automation,status:'cancelled',phase:'cancelled',message:'已取消排队任务'});
        else await writeFile(path.join(dir,'cancel-requested.json'), JSON.stringify({attemptId:automation.attemptId}), 'utf8');
      }
      return sendJSON(res, {ok:true});
    }
    const attemptPreview=pathname.match(/^\/api\/jobs\/([^/]+)\/attempt-preview\/(repaired|bubbles)$/);
    if(attemptPreview&&req.method==='GET'){
      const id=attemptPreview[1];if(!validId(id))throw fail('任务不存在',404);
      const dir=path.join(jobsDir,id),automation=await readAutomation(dir),attemptId=automation?.attemptId;
      if(automation?.phase!=='visual_review_rejected'||automation.publishable!==true||!/^[a-f0-9]{32}$/.test(attemptId||''))throw fail('没有待人工检查的结果',404);
      if(url.searchParams.has('attempt')&&url.searchParams.get('attempt')!==attemptId)throw fail('任务结果已更新，请重新打开预览',409);
      const attempt=path.join(dir,'attempts',attemptId),file=path.join(attempt,attemptPreview[2]==='bubbles'?'bubble-sheet.png':'resized_patch.png');
      for(const item of [dir,path.join(dir,'attempts'),attempt,file])if((await lstat(item)).isSymbolicLink())throw fail('结果预览路径无效',404);
      res.writeHead(200,{'Content-Type':'image/png','Cache-Control':'no-store'});await pipeline(createReadStream(file),res);return;
    }
    const acceptMatch = pathname.match(/^\/api\/jobs\/([^/]+)\/accept-attempt$/);
    if (acceptMatch && req.method === 'POST') {
      const id = acceptMatch[1]; if (!validId(id)) throw fail('任务不存在', 404);
      const dir = path.join(jobsDir, id), request = await projects.job(id); await validateRepairRequest(request);
      // The worker writes its verdict before its Codex processes finish closing; give it a moment.
      for (const started = Date.now(); repairQueue.running.has(id) && Date.now() - started < 15000;) await new Promise(resolve => setTimeout(resolve, 200));
      if (repairQueue.has(id) || repairStartLocks.has(id) || textReviews.queue.has(id)) throw fail('这个任务正在处理，请稍后再采用', 409);
      const automation = await readAutomation(dir);
      if (automation?.phase !== 'visual_review_rejected' || automation.publishable !== true) throw fail('这个任务没有可直接采用的结果', 409);
      if(acceptingAttempts.has(id))throw fail('这个任务正在采用结果，请稍后再试',409);
      acceptingAttempts.add(id);
      try {
        const result=await regionSubmissions.run(request,async()=>{
          await validateRepairRequest(request);
          if(repairQueue.has(id)||repairStartLocks.has(id)||textReviews.queue.has(id)||textReviews.locks.has(id))throw fail('这个任务正在处理，请稍后再采用',409);
          try { await runPageTool(root, ['accept-attempt', '--job', dir]); } catch (error) { throw fail(error.message, 409); }
          archiveTask(id);
          try { await projects.attachJob(id); if (request.regionId) projects.scheduleComposite(request.sourceId); } catch (error) { console.error('项目接回暂未完成：', error.message); }
          return {ok: true, automation: await readAutomation(dir)};
        });
        return sendJSON(res,result);
      } finally { acceptingAttempts.delete(id); }
    }
    const resultMatch = pathname.match(/^\/api\/jobs\/([^/]+)\/result$/);
    if (resultMatch && req.method === 'POST') {
      const id = resultMatch[1]; if (!validId(id)) throw fail('任务不存在', 404);
      const dir = path.join(jobsDir, id); await stat(path.join(dir, 'request.json'));
      const payload = png((await bodyJSON(req)).image);
      const temp = path.join(dir, `result-${randomUUID()}.tmp`);
      await writeFile(temp, payload.bytes); await rename(temp, path.join(dir, 'repaired.png'));
      const info = await stat(path.join(dir, 'repaired.png'));
      archiveTask(id);
      return sendJSON(res, { ok: true, version: `${info.size}-${info.mtimeMs}` });
    }
    const fileMatch = pathname.match(/^\/jobs\/([^/]+)\/(crop\.png|bubble-(?:[1-9]|1[0-2])\.png|mask\.png|guide\.png|annotation\.png|image\.png|layer-mask\.png|base\.png|patch\.png|repaired_page\.png|prompt\.txt|request\.json|repaired\.(?:png|webp|jpg))$/);
    let target;
    const sourceAsset=pathname.match(/^\/sources\/([a-f0-9]{32})\/(metadata\.json|original\.png|thumb\.png|(?:preview|revision)-\d+\.png)$/);
    const projectAsset=pathname.match(/^\/project-assets\/([a-f0-9]{32})\/([a-f0-9]{64}\.png)$/);
    const projectFont=pathname.match(/^\/project-fonts\/([a-f0-9]{32})\/([a-f0-9]{64}\.(?:otf|ttf|ttc|woff2))$/);
    const referenceAsset=pathname.match(/^\/references\/([a-f0-9]{32})\/reference\.png$/);
    if (fileMatch && validId(fileMatch[1])){target=path.join(jobsDir,fileMatch[1],fileMatch[2]);if(fileMatch[2]==='base.png'&&!existsSync(target))target=await jobBaseFile(root,await projects.job(fileMatch[1]));if(fileMatch[2]==='guide.png'&&!existsSync(target))await ensureGuide(path.join(jobsDir,fileMatch[1]));}
    else if(projectAsset){const meta=await sourceMetadata(root,projectAsset[1]);if(meta.deletedAt)throw fail('项目已删除，图片不再可用',410);target=await assetFile(root,projectAsset[1],projectAsset[2]);}
    else if(projectFont){const meta=await sourceMetadata(root,projectFont[1]);if(meta.deletedAt)throw fail('项目已删除，字体不再可用',410);target=path.join(root,'project-fonts',projectFont[1],projectFont[2]);for(const entry of [path.join(root,'project-fonts'),path.dirname(target),target])if((await lstat(entry)).isSymbolicLink())throw fail('工程字体路径无效');const fontInfo=await lstat(target);if(!fontInfo.isFile()||fontInfo.size>64*1024*1024)throw fail('工程字体文件无效');}
    else if(sourceAsset){target=path.join(root,'sources',sourceAsset[1],sourceAsset[2]);const preview=/^preview-(\d+)\.png$/.exec(sourceAsset[2]);if((preview||sourceAsset[2]==='thumb.png')&&!existsSync(target))await projectBundles.preparePreview(sourceAsset[1],preview?Number(preview[1]):0);}
    else if(referenceAsset)target=path.join(root,'references',referenceAsset[1],'reference.png');
    else if (/^\/exports\/[\p{L}\p{N} _-]+\.png$/u.test(pathname)) target = path.join(exportsDir, pathname.slice('/exports/'.length));
    else if (/^\/fonts\/(?:[A-Za-z0-9_.-]+\.(?:ttf|otf|woff2|html|json)|licenses\/[a-z0-9-]+\/[A-Za-z0-9_.-]+)$/.test(pathname)) target=path.join(publicDir,pathname.slice(1));
    else if (/^\/icons\/[a-z-]+\.svg$/.test(pathname)) target=path.join(publicDir,pathname.slice(1));
    else if (['/', '/index.html', '/styles.css', '/font-credits.css', '/app.mjs', '/compare-view.mjs', '/selection-menu.mjs', '/image-resize.mjs', '/text-frame.mjs', '/early-text.mjs', '/text-review.mjs', '/editor-shortcuts.mjs', '/repair-workflow.mjs', '/page-layout.mjs', '/page-sections.mjs', '/layout-followers.mjs', '/image-layer.mjs', '/core.mjs', '/page-view.mjs', '/layers.mjs', '/layer-geometry.mjs', '/mask-edits.mjs', '/annotations.mjs', '/tasks.mjs', '/repair-items.mjs', '/repair-versions.mjs', '/affine-links.mjs', '/editor-tools.mjs', '/quick-repair.mjs', '/layer-selection.mjs', '/folder-picker.mjs', '/text-fonts.mjs', '/text-layout.mjs', '/region-coordinates.mjs', '/selection-resize.mjs', '/background-fill.mjs', '/layer-operations.mjs', '/font-catalog.mjs', '/history.mjs', '/integrated.css', '/embedded-tools.mjs', '/demo.svg'].includes(pathname)) target = path.join(publicDir, pathname === '/' ? 'index.html' : pathname.slice(1));
    else throw fail('文件不存在', 404);
    if (req.method !== 'GET' && req.method !== 'HEAD') throw fail('不支持的请求', 405);
    const info = await stat(target);
    res.writeHead(200, { 'Content-Type': mime[path.extname(target)] || 'application/octet-stream', 'Cache-Control': projectAsset?'private, max-age=31536000, immutable':/^\/fonts\/.+\.(?:ttf|otf|woff2)$/.test(pathname)?'public, max-age=31536000, immutable':'no-store','Content-Length':info.size });
    if(req.method==='HEAD')res.end();else await pipeline(createReadStream(target),res);
  } catch (error) {
    if (!res.headersSent) sendJSON(res, { error: error.code === 'ENOENT' ? '文件不存在' : error.code==='ENOSPC'?'磁盘空间不足，请释放空间或更换保存目录后重试':error.message }, error.statusCode || (error.code === 'ENOENT' ? 404 : 500));
    else res.end();
  }
};
return {handle,running:()=>repairQueue.running.size+repairQueue.waiting.size+textReviews.queue.running.size+textReviews.queue.waiting.size,close(){},projects,root};
}
