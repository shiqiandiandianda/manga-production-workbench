import {generationPromptSelection} from './prompt-source.js';
import {editReferenceMarkup,mountEditReferencePaste} from './edit-reference-paste.js';

export function promptRewriteMarkup({disabled=false}={}){
 return `<section class="prompt-rewrite"><label>修改模式<select data-picture-edit-mode ${disabled?'disabled':''}><option value="prompt">修改提示词</option><option value="image">直接改整张原图</option></select></label><label>画面修改意见<textarea data-prompt-rewrite-notes rows="3" maxlength="4000" placeholder="例如：人物改为侧身，镜头拉近；可 Ctrl+V 粘贴参考图" ${disabled?'disabled':''}></textarea></label>${editReferenceMarkup}<button type="button" data-prompt-rewrite-start ${disabled?'disabled':''}>让 Codex 修改提示词</button><p class="inspector-hint" data-prompt-rewrite-status role="status"></p><button type="button" data-prompt-rewrite-cancel hidden>取消修改</button></section>`;
}
export function mountPromptRewriteUI({root,api,getProject,getPanel,flushSave,apply,editImage,toast}){
 const states=new Map();let timer=null;
 const target=()=>{const p=getProject(),panel=getPanel();if(!p||!panel)return null;const chosen=generationPromptSelection(panel,p);return {p,panel,chosen,key:p.id+':'+panel.id+':'+chosen.source};};
 const references=mountEditReferencePaste({root,api,target,isBusy:t=>{const s=states.get(t.key);return !!(s?.submitting||s?.applying||s?.job?.status==='running');},refresh:()=>paint(),toast});
 const endpoint=t=>'/api/projects/'+t.p.id+'/prompt-rewrite';
 const noteKey=t=>'comic-prompt-notes:'+t.key;
 const getNotes=t=>{try{return localStorage.getItem(noteKey(t))||'';}catch{return '';}};
 const pairFor=(t,state)=>(state?.job?.status==='completed'&&state.job.id!==t.panel.generation?.promptComparisons?.[t.chosen.source]?.jobId?{before:state.job.basePrompt,after:state.job.result,jobId:state.job.id}:t.panel.generation?.promptComparisons?.[t.chosen.source]);
 function paint(){
  const t=target(),host=root.querySelector('.prompt-rewrite');if(!t||!host)return;
  const state=states.get(t.key)||{},job=state.job,pair=pairFor(t,state),notes=host.querySelector('[data-prompt-rewrite-notes]'),pending=state.submitting||state.applying||job?.status==='running'||references.busy(t),locked=t.panel.locked===true,image=state.mode==='image';
  if(document.activeElement!==notes)notes.value=getNotes(t);notes.disabled=locked||pending;
  const mode=host.querySelector('[data-picture-edit-mode]');mode.value=state.mode||'prompt';mode.disabled=locked||pending;
  const start=host.querySelector('[data-prompt-rewrite-start]');start.disabled=locked||pending||!notes.value.trim()||(image&&!t.panel.imageAssetId);start.textContent=pending?'Codex 正在处理…':image?'将整张原图交给 Codex 改图':'让 Codex 修改提示词';
  host.querySelector('[data-prompt-rewrite-status]').textContent=state.error||(references.busy(t)?'正在保存粘贴参考图…':pending?'正在处理当前格，可以继续查看其他格。':image?'发送完整原图、修改意见及下方粘贴参考图；提示词保持原样。':'修改意见与粘贴参考图一起发送；结果放入上方提示词框，可撤销。');
  references.paint();
  host.querySelector('[data-prompt-rewrite-cancel]').hidden=job?.status!=='running';
  for(const button of root.querySelectorAll('[data-prompt-version]')){button.disabled=locked||pending||!pair;button.setAttribute('aria-pressed',String(!!pair&&t.chosen.text===pair[button.dataset.promptVersion]));}
 }
 async function acceptCompleted(){
  const t=target();if(!t)return;const state=states.get(t.key),job=state?.job;
  if(!job||job.status!=='completed'||state.applying||state.handled===job.id||t.panel.locked)return;
  if(t.panel.generation?.promptComparisons?.[t.chosen.source]?.jobId===job.id){state.handled=job.id;return;}
  state.applying=true;
  try{
   await flushSave();const now=target();if(now?.key!==t.key)return;
   if(now.chosen.text!==job.basePrompt&&now.chosen.text!==job.result){state.error='当前提示词已有新修改，已保留；可用上方“改后”查看并采用 Codex 结果。';state.handled=job.id;return;}
   await apply(job.result,now,{before:job.basePrompt,after:job.result,jobId:job.id,active:'after'});state.handled=job.id;state.error='';
  }catch(error){state.error=error.message;state.handled=job.id;}finally{state.applying=false;paint();}
 }
 async function refresh(){const t=target();if(!t||!root.querySelector('.prompt-rewrite'))return;let state=states.get(t.key);if(!state){state={};states.set(t.key,state);try{const value=await api(endpoint(t)+'?'+new URLSearchParams({panelId:t.panel.id,source:t.chosen.source}));if(!state.submitting&&!state.job)state.job=value.job;}catch(error){state.error=error.message;}}paint();await acceptCompleted();schedule();}
 function schedule(){if(timer||![...states.values()].some(s=>s.job?.status==='running'))return;timer=setTimeout(async()=>{timer=null;for(const state of states.values()){if(state.job?.status!=='running')continue;try{state.job=(await api('/api/projects/'+state.job.projectId+'/prompt-rewrite/'+state.job.id)).job;state.error='';}catch(error){state.error=error.message;}}paint();await acceptCompleted();schedule();},1500);}
 root.addEventListener('input',e=>{const t=target();if(!t)return;if(e.target.matches('[data-prompt-rewrite-notes]')){try{localStorage.setItem(noteKey(t),e.target.value);}catch{}paint();}});
 root.addEventListener('change',e=>{if(!e.target.matches('[data-picture-edit-mode]'))return;const t=target();if(!t)return;const state=states.get(t.key)||{};states.set(t.key,state);state.mode=e.target.value;state.error='';paint();});
 root.addEventListener('click',async e=>{
  const button=e.target.closest('[data-prompt-rewrite-start],[data-prompt-rewrite-cancel],[data-prompt-version]');if(!button||button.disabled)return;const t=target();if(!t)return;const state=states.get(t.key)||{};states.set(t.key,state);
  try{
   if(button.hasAttribute('data-prompt-version')){
    const pair=pairFor(t,state);if(!pair)return;await flushSave();const now=target();if(now?.key!==t.key)throw Error('目标格已改变');
    await apply(pair[button.dataset.promptVersion],now,{...pair,active:button.dataset.promptVersion});state.handled=pair.jobId;state.error='';
   }else if(button.hasAttribute('data-prompt-rewrite-start')){
    if(state.submitting||state.job?.status==='running')return;const notes=getNotes(t).trim();if(!notes)throw Error('请先输入画面修改意见');state.submitting=true;state.error='';paint();await flushSave();const now=target();if(now?.key!==t.key)throw Error('选中格或提示词模式已改变，请重新提交');
    const editReferenceIds=references.ids(now);if(editReferenceIds.length&&!(await api('/api/health')).editReferencePasteVersion)throw Error('粘贴参考图服务正在更新，请稍后重试');
    if(state.mode==='image'){await editImage(notes,now,editReferenceIds);}
    else{state.job=(await api(endpoint(now),'POST',{panelId:now.panel.id,source:now.chosen.source,expectedRevision:now.p.revision,notes,editReferenceIds,requestId:crypto.randomUUID()})).job;schedule();}
   }else state.job=(await api(endpoint(t)+'/'+state.job.id+'/cancel','POST',{})).job;
  }catch(error){state.error=error.message;toast(error.message,true);}finally{state.submitting=false;paint();await acceptCompleted();}
 });
 return {refresh};
}
