export function mountMokuLoginUI({api,toast}){
 const dialog=document.createElement('dialog');dialog.id='moku-login-dialog';dialog.setAttribute('aria-labelledby','moku-login-title');
 dialog.innerHTML=`<header><div><h2 id="moku-login-title">登录墨库</h2><p>登录后可同步工程、查看同事进度和取用素材。</p></div><button type="button" data-moku-login-close aria-label="关闭墨库登录">×</button></header><form><label for="moku-login-user">墨库账号</label><input id="moku-login-user" name="username" autocomplete="username" required maxlength="200" placeholder="请输入墨库账号"><label for="moku-login-password">密码</label><input id="moku-login-password" name="password" type="password" autocomplete="current-password" required placeholder="请输入密码"><p data-moku-login-status role="status" aria-live="polite">正在检查墨库连接…</p><button class="primary" type="submit">登录墨库</button><button type="button" data-moku-logout hidden>退出墨库</button><p class="moku-login-note">请使用你自己的墨库账号，并确保有协作项目的访问权限。</p></form>`;
 document.body.append(dialog);const form=dialog.querySelector('form'),user=dialog.querySelector('[name=username]'),password=dialog.querySelector('[name=password]'),submit=form.querySelector('[type=submit]'),logout=form.querySelector('[data-moku-logout]'),status=dialog.querySelector('[data-moku-login-status]');let busy=false,epoch=0;
 const entry=document.createElement('button');entry.type='button';entry.id='moku-login-open';entry.textContent='墨库登录 / 账号';document.querySelector('.integration-actions')?.append(entry);
 function message(text,error=false){status.textContent=text;status.classList.toggle('error',error);}
 async function check(){const ticket=++epoch;try{const state=await api('/api/library/status');if(ticket!==epoch||!dialog.open||busy)return;logout.hidden=!(state.connected||state.hasSession);if(state.connected){const who=state.user?.displayName||state.user?.username||'当前账号';message('已连接墨库 · '+who+'。如需切换账号，可在此重新登录。');if(!user.value)user.value=state.user?.username||'';}else message(state.error||'尚未登录墨库，请输入账号和密码。',true);}catch(error){if(ticket===epoch&&dialog.open&&!busy){logout.hidden=true;message('暂时无法连接墨库：'+error.message,true);}}}
 function open(){if(!dialog.open){message('正在检查墨库连接…');dialog.showModal();}user.focus();void check();}
 entry.addEventListener('click',()=>{entry.closest('details')?.removeAttribute('open');open();});
 function clearLoginHash(){if(location.hash==='#moku-login')history.replaceState(null,'',location.pathname+location.search);}
 function close(){clearLoginHash();dialog.close();}
 dialog.querySelector('[data-moku-login-close]').addEventListener('click',close);
 dialog.addEventListener('cancel',clearLoginHash);
 logout.addEventListener('click',async()=>{if(busy)return;busy=true;epoch++;submit.disabled=true;logout.disabled=true;message('正在退出墨库…');try{const result=await api('/api/library/logout','POST',{});password.value='';user.value='';logout.hidden=true;window.dispatchEvent(new CustomEvent('moku-auth-changed'));message(result.warning||'已退出墨库，可重新登录。',!!result.warning);toast?.(result.warning||'已退出墨库。',!!result.warning);}catch(error){message('退出失败：'+error.message,true);}finally{busy=false;submit.disabled=false;logout.disabled=false;}});
 form.addEventListener('submit',async event=>{event.preventDefault();if(busy||!form.reportValidity())return;busy=true;epoch++;submit.disabled=true;submit.textContent='正在登录…';message('正在登录墨库…');const username=user.value.trim(),secret=password.value;
  try{await api('/api/library/login','POST',{username,password:secret});password.value='';window.dispatchEvent(new CustomEvent('moku-auth-changed'));toast?.('墨库登录成功，可以继续同步工程。');close();}
  catch(error){message(error.message,true);}
  finally{busy=false;submit.disabled=false;submit.textContent='登录墨库';}
 });
 dialog.addEventListener('close',()=>{epoch++;password.value='';});
 const fromLink=()=>{if(location.hash==='#moku-login')open();};window.addEventListener('hashchange',fromLink);fromLink();
 return {open};
}
