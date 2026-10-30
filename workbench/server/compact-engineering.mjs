import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {brotliCompressSync,brotliDecompressSync,constants} from 'node:zlib';
const hash=b=>createHash('sha256').update(b).digest('hex');
export function encodeEngineering(bytes){
 const packed=brotliCompressSync(bytes,{params:{[constants.BROTLI_PARAM_QUALITY]:4}});
 if(packed.length>=bytes.length*.9)return null;
 if(hash(brotliDecompressSync(packed))!==hash(bytes))throw Error('工程压缩还原校验失败');return packed;
}
export function compressEngineeringBatch(core,{limit=20,maxBytes=50*1024*1024}={}){
 let files=0,processedBytes=0,savedBytes=0;const errors=[];
 for(const record of core.list('file')){
  if(files>=limit||processedBytes>=maxBytes)break;
  if(record.type!=='comic-project'||record.storageEncoding||!record.path||!record.path.endsWith('.json'))continue;
  try{
   const root=path.resolve(core.directory),file=path.resolve(record.path),rel=path.relative(root,file);
   if(!rel.startsWith('projects'+path.sep)||rel.split(path.sep).includes('..')||fs.lstatSync(file).isSymbolicLink()||path.relative(root,fs.realpathSync(file)).startsWith('..'))throw Error('快照路径不在本机工程归档目录');
   const raw=fs.readFileSync(file);if(hash(raw)!==record.sha256)throw Error('工程原件摘要不符，保留原件');
   const packed=encodeEngineering(raw);processedBytes+=raw.length;if(!packed)continue;
   const target=file+'.br',temp=target+'.tmp';fs.writeFileSync(temp,packed);fs.renameSync(temp,target);
   const records=core.list('file').filter(r=>r.path===file);
   core.tx(()=>{for(const r of records)core.put('file',{...r,path:target,storageEncoding:'br',storageBytes:packed.length,storageSha256:hash(packed)});});
   fs.unlinkSync(file);files++;savedBytes+=raw.length-packed.length;
  }catch(error){errors.push({id:record.id,error:error.message});}
 }
 return {files,processedBytes,savedBytes,errors,remaining:core.list('file').filter(r=>r.type==='comic-project'&&!r.storageEncoding&&r.path?.endsWith('.json')).length};
}
