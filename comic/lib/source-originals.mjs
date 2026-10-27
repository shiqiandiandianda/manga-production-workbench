import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {writeFileAtomicSync} from './durable-files.mjs';

const MAX_FILE=40*1024*1024;
export const ORIGINAL_ROLES=Object.freeze({novel:'小说',rules:'制作规范',client:'甲方资料',template:'甲方样表',draft:'甲方分镜稿',outline:'分话细纲',production:'生产分镜表',storyboard:'导入分镜表',layoutPlan:'排版计划JSON',feedback:'甲方反馈'});
const check=(ok,message,status=400)=>{if(!ok)throw Object.assign(new Error(message),{status});};
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const key=file=>`${file.role}:${file.hash}:${file.name}`;
export function sourceOriginalPath(dataDir,projectId,hash){
 check(/^project_[0-9a-f-]{36}$/u.test(projectId)&&/^[a-f0-9]{64}$/u.test(hash),'原件编号无效');
 return path.join(path.resolve(dataDir),'original-uploads',projectId,hash+'.bin');
}
export function decodeOriginalUpload(file,role){
 check(Object.hasOwn(ORIGINAL_ROLES,role)&&file&&typeof file.name==='string'&&file.name.length<=240,'原件资料格式无效');
 const name=path.basename(file.name.replaceAll('\\','/'));check(name&&name!=='.'&&name!=='..'&&!/[\x00-\x1f]/u.test(name),'原件文件名无效');
 let bytes=file.bytes;
 if(!Buffer.isBuffer(bytes)){check(typeof file.base64==='string'&&file.base64.length<=MAX_FILE*1.4&&/^[A-Za-z0-9+/=\r\n]+$/u.test(file.base64),'原件内容无效或超过40MB',413);bytes=Buffer.from(file.base64,'base64');}
 check(bytes.length>0&&bytes.length<=MAX_FILE,'原件为空或超过40MB',413);
 return {role,name,bytes,hash:digest(bytes),size:bytes.length};
}
export function validateOriginalRecords(records){
 if(records===undefined)return;
 check(Array.isArray(records)&&records.length<=1000,'原件记录过多');
 for(const file of records)check(file&&Object.hasOwn(ORIGINAL_ROLES,file.role)&&typeof file.name==='string'&&file.name.length<=240&&/^[a-f0-9]{64}$/u.test(file.hash)&&Number.isSafeInteger(file.size)&&file.size>0&&file.size<=MAX_FILE&&!Object.hasOwn(file,'filePath')&&!Object.hasOwn(file,'path'),'原件记录无效');
}
export function preserveOriginalUploads({dataDir,projectId,records=[],files}){
 validateOriginalRecords(records);const decoded=files.map(file=>decodeOriginalUpload(file,file.role));
 check([...new Map(decoded.map(file=>[file.hash,file.size])).values()].reduce((sum,size)=>sum+size,0)<=MAX_FILE,'所选原件合计超过40MB，请分批补存',413);
 const next=structuredClone(records);
 for(const file of decoded){
  const target=sourceOriginalPath(dataDir,projectId,file.hash);fs.mkdirSync(path.dirname(target),{recursive:true});
  // Restore missing/corrupt archived bytes only; never rewrite the user's source file.
  if(!fs.existsSync(target)||digest(fs.readFileSync(target))!==file.hash)writeFileAtomicSync(target,file.bytes);
  const index=next.findIndex(saved=>key(saved)===key(file)),metadata={role:file.role,name:file.name,hash:file.hash,size:file.size,preservedAt:new Date().toISOString()};
  if(index<0)next.push(metadata);else next[index]={...next[index],...metadata};
 }
 validateOriginalRecords(next);return next;
}

export function knownOriginalFiles(project){const files=new Map();for(const file of project.sourceOriginalFiles||[])if(file&&Object.hasOwn(ORIGINAL_ROLES,file.role)&&/^[a-f0-9]{64}$/.test(file.hash)&&typeof file.name==='string')files.set(key(file),{...file,current:true});return [...files.values()];}





