import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {captureFrameUpscale,frameUpscaleStamp} from './frame-upscale.mjs';
import {check} from './store.mjs';
import {auditPanelReferences} from '../public/panel-reference-audit.js';

const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const previewDirectory=(dataDir,id)=>{check(typeof id==='string'&&/^preview_[0-9a-f-]{36}$/.test(id),'请重新预览当前格内画面',409);return path.join(dataDir,'frame-upscale-cache','previews',id);};
export function frameUpscaleReferencePlan(project,panel,assets){
 const panels=project.pages.flatMap(p=>p.panels),source=panels.find(f=>f.id===panel.cutoutLayer?.parentPanelId)||panel,audit=auditPanelReferences(project,source,assets),byId=new Map(assets.map(a=>[a.id,a])),references=new Map(),missing=[];
 for(const need of audit.needs){
  if(!['character','scene','prop'].includes(need.role)||need.skipped||need.predecessor)continue;
  const ids=need.status==='conflict'?[]:need.selectedIds?.length?need.selectedIds:need.recommendedId?[need.recommendedId]:[];
  if(!ids.length){missing.push({name:need.name,role:need.role,state:need.state||'',reason:need.status==='conflict'?'已选资产状态冲突':'尚无已确认的对应图片'});continue;}
  for(const id of ids){const asset=byId.get(id);if(!asset||id===panel.imageAssetId||id===source.imageAssetId)continue;
   if(!references.has(id))references.set(id,{assetId:id,name:need.name+(need.state?' · '+need.state:''),role:need.role,width:asset.width,height:asset.height,revisionId:asset.library?.revisionId||null});
  }
 }
 check(references.size<=60,'本格参考超过60张，请调整本格资产');
 return {references:[...references.values()],missing};
}
export async function createFrameUpscalePreview(project,panel,store,dataDir,{ensureAssets=async()=>{}}={}){
 const owner=project.pages.find(p=>p.panels.includes(panel));check(owner&&!owner.locked&&!panel.locked,'请先选择并解锁画格',409);
 const revision=project.revision,plan=frameUpscaleReferencePlan(project,panel,store.db.assets);
 await ensureAssets([panel.imageAssetId,...plan.references.map(r=>r.assetId)]);
 check(store.project(project.id)===project&&project.revision===revision,'准备预览期间工程已改变，请重新打开',409);
 const capture=await captureFrameUpscale(project,panel,store,path.join(dataDir,'frame-upscale-cache'));
 const id='preview_'+randomUUID(),directory=previewDirectory(dataDir,id),references=plan.references.map(ref=>({...ref,sha256:digest(fs.readFileSync(store.assetPath(ref.assetId)))}));
 const manifest={version:2,id,projectId:project.id,panelId:panel.id,revision,created:Date.now(),source:capture.source,references,missing:plan.missing};
 fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(path.join(directory,'snapshot.png'),capture.bytes);fs.writeFileSync(path.join(directory,'manifest.json'),JSON.stringify(manifest));
 return {...manifest,snapshotUrl:'/api/frame-upscale/previews/'+id+'/image?projectId='+project.id,width:capture.source.width,height:capture.source.height,targetWidth:capture.source.width*2,targetHeight:capture.source.height*2};
}
export function loadFrameUpscalePreview(project,panel,store,dataDir,id,selectedIds){
 const directory=previewDirectory(dataDir,id);check(fs.existsSync(path.join(directory,'manifest.json')),'截图预览已失效，请重新打开',409);
 const manifest=JSON.parse(fs.readFileSync(path.join(directory,'manifest.json'),'utf8'));
 check(manifest.version===2&&manifest.projectId===project.id&&manifest.panelId===panel.id,'截图预览不属于当前画格',409);
 check(Date.now()-manifest.created<3600000,'截图预览已过期，请重新打开',409);
 check(panel.imageAssetId===manifest.source.assetId&&frameUpscaleStamp(project,panel,store)===manifest.source.appearanceStamp,'画格取景或图层已改变，请重新预览后提交',409);
 check(digest(fs.readFileSync(store.assetPath(panel.imageAssetId)))===manifest.source.sha256,'原图已改变，请重新预览',409);
 const bytes=fs.readFileSync(path.join(directory,'snapshot.png'));check(digest(bytes)===manifest.source.snapshotSha256,'截图文件已改变，请重新预览',409);
 check(Array.isArray(selectedIds)&&selectedIds.length<=60&&new Set(selectedIds).size===selectedIds.length,'高清参考选择无效');
 const current=frameUpscaleReferencePlan(project,panel,store.db.assets);
 const references=selectedIds.map(assetId=>{const ref=manifest.references.find(r=>r.assetId===assetId);check(ref,'参考不属于本格已核对的人物、场景或道具',409);check(current.references.some(r=>r.assetId===assetId&&r.name===ref.name&&r.role===ref.role&&r.revisionId===ref.revisionId),'本格资产身份或服装绑定已改变，请重新预览',409);check(digest(fs.readFileSync(store.assetPath(assetId)))===ref.sha256,'参考图片已改变，请重新预览',409);return {assetId:ref.assetId,name:ref.name,role:ref.role};});
 return {bytes,source:{...manifest.source,previewId:id,referenceIds:selectedIds},references};
}
export function frameUpscalePreviewImage(dataDir,id,projectId){
 const directory=previewDirectory(dataDir,id);check(fs.existsSync(path.join(directory,'manifest.json')),'截图预览不存在',404);
 const manifest=JSON.parse(fs.readFileSync(path.join(directory,'manifest.json'),'utf8'));check(manifest.projectId===projectId,'截图预览不属于当前工程',404);return path.join(directory,'snapshot.png');
}
