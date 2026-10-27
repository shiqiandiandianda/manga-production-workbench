import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';import {check,id} from './project-center.mjs';
export function projectUploads(core){
 const chunkBytes=8*1024*1024;
 const start=(p,input,ownerId)=>{
  core.get('project',p);check(Number.isSafeInteger(input.totalBytes)&&input.totalBytes>0&&input.totalBytes<=5*1024**3,'分片文件大小需为1字节到5GB');const declared=input.sha256||'';check(!declared||/^[a-f0-9]{64}$/.test(declared),'文件SHA256格式无效');
  const old=core.list('upload',p).find(u=>u.ownerId===ownerId&&u.clientRequestId===input.clientRequestId&&input.clientRequestId);if(old){check(old.declaredSha256===declared&&old.totalBytes===input.totalBytes,'上传编号已用于不同文件',409);return old;}
  const name=path.basename(String(input.name||'').replaceAll('\\','/'));check(name&&name.length<240,'文件名无效');const u={id:id('upload'),projectId:p,ownerId,name,mime:String(input.mime||'application/octet-stream'),type:String(input.type||'original'),sha256:input.sha256,totalBytes:input.totalBytes,clientRequestId:input.clientRequestId,chunkBytes,chunkCount:Math.ceil(input.totalBytes/chunkBytes),chunks:{},status:'uploading'};
  u.declaredSha256=declared;fs.mkdirSync(path.join(core.directory,'uploads',u.id),{recursive:true});return core.put('upload',u);
 };
 function get(p,key,owner){const u=core.get('upload',key,p);check(u.ownerId===owner,'上传会话不属于此调用方',403);return u;}
 function chunk(p,key,n,bytes,owner){const u=get(p,key,owner);check(u.status==='uploading','文件正在合并或已完成',409);check(Number.isInteger(n)&&n>=0&&n<u.chunkCount,'分片编号无效');const expected=n===u.chunkCount-1?u.totalBytes-n*chunkBytes:chunkBytes;check(bytes.length===expected,'分片大小与声明不符');const digest=createHash('sha256').update(bytes).digest('hex');if(u.chunks[n])check(u.chunks[n]===digest,'同一分片内容不一致',409);else{const part=path.join(core.directory,'uploads',u.id,n+'.part');if(fs.existsSync(part))check(createHash('sha256').update(fs.readFileSync(part)).digest('hex')===digest,'暂存分片与请求不符',409);else fs.writeFileSync(part,bytes,{flag:'wx'});u.chunks[n]=digest;core.put('upload',u);}return {ok:true,index:n,received:Object.keys(u.chunks).length};}
 async function complete(p,key,owner){let u=get(p,key,owner);if(u.status==='completed')return core.get('file',u.fileId,p);check(u.status==='uploading'&&Object.keys(u.chunks).length===u.chunkCount,'分片未齐或正在合并',409);u.status='assembling';core.put('upload',u);
  const scratch=path.join(core.directory,'uploads',u.id,'assembled'),out=fs.openSync(scratch,'w'),digest=createHash('sha256');
  try{for(let n=0;n<u.chunkCount;n++)for await(const bytes of fs.createReadStream(path.join(core.directory,'uploads',u.id,n+'.part'))){digest.update(bytes);fs.writeSync(out,bytes);}fs.fsyncSync(out);fs.closeSync(out);const actual=digest.digest('hex');check(!u.declaredSha256||actual===u.declaredSha256,'文件整体校验失败，未入库',422);u.sha256=actual;
   const existing=core.list('file',p).filter(f=>f.name===u.name),duplicate=existing.find(f=>f.sha256===u.sha256);let record=duplicate;
   if(!record){const folder=path.join(core.directory,'projects',p,'blobs');fs.mkdirSync(folder,{recursive:true});const destination=path.join(folder,u.sha256+path.extname(u.name).toLowerCase());if(!fs.existsSync(destination))fs.copyFileSync(scratch,destination,fs.constants.COPYFILE_EXCL);record=core.put('file',{id:id('file'),projectId:p,name:u.name,mime:u.mime,type:u.type,path:destination,sha256:u.sha256,bytes:u.totalBytes,version:existing.length+1,previousId:existing.at(-1)?.id||null,createdAt:new Date().toISOString()});core.event(p,'file.uploaded',{fileId:record.id,name:record.name,version:record.version});}
   u.status='completed';u.fileId=record.id;core.put('upload',u);
   const staging=path.resolve(core.directory,'uploads',u.id),allowed=path.resolve(core.directory,'uploads')+path.sep;check(staging.startsWith(allowed),'上传暂存路径越界',500);fs.rmSync(staging,{recursive:true,force:true});return record;
  }catch(error){try{fs.closeSync(out);}catch{}u.status='uploading';core.put('upload',u);throw error;}
 }
 return {start,get,chunk,complete};
}
