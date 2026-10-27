export function codexConnectionState(value,{checking=false}={}){
 if(checking)return {key:'checking',label:'正在连接…'};
 if(!value)return {key:'unknown',label:'尚未检查'};
 if(value.installed===false)return {key:'unavailable',label:'未安装 Codex'};
 if(value.connected&&value.sessionReady)return {key:'connected',label:'已连接'};
 if(value.connected)return {key:'account',label:'账号已登录 · 待检查会话'};
 if(value.needsLogin)return {key:'login',label:'未登录'};
 return {key:'failed',label:'连接失败'};
}
export function mountCodexConnection({api,modal,closeModal,toast,onStatus=()=>{}}){
 const button=document.querySelector('#codex-connect'),label=button.querySelector('#codex-label'),wrap=document.createElement('div'),indicator=document.createElement('span');wrap.className='codex-connection-control';button.before(wrap);wrap.append(button,indicator);indicator.id='codex-connection-status';indicator.setAttribute('role','status');indicator.setAttribute('aria-live','polite');label.textContent='连接 Codex';let value=null,pending=null,checking=false;
 function update(next=value){value=next;const state=codexConnectionState(value,{checking});wrap.dataset.state=state.key;indicator.textContent=state.label;indicator.title=value?.message||'检查 Codex 账号与会话连接';button.title=indicator.title;button.disabled=checking;button.classList.toggle('connected',state.key==='connected');button.setAttribute('aria-busy',String(checking));}
 async function check(force=false){if(pending)return pending;checking=true;update();pending=(async()=>{try{value=await api('/api/codex/status'+(force?'?force=1':''));}catch(e){value={installed:true,connected:false,needsLogin:false,message:e.message,connectionState:'temporary_failure'};}finally{checking=false;pending=null;update();onStatus(value);}return value;})();return pending;}
 function details(){modal('Codex 连接',`<p><strong>${codexConnectionState(value).label}</strong></p><p data-codex-diagnostic></p><p data-codex-version></p><p>检查账号与空会话连接，不提交生图任务。</p>`,[{label:'关闭',run:closeModal},{label:'重新连接',primary:true,run:async()=>{closeModal();await check(true);details();}},...(value?.needsLogin?[{label:'官方登录',run:async()=>{await api('/api/codex/login','POST',{});closeModal();toast('请在官方页面登录，再点连接 Codex');}}]:[])]);document.querySelector('[data-codex-diagnostic]').textContent=value?.message||'尚未检查';document.querySelector('[data-codex-version]').textContent=value?.version||'';}
 button.addEventListener('click',async()=>{await check(true);details();});update();void check();const timer=setInterval(()=>{if(!document.hidden&&!pending)void check();},60000);window.addEventListener('pagehide',()=>clearInterval(timer),{once:true});return {update,check};
}
