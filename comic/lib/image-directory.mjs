import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {check,uid} from './store.mjs';
import {inspectImageFileAsync,imagePathValue} from './image-files.mjs';
import {isMountedImagePath,mountedImageIO} from './mounted-io.mjs';
import {assetMetadata} from '../public/asset-metadata.js';

const supported=/\.(png|jpe?g|webp)$/i;
export const imagePathKey=value=>{const key=path.resolve(value).normalize('NFC').replace(/\\/g,'/');return process.platform==='win32'?key.toLowerCase():key;};
export function inferAssetRole(relativePath){
 const parts=relativePath.replace(/\\/g,'/').split('/').slice(0,-1);
 for(const part of parts){
  if(/角色|人物|character/i.test(part))return 'character';
  if(/场景|环境|scene|background/i.test(part))return 'scene';
  if(/道具|特效|prop|effect/i.test(part))return 'prop';
  if(/参考|画风|标题|版式|style|reference/i.test(part))return 'style';
 }
 return assetMetadata({name:relativePath.replace(/\\/g,'/').split('/').at(-1)}).role;
}



export async function registerImagePaths(store,values,{directory=null,roles=new Map(),preserveMetadata=false}={}){
 check(Array.isArray(values)&&values.length<=5000&&values.every(v=>typeof v==='string'),'批量图片路径无效或超过 5000 张');
 const paths=[...new Set(values.map(v=>v.trim()).filter(Boolean))],results=new Array(paths.length);
 let cursor=0;
 const cached=new Map(store.db.assets.map(a=>[imagePathKey(store.assetPath(a.id)),a]));
 await Promise.all(Array.from({length:Math.min(4,paths.length)},async()=>{
  while(cursor<paths.length){const i=cursor++,filePath=paths[i];
   try{
    const same=cached.get(imagePathKey(imagePathValue(filePath))),info=await inspectImageFileAsync(filePath,{cached:same});
    results[i]={info};
   }catch(error){results[i]={error:{filePath,error:error.message}};}
  }
 }));
 // Commit against the current store after asynchronous reads; preserve concurrent edits.
 const current=new Map(store.db.assets.map(a=>[imagePathKey(store.assetPath(a.id)),a])),registered=new Map(),failed=[];
 let created=0,reused=0;
 for(let i=0;i<results.length;i++){
  const result=results[i];if(result.error){failed.push(result.error);continue;}
  const info=result.info,key=imagePathKey(info.filePath);if(registered.has(key))continue;
  let asset=current.get(key);
  if(asset?.width&&(asset.width!==info.width||asset.height!==info.height)){failed.push({filePath:paths[i],error:'同一路径的图片尺寸已变化，请重新指定图片，避免改变已有取景'});continue;}
  if(asset){Object.assign(asset,info,{inspection:'ready'});reused++;}
  else{asset={id:uid('asset'),name:path.basename(info.filePath).slice(0,180),...info,inspection:'ready',source:directory?'directory-path':'local-path',created:new Date().toISOString()};store.db.assets.push(asset);current.set(key,asset);created++;}
   if(directory){const role=roles.get(imagePathKey(paths[i]))||'other';if(!preserveMetadata||!asset.directoryRoot)Object.assign(asset,{directoryRoot:directory,relativePath:path.relative(directory,info.filePath)});if(!preserveMetadata||!asset.libraryRole||asset.libraryRole==='other')asset.libraryRole=role==='other'&&asset.libraryRole?asset.libraryRole:role;}
  registered.set(key,asset);
 }
 if(registered.size)store.save();
 return {assets:[...registered.values()],created,reused,failed};
}

export async function resolveImageAssets(store,ids){
 check(Array.isArray(ids)&&ids.length>0&&ids.length<=60,'请一次选择1—60张资产');
 const assets=[],failed=[];
 for(const id of [...new Set(ids)]){
  const original=store.asset(id),filePath=store.assetPath(id);
  try{const info=await inspectImageFileAsync(filePath,{cached:{...original}}),asset=store.asset(id);
   check(imagePathKey(store.assetPath(id))===imagePathKey(filePath),'图片路径在读取期间已改变，请重新选择',409);
   check(!asset.width||(asset.width===info.width&&asset.height===info.height),'图片尺寸已变化，请重新指定图片，避免改变已有取景');
   Object.assign(asset,info,{inspection:'ready'});assets.push(asset);
  }catch(error){failed.push({assetId:id,filePath:store.assetPath(id),error:error.message});}
 }
 if(assets.length)store.save();return {assets,failed};
}

// Cache only server-produced scans. Import accepts a token, never a list of
// untrusted client paths. Scanning and registering the same folder do one walk.

