// 原子写盘：先写临时文件再改名。Windows 杀毒、索引或备份软件会短暂占用文件，
// 导致改名报 EPERM / EBUSY / EACCES；这里短暂重试，而不是让整个服务崩溃。
import fs from 'node:fs';

const RETRYABLE=new Set(['EPERM','EBUSY','EACCES']);
const pause=new Int32Array(new SharedArrayBuffer(4));
const sleep=ms=>Atomics.wait(pause,0,0,ms);

/** 同步原子写文件。失败时抛出最后一次错误，并清理临时文件。 */
export function writeFileAtomicSync(file,data,{attempts=8,mode}={}){
 const temporary=`${file}.${process.pid}.${Date.now().toString(36)}.tmp`;
 fs.writeFileSync(temporary,data,mode===undefined?undefined:{mode});
 for(let attempt=1;;attempt++){
  try{fs.renameSync(temporary,file);return;}
  catch(error){
   if(!RETRYABLE.has(error.code)||attempt>=attempts){try{fs.unlinkSync(temporary);}catch{}throw error;}
   sleep(Math.min(120,15*attempt));
  }
 }
}
