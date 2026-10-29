import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {check,imageInfo} from './store.mjs';

export function editReferenceAssets(store,ids=[]){
 check(Array.isArray(ids)&&ids.length<=4&&new Set(ids).size===ids.length,'修改参考图最多 4 张且不能重复');
 return ids.map(id=>{check(typeof id==='string','参考图编号无效');const asset=store.asset(id),file=store.assetPath(id);check(fs.existsSync(file),'修改参考原图已丢失，请重新粘贴',409);return asset;});
}
export function freezeEditReferences(store,assets,directory){
 return assets.map((asset,index)=>{const bytes=fs.readFileSync(store.assetPath(asset.id)),info=imageInfo(bytes),sha256=createHash('sha256').update(bytes).digest('hex'),file=path.join(directory,'reference-'+(index+1)+info.extension);fs.writeFileSync(file,bytes,{flag:'wx'});return {assetId:asset.id,file,sha256,width:info.width,height:info.height};});
}
