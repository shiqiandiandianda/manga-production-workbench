import fs from 'node:fs';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {productionFrame,productionSourceAsset} from '../public/production-package-model.js';
import {detectSliceRegions,cropSliceImages} from './panel-slices-images.mjs';
import {recoverImportedSliceRecords} from './imported-slice-records.mjs';
import {inspectImageFile} from './image-files.mjs';
import {validateSliceRegion} from '../public/panel-slices.js';
const sha=b=>createHash('sha256').update(b).digest('hex');
const stamp=f=>JSON.stringify([f.x,f.y,f.w,f.h,f.points,f.imageAssetId,f.imageTransform,f.packageCutout]);
const fail=message=>{throw Object.assign(Error(message),{status:409});};

/** Prepare all confirmed or unambiguously detected crops before starting any layout task. */
export async function prepareEpisodeReflow({store,project,episode,directory,latestRecords,guard,detect=detectSliceRegions,crop=cropSliceImages}){
 const before=JSON.stringify(project),records=latestRecords(project,episode);
 for(const segment of episode.segments)if(!productionSourceAsset(productionFrame(project,segment.id)))fail('本话尚有未完成的屏段：'+segment.localId+'；请先完成单屏生图，已有图片保留');
 recoverImportedSliceRecords({store,project,episode,directory,existing:records});
 const recovered=latestRecords(project,episode),prepared=[];
 for(const segment of episode.segments){
  if(recovered.has(segment.id))continue;
  const all=project.pages.flatMap(p=>p.panels),known=all.filter(f=>f.visible!==false&&f.panelSlice?.segmentId===segment.id),root=productionFrame(project,segment.id),raw=productionSourceAsset(root),hd=all.filter(f=>f.cutoutLayer?.kind==='upscale'&&f.cutoutLayer.parentPanelId===root.id&&f.cutoutLayer.sourceAssetId===raw&&f.imageAssetId),preferred=known[0]?.panelSlice.sourceAssetId,source=preferred?(preferred===raw?root:hd.find(f=>f.imageAssetId===preferred)):(hd.at(-1)||root);
  if(!source)fail(segment.localId+'的已有裁格来源与原屏不一致');
  const sourceAssetId=source===root?raw:source.imageAssetId,file=store.assetPath(sourceAssetId),sourceHash=sha(fs.readFileSync(file));
  const expected=episode.panelRecords.filter(p=>p.segmentId===segment.id).map(p=>p.layout),detected=await detect(file,expected);
  if(!detected.matched||Object.keys(detected.regions||{}).length!==expected.length||expected.some(p=>!detected.regions[p['格ID']]))fail(segment.localId+'的自动裁格与源格号不一致，请在“裁格排字”核对这一屏后重试；已有裁格和原画布保留');
  for(const frame of known){const s=frame.panelSlice;if(s.rootPanelId!==root.id||s.sourceAssetId!==sourceAssetId||s.sourceHash!==sourceHash||!validateSliceRegion(s.region))fail(segment.localId+'的已有裁格来源已变化，请核对后重试');detected.regions[s.panelId]=s.region;}
  const images=await crop(file,Object.fromEntries(expected.map(p=>[p['格ID'],detected.regions[p['格ID']]])));
  for(const frame of known){const image=images.find(i=>i.panelId===frame.panelSlice.panelId),info=inspectImageFile(store.assetPath(frame.imageAssetId));if(!image||info.width!==image.crop.w||info.height!==image.crop.h)fail('已有裁格图片与来源尺寸不符：'+frame.panelSlice.panelId);image.bytes=fs.readFileSync(info.filePath);image.existing={existingPanelId:frame.id,existingAssetId:frame.imageAssetId,existingFrameStamp:stamp(frame)};}
  if(images.length!==expected.length)fail('自动裁格数量不一致：'+segment.localId);
  const record={version:1,id:randomUUID(),projectId:project.id,packageHash:project.productionPackage.hash,segmentId:segment.id,rootPanelId:root.id,sourcePanelId:source.id,originalAssetId:raw,sourceAssetId,sourceHash,rootStamp:stamp(root),frameStamp:stamp(source),width:detected.width,height:detected.height,expected:expected.map(p=>p['格ID']),created:new Date().toISOString(),recovery:'whole-episode-detected-crops-v1',files:images.map(image=>({name:image.panelId+'.png',panelId:image.panelId,region:image.region,pixels:image.crop,sha256:sha(image.bytes),key:sha(Buffer.from(JSON.stringify([sourceHash,image.panelId,image.region]))),width:image.crop.w,height:image.crop.h,bytes:image.bytes,...image.existing}))};
  if(sha(fs.readFileSync(file))!==sourceHash)fail('裁格期间来源图片已变化：'+segment.localId);prepared.push(record);
 }
 guard();if(JSON.stringify(store.project(project.id))!==before)fail('裁格期间工程已修改，未启动排版');
 for(const record of prepared){const folder=path.join(directory,record.id);fs.mkdirSync(folder,{recursive:true});for(const file of record.files){fs.writeFileSync(path.join(folder,file.name),file.bytes,{flag:'wx'});delete file.bytes;}fs.writeFileSync(path.join(folder,'manifest.json'),JSON.stringify(record,null,2),{flag:'wx'});}
 const complete=latestRecords(project,episode);if(complete.size!==episode.segments.length)fail('本话裁格尚未完整，未启动排版');
 return {records:episode.segments.map(s=>({segmentId:s.id,recordId:complete.get(s.id)})),autoCroppedSegments:prepared.length,reusedSegments:complete.size-prepared.length,noImageGeneration:true};
}
