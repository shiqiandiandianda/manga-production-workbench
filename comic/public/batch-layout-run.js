import {createDirectLayoutRun} from './direct-layout-run.js';
import {createDirectLayoutTask} from './direct-layout-task.js';

export function episodeRange(episodes,from,to){
 const numbers=[...new Set(episodes.map(e=>Number(e.episode)))].filter(Number.isInteger).sort((a,b)=>a-b);
 from=Number(from);to=Number(to);
 if(!numbers.includes(from)||!numbers.includes(to)||from>to)throw Error('请选择有效的起止话数');
 return numbers.filter(n=>n>=from&&n<=to);
}

/** Sequential jobs and returns: every next source sees the preceding saved revision. */
export function createBatchLayoutRun({api,getProject,getEpisode,flushSave,applyCurrent,onChange=()=>{},storage=globalThis.localStorage,token=()=>crypto.randomUUID(),wait,timeoutMs}){
 let running=false,state=null;
 const key=id=>'comic-layout-batch-v1:'+id;
 const save=()=>{storage.setItem(key(state.projectId),JSON.stringify(state));onChange(state);};
 const read=id=>{try{return JSON.parse(storage.getItem(key(id))||'null');}catch{return null;}};
 function check(){const p=getProject();if(p?.id!==state.projectId||p.revision!==state.revision||Number(getEpisode())!==state.canvasEpisode)throw Error('工程、当前画布或版本已变化；批量已暂停，已完成的话数保留');}
 function context(plan,styleId){
  const binding=plan.binding?.contract,rule=(plan.rules||plan.learningProjects||[]).find(r=>r.id===styleId);
  if(binding&&binding.id!==styleId)throw Error('第'+plan.episode+'话已固定其他风格；批量未开始，请先核对本话风格');
  const version=binding?.version||rule?.activeVersion;
  if(!version)throw Error('第'+plan.episode+'话没有可用的已启用风格');
  if(!Array.isArray(plan.segments)||!plan.segments.length)throw Error('第'+plan.episode+'话缺少制作资料');
  return {projectId:state.projectId,episode:Number(plan.episode),revision:state.revision,activeEpisode:state.canvasEpisode,learningProjectId:styleId,segments:plan.segments,ruleVersion:version,ruleReady:true};
 }
 return {get running(){return running;},record(){const id=getProject()?.id;return state?.projectId===id?state:read(id);},async start({episodes,styleId}){
  if(running)return state;
  if(!styleId)throw Error('请先选择风格');
  const wanted=[...new Set(episodes)].sort((a,b)=>a-b),p=getProject();
  if(!wanted.length||wanted.some(n=>!Number.isInteger(n)||!p?.productionPackage?.episodes.some(e=>Number(e.episode)===n)))throw Error('批量话数范围无效');
  running=true;
  try{
   await flushSave();const current=getProject();if(current?.id!==p.id)throw Error('当前工程已变化，未开始批量排版');
   const old=read(p.id),resume=old&&['paused','running','checking'].includes(old.status)&&old.styleId===styleId&&JSON.stringify(old.episodes)===JSON.stringify(wanted);
   state=resume?old:{id:token(),projectId:p.id,styleId,episodes:wanted,index:0,completed:[],createdAt:new Date().toISOString()};
   if(resume&&state.revision!==current.revision&&state.currentRun&&['starting','running','uncertain','done'].includes(state.currentRun.status))throw Error('批量原任务已保留，但工程版本已变化；请先核对原任务，未重复提交');
   state.revision=current.revision;state.canvasEpisode=Number(getEpisode());state.status='checking';state.message='正在检查所选话数资料';save();
   // Preflight the entire remaining range before any job or project write.
   const plans=new Map();
   for(const number of wanted.slice(state.index)){
    check();const plan=await api('/api/auto-layout/reflow/plan','POST',{projectId:state.projectId,episode:number,expectedRevision:state.revision});check();
    if(plan.projectId!==state.projectId||Number(plan.episode)!==number)throw Error('批量资料与所选工程话数不符');
    context(plan,styleId);plans.set(number,plan);
   }
   state.status='running';save();
   for(;state.index<wanted.length;){
    check();const number=wanted[state.index],plan=plans.get(number),c=context(plan,styleId);let opened;
    state.currentEpisode=number;state.message='正在排版第'+number+'话（'+(state.index+1)+'/'+wanted.length+'）';save();
    const direct=createDirectLayoutRun({api,storage,token,flushSave,getContext:()=>c,open:(run,options)=>{opened={run,options};}});
    const prior=direct.record();await direct.start({autoReturn:false,restart:prior?.status==='failed'});check();
    if(!opened)throw Error('批量任务未取得启动记录');
    let run=opened.run;state.currentRun=run;save();
    if(run.revision!==state.revision)throw Error('原任务的来源版本与批量当前工程不符，结果保留，未接回');
    if(run.status!=='done'){
     const monitor=createDirectLayoutTask({api,wait,timeoutMs,onProgress:data=>{const r=direct.progress(data);if(r){run=r;state.currentRun=r;state.message='第'+number+'话：'+r.message;save();}}});
     await monitor.watch(run,{allowStart:!!opened.options.fresh});check();
    }
    if(run.status!=='done')throw Error(run.message||'本话任务状态待确认，已暂停，不会重复提交');
    state.message='正在备份并接回第'+number+'话（'+(state.index+1)+'/'+wanted.length+'）';save();
    if(!run.planningMode){
     await flushSave();check();const result=await api('/api/auto-layout/import','POST',{scriptId:run.scriptId});check();
     if(!result?.id||result.autoLayoutSource?.sourceProjectId!==state.projectId)throw Error('已有成图排版结果归属不符，原工程保留');
     state.completed.push({episode:number,scriptId:run.scriptId,resultProjectId:result.id,sourceRevision:state.revision});state.index++;delete state.currentRun;state.message='已另存'+state.index+'/'+wanted.length+'话；原工程保留';save();continue;
    }
    const preview=await api('/api/projects/'+state.projectId+'/production/episode-preview?'+new URLSearchParams({episode:String(number),scriptId:run.scriptId,summary:'1'}));
    await flushSave();check();
    if(!preview.available||preview.projectId!==state.projectId||Number(preview.episode)!==number||preview.scriptId!==run.scriptId||preview.contract?.id!==styleId||preview.contract?.version!==run.ruleVersion||!/^[a-f0-9]{64}$/.test(preview.packetHash||''))throw Error('本话排版来源或完整校验结果不符，已保留结果并暂停接回');
    const started=performance.now(),result=await applyCurrent({episodeNumber:number,scriptId:run.scriptId,expectedPacketHash:preview.packetHash});
    if(!result?.project||result.project.id!==state.projectId||getProject()?.id!==state.projectId||getProject().revision!==result.project.revision||Number(getEpisode())!==number)throw Error('本话接回确认未完成，已暂停；请核对当前画布');
    state.completed.push({episode:number,scriptId:run.scriptId,revision:result.project.revision,backendSeconds:run.backendTiming?.elapsedSeconds??null,returnMs:performance.now()-started});
    state.index++;state.revision=result.project.revision;state.canvasEpisode=number;delete state.currentRun;state.message='已接回'+state.index+'/'+wanted.length+'话';save();
   }
   state.status='done';state.finishedAt=new Date().toISOString();state.message='已全部接回'+wanted.length+'话画布';save();return state;
  }catch(error){
   if(state){state.status='paused';state.message=error.message;save();}throw error;
  }finally{running=false;onChange(state);}
 }};
}
