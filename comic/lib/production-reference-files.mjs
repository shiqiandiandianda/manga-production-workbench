import {assetUnavailable} from '../public/asset-availability.js';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {check} from './store.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export function productionAssetBinding(store,assetId){
 const asset=store.asset(assetId);check(!assetUnavailable(asset),'该素材被标记为不能使用或尚未确认');
 if(asset.library?.revisionId&&/^[a-f0-9]{64}$/.test(asset.library.sha256))return {...asset.library,sourceType:'moku',libraryAssetId:asset.library.assetId,assetId:asset.id,name:asset.name};
 const file=store.assetPath(asset.id);check(fs.existsSync(file),'本地参考原件不存在');check(fs.statSync(file).size<=256*1024*1024,'本地参考图超过256MB');
 const bytes=fs.readFileSync(file),hash=sha(bytes);return {sourceType:'local',assetId:asset.id,name:asset.name,sha256:hash,revisionId:'local-sha256:'+hash,size:bytes.length};
}
export function verifyProductionReferenceFiles(plan,assets){
 for(const ref of plan?.segment.references||[]){if(ref.skipped||ref.binding?.sourceType!=='local'||!plan.refs.some(r=>r.assetId===ref.binding.assetId))continue;const asset=assets.find(a=>a.id===ref.binding.assetId);check(asset?.filePath&&fs.existsSync(asset.filePath),'本地附图已缺失，请重新定位并绑定');check(fs.statSync(asset.filePath).size<=256*1024*1024&&sha(fs.readFileSync(asset.filePath))===ref.binding.sha256,'本地附图内容已改变，请重新看图绑定：'+asset.name,409);}
}
export function productionReferenceVersions(project,frame,refs,assets){
 const segment=project.productionPackage?.episodes.flatMap(e=>e.segments).find(s=>s.id===(frame.productionSegment||frame.productionBackground?.replace(/-BG$/,'')||frame.panelSlice?.segmentId));
 return refs.map(r=>({...assets.find(a=>a.id===r.assetId)?.library,...segment?.references.find(ref=>ref.binding?.assetId===r.assetId)?.binding,localAssetId:r.assetId,name:r.name}));
}
