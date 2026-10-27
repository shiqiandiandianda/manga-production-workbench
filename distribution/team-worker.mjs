import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash,randomBytes} from 'node:crypto';
const configFile=path.resolve(process.argv[2]||'接入配置.local.json');
if(!fs.existsSync(configFile))throw Error('请将中心下载的接入配置放在接单器旁边，文件名：接入配置.local.json');
const initial=JSON.parse(fs.readFileSync(configFile));
const machineId=process.env.COMPUTERNAME||os.hostname(),poolId=createHash('sha256').update(path.resolve(process.env.CODEX_HOME||path.join(os.homedir(),'.codex')).toLowerCase()).digest('hex').slice(0,32);
const identityFile=path.join(path.dirname(configFile),'.worker-identity.local.json');let identity={};try{identity=JSON.parse(fs.readFileSync(identityFile));}catch{}const identityKey=machineId+':'+poolId;if(!identity[identityKey]){identity[identityKey]=randomBytes(32).toString('hex');fs.writeFileSync(identityFile,JSON.stringify(identity),{mode:0o600});}
const journal=configFile+'.tasks.json';let saved={};try{saved=JSON.parse(fs.readFileSync(journal));}catch{}
const persist=()=>{fs.writeFileSync(journal+'.tmp',JSON.stringify(saved,null,2));fs.renameSync(journal+'.tmp',journal);};
async function request(base,route,data,token){const res=await fetch(base.replace(/\/$/,'')+route,{method:data===undefined?'GET':'POST',headers:{...(data===undefined?{}:{'Content-Type':'application/json'}),...(token?{Authorization:'Bearer '+token}:{})},...(data===undefined?{}:{body:JSON.stringify(data)}),signal:AbortSignal.timeout(45000)});const value=await res.json();if(!res.ok)throw Object.assign(Error(value.error||'请求失败'),{status:res.status});return value;}
let current=initial,worker=null,stopping=false,runtimeState={ready:false,message:'正在检查本机生图连接'},runtimeAt=0,runtimeAttempt=0,runtimeOrigin='',runtimeProbe=null;const running=new Map();
async function processTask(task){
 const attemptKey=task.id+':'+task.generation; const savedTask=saved[attemptKey]||={taskId:task.id,generation:task.generation,leaseToken:task.leaseToken};persist();
 const post=(action,data)=>request(current.hub,'/api/v1/workers/'+worker.id+'/tasks/'+task.id+'/'+action,{leaseToken:task.leaseToken,...data},current.token);
 const heartbeat=setInterval(()=>void post('progress',{started:true,message:'同事电脑正在执行'}).catch(()=>{}),20000);
 try{
  // Persist the center lease before starting. Starting is acknowledged before an upstream turn.
  await post('progress',{started:true,message:'已领取，准备调用本机已登录的生成工具'});
  if(savedTask.imageBase64){await post('result',{imageBase64:savedTask.imageBase64});savedTask.done=true;persist();return;}
  if(savedTask.submissionAttempted&&!savedTask.jobId)throw Error('上次提交的结果待核实，未自动重新生成');
  if(!savedTask.jobId){
   const references=[];
   const project=await request(current.hub,'/api/v1/projects/'+task.projectId,undefined,current.token);
   for(const fileId of task.referenceFileIds){const f=project.files.find(f=>f.id===fileId);if(!f)throw Error('固定参考图已缺失');const res=await fetch(current.hub+f.contentUrl,{headers:{Authorization:'Bearer '+current.token}});if(!res.ok)throw Error('参考图下载失败');const bytes=Buffer.from(await res.arrayBuffer());if(createHash('sha256').update(bytes).digest('hex')!==f.sha256)throw Error('参考图传输校验失败');references.push('data:'+f.mime+';base64,'+bytes.toString('base64'));}
   savedTask.submissionAttempted=true;persist();
   const result=await request(current.localWorkbench,'/api/lan/v1/jobs',{project:project.project.title,vendor:'team-worker',clientRequestId:task.id+':'+task.generation,items:[{mode:'generate',engine:task.engine,type:task.role==='character'?'card':'scene',character:task.role==='character'?task.name:'',scene:task.role==='scene'?task.name:'',prompt:task.compiledPrompt,references}]});
   savedTask.jobId=result.job.jobId;persist();
  }
  for(;;){
   const job=await request(current.localWorkbench,'/api/lan/v1/jobs/'+savedTask.jobId);
   await post('progress',{started:true,message:job.items?.[0]?.progress?.message||job.message||'本机生成中'});
   if(job.status==='completed'){
    const asset=job.assets[0];if(job.assets.length!==1)throw Error('本次任务没有唯一结果');
    const image=await fetch(current.localWorkbench+'/api/lan/v1/assets/'+asset.assetId+'/file');if(!image.ok)throw Error('本机成图无法读取');
    const bytes=Buffer.from(await image.arrayBuffer());if(asset.sha256&&createHash('sha256').update(bytes).digest('hex')!==asset.sha256)throw Error('生成结果校验失败');
    savedTask.imageBase64=bytes.toString('base64');persist();await post('result',{imageBase64:savedTask.imageBase64});savedTask.done=true;persist();console.log('已回传 '+task.name+'，等待漫画/中心确认');break;
   }
   if(['failed','cancelled','partial'].includes(job.status)){await post('fail',{generationEnded:true,message:job.items?.find(i=>i.status==='failed')?.message||job.message});break;}
   await new Promise(r=>setTimeout(r,4000));
  }
 }catch(error){console.error(task.name+'：'+error.message);await post('fail',{generationEnded:false,message:error.message}).catch(()=>{});}finally{clearInterval(heartbeat);running.delete(task.id);}
}
async function tick(){
 current=JSON.parse(fs.readFileSync(configFile));
 let localActive=0,ready=false;
 if(runtimeOrigin!==current.localWorkbench){runtimeOrigin=current.localWorkbench;runtimeAt=0;runtimeAttempt=0;runtimeState={ready:false,message:'正在检查本机生图连接'};}
 if(!runtimeProbe&&Date.now()-runtimeAttempt>30000){const origin=runtimeOrigin;runtimeAttempt=Date.now();runtimeProbe=request(origin,'/api/workshop/api/runtime?cached=1').then(value=>{if(origin===runtimeOrigin){runtimeState=value;runtimeAt=Date.now();}}).catch(error=>{if(origin===runtimeOrigin){runtimeState={ready:false,message:error.message};runtimeAt=Date.now();}}).finally(()=>runtimeProbe=null);}
 try{const [health,stats]=await Promise.all([request(current.localWorkbench,'/api/lan/v1/health'),request(current.localWorkbench,'/api/lan/v1/stats')]);localActive=Number(stats.running??stats.jobs?.running??0);ready=health.ok!==false&&runtimeState.ready===true&&Date.now()-runtimeAt<90000;}catch{}
 try{const health=await request(current.localComic||'http://127.0.0.1:18896','/api/health');localActive+=Number(health.generation?.running||0)+Number(health.generation?.remoteUnknown||0);}catch{}
 worker=await request(current.hub,'/api/v1/workers/heartbeat',{machineId,poolId,registrationKey:identity[identityKey],name:current.name||machineId,projectIds:current.projectIds,roles:current.roles||['character','scene','prop'],capacity:current.capacity??6,reserve:current.reserve??2,localActive,paused:stopping||!!current.paused,ready,message:runtimeState.message},current.token);
 if(stopping)return;
 const claim=await request(current.hub,'/api/v1/workers/'+worker.id+'/claim',{},current.token);
 for(const task of claim.tasks){if(running.has(task.id))continue;running.set(task.id,true);void processTask(task);}
}
if(process.send){const {installShutdown}=await import('./ipc.mjs');installShutdown({busy:()=>running.size>0,close:()=>{stopping=true;}});}
console.log('项目接单器：'+machineId+'。修改配置 paused=true 可暂停新任务，正在生成的任务继续回传。');
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{stopping=true;console.log('停止接新任务；已开始的任务继续回传。');});
for(;;){try{await tick();}catch(error){console.error('连接中心：'+error.message);}if(stopping&&!running.size)break;await new Promise(r=>setTimeout(r,5000));}
