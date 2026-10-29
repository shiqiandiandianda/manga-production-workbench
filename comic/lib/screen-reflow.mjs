import {episodeRuleRequest} from '../public/layout-rule-choice.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {productionFrame,productionSourceAsset} from '../public/production-package-model.js';
import {assertNativeAspect} from '../public/unified-layout-rules.js';
import {prepareEpisodeReflow} from './reflow-preparation.mjs';
import {availableReflowEpisodes} from '../public/reflow-episode-context.mjs';
import {tightenedArtworkView} from '../public/artwork-framing.mjs';
import {inspectImageFile} from './image-files.mjs';
import {buildReflowProject,mergeReflowIntoOriginal} from '../public/auto-layout-reflow.mjs';
import {returnReflowToCanvas} from '../public/reflow-canvas.mjs';
import {sampleArtworkPalette} from './artwork-palette.mjs';
import {commitLayoutCanvas} from './layout-canvas-return.mjs';
import {addReflowPaletteExclusions,addSceneReferencePalettes,buildReflowWithLocalBackgrounds} from './reflow-background-context.mjs';
import {LOCAL_BACKGROUND_POLICY} from '../public/local-background-policy.js';
import {restoreLegacyReflowScreenBoards} from '../public/reflow-screen-boards.mjs';

const sha=v=>createHash('sha256').update(v).digest('hex');
const stamp=f=>JSON.stringify([f.x,f.y,f.w,f.h,f.points,f.imageAssetId,f.imageTransform,f.packageCutout]);
const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const active=new Set(['queued','preparing','running','recoverable','awaiting_confirmation','delegated']);
const fail=(message,status=409)=>{throw Object.assign(Error(message),{status});};

export function createScreenReflow({store,dataDir,body,json,request,addAsset,validateProject,checkAssets,saveProject,samplePalette=sampleArtworkPalette}){
 const slices=path.join(dataDir,'panel-slices'),directory=path.join(dataDir,'auto-layout-reflow');let busy=false;
 const batchPath=id=>{if(!uuid.test(id))fail('重排批次编号无效',400);return path.join(directory,id+'.json');};
 const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
 function context(project,episode,revision){
  if(project.autoLayoutSource?.mode==='screen-crop-reflow'&&Number(episode)!==Number(project.autoLayoutSource.episode))fail('当前重排画布为第'+project.autoLayoutSource.episode+'话，请从当前话继续重排',400);
  if(project.revision!==revision)fail('原工程已有修改，请刷新成图裁格清单');
  const ep=project.productionPackage?.episodes.find(e=>e.episode===Number(episode));if(!ep)fail('请选择已有整屏成图的制作资料工程与话数',400);
  const panelIds=new Set(ep.segments.flatMap(s=>[s.panelId,...project.pages.flatMap(p=>p.panels).filter(f=>f.cutoutLayer?.parentPanelId===s.panelId).map(f=>f.id)]));
  const frames=project.pages.flatMap(p=>p.panels);
  for(const f of frames)if(ep.segments.some(s=>f.panelSlice?.segmentId===s.id||f.productionGrid?.segmentId===s.id))panelIds.add(f.id);
  let changed=true;while(changed){changed=false;for(const f of frames)if(!panelIds.has(f.id)&&panelIds.has(f.cutoutLayer?.parentPanelId)){panelIds.add(f.id);changed=true;}}
  if(store.db.jobs.some(j=>j.projectId===project.id&&panelIds.has(j.panelId)&&active.has(j.status)))fail('本话仍有生成任务，请完成后再裁格重排');
  return ep;
 }
 function recordFor(project,ep,segment,id,{verifyFiles=false}={}){
  if(!uuid.test(id))fail('裁格记录编号无效',400);
  const folder=path.join(slices,id),file=path.join(folder,'manifest.json');if(!fs.existsSync(file))fail('裁格记录已不存在，请重新确认');const r=read(file);
  const root=productionFrame(project,segment.id),source=project.pages.flatMap(p=>p.panels).find(f=>f.id===r.sourcePanelId),expected=ep.panelRecords.filter(p=>p.segmentId===segment.id).map(p=>p.id);
  if(!root||!source||r.projectId!==project.id||r.segmentId!==segment.id||r.packageHash!==project.productionPackage.hash||r.originalAssetId!==productionSourceAsset(root)||r.rootStamp!==stamp(root)||r.frameStamp!==stamp(source)||r.sourceAssetId!==(source.id===root.id?productionSourceAsset(root):source.imageAssetId)||!Array.isArray(r.files)||JSON.stringify(r.expected)!==JSON.stringify(expected)||JSON.stringify(r.files.map(f=>f.panelId))!==JSON.stringify(expected))fail('裁格来源或格号已改变，请重新确认 '+segment.localId);
  if(source.id!==root.id&&!(source.cutoutLayer?.kind==='upscale'&&source.cutoutLayer.parentPanelId===root.id&&source.cutoutLayer.sourceAssetId===productionSourceAsset(root)))fail('高清图已不属于当前整屏原图');
  const sourceFile=store.assetPath(r.sourceAssetId);if(!fs.existsSync(sourceFile))fail('整屏来源图片无法读取');
  if(verifyFiles&&sha(fs.readFileSync(sourceFile))!==r.sourceHash)fail('整屏来源图片内容发生变化，请重新裁格');
  for(const f of r.files){
   if(path.basename(f.name)!==f.name||!/^[-\w]+\.png$/.test(f.name)||!Number.isInteger(f.width)||!Number.isInteger(f.height)||f.width<2||f.height<2)fail('裁格文件记录无效');
   const p=path.join(folder,f.name);if(!fs.existsSync(p)||verifyFiles&&sha(fs.readFileSync(p))!==f.sha256)fail('裁格图片已改变或缺失，请重新确认 '+f.panelId);
   if(verifyFiles){let image;try{image=inspectImageFile(p);}catch{fail('裁格图片无法读取，请重新确认 '+f.panelId);}if(image.mime!=='image/png'||image.width!==f.width||image.height!==f.height)fail('裁格实际像素尺寸与确认记录不一致，请重新确认 '+f.panelId);}
  }
  for(const f of r.files)if(f.existingPanelId){const current=project.pages.flatMap(p=>p.panels).find(p=>p.id===f.existingPanelId);if(!current||current.visible===false||current.imageAssetId!==f.existingAssetId||stamp(current)!==f.existingFrameStamp||verifyFiles&&sha(fs.readFileSync(store.assetPath(f.existingAssetId)))!==f.sha256)fail('已有裁格已修改，请重新读取本话排版清单：'+f.panelId);}
  return r;
 }
 function latestRecords(project,ep){
  const found=new Map();if(!fs.existsSync(slices))return found;
  const candidates=fs.readdirSync(slices).filter(id=>uuid.test(id)).map(id=>{try{const r=read(path.join(slices,id,'manifest.json'));return r.files&&r.projectId===project.id?r:null;}catch{return null;}}).filter(Boolean).sort((a,b)=>b.created.localeCompare(a.created)||b.id.localeCompare(a.id));
  for(const r of candidates){const segment=ep.segments.find(s=>s.id===r.segmentId);if(!segment||found.has(segment.id))continue;try{recordFor(project,ep,segment,r.id,{verifyFiles:true});found.set(segment.id,r.id);}catch{}}
  return found;
 }
 async function plan(project,input){
  const ep=context(project,input.episode,input.expectedRevision),records=latestRecords(project,ep);let learning={projects:[]},library={projects:[]};try{learning=await request('/api/state');library=await request('/api/library');}catch{}
  const rules=await request('/api/integration/rules');
  return {binding:project.layoutRuleBindings?.[ep.episode]||null,rules:rules.entries,projectId:project.id,revision:project.revision,episode:ep.episode,episodes:availableReflowEpisodes(project).map(e=>({episode:e.episode,title:e.title})),segments:ep.segments.map(s=>{const f=productionFrame(project,s.id),raw=productionSourceAsset(f),count=ep.panelRecords.filter(p=>p.segmentId===s.id).length;return {id:s.id,label:s.localId,scene:s.scene,count,hasImage:!!raw,assetId:raw,recordId:records.get(s.id)||null};}),learningProjects:(learning.projects||[]).map(p=>({id:p.id,name:p.name,aliases:p.aliases||[],activeVersion:library.projects.find(l=>l.id===p.id)?.activeVersion||null})),noImageGeneration:true};
 }
 async function source(project,input){
  if(input.uniformFraming!==undefined&&typeof input.uniformFraming!=='boolean')fail('等比取景标记无效',400);
  if(input.forceNew!==undefined&&typeof input.forceNew!=='boolean')fail('重新排版标记无效',400);
  const initialProjectHash=sha(JSON.stringify(project));
  const ep=context(project,input.episode,input.expectedRevision),binding=project.layoutRuleBindings?.[ep.episode],ruleRequest=episodeRuleRequest(binding,input.learningProjectId);
  if(!Array.isArray(input.records)||input.records.length!==ep.segments.length||new Set(input.records.map(r=>r.segmentId)).size!==ep.segments.length)fail('请先完成本话所有整屏的裁格确认',400);
  const selected=new Map(input.records.map(r=>[r.segmentId,r.recordId])),records=ep.segments.map(s=>{if(!selected.has(s.id))fail('缺少裁格确认：'+s.localId,400);return recordFor(project,ep,s,selected.get(s.id),{verifyFiles:true});});
  const items=ep.panelRecords.map(record=>{const r=records.find(r=>r.segmentId===record.segmentId),f=r.files.find(f=>f.panelId===record.id);if(!f)fail('裁图与源格号无法一一对应：'+record.id);return {...f,cropKey:f.key,key:record.id,segmentId:record.segmentId,recordId:r.id,filePath:path.join(slices,r.id,f.name),sourceAssetId:r.sourceAssetId,sourceHash:r.sourceHash,sourcePanelId:r.sourcePanelId,rootPanelId:r.rootPanelId,sourceWidth:r.width,sourceHeight:r.height};}).map(item=>{const current=item.existingPanelId&&project.pages.flatMap(p=>p.panels).find(p=>p.id===item.existingPanelId),flat=item.width>item.height,cover=!!input.uniformFraming&&!current,preserve=!!current,tighten=!!input.uniformFraming&&current?tightenedArtworkView(current,item):null;
   if(cover&&(current?.imageTransform?.rotation||current?.imageTransform?.flipX||current?.imageTransform?.flipY))fail('带旋转或翻转的画格先保留当前取景，请单独核对后再启用竖格修正：'+item.key);
   return {...item,preserveCurrentView:preserve,tightenCurrentView:tighten,currentFrame:current?structuredClone(tighten?{w:tighten.w,h:tighten.h,imageTransform:tighten.imageTransform}:{w:current.w,h:current.h,imageTransform:current.imageTransform}):undefined,artworkLayout:preserve?{version:1,fit:'preserve',framePolicy:'fixed',width:tighten?.w||current.w,height:tighten?.h||current.h,...(tighten?{tighten:true,repairPolicyVersion:2}:{})}:cover?{version:1,fit:'frame-to-artwork',framePolicy:'rules',actualFlat:flat,repairPolicyVersion:2}:undefined};});
  if(!items.length||items.length>800||new Set(items.map(i=>i.key)).size!==items.length)fail('本话源格ID重复或格数超过800',400);
  for(const item of items){addReflowPaletteExclusions(project,item);item.palette=await samplePalette(item);}
  const contract=await request('/api/integration/rules/resolve',ruleRequest);
  context(store.project(project.id),input.episode,input.expectedRevision);if(sha(JSON.stringify(store.project(project.id)))!==initialProjectHash)fail('读取来源期间工程已变化，请重新读取');
  const batchKey=sha(JSON.stringify({project:sha(JSON.stringify(project)),style:contract.digest,framing:items.map(i=>i.artworkLayout||null),records:records.map(r=>[r.id,r.segmentId,r.sourceHash,r.sourcePanelId,r.rootStamp,r.frameStamp,r.width,r.height]),images:items.map(i=>[i.key,i.sha256,i.width,i.height,i.sourceWidth,i.sourceHeight,i.pixels,i.region])}));
  if(!input.forceNew&&fs.existsSync(directory))for(const name of fs.readdirSync(directory).filter(n=>n.endsWith('.json')).sort((a,b)=>fs.statSync(path.join(directory,b)).mtimeMs-fs.statSync(path.join(directory,a)).mtimeMs)){let cached;try{cached=read(path.join(directory,name));if(!cached.scriptId||cached.batchKey!==batchKey&&!(cached.projectHash===sha(JSON.stringify(project))&&JSON.stringify(cached.items)===JSON.stringify(items)&&JSON.stringify(cached.contract)===JSON.stringify(contract)))continue;const script=await request('/api/scripts/'+cached.scriptId);if(script.studioSource?.reflowBatchId===cached.id&&JSON.stringify(script.shots)===JSON.stringify(cached.shots)&&JSON.stringify(script.layoutRuleContract)===JSON.stringify(contract))return {id:cached.id,scriptId:cached.scriptId,count:cached.items.length,episode:cached.episode,noImageGeneration:true,reused:true};}catch{}}
  const id=randomUUID(),snapshot=structuredClone(project),shots=ep.panelRecords.map((r,i)=>{
   const existing=project.shots.find(s=>s.productionGridId===r.id&&s.productionSliceSegment===r.segmentId),raw=r.original||{},p=r.production||{},texts=ep.texts.filter(t=>t['格ID']===r.id);
   return {...(existing?structuredClone(existing):{}),key:r.id,code:r.id,title:r.id,description:existing?.description??String(raw['画面内容']||p['画面内容']||''),productionPrompt:existing?.productionPrompt??String(raw['生图提示词']||p['生图提示词']||''),dialogue:existing?.dialogue||texts.map(t=>t['文本']).join('\n'),characters:raw['出现角色']||p['出现角色']||[],location:existing?.location||raw['当前场景']||p['当前场景']||'',time:existing?.time||raw['当前时间']||p['当前时间']||'',shotSize:existing?.shotSize||raw['景别']||p['景别']||'',cameraAngle:existing?.cameraAngle||raw['机位角度']||p['机位角度']||'',sourceFields:structuredClone(raw),productionGridId:r.id,productionSliceSegment:r.segmentId,artworkLayout:items[i].artworkLayout,existingArtwork:{width:items[i].width,height:items[i].height,sha256:items[i].sha256,aspectRatio:items[i].width/items[i].height,policy:items[i].artworkLayout?'reuse-native-image-uniform-view-no-regeneration':'reuse-cropped-image-contain-no-regeneration'},sourceLocation:existing?.sourceLocation||[r.source?.file,r.source?.pointer].filter(Boolean).join(' '),productionSourceRecord:structuredClone(r.source||{})};
  });
  for(const item of items)await addSceneReferencePalettes(project,item,shots.find(s=>s.key===item.key),store,samplePalette);
  const batch={version:2,contract,id,batchKey,projectId:project.id,revision:project.revision,episode:ep.episode,projectHash:sha(JSON.stringify(project)),project:snapshot,items,shots,created:new Date().toISOString()};fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(batchPath(id),JSON.stringify(batch));
  try{const result=await request('/api/integration/import',{projectId:project.id,revision:project.revision,title:project.title+' · 第'+ep.episode+'话成图重排',episode:ep.episode,shots,learningProjectId:contract.id,layoutRuleContract:contract,reflowBatchId:id});batch.scriptId=result.id;fs.writeFileSync(batchPath(id),JSON.stringify(batch));return {id,scriptId:result.id,count:items.length,episode:ep.episode,noImageGeneration:true};}catch(e){batch.error=e.message;fs.writeFileSync(batchPath(id),JSON.stringify(batch));throw e;}
 }
 function verifyBatch(script,packet){
  const batch=read(batchPath(script.studioSource.reflowBatchId)),original=store.project(batch.projectId);context(original,batch.episode,batch.revision);
  if(batch.scriptId!==script.id||batch.projectHash!==sha(JSON.stringify(original))||JSON.stringify(batch.shots)!==JSON.stringify(script.shots))fail('原工程或固定分镜快照发生变化，请重新送入裁图');
  const ep=original.productionPackage.episodes.find(e=>e.episode===batch.episode);for(const r of new Map(batch.items.map(i=>[i.segmentId,i.recordId])).entries())recordFor(original,ep,ep.segments.find(s=>s.id===r[0]),r[1],{verifyFiles:true});
  if(batch.contract&&JSON.stringify(batch.contract)!==JSON.stringify(script.layoutRuleContract))fail('排版规则快照已改变');
  if(batch.items.some(i=>i.artworkLayout?.fit==='contain'))fail('旧版留白取景方案已停用，请重新读取来源并计算铺满预览；当前画布未修改');
  assertNativeAspect(script,packet);
  return batch;
 }
 async function importResult(script,packet,viewRequest){
  let batch=read(batchPath(script.studioSource.reflowBatchId));const views=validatedViews(batch,packet,viewRequest),digest=sha(JSON.stringify({packet,views,backgroundPolicyVersion:LOCAL_BACKGROUND_POLICY.version}));
  const current=store.project(batch.projectId);
  // Batches committed by earlier host releases remain idempotent.
  const legacyDigest=sha(JSON.stringify({packet,views}));
  if(batch.results?.[legacyDigest]===current.id&&current.episodeReflows?.[batch.episode]?.batchId===batch.id)return current;
  if(batch.canvasResults?.[digest]===current.id||current.layoutCanvasReturn?.batchId===batch.id&&current.layoutCanvasReturn?.digest===digest)return current;
  batch=verifyBatch(script,packet);const before=new Set(store.db.assets.map(a=>a.id));
  try{
   const items=batch.items.map(item=>({...item,asset:item.existingAssetId?store.asset(item.existingAssetId):addAsset(item.filePath,item.key+' · 成图裁格重排','auto-layout-crop')}));
   // Older batches predate color observations. Resolve them from their verified crop files as well.
   for(const item of items){addReflowPaletteExclusions(batch.project,item);if(item.palette?.version!==2)item.palette=await samplePalette(item);await addSceneReferencePalettes(batch.project,item,batch.shots.find(s=>s.key===item.key),store,samplePalette);}
   verifyBatch(script,packet);
   const original=store.project(batch.projectId),boardSource=restoreLegacyReflowScreenBoards(original).project;
   const {geometry,rendered}=buildReflowWithLocalBackgrounds({original:boardSource,script,packet,items,batchId:batch.id,views});
   if(script.shots.some(s=>s.artworkLayout?.repairPolicyVersion===2)&&rendered.autoLayoutSource.pendingText?.some(t=>boardSource.pages.some(p=>p.bubbles.some(b=>b.visible!==false&&b.productionTextId===t.textId))))fail('取景中的工具文字尚未完成定位，当前画布已保留：'+rendered.autoLayoutSource.pendingText.map(t=>t.gridId).join('、'));
   const next=returnReflowToCanvas(boardSource,rendered,{episode:batch.episode,items,geometry,script,batchId:batch.id});
   const saved=commitLayoutCanvas({store,dataDir,original,next,validateProject,checkAssets,saveProject,receipt:{batchId:batch.id,digest,episode:batch.episode,scriptId:script.id}});
   batch.canvasResults||={};batch.canvasResults[digest]=saved.id;
   // A receipt failure must not roll back a canvas which was already saved successfully.
   try{fs.writeFileSync(batchPath(batch.id)+'.tmp',JSON.stringify(batch));fs.renameSync(batchPath(batch.id)+'.tmp',batchPath(batch.id));}catch{}
   return saved;
  }catch(e){store.db.assets=store.db.assets.filter(a=>before.has(a.id));store.save();throw e;}
 }
 function validatedViews(batch,packet,input){
  if(!input)return {};
  if(input.backgroundPolicyVersion!==LOCAL_BACKGROUND_POLICY.version)fail('底色规则已更新，请重新读取取景预览后再接回');
  if(input.projectId!==batch.projectId||input.revision!==batch.revision||input.packetHash!==sha(JSON.stringify(packet))||!Array.isArray(input.views)||input.views.length>batch.items.length)fail('取景预览已过期或来源不符，请重新读取');
  const views={};for(const v of input.views){const item=batch.items.find(i=>i.key===v.key);if(!item||item.artworkLayout?.fit!=='cover'||views[v.key])fail('取景格号无效',400);if(![v.focusX,v.focusY,v.zoom].every(Number.isFinite)||v.focusX<0||v.focusX>1||v.focusY<0||v.focusY>1||v.zoom<1||v.zoom>3)fail('取景范围无效',400);views[v.key]={focusX:v.focusX,focusY:v.focusY,zoom:v.zoom};}return views;
 }
 async function preview(input){
  if(typeof input.scriptId!=='string'||!/^[-\w]{1,90}$/.test(input.scriptId))fail('排版来源无效',400);
  const script=await request('/api/scripts/'+input.scriptId),draft=await request('/api/drafts/'+input.scriptId),{packet}=await request('/api/export',{id:script.id,packet:draft}),batch=verifyBatch(script,packet);
  if(input.projectId!==batch.projectId||input.expectedRevision!==batch.revision)fail('取景预览来源已变化');
  const items=batch.items.map((item,index)=>({...item,asset:item.existingAssetId?store.asset(item.existingAssetId):{id:'preview_'+index,width:item.width,height:item.height}}));
  for(const item of items){addReflowPaletteExclusions(batch.project,item);if(item.palette?.version!==2)item.palette=await samplePalette(item);await addSceneReferencePalettes(batch.project,item,batch.shots.find(s=>s.key===item.key),store,samplePalette);}
  verifyBatch(script,packet);
  const {geometry,rendered:next}=buildReflowWithLocalBackgrounds({original:batch.project,script,packet,items,batchId:batch.id});
  return {project:next,projectId:batch.projectId,revision:batch.revision,scriptId:script.id,packetHash:sha(JSON.stringify(packet)),backgroundStatus:geometry.generator?.backgrounds,backgroundPolicyVersion:LOCAL_BACKGROUND_POLICY.version,backgroundDecisions:geometry.artworkPaletteDecisions,imageUrls:Object.fromEntries(items.map((item,index)=>[item.asset.id,'/api/auto-layout/reflow/image/'+batch.id+'/'+index])),frames:items.map(i=>({key:i.key,width:i.width,height:i.height,fit:i.artworkLayout?.fit||'contain',currentFrame:i.currentFrame,view:next.pages[0].panels.find(f=>f.visible!==false&&f.panelSlice?.panelId===i.key)?.autoLayoutCrop?.view})),imageGenerationCalls:0};
 }
 function mergeExisting(input){
  const derived=store.project(input.projectId),ref=derived.autoLayoutSource;
  if(ref?.mode!=='screen-crop-reflow'||!ref.sourceProjectId||ref.sourceProjectId===derived.id)fail('不是可接回的成图重排工程',400);
  if(derived.revision!==input.expectedRevision)fail('重排工程刚有新修改，请重新打开后再接回');
  const original=store.project(ref.sourceProjectId);if(original.revision!==ref.sourceRevision)fail('来源工程在重排后已有修改，未覆盖，请先核对两份工程');
  if(store.db.jobs.some(j=>[original.id,derived.id].includes(j.projectId)&&active.has(j.status)))fail('来源或重排工程仍有任务，请完成后再接回');
  const next=mergeReflowIntoOriginal(original,derived,ref.episode);validateProject(next);checkAssets(next);
  const backupDir=path.join(dataDir,'backups');fs.mkdirSync(backupDir,{recursive:true});for(const p of [original,derived]){const file=path.join(backupDir,p.id+'_before_reflow_merge_'+p.revision+'.json');if(!fs.existsSync(file))fs.writeFileSync(file,JSON.stringify(p),{flag:'wx'});}
  const index=store.db.projects.indexOf(original),derivedRevision=derived.revision;store.db.projects[index]=next;
  try{const saved=saveProject?saveProject(next,{editor:true}):(next.revision++,store.save(),next);if(store.lastSaveError)fail('原工程暂时无法写盘，重排未接回：'+store.lastSaveError);derived.deletedAt=new Date().toISOString();derived.revision++;store.save();if(store.lastSaveError)fail('无法保存旧工程状态：'+store.lastSaveError);return saved;}
  catch(e){store.db.projects[index]=original;delete derived.deletedAt;derived.revision=derivedRevision;store.save();throw e;}
 }
 return {importResult,async handle(req,res,{pathname,method}){
  const image=pathname.match(/^\/api\/auto-layout\/reflow\/image\/([a-f0-9-]{36})\/(\d+)$/);
  if(method==='GET'&&image){const batch=read(batchPath(image[1])),item=batch.items[Number(image[2])];if(!item)fail('预览图片不存在',404);const bytes=fs.readFileSync(item.filePath);if(sha(bytes)!==item.sha256)fail('预览图片已变化');res.writeHead(200,{'Content-Type':'image/png','Cache-Control':'no-store'});res.end(bytes);return true;}
  if(method==='POST'&&pathname==='/api/auto-layout/reflow/preview'){json(res,200,await preview(await body(req)));return true;}
  if(method==='POST'&&pathname==='/api/auto-layout/reflow/merge-existing'){json(res,200,mergeExisting(await body(req)));return true;}
  if(method!=='POST'||!['/api/auto-layout/reflow/plan','/api/auto-layout/reflow/source','/api/auto-layout/reflow/prepare'].includes(pathname))return false;
  if(busy)fail('正在处理成图重排，请稍候');busy=true;
  try{const input=await body(req),project=store.project(input.projectId);const result=pathname.endsWith('/prepare')?await prepareEpisodeReflow({store,project,episode:context(project,input.episode,input.expectedRevision),directory:slices,latestRecords,guard:()=>context(store.project(project.id),input.episode,input.expectedRevision)}):pathname.endsWith('/plan')?await plan(project,input):await source(project,input);json(res,200,result);return true;}finally{busy=false;}
 }};
}
