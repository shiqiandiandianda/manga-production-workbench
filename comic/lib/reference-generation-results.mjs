import {createHash} from 'node:crypto';
import {auditPanelReferences} from '../public/panel-reference-audit.js';
import {assetNameKey} from '../public/asset-metadata.js';
import {productionSegment} from '../public/production-package-model.js';
import {auditProductionReferences} from '../public/production-reference-audit.js';
import {setPanelReferences,panelReferenceIds} from '../public/panel-references.js';
import {productionAssetBinding} from './production-reference-files.mjs';
import {check} from './store.mjs';
import {unknownState,libraryStatePlaceholder} from '../public/character-states.js';
import {deriveSceneReference} from '../public/reference-scene-source.js';
import {prepareWorkspaceBinding} from './asset-workspace-api.mjs';
import {assetWorkspaceInventory,assetRequirementKey} from '../public/asset-workspace-model.js';
import {createReferenceAuditContext} from '../public/reference-audit-context.js';
import {setImmediate as yieldToRequests} from 'node:timers/promises';
export function referenceRecordMatch(record,{project,panel,need}){
 if(record.deletedAt||record.source?.projectId!==project.id||record.type!==need.role)return null;
 const name=assetNameKey(record.name),names=[need.name,...(need.aliases||[])].filter(Boolean).map(assetNameKey),exact=names.includes(name);
 const related=!exact&&need.role==='scene'&&names.some(n=>Math.min(n.length,name.length)>=3&&(name.endsWith(n)||n.endsWith(name)));
 if(!exact&&!related)return null;
 // Camera labels such as “侧拍” are not a different scene identity. Unknown costume states need explicit visual selection.
 if(need.role!=='scene'&&!unknownState(need.state)&&need.state&&assetNameKey(record.outfit)!==assetNameKey(need.state))return null;
 return {matchNote:related?'场景名称相近，请核对后采用':need.role!=='scene'&&unknownState(need.state)&&!libraryStatePlaceholder(need.state)?'分镜未指定完整状态，请核对服装后采用':''};
}
export function createReferenceGenerationResults({store,library,assetStudioUrl,mapping,save,saveProject}){
 const inFlight=new Map(),read=async route=>{const response=await fetch(assetStudioUrl+route,{signal:AbortSignal.timeout(30000)}),value=await response.json();check(response.ok,value.error||'资产生成记录暂时无法读取',409);return value;};
 function target(input){const project=store.project(input.projectId),page=project.pages.find(p=>p.panels.some(f=>f.id===input.panelId)),panel=page?.panels.find(f=>f.id===input.panelId),need=panel&&auditPanelReferences(project,panel,store.db.assets).needs.find(n=>n.id===input.needId);check(need&&!need.predecessor,'这项资产需求已变化，请重新打开卡片',409);return {project,page,panel,need};}
 const matches=(record,context)=>!!referenceRecordMatch(record,context);
 const recordVersion=record=>createHash('sha256').update(JSON.stringify([record.status,record.updatedAt,record.sha256,record.finished,record.slots,record.boardTitle])).digest('hex').slice(0,24);
 const previewUrl=(input,id,version)=>'/api/project-center/reference-generation/image?'+new URLSearchParams({projectId:input.projectId,panelId:input.panelId,needId:input.needId,recordId:id,...(version?{v:version}:{})});
 function view(record,input){const partial=!['completed','legacy'].includes(record.status),available=!!record.imageUrl&&((record.finished||[]).length>0||!partial);return {version:recordVersion(record),id:record.id,deletedAt:record.deletedAt,name:record.name,state:record.outfit,role:record.type,status:record.status,partial,available,finished:record.finished||[],components:record.components||[],phases:record.phases||{},characterOutputMode:record.characterOutputMode,recommendedCharacterOutputMode:record.recommendedCharacterOutputMode,error:record.error||'',imageUrl:available?previewUrl(input,record.id,recordVersion(record)):null,context:{projectId:input.projectId,panelId:input.panelId,needId:input.needId},source:record.source,createdAt:record.createdAt,updatedAt:record.updatedAt};}
 async function recordFor(input,{allowTrashed=false}={}){check(/^production_[a-f0-9-]{36}$/i.test(input.recordId||''),'生成记录编号无效');const context=target(input),record=await read('/api/production-records/'+input.recordId);check(matches(allowTrashed?{...record,deletedAt:null}:record,context),'这张生成图不属于当前人物、服装或场景需求',409);return {context,record};}
 async function image(record,slot){check(record.imageUrl?.startsWith('/api/production-records/'+record.id+'/image?'),'生成图片尚未就绪',409);check(!slot||Object.hasOwn(record.slots||{},slot),'图片组件不存在',404);const response=await fetch(assetStudioUrl+(slot?'/api/production-records/'+record.id+'/image?'+new URLSearchParams({slot}):record.imageUrl),{signal:AbortSignal.timeout(60000)});check(response.ok,'生成原图暂时无法读取',409);const bytes=Buffer.from(await response.arrayBuffer());check(bytes.length&&bytes.length<=256*1024*1024,'生成图片为空或过大');return bytes;}
 async function adopt(input){
  const {context,record}=await recordFor(input),{project,panel,page,need}=context;check(input.expectedRevision===project.revision,'工程已有修改，请保存后再接回',409);check(!panel.locked&&!page.locked,'请先解锁画格');check(!store.db.jobs.some(j=>j.projectId===project.id&&j.panelId===panel.id&&['queued','running','delegated','recoverable','awaiting_confirmation'].includes(j.status)),'本格正在生图，完成后可采用资产',409);const candidate=view(record,input);check(candidate.available,'任务还没有可用图片');check(!candidate.partial||input.allowPartial===true,'这份记录只有部分组件完成，请明确选择部分结果');
  const bytes=await image(record),sha=createHash('sha256').update(bytes).digest('hex'),key='reference-result:'+project.id+':'+record.id+':'+sha;let receipt=mapping[key],asset=receipt?.localAssetId&&store.db.assets.find(a=>a.id===receipt.localAssetId);
  // An identical fixed cloud revision already cached by this project needs binding only.
  if(!receipt){const existing=store.db.assets.find(a=>a.referenceGeneration?.projectId===project.id&&a.referenceGeneration?.recordId===record.id&&a.library?.assetId&&a.library?.revisionId&&a.library?.sha256===sha);if(existing){receipt={assetId:existing.library.assetId,revisionId:existing.library.revisionId,sha256:sha,localAssetId:existing.id};mapping[key]=receipt;save();asset=existing;}}
  if(!receipt){let cloudProjectId=project.productionPackage?.episodes.flatMap(e=>e.segments.flatMap(s=>s.references)).find(r=>r.binding?.sourceType==='moku'&&r.binding.projectId)?.binding.projectId||library.defaultProjectId;
   if(!cloudProjectId){const projects=await library.read('/api/projects'),matched=(projects.items||[]).filter(p=>assetNameKey(p.name)===assetNameKey(project.productionPackage?.title||project.title));check(matched.length===1,'请先从本作品的墨库项目选用一项资产，再接回生成图');cloudProjectId=matched[0].id;}
   receipt=await library.uploadAsset({projectId:cloudProjectId,name:[need.name,need.state,'生成_'+record.id.slice(-8)].filter(Boolean).join('_')+'.png',bytes,mime:'image/png',folder:'漫画生成参考',category:need.role,assetKind:'image',assetType:need.role,objectName:need.name,variantName:need.state,operationId:'reference-result:'+createHash('sha256').update(key).digest('hex')});receipt={assetId:receipt.assetId,revisionId:receipt.revisionId,sha256:sha};mapping[key]=receipt;save();
  }
  if(!asset){const result=await library.importAsset({assetId:receipt.assetId,revisionId:receipt.revisionId});check(result.kind==='image','接回结果不是图片');asset=result.asset;Object.assign(asset,{libraryRole:need.role,libraryName:need.name,libraryState:need.state,productionStatus:'confirmed',referenceGeneration:{recordId:record.id,sha256:sha,partial:candidate.partial,projectId:project.id,needId:need.id}});receipt.localAssetId=asset.id;save();store.save();}
  asset.libraryAliases=[...new Set([...(asset.libraryAliases||[]),record.name,need.name].filter(Boolean))];
  const current=target(input);check(current.project===project&&current.project.revision===input.expectedRevision,'结果已存入墨库；工程刚有修改，请再次采用即可',409);check(!current.panel.locked&&!current.page.locked,'结果已存入墨库，请解锁画格后再采用',409);check(!store.db.jobs.some(j=>j.projectId===project.id&&j.panelId===panel.id&&['queued','running','delegated','recoverable','awaiting_confirmation'].includes(j.status)),'结果已存入墨库，等待本格生成结束后再采用',409);
  const next=prepareWorkspaceBinding(store,project,{...input,targets:input.targets||[{panelId:panel.id,needId:need.id}]},asset,current.need);store.db.projects[store.db.projects.indexOf(project)]=next;receipt.adoptedAt=new Date().toISOString();save();return {asset,project:saveProject(next,{editor:true}),record:candidate};
 }
 return async(req,res,{pathname,method,url},send,body)=>{
  if(!['results','image','adopt','record','component','board','trash','restore'].some(s=>pathname==='/api/project-center/reference-generation/'+s))return false;
  const input=method==='GET'?Object.fromEntries(url.searchParams):await body(req);
  if(['/trash','/restore'].some(s=>pathname.endsWith(s))&&method==='POST'){check(/^production_[a-f0-9-]{36}$/i.test(input.recordId||''),'生成记录编号无效');const context=target(input),record=await read('/api/production-records/'+input.recordId);check(matches({...record,deletedAt:null},context),'这张图不属于当前人物与服装',409);const response=await fetch(assetStudioUrl+'/api/production-records/'+input.recordId+(pathname.endsWith('/trash')?'/trash':'/restore'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({cancelActive:input.cancelActive===true}),signal:AbortSignal.timeout(60000)}),result=await response.json();check(response.ok,result.error||'删除或恢复失败',409);send(200,view(result,input));return true;}
  if(pathname.endsWith('/results')&&method==='GET'){
   target(input);const result=await read('/api/production-records'+(input.includeTrashed==='1'?'?includeTrashed=1':'')),context=target(input),project=context.project,revision=project.revision;
   const records=(result.items||[]).filter(r=>r.source?.projectId===project.id&&(input.includeTrashed==='1'||!r.deletedAt));
   if(!records.length){send(200,{items:[]});return true;}
   let contexts=[{input,context}];
   if(input.scope&&input.scope!=='asset'){
    const referenceContext=createReferenceAuditContext(project,store.db.assets),audits=new Map(),panels=new Map();let count=0;
    for(const page of project.pages)for(const panel of page.panels){
     panels.set(panel.id,{page,panel});
     if(panel.cutoutLayer||panel.sfxImage||panel.designDecoration||panel.breakoutForeground||panel.productionBackground||panel.productionBackgroundInstance)continue;
     audits.set(panel.id,auditPanelReferences(project,panel,store.db.assets,{referenceContext}));
     if(++count%20===0)await yieldToRequests();
    }
    check(store.project(project.id)===project&&project.revision===revision,'工程已改变，请重新读取资产记录',409);
    contexts=assetWorkspaceInventory(project,store.db.assets,{scope:input.scope==='work'?'work':'episode',panelId:input.panelId,referenceContext,includeSources:false,audits}).flatMap(row=>row.uses.map(u=>({input:{projectId:input.projectId,panelId:u.panelId,needId:u.needId},context:{project,...panels.get(u.panelId),need:audits.get(u.panelId).needs.find(n=>n.id===u.needId)}})));
   }
   const items=[];for(const r of records){const groups=new Map();for(const c of contexts){if(!matches(input.includeTrashed==='1'?{...r,deletedAt:null}:r,c.context))continue;const key=assetRequirementKey(c.context.need),previous=groups.get(key),source=c.input.panelId===r.source?.panelId&&c.input.needId===r.source?.needId;if(!previous||source)groups.set(key,c);}for(const found of groups.values())items.push({...view(r,found.input),...referenceRecordMatch(r,found.context)});}
   items.sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||'')));send(200,{items});return true;
  }
  if(pathname.endsWith('/image')&&method==='GET'){const {record}=await recordFor(input,{allowTrashed:true}),bytes=await image(record,input.slot);res.writeHead(200,{'Content-Type':'image/png','Cache-Control':'no-store'});res.end(bytes);return true;}
  if(pathname.endsWith('/record')&&method==='GET'){const {record}=await recordFor(input);let cloud=null;if(record.imageUrl){const bytes=await image(record),sha=createHash('sha256').update(bytes).digest('hex'),receipt=mapping['reference-result:'+input.projectId+':'+record.id+':'+sha],asset=store.db.assets.find(a=>a.library?.sha256===sha&&a.library?.revisionId);if(receipt)cloud={assetId:receipt.assetId,revisionId:receipt.revisionId};else if(asset)cloud={assetId:asset.library.assetId,revisionId:asset.library.revisionId};}send(200,{...view(record,input),cloud,slots:Object.fromEntries(Object.entries(record.slots||{}).map(([key,value])=>[key,{...value,url:previewUrl(input,record.id,recordVersion(record))+'&'+new URLSearchParams({slot:key})}])),prompt:record.prompt,boardTitle:record.boardTitle,sceneOutputMode:record.sceneOutputMode});return true;}
  if(pathname.endsWith('/component')&&method==='POST'||pathname.endsWith('/board')&&method==='PUT'){const {record}=await recordFor(input),component=pathname.endsWith('/component');check(component?typeof input.component==='string':input.slots&&typeof input.slots==='object','资产编辑内容无效');const payload=component?{component:input.component,action:input.action,requestId:input.requestId,jobId:input.jobId}:{slots:input.slots,title:input.title},response=await fetch(assetStudioUrl+'/api/production-records/'+record.id+(component?'/component':'/board'),{method:component?'POST':'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(60000)}),result=await response.json();check(response.ok,result.error||'资产编辑失败',409);send(200,view(result,input));return true;}
  check(pathname.endsWith('/adopt')&&method==='POST','资产接回接口不存在',404);const key=input.projectId+':'+input.panelId+':'+input.needId+':'+input.recordId;check(!inFlight.has(key),'正在接回此图，请稍候',409);const promise=adopt(input);inFlight.set(key,promise);try{send(200,await promise);}finally{inFlight.delete(key);}return true;
 };
}
