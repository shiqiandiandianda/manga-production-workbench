import {createHash} from 'node:crypto';
import {panel as createPanel,rectangle} from '../public/model.js';
import {panelProductionShot,panelContentKey} from '../public/panel-generation.js';
import {referencesForPanel} from '../public/panel-references.js';
import {panelArtDirection,normalizeBreakoutExtents,validateForegroundAlphaStats} from '../public/comic-art-direction.js';
const copy=value=>structuredClone(value);
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const check=(condition,message,status=400)=>{if(!condition)fail(message,status);};
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const assetMap=assets=>assets instanceof Map?assets:new Map((assets||[]).map(a=>[a.id,a]));
function locate(project,panelId){for(const page of project.pages||[]){const panel=page.panels.find(p=>p.id===panelId);if(panel)return {page,panel};}fail('破框来源画格不存在',404);}
const assetSnapshot=a=>({id:a.id,filePath:a.filePath,mime:a.mime,width:a.width,height:a.height,name:a.name,libraryRole:a.libraryRole});
function sourceState(project,panel,assets){
 const byId=assetMap(assets),background=byId.get(panel.imageAssetId);check(background,'破框背景图片不存在，请重新定位图片',409);
 return {content:panelContentKey(project,panel,[...byId.values()]),direction:panelArtDirection(panel),geometry:{x:panel.x,y:panel.y,w:panel.w,h:panel.h,points:panel.points,imageAssetId:panel.imageAssetId,imageTransform:panel.imageTransform},background:assetSnapshot(background)};
}
export function breakoutSourceKey(project,panel,assets){return digest(sourceState(project,panel,assets));}
/** Expansion is page-local. A transparent foreground never inherits the source polygon. */
export function breakoutCanvas(page,panel,extents=panelArtDirection(panel).breakoutExtents){
 const e=normalizeBreakoutExtents(extents)||{unit:'ratio',left:.20,right:.20,top:.25,bottom:.25};
 const left=Math.min(Math.max(0,panel.x),Math.round(panel.w*e.left)),right=Math.min(Math.max(0,page.width-panel.x-panel.w),Math.round(panel.w*e.right)),top=Math.min(Math.max(0,panel.y),Math.round(panel.h*e.top)),bottom=Math.min(Math.max(0,page.height-panel.y-panel.h),Math.round(panel.h*e.bottom));
 const canvas={x:panel.x-left,y:panel.y-top,w:panel.w+left+right,h:panel.h+top+bottom,backgroundRect:{x:left,y:top,w:panel.w,h:panel.h}};
 check(canvas.w>=20&&canvas.h>=20,'破框画布尺寸无效');return canvas;
}
export function prepareBreakout(project,panelId,assets,{revision=project.revision,provider='codex'}={}){
 check(provider==='codex','当前只有Codex通道提供透明参数和真实alpha验收；请选择Codex',400);
 check(revision===project.revision,'工程已更新，请刷新破框设置后再生成',409);
 const {page,panel}=locate(project,panelId);check(!panel.locked,'当前画格已锁定，不能生成或更换破框前景',409);check(!panel.sfxImage&&!panel.breakoutForeground,'请选择普通画格作为破框背景');check(panel.imageAssetId,'请先生成或选择背景主图，并确认其人物与姿态',409);
 const direction=panelArtDirection(panel);check(direction.breakout==='foreground','请先开启本格独立透明前景设计');check(direction.breakoutSubject,'请明确破框的现有人物及越框部位');
 const byId=assetMap(assets),background=byId.get(panel.imageAssetId);check(background?.filePath,'背景主图的本地路径不可用',409);
 const sourceReferences=referencesForPanel(project,panel,[...byId.values()]),references=[{assetId:background.id,role:'scene',name:'已确认背景主图 · '+(panel.name||'当前格子')},...sourceReferences.filter(r=>r.assetId!==background.id)];
 check(references.length<=60,'破框前景加背景参考后超过60张，请减少本格参考');
 const referenceAssets=references.map(r=>{const a=byId.get(r.assetId);check(a?.filePath,'破框参考图片不存在：'+r.name,409);return assetSnapshot(a);}),canvas=breakoutCanvas(page,panel),sourceKey=breakoutSourceKey(project,panel,[...byId.values()]),shot=panelProductionShot(project,panel,[...byId.values()]);
 const request={version:1,kind:'breakout-foreground',projectId:project.id,pageId:page.id,panelId,provider:'codex',sourceRevision:revision,sourceKey,backgroundAssetId:panel.imageAssetId,canvas,referenceAssetIds:references.map(r=>r.assetId),referenceAssets,subject:direction.breakoutSubject,...(direction.breakoutExtents?{extents:copy(direction.breakoutExtents)}:{})};
 request.bridgeInput={kind:'breakout-foreground',action:'generate',projectId:project.id,projectTitle:project.title,shot:{...shot,dialogue:'',embeddedTexts:[],breakoutSubject:request.subject},style:project.style,panel:{x:0,y:0,w:canvas.w,h:canvas.h,points:rectangle()},referenceRoles:references,breakoutContract:{version:1,subject:request.subject,sourceKey,backgroundAssetId:request.backgroundAssetId,backgroundRect:copy(canvas.backgroundRect),canvas:{w:canvas.w,h:canvas.h},...(request.extents?{extents:copy(request.extents)}:{}),originalImageTransform:copy(panel.imageTransform),sourcePanelSize:{w:panel.w,h:panel.h},format:'PNG',transparentBackground:true,requireRealAlpha:true}};
 request.referenceFiles=referenceAssets.map(a=>a.filePath);return request;
}
function verifiedAlpha(value){
 check(value?.format==='PNG'&&value.valid===true,'候选没有可信的真实PNG透明像素验收，不能应用',409);
 const checked=validateForegroundAlphaStats(value);check(checked.valid,checked.reason,409);return checked;
}
/** Results stay in a candidate list, even if the source was edited while the model ran. */
export function applyBreakoutResult(project,request,{assetId,jobId,alphaVerified,transparency,assets}={}){
 check(request?.kind==='breakout-foreground'&&request.version===1&&request.projectId===project.id,'破框任务身份无效',409);check(typeof assetId==='string'&&assetId,'破框结果缺少资产编号');check(typeof jobId==='string'&&jobId,'破框结果缺少任务编号');check(alphaVerified===true,'破框结果尚未通过真实alpha验收',409);const alpha=verifiedAlpha(transparency);
 check(request.referenceStamp===undefined||(typeof request.referenceStamp==='string'&&request.referenceStamp.length<=200000),'破框参考文件快照无效',409);
 const {panel}=locate(project,request.panelId);panel.breakoutCandidates||=[];const existing=panel.breakoutCandidates.find(c=>c.assetId===assetId&&c.jobId===jobId);if(existing)return {project,candidate:existing,added:false};check(panel.breakoutCandidates.length<40,'破框候选已满，请整理候选后再生成',409);
 let sourceCurrent=false;try{sourceCurrent=breakoutSourceKey(project,panel,assets||request.referenceAssets)===request.sourceKey;}catch{}
 const candidate={version:1,assetId,jobId,alphaVerified:true,transparency:copy(alpha),sourceKey:request.sourceKey,sourceKeyVersion:2,sourceRevision:request.sourceRevision,backgroundAssetId:request.backgroundAssetId,canvas:copy(request.canvas),...(request.extents?{extents:copy(request.extents)}:{}),referenceAssetIds:[...request.referenceAssetIds],...(request.referenceStamp!==undefined?{referenceStamp:request.referenceStamp}:{}),createdAt:new Date().toISOString(),status:sourceCurrent&&!panel.locked?'ready':'stale',subject:request.subject};panel.breakoutCandidates.push(candidate);return {project,candidate,added:true};
}
/** Confirming adds an independent layer; it never replaces the original scene image. */
export function confirmBreakout(project,panelId,assetId,assets){
 const {page,panel}=locate(project,panelId);check(!panel.locked,'背景画格已锁定，不能应用破框前景',409);
 const candidate=(panel.breakoutCandidates||[]).find(c=>c.assetId===assetId);check(candidate,'破框候选不存在',404);check(candidate.status!=='stale','候选来源已过期，旧前景保留为候选；请按当前画面重新生成并核验',409);check(candidate.sourceKeyVersion===2,'旧版候选未记录完整画面设计，原候选已保留；请重新生成并核验',409);check(candidate.alphaVerified===true,'候选尚未通过真实alpha验收',409);verifiedAlpha(candidate.transparency);
 const asset=assetMap(assets).get(assetId);check(asset,'破框候选图片不存在',404);check(asset.mime==='image/png'||asset.extension==='.png','破框前景必须是PNG',409);const alpha=verifiedAlpha(asset.transparency);check(asset.width===alpha.width&&asset.height===alpha.height,'透明像素证据与当前图片尺寸不一致，请重新验收',409);
 check(breakoutSourceKey(project,panel,assets)===candidate.sourceKey,'背景、画格、提示词或参考已改变，旧前景保留为候选；请按当前画面重新生成',409);
 const canvas=candidate.canvas;check(JSON.stringify(canvas)===JSON.stringify(breakoutCanvas(page,panel)),'破框画布锚点与当前来源不一致，请重新生成',409);const ratio=canvas.w/canvas.h,actualRatio=asset.width/asset.height;check(Math.abs(actualRatio/ratio-1)<=.025,'透明前景比例与计划画布不一致，候选已保留；请按计划尺寸重新生成',409);
 const existing=page.panels.find(p=>p.breakoutForeground?.backgroundPanelId===panelId&&p.imageAssetId===assetId);if(existing)return {project,foreground:existing,reused:true};
 const older=page.panels.filter(p=>p.breakoutForeground?.backgroundPanelId===panelId&&p.visible!==false);check(!older.some(p=>p.locked),'已有破框前景已锁定，请先解锁后再换候选',409);
 const foreground=createPanel('',canvas.x,canvas.y,canvas.w,canvas.h,'panel');Object.assign(foreground,{name:'破框前景 · '+(panel.name||'当前格子'),border:0,feather:0,imageAssetId:assetId,imageTransform:{x:0,y:0,scale:canvas.w/asset.width},breakoutForeground:{version:1,backgroundPanelId:panelId,backgroundAssetId:panel.imageAssetId,sourceKey:candidate.sourceKey,jobId:candidate.jobId,sourceCanvas:copy(canvas),...(candidate.extents?{extents:copy(candidate.extents)}:{}),alphaVerified:true,confirmedAt:new Date().toISOString()}});
 // Validation above is complete before changing any visible layer.
 for(const old of older)old.visible=false;page.panels.push(foreground);
 const known=[...(project.pages||[]).flatMap(p=>p.panels.filter(p=>p.id!==foreground.id).map(p=>p.id)),...(project.pages||[]).flatMap(p=>p.bubbles.map(b=>b.id)),...(project.gradients||[]).map(g=>g.id)];
 const order=[...new Set([...(project.layerOrder||[]),...known])],index=order.indexOf(panelId);order.splice(index+1,0,foreground.id);project.layerOrder=order;candidate.status='confirmed';candidate.foregroundPanelId=foreground.id;
 return {project,foreground,reused:false};
}
/** Store validation can call this to bound imported/project-embedded metadata. */
export function validateBreakoutMetadata(panel){
 if(panel.breakoutCandidates!==undefined){check(Array.isArray(panel.breakoutCandidates)&&panel.breakoutCandidates.length<=40,'破框候选数据无效');for(const c of panel.breakoutCandidates){check(c&&c.version===1&&typeof c.assetId==='string'&&typeof c.jobId==='string'&&typeof c.sourceKey==='string'&&/^[0-9a-f]{64}$/u.test(c.sourceKey)&&['ready','stale','confirmed'].includes(c.status)&&c.alphaVerified===true&&c.canvas&&[c.canvas.x,c.canvas.y,c.canvas.w,c.canvas.h].every(Number.isFinite)&&c.canvas.w>=20&&c.canvas.h>=20&&typeof c.subject==='string'&&c.subject.length<=800&&(c.referenceStamp===undefined||(typeof c.referenceStamp==='string'&&c.referenceStamp.length<=200000)),'破框候选字段无效');verifiedAlpha(c.transparency);if(c.extents!==undefined)normalizeBreakoutExtents(c.extents);}}
 if(panel.breakoutForeground!==undefined){const f=panel.breakoutForeground;check(f&&f.version===1&&typeof f.backgroundPanelId==='string'&&typeof f.backgroundAssetId==='string'&&typeof f.sourceKey==='string'&&/^[0-9a-f]{64}$/u.test(f.sourceKey)&&f.alphaVerified===true,'破框前景绑定无效');if(f.extents!==undefined)normalizeBreakoutExtents(f.extents);}
 return panel;
}
