import {collaborationStorage} from './collaboration-storage.mjs';
import {brotliCompressSync,brotliDecompressSync,constants} from 'node:zlib';
import {createHash} from 'node:crypto';
import {check} from './store.mjs';
export const SNAPSHOT_FORMAT='comic-strip-project-snapshot';
export const SNAPSHOT_REQUEST_BUDGET=512*1024;
const MAX_BYTES=128*1024*1024;
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function encodeProjectSnapshot(content,library,{projectId,forceAsset=false,uploadedAsset,inlineOnly=false}={}){
 const raw=Buffer.from(JSON.stringify(content));check(raw.length<=MAX_BYTES,'工程快照超过128MB，请拆分工程');
 if(!forceAsset&&raw.length<=SNAPSHOT_REQUEST_BUDGET)return {content,schemaVersion:1,references:[]};
 const bytes=brotliCompressSync(raw,{params:{[constants.BROTLI_PARAM_QUALITY]:5}});
 const payload={encoding:'br',jsonBytes:raw.length,jsonSha256:digest(raw),size:bytes.length,sha256:digest(bytes)};
 const encoded={format:SNAPSHOT_FORMAT,version:2,projectId:content.projectId,title:content.title,revision:content.revision,updated:content.updated,exportedAt:content.exportedAt,stableHash:content.stableHash,payload:{...payload,storage:'inline',dataBase64:bytes.toString('base64')}};
 if(inlineOnly||!forceAsset&&Buffer.byteLength(JSON.stringify(encoded))<=SNAPSHOT_REQUEST_BUDGET)return {content:encoded,schemaVersion:2,references:[]};
 check(typeof library.uploadAsset==='function','墨库分片上传不可用，工程仍已保存在本机');
 const uploaded=uploadedAsset?.sha256===payload.sha256?uploadedAsset:await library.uploadAsset({projectId,name:(String(content.title||'工程').slice(0,100)+'_工程快照_'+content.stableHash.slice(0,12)+'.json.br'),bytes,mime:'application/octet-stream',folder:collaborationStorage(content.project||{id:content.projectId,title:content.title}).snapshot,category:'reference'});
 check(/^[a-f0-9-]{36}$/i.test(uploaded?.assetId||'')&&/^[a-f0-9-]{36}$/i.test(uploaded?.revisionId||''),'快照分片上传未返回固定版本');
 encoded.payload={...payload,storage:'asset',assetId:uploaded.assetId,revisionId:uploaded.revisionId};
 return {content:encoded,schemaVersion:2,references:[uploaded.revisionId],uploadedAsset:{assetId:uploaded.assetId,revisionId:uploaded.revisionId,sha256:payload.sha256}};
}
export async function decodeProjectSnapshot(content,library,depth=0){
 check(depth<4,'工程快照引用层级过深或循环');
 check(content?.format===SNAPSHOT_FORMAT,'不是漫画工程快照');
 if(content.version===3){const p=content.payload;check(p?.encoding==='json'&&p.storage==='asset'&&Number.isSafeInteger(p.size)&&p.size>0&&p.size<=MAX_BYTES&&/^[a-f0-9]{64}$/.test(p.sha256||'')&&/^[a-f0-9-]{36}$/i.test(p.revisionId||''),'工程快照文件引用无效');const response=await library.remote('/api/revisions/'+p.revisionId+'/download');check(Number(response.headers.get('content-length')||0)<=MAX_BYTES,'工程快照文件过大');const bytes=Buffer.from(await response.arrayBuffer());check(bytes.length===p.size&&digest(bytes)===p.sha256,'工程快照文件摘要不符');const result=await decodeProjectSnapshot(JSON.parse(bytes),library,depth+1);check(result.projectId===content.projectId&&result.stableHash===content.stableHash,'工程快照文件身份不符');return result;}
 if(content.version===1){check(content.project&&Array.isArray(content.assets),'工程快照正文缺失');const decoded={...content};delete decoded.mokuDocumentType;return decoded;}
 const p=content.payload;check(content.version===2&&p?.encoding==='br'&&Number.isSafeInteger(p.jsonBytes)&&p.jsonBytes>0&&p.jsonBytes<=MAX_BYTES&&Number.isSafeInteger(p.size)&&p.size>0&&p.size<=MAX_BYTES,'快照压缩格式或大小无效');
 check(/^[a-f0-9]{64}$/.test(p.sha256||'')&&/^[a-f0-9]{64}$/.test(p.jsonSha256||''),'快照缺少完整性摘要');
 let bytes;
 if(p.storage==='inline'){check(typeof p.dataBase64==='string'&&p.dataBase64.length<=Math.ceil(MAX_BYTES/3)*4,'快照压缩内容无效');bytes=Buffer.from(p.dataBase64,'base64');}
 else{check(p.storage==='asset'&&/^[a-f0-9-]{36}$/i.test(p.revisionId||''),'快照固定版本无效');const response=await library.remote('/api/revisions/'+p.revisionId+'/download');check(Number(response.headers.get('content-length')||0)<=MAX_BYTES,'快照下载过大');bytes=Buffer.from(await response.arrayBuffer());}
 check(bytes.length===p.size&&digest(bytes)===p.sha256,'压缩快照摘要不符');
 const raw=brotliDecompressSync(bytes,{maxOutputLength:MAX_BYTES});check(raw.length===p.jsonBytes&&digest(raw)===p.jsonSha256,'工程快照还原摘要不符');
 const decoded=JSON.parse(raw.toString('utf8'));check(decoded.format===SNAPSHOT_FORMAT&&decoded.version===1&&decoded.projectId===content.projectId&&decoded.stableHash===content.stableHash&&decoded.project&&Array.isArray(decoded.assets),'工程快照还原内容不符');return {...decoded,...(content.moku?{moku:content.moku}:{})};
}
