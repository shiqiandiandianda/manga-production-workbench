import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {createHash} from 'node:crypto';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {ProjectCenter, check, id} from './project-center.mjs';
import {paths} from './paths.mjs';
import {createFormalBridge} from './formal-bridge.mjs';
import {recordSnapshot} from './project-snapshots.mjs';
import {compressEngineeringBatch} from './compact-engineering.mjs';
import {teamBridge} from './team-bridge.mjs';
import {projectUploads} from './project-uploads.mjs';
import {fileToText} from './script-library.mjs';
import {localAddresses} from './hub-api.mjs';

export async function registerProjectCenter(ctx) {
  const core = new ProjectCenter(path.join(paths.data, 'project-center'));
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const {createCenter} = await import(pathToFileURL(path.join(root, 'center/server.mjs')).href);
  const formal = createCenter({dataDir: path.join(core.directory, 'formal-versions')});
  await new Promise((resolve, reject) => { formal.server.once('error', reject); formal.server.listen(0, '127.0.0.1', resolve); });
  const formalPort = formal.server.address().port;
  const formalBridge = createFormalBridge(core,formal);
  const team=teamBridge();
  const uploads=projectUploads(core);
  const routes = [];
  const actor = r => r.token?.record;
  function allow(r, projectId) {
    const a = actor(r); check(!a?.projectIds?.length || a.projectIds.includes(projectId), '无此项目访问权限', 403); core.get('project', projectId);
  }
  function route(method, pattern, fn, scope = method === 'GET' ? 'read' : 'intake') {
    routes.push({method, pattern, options: {scope}, handler: async r => {
      const origin = r.headers.origin;
      if (method !== 'GET' && origin && origin !== 'http://' + r.headers.host && origin !== 'https://' + r.headers.host) check(!r.loopback || !!r.headers.authorization, '本机写入不接受其他站点的匿名请求', 403);
      return fn(r);
    }});
  }
  const body = r => r.json(48 * 1024 * 1024);
  async function ensureLocalFile(f){
    if(fs.existsSync(f.path))return;
    check(f.storageBackup,'原件没有可恢复的墨库备份',404);
    let port=18909;try{port=Number(JSON.parse(fs.readFileSync(process.env.COMIC_SERVICE_FILE||path.resolve(core.directory,'../../comic-service.local.json'),'utf8')).port)||port;}catch{}
    const response=await fetch('http://127.0.0.1:'+port+'/api/storage-maintenance/restore-center',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({fileId:f.id}),signal:AbortSignal.timeout(180000)});
    const result=await response.json();check(response.ok&&result.ok&&fs.existsSync(f.path),result.error||'墨库原件恢复失败，保留原版本引用',503);
  }
  const exposeFile = ({path: _path, ...f}) => ({...f, contentUrl: '/api/v1/files/' + f.id + '/content'});
  route('POST',/^\/api\/v1\/projects\/([^/]+)\/uploads$/,async r=>{allow(r,r.params[0]);return {body:uploads.start(r.params[0],await body(r),actor(r)?.id||'local')};});
  route('PUT',/^\/api\/v1\/projects\/([^/]+)\/uploads\/([^/]+)\/chunks\/(\d+)$/,async r=>{const bytes=await r.raw(8*1024*1024);allow(r,r.params[0]);return {body:uploads.chunk(r.params[0],r.params[1],Number(r.params[2]),bytes,actor(r)?.id||'local')};});
  route('POST',/^\/api\/v1\/projects\/([^/]+)\/uploads\/([^/]+)\/complete$/,async r=>{allow(r,r.params[0]);return {body:exposeFile(await uploads.complete(r.params[0],r.params[1],actor(r)?.id||'local'))};});
  route('GET', /^\/api\/v1\/center\/status$/, async r => ({body: {application: 'project-production-center', version: '3.0.0', projects: core.list('project').length,...(r.loopback?{dataRoot:paths.data,codeRoot:paths.root}: {})}}));
  route('POST',/^\/api\/v1\/storage\/compact$/,async r=>{check(r.loopback,'仅允许本机维护',403);return {body:compressEngineeringBatch(core,await body(r))};});
  route('GET',/^\/api\/v1\/storage\/status$/,async r=>{check(r.loopback,'仅允许本机维护',403);const seen=new Set();let bytes=0;for(const row of core.list('file'))if(!seen.has(row.path)&&fs.existsSync(row.path)){seen.add(row.path);bytes+=fs.statSync(row.path).size;}return {body:{bytes,files:seen.size,directory:core.directory}};});
  route('GET',/^\/api\/v1\/storage\/inventory$/,async r=>{check(r.loopback,'仅允许本机维护',403);return {body:{directory:core.directory,files:core.list('file').map(f=>({...f,projectTitle:core.get('project',f.projectId).title,localProjectId:core.get('project',f.projectId).externalKey||''}))}};});
  route('GET',/^\/api\/v1\/storage\/file\/([^/]+)$/,async r=>{check(r.loopback,'仅允许本机维护',403);return {body:{directory:core.directory,file:core.get('file',r.params[0])}};});
  route('POST',/^\/api\/v1\/storage\/evict$/,async r=>{check(r.loopback,'仅允许本机维护',403);const input=await body(r);check(Array.isArray(input.files)&&input.files.length<=20,'每批最多20份归档文件');let files=0,bytes=0;
    check(!core.list('task').some(t=>['queued','claimed','running','uncertain'].includes(t.status)),'项目中心有任务，暂缓清理');
    for(const item of input.files){const f=core.get('file',item.id);if(!fs.existsSync(f.path))continue;
      check(typeof item.backup?.revisionId==='string'&&/^[a-f0-9-]{36}$/i.test(item.backup.revisionId)&&/^[a-f0-9]{64}$/.test(item.backup.sha256||'')&&/^[a-f0-9]{64}$/.test(item.sha256||''),'缺少已验证的固定备份');
      const real=fs.realpathSync(f.path),relative=path.relative(core.directory,real);check(relative.startsWith('projects'+path.sep)&&!relative.split(path.sep).includes('..')&&!fs.lstatSync(f.path).isSymbolicLink(),'归档路径不在本机工程目录');
      const stat=fs.statSync(f.path);if(files&&bytes+stat.size>50*1024*1024)break;
      const sha=createHash('sha256').update(fs.readFileSync(f.path)).digest('hex');if(sha!==item.sha256)continue;
      let port=18909;try{port=Number(JSON.parse(fs.readFileSync(process.env.COMIC_SERVICE_FILE||path.resolve(core.directory,'../../comic-service.local.json'),'utf8')).port)||port;}catch{}
      const verified=await fetch('http://127.0.0.1:'+port+'/api/storage-maintenance/verify-backup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({backup:item.backup,entrySha256:sha}),signal:AbortSignal.timeout(15000)}).then(x=>x.json());
      check(verified.ok,'缺少可核对的墨库备份回执，原件保留');
      core.tx(()=>{for(const record of core.list('file').filter(x=>x.path===f.path))core.put('file',{...record,storageBackup:{...item.backup,entry:'objects/'+sha,fileSha256:sha,fileBytes:stat.size},storageEvicted:true});});
      fs.unlinkSync(f.path);files++;bytes+=stat.size;
    }return {body:{files,bytes}};
  });
  route('GET', /^\/api\/v1\/projects$/, async r => ({body: {projects: core.list('project').filter(p => !actor(r)?.projectIds?.length || actor(r).projectIds.includes(p.id))}}));
  route('POST', /^\/api\/v1\/projects$/, async r => {
    const input = await body(r); check(!actor(r)?.projectIds?.length, '受限工具不能创建新项目', 403);
    const existing = input.externalKey && core.list('project').find(p => p.externalKey === input.externalKey);
    if (existing) return {body: {...existing, duplicate: true}};
    const p = core.createProject(input); if (input.externalKey) { p.externalKey = String(input.externalKey).slice(0, 180); core.put('project', p); } return {status: 201, body: p};
  });
  route('GET', /^\/api\/v1\/projects\/([^/]+)$/, async r => { const [p] = r.params; allow(r, p); const d = core.dashboard(p); d.files = d.files.map(exposeFile); return {body: d}; });
  route('GET', /^\/api\/v1\/projects\/([^/]+)\/team-queue$/,async r=>{allow(r,r.params[0]);return {body:await team.queue(core.get('project',r.params[0]))};});
  route('POST', /^\/api\/v1\/projects\/([^/]+)\/access-tokens$/, async r => {
    const [p] = r.params; allow(r, p); check(r.loopback || actor(r)?.scopes.includes('admin'), '只有本机管理员可发放接入权限', 403);
    const input = await body(r); const scopes=input.scopes||['read','intake'],projectIds=input.projectIds||[p];check(Array.isArray(projectIds)&&projectIds.length>0&&projectIds.length<=100,'接入项目无效');for(const key of projectIds)allow(r,key);check(scopes.every(s=>['read','intake','write'].includes(s)),'项目接入权限无效');const grant=await ctx.tokens.create({label: input.label, scopes, projectIds}),addresses=(await localAddresses()).sort((a,b)=>Number(/virtual|vmnet|vethernet|vpn|tun|tap/i.test(a.name))-Number(/virtual|vmnet|vethernet|vpn|tun|tap/i.test(b.name)));const host=r.loopback?(addresses.find(a=>/^192\.168\./.test(a.address))||addresses[0])?.address:r.url.hostname;return {status: 201, body:{...grant,hub:host?'http://'+host+':'+(await ctx.config.read()).port:r.url.origin,projectIds}};
  }, 'write');
  route('GET', /^\/api\/v1\/projects\/([^/]+)\/files$/, async r => { allow(r, r.params[0]); return {body: {files: core.list('file', r.params[0]).map(exposeFile)}}; });
  route('POST', /^\/api\/v1\/projects\/([^/]+)\/files$/, async r => {
    const [p] = r.params; allow(r, p); let input, bytes;
    if (String(r.headers['content-type']).includes('multipart/form-data')) { const m = await r.multipart(128 * 1024 * 1024); const f = m.file('file'); check(f, '请选择文件'); input = {name: f.filename, mime: f.contentType, type: m.field('type') || 'original'}; bytes = f.data; }
    else if (String(r.headers['content-type']).includes('application/json')) { input = await body(r); bytes = Buffer.from(String(input.data || '').replace(/^data:[^,]+,/, ''), 'base64'); }
    else { input = {name: r.url.searchParams.get('name'), type: r.url.searchParams.get('type'), mime: r.headers['content-type']}; bytes = await r.raw(128 * 1024 * 1024); }
    return {status: 201, body: exposeFile(core.upload(p, input, bytes))};
  });
  route('GET', /^\/api\/v1\/files\/([^/]+)\/content$/, async r => { const f = core.get('file', r.params[0]); allow(r, f.projectId);await ensureLocalFile(f); return {file: {path: f.path, mime: f.mime,bytes:f.bytes,encoding:f.storageEncoding,downloadName: f.name,inline:/^image\/(png|jpeg|webp|gif)$/.test(f.mime)}, headers: {'X-Content-Type-Options': 'nosniff','Content-Security-Policy':"sandbox; default-src 'none'"}, cacheControl: 'private, no-cache'}; });
  route('POST', /^\/api\/v1\/projects\/([^/]+)\/scripts\/import$/, async r => {
    const [p] = r.params; allow(r, p); const input = await body(r), f = core.get('file', input.fileId, p);
    const imported = await ctx.scripts.importFile({fileName: f.name, bytes: fs.readFileSync(f.path), title: input.title || f.name});
    const derived = core.upload(p, {name: f.name + '.parsed.json', type: 'parsed-script', mime: 'application/json', sourceId: f.id}, Buffer.from(JSON.stringify(imported)));
    return {body: {script: imported, file: exposeFile(derived)}};
  });
  route('POST', /^\/api\/v1\/projects\/([^/]+)\/standards\/drafts$/, async r => { allow(r, r.params[0]); return {status: 201, body: core.draft(r.params[0], await body(r))}; }, 'write');
  route('POST',/^\/api\/v1\/projects\/([^/]+)\/standards\/import$/,async r=>{const [p]=r.params;allow(r,p);const input=await body(r),file=core.get('file',input.fileId,p),bytes=fs.readFileSync(file.path);let draft;if(/\.json$/i.test(file.name)){const parsed=JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,''));draft=core.draft(p,{rules:parsed.rules||parsed,sourceFileIds:[file.id]});}else{const text=fileToText({fileName:file.name,bytes});const rules={visual:{description:'以下为项目原始规范，需核对并补全结构化字段：\n'+text.slice(0,12000)}};const width=/(?:画布|画板|页面|漫画)宽(?:度)?[^\d]{0,12}(\d{3,5})/.exec(text);if(width)rules.layout={pageWidth:Number(width[1])};draft=core.draft(p,{rules,sourceFileIds:[file.id],notes:text});}return {body:{draft,requiresReview:true,message:'已读取规范原件并建立草稿；请核对字体、排版与风格字段后发布。'}};},'write');
  route('GET', /^\/api\/v1\/projects\/([^/]+)\/standards\/current$/, async r => { allow(r, r.params[0]); return {body: core.standards(r.params[0])}; });
  route('POST', /^\/api\/v1\/projects\/([^/]+)\/standards\/([^/]+)\/publish$/, async r => { const [p, key] = r.params; allow(r, p); return {body: core.publish(p, key, (await body(r)).expectedRevision)}; }, 'write');
  route('POST', /^\/api\/v1\/projects\/([^/]+)\/asset-requests$/, async r => { allow(r, r.params[0]); return {status: 202, body: core.requestAsset(r.params[0], await body(r))}; });
  route('POST', /^\/api\/v1\/projects\/([^/]+)\/versions\/([^/]+)\/approve$/, async r => { const [p, key] = r.params; allow(r, p); return {body: core.approve(p, key, await body(r))}; }, 'write');
  route('POST',/^\/api\/v1\/projects\/([^/]+)\/versions\/([^/]+)\/reject$/,async r=>{const[p,key]=r.params;allow(r,p);const input=await body(r),v=core.get('version',key,p);check(v.status==='review','只能退回待审核候选',409);v.status='rejected';v.reason=String(input.reason||'人工退回').slice(0,2000);core.put('version',v);const t=core.get('task',v.taskId,p);t.status='failed';t.message=v.reason;core.put('task',t);core.event(p,'asset.rejected',{versionId:v.id,reason:v.reason});return {body:v};},'write');
  route('POST', /^\/api\/v1\/projects\/([^/]+)\/bindings$/, async r => { allow(r, r.params[0]); return {body: core.bind(r.params[0], await body(r))}; }, 'write');
  route('POST', /^\/api\/v1\/projects\/([^/]+)\/progress$/, async r => { allow(r, r.params[0]); return {body: core.progress(r.params[0], await body(r))}; });
  route('POST', /^\/api\/v1\/projects\/([^/]+)\/comic-snapshots$/,async r=>{allow(r,r.params[0]);return {body:recordSnapshot(core,r.params[0],await body(r))};});
  route('PATCH', /^\/api\/v1\/projects\/([^/]+)$/,async r=>{allow(r,r.params[0]);const p=core.get('project',r.params[0]),input=await body(r);if(input.defaultExecutor!==undefined){check(['local','distributed'].includes(input.defaultExecutor),'执行方式无效');p.defaultExecutor=input.defaultExecutor;}if(input.sharePanels!==undefined)p.sharePanels=input.sharePanels===true;return {body:core.put('project',p)};},'write');
  route('POST', /^\/api\/v1\/projects\/([^/]+)\/dependencies$/, async r => { const [p] = r.params; allow(r, p); const input = await body(r); for (const k of [input.sourceId, input.targetId]) check(core.db.prepare('SELECT id FROM records WHERE project=? AND id=?').get(p, k), '引用不属于此项目', 404); core.depend(p, input.sourceId, input.targetId); return {body: {ok: true}}; }, 'write');
  route('POST',/^\/api\/v1\/projects\/([^/]+)\/artifacts\/([^/]+)\/acknowledge$/,async r=>{const [p,key]=r.params;allow(r,p);const input=await body(r),artifact=core.get('artifact',key,p);check(input.standardsId===core.get('project',p).standardsId&&input.confirmUpdated===true,'请核对当前规范并确认已更新');artifact.stale=false;artifact.staleReason='';artifact.standardsId=input.standardsId;core.put('artifact',artifact);core.event(p,'artifact.updated',{artifactId:key,responsible:artifact.responsible});return {body:artifact};},'write');
  route('POST', /^\/api\/v1\/projects\/([^/]+)\/changes\/preview$/, async r => { allow(r, r.params[0]); return {body: core.change(r.params[0], await body(r))}; }, 'write');
  route('POST', /^\/api\/v1\/projects\/([^/]+)\/changes\/([^/]+)\/commit$/, async r => { allow(r, r.params[0]); return {body: core.commitChange(...r.params)}; }, 'write');
  route('GET', /^\/api\/v1\/projects\/([^/]+)\/changes$/, async r => { allow(r, r.params[0]); const events = core.events(r.params[0], r.url.searchParams.get('cursor')); return {body: {events, cursor: events.at(-1)?.seq || Number(r.url.searchParams.get('cursor')) || 0}}; });
  route('POST', /^\/api\/v1\/projects\/([^/]+)\/tasks\/([^/]+)\/retry$/, async r => { allow(r, r.params[0]); return {body: core.retry(...r.params, await body(r))}; });
  route('POST',/^\/api\/v1\/projects\/([^/]+)\/tasks\/([^/]+)\/cancel$/,async r=>{const[p,key]=r.params;allow(r,p);const task=core.get('task',key,p);check(['queued','claimed','needs_update'].includes(task.status),'任务已经开始或等待审核，不能按未开始任务取消',409);task.status='cancelled';task.message='已取消未开始的任务';core.put('task',task);core.event(p,'task.cancelled',{taskId:key});return {body:task};});
  route('POST', /^\/api\/v1\/workers\/heartbeat$/, async r => {
    const input = await body(r); check(Array.isArray(input.projectIds) && input.projectIds.length, '请选择允许接单的项目'); for (const p of input.projectIds) allow(r, p);
    const w = core.heartbeat({...input, ownerId: actor(r)?.id || 'local'}); return {body: w};
  });
  const checkWorker = (r, key) => { const w = core.get('worker', key); check(!w.ownerId || w.ownerId === (actor(r)?.id || 'local') || w.ownerIds?.includes(actor(r)?.id), '不能控制其他接单器', 403);return w; };
  route('POST', /^\/api\/v1\/workers\/([^/]+)\/claim$/, async r => { checkWorker(r, r.params[0]); return {body: core.claim(r.params[0],actor(r)?.projectIds)}; });
  route('POST', /^\/api\/v1\/workers\/([^/]+)\/tasks\/([^/]+)\/(progress|result|fail)$/, async r => {
    const [wid, tid, action] = r.params; checkWorker(r, wid); const t = core.get('task', tid); allow(r, t.projectId); const input = {...await body(r), workerId: wid};
    if (action === 'progress') return {body: core.taskProgress(tid, input)};
    if (action === 'fail') return {body: core.fail(tid, input)};
    return {body: core.candidate(tid, Buffer.from(String(input.imageBase64 || '').replace(/^data:[^,]+,/, ''), 'base64'), input)};
  });

  // Preserve the existing comic's review/version protocol on the same 8790 entry.
  const compatibility = /^\/api\/v1\/(status|requirements\/batches|tasks(?:\/.*)?|versions(?:\/.*)?|assets\/[^/]+\/versions|keys(?:\/.*)?|events|backup)$/;
  for (const method of ['GET', 'POST', 'DELETE']) routes.push({method, pattern: compatibility, options: {scope: null}, handler: async (r, res) => {
    const bytes = method === 'GET' ? null : await r.raw(48 * 1024 * 1024);
    const managed = await formalBridge.handle(r,bytes); if(managed)return managed;
    const value = await new Promise((resolve, reject) => {
      const q = http.request({host: '127.0.0.1', port: formalPort, path: r.url.pathname + r.url.search, method, headers: {host: '127.0.0.1:' + formalPort, authorization: r.headers.authorization || '', ...(bytes ? {'content-type': r.headers['content-type'] || 'application/json', 'content-length': bytes.length} : {})}}, answer => {
        const chunks = []; answer.on('data', b => chunks.push(b)); answer.once('end', () => resolve({code: answer.statusCode, mime: answer.headers['content-type'], bytes: Buffer.concat(chunks)})); answer.once('error', reject);
      }); q.setTimeout(90000, () => q.destroy(Error('版本中心请求超时'))); q.once('error', reject); q.end(bytes);
    });
    res.writeHead(value.code, {'Content-Type': value.mime || 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'}); res.end(value.bytes);
  }});

  let busy = false, closed = false;
  const tick = async () => {
    if (busy || closed) return; busy = true;
    try {
      core.expire();
      await formalBridge.sync();
      for (let task of core.list('task').filter(t => t.executor === 'local' && ['queued', 'running'].includes(t.status))) {
        try {
          if (!task.localJobId) {
            task.status = 'running'; task.generation++; task.message = '已提交' + (task.engine === 'workshop' ? '角色工房' : '场景引擎'); core.put('task', task);
            const refs = task.referenceFileIds.map(k => { const f = core.get('file', k, task.projectId); return 'data:' + f.mime + ';base64,' + fs.readFileSync(f.path).toString('base64'); });
            const project = core.get('project', task.projectId);
            const created = await ctx.jobs.create({vendor: 'project-center', project: project.title, clientRequestId: task.id + ':' + task.generation, items: [{mode: 'generate', engine: task.engine, type: task.role === 'character' ? 'card' : task.role === 'scene' ? 'scene' : 'reference', character: task.role === 'character' ? task.name : '', scene: task.role === 'scene' ? task.name : '', prompt: task.compiledPrompt, references: refs, size: '1536x864', vars: {projectId: task.projectId, taskId: task.id, standardsId: task.standardsId}}]});
            task.localJobId = created.job.jobId; core.put('task', task);
          }
          const remote = await ctx.jobs.get(task.localJobId);
          task = core.get('task', task.id); task.message = remote.message || task.message; core.put('task', task);
          if (['completed','partial'].includes(remote.status) && remote.assets.length === 1) {
            const asset = ctx.index.get(remote.assets[0].assetId); const file = (asset.copies || []).find(c => fs.existsSync(c.path)); check(file, '归档结果文件不可读', 502); core.candidate(task.id, fs.readFileSync(file.path));
          } else if (['failed', 'cancelled', 'partial'].includes(remote.status)) core.fail(task.id, {generationEnded: remote.phase !== 'interrupted', message: remote.items.find(i => i.status === 'failed')?.message || remote.message});
        } catch (error) { const current = core.get('task', task.id); if (!['review', 'done'].includes(current.status)) core.fail(task.id, {generationEnded: current.status === 'queued', message: error.message}); }
      }
    } finally { busy = false; }
  };
  const timer = setInterval(() => void tick().catch(error => ctx.logger.error('项目调度异常', {error: error.message})), 1500); timer.unref();
  ctx.projectCenter = {core, formal, formalPort, tick, async close() { closed = true; clearInterval(timer); while (busy) await new Promise(r => setTimeout(r, 30)); await formal.close(); core.close(); }};
  return [...routes,...team.routes];
}
