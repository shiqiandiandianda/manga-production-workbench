import {readFile,readdir,stat,realpath,lstat} from 'node:fs/promises';
import path from 'node:path';
const missing=()=>Object.assign(Error('Codex 没有返回本次任务实际生成的 PNG 图片。'),{code:'codex_image_missing',providerConfirmed:true});
const invalid=()=>Object.assign(Error('Codex 返回的图片文件格式无效。'),{code:'codex_image_invalid',providerConfirmed:true});
const aspect=()=>Object.assign(Error('Codex 本次返回的原图不符合横向16:9要求。'),{code:'codex_image_aspect',providerConfirmed:true});
function landscape(bytes){if(bytes.length<24)return false;const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);return width>0&&height>0&&width/height>=1.65&&width/height<=1.9;}

// Recover only an unambiguous fresh image from this exact CLI request's thread.
export async function generatedImageBytes({codexHome,threadId,reportedPath,startedAt,requireLandscape=false}){
  if(!/^[a-f0-9-]{36}$/i.test(threadId||''))throw missing();
  const folder=path.resolve(codexHome,'generated_images',threadId);
  let actualFolder;try{actualFolder=await realpath(folder);}catch{throw missing();}
  if(path.resolve(actualFolder)!==folder)throw missing();
  async function readCandidate(file){
    if(path.dirname(path.resolve(file))!==folder||!file.toLowerCase().endsWith('.png'))throw missing();
    const info=await lstat(file);if(!info.isFile()||info.isSymbolicLink()||info.mtimeMs<startedAt-2000)throw missing();
    if(info.size>40*1024*1024)throw invalid();const bytes=await readFile(file);
    if(!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||!bytes.subarray(-12).equals(Buffer.from([0,0,0,0,73,69,78,68,174,66,96,130])))throw invalid();
    if(requireLandscape&&!landscape(bytes))throw aspect();return bytes;
  }
  if(typeof reportedPath==='string'&&path.dirname(path.resolve(reportedPath))===folder){try{return await readCandidate(reportedPath);}catch(error){if(error.code==='codex_image_invalid')throw error;}}
  const files=[];for(const entry of await readdir(folder,{withFileTypes:true})){if(!entry.isFile()||!entry.name.toLowerCase().endsWith('.png'))continue;const file=path.join(folder,entry.name);if((await stat(file)).mtimeMs>=startedAt-2000)files.push(file);}
  if(requireLandscape){const eligible=[];for(const file of files){try{eligible.push(await readCandidate(file));}catch(error){if(!['codex_image_aspect','codex_image_invalid'].includes(error.code))throw error;}}if(eligible.length===1)return eligible[0];if(!eligible.length&&files.length)throw aspect();throw missing();}
  if(files.length!==1)throw missing();return await readCandidate(files[0]);
}
