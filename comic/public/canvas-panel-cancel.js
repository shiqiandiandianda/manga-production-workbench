import {findLayer} from './layers.js';

const cancellable=new Set(['queued','running','awaiting_confirmation','recoverable','delegated']);
export function panelCancellationJobs(project,panelId,jobs=[]){
 if(!project||!panelId)return [];
 return jobs.filter(job=>job.projectId===project.id&&job.panelId===panelId&&cancellable.has(job.status));
}

/** Cancel the selected frame's existing job IDs. Selection changes never retarget a request. */
export function mountCanvasPanelCancel({toolbar,getState,api,refresh,onMessage,onError}){
 const pending=new Set(),button=document.createElement('button');
 button.id='canvas-cancel-current-panel';button.type='button';button.setAttribute('aria-label','取消本格生成');
 button.innerHTML='<b aria-hidden="true">×</b><span>取消本格生成</span>';
 function target(state=getState()){
  const entry=state.project&&!state.fixed&&state.keys?.length===1&&findLayer(state.project,state.keys[0]),panel=entry?.type==='panel'?entry.item:null;
  return {project:state.project,panel,key:state.project&&panel?state.project.id+':'+panel.id:null,jobs:panelCancellationJobs(state.project,panel?.id,state.jobs)};
 }
 function paint(state){
  const current=target({...getState(),...state}),busy=pending.has(current.key),visible=!!current.panel&&(busy||current.jobs.length>0);
  button.disabled=busy||!current.jobs.length;button.querySelector('span').textContent=busy?'正在取消…':'取消本格生成';
  button.setAttribute('aria-busy',String(busy));button.title=busy?'正在取消本格的生成任务':'只取消当前画格的排队或生成任务，其他格和后续批次继续执行';
  return visible;
 }
 toolbar.addAction(button,{visible:paint});
 const sync=()=>toolbar.sync();
 button.addEventListener('click',()=>{void cancel().catch(onError);});
 async function cancel(){
  const current=target();if(!current.jobs.length||pending.has(current.key))return;
  const jobs=current.jobs.map(job=>({id:job.id,provider:job.provider}));pending.add(current.key);sync();
  try{
   const results=[];
   for(const job of jobs){
    try{results.push(await api('/api/jobs/'+job.id+'/cancel','POST',{}));}
    catch(error){if(error.status!==400||error.message!=='任务已结束')throw error;}
   }
   await refresh();
   const remote=results.find(job=>job.remoteTaskId),cloud=results.some(job=>job.provider==='jimeng'&&job.recovery?.submitId);
   onMessage(remote?remote.message:cloud?'已取消本格的本机任务；已提交云端的任务可在历史中查询':results.length?'已取消本格生成，其他格的任务继续执行':'本格任务已结束，无需取消');
  }finally{pending.delete(current.key);sync();}
 }
 return {sync,destroy(){button.remove();}};
}
