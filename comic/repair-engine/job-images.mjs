import path from 'node:path';
import {createReadStream,existsSync} from 'node:fs';
import {readFile,writeFile,open,lstat,mkdir,link,copyFile,unlink} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {replaceFile} from './safe-files.mjs';

const jobs=/^\d{8}-\d{6}-[a-f0-9]{8}$/;
const sources=/^[a-f0-9]{32}$/;
const hashes=new Map(),pending=new Map();
export async function imageHash(file){
  const info=await lstat(file),key=[info.size,info.mtimeMs,info.ctimeMs].join(':');
  if(info.isSymbolicLink()||!info.isFile())throw new Error('任务图片路径无效');
  const prior=hashes.get(file);if(prior?.key===key)return prior.hash;
  const digest=createHash('sha256');for await(const bytes of createReadStream(file))digest.update(bytes);
  const hash=digest.digest('hex');hashes.set(file,{key,hash});if(hashes.size>1000)hashes.delete(hashes.keys().next().value);return hash;
}
export async function pageDimensions(file){
  const handle=await open(file,'r');try{const header=Buffer.alloc(33);await handle.read(header,0,33,0);if(!header.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||header.toString('ascii',12,16)!=='IHDR')throw new Error('任务图片必须是 PNG');return {width:header.readUInt32BE(16),height:header.readUInt32BE(20)};}finally{await handle.close();}
}
export function sourceImageRef(root,file){return '/'+path.relative(root,file).split(path.sep).join('/');}
export async function jobBaseFile(root,request,dir=path.join(root,'jobs',request.id)){
  const local=path.join(dir,'base.png');if(existsSync(local)){await imageHash(local);return local;}
  const ref=request.baseImageRef,match=typeof ref==='string'&&/^\/sources\/([a-f0-9]{32})\/(original\.png|revision-\d+\.png|submission-images\/[a-f0-9]{64}\.png)$/.exec(ref);
  if(!match||match[1]!==request.sourceId)throw Object.assign(new Error('任务原图引用无效'),{code:'ENOENT'});
  const folder=path.resolve(root,'sources',request.sourceId),file=path.resolve(root,'.'+ref);
  for(const item of [path.join(root,'sources'),folder,...(match[2].includes('/')?[path.dirname(file)]:[]),file])if((await lstat(item)).isSymbolicLink())throw new Error('任务原图路径无效');
  await imageHash(file);return file;
}
async function atomicJSON(file,value){const temporary=file+'.'+randomUUID()+'.tmp';await writeFile(temporary,JSON.stringify(value),'utf-8');await replaceFile(temporary,file);}

// Preserve every historical byte; only replace duplicate task files with owned references.
export async function compactJobBase(root,id){
  if(!jobs.test(id))throw new Error('任务编号无效');const key=path.resolve(root,'jobs',id);
  if(pending.has(key))return pending.get(key);
  const action=(async()=>{
    const file=path.join(key,'request.json'),request=JSON.parse(await readFile(file,'utf8'));
    if(request.id!==id||!sources.test(request.sourceId))return {id,changed:false,reason:'unowned'};
    let automation;try{automation=JSON.parse(await readFile(path.join(key,'automation.json'),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
    if(['queued','running'].includes(automation?.status))return {id,changed:false,reason:'active'};
    const local=path.join(key,'base.png');if(!existsSync(local))return {id,changed:false,reason:'already-referenced'};
    const source=path.join(root,'sources',request.sourceId);for(const folder of [path.join(root,'jobs'),key,path.join(root,'sources'),source])if((await lstat(folder)).isSymbolicLink())throw new Error('任务目录无效');const meta=JSON.parse(await readFile(path.join(source,'metadata.json'),'utf8'));
    if(meta.id!==request.sourceId||meta.deletedAt)throw new Error('任务原图不属于有效漫画');
    const hash=await imageHash(local);if(hash!==request.sourceHash)throw new Error('任务原图校验不一致，未整理：'+id);
    const original=path.join(source,'original.png');let shared=original;
    if(await imageHash(original)!==hash){
      const folder=path.join(source,'submission-images');await mkdir(folder,{recursive:true});if((await lstat(folder)).isSymbolicLink())throw new Error('共享原图目录无效');shared=path.join(folder,hash+'.png');
      if(!existsSync(shared)){try{await link(local,shared);}catch(error){if(error.code!=='EEXIST'){const temporary=shared+'.'+randomUUID()+'.tmp';await copyFile(local,temporary);await replaceFile(temporary,shared);}}}
      if(await imageHash(shared)!==hash)throw new Error('共享原图校验失败');
    }
    request.baseImageRef=sourceImageRef(root,shared);request.storageVersion=2;
    const cropFile=path.join(key,'crop.png');
    if(request.regionId&&existsSync(cropFile)){const size=await pageDimensions(cropFile);if(size.width!==request.crop.width||size.height!==request.crop.height)throw new Error('提交局部图尺寸不一致');request.inputSnapshot={kind:'local-crop',file:'crop.png',sha256:await imageHash(cropFile),sourceSize:await pageDimensions(shared)};}
    const bytes=(await lstat(local)).size;await atomicJSON(file,request);
    if(await imageHash(shared)!==hash)throw new Error('共享原图发生变化');await unlink(local);
    return {id,changed:true,logicalBytesRemoved:bytes,reference:request.baseImageRef};
  })();pending.set(key,action);try{return await action;}finally{pending.delete(key);}
}
