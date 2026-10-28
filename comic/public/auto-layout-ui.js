/** One explicit click may apply one matching, validated result to an unchanged episode. */
function createAutomaticLayoutReturn({getContext,apply,onBlocked=()=>{}}){
 const attempted=new Set();let applying=false;
 return {get applying(){return applying;},async consider(run,preview){
  if(applying||!run?.autoReturn||run.status!=='done'||!run.planningMode||!preview)return false;
  const identity=[run.projectId,run.episode,run.runToken,run.scriptId].join(':');
  if(attempted.has(identity))return false;
  const context=getContext();
  const matches=context&&preview.projectId===run.projectId&&context.projectId===run.projectId&&
   Number(preview.episode)===Number(run.episode)&&Number(context.episode)===Number(run.episode)&&
   Number(context.activeEpisode)===Number(run.canvasEpisode??run.episode)&&context.revision===run.revision&&
   context.styleId===run.learningProjectId&&preview.contract?.id===run.learningProjectId&&
   preview.contract?.version===run.ruleVersion&&preview.scriptId===run.scriptId&&
   /^[a-f0-9]{64}$/.test(preview.packetHash||'');
  if(!matches){attempted.add(identity);onBlocked('排版结果已保留；工程、当前话或来源已变化，请检查预览后手动接回。');return false;}
  attempted.add(identity);applying=true;
  try{await apply({episodeNumber:run.episode,scriptId:run.scriptId,expectedPacketHash:preview.packetHash});return true;}
  catch(error){onBlocked('自动接回未完成，预览已保留：'+error.message);return false;}
  finally{applying=false;}
 }};
}

