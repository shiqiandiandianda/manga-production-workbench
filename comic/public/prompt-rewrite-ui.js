import {generationPromptSelection} from './prompt-source.js';

export function promptRewriteMarkup({disabled=false}={}){
 return `<section class="prompt-rewrite"><label>画面修改意见<textarea data-prompt-rewrite-notes rows="3" maxlength="4000" placeholder="例如：人物改为侧身，镜头拉近，背景和其他内容保留" ${disabled?'disabled':''}></textarea></label><button type="button" data-prompt-rewrite-start ${disabled?'disabled':''}>让 Codex 修改提示词</button><p class="inspector-hint" data-prompt-rewrite-status role="status"></p><button type="button" data-prompt-rewrite-cancel hidden>取消修改</button><div data-prompt-rewrite-result hidden><label>修改后的提示词<textarea data-prompt-rewrite-preview rows="7" maxlength="20000"></textarea></label><button type="button" data-prompt-rewrite-apply>应用到当前提示词</button></div></section>`;
}
export function mountPromptRewriteUI({root,api,getProject,getPanel,flushSave,apply,toast}){
 const states=new Map();let timer=null;
 const target=()=>{const p=getProject(),panel=getPanel();if(!p||!panel)return null;const chosen=generationPromptSelection(panel,p);return {p,panel,chosen,key:p.id+':'+panel.id+':'+chosen.source};};
 const endpoint=t=>'/api/projects/'+t.p.id+'/prompt-rewrite';
 const noteKey=t=>'comic-prompt-notes:'+t.key;
 const getNotes=t=>{try{return localStorage.getItem(noteKey(t))||'';}catch{return '';}};
 function paint(){const t=target(),host=root.querySelector('.prompt-rewrite');if(!t||!host)return;const state=states.get(t.key)||{},job=state.job,notes=host.querySelector('[data-prompt-rewrite-notes]'),pending=state.submitting||job?.status==='running',locked=t.panel.locked===true;
  if(document.activeElement!==notes)notes.value=getNotes(t);notes.disabled=locked||pending;
  const start=host.querySelector('[data-prompt-rewrite-start]');start.disabled=locked||pending||!notes.value.trim();start.textContent=pending?'Codex 正在修改…':'让 Codex 修改提示词';
  host.querySelector('[data-prompt-rewrite-status]').textContent=state.error|| (pending?'正在修改当前格的提示词，可以继续查看其他格。':job?.status==='completed'?'修改完成，请查看后应用。':job?.error||'仅修改当前模式的提示词，应用后可撤销。');
  host.querySelector('[data-prompt-rewrite-cancel]').hidden=job?.status!=='running';
  const result=host.querySelector('[data-prompt-rewrite-result]');result.hidden=job?.status!=='completed';const preview=host.querySelector('[data-prompt-rewrite-preview]');
  if(job?.status==='completed'&&document.activeElement!==preview)preview.value=state.draft??job.result;
  host.querySelector('[data-prompt-rewrite-apply]').disabled=locked||job?.status!=='completed';
 }
 async function refresh(){const t=target();if(!t||!root.querySelector('.prompt-rewrite'))return;let state=states.get(t.key);if(!state){state={};states.set(t.key,state);try{const value=await api(endpoint(t)+'?'+new URLSearchParams({panelId:t.panel.id,source:t.chosen.source}));if(!state.submitting&&!state.job)state.job=value.job;}catch(error){if(!state.submitting&&!state.job)state.error=error.message;}}paint();schedule();}
 function schedule(){if(timer)return;if(![...states.values()].some(s=>s.job?.status==='running'))return;timer=setTimeout(async()=>{timer=null;for(const [key,state]of states){if(state.job?.status!=='running')continue;try{const value=await api('/api/projects/'+state.job.projectId+'/prompt-rewrite/'+state.job.id);state.job=value.job;state.error='';}catch(error){state.error=error.message;}}paint();schedule();},1500);}
 root.addEventListener('input',e=>{const t=target();if(!t)return;if(e.target.matches('[data-prompt-rewrite-notes]')){try{localStorage.setItem(noteKey(t),e.target.value);}catch{}paint();}if(e.target.matches('[data-prompt-rewrite-preview]')){const state=states.get(t.key);if(state)state.draft=e.target.value;}});
 root.addEventListener('click',async e=>{
  const button=e.target.closest('[data-prompt-rewrite-start],[data-prompt-rewrite-cancel],[data-prompt-rewrite-apply]');if(!button||button.disabled)return;const t=target();if(!t)return;const state=states.get(t.key)||{};states.set(t.key,state);
  try{
   if(button.hasAttribute('data-prompt-rewrite-start')){if(state.submitting||state.job?.status==='running')return;const notes=getNotes(t).trim();if(!notes)throw Error('请先输入画面修改意见');state.submitting=true;state.error='';state.draft=undefined;paint();await flushSave();const now=target();if(now?.key!==t.key)throw Error('选中格或提示词模式已改变，请在目标格重新提交');const value=await api(endpoint(now),'POST',{panelId:t.panel.id,source:t.chosen.source,expectedRevision:now.p.revision,notes,requestId:crypto.randomUUID()});state.job=value.job;schedule();}
   else if(button.hasAttribute('data-prompt-rewrite-cancel')){state.job=(await api(endpoint(t)+'/'+state.job.id+'/cancel','POST',{})).job;}
   else{const job=state.job,text=root.querySelector('[data-prompt-rewrite-preview]').value;if(!job||job.status!=='completed')return;await flushSave();const now=target();if(now?.key!==t.key||now.chosen.text!==job.basePrompt)throw Error('原提示词或目标格已改变，未覆盖。请保留结果后重新提交意见。');if(!text.trim())throw Error('修改后的提示词不能为空');await apply(text,t);state.job=null;state.draft=undefined;toast('已应用到本格当前提示词，可撤销；需要出图时再点击生成。');}
  }catch(error){state.error=error.message;toast(error.message,true);}finally{state.submitting=false;paint();}
 });
 return {refresh};
}
