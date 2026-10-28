import fs from 'node:fs';import path from 'node:path';import {createHash,randomUUID} from 'node:crypto';
import {check} from './store.mjs';import {writeFileAtomicSync} from './durable-files.mjs';
import {decodeProjectSnapshot,encodeProjectSnapshot,SNAPSHOT_REQUEST_BUDGET} from './project-snapshot-codec.mjs';
import {fixedResourceReferences} from './project-portability.mjs';
import {explicitPageEpisode} from '../public/project-episode-classification.js';
import {episodeNumber} from '../public/episode-boards.js';
const uuid=v=>typeof v==='string'&&/^[a-f0-9-]{36}$/i.test(v),hash=v=>createHash('sha256').update(v).digest('hex');
const canonical=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item);
const json=v=>new Response(JSON.stringify(v),{headers:{'Content-Type':'application/json'}});
const assetIds=(value,into=new Set(),depth=0)=>{if(depth>40)return into;if(typeof value==='string'&&/^asset_[a-f0-9-]{36}$/i.test(value))into.add(value);else if(Array.isArray(value))for(const v of value)assetIds(v,into,depth+1);else if(value&&typeof value==='object')for(const v of Object.values(value))assetIds(v,into,depth+1);return into;};
const episodeOf=explicitPageEpisode;
const boardBackground=(project,kind,number)=>{const state=project.episodeBoards,own=state?.episodes?.[number]?.[kind];return own?.useOwnBackground&&own.backgroundAssetId||state?.templates?.[kind]?.backgroundAssetId||null;};

