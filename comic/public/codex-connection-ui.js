export function codexConnectionState(value,{checking=false}={}){
 if(checking)return {key:'checking',label:'正在连接…'};
 if(!value)return {key:'unknown',label:'尚未检查'};
 if(value.installed===false)return {key:'unavailable',label:'未安装 Codex'};
 if(value.login?.running)return {key:'login',label:'等待官方登录'};
 if(value.connected&&value.sessionReady)return {key:'connected',label:'已连接'};
 if(value.connected)return {key:'account',label:'账号已登录 · 待检查会话'};
 if(value.needsLogin||value.errorCode==='chatgpt_login_required')return {key:'login',label:'未登录'};
 return {key:'failed',label:'连接失败'};
}
function officialUrl(value){
 try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password&&!url.port&&['auth.openai.com','auth0.openai.com','chatgpt.com'].includes(url.hostname)?url.href:null;}catch{return null;}
}
export function mountCodexConnection({api,modal,closeModal,toast,onStatus=()=>{}}){
 const button=document.querySelector('#codex-connect'),label=button.querySelector('#codex-label'),wrap=document.createElement('div'),indicator=document.createElement('span');
 wrap.className='codex-connection-control';button.before(wrap);wrap.append(button,indicator);indicator.id='codex-connection-status';indicator.setAttribute('role','status');indicator.setAttribute('aria-live','polite');label.textContent='连接 Codex';
 let value=null,pending=null,pendingForce=false,checking=false,login={running:false},starting=false,polling=false,handledCompletion=null,pollTimer=null,disposed=false,actionError='',loginSequence=0;
 const dialogRoot=()=>document.querySelector('#modal[open] [data-codex-dialog]');
 function render(){
  const root=dialogRoot();if(!root)return;
  const find=key=>root.querySelector(`[data-codex-${key}]`),state=codexConnectionState(value,{checking}),url=officialUrl(login.authUrl);
  find('state').textContent=state.label;
  const ceremonyMessage=login.running||!checking&&!value?.connected&&['failed','expired','cancelled'].includes(login.state);
  find('diagnostic').textContent=actionError||(ceremonyMessage?login.message:'')||value?.message||'正在检测本机 Codex…';
  find('version').textContent=value?.version||'';
  find('install').hidden=value?.installed!==false;
  find('guide').hidden=value?.connected===true&&!login.running;
  find('login').hidden=value?.installed===false||value?.connected===true||login.running;
  find('device').hidden=find('login').hidden;
  find('login').disabled=starting||checking;find('device').disabled=starting||checking;
  find('login').textContent=starting?'正在启动登录…':['failed','expired','cancelled'].includes(login.state)?'重新开始官方登录':'开始官方登录';
  find('cancel').hidden=!login.running;find('cancel').disabled=starting;
  find('check').disabled=checking||starting||login.running;
  find('check').textContent=checking?'正在检查连接…':'我已登录，检查连接';
  find('link-box').hidden=!url||!login.running;
  if(url)find('link').href=url;else find('link').removeAttribute('href');
  find('code-box').hidden=!login.running||!login.userCode;find('code').textContent=login.userCode||'';
  find('waiting').hidden=!login.running;
  find('success').hidden=!(value?.connected&&value?.sessionReady);
 }
 function update(next=value){
  value=next;const state=codexConnectionState(value,{checking});wrap.dataset.state=state.key;indicator.textContent=state.label;indicator.title=value?.message||'检查 Codex 账号与会话连接';button.title=indicator.title;button.classList.toggle('connected',state.key==='connected');button.setAttribute('aria-busy',String(checking));render();
 }
 function schedule(){clearTimeout(pollTimer);if(!disposed&&login.running)pollTimer=setTimeout(()=>void poll(),1500);}
 async function acceptLogin(next){
  login=next||{running:false};if(value)value={...value,login};update();schedule();
  if(login.state==='completed'&&login.attemptId!==handledCompletion){
   handledCompletion=login.attemptId;login={...login,message:'登录已完成，正在验证账号与空会话…'};await check(true);
   login={...login,message:value?.connected&&value?.sessionReady?'登录成功，Codex 已连接。':value?.message||'登录已结束，请检查连接。'};render();
  }
 }
 async function check(force=false){
  if(pending){const wasForced=pendingForce;await pending;if(force&&!wasForced)return check(true);return value;}
  checking=true;pendingForce=force;update();
  pending=(async()=>{
   try{value=await api('/api/codex/status'+(force?'?force=1':''));if(value.login)login=value.login;}
   catch(e){value={installed:true,connected:false,needsLogin:false,message:e.message,connectionState:'temporary_failure',login};}
   finally{checking=false;pending=null;update();onStatus(value);schedule();}
   return value;
  })();return pending;
 }
 async function poll(){
  if(disposed||polling||starting)return;polling=true;const sequence=loginSequence;
  try{const next=await api('/api/codex/login');if(sequence!==loginSequence)return;await acceptLogin(next);actionError='';}
  catch(e){if(sequence===loginSequence){actionError='登录状态暂时无法读取：'+e.message;render();schedule();}}
  finally{polling=false;render();schedule();}
 }
 async function start(method){
  if(starting||login.running)return;starting=true;loginSequence++;actionError='';render();
  try{handledCompletion=null;await acceptLogin(await api('/api/codex/login','POST',{method}));}
  catch(e){actionError=e.message;}
  finally{starting=false;render();schedule();}
 }
 async function cancel(){
  if(starting||!login.running)return;starting=true;loginSequence++;actionError='';render();
  try{await acceptLogin(await api('/api/codex/login/cancel','POST',{attemptId:login.attemptId}));}
  catch(e){actionError=e.message;}
  finally{starting=false;render();}
 }
 async function open(force=true){
  modal('Codex 连接与登录',`<div data-codex-dialog class="codex-login-guide">
   <p><strong data-codex-state role="status" aria-live="polite"></strong></p>
   <p data-codex-diagnostic role="status" aria-live="polite"></p><p data-codex-version></p>
   <p data-codex-install hidden>请先安装官方 Codex CLI，再重新打开工作台检查连接。<a href="https://developers.openai.com/codex/cli" target="_blank" rel="noopener noreferrer">官方安装说明</a></p>
   <div data-codex-guide><ol>
    <li><strong>检测本机 Codex</strong><br>使用启动工作台的当前电脑账号。</li>
    <li><strong>在官方页面登录 ChatGPT</strong><br>点击下方按钮，在浏览器完成授权。</li>
    <li><strong>返回工作台</strong><br>自动检查登录结果与空会话，成功后显示“已连接”。</li>
   </ol><p>凭据由官方 Codex 保存，无需在工作台输入密码或 API Key。</p></div>
   <div data-codex-link-box hidden><a data-codex-link target="_blank" rel="noopener noreferrer">打开官方登录页面</a> <button type="button" data-codex-copy>复制登录链接</button><p>没有自动打开浏览器时，点击此链接。</p></div>
   <p data-codex-code-box hidden>设备码：<strong data-codex-code></strong> <button type="button" data-codex-copy-code>复制设备码</button></p>
   <p data-codex-waiting hidden>正在等待授权，可以关闭此窗口继续编辑；重新打开后可继续查看。</p>
   <p data-codex-success hidden>账号与空会话检查通过。检查未提交生图任务。</p>
   <div class="codex-login-actions"><button type="button" class="primary" data-codex-login>开始官方登录</button><button type="button" data-codex-device>使用设备码登录</button><button type="button" data-codex-cancel hidden>取消本次登录</button><button type="button" data-codex-check>我已登录，检查连接</button></div>
   <details><summary>登录遇到问题／手动登录</summary><p>在启动工作台的同一台电脑、同一普通用户终端执行 <code>codex login</code>，完成后点击“我已登录，检查连接”。</p><p>浏览器回调失败时，可选择设备码登录，或执行 <code>codex login --device-auth</code>。设备码登录需要在 ChatGPT 安全设置中启用。</p><p>网络或会话检查失败可重新检查连接；不会自动重试生图。</p></details>
  </div>`,[{label:'关闭',run:closeModal}]);
  const root=dialogRoot();root.querySelector('[data-codex-login]').onclick=()=>void start('browser');root.querySelector('[data-codex-device]').onclick=()=>void start('device');root.querySelector('[data-codex-cancel]').onclick=()=>void cancel();
  root.querySelector('[data-codex-check]').onclick=async()=>{actionError='';login={...login,message:''};await check(true);};
  async function copy(text){try{await navigator.clipboard.writeText(text);toast('已复制');}catch{toast('复制失败，请直接打开链接或手动选择设备码',true);}}
  root.querySelector('[data-codex-copy]').onclick=()=>void copy(officialUrl(login.authUrl)||'');root.querySelector('[data-codex-copy-code]').onclick=()=>void copy(login.userCode||'');
  render();await check(force);if(login.running||login.state==='completed')void poll();
 }
 button.addEventListener('click',()=>void open());update();void check();
 const timer=setInterval(()=>{if(!document.hidden&&!pending&&!login.running)void check();},60000);
 window.addEventListener('pagehide',()=>{disposed=true;clearInterval(timer);clearTimeout(pollTimer);},{once:true});
 return {update,check,open};
}
