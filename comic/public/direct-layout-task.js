/** Observe the service directly; completion never waits for a hidden preview. */
export function createDirectLayoutTask({api,onProgress,wait=ms=>new Promise(r=>setTimeout(r,ms)),timeoutMs=20000}){
 const active=new Map();
 async function request(route,input){
  let timer;try{return await Promise.race([api(route,'POST',input),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('任务状态查询超时；原任务已保留')),timeoutMs);})]);}
  finally{clearTimeout(timer);}
 }
 function watch(run,{allowStart=false}={}){
  if(active.has(run.runToken))return active.get(run.runToken);
  const task=(async()=>{
   const input={projectId:run.projectId,episode:run.episode,scriptId:run.scriptId,learningProjectId:run.learningProjectId,ruleVersion:run.ruleVersion,runToken:run.runToken,expectedRevision:run.revision,...(run.jobId?{jobId:run.jobId}:{})};
   const report=(status,message,extra={})=>{const data={type:'comic-layout:direct-progress',runToken:run.runToken,scriptId:run.scriptId,status,message,...(input.jobId?{jobId:input.jobId}:{}),...extra};onProgress(data);return data;};
   let submitted=false,polls=0;
   try{
    for(;;){
     const value=await request('/api/auto-layout/task/resolve',input);
     if(value.jobId)input.jobId=value.jobId;
     if(value.sourceMatch===false)return report('failed',value.message||'原任务来源已变化，结果保留，未接回画布');
     if(value.status==='done')return report('done',value.message||'排版已完成，正在核验并接回画布',{backendTiming:value.timing});
     if(value.status==='failed')return report('failed',value.message||'排版未完成，原画布已保留');
     if(value.status==='uncertain')return report('uncertain',value.message||'原任务状态待核实，点击继续查询；不会重复提交');
     if(value.status==='not-found'){
      if(!allowStart||submitted)return report('uncertain','未发现确定的原任务回执，未重复提交；点击继续查询');
      submitted=true;report('starting','正在提交本话排版');
      const started=await request('/api/auto-layout/task/start',input);
      if(started.jobId)input.jobId=started.jobId;
      if(started.status==='done')continue;
      if(started.status==='failed')return report('failed',started.message||'排版未完成，结果已保留');
      report('running',started.message||'正在按所选风格排版');continue;
     }
     report('running',value.message||'正在按所选风格排版');await wait(polls++<20?200:750);
    }
   }catch(error){return report('uncertain','状态回传暂时中断，原任务已保留，点击继续查询：'+error.message);}
  })();
  active.set(run.runToken,task);void task.finally(()=>{if(active.get(run.runToken)===task)active.delete(run.runToken);});return task;
 }
 return {watch};
}
