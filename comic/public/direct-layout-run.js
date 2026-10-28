/** Coordinates the existing layout service; never calls an image-generation API. */
export function createDirectLayoutRun({api,getContext,flushSave,open,onChange=()=>{},storage=globalThis.localStorage,token=()=>crypto.randomUUID()}){
 let starting=false,preparing=false;
 const key=c=>'comic-direct-layout-v1:'+c.projectId+':'+c.episode+':'+c.learningProjectId;
 function record(){
  const c=getContext();if(!c)return null;
  try{const r=JSON.parse(storage.getItem(key(c))||'null');return r?.projectId===c.projectId&&r.episode===c.episode&&r.learningProjectId===c.learningProjectId&&(r.revision===c.revision&&r.ruleVersion===c.ruleVersion||['starting','running','uncertain'].includes(r.status))?r:null;}catch{return null;}
 }
 function save(r){storage.setItem(key(r),JSON.stringify(r));onChange(r);}
 return {record,get preparing(){return preparing;},get starting(){return starting;},async start({restart=false,autoReturn=false}={}){
  if(starting)return;starting=true;onChange();
  try{
   await flushSave();const c=getContext();if(!c?.projectId||!c.learningProjectId)throw Error('请先选择排版学习项目');
   const old=record();
   if(old&&(['starting','running','uncertain'].includes(old.status)||old.status==='failed'&&!restart&&!old.preDispatch)){
    if(old.preDispatch)throw Error(old.message||'上次准备未完成，请明确重新排版或重新读取预览');
    open(old,{fresh:false});return old;
   }
   if(!c.ruleReady)throw Error('请先选择已启用的排版学习项目或漫画台原先排版规则');
   const status=await api('/api/auto-layout/status');if(!status.ready)throw Error(status.error||'排版服务未就绪');
   const count=c.segments.filter(s=>s.hasImage).length;
   if(count&&count!==c.segments.length)throw Error('本话只有部分屏段有图，不能重新生成已有图；请先完成其余屏段，再一键裁格重排');
   let records=c.segments.map(s=>({segmentId:s.id,recordId:s.recordId}));
   if(count){preparing=true;onChange();try{const prepared=await api('/api/auto-layout/reflow/prepare','POST',{projectId:c.projectId,episode:c.episode,expectedRevision:c.revision});records=prepared.records;}finally{preparing=false;onChange();}}
   const planningMode=count===0,input={projectId:c.projectId,episode:c.episode,expectedRevision:c.revision,learningProjectId:c.learningProjectId,forceNew:!!restart};
   if(planningMode&&!restart){
    let checked;
    try{checked=await api('/api/auto-layout/preview-state','POST',input);}catch(error){save({runToken:token(),...c,status:'failed',preDispatch:true,message:error.message});throw error;}
    if(checked.available||checked.active){
     const run={runToken:token(),projectId:c.projectId,episode:c.episode,learningProjectId:c.learningProjectId,revision:c.revision,scriptId:checked.scriptId,
      planningMode:true,autoReturn:!!autoReturn,canvasEpisode:c.activeEpisode??c.episode,ruleVersion:checked.contract?.version||c.ruleVersion,status:checked.available?'done':checked.status==='uncertain'?'uncertain':'running',
      ...(checked.jobId?{jobId:checked.jobId}:{}),message:checked.available?'已复用完整校验通过的有效预览；未调用模型':'继续查询已登记的原任务',created:new Date().toISOString()};
     save(run);open(run,{fresh:false});return run;
    }
    if(checked.existingInvalid){save({runToken:token(),...c,status:'failed',preDispatch:true,message:checked.message});throw Error(checked.message);}
    if(checked.migrateNative)input.forceNew=true;
   }
   if(!planningMode){input.records=records;input.uniformFraming=!!c.uniformFraming;}
   const source=await api(planningMode?'/api/auto-layout/planning/source':'/api/auto-layout/reflow/source','POST',input);
   const run={runToken:token(),projectId:c.projectId,episode:c.episode,learningProjectId:c.learningProjectId,revision:c.revision,scriptId:source.scriptId,planningMode,autoReturn:!!autoReturn,previewBeforeApply:!!c.previewBeforeApply,canvasEpisode:c.activeEpisode??c.episode,ruleVersion:source.contract?.version||c.ruleVersion,preferExisting:!!source.reused&&!input.forceNew,forceNew:!!input.forceNew,status:'starting',created:new Date().toISOString()};
   // Persist before opening the frame, where the costly model request happens.
   save(run);open(run,{fresh:true});return run;
  }finally{starting=false;onChange();}
 },progress(data){
  const c=getContext();if(!c)return null;const r=record();
  if(!r||data.runToken!==r.runToken||data.scriptId!==r.scriptId||!['starting','running','done','failed','uncertain'].includes(data.status))return null;
  Object.assign(r,{status:data.status,...(data.preDispatch===true?{preDispatch:true}:{}),message:String(data.message||''),...(data.jobId?{jobId:String(data.jobId)}:{}),...(data.backendTiming?{backendTiming:data.backendTiming}:{})});save(r);return r;
 }};
}