import {reflowEpisodeNumber} from './reflow-episode-context.mjs';
import {showReflowFramingPreview} from './reflow-framing-preview.mjs';
import {chooseEpisodeRule} from './layout-rule-choice.mjs';
import {createDirectLayoutRun} from './direct-layout-run.js';
import {createDirectLayoutTask} from './direct-layout-task.js';
import {createBatchLayoutRun,episodeRange} from './batch-layout-run.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function mountAutoLayout({getProject,getEpisode,flushSave,api,toast,applyCurrent,refreshState,chooseProject,accept,onChooseEpisode}){
 const button=document.createElement('button');button.id='auto-layout-toggle';button.textContent='自动排版';button.title='选择话数与风格，自动排版并接回画布';document.querySelector('#display-menu').after(button);
 const reflowButton=document.createElement('button');reflowButton.id='screen-artwork-reflow-toggle';reflowButton.textContent='本话成图重排';reflowButton.title='检查本话成图 → 裁齐格子 → 按当前排版规则重排 → 接回画布；不重新生图';button.after(reflowButton);
 const dialog=document.createElement('dialog');dialog.id='auto-layout-dialog';dialog.setAttribute('aria-label','自动排版');
 dialog.innerHTML=`<header><strong>自动排版</strong><button data-close aria-label="关闭自动排版">×</button></header><form method="dialog"><div class="layout-library-row"><a data-layout-library target="_blank" rel="noopener">排版库 ↗</a></div><label>本次话数<select data-episode></select></label><label>风格库<select data-style></select></label><label>批量话数范围<span class="batch-range"><select data-batch-from aria-label="批量起始话数"></select><span>至</span><select data-batch-to aria-label="批量结束话数"></select></span></label><button type="button" data-batch-start>全部排版并接回画布</button><button type="button" class="primary" data-start>自动排版并接回画布</button><label style="grid-column:1/-1"><span><input type="checkbox" data-uniform-framing> 按排版规则调整框形并等比取景（含扁格修正）</span><small>人物比例保持不变；有意横格保留。可先预览并调整取景，再接回原画布。</small></label><label style="grid-column:1/-1"><span><input type="checkbox" data-reflow-preview checked> 成图重排接回前预览图片并调整取景</span></label></form><p data-status role="status" aria-live="polite"></p><iframe data-runner title="当前话排版任务" hidden></iframe>`;
 document.body.append(dialog);
 const css=document.createElement('style');css.textContent=`#auto-layout-dialog{position:fixed;inset:auto;top:50%;left:50%;transform:translate(-50%,-50%);margin:0;z-index:10000;box-sizing:border-box;width:min(460px,calc(100vw - 32px));height:fit-content;max-height:calc(100dvh - 32px);padding:0;border:1px solid #45627d;border-radius:12px;background:#122230;color:#deebf7;overflow:auto}#auto-layout-dialog::backdrop{background:#0008}#auto-layout-dialog header{display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-bottom:1px solid #314b60}#auto-layout-dialog header strong{font-size:17px}#auto-layout-dialog [data-close]{border:0;background:transparent;color:#b8cbd9;font-size:23px;line-height:1;padding:2px 5px;cursor:pointer}#auto-layout-dialog form{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:16px 12px;margin:0;padding:20px 18px 16px}#auto-layout-dialog label{display:grid;gap:8px;font-size:13px;color:#b8cbd9;min-width:0}#auto-layout-dialog select{box-sizing:border-box;width:100%;min-width:0;min-height:38px;padding:8px;border:1px solid #314b60;border-radius:6px;background:#182c3c;color:#deebf7;font:inherit}#auto-layout-dialog [data-start]{grid-column:1/-1;border:0;border-radius:6px;min-height:40px;padding:10px 12px;background:#9bd0fb;color:#102333;font-weight:600;font-size:14px;cursor:pointer}#auto-layout-dialog button:disabled,#auto-layout-dialog select:disabled{opacity:.55;cursor:default}#auto-layout-dialog [data-status]{margin:0;padding:0 18px 18px;font-size:12px;line-height:1.6;color:#b8cbd9;overflow-wrap:anywhere}#auto-layout-dialog [data-status]:empty{display:none}#auto-layout-dialog [data-status][data-error="true"]{color:#f5b7ae}#auto-layout-dialog [hidden]{display:none!important}`;document.head.append(css);
 css.textContent+=`#auto-layout-dialog .layout-library-row{grid-column:1/-1;display:flex;justify-content:flex-end;margin:-8px 0 -6px;font-size:12px}#auto-layout-dialog [data-layout-library]{color:#a9c9df;text-decoration:none;cursor:pointer}#auto-layout-dialog [data-layout-library]:hover{text-decoration:underline}#auto-layout-dialog .batch-range{display:flex;align-items:center;gap:5px}#auto-layout-dialog .batch-range select{min-width:0;padding:7px 4px;flex:1}#auto-layout-dialog [data-batch-start]{align-self:end;min-height:38px;padding:8px;border:1px solid #527999;border-radius:6px;background:#203e53;color:#d7eaf8;font:600 12px 'Microsoft YaHei',sans-serif;cursor:pointer}`;
 css.textContent+=`@media(max-width:760px){.modern-workbench .canvas-toolbar{display:flex!important;flex-wrap:wrap!important;height:auto!important;gap:4px!important}.modern-workbench .canvas-toolbar>.tools{flex:1 0 100%!important;min-width:0!important}.modern-workbench .canvas-toolbar>#auto-layout-toggle,.modern-workbench .canvas-toolbar>#screen-artwork-reflow-toggle{flex:0 0 auto!important;min-width:max-content;order:2}.modern-workbench .canvas-toolbar>.toolbar-right{order:3;margin-left:0!important}}`;
 const episodeSelect=dialog.querySelector('[data-episode]'),styleSelect=dialog.querySelector('[data-style]'),start=dialog.querySelector('[data-start]'),status=dialog.querySelector('[data-status]'),runner=dialog.querySelector('[data-runner]'),library=dialog.querySelector('[data-layout-library]'),batchFrom=dialog.querySelector('[data-batch-from]'),batchTo=dialog.querySelector('[data-batch-to]'),batchStart=dialog.querySelector('[data-batch-start]');
 const uniformFraming=dialog.querySelector('[data-uniform-framing]'),previewBefore=dialog.querySelector('[data-reflow-preview]');
 const activeEpisode=()=>reflowEpisodeNumber(getProject(),getEpisode?.());
 function clearSelectors(){for(const input of [episodeSelect,styleSelect,batchFrom,batchTo])input.innerHTML='<option value="">正在读取…</option>';}
 let plan=null,episode=null,styleId=null,contextKey='',origin='',loading=false,importing=false,receiving=false,error='',blocked=false,frameToken=null,requestId=0,previewRequest=0,timing=null,rangeProject=null,batchFeedback=false;
 function say(text,isError=false){status.textContent=text;status.dataset.error=String(isError);}
 function context(){const p=getProject();if(!plan||plan.projectId!==p?.id)return null;const contract=plan.binding?.contract,rule=(plan.rules||plan.learningProjects||[]).find(r=>r.id===styleId);return {projectId:p.id,revision:p.revision,episode:Number(plan.episode),activeEpisode:activeEpisode(),learningProjectId:styleId,segments:plan.segments,uniformFraming:uniformFraming.checked,previewBeforeApply:previewBefore.checked,ruleVersion:contract?.id===styleId?contract.version:rule?.activeVersion,ruleReady:!!(contract?.id===styleId||rule?.activeVersion)};}
 function update(){
  const c=context(),r=directRun.record(),busy=loading||importing||receiving||batch.running||directRun.starting||r&&['starting','running'].includes(r.status),b=batch.record();
  reflowButton.disabled=!!busy;reflowButton.textContent=directRun.preparing?'正在裁齐格子…':busy?'正在成图重排…':'本话成图重排';
  episodeSelect.disabled=!!busy||!c;styleSelect.disabled=!!busy||!c||!!plan?.binding?.contract;uniformFraming.disabled=!!busy||!c;previewBefore.disabled=!!busy||!c;
  start.disabled=!!busy||!c?.ruleReady;
  batchFrom.disabled=!!busy||!c;batchTo.disabled=!!busy||!c;batchStart.disabled=!!busy||!c?.ruleReady||uniformFraming.checked;
  batchStart.textContent=batch.running?'正在批量接回…':batchFeedback&&b?.status==='paused'?'继续批量排版并接回':'全部排版并接回画布';
  start.textContent=directRun.preparing?'正在检查并裁齐本话格子…':importing?'正在接回画布…':receiving?'正在读取排版结果…':loading?'正在读取…':directRun.starting||r&&['starting','running'].includes(r.status)?'正在自动排版…':r?.status==='uncertain'?'继续查询并接回画布':r?.status==='failed'||error?'重试排版并接回画布':'自动排版并接回画布';
  if(batch.running||batchFeedback&&b?.status==='paused')say(b?.message||'正在准备批量排版',b?.status==='paused');
  else if(directRun.preparing)say('正在检查本话成图并裁齐格子；复用已确认裁格，不重新生图。');
  else if(importing)say('正在备份并接回，可关闭面板继续浏览。');
  else if(receiving)say('后台已完成，正在核验接回来源。');
  else if(loading)say('正在读取本话资料…');
  else if(error)say(error,true);
  else if(r?.status==='uncertain')say('任务记录已保留，点击按钮继续查询，不会重复排版。');
  else if(busy)say(r?.message||'正在按所选风格排版，完成后自动接回。');
  else if(r?.status==='failed')say(r.message||'排版未完成，可点击重试。原画布保留。',true);
  else say('');
 }
 async function readResult(r){
  if(receiving)return;receiving=true;update();const request=++previewRequest;
  try{
   if(!r.planningMode){
    await flushSave();const c=context();
    if(!r.autoReturn||!c||c.projectId!==r.projectId||c.revision!==r.revision||c.episode!==r.episode||c.learningProjectId!==r.learningProjectId)throw Error('原工程、话数或风格已变化，排版结果已保留，请重新打开自动排版');
    const preview=await api('/api/auto-layout/reflow/preview','POST',{projectId:r.projectId,expectedRevision:r.revision,scriptId:r.scriptId});
    if(r.previewBeforeApply){
     dialog.close();
    await showReflowFramingPreview(preview,{onApply:async reflowView=>{
     await flushSave();if(getProject()?.id!==r.projectId||getProject()?.revision!==r.revision)throw Error('来源工程有新修改，请重新读取预览');
     const result=await api('/api/auto-layout/import','POST',{scriptId:r.scriptId,reflowView});
     if(result.id!==r.projectId)throw Error('接回结果未对应原画布，已停止切换');
     await accept(result,{message:null,expectedRevision:r.revision});await onChooseEpisode?.(r.episode);
     const address=new URL(location.href);address.searchParams.set('project',result.id);window.history.replaceState(null,'',address);toast('已接回第'+r.episode+'话原画布；原图保留，已备份，可撤销');
    }});return;
    }
    await flushSave();if(getProject()?.id!==r.projectId||getProject()?.revision!==r.revision)throw Error('来源工程有新修改，请重新读取预览');
    const result=await api('/api/auto-layout/import','POST',{scriptId:r.scriptId,reflowView:{projectId:r.projectId,revision:r.revision,packetHash:preview.packetHash,backgroundPolicyVersion:preview.backgroundPolicyVersion,views:[]}});
    if(result.id!==r.projectId)throw Error('接回结果未对应原画布，已停止切换');
    await accept(result,{expectedRevision:r.revision,message:null});await onChooseEpisode?.(r.episode);dialog.close();toast('已自动接回原工程第'+r.episode+'话；原画板已备份');return;
   }
   const result=await api('/api/projects/'+r.projectId+'/production/episode-preview?'+new URLSearchParams({episode:String(r.episode),scriptId:r.scriptId,summary:'1'}));
   if(request!==previewRequest||getProject()?.id!==r.projectId||Number(plan?.episode)!==r.episode)return;
   if(!result.available)throw Error('排版结果暂未就绪，点击按钮继续读取原任务。');
   await automaticReturn.consider(r,result);
  }catch(e){error=e.message;}finally{receiving=false;update();}
 }
 function openRun(r,{fresh}){
  if(getProject()?.id!==r.projectId||Number(plan?.episode)!==r.episode||styleId!==r.learningProjectId)return;
  if(r.status==='done'){void readResult(r);return;}
  if(r.planningMode||r.autoReturn){void taskMonitor.watch(r,{allowStart:!!fresh});return;}
  if(frameToken===r.runToken&&r.status!=='uncertain')return;
  frameToken=r.runToken;const params=new URLSearchParams({integrated:'1',id:r.scriptId,view:'preview',direct:r.runToken,allowStart:fresh?'1':'0',preferExisting:r.preferExisting?'1':'0',forceNew:r.forceNew?'1':'0',targetProjectId:r.projectId});if(r.jobId)params.set('resumeJob',r.jobId);runner.src=origin+'/?'+params;
 }
 const directRun=createDirectLayoutRun({api,getContext:context,flushSave,open:openRun,onChange:update});
 const automaticReturn=createAutomaticLayoutReturn({
  getContext:()=>{const c=context();return c?{projectId:c.projectId,episode:c.episode,activeEpisode:Number(getEpisode?.()),revision:getProject().revision,styleId}:null;},
  apply:async input=>{if(importing)throw Error('正在接回其他结果');importing=true;const returnedAt=performance.now();update();try{await flushSave();const r=directRun.record();if(!r||r.revision!==getProject().revision)throw Error('工程已修改，请重新打开本话后再试');const result=await applyCurrent(input);if(!result?.project)throw Error('结果尚未接回，原排版已保留');dialog.close();await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));const end=performance.now(),measurement={projectId:r.projectId,episode:r.episode,totalMs:timing?end-timing.started:null,returnMs:end-returnedAt,backendMs:r.backendTiming?.elapsedSeconds*1000,phases:result.layoutReturnTiming,finishedAt:new Date().toISOString()};try{localStorage.setItem('comic-layout-last-timing:'+r.projectId+':'+r.episode,JSON.stringify(measurement));}catch{}toast('已接回画布'+(measurement.totalMs!==null?' · 共'+(measurement.totalMs/1000).toFixed(2)+'秒':'')+(Number.isFinite(measurement.backendMs)?' · 排版'+(measurement.backendMs/1000).toFixed(2)+'秒':'')+' · 接回'+(measurement.returnMs/1000).toFixed(2)+'秒；可撤销。');}finally{importing=false;update();}},
  onBlocked:text=>{blocked=true;error=text.replace('请检查预览后手动接回。','请返回目标话后重新打开自动排版。');update();}
 });
 const taskMonitor=createDirectLayoutTask({api,onProgress:data=>{const r=directRun.progress(data);if(r?.status==='done')void readResult(r);}});
 const batch=createBatchLayoutRun({api,getProject,getEpisode,flushSave,applyCurrent,accept,onChange:update});
 document.addEventListener('visibilitychange',()=>{if(document.visibilityState!=='visible')return;const r=directRun.record();if(r&&(r.planningMode||r.autoReturn)&&['starting','running','uncertain'].includes(r.status))void taskMonitor.watch(r,{allowStart:false});});
 async function load(){
  const request=++requestId,p=getProject(),oldRange={from:Number(batchFrom.value),to:Number(batchTo.value)};clearSelectors();loading=true;error='';blocked=false;plan=null;previewRequest++;update();
  try{await flushSave();if(request!==requestId||getProject()?.id!==p.id)return;
   const n=reflowEpisodeNumber(p,Number(episode)||activeEpisode());
   const result=await api('/api/auto-layout/reflow/plan','POST',{projectId:p.id,episode:n,expectedRevision:getProject().revision});
   if(request!==requestId||getProject()?.id!==p.id)return;
   plan=result;episode=Number(result.episode);const key=plan.projectId+':'+episode;styleId=chooseEpisodeRule(plan,p.title,styleId,contextKey===key);contextKey=key;
   episodeSelect.innerHTML=plan.episodes.map(e=>'<option value="'+e.episode+'" '+(Number(e.episode)===episode?'selected':'')+'>第'+e.episode+'话'+(e.title?' '+esc(e.title):'')+'</option>').join('');
   styleSelect.innerHTML='<option value="">请选择风格</option>'+(plan.rules||plan.learningProjects||[]).map(r=>'<option value="'+esc(r.id)+'" '+(r.id===styleId?'selected':'')+'>'+esc(r.name)+'</option>').join('');
   const oldFrom=oldRange.from,oldTo=oldRange.to,numbers=plan.episodes.map(e=>Number(e.episode)).sort((a,b)=>a-b),saved=batch.record();
   const from=rangeProject===p.id&&numbers.includes(oldFrom)?oldFrom:saved?.status==='paused'?saved.episodes[0]:numbers[0],to=rangeProject===p.id&&numbers.includes(oldTo)?oldTo:saved?.status==='paused'?saved.episodes.at(-1):numbers.at(-1);rangeProject=p.id;
   const options=selected=>numbers.map(n=>'<option value="'+n+'" '+(n===selected?'selected':'')+'>第'+n+'话</option>').join('');batchFrom.innerHTML=options(from);batchTo.innerHTML=options(to);
   batchFeedback=!!saved&&['paused','running','checking'].includes(saved.status);
   const r=directRun.record();if(r&&['starting','running','uncertain'].includes(r.status))openRun(r,{fresh:false});
  }catch(e){if(request===requestId)error=e.message;}
  finally{if(request===requestId){loading=false;update();}}
 }
 async function openForEpisode(number){
  const changed=plan?.projectId!==getProject()?.id;if(changed){clearSelectors();plan=null;uniformFraming.checked=false;}
  if(changed||number!==undefined){episode=number===undefined?null:Number(number);styleId=null;contextKey='';}
  if(number===undefined&&episode===null){
   const p=getProject(),pending=[];
   try{for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(!key?.startsWith('comic-direct-layout-v1:'+p.id+':'))continue;const r=JSON.parse(localStorage.getItem(key)||'null');if(r?.projectId===p.id&&r.autoReturn&&r.planningMode&&r.revision===p.revision&&Number(r.canvasEpisode??r.episode)===Number(getEpisode?.())&&p.productionPackage?.episodes.some(e=>Number(e.episode)===r.episode)&&['starting','running','uncertain'].includes(r.status))pending.push(r);}}catch{}
   pending.sort((a,b)=>Date.parse(b.created)-Date.parse(a.created));if(pending[0]){episode=pending[0].episode;styleId=pending[0].learningProjectId;contextKey=p.id+':'+episode;}
  }
  if(!dialog.open)dialog.show();loading=true;error='';update();
  try{const s=await api('/api/auto-layout/status');if(!s.ready)throw Error(s.error||'排版服务未就绪');origin=s.origin;library.href=origin+'/';await load();}
  catch(e){loading=false;error=e.message;update();}
 }
 start.onclick=async()=>{if(loading||importing)return;timing={started:performance.now()};const old=directRun.record();try{
  error='';batchFeedback=false;if(blocked){await load();blocked=false;}
  await directRun.start({restart:old?.status==='failed',autoReturn:true});
 }catch(e){error=e.message;}finally{update();}};
 batchStart.onclick=async()=>{if(loading||importing||batch.running)return;try{error='';batchFeedback=true;const episodes=episodeRange(plan?.episodes||[],batchFrom.value,batchTo.value),result=await batch.start({episodes,styleId});if(result?.status==='done'){const last=result.completed.findLast(r=>r.resultProjectId);if(last){await refreshState();await chooseProject(await api('/api/projects/'+last.resultProjectId),{fit:true});}dialog.close();toast('已全部接回第'+episodes[0]+'—'+episodes.at(-1)+'话，共'+result.completed.length+'话；已逐话备份，可撤销。');}}catch(e){error=e.message;}finally{update();}};
 const rangeChanged=()=>{batchFeedback=false;error='';update();};batchFrom.onchange=rangeChanged;batchTo.onchange=rangeChanged;
 episodeSelect.onchange=e=>{episode=Number(e.target.value);void load();};
 styleSelect.onchange=e=>{styleId=e.target.value;error='';blocked=false;batchFeedback=false;previewRequest++;update();};
 dialog.querySelector('[data-close]').onclick=()=>dialog.close();
 window.addEventListener('message',event=>{if(event.origin!==origin||event.source!==runner.contentWindow||event.data?.type!=='comic-layout:direct-progress')return;const r=directRun.progress(event.data);if(r?.status==='done')void readResult(r);});
 uniformFraming.onchange=()=>{error='';update();};
 reflowButton.onclick=async()=>{await openForEpisode(activeEpisode());if(loading||!plan)return;if(!plan.segments.length||plan.segments.some(s=>!s.hasImage)){error='请先完成本话所有单屏成图；已有图片和原画布保留';update();return;}say('已读取当前话。可选择预览取景或直接接回原画布。');};
 button.onclick=()=>openForEpisode();return {button,reflowButton,dialog,openForEpisode};
}
