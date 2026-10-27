import {rasterDecodeBytes} from './png-decode.mjs';
import {createRequire} from 'node:module';
import path from 'node:path';
import os from 'node:os';
import {check,hash} from './common.mjs';
const require=createRequire(import.meta.url);
let native;
export async function inspectImage(bytes){
 check(Buffer.isBuffer(bytes)&&bytes.length>24&&bytes.length<=30*1024*1024,'图片为空或超过30MB');
 let mime,extension;
 if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))){mime='image/png';extension='.png';check(bytes.readUInt32BE(16)<=16384&&bytes.readUInt32BE(20)<=16384&&bytes.readUInt32BE(16)*bytes.readUInt32BE(20)<=64000000,'图片像素过大');}
 else if(bytes[0]===255&&bytes[1]===216){mime='image/jpeg';extension='.jpg';}
 else if(bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP'){mime='image/webp';extension='.webp';}
 else check(false,'只接受 PNG、JPEG 或 WebP 图片');
 native||=require(process.env.ASSET_CENTER_CANVAS_MODULE||process.env.COMIC_CANVAS_MODULE||path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@napi-rs/canvas'));
 let image;try{image=await native.loadImage(rasterDecodeBytes(bytes));}catch{check(false,'图片无法完整解码');}
 const width=image.width,height=image.height;check(width>0&&height>0&&width<=16384&&height<=16384&&width*height<=64000000,'图片像素过大');
 return {width,height,mime,extension,sha256:hash(bytes),size:bytes.length};
}
export function decodeImage(value){check(typeof value==='string'&&value.length<=42*1024*1024&&/^[A-Za-z0-9+/]+={0,2}$/.test(value)&&value.length%4===0,'图片需要有效的base64内容');return Buffer.from(value,'base64');}
