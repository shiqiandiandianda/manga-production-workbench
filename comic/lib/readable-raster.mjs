import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';

// Some valid PNGs decode in browsers/Pillow but fail in the native canvas codec.
// Re-encode a content-addressed cache copy; never rewrite the user's original.
export async function readableRaster(native,bytes,{file,cacheDir}){
 try{return await native.loadImage(bytes);}catch(original){
  const raster=bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))||bytes[0]===255&&bytes[1]===216||bytes.subarray(0,4).toString()==='RIFF'||bytes.subarray(0,3).toString()==='GIF';
  if(!raster)throw original;
  const python=process.env.COMIC_IMAGE_TOOLS_ROOT?path.join(process.env.COMIC_IMAGE_TOOLS_ROOT,'python/python.exe'):fileURLToPath(new URL('../../.runtime/image-tools/python/python.exe',import.meta.url));
  const script=fileURLToPath(new URL('../python/decode_raster.py',import.meta.url));fs.mkdirSync(cacheDir,{recursive:true});
  const target=path.join(cacheDir,createHash('sha256').update(bytes).digest('hex')+'.png');
  if(!fs.existsSync(target)){
   const pending=path.join(cacheDir,randomUUID()+'.pending.png');
   try{await new Promise((resolve,reject)=>{let message='';const child=spawn(python,[script,'--input',file,'--output',pending],{windowsHide:true,stdio:['ignore','ignore','pipe'],env:{...process.env,PYTHONUTF8:'1'}});const timer=setTimeout(()=>{child.kill();reject(Error('图片兼容解码超时，原图保留'));},60000);child.stderr.on('data',chunk=>message=(message+chunk).slice(-2000));child.on('error',error=>{clearTimeout(timer);reject(error);});child.on('close',code=>{clearTimeout(timer);code===0?resolve():reject(Error('来源图片解码失败，未修改原图：'+message));});});if(!fs.existsSync(target))fs.renameSync(pending,target);}finally{if(fs.existsSync(pending))fs.unlinkSync(pending);}
  }
  return await native.loadImage(fs.readFileSync(target));
 }
}
