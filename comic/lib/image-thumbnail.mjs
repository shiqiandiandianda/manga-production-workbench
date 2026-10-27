import {compatibleCanvas} from './canvas-image-compat.mjs';
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {createRequire} from 'node:module';import {createHash,randomUUID} from 'node:crypto';
import {mountedImageIO} from './mounted-io.mjs';
const require=createRequire(import.meta.url);
const pngSignature=Buffer.from([137,80,78,71,13,10,26,10]);
const crcTable=Uint32Array.from({length:256},(_,n)=>{for(let bit=0;bit<8;bit++)n=(n>>>1)^((n&1)?0xedb88320:0);return n>>>0;});
function completeCachedPng(bytes){
 if(bytes.length<33||!bytes.subarray(0,8).equals(pngSignature)||bytes.readUInt32BE(8)!==13||bytes.toString('ascii',12,16)!=='IHDR')return false;
 let offset=8,imageData=false;
 while(offset+12<=bytes.length){
  const length=bytes.readUInt32BE(offset),end=offset+length+12;if(end>bytes.length)return false;
  let crc=0xffffffff;for(let index=offset+4;index<end-4;index++)crc=crcTable[(crc^bytes[index])&255]^(crc>>>8);
  if(((crc^0xffffffff)>>>0)!==bytes.readUInt32BE(end-4))return false;
  const type=bytes.toString('ascii',offset+4,offset+8);if(type==='IDAT')imageData=true;
  if(type==='IEND')return imageData&&length===0&&end===bytes.length;
  offset=end;
 }
 return false;
}
export function createImageThumbnails(directory){
 const pending=new Map();let canvas=null,active=0;const waiters=[];
 const acquire=async()=>{if(active<3){active++;return;}await new Promise(resolve=>waiters.push(resolve));};
 const release=()=>{const next=waiters.shift();if(next)next();else active--;};
 return async asset=>{
  const stat=await mountedImageIO(asset.filePath,()=>fs.promises.stat(asset.filePath)),key=createHash('sha256').update(asset.filePath+':'+stat.size+':'+stat.mtimeMs).digest('hex'),file=path.join(directory,key+'.png');
  if(pending.has(key))return pending.get(key);
  const work=(async()=>{await acquire();let temporary;try{
   canvas||=compatibleCanvas(require(process.env.COMIC_CANVAS_MODULE||path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@napi-rs/canvas')));
   if(fs.existsSync(file)){try{const cached=await fs.promises.readFile(file);if(completeCachedPng(cached)){await canvas.loadImage(cached);return file;}}catch{/* Rebuild an incomplete or damaged cache from its original path. */}}
   const bytes=await mountedImageIO(asset.filePath,()=>fs.promises.readFile(asset.filePath)),image=await canvas.loadImage(bytes),scale=Math.min(1,480/image.width,280/image.height),width=Math.max(1,Math.round(image.width*scale)),height=Math.max(1,Math.round(image.height*scale)),output=canvas.createCanvas(width,height);
   output.getContext('2d').drawImage(image,0,0,width,height);await fs.promises.mkdir(directory,{recursive:true});temporary=file+'.'+randomUUID()+'.tmp';
   await fs.promises.writeFile(temporary,output.toBuffer('image/png'));await fs.promises.rename(temporary,file);return file;
  }finally{if(temporary)await fs.promises.rm(temporary,{force:true}).catch(()=>{});release();}})().finally(()=>pending.delete(key));pending.set(key,work);return work;
 };
}
