import fs from 'node:fs';import path from 'node:path';import {randomUUID,createHash} from 'node:crypto';import {check,validateProject} from './store.mjs';
import {createRepairEngine} from '../repair-engine/server.mjs';import {importPage,sourceMetadata} from '../repair-engine/page-service.mjs';
import {createCutoutLayer,createUpscaleLayer} from '../public/cutout-layer.js';
import {captureRepairComposition,repairCompositionMatches,compositionDifference,addCompositionPatch,mergeCompositionResult} from './repair-composition.mjs';
const frameStamp=panel=>createHash('sha256').update(JSON.stringify({imageAssetId:panel.imageAssetId,imageTransform:panel.imageTransform,x:panel.x,y:panel.y,w:panel.w,h:panel.h,points:panel.points})).digest('hex');
// Only rebase sessions that were current before the coordinate-only page migration.
export function rebaseRepairSessions(dataDir,before,after){
 const dir=path.join(dataDir,'repair','sessions');if(!fs.existsSync(dir))return;
 const oldFrames=new Map(before.pages.flatMap(p=>p.panels).map(f=>[f.id,f])),nextFrames=new Map(after.pages.flatMap(p=>p.panels).map(f=>[f.id,f]));
 for(const name of fs.readdirSync(dir).filter(n=>/^[a-f0-9-]{36}\.json$/i.test(n))){const file=path.join(dir,name);let session;try{session=JSON.parse(fs.readFileSync(file,'utf8'));}catch{continue;}if(session.projectId!==before.id)continue;const old=oldFrames.get(session.panelId),next=nextFrames.get(session.panelId);if(!old||!next||session.frameStamp!==frameStamp(old))continue;
  const shifted={...next,y:old.y};if(frameStamp(shifted)!==frameStamp(old))continue;const backup=path.join(dataDir,'backups','screen-boards','repair-sessions');fs.mkdirSync(backup,{recursive:true});const target=path.join(backup,name);if(!fs.existsSync(target))fs.copyFileSync(file,target);session.frameStamp=frameStamp(next);fs.writeFileSync(file,JSON.stringify(session));
 }
}
export function createIntegratedRepair({dataDir,store,body,json,saveProject,addAsset,apiOrigin,localTools}){
 const root=path.join(dataDir,'repair'),sessionsDir=path.join(root,'sessions');fs.mkdirSync(sessionsDir,{recursive:true});let pending,engine;
 const historyFile=path.join(root,'hd-image-history.json');let imageHistory=[];try{imageHistory=JSON.parse(fs.readFileSync(historyFile,'utf8'));}catch{}
 function rememberImage(panel,from,to,projectId){imageHistory.push({projectId,layerId:panel.id,parentPanelId:panel.cutoutLayer?.parentPanelId,sourceAssetId:panel.cutoutLayer?.sourceAssetId,kind:panel.cutoutLayer?(panel.cutoutLayer.kind||'cutout'):'frame',from,to});fs.writeFileSync(historyFile+'.tmp',JSON.stringify(imageHistory));fs.renameSync(historyFile+'.tmp',historyFile);}
 function restorableImages(old,next){
  const allowed=new Set(),oldPanels=new Map(old.pages.flatMap(page=>page.panels.map(panel=>[panel.id,{page,panel}])));
  for(const page of next.pages)for(const layer of page.panels){const prior=oldPanels.get(layer.id),current=prior?.panel,ref=layer.cutoutLayer,original=current?.cutoutLayer;if(!current||current.imageAssetId===layer.imageAssetId||current.locked||prior.page.locked||ref?.kind!=='upscale'||original?.kind!=='upscale'||ref.parentPanelId!==original.parentPanelId||ref.sourceAssetId!==original.sourceAssetId)continue;
   if(store.db.jobs.some(job=>job.projectId===old.id&&[layer.id,ref.parentPanelId].includes(job.panelId)&&['queued','preparing','running','recoverable','delegated','awaiting_confirmation'].includes(job.status)))continue;
   const edges=imageHistory.filter(row=>row.projectId===old.id&&row.layerId===layer.id&&row.parentPanelId===ref.parentPanelId&&row.sourceAssetId===ref.sourceAssetId),seen=new Set([current.imageAssetId]);let changed=true;while(changed){changed=false;for(const edge of edges)if(seen.has(edge.from)||seen.has(edge.to))for(const id of [edge.from,edge.to])if(!seen.has(id)){seen.add(id);changed=true;}}
   const asset=store.db.assets.find(a=>a.id===layer.imageAssetId),source=store.db.assets.find(a=>a.id===ref.sourceAssetId);if(asset&&source&&seen.has(asset.id)&&ref.width===asset.width&&ref.height===asset.height&&ref.scale===asset.width/source.width)allowed.add(layer.id);
  }
  for(const page of next.pages)for(const layer of page.panels){const prior=oldPanels.get(layer.id),current=prior?.panel;if(!current||current.imageAssetId===layer.imageAssetId||current.locked||prior.page.locked||layer.locked||page.locked)continue;
   if(store.db.jobs.some(job=>job.projectId===old.id&&[layer.id,current.cutoutLayer?.parentPanelId].includes(job.panelId)&&['queued','preparing','running','recoverable','delegated','awaiting_confirmation'].includes(job.status)))continue;
   const kind=current.cutoutLayer?(current.cutoutLayer.kind||'cutout'):'frame',nextKind=layer.cutoutLayer?(layer.cutoutLayer.kind||'cutout'):'frame';if(kind==='upscale'||kind!==nextKind||current.cutoutLayer?.parentPanelId!==layer.cutoutLayer?.parentPanelId||current.cutoutLayer?.sourceAssetId!==layer.cutoutLayer?.sourceAssetId)continue;const edges=imageHistory.filter(row=>row.projectId===old.id&&row.layerId===layer.id&&row.kind===kind&&row.parentPanelId===current.cutoutLayer?.parentPanelId&&row.sourceAssetId===current.cutoutLayer?.sourceAssetId),seen=new Set([current.imageAssetId]);let changed=true;while(changed){changed=false;for(const edge of edges)if(seen.has(edge.from)||seen.has(edge.to))for(const key of [edge.from,edge.to])if(!seen.has(key)){seen.add(key);changed=true;}}
   if(seen.has(layer.imageAssetId)&&store.db.assets.some(a=>a.id===layer.imageAssetId))allowed.add(layer.id);
  }return allowed;
 }
 const ensure=()=>pending||=(createRepairEngine({dataDir:root,apiOrigin:apiOrigin(),localTools}).then(value=>engine=value));
 async function handle(req,res,{pathname,method,url}){
  if(pathname.startsWith('/repair/')||pathname==='/repair'){const editor=await ensure(),previous=req.url;req.url=req.url.replace(/^\/repair/,'')||'/';try{await editor.handle(req,res);}finally{req.url=previous;}return true;}
  if(!pathname.startsWith('/api/integrated-repair'))return false;
  if(method==='GET'&&pathname==='/api/integrated-repair/status'){json(res,200,{integrated:true,applyModes:['replace','layer','upscale'],upscaleChildLayers:true,upscaleLayerEditing:true,running:(engine?.running()||0)+(localTools.running()?1:0),localTools:localTools.status()});return true;}
  if(method==='POST'&&pathname==='/api/integrated-repair/sessions'){
   const input=await body(req),project=store.project(input.projectId),panels=project.pages.flatMap(p=>p.panels),selected=panels.find(p=>p.id===input.panelId),panel=selected?.cutoutLayer?.kind==='repair-patch'?panels.find(p=>p.id===selected.cutoutLayer.parentPanelId):selected;check(panel?.imageAssetId,'先选择已有图片的画格');check(!project.pages.find(p=>p.panels.includes(panel))?.locked,'请先解锁画板');check(!panel.locked,'请先解锁画格');check(input.expectedRevision===project.revision,'工程已有修改，请保存后重试',409);await ensure();const composition=await captureRepairComposition(project,panel.id,store,path.join(root,'compositions'));check(store.project(project.id).revision===input.expectedRevision&&(!composition||repairCompositionMatches(composition,store.project(project.id),store)),'图层在载入期间已变化，请保存后重试',409);const stream=fs.createReadStream(composition?.file||store.assetPath(panel.imageAssetId));stream.headers={'x-source-name':encodeURIComponent(project.title+' · '+(project.shots.find(s=>s.id===panel.shotId)?.code||panel.name||'画格'))};const metadata=await importPage(stream,root);check(store.project(project.id).revision===input.expectedRevision&&(!composition||repairCompositionMatches(composition,store.project(project.id),store)),'图层在载入期间已变化，请保存后重试',409);const session={id:randomUUID(),projectId:project.id,panelId:panel.id,...(composition?{composition}:{}),targetKind:composition?'composition':panel.cutoutLayer?.kind==='upscale'?'upscale':panel.cutoutLayer?'layer':'frame',imageAssetId:panel.imageAssetId,frameStamp:frameStamp(panel),sourceId:metadata.id,createdAt:new Date().toISOString()};fs.writeFileSync(path.join(sessionsDir,session.id+'.json'),JSON.stringify(session));json(res,201,{session,metadata});return true;
  }
  const apply=pathname.match(/^\/api\/integrated-repair\/sessions\/([a-f0-9-]{36})\/apply$/);if(method==='POST'&&apply){
   const input=await body(req),requestedMode=input.mode||'replace',position=input.position||'above';check(['replace','layer','upscale'].includes(requestedMode),'请选择替换画格、原位图层或高清子图层');check(['above','below'].includes(position),'请选择原图上方或下方');
   const session=JSON.parse(fs.readFileSync(path.join(sessionsDir,apply[1]+'.json'))),project=store.project(session.projectId),page=project.pages.find(p=>p.panels.some(f=>f.id===session.panelId)),panel=page?.panels.find(p=>p.id===session.panelId);check(panel,'原画格已删除，修图结果仍保留',409);check(input.expectedRevision===project.revision,'工程已有修改，请重新回填',409);const resultPath=decodeURIComponent(new URL(input.resultUrl,'http://localhost').pathname);check(/^\/repair\/exports\/[^/]+\.png$/.test(resultPath),'修图结果路径无效');const file=path.resolve(root,'exports',path.basename(resultPath));check(path.dirname(file)===path.resolve(root,'exports')&&fs.existsSync(file),'修图图片不存在',404);
   if(session.composition){
    check(session.composition.version===2,'这是旧版含气泡的修图会话，请重新点击“修改画面”；已有结果保留',409);
    const original=session.composition,memberIds=new Set(original.layerIds);
    const guard=()=>{const current=store.project(project.id);check(!store.db.jobs.some(job=>job.projectId===project.id&&memberIds.has(job.panelId)&&['queued','preparing','running','recoverable','delegated','awaiting_confirmation'].includes(job.status)),'当前画面正在生成，请结束原任务后再应用修图',409);check(current.revision===input.expectedRevision&&repairCompositionMatches(original,current,store),'左侧画面或补图已有修改，结果已保留；请重新载入当前画面后应用',409);const owner=current.pages.find(p=>p.id===original.pageId);check(owner&&!owner.locked&&!owner.panels.some(p=>memberIds.has(p.id)&&p.locked),'请先解锁来源画格、补图和画板',409);};guard();
    const resultHash=createHash('sha256').update(fs.readFileSync(file)).digest('hex'),resultKey=requestedMode+':'+resultHash,previous=session.appliedResults?.[resultKey],existing=previous&&page.panels.find(p=>p.id===previous.layerId);
    if(previous&&existing?.imageAssetId===previous.assetId){json(res,200,{applied:true,mode:'composition',layerId:existing.id,asset:store.asset(existing.imageAssetId),project,session,metadata:await sourceMetadata(root,session.sourceId),message:'此结果已应用，没有重复新建图层'});return true;}
    if(requestedMode==='upscale')await localTools.validateUpscale(original.file,file);
    const separate=requestedMode==='layer',difference=await compositionDifference(original.file,file,{crop:separate,allowErase:!separate});guard();
    if(!difference.changed){json(res,200,{applied:true,mode:'composition',layerId:panel.id,asset:store.asset(panel.imageAssetId),project,session,message:'画面没有变化，无需应用修图'});return true;}
    check(Math.abs(difference.width/difference.height-original.width/original.height)<=Math.max(.002,2/difference.height),'修图画幅比例已改变，请保留原画幅后应用',409);
    let output=file,region=original.region;
    if(separate){const dir=path.join(root,'composition-results');fs.mkdirSync(dir,{recursive:true});output=path.join(dir,randomUUID()+'.png');fs.writeFileSync(output,difference.bytes);const crop=difference.crop;region={x:region.x+crop.x/difference.width*region.w,y:region.y+crop.y/difference.height*region.h,w:crop.w/difference.width*region.w,h:crop.h/difference.height*region.h};}
    const asset=addAsset(output,separate?'局部修图补片':'修图合并结果','integrated-repair');asset.repairSessionId=session.id;
    let next,layer;
    if(separate){next=structuredClone(project);const parent=next.pages.flatMap(p=>p.panels).find(p=>p.id===panel.id);layer=addCompositionPatch(next,parent,asset,{...original,region},{sessionId:session.id,mode:requestedMode});}
    else{const merged=mergeCompositionResult(project,panel,asset,original);next=merged.project;layer=next.pages.flatMap(p=>p.panels).find(p=>p.id===merged.layerId);}
    validateProject(next);guard();
    const corrected=separate?await captureRepairComposition(next,panel.id,store,path.join(root,'compositions')):null;guard();
    const preview=fs.createReadStream(corrected?.file||output);preview.headers={'x-source-name':encodeURIComponent(project.title+' · '+(project.shots.find(s=>s.id===panel.shotId)?.code||panel.name||'画格'))};const metadata=await importPage(preview,root);guard();
    if(corrected)session.composition=corrected;else{delete session.composition;rememberImage(panel,panel.imageAssetId,asset.id,project.id);session.imageAssetId=asset.id;session.frameStamp=frameStamp(layer);session.targetKind='frame';}
    session.sourceId=metadata.id;session.lastResult={sha256:resultHash,assetId:asset.id,layerId:layer.id};session.appliedResults={...session.appliedResults,[resultKey]:{assetId:asset.id,layerId:layer.id}};
    store.db.projects[store.db.projects.indexOf(project)]=next;const saved=saveProject(next,{editor:true});fs.writeFileSync(path.join(sessionsDir,session.id+'.json'),JSON.stringify(session));json(res,200,{applied:true,mode:separate?'layer':'replace',layerId:layer.id,createdLayer:separate,updatedLayer:!separate,mergedLayers:separate?[]:original.layerIds.filter(key=>key!==panel.id),asset,project:saved,session,metadata,message:separate?'已加入局部修图补片，仅保留修改区域':'返修结果已自动合并到原画格，气泡文字保持独立，可撤回'});return true;
   }
   check(!store.db.jobs.some(job=>job.projectId===project.id&&[panel.id,panel.cutoutLayer?.parentPanelId].includes(job.panelId)&&['queued','preparing','running','recoverable','delegated','awaiting_confirmation'].includes(job.status)),'当前画格正在生成，请结束原任务后再应用修图',409);
   // An existing HD layer is the repair target, even for an older editor still sending "upscale".
   const upscaleTarget=panel.cutoutLayer?.kind==='upscale',mode=upscaleTarget?'replace':requestedMode,child=mode==='layer'||mode==='upscale',resultHash=createHash('sha256').update(fs.readFileSync(file)).digest('hex');
   // Model-output checks apply only when the user requested an upscale. A
   // manually edited HD layer can legitimately become a flat-colour image.
   if(requestedMode==='upscale'){
    await localTools.validateUpscale(store.assetPath(session.imageAssetId),file);
    // Validation runs in a child process. Another editor can replace the
    // project while it is running, so never apply to the stale object.
    check(store.project(session.projectId)===project&&project.revision===input.expectedRevision,'高清结果校验期间工程已有修改，请重新确认；结果仍保留',409);
   }
   session.targetKind=upscaleTarget?'upscale':panel.cutoutLayer?'layer':'frame';
   const resultKey=requestedMode+':'+resultHash,previous=session.appliedResults?.[resultKey]||(!child&&session.lastResult?.sha256===resultHash?session.lastResult:null),existing=previous&&page.panels.find(f=>f.id===previous.layerId);
   if(previous&&(child?existing?.imageAssetId===previous.assetId:panel.imageAssetId===previous.assetId)){json(res,200,{applied:true,mode,layerId:previous.layerId,asset:store.asset(previous.assetId),project,session,message:'此结果已应用，没有重复新建图层'});return true;}
   const applied=!panel.locked&&!page.locked&&frameStamp(panel)===session.frameStamp;
   if(mode==='layer')check(applied,'来源画格已有修改或锁定，请重新载入后再新增图层',409);
   if(applied&&child){check(!panel.cutoutLayer,'请在原画格上新增子图层');check(page.panels.length<1000,'当前画板图层数量已达上限');}
   const asset=addAsset(file,(project.shots.find(s=>s.id===panel.shotId)?.code||'画格')+(mode==='upscale'?' · 高清放大':' · 修图结果'),'integrated-repair');asset.repairSessionId=session.id;let layerId=panel.id;
   if(applied){const original=store.asset(session.imageAssetId);if(mode==='upscale'){
    const layer=createUpscaleLayer(project,panel,asset,original,{sessionId:session.id,model:input.model});layerId=layer.id;
    // Continue the same repair on the new HD layer without replacing the original or nesting HD layers.
    session.originalPanelId=panel.id;session.panelId=layer.id;session.targetKind='upscale';session.frameStamp=frameStamp(layer);session.imageAssetId=asset.id;
   }else if(mode==='layer')layerId=createCutoutLayer(project,panel,asset,original,{sessionId:session.id,position}).id;else{
    rememberImage(panel,panel.imageAssetId,asset.id,project.id);
    panel.candidates=[...new Set([...(panel.candidates||[]),panel.imageAssetId,asset.id].filter(Boolean))].slice(-40);panel.imageAssetId=asset.id;if(panel.imageTransform)panel.imageTransform.scale*=original.width/asset.width;delete panel.imageEffects;
    if(upscaleTarget){const source=store.asset(panel.cutoutLayer.sourceAssetId);Object.assign(panel.cutoutLayer,{width:asset.width,height:asset.height,scale:asset.width/source.width,lastRepairSessionId:session.id});}
    session.frameStamp=frameStamp(panel);session.imageAssetId=asset.id;
   }session.lastResult={sha256:resultHash,assetId:asset.id,layerId};session.appliedResults={...session.appliedResults,[resultKey]:{assetId:asset.id,layerId}};fs.writeFileSync(path.join(sessionsDir,session.id+'.json'),JSON.stringify(session));}
   else panel.candidates=[...new Set([...(panel.candidates||[]),asset.id])].slice(-40);
   json(res,200,{applied,mode,layerId:applied?layerId:null,createdLayer:applied&&child,updatedLayer:applied&&!child,session,asset,project:saveProject(project,{editor:true}),message:applied?(upscaleTarget?'修图结果已更新当前高清图层，原画保留':mode==='upscale'?'高清已在原画面下新增独立子图层，可单独显示、隐藏和删除':mode==='layer'?'抠图已按原位置新增图层，可切换原图上方或下方':'修图结果已回填原画格，透明背景已保留'):'原画格已调整或锁定，结果已保留为候选图片'});return true;
  }
  check(false,'修图操作不存在',404);
 }
 return {handle,restorableImages,running:()=>!!engine?.running()||localTools.running(),close:()=>engine?.close()};
}
