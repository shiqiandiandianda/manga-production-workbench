import {createHash} from 'node:crypto';
import {brotliCompressSync,brotliDecompressSync,constants} from 'node:zlib';
export const COMPACT_PROJECT_FORMAT='comic-strip-studio-compact';
const MAX=512*1024*1024,hash=b=>createHash('sha256').update(b).digest('hex');
export function compactProjectFile(value){
 const raw=Buffer.from(JSON.stringify(value));if(raw.length<32768)return value;
 const packed=brotliCompressSync(raw,{params:{[constants.BROTLI_PARAM_QUALITY]:4}});
 if(packed.length*1.4>=raw.length)return value;
 return {format:COMPACT_PROJECT_FORMAT,version:1,title:value.project?.title,projectId:value.project?.id,portability:value.portability,encoding:'br',jsonBytes:raw.length,sha256:hash(raw),dataBase64:packed.toString('base64')};
}
export function expandProjectFile(value){
 if(value?.format!==COMPACT_PROJECT_FORMAT)return value;
 if(value.version!==1||value.encoding!=='br'||!Number.isSafeInteger(value.jsonBytes)||value.jsonBytes<=0||value.jsonBytes>MAX||!/^[a-f0-9]{64}$/.test(value.sha256||'')||typeof value.dataBase64!=='string'||value.dataBase64.length>Math.ceil(MAX/3)*4||!/^[A-Za-z0-9+/]*={0,2}$/.test(value.dataBase64))throw Error('压缩工程格式或大小无效');
 const raw=brotliDecompressSync(Buffer.from(value.dataBase64,'base64'),{maxOutputLength:MAX});
 if(raw.length!==value.jsonBytes||hash(raw)!==value.sha256)throw Error('压缩工程完整性校验失败');
 const result=JSON.parse(raw);if(result.format!=='comic-strip-studio'||!result.project||result.project.id!==value.projectId)throw Error('压缩工程身份不符');return result;
}
