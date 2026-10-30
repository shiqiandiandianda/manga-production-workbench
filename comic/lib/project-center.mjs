import {createLocalAssetServiceClient} from './local-asset-service-client.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {hostname} from 'node:os';
import {createHash} from 'node:crypto';
import {knownOriginalFiles,sourceOriginalPath} from './source-originals.mjs';
import {pageEpisode} from '../public/episode-boards.js';
import {writeFileAtomicSync} from './durable-files.mjs';
import {panelContentKey} from '../public/panel-generation.js';
import {inspectImageFile} from './image-files.mjs';
import {referenceAssetGenerationRequest} from './reference-asset-generation.mjs';
import {discoverGenerationIdentity} from './automatic-generation-identity.mjs';
import {createReferenceGenerationResults} from './reference-generation-results.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export function createProjectCenterSync({store,dataDir,saveProject,collabClient,generationSlots,apiOrigin,library}){
 const assetStudioUrl=process.env.ASSET_STUDIO_URL||'http://127.0.0.1:8796';
 const url=process.env.PROJECT_CENTER_URL||'',token=process.env.PROJECT_CENTER_TOKEN||'',person=process.env.PRODUCTION_PERSON||hostname();
 const file=path.join(dataDir,'project-center-sync.local.json');let mapping={};try{mapping=JSON.parse(fs.readFileSync(file));}catch{}
 let busy=false,closed=false,lastError='';const dirty=new Set(),referenceSubmissions=new Set();
 async function api(route,data,method=data===undefined?'GET':'POST'){
  let res;
  try{res=await fetch(url+route,{method,headers:{...(data===undefined?{}:{'Content-Type':'application/json'}),...(token?{Authorization:'Bearer '+token}:{})},...(data===undefined?{}:{body:JSON.stringify(data)}),signal:AbortSignal.timeout(60000)});}
  catch(cause){const address=new URL(url),local=['127.0.0.1','localhost','[::1]'].includes(address.hostname);throw Object.assign(Error('无法连接项目中心（'+address.host+'）。'+(local?'请通过“启动工作台.cmd”启动完整工作台，等待配套服务就绪。':'请检查项目中心地址和服务状态。'),{cause}),{status:503,code:'project_center_unavailable'});}
  const result=await res.json();if(!res.ok)throw Object.assign(Error(result.error||'项目中心连接失败'),{status:res.status});return result;
 }
 const save=()=>writeFileAtomicSync(file,JSON.stringify(mapping,null,2));
 const referenceWork=project=>{let links={};try{links=JSON.parse(fs.readFileSync(path.join(dataDir,'teamwork/local.json'),'utf8')).links||{};}catch{}return {projectId:project.id,title:project.title,mokuProjectId:links[project.id]?.remoteProjectId||''};};
 const studioClient=createLocalAssetServiceClient({origin:assetStudioUrl,diagnosticFile:path.join(dataDir,'asset-service-connection-events.jsonl')}),referenceResults=createReferenceGenerationResults({store,library,assetStudioUrl,mapping,save,saveProject,serviceClient:studioClient});
 const materialize=(asset,record,bytes)=>{const folder=path.join(dataDir,'project-center-cache',record.projectId);fs.mkdirSync(folder,{recursive:true});const target=path.join(folder,record.sha256+(asset.extension||path.extname(record.name)||'.png'));if(!fs.existsSync(target)||hash(fs.readFileSync(target))!==record.sha256)writeFileAtomicSync(target,bytes);asset.originalFilePath||=asset.filePath;Object.assign(asset,inspectImageFile(target));asset.projectCenterFile={projectId:record.projectId,fileId:record.id,sha256:record.sha256};};
 async function ensureAssets(ids){
  if(!url)return;
  for(const asset of store.db.assets.filter(a=>ids.includes(a.id)&&a.projectCenterFile)){
   const ref=asset.projectCenterFile;try{if(hash(fs.readFileSync(store.assetPath(asset.id)))===ref.sha256)continue;}catch{}
   const response=await fetch(url+'/api/v1/files/'+ref.fileId+'/content',{headers:token?{Authorization:'Bearer '+token}:{},signal:AbortSignal.timeout(60000)});if(!response.ok)throw Error('中心原图暂不可读，未替换为其他图片');const bytes=Buffer.from(await response.arrayBuffer());if(hash(bytes)!==ref.sha256)throw Error('中心原图传输校验失败');materialize(asset,{id:ref.fileId,projectId:ref.projectId,sha256:ref.sha256,name:asset.name},bytes);store.save();
  }
 }
 async function upload(projectId,name,bytes,type,mime){
  const key=projectId+':'+name+':'+hash(bytes);if(mapping[key])return mapping[key];
  let value;
  if(bytes.length>16*1024*1024){const base='/api/v1/projects/'+projectId+'/uploads',u=await api(base,{name,type,mime,totalBytes:bytes.length,sha256:hash(bytes),clientRequestId:hash(Buffer.from(key))});if(u.status!=='completed')for(let n=0;n<u.chunkCount;n++)if(!u.chunks[n]){const response=await fetch(url+base+'/'+u.id+'/chunks/'+n,{method:'PUT',headers:token?{Authorization:'Bearer '+token}:{},body:bytes.subarray(n*u.chunkBytes,Math.min(bytes.length,(n+1)*u.chunkBytes)),signal:AbortSignal.timeout(60000)});if(!response.ok)throw Error('分片上传失败');}value=await api(base+'/'+u.id+'/complete',{});}
  else value=await api('/api/v1/projects/'+projectId+'/files',{name,type,mime,data:bytes.toString('base64')});mapping[key]=value.id;save();return value.id;
 }
 async function sync(project){
  const p=await api('/api/v1/projects',{title:project.title,externalKey:project.id});mapping[project.id]||={};mapping[project.id].projectId=p.id;
  const files={};
  const allIds=new Set();const collect=v=>{if(typeof v==='string'&&/^asset_[a-f0-9-]{36}$/.test(v))allIds.add(v);else if(Array.isArray(v))v.forEach(collect);else if(v&&typeof v==='object')Object.values(v).forEach(collect);};collect(project);
  await ensureAssets([...allIds].filter(id=>!store.db.assets.find(a=>a.id===id)?.storageEvicted));
  for(const asset of store.db.assets.filter(a=>allIds.has(a.id)))try{if(asset.storageEvicted&&asset.projectCenterFile){files[asset.id]=asset.projectCenterFile.fileId;continue;}const bytes=fs.readFileSync(store.assetPath(asset.id));files[asset.id]=await upload(p.id,asset.name+(path.extname(asset.name)?'':asset.extension||'.png'),bytes,'comic-image','image/'+(asset.extension==='.jpg'?'jpeg':(asset.extension||'.png').slice(1)));materialize(asset,{id:files[asset.id],projectId:p.id,sha256:hash(bytes),name:asset.name},bytes);}catch(e){throw Error('素材未归档：'+asset.name+'；'+e.message);}
  store.save();
  for(const original of knownOriginalFiles(project)){const originalPath=sourceOriginalPath(dataDir,project.id,original.hash);if(!fs.existsSync(originalPath))continue;const bytes=fs.readFileSync(originalPath);if(hash(bytes)!==original.hash)throw Error('原始资料校验不符：'+original.name);await upload(p.id,original.name,bytes,original.role,'application/octet-stream');}
  const derivatives=[];
  const sourceFileId=await upload(p.id,project.id+'.comic.json',Buffer.from(JSON.stringify(project)),'comic-project','application/json');
  const panels=project.pages.flatMap(page=>page.panels.map(panel=>{const ids=new Set();const scan=v=>{if(typeof v==='string'&&allIds.has(v))ids.add(v);else if(Array.isArray(v))v.forEach(scan);else if(v&&typeof v==='object')Object.values(v).forEach(scan);};scan(panel);scan(project.shots.find(s=>s.id===panel.shotId));return {externalId:panel.id,episode:pageEpisode(project,page),title:panel.name||project.shots.find(s=>s.id===panel.shotId)?.code||'画格',locked:panel.locked||page.locked,assetIds:[...ids],centerVersionIds:[...ids].map(id=>store.db.assets.find(a=>a.id===id)?.center?.versionId).filter(Boolean)};}));
  const assetSources=store.db.assets.filter(a=>files[a.id]&&a.center?.versionId).map(a=>({fileId:files[a.id],formalVersionId:a.center.versionId}));
  await api('/api/v1/projects/'+p.id+'/comic-snapshots',{revision:project.revision,person,files,sourceFileId,panels,derivatives,assetSources});mapping[project.id]={...mapping[project.id],projectId:p.id,revision:project.revision,syncedAt:new Date().toISOString()};save();lastError='';return p;
 }
 async function adopt(){
  for(const p of store.db.projects.filter(p=>p.assetCenter&&!p.deletedAt)){
   const info=mapping[p.id];if(!info?.projectId)continue;const d=await api('/api/v1/projects/'+info.projectId),signature=d.versions.filter(v=>v.status==='approved'&&!v.stale).map(v=>v.id).sort().join(',');
   if(!signature||signature===info.approvedSignature)continue;
   const episodes=[...new Set(p.pages.map(page=>pageEpisode(p,page)))].filter(e=>Number.isInteger(e)&&e>0);
   for(const episode of episodes){const current=store.project(p.id);const res=await fetch(apiOrigin()+'/api/projects/'+p.id+'/asset-center/sync',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({expectedRevision:current.revision,episode,workId:current.assetCenter.workId}),signal:AbortSignal.timeout(60000)});if(!res.ok){const error=await res.json();throw Error(error.error||'正式资产自动回填失败');}}
   mapping[p.id].approvedSignature=signature;save();
  }
 }
 async function progress(){
  for(const project of store.db.projects.filter(p=>!p.deletedAt)){
   const info=mapping[project.id],central=info?.projectId;if(!central)continue;
   const jobs=store.db.jobs.filter(j=>j.projectId===project.id);
   // A delegation whose reply was lost has no remote task id and would otherwise
   // stay "delegated" forever (not cancellable). Recover it after a grace period.
   for(const job of jobs.filter(j=>j.status==='delegated'&&!j.remoteTaskId)){
    if(Date.now()-(Date.parse(job.delegatedAt||job.updated||0)||0)<10*60*1000)continue;
    job.status='recoverable';job.phase='recoverable';job.requiredAction='check_collab_task';job.updated=new Date().toISOString();job.message='协作提交状态待核实：中控未返回任务编号；请到协作页核对后取消或重试，本机没有重复生成';store.save();
   }
   for(const job of jobs.filter(j=>j.status==='delegated'&&j.remoteTaskId)){try{const res=await fetch(apiOrigin()+'/api/collab/tasks/'+job.remoteTaskId,{signal:AbortSignal.timeout(6000)});if(!res.ok)continue;const {task}=await res.json();job.message=task.message||job.message;if(task.status==='done'&&task.apply?.status!=='pending'){job.status='done';job.applied=task.apply?.status==='applied';job.updated=new Date().toISOString();store.save();}else if(['failed','cancelled'].includes(task.status)){job.status=task.status;job.updated=new Date().toISOString();store.save();}}catch{}}
   const episodes=new Set(jobs.map(j=>project.pages.find(p=>p.panels.some(f=>f.id===j.panelId))).filter(Boolean).map(p=>pageEpisode(project,p)).filter(episode=>Number.isInteger(episode)&&episode>0));
   for(const episode of episodes){
    const relevant=jobs.filter(j=>project.pages.some(p=>pageEpisode(project,p)===episode&&p.panels.some(f=>f.id===j.panelId))),latest=relevant.at(-1),batch=latest?relevant.filter(j=>j.batchId===latest.batchId):[];
    const active=batch.some(j=>['running','queued','delegated'].includes(j.status)),completed=batch.filter(j=>j.status==='done').length;
    const input={person,episode,stage:active?'generation':'review',completed,total:batch.length,message:active?batch.filter(j=>j.status!=='done').map(j=>j.message).slice(0,2).join('；'):completed+' / '+batch.length+' 项生成结束，待审核',activeTarget:latest?.panelId};
    const key='progress:'+episode,signature=hash(Buffer.from(JSON.stringify(input))),lastAction=Date.parse(latest?.updated||latest?.created||0)||0;if((info['manualProgress:'+episode]||0)>lastAction&&!active)continue;if(info[key]===signature)continue;await api('/api/v1/projects/'+central+'/progress',input);info[key]=signature;save();
   }
  }
 }
 async function preflight(project,panelIds){
  if(!url)return null;
  let info=mapping[project.id];if(!info?.projectId||info.revision!==project.revision||dirty.has(project.id)){await sync(structuredClone(project));info=mapping[project.id];}
  const d=await api('/api/v1/projects/'+info.projectId),standard=d.standards.find(s=>s.id===d.project.standardsId);
  const selected=new Set(panelIds),stale=(d.artifacts||[]).filter(a=>a.stale&&selected.has(a.externalId));if(stale.length)throw Error('甲方改动影响当前画格，请在项目中心复核并确认更新后再生成');
  const policy={projectId:d.project.id,standardsId:standard?.id||null,number:standard?.number||null};project.productionPolicy=policy;return policy;
 }
 async function isPolicyCurrent(policy,panelId){if(!url||!policy)return true;try{const d=await api('/api/v1/projects/'+policy.projectId);return (d.project.standardsId||null)===(policy.standardsId||null)&&!(d.artifacts||[]).some(a=>a.externalId===panelId&&a.stale);}catch{return false;}}
 async function overflow(){
  // Team help generation removed: never hand a panel to the collaboration hub.
  if(process.env.COMIC_TEAM_HELP!=='1')return;
  const limit=generationSlots.mainLimit();if(!url||!limit||generationSlots.snapshot().running<limit)return;
  const job=store.db.jobs.find(j=>j.status==='queued'&&j.provider==='codex'&&j.action==='generate'&&!j.kind&&j.input?.projectPolicy);if(!job)return;
  const project=store.project(job.projectId),policy=job.input.projectPolicy,d=await api('/api/v1/projects/'+policy.projectId);if(!d.project.sharePanels)return;
  if(!await isPolicyCurrent(policy,job.panelId))return;
  const panel=project.pages.flatMap(p=>p.panels).find(f=>f.id===job.panelId);if(!panel||panel.locked||panelContentKey(project,panel,store.db.assets)!==job.panelContentKey)return;
  if(!(await collabClient.status()).hubReachable)return;
  // Several awaits above can let the local queue start this same job. Re-check
  // the live status so one shot is never generated both locally and remotely.
  if(job.status!=='queued'||!store.db.jobs.includes(job))return;
  // Durable handoff precedes the network POST. A lost reply must never fall back to local generation.
  job.status='delegated';job.delegatedAt=new Date().toISOString();job.message='本机名额已满，任务交由协作中控分配';job.updated=new Date().toISOString();store.save();
  try{const result=await collabClient.distribute({projectId:project.id,panelIds:[panel.id]});job.remoteTaskId=result.tasks[0]?.taskId||null;job.message=job.remoteTaskId?'已交由同事电脑执行；中控任务 '+job.remoteTaskId:'协作提交状态待核实，未重复在本机生成；'+(result.errors[0]?.error||'请查看协作任务');if(!job.remoteTaskId)job.phase='uncertain';}catch(error){job.message='协作提交状态待核实：'+error.message;job.phase='uncertain';}store.save();
 }
 async function tick(){if(busy||closed||!url)return;busy=true;try{for(const id of [...dirty]){const p=store.db.projects.find(p=>p.id===id);if(p){const revision=p.revision;await sync(structuredClone(p));if(store.project(id).revision===revision)dirty.delete(id);}}await adopt();await overflow();await progress();}catch(e){lastError=e.message;}finally{busy=false;}}
 const timer=setInterval(()=>void tick(),5000);timer.unref();for(const p of store.db.projects.filter(p=>!p.deletedAt))dirty.add(p.id);
 const handle=async(req,res,{pathname,method,url:local})=>{
  if(!pathname.startsWith('/api/project-center'))return false;const send=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
  try{
   if(pathname==='/api/project-center/asset-studio/open'&&method==='GET'){res.writeHead(302,{Location:assetStudioUrl+'/?home=1','Cache-Control':'no-store'});res.end();return true;}
   if(await referenceResults(req,res,{pathname,method,url:local},send,async request=>{const chunks=[];let size=0;for await(const b of request){size+=b.length;if(size>64000)throw Error('请求过大');chunks.push(b);}return JSON.parse(Buffer.concat(chunks).toString()||'{}');}))return true;
   if(pathname==='/api/project-center/reference-generation'&&method==='GET'){
    const project=store.project(local.searchParams.get('projectId')),info=mapping[project.id];
    if(!local.searchParams.get('taskId')){
     const panelId=local.searchParams.get('panelId'),entries=Object.entries(mapping).filter(([k,v])=>k.startsWith('reference-generation:'+project.id+':')&&v.task?.usages?.some(u=>u.targetId===panelId)).map(([,v])=>v);
     send(200,{items:entries});return true;
    }
    const stored=Object.entries(mapping).find(([k,v])=>k.startsWith('reference-generation:'+project.id+':')&&v.task?.id===local.searchParams.get('taskId'))?.[1];
    if(stored&&!stored.productionRecordId){try{const result=await studioClient.json('/api/production-records'),record=result.items?.find(r=>r.source?.taskId===stored.task.id);if(record){stored.productionRecordId=record.id;stored.url=record.url;save();}}catch{}}
    if(stored?.productionRecordId){const record=await studioClient.json('/api/production-records/'+stored.productionRecordId);const task={...stored.task,status:({completed:'review',legacy:'review'})[record.status]||record.status,message:record.error||Object.values(record.phases||{}).map(p=>p.message).join('；')};send(200,{task,record,imageUrl:record.imageUrl?assetStudioUrl+record.imageUrl:null,url:record.url});return true;}
    if(!info?.projectId)throw Error('当前工程尚未连接生产项目');
    const d=await api('/api/v1/projects/'+info.projectId),task=d.tasks.find(t=>t.id===local.searchParams.get('taskId'));
    if(!task)throw Error('此生成任务不属于当前工程');
    const version=d.versions.find(v=>v.id===task.versionId),image=version&&d.files.find(f=>f.id===version.fileId);
    send(200,{task,version,imageUrl:image?url+'/api/v1/files/'+image.id+'/content':null,url:url+'/?project='+info.projectId+'#assets'});return true;
   }
   if(pathname==='/api/project-center/reference-generation/identity'&&method==='POST'){const chunks=[];let size=0;for await(const b of req){size+=b.length;if(size>64000)throw Error('请求过大');chunks.push(b);}const input=JSON.parse(Buffer.concat(chunks).toString()||'{}');send(200,await discoverGenerationIdentity(store,library,input));return true;}
   if(pathname==='/api/project-center/reference-generation/preview'&&method==='POST'){const chunks=[];let size=0;for await(const b of req){size+=b.length;if(size>64000)throw Error('请求过大');chunks.push(b);}const input=JSON.parse(Buffer.concat(chunks).toString()||'{}');await discoverGenerationIdentity(store,library,input);const request=referenceAssetGenerationRequest(store.project(input.projectId),{...input,requestId:'preview-only'},store.db.assets);send(200,{prompt:request.payload.prompt,referenceIds:request.referenceIds,provenance:request.payload.provenance,identityReference:request.payload.identityReference});return true;}
   if(pathname==='/api/project-center/reference-generation'&&method==='POST'){
    const chunks=[];let size=0;for await(const b of req){size+=b.length;if(size>64000)throw Error('请求过大');chunks.push(b);}const input=JSON.parse(Buffer.concat(chunks).toString()||'{}');
    await discoverGenerationIdentity(store,library,input);const project=store.project(input.projectId),request=referenceAssetGenerationRequest(project,input,store.db.assets),key=project.id+':'+input.panelId+':'+input.needId;
    if(referenceSubmissions.has(key))throw Error('该项正在提交，请勿重复点击');referenceSubmissions.add(key);
    try{
     const receiptKey='reference-generation:'+project.id+':'+input.requestId,previous=mapping[receiptKey];
     if(previous){if(previous.panelId&&previous.panelId!==input.panelId||previous.needId&&previous.needId!==input.needId)throw Error('请求编号已用于其他参考需求');send(200,{...previous,duplicate:true});return true;}
     const studioUrl=assetStudioUrl,sceneMeta=request.sceneMeta||{},sceneMetaText=[sceneMeta.camera,sceneMeta.time,sceneMeta.weather].filter(Boolean).join(' · ');
     const record=await studioClient.json('/api/production-records',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requestId:input.requestId,name:request.payload.name,type:request.payload.role,outfit:request.payload.role==='scene'?(sceneMetaText||request.payload.state):request.payload.state,prompt:request.payload.prompt,referenceIds:request.referenceIds,...request.payload.settings,sceneMeta:request.payload.role==='scene'?sceneMeta:undefined,source:{projectId:project.id,projectTitle:project.title,work:referenceWork(project),panelId:input.panelId,needId:input.needId,episode:request.payload.episode,scene:request.scene||null,provenance:request.payload.provenance,originalPrompt:request.payload.originalPrompt,originalAssetPrompt:request.payload.originalAssetPrompt,assetPromptSource:request.payload.assetPromptSource,assetPromptSha256:request.payload.assetPromptSha256,promptFrameworkVersion:request.payload.promptFrameworkVersion,identityReference:request.payload.identityReference}}),timeoutMs:60000});
     const task={id:record.id,productionRecordId:record.id,name:record.name,role:record.type,status:record.status,usages:request.payload.usages,message:'已提交资产生成；完成后在当前页选择接回'};
     const receipt={task,productionRecordId:record.id,panelId:input.panelId,needId:input.needId,referenceIds:request.referenceIds,url:record.url};
     mapping[receiptKey]=receipt;save();send(202,receipt);
    }finally{referenceSubmissions.delete(key);}return true;
   }
   if(method==='GET'){const key=local.searchParams.get('projectId'),info=mapping[key];let dashboard=null;if(url&&info?.projectId)dashboard=await api('/api/v1/projects/'+info.projectId);send(200,{configured:!!url,url,person,project:info||null,lastError,dashboard});return true;}
   let chunks=[];for await(const b of req)chunks.push(b);const input=JSON.parse(Buffer.concat(chunks).toString()||'{}');
   const project=store.project(input.projectId),p=await sync(structuredClone(project));
   if(pathname.endsWith('/progress')){await api('/api/v1/projects/'+p.id+'/progress',{...input,person});mapping[project.id]['manualProgress:'+input.episode]=Date.now();save();}
   send(200,{ok:true,project:p});return true;
  }catch(e){const network=/^(fetch failed|Failed to fetch)$/i.test(e.message||'');send(e.status||409,{error:network?'资产生成准备时连接失败，请检查墨库与资产工作室连接；本次提交前请先核对生成记录。':e.message,...(e.code?{code:e.code}:{}),...(e.submissionUncertain?{submissionUncertain:true}:{})});return true;}
 };
 return {handle,sync,ensureAssets,preflight,isPolicyCurrent,
  compact:async input=>{if(!url)return null;if(!['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname))return null;return api('/api/v1/storage/compact',input);},
  storageStatus:async()=>{if(!url||!['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname))return null;return api('/api/v1/storage/status');},
  storageInventory:async()=>{if(!url||!['localhost','127.0.0.1','[::1]'].includes(new URL(url).hostname))return null;return api('/api/v1/storage/inventory');},
  storageFile:async id=>api('/api/v1/storage/file/'+encodeURIComponent(id)),
  evictStorage:async files=>api('/api/v1/storage/evict',{files}),
  mark(project){if(url)dirty.add(project.id);},markAsset(asset){delete asset.projectCenterFile;for(const p of store.db.projects)dirty.add(p.id);},status:()=>({url,lastError}),close(){closed=true;clearInterval(timer);},tick,running:()=>busy,forget(id){dirty.delete(id);for(const key of Object.keys(mapping))if(key===id||key.startsWith('reference-generation:'+id+':'))delete mapping[key];save();}};
}
