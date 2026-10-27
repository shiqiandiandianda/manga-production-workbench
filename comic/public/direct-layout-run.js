/** Coordinates the existing layout service; never calls an image-generation API. */
export function createDirectLayoutRun({api,getContext,flushSave,open,onChange=()=>{},storage=globalThis.localStorage,token=()=>crypto.randomUUID()}){
 let starting=false;
 const key=c=>'comic-direct-layout-v1:'+c.projectId+':'+c.episode+':'+c.learningProjectId;
 function record(){
  const c=getContext();if(!c)return null;
  try{const r=JSON.parse(storage.getItem(key(c))||'null');return r?.projectId===c.projectId&&r.episode===c.episode&&r.learningProjectId===c.learningProjectId&&(r.revision===c.revision&&r.ruleVersion===c.ruleVersion||['starting','running','uncertain'].includes(r.status))?r:null;}catch{return null;}
 }
 function save(r){storage.setItem(key(r),JSON.stringify(r));onChange(r);}
 return {record,get starting(){return starting;},async start({restart=false}={}){
  if(starting)return;starting=true;onChange();
  try{
   await flushSave();const c=getContext();if(!c?.projectId||!c.learningProjectId)throw Error('请先选择排版学习项目');
   const old=record();
   if(old&&(!restart||!['done','failed'].includes(old.status))){open(old,{fresh:false});return old;}
   if(!c.ruleReady)throw Error('请先选择已启用的排版学习项目或漫画台原先排版规则');
   const status=await api('/api/auto-layout/status');if(!status.ready)throw Error(status.error||'排版服务未就绪');
   if(status.busy)throw Error('排版库已有任务正在进行，请先等待完成；不会另开重复任务');
   const count=c.segments.filter(s=>s.hasImage).length;
   if(count&&count!==c.segments.length)throw Error('本话只有部分屏段有图，不能重新生成已有图；请先完成其余屏段，再确认裁格重排');
   if(count&&c.segments.some(s=>!s.recordId))throw Error('请先逐屏确认裁格，再点击Codex自动排版；已有图片不会重新生成');
   const planningMode=count===0,input={projectId:c.projectId,episode:c.episode,expectedRevision:c.revision,learningProjectId:c.learningProjectId};
   if(!planningMode)input.records=c.segments.map(s=>({segmentId:s.id,recordId:s.recordId}));
   const source=await api(planningMode?'/api/auto-layout/planning/source':'/api/auto-layout/reflow/source','POST',input);
   const run={runToken:token(),projectId:c.projectId,episode:c.episode,learningProjectId:c.learningProjectId,revision:c.revision,scriptId:source.scriptId,planningMode,ruleVersion:source.contract?.version||c.ruleVersion,preferExisting:!!source.reused&&!restart,status:'starting',created:new Date().toISOString()};
   // Persist before opening the frame, where the costly model request happens.
   save(run);open(run,{fresh:true});return run;
  }finally{starting=false;onChange();}
 },progress(data){
  const c=getContext();if(!c)return null;const r=record();
  if(!r||data.runToken!==r.runToken||data.scriptId!==r.scriptId||!['starting','running','done','failed','uncertain'].includes(data.status))return null;
  Object.assign(r,{status:data.status,message:String(data.message||''),...(data.jobId?{jobId:String(data.jobId)}:{})});save(r);return r;
 }};
}