/** Classified writes retain source project/panel IDs and immutable history. */
export function createMokuProjectLibrary({dataDir,request,reader,getProject=()=>null,getAssets=()=>[],accountKey=async()=>''}){
 const file=path.join(dataDir,'moku-project-library.local.json');let state={version:1,projects:{},aliases:{},keys:{},uploads:{}};
 try{const saved=JSON.parse(fs.readFileSync(file,'utf8'));check(saved.version===1,'墨库分类同步记录版本无效');state={...state,...saved};}catch(e){if(e.code!=='ENOENT')throw e;}
 const persist=()=>writeFileAtomicSync(file,JSON.stringify(state)),read=async route=>(await request(route)).json();
 const key=value=>{const id=hash(JSON.stringify(value));if(!state.keys[id]){state.keys[id]=randomUUID();persist();}return state.keys[id];};
 const post=async(route,input,identity)=>request(route,{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':key([route,identity??input])},body:JSON.stringify(input)}).then(r=>r.json());
 function groups(project){
  const result=new Map(),declared=(project.productionPackage?.episodes||[]).map(e=>episodeNumber(e.episode)).filter(Boolean);
  for(const page of project.pages||[]){let n=episodeOf(project,page);if(!n&&declared.length===1)n=declared[0];if(!n&&page.designEpisodeRole)continue;check(n,'工程缺少明确的话号，请先补全画板所属话');if(!result.has(n))result.set(n,[]);for(const panel of page.panels||[])result.get(n).push({page,panel});}
  check(result.size,'工程没有带明确话号的画板');return [...result].sort((a,b)=>a[0]-b[0]);
 }
 const preparations=new Map(),uploadFlights=new Map();
 async function prepare(project,projectId){const identity=projectId+':'+project.id+':'+hash(JSON.stringify([(project.pages||[]).map(p=>[p.id,episodeOf(project,p),p.panels?.map(f=>f.id)]),project.episodeBoards])),cached=preparations.get(identity);if(cached&&cached.until>Date.now())return cached.promise;const promise=prepareFresh(project,projectId);preparations.set(identity,{until:Date.now()+30000,promise});if(preparations.size>8)preparations.delete(preparations.keys().next().value);try{return await promise;}catch(error){preparations.delete(identity);throw error;}}
 async function prepareFresh(project,projectId){
  check(uuid(projectId)&&project?.id,'墨库项目或本机工程身份无效');const grouped=groups(project),slotKey=projectId+':'+project.id;
  const saved=state.projects[slotKey]||={projectId,localId:project.id,episodes:{}};
  const episodes=(await read('/api/projects/'+projectId+'/episodes')).items||[],engineers=(await read('/api/project-library/'+projectId+'/engineerings')).items||[];
  for(const [number,panels]of grouped){
   const matches=episodes.filter(e=>!e.deletedAt&&(episodeNumber(e.episodeNumber)||episodeNumber(e.name))===number);check(matches.length<=1,'墨库有多个第'+number+'话，请先核对所属话');
   const episode=matches[0]||await post('/api/projects/'+projectId+'/episodes',{number:String(number)},['episode',projectId,number]);check(uuid(episode.id),'墨库未返回有效话编号');if(!matches.length)episodes.push(episode);
   const externalId=project.id+':episode:'+number,found=engineers.filter(e=>e.externalSystem==='comic-workbench-sync'&&e.externalId===externalId);check(found.length<=1,'同一工作台工程存在多个云端身份');
   const engineering=found[0]||await post('/api/project-library/'+projectId+'/engineerings',{episodeId:episode.id,name:(project.title+' · 第'+number+'话').slice(0,255),externalSystem:'comic-workbench-sync',externalId},['engineering',projectId,externalId]);
   check(engineering.episodeId===episode.id,'云端工程所属话已变化，未覆盖',409);if(!found.length)engineers.push(engineering);
   const entry=saved.episodes[number]||={panels:{}};Object.assign(entry,{episodeId:episode.id,engineeringId:engineering.id});
   const route='/api/project-library/'+projectId+'/engineerings/'+engineering.id,existing=(await read(route+'/panels')).items||[];
   for(const {page,panel}of panels){let cloud=existing.find(p=>p.externalId===panel.id);if(!cloud){cloud=await post(route+'/panels',{name:(panel.name||panel.productionSegment||page.name||panel.id).slice(0,255),externalId:panel.id,position:existing.length,state:{sourcePanelId:panel.id,sourcePageId:page.id,episode:number}},['panel',engineering.id,panel.id]);existing.push(cloud);}check(uuid(cloud.id),'墨库未返回有效格子编号');entry.panels[panel.id]=cloud.id;}
   entry.boards||={};for(const kind of ['cover','tail']){if(!boardBackground(project,kind,number))continue;const externalId=project.id+':episode:'+number+':'+kind;let cloud=existing.find(p=>p.externalId===externalId);if(!cloud){cloud=await post(route+'/panels',{name:kind==='cover'?'头图画板':'尾图画板',externalId,position:existing.length,state:{episode:number,boardKind:kind}},['board',engineering.id,externalId]);existing.push(cloud);}entry.boards[kind]=cloud.id;}
   entry.current=engineering;
  }
  persist();return {saved,grouped};
 }
 const rootRoute=(projectId,scopeId,kind,type)=>projectId===null?'/api/global-library/'+kind+'/'+type:'/api/project-library/'+projectId+'/'+scopeId+'/'+kind+'/'+type;
 async function upload(input){
  if(!await reader.supported())return null;
  check(Buffer.isBuffer(input?.bytes)&&input.bytes.length,'上传内容为空');
  const operationId=input.operationId??randomUUID();check(typeof operationId==='string'&&operationId.length>0&&operationId.length<=200&&!/[\x00-\x1f]/.test(operationId),'上传操作编号无效');
  const owner=await accountKey(),receiptKey=hash(JSON.stringify([owner,operationId])),{bytes:ignoredBytes,operationId:ignoredOperation,...intent}=input,intentFingerprint=hash(canonical([intent,hash(input.bytes)]));
  const prior=state.uploads[receiptKey],active=uploadFlights.get(receiptKey);
  if(prior)check(prior.intentFingerprint===intentFingerprint,'上传操作编号对应的分类或内容已变化，请新建操作',409);
  if(active){check(active.intentFingerprint===intentFingerprint,'上传操作编号对应的分类或内容已变化，请新建操作',409);return active.promise;}
  const promise=uploadFresh(input,{receiptKey,intentFingerprint});uploadFlights.set(receiptKey,{intentFingerprint,promise});
  try{return await promise;}finally{if(uploadFlights.get(receiptKey)?.promise===promise)uploadFlights.delete(receiptKey);}
 }
 async function uploadFresh(input,{receiptKey,intentFingerprint}){
  let {projectId,bytes,name,mime='application/octet-stream',assetKind,assetType,scopeId,episodeId,objectId,objectName,variantName,variantKind,engineeringId,panelId,tags=[],characterIds=[],sceneIds=[]}=input;
  assetType||=['character','scene','prop','pet','font','bubble','nameplate','sfx_text'].includes(input.category)?input.category:undefined;assetKind||=assetType==='font'?'file':undefined;
  check(assetType&&assetKind,'上传缺少明确分类，请提供文件或图片类型，未使用旧上传接口');if(['font','bubble','nameplate','sfx_text'].includes(assetType))projectId=null;
  scopeId=projectId===null?'global':scopeId||episodeId||'project';check(projectId===null||uuid(projectId),'墨库项目编号无效');check(projectId===null||scopeId==='project'||uuid(scopeId),'墨库话编号无效');check(Buffer.isBuffer(bytes)&&bytes.length,'上传内容为空');
  const route=rootRoute(projectId,scopeId,assetKind,assetType),sha256=hash(bytes);
  if(['character','scene','prop','pet'].includes(assetType)&&!objectId&&objectName){const found=(await read('/api/project-library/'+projectId+'/subjects')).items?.filter(o=>o.kind===assetType&&o.name===objectName)||[];check(found.length<=1,'同名资产对象不唯一，请先选择对象');objectId=found[0]?.id||(await post(route+'/objects',{name:objectName.slice(0,100)},['object',projectId,assetType,objectName])).id;}
  if(['character','scene'].includes(assetType))check(uuid(objectId),'上传人物或场景前必须明确所属对象');
  // Classified image uploads require the subject association as well as objectId.
  // Derive missing associations only from the resolved subject; preserve explicit choices.
  if(assetKind==='image'&&assetType==='scene'&&!sceneIds.length)sceneIds=[objectId];
  if(assetKind==='image'&&assetType==='character'&&!characterIds.length)characterIds=[objectId];
  if(input.assetId)check(uuid(input.assetId)&&Number.isInteger(input.objectVersion)&&input.objectVersion>0,'追加版本必须指定资产ID及当前对象版本');
  // Content and names verify a request; neither identifies a separate upload.
  const inputBody={name:String(name).slice(0,255),size:bytes.length,mime,tagDecision:tags.length?'provided':'none',tags,expectedSha256:sha256,sourceSystem:'comic-workbench-upload',sourceTaskId:receiptKey,sourceKind:'upload',...(input.assetId?{assetId:input.assetId,objectVersion:input.objectVersion}:{}),...(objectId?{objectId}:{}),...(characterIds.length?{characterIds}:{}),...(sceneIds.length?{sceneIds}:{}),...(variantName?{variantName:String(variantName).slice(0,100),variantKind:variantKind||(assetType==='character'?'outfit':'state')}:{}),...(engineeringId?{engineeringId}:{}),...(panelId?{panelId}:{})};
  const fingerprint=hash(JSON.stringify([route,inputBody]));
  const perform=async()=>{
   let receipt=state.uploads[receiptKey];if(receipt)check(receipt.fingerprint===fingerprint,'上传操作编号对应的分类或内容已变化，请新建操作',409);
   if(!receipt){const created=await post(route+'/uploads',inputBody,['upload',receiptKey]);check(uuid(created.id)&&Number(created.chunkSize)>0,'墨库未返回上传会话');receipt={id:created.id,chunkSize:Number(created.chunkSize),fingerprint,intentFingerprint};state.uploads[receiptKey]=receipt;persist();}
   const uploadRoute=route+'/uploads/'+receipt.id;let status=await read(uploadRoute);
   if(status.state==='uploading'){
    const existing=new Map((status.chunks||[]).map(c=>[c.index,c]));let advanced=false;
    for(let offset=0,index=0;offset<bytes.length;offset+=receipt.chunkSize,index++){
     const chunk=bytes.subarray(offset,Math.min(bytes.length,offset+receipt.chunkSize)),sha=hash(chunk);if(existing.get(index)?.sha256===sha&&Number(existing.get(index).size)===chunk.length)continue;
     try{await request(uploadRoute+'/chunks/'+index,{method:'PUT',body:chunk,headers:{'Content-Type':'application/octet-stream','X-Chunk-SHA256':sha}});}
     catch(error){if(error.code!=='UPLOAD_STATE')throw error;status=await read(uploadRoute);if(!['finalizing','completed'].includes(status.state))throw error;advanced=true;break;}
    }
    if(!advanced)await post(uploadRoute+'/complete',{},['complete',receipt.id]);
   }
   for(let attempt=0;attempt<180;attempt++){status=await read(uploadRoute);if(status.state==='completed')break;check(!['failed','cancelled'].includes(status.state),status.error||'墨库上传失败');await new Promise(r=>setTimeout(r,1000));}
   check(status.state==='completed','墨库上传尚未完成，请保留原会话后重试');const assetId=status.assetId||status.asset?.id,revisionId=status.revisionId||status.asset?.recommendedRevisionId;check(uuid(assetId)&&uuid(revisionId),'上传完成但未返回固定版本');
   const detail=await read(route+'/assets/'+assetId),revision=detail.revisions?.find(r=>r.id===revisionId)||await read(route+'/assets/'+assetId+'/revisions/'+revisionId);check(revision&&revision.sha256===sha256&&Number(revision.size)===bytes.length,'墨库入库原件摘要或长度不符',502);reader.remember({...detail,scopeId});
   return {assetId,revisionId,name:detail.name,detail,projectId,episodeId:projectId===null?null:scopeId==='project'?null:scopeId,scopeId,assetKind,assetType,engineeringId,panelId,sha256,folder:detail.folder||''};
  };
  return perform();
 }
 async function uploadContext(project,projectId,{assetId,role,episode}={}){
  if(!await reader.supported())return {};if(role==='font')return {projectId:null,assetKind:'file',assetType:'font'};
  if(episode!==undefined&&episode!==null&&String(episode).trim())check(episodeNumber(episode),'话号无效，请确认归属后重试');
  // An entire novel without an episode belongs to the project, including
  // multi-episode projects. Do not guess an episode for it.
  if(role==='novel'&&!episodeNumber(episode)){check(uuid(projectId),'墨库项目编号无效');return {projectId,scopeId:'project',assetKind:'file',assetType:'novel'};}
  // A texture or lettering image belongs to the global library even when it is
  // used inside a panel. Do this before preparing episode/panel identities.
  const bubbles=(project.pages||[]).flatMap(page=>page.bubbles||[]),source=getAssets().find(a=>a.id===assetId);
  const texture=!!assetId&&bubbles.some(b=>b.styleTextureAssetId===assetId),sfx=!!assetId&&bubbles.some(b=>b.visualAssetId===assetId&&(b.type==='sfx'||source?.comicKind==='sfx'||source?.source==='comic-sfx-design'));
  check(!(texture&&sfx),'同一图片同时被用作气泡和特效字，请分别登记用途');
  if(texture||sfx)return {projectId:null,scopeId:'global',assetKind:'image',assetType:texture?'bubble':'sfx_text'};
  const boardUses=assetId?groups(project).flatMap(([number])=>['cover','tail'].filter(kind=>boardBackground(project,kind,number)===assetId).map(kind=>({number,kind}))):[];
  if(boardUses.length){
   const kinds=[...new Set(boardUses.map(b=>b.kind))];check(kinds.length===1,'同一图片同时用作头图和尾图，请分别登记明确用途');const kind=kinds[0],origin=project.episodeBoards?.templates?.[kind]?.backgroundAssetId===assetId?project.episodeBoards.templates[kind].originEpisode:null;
   const number=episodeNumber(episode)||episodeNumber(origin)||(boardUses.length===1?boardUses[0].number:null);check(number,'这张共用头图或尾图用于多话，请在画板属性填写共用底图原归属话');check(!(project.pages||[]).some(p=>(p.panels||[]).some(f=>assetIds(f).has(assetId))),'同一原图同时用于头尾图和正文，请分别登记明确用途');
   const episodes=(await read('/api/projects/'+projectId+'/episodes')).items||[],matches=episodes.filter(e=>!e.deletedAt&&(episodeNumber(e.episodeNumber)||episodeNumber(e.name))===number);check(matches.length<=1,'墨库有多个第'+number+'话，请先核对所属话');const target=matches[0]||await post('/api/projects/'+projectId+'/episodes',{number:String(number)},['episode',projectId,number]);check(uuid(target.id),'墨库未返回有效话编号');return {projectId,scopeId:target.id,assetKind:'image',assetType:kind==='cover'?'header':'footer'};
  }
  const groups_=groups(project),matches=groups_.flatMap(([n,frames])=>frames.filter(({panel})=>assetIds(panel).has(assetId)).map(f=>({number:n,...f}))),requested=episodeNumber(episode);
  let selected;
  if(assetId){
   const direct=matches.filter(m=>m.panel.imageAssetId===assetId),candidates=matches.filter(m=>(m.panel.candidates||[]).includes(assetId)),owners=direct.length?direct:candidates;
   check(matches.length,'工程图片缺少对应格子，请明确关联后重试');
   check(owners.length,'本地图仅作为参考使用，无法确定资产类别；请先在墨库归档并选择对应固定版本');
   const eligible=owners.filter(m=>!requested||m.number===requested);check(eligible.length===1,'本地图同时属于多个格子或与所选话不一致，无法确定归属；请先在墨库明确所属格子并选择固定版本');selected=eligible[0];
  }
  const number=requested||selected?.number||(groups_.length===1?groups_[0][0]:null);check(number,'工程附图或原件缺少明确话归属，未猜测分类');
  const {saved,grouped}=await prepare(project,projectId);check(saved.episodes[number],'工程附图或原件缺少明确话归属，未猜测分类');const entry=saved.episodes[number],frame=selected||grouped.find(([n])=>n===number)[1][0];
  if(['storyboard','novel','production_table'].includes(role))return {projectId,scopeId:entry.episodeId,assetKind:'file',assetType:role};check(frame&&matches.length,'工程图片缺少对应格子，请明确关联后重试');
  const characterIds=new Set(),sceneIds=new Set();for(const id of assetIds(frame.panel)){const asset=getAssets().find(a=>a.id===id);if(!asset?.library?.assetId||!['character','scene'].includes(asset.library.assetType||asset.library.category))continue;const response=await reader.handle('/api/assets/'+asset.library.assetId),detail=response&&await response.json();if(detail?.projectId!==projectId)continue;const target=detail.assetType==='character'?characterIds:sceneIds;for(const ref of [detail.objectId,...detail.characterIds||[],...detail.sceneIds||[]])if(uuid(ref))target.add(ref);}
  check(characterIds.size||sceneIds.size,'本格尚未关联本项目的人物或场景，请先绑定明确的参考资产');return {projectId,scopeId:entry.episodeId,assetKind:'image',assetType:'comic_panel',engineeringId:entry.engineeringId,panelId:entry.panels[frame.panel.id],characterIds:[...characterIds],sceneIds:[...sceneIds]};
 }
 function projectTarget(content,input,alias){
  if(uuid(input.projectId))return input.projectId;const link=state.aliases[alias];if(link)return link.projectId;
  for(const relative of ['project-sync.local.json','teamwork/local.json'])try{const s=JSON.parse(fs.readFileSync(path.join(dataDir,relative),'utf8')),item=(s.projects||s.links)?.[content.projectId];if(uuid(item?.remoteProjectId))return item.remoteProjectId;}catch{}
  const direct=content.project?.assetLibrary?.mokuProjectId||content.project?.mokuProjectId;check(uuid(direct),'缺少对应的墨库项目，请在同步设置指定项目');return direct;
 }
 function registerReferences(content){for(const item of [...content.assets||[],...content.originals||[],...content.fonts||[]]){const ref=item.library||item;if(ref?.assetKind&&ref.assetType)reader.remember({...ref,id:ref.assetId,recommendedRevisionId:ref.revisionId});}const p=content.payload;if(content.version===3&&p?.assetId)reader.remember({...p,id:p.assetId,recommendedRevisionId:p.revisionId});}
 async function saveDocument(input,alias){
  const content=await decodeProjectSnapshot(input.content,{remote:async route=>await reader.handle(route)||request(route)});check(content.project?.id===content.projectId,'工程快照身份不符');
  const projectId=projectTarget(content,input,alias),{saved,grouped}=await prepare(content.project,projectId),previous=state.aliases[alias];if(previous&&Number.isInteger(input.objectVersion))check(input.objectVersion===previous.objectVersion,'墨库工程版本冲突',409);
  const compressed=await encodeProjectSnapshot(content,null,{inlineOnly:true}),baseContent={...compressed.content,mokuDocumentType:input.type||previous?.type||'engineering.snapshot'},receipts=[];
  for(const [number,frames]of grouped){
   const entry=saved.episodes[number],route='/api/project-library/'+projectId+'/engineerings/'+entry.engineeringId,engineers=(await read('/api/project-library/'+projectId+'/engineerings')).items||[],engineer=engineers.find(e=>e.id===entry.engineeringId);check(engineer,'云端工程不存在');let current;if(engineer.currentSnapshotId)current=await read(route+'/snapshots/'+engineer.currentSnapshotId);
   if(current?.content?.stableHash===content.stableHash){Object.assign(entry,{stableHash:content.stableHash,snapshotId:current.id,objectVersion:engineer.objectVersion});persist();receipts.push({number,engineeringId:engineer.id,snapshotId:current.id,objectVersion:engineer.objectVersion});continue;}if(current)check(current.content?.stableHash===entry.stableHash||current.content?.stableHash===previous?.remoteHash,'云端工程已被其他窗口修改，请先取回并合并',409);
   const refs=new Map();for(const {panel,page}of frames){for(const bubble of page.bubbles||[]){if((bubble.parentPanelId||page.panels?.[0]?.id)!==panel.id)continue;const style=bubble.styleLibrary;if(!uuid(style?.assetId)||!uuid(style?.revisionId))continue;const ref={panelId:entry.panels[panel.id],assetId:style.assetId,revisionId:style.revisionId,role:'reference'};refs.set([ref.panelId,ref.revisionId].join(':'),ref);}const used=assetIds(panel);for(const bubble of page.bubbles||[])if((bubble.parentPanelId||page.panels?.[0]?.id)===panel.id)assetIds(bubble,used);for(const a of content.assets||[]){if(!used.has(a.id)||!uuid(a.library?.assetId)||!uuid(a.library?.revisionId))continue;const ref={panelId:entry.panels[panel.id],assetId:a.library.assetId,revisionId:a.library.revisionId,role:'reference'};refs.set([ref.panelId,ref.revisionId].join(':'),ref);}}
   for(const kind of ['cover','tail']){const id=boardBackground(content.project,kind,number),a=content.assets?.find(a=>a.id===id);if(!a?.library?.assetId)continue;const ref={panelId:entry.boards[kind],assetId:a.library.assetId,revisionId:a.library.revisionId,role:'reference'};refs.set([ref.panelId,ref.revisionId].join(':'),ref);}
   // All resources in the saved document must remain restorable, including fonts,
   // project references, source documents and images outside this episode.
   const anchor=entry.panels[frames[0]?.panel.id];
   for(const ref of fixedResourceReferences(content)){if(![...refs.values()].some(r=>r.revisionId===ref.revisionId)){check(anchor,'工程缺少资源引用格子');refs.set(anchor+':'+ref.revisionId,{panelId:anchor,assetId:ref.assetId,revisionId:ref.revisionId,role:'reference'});}}
   const subjectIds={characterIds:[],sceneIds:[]};
   let engineeringAsset;if(engineer.assetId)engineeringAsset=await read(rootRoute(projectId,entry.episodeId,'file','comic_project')+'/assets/'+engineer.assetId);
   if(engineeringAsset){subjectIds.characterIds=engineeringAsset.characterIds||[];subjectIds.sceneIds=engineeringAsset.sceneIds||[];}
   else if(input.classification){for(const kind of ['characterIds','sceneIds']){check(Array.isArray(input.classification[kind])&&input.classification[kind].every(uuid),'请选择明确的角色或场景');subjectIds[kind]=[...new Set(input.classification[kind])];}}
   else for(const ref of refs.values()){const response=await reader.handle('/api/assets/'+ref.assetId),detail=response&&await response.json();if(detail?.projectId!==projectId)continue;for(const kind of ['characterIds','sceneIds'])subjectIds[kind].push(...detail[kind]||[]);}
   for(const kind of ['characterIds','sceneIds'])subjectIds[kind]=[...new Set(subjectIds[kind])];
   const needsFile=Buffer.byteLength(JSON.stringify(baseContent))>SNAPSHOT_REQUEST_BUDGET||!engineer.assetId&&input.classification;
   let wire={...baseContent,moku:{projectId,engineeringId:entry.engineeringId}},engineeringRevisionId;if(needsFile){const bytes=Buffer.from(JSON.stringify(wire)),sent=await upload({projectId,scopeId:entry.episodeId,assetKind:'file',assetType:'comic_project',engineeringId:entry.engineeringId,operationId:'snapshot:'+hash(JSON.stringify([projectId,entry.engineeringId,content.stableHash,engineer.objectVersion])),...subjectIds,...(engineeringAsset?{assetId:engineeringAsset.id,objectVersion:engineeringAsset.objectVersion}:{}),name:'工程快照_'+content.stableHash.slice(0,12)+'.json',mime:'application/json',bytes});engineeringRevisionId=sent.revisionId;wire={format:content.format,version:3,projectId:content.projectId,title:content.title,stableHash:content.stableHash,mokuDocumentType:baseContent.mokuDocumentType,payload:{encoding:'json',storage:'asset',assetId:sent.assetId,revisionId:sent.revisionId,sha256:hash(bytes),size:bytes.length,projectId,scopeId:entry.episodeId,episodeId:entry.episodeId,assetKind:'file',assetType:'comic_project'}};}
   const result=await post(route+'/snapshots',{objectVersion:engineer.objectVersion,content:wire,references:[...refs.values()],tagDecision:'none',...(engineeringRevisionId?{engineeringRevisionId}:{})},['snapshot',entry.engineeringId,content.stableHash,engineer.objectVersion]);check(uuid(result.snapshotId)&&Number.isInteger(result.objectVersion),'墨库未返回保存回执');entry.stableHash=content.stableHash;entry.snapshotId=result.snapshotId;entry.objectVersion=result.objectVersion;persist();receipts.push({number,engineeringId:entry.engineeringId,snapshotId:result.snapshotId,objectVersion:result.objectVersion});
  }
  const root=receipts[0],id=alias||root.engineeringId,record={projectId,engineeringId:root.engineeringId,localId:content.projectId,objectVersion:root.objectVersion,type:baseContent.mokuDocumentType,receipts};state.aliases[id]=record;state.aliases[root.engineeringId]=record;persist();registerReferences(content);return {id,projectId,name:input.name,type:record.type,objectVersion:root.objectVersion,content:baseContent,engineeringId:root.engineeringId,snapshots:receipts};
 }
 async function locateDocument(id){if(state.aliases[id])return state.aliases[id];for(const p of (await read('/api/projects')).items||[])for(const e of (await read('/api/project-library/'+p.id+'/engineerings')).items||[])if(e.id===id)return {projectId:p.id,engineeringId:id,objectVersion:e.objectVersion};return null;}
 async function readDocument(id){
  const ref=await locateDocument(id);if(!ref)return null;const engineers=(await read('/api/project-library/'+ref.projectId+'/engineerings')).items||[],engineer=engineers.find(e=>e.id===ref.engineeringId);check(engineer?.currentSnapshotId,'此工程尚未保存快照',404);const snapshot=await read('/api/project-library/'+ref.projectId+'/engineerings/'+engineer.id+'/snapshots/'+engineer.currentSnapshotId);registerReferences(snapshot.content);const decoded=await decodeProjectSnapshot(snapshot.content,{remote:async route=>await reader.handle(route)||request(route)});registerReferences(decoded);state.aliases[id]={...ref,objectVersion:engineer.objectVersion,remoteHash:decoded.stableHash};persist();return {id,projectId:ref.projectId,name:engineer.name,type:snapshot.content.mokuDocumentType||ref.type||'engineering.snapshot',objectVersion:engineer.objectVersion,content:{...snapshot.content,moku:{projectId:ref.projectId,engineeringId:engineer.id}},restoreSnapshots:[{projectId:ref.projectId,engineeringId:engineer.id,snapshotId:snapshot.id}]};
 }
 return {upload,uploadContext,snapshotTargets(localId,projectId){return Object.values(state.projects[projectId+':'+localId]?.episodes||{}).filter(e=>e.snapshotId).map(e=>({projectId,engineeringId:e.engineeringId,snapshotId:e.snapshotId}));},clear(){preparations.clear();},async handle(route,options={}){
  const method=options.method||'GET',url=new URL(route,'http://local'),document=/^\/api\/documents\/([a-f0-9-]{36})$/i.exec(url.pathname),list=/^\/api\/projects\/([a-f0-9-]{36})\/documents$/i.exec(url.pathname);
  if(!(url.pathname==='/api/documents'&&method==='POST'||document&&['GET','PUT'].includes(method)||list&&method==='GET'))return null;if(!await reader.supported())return null;
  if(method==='POST'||method==='PUT')return json(await saveDocument(JSON.parse(options.body),document?.[1]));if(document){const value=await readDocument(document[1]);return value?json(value):null;}const values=[];for(const e of (await read('/api/project-library/'+list[1]+'/engineerings')).items||[])if(e.currentSnapshotId){const value=await readDocument(e.id);if(value)values.push(value);}return json({items:values});
 }};
}
