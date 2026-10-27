/* Integration adds explicit return and resumable progress to the original UI. */
if(viewParams.get('integrated')==='1'){
 const editorOrigin=new URL(document.referrer||'http://127.0.0.1:18909/').origin,send=data=>window.parent.postMessage(data,editorOrigin);
 const current=()=>typeof script!=='undefined'&&script,geometry=()=>typeof packet!=='undefined'&&packet;
 const canApply=()=>{const s=current(),p=geometry();return !!(s&&p&&p.generator?.mode==='model-generated'&&s.layoutRuleContract?.digest===p.layoutRuleDigest);};
 const apply=document.createElement('button');apply.textContent='使用当前排版';apply.className='primary';apply.disabled=true;document.querySelector('.actions').append(apply);
 async function requestApply(){if(!canApply())throw Error('请先完成本话排版并查看预览');const s=current(),r=await api('/api/export',{id:s.id,packet:geometry()});packet=r.packet;dirty=false;send({type:'comic-layout:apply',scriptId:s.id});}
 apply.onclick=()=>requestApply().catch(e=>status(e.message,true));
 window.addEventListener('message',event=>{if(event.source===window.parent&&event.origin===editorOrigin&&event.data?.type==='comic-layout:request-apply')void requestApply().catch(e=>status(e.message,true));});
 let selection='';setInterval(()=>{const s=current(),ready=canApply(),key=s?.id+':'+ready;apply.disabled=!ready;if(s&&key!==selection){selection=key;send({type:'comic-layout:selection',scriptId:s.id,sourceProjectId:s.studioSource?.projectId,planningMode:s.studioSource?.mode==='preproduction-layout',canApply:ready});}},600);
 const runToken=viewParams.get('direct')||viewParams.get('runToken'),requestedId=viewParams.get('id'),direct=!!runToken,storageKey='comic-layout-integrated-run:'+requestedId+':'+runToken;
 const report=(state,message,jobId)=>{const data={type:'comic-layout:direct-progress',runToken,scriptId:requestedId,status:state,message,...(jobId?{jobId}:{})};localStorage.setItem(storageKey,JSON.stringify(data));send(data);status(message,state==='failed'||state==='uncertain');};
 async function poll(jobId){try{const r=await api('/api/jobs/'+encodeURIComponent(jobId));if(r.status==='done'){packet=await api('/api/drafts/'+requestedId);selected=-1;dirty=false;render();inspector();report('done',r.message||'排版已完成，请查看预览后接回',jobId);return;}if(r.status==='failed'){report('failed',r.message,jobId);return;}report('running',r.message||'正在排版',jobId);setTimeout(()=>poll(jobId),2500);}catch(e){report('uncertain','暂时无法核实排版状态，请保留原任务记录：'+e.message,jobId);}}
 async function start(){
  if(!direct||!runToken||!requestedId)return;
  if(current()?.id!==requestedId){setTimeout(start,200);return;}
  const prior=JSON.parse(localStorage.getItem(storageKey)||'null');
  if(prior?.jobId){if(['done','failed'].includes(prior.status)){send(prior);return;}return poll(prior.jobId);}
  if(prior){report('uncertain','上次排版提交结果待核实，未重复启动任务');return;}
  if(viewParams.get('resumeJob'))return poll(viewParams.get('resumeJob'));
  if(viewParams.get('preferExisting')==='1'&&canApply()){report('done','已载入本话已有的排版结果');return;}
  if(viewParams.get('allowStart')!=='1'){report('uncertain','未发现原任务记录，未重复启动排版；请返回工作台核对原任务');return;}
  report('starting','正在提交当前话排版，不生成图片');
  try{const s=current(),job=await api('/api/model/generate',{id:s.id,styleVersion:s.layoutRuleContract.version});report('running','当前话排版任务已开始',job.jobId);void poll(job.jobId);}catch(e){report('uncertain','提交状态待核实，未重复启动：'+e.message);}
 }
 void start();
}
