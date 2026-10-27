import fs from 'node:fs';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {inspectImageFile} from './image-files.mjs';
import {productionFrame,productionSourceAsset} from '../public/production-package-model.js';
import {validateSliceRegion} from '../public/panel-slices.js';

const sha=b=>createHash('sha256').update(b).digest('hex');
const stamp=f=>JSON.stringify([f.x,f.y,f.w,f.h,f.points,f.imageAssetId,f.imageTransform,f.packageCutout]);
const fail=message=>{throw Object.assign(Error(message),{status:409});};

/** Recover the proof already carried by imported slices, never infer new crop boundaries. */
export function recoverImportedSliceRecords({store,project,episode,directory,existing=new Map()}){
 const panels=project.pages.flatMap(p=>p.panels),prepared=[];
 for(const segment of episode.segments){
  if(existing.has(segment.id))continue;
  const candidates=panels.filter(f=>f.visible!==false&&f.panelSlice?.segmentId===segment.id);
  if(!candidates.length)continue;
  const root=productionFrame(project,segment.id),expected=episode.panelRecords.filter(p=>p.segmentId===segment.id).map(p=>p.id);
  const prefix=segment.localId+'的已有裁格无法安全恢复：';
  if(!root||new Set(candidates.map(f=>f.panelSlice.panelId)).size!==candidates.length||candidates.some(f=>!expected.includes(f.panelSlice.panelId)))fail(prefix+'格号重复或不属于本屏，请核对已有画格');
  if(candidates.length!==expected.length)continue;
  const sourceIds=new Set(candidates.map(f=>f.panelSlice.sourceAssetId));
  if(sourceIds.size!==1)fail(prefix+'来源图片不唯一');
  const sourceAssetId=[...sourceIds][0],source=sourceAssetId===productionSourceAsset(root)?root:panels.find(f=>f.imageAssetId===sourceAssetId&&f.cutoutLayer?.kind==='upscale'&&f.cutoutLayer.parentPanelId===root.id&&f.cutoutLayer.sourceAssetId===productionSourceAsset(root));
  if(!source)fail(prefix+'来源图片与原屏不匹配');
  const sourceInfo=inspectImageFile(store.assetPath(sourceAssetId)),sourceHash=sha(fs.readFileSync(sourceInfo.filePath));
  const files=expected.map(panelId=>{
   const frame=candidates.find(f=>f.panelSlice.panelId===panelId),s=frame.panelSlice,p=s.pixels;
   if(s.rootPanelId!==root.id||s.sourceBindingVersion!==1||s.sourceHash!==sourceHash||!validateSliceRegion(s.region)||!p||!['x','y','w','h'].every(k=>Number.isInteger(p[k]))||p.x<0||p.y<0||p.w<2||p.h<2||p.x+p.w>sourceInfo.width||p.y+p.h>sourceInfo.height)fail(prefix+'来源摘要或原生像素裁区不一致：'+panelId);
   const info=inspectImageFile(store.assetPath(frame.imageAssetId)),bytes=fs.readFileSync(info.filePath);
   if(info.mime!=='image/png'||info.width!==p.w||info.height!==p.h)fail(prefix+'当前图片尺寸与已确认裁区不一致：'+panelId);
   if(!/^[\w-]+$/.test(panelId))fail(prefix+'格号格式无效');
   return {name:panelId+'.png',panelId,region:structuredClone(s.region),pixels:structuredClone(p),sha256:sha(bytes),key:s.key||sha(Buffer.from(JSON.stringify([sourceHash,panelId,s.region]))),width:info.width,height:info.height,existingPanelId:frame.id,existingAssetId:frame.imageAssetId,existingFrameStamp:stamp(frame),bytes};
  });
  prepared.push({version:1,id:randomUUID(),projectId:project.id,packageHash:project.productionPackage.hash,segmentId:segment.id,rootPanelId:root.id,sourcePanelId:source.id,originalAssetId:productionSourceAsset(root),sourceAssetId,sourceHash,rootStamp:stamp(root),frameStamp:stamp(source),width:sourceInfo.width,height:sourceInfo.height,expected,created:new Date().toISOString(),recovery:'verified-existing-project-slices-v1',files});
 }
 // Validate every missing segment before publishing any recovered confirmation record.
 for(const record of prepared){
  const folder=path.join(directory,record.id);fs.mkdirSync(folder,{recursive:true});
  for(const file of record.files){fs.writeFileSync(path.join(folder,file.name),file.bytes,{flag:'wx'});delete file.bytes;}
  fs.writeFileSync(path.join(folder,'manifest.json'),JSON.stringify(record,null,2),{flag:'wx'});
 }
 return prepared.length;
}
