import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {writeZip,readZip} from './xlsx.mjs';
import {writeFileAtomicSync} from './durable-files.mjs';
import {inflateRawSync} from 'node:zlib';
export const bytesHash=b=>createHash('sha256').update(b).digest('hex');
export function backupEntryBytes(zip,name){
 let end=-1;for(let i=zip.length-22;i>=Math.max(0,zip.length-65557);i--)if(zip.readUInt32LE(i)===0x06054b50){end=i;break;}
 if(end<0)throw Error('备份压缩包目录缺失');let at=zip.readUInt32LE(end+16);const count=zip.readUInt16LE(end+10);
 for(let n=0;n<count;n++){if(zip.readUInt32LE(at)!==0x02014b50)throw Error('备份压缩目录损坏');const len=zip.readUInt16LE(at+28),extra=zip.readUInt16LE(at+30),comment=zip.readUInt16LE(at+32),method=zip.readUInt16LE(at+10),size=zip.readUInt32LE(at+20),offset=zip.readUInt32LE(at+42),entry=zip.toString('utf8',at+46,at+46+len);at+=46+len+extra+comment;
  if(entry!==name)continue;if(zip.readUInt32LE(offset)!==0x04034b50)throw Error('备份条目损坏');const start=offset+30+zip.readUInt16LE(offset+26)+zip.readUInt16LE(offset+28);if(start+size>zip.length)throw Error('备份条目大小无效');
  const data=zip.subarray(start,start+size);if(method===0)return Buffer.from(data);if(method===8)return inflateRawSync(data,{maxOutputLength:256*1024*1024});throw Error('备份压缩方式无效');
 }throw Error('备份缺少指定原件');
}
export async function uploadVerifiedBackup({library,dataDir,projectId,name,entries}){
 const archive=writeZip(entries),sha256=bytesHash(archive);
 if(archive.length>240*1024*1024)throw Error('单份备份超过240MB，需要分批归档');
 const folder=path.join(dataDir,'storage-maintenance','backups');fs.mkdirSync(folder,{recursive:true});
 const local=path.join(folder,sha256+'.zip');if(!fs.existsSync(local))writeFileAtomicSync(local,archive);
 const run=async()=>{
  const priorFile=path.join(folder,sha256+'.receipt.json');let prior;try{prior=JSON.parse(fs.readFileSync(priorFile,'utf8'));}catch{}
  const sent=prior?.projectId===projectId&&prior?.sha256===sha256?prior:await library.uploadAsset({projectId,scopeId:'project',assetKind:'file',assetType:'project_archive',name:'工作台备份_'+sha256.slice(0,20)+'.zip',bytes:archive,mime:'application/zip',operationId:'storage-backup:'+sha256});
  if(!/^[a-f0-9-]{36}$/i.test(sent?.assetId||'')||!/^[a-f0-9-]{36}$/i.test(sent?.revisionId||''))throw Error('墨库没有返回固定备份版本，原件保留');
  library.rememberClassifiedAsset?.({...sent,id:sent.assetId,recommendedRevisionId:sent.revisionId,projectId,scopeId:'project',assetKind:'file',assetType:'project_archive'});
  const response=await library.remote('/api/revisions/'+sent.revisionId+'/download');
  const h=createHash('sha256');let size=0;for await(const chunk of response.body){size+=chunk.length;if(size>archive.length)throw Error('墨库备份回读大小不符');h.update(chunk);}
  library.assertSession?.();if(size!==archive.length||h.digest('hex')!==sha256)throw Error('墨库备份回读摘要不符，原文件保留');
  const receipt={projectId,assetId:sent.assetId,revisionId:sent.revisionId,sha256,size,verifiedAt:new Date().toISOString(),name,local,entries:entries.map(e=>({name:e.name,sha256:bytesHash(Buffer.isBuffer(e.data)?e.data:Buffer.from(e.data)),size:Buffer.byteLength(e.data)}))};
  writeFileAtomicSync(path.join(folder,sha256+'.receipt.json'),JSON.stringify(receipt));
  // The verified fixed revision is the backup. Keeping another complete local
  // ZIP would replace the reclaimed files with equally large local archives.
  try{fs.unlinkSync(local);}catch{}
  return receipt;
 };
 // Check that the local ZIP is itself readable before declaring any cloud backup.
 if(readZip(archive).names().length!==entries.length)throw Error('备份压缩包结构校验失败');
 return library.withSession?library.withSession(run):run();
}
