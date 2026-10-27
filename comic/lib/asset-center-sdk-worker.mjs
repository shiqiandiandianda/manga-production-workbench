import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const write=(file,value)=>{const temporary=file+'.tmp';fs.writeFileSync(temporary,JSON.stringify(value,null,2),{mode:0o600});fs.renameSync(temporary,file);};
export async function resumeResults({client,directory,onStatus=()=>{}}){
 fs.mkdirSync(directory,{recursive:true});const result=[];
 for(const name of fs.readdirSync(directory).filter(name=>/^task_[a-f0-9-]{36}$/.test(name))){const file=path.join(directory,name,'handoff.local.json');if(!fs.existsSync(file))continue;const record=JSON.parse(fs.readFileSync(file));if(['running','claimed','uncertain'].includes(record.state)){const remote=await client.request('/api/v1/tasks/'+record.taskId);if(['done','review','cancelled','failed'].includes(remote.task.status)||remote.task.attempt!==record.attempt){record.state='settled';write(file,record);}else result.push({taskId:record.taskId,ok:false,message:'原任务状态未核实，禁止自动重派'});continue;}if(record.state!=='upload-pending')continue;try{const bytes=fs.readFileSync(record.resultPath);if(digest(bytes)!==record.sha256)throw Error('待回传文件已改变');const version=await client.result(record.taskId,{leaseToken:record.leaseToken,idempotencyKey:record.idempotencyKey,imageBase64:bytes.toString('base64')});record.state='submitted';record.versionId=version.id;write(file,record);onStatus('已恢复图片回传');result.push({taskId:record.taskId,ok:true});}catch(error){onStatus('有图片尚未回传：'+error.message);result.push({taskId:record.taskId,ok:false,message:error.message});}}
 return result;
}
export async function executeOne({client,generate,directory,provider='external',workId,taskId,taskIds,signal,onStatus=()=>{},heartbeatMs=20000}){
 const claim=await client.claim({provider,workId,taskId,taskIds});if(!claim.task)return {task:null};const {task,leaseToken}=claim,jobDir=path.join(directory,task.id),journal=path.join(jobDir,'handoff.local.json');fs.mkdirSync(jobDir,{recursive:true});
 let generating=false,completed=false,message='正在准备资产参考',heartbeatBusy=false;const controller=new AbortController(),abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)controller.abort();
 const record={taskId:task.id,attempt:task.attempt,leaseToken,idempotencyKey:task.id+':'+task.attempt,state:'claimed',created:new Date().toISOString()};write(journal,record);
 const beat=async()=>{if(heartbeatBusy)return;heartbeatBusy=true;try{await client.heartbeat(task.id,{leaseToken,running:generating,message});}catch(error){message='中心连接异常：'+error.message;onStatus(message);if(error.status===409||error.status===401||error.status===403)controller.abort();}finally{heartbeatBusy=false;}};
 const timer=setInterval(()=>void beat(),heartbeatMs);timer.unref?.();
 try{
  const references=[];for(const versionId of task.brief.references||[]){const metadata=await client.request('/api/v1/versions/'+versionId),bytes=await client.image(versionId);if(digest(bytes)!==metadata.sha256)throw Error('参考图校验失败');const file=path.join(jobDir,versionId+metadata.extension);fs.writeFileSync(file,bytes);references.push({filePath:file,version:metadata});}
  if(controller.signal.aborted)throw Error('接单已停止');generating=true;record.state='running';write(journal,record);await client.heartbeat(task.id,{leaseToken,running:true,message:'正在生成资产图'});onStatus('正在生成：'+task.brief.name);
  const result=await generate({task,references,directory:jobDir,signal:controller.signal,onProgress:value=>{message=String(value).slice(0,500);onStatus(message);void beat();}});completed=true;const resultPath=path.resolve(result.filePath);const bytes=fs.readFileSync(resultPath);if(bytes.length>30*1024*1024)throw Error('生成图片超过30MB');Object.assign(record,{state:'upload-pending',resultPath,sha256:digest(bytes)});write(journal,record);
  message='图片已生成，正在回传';await beat();onStatus(message);let version;for(let i=0;i<3;i++){try{version=await client.result(task.id,{leaseToken,idempotencyKey:record.idempotencyKey,imageBase64:bytes.toString('base64')});break;}catch(error){if(i===2||error.status&&error.status<500)throw error;await new Promise(resolve=>setTimeout(resolve,1000*(i+1)));}}
  Object.assign(record,{state:'submitted',versionId:version.id});write(journal,record);onStatus('图片已回传，等待确认');return {task,version};
 }catch(error){if(!completed){const uncertain=generating&&error.generationEnded!==true;await client.fail(task.id,{leaseToken,uncertain,message:String(error.message).slice(0,500)}).catch(()=>{});record.state=uncertain?'uncertain':'failed';record.message=String(error.message).slice(0,500);write(journal,record);}onStatus(completed?'图片已生成但未完成回传，原图已保留':error.message);throw error;
 }finally{clearInterval(timer);signal?.removeEventListener('abort',abort);}
}
