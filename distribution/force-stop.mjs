import {execFile} from 'node:child_process';
import fs from 'node:fs';import path from 'node:path';import {writeJson} from './updates.mjs';

/** Only after all owned services exit: make an interrupted fallback stop durable too. */
export function settleForcedTasks({comicDir,centerDir,assetDir}){
 const active=new Set(['queued','running','preparing','awaiting_confirmation','recoverable','delegated']),message='主机强制升级，已停止本机任务；已有图片和云端原编号保留',now=new Date().toISOString();
 const entries=[[path.join(comicDir,'studio.json'),'jobs'],[path.join(centerDir,'intake-jobs.json'),'jobs'],[path.join(assetDir,'production-records/index.json'),'records']].filter(([file])=>fs.existsSync(file)).map(([file,kind])=>{if(fs.lstatSync(file).isSymbolicLink())throw Error('任务记录不能是链接');const data=JSON.parse(fs.readFileSync(file));if(!Array.isArray(kind==='records'?data:data.jobs))throw Error('任务记录格式无效，原文件保留');return{file,kind,data};});
 let cancelled=0;for(const {file,kind,data}of entries){let changed=false;for(const item of kind==='records'?data:data.jobs){if(kind==='records'){if(!Object.values(item.phases||{}).some(p=>active.has(p.status)))continue;item.status='cancelled';item.sceneReverseSubmitted=true;for(const p of Object.values(item.phases||{}))if(active.has(p.status)){p.status='cancelled';p.message=message;}}else{if(!active.has(item.status))continue;Object.assign(item,{status:'cancelled',phase:'cancelled',completedAt:now,finishedAt:now,message});for(const part of item.items||[])if(active.has(part.status)){part.status='failed';part.message=message;}}changed=true;cancelled++;}if(changed)writeJson(file,data);}
 return {cancelled};
}

async function terminateOwnedChild(child){
 if(child.exitCode!==null||child.signalCode)return;
 if(!Number.isSafeInteger(child.pid)||child.pid<=0||child.pid===process.pid)throw Error('受管进程编号无效');
 if(process.platform==='win32')await new Promise((resolve,reject)=>execFile('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true},error=>error&&child.exitCode===null?reject(Error('受管服务尚未停止')):resolve()));
 else child.kill('SIGKILL');
}
export async function forceStopManaged(children,{request,terminate=terminateOwnedChild,timeout=12000}={}){
 const result=[];
 for(const item of [...children].reverse().filter(i=>i.child.exitCode===null&&!i.child.signalCode)){
  // The parent holds these ChildProcess objects; no IP address, process name or arbitrary PID comes from a command.
  let fallback=false;try{const reply=await request(item.child,'distribution-force-stop',timeout);if(reply.error||reply.busy)throw Error(reply.error||'尚未退出');}catch{fallback=true;await terminate(item.child);}
  if(item.child.exitCode===null&&!item.child.signalCode)await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('服务退出等待超时：'+item.name)),timeout);item.child.once('exit',()=>{clearTimeout(timer);resolve();});});
  result.push({service:item.name,forcedTermination:fallback});
 }
 return result;
}
