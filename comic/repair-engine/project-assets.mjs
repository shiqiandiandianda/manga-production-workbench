import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile,lstat,open,rm} from 'node:fs/promises';
import {replaceFile} from './safe-files.mjs';
import {createReadStream,createWriteStream} from 'node:fs';
import {pipeline} from 'node:stream/promises';
export const MAX_ASSET_BYTES=164*1024*1024;
export function validateAssetLimits({byteLength=0,width,height}={}){
 if(!Number.isSafeInteger(byteLength)||byteLength<0||byteLength>MAX_ASSET_BYTES)throw new Error('工程图片超过内部资产大小上限');
 if(width!==undefined&&(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>32768||height>32768||width*height>40000000))throw new Error('工程图片尺寸无效');
}
const sourcePattern=/^[a-f0-9]{32}$/;
const referencePattern=/^\/project-assets\/([a-f0-9]{32})\/([a-f0-9]{64}\.png)$/;
const dataPattern=/^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/;
export function parseAssetReference(value){return typeof value==='string'?referencePattern.exec(value):null;}
export function isAssetReference(value){return !!parseAssetReference(value);}
export function pngDimensions(bytes){
 if(bytes.length<33||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||bytes.toString('ascii',12,16)!=='IHDR')throw new Error('工程图片必须是有效 PNG');
 const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);validateAssetLimits({width,height});return{width,height};
}
export async function assetFile(root,sourceId,name){
 if(!sourcePattern.test(sourceId)||!/^([a-f0-9]{64})\.png$/.test(name))throw new Error('工程图片引用无效');
 const base=path.resolve(root,'project-assets'),folder=path.join(base,sourceId),file=path.join(folder,name);
 for(const item of [base,folder,file]){const info=await lstat(item);if(info.isSymbolicLink()||(item===file&&(!info.isFile()||info.size>MAX_ASSET_BYTES)))throw new Error('工程图片路径或大小无效');}
 return file;
}
export async function fileForReference(root,sourceId,value){const match=parseAssetReference(value);if(!match||match[1]!==sourceId)throw new Error('工程图片不属于当前漫画');return assetFile(root,sourceId,match[2]);}
export async function assetDimensions(file){const handle=await open(file,'r');try{const bytes=Buffer.alloc(33),{bytesRead}=await handle.read(bytes,0,33,0);return pngDimensions(bytes.subarray(0,bytesRead));}finally{await handle.close();}}
export async function imageDataURL(root,sourceId,value){return isAssetReference(value)?'data:image/png;base64,'+(await readFile(await fileForReference(root,sourceId,value))).toString('base64'):value;}
export function collectAssetReferences(value,sourceId){
 const references=new Set();function visit(item){if(typeof item==='string'){const match=parseAssetReference(item);if(match){if(match[1]!==sourceId)throw new Error('工程图片不属于当前漫画');references.add(item);}return;}if(Array.isArray(item)){for(const child of item)visit(child);}else if(item&&typeof item==='object')for(const child of Object.values(item))visit(child);}
 visit(value);return references;
}
export class ProjectAssets {
 constructor(root){this.root=root;this.pending=new Map();}
 async put(sourceId,bytes){
  if(!sourcePattern.test(sourceId))throw new Error('漫画项目不存在');validateAssetLimits({byteLength:bytes.length});const dimensions=pngDimensions(bytes),hash=createHash('sha256').update(bytes).digest('hex'),image=`/project-assets/${sourceId}/${hash}.png`,key=sourceId+'/'+hash;
  if(!this.pending.has(key)){const pending=(async()=>{const base=path.resolve(this.root,'project-assets'),folder=path.join(base,sourceId);await mkdir(folder,{recursive:true});for(const directory of [base,folder])if((await lstat(directory)).isSymbolicLink())throw new Error('工程图片路径无效');const file=path.join(folder,hash+'.png');try{const info=await lstat(file);if(info.isSymbolicLink())throw new Error('工程图片路径无效');if(info.size===bytes.length)return;}catch(error){if(error.code!=='ENOENT')throw error;}const temporary=file+'.'+randomUUID()+'.tmp';try{await writeFile(temporary,bytes);await replaceFile(temporary,file);}finally{await rm(temporary,{force:true});}})();this.pending.set(key,pending);pending.finally(()=>{if(this.pending.get(key)===pending)this.pending.delete(key);}).catch(()=>{});}
  await this.pending.get(key);return{image,...dimensions};
 }
 async putFile(sourceId,file){
  if(!sourcePattern.test(sourceId))throw new Error('漫画项目不存在');const info=await lstat(file);if(info.isSymbolicLink()||!info.isFile())throw new Error('工程图片路径无效');validateAssetLimits({byteLength:info.size});const dimensions=await assetDimensions(file),digest=createHash('sha256');for await(const chunk of createReadStream(file))digest.update(chunk);const hash=digest.digest('hex'),image=`/project-assets/${sourceId}/${hash}.png`,key=sourceId+'/'+hash;
  if(!this.pending.has(key)){const pending=(async()=>{const base=path.resolve(this.root,'project-assets'),folder=path.join(base,sourceId);await mkdir(folder,{recursive:true});for(const directory of [base,folder])if((await lstat(directory)).isSymbolicLink())throw new Error('工程图片路径无效');const target=path.join(folder,hash+'.png');try{const saved=await lstat(target);if(saved.isSymbolicLink())throw new Error('工程图片路径无效');if(saved.size===info.size)return;}catch(error){if(error.code!=='ENOENT')throw error;}const temporary=target+'.'+randomUUID()+'.tmp';try{await pipeline(createReadStream(file),createWriteStream(temporary));await replaceFile(temporary,target);}finally{await rm(temporary,{force:true});}})();this.pending.set(key,pending);pending.finally(()=>{if(this.pending.get(key)===pending)this.pending.delete(key);}).catch(()=>{});}
  await this.pending.get(key);return{image,...dimensions};
 }
 async externalize(sourceId,value,{markProject=true}={}){
  collectAssetReferences(value,sourceId);let changed=false;const dimensions=new Map(),encoded=new Map(),validated=new Map();
  const convert=async image=>{if(typeof image!=='string')return image;const match=dataPattern.exec(image);if(match){if(!encoded.has(image))encoded.set(image,this.put(sourceId,Buffer.from(match[1],'base64')));const asset=await encoded.get(image);dimensions.set(asset.image,{width:asset.width,height:asset.height});changed=true;return asset.image;}if(image.startsWith('data:image/png;'))throw new Error('工程图片编码无效');if(image.startsWith('/project-assets/')){if(!validated.has(image))validated.set(image,(async()=>{const file=await fileForReference(this.root,sourceId,image);return assetDimensions(file);})());dimensions.set(image,await validated.get(image));}return image;};
  const visit=async item=>{if(typeof item==='string')return convert(item);if(Array.isArray(item)){const output=[];for(const child of item)output.push(await visit(child));return output;}if(!item||typeof item!=='object')return item;const output={};for(const [key,child] of Object.entries(item))output[key]=await visit(child);if(output.type==='image'&&typeof output.image==='string'&&dimensions.has(output.image)){const size=dimensions.get(output.image);if(output.imageWidth!==size.width||output.imageHeight!==size.height)changed=true;output.imageWidth=size.width;output.imageHeight=size.height;}return output;};
  const project=await visit(value);if(markProject&&project&&typeof project==='object'&&!Array.isArray(project)){if(project.assetsVersion!==1)changed=true;project.assetsVersion=1;}return{value:project,changed};
 }
}