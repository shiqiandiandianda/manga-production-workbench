export function mountTeamMemberProfile({nonce='',getMember,onIdentity}={}){
 const dialog=document.createElement('dialog');dialog.className='team-profile-dialog';
 dialog.innerHTML='<form><h2>成员姓名</h2><label>姓名<input name="memberName" maxlength="40" required autocomplete="off"></label><p role="status"></p><div><button type="button" data-cancel>取消</button><button type="submit">保存</button></div></form>';
 document.body.append(dialog);let editing='',self={name:''};
 const input=dialog.querySelector('input'),status=dialog.querySelector('[role=status]'),save=dialog.querySelector('[type=submit]');
 async function api(route,method='GET',value){const r=await fetch('/api/team-members'+route,{method,headers:{'Content-Type':'application/json','X-Dashboard-Control':nonce},body:value?JSON.stringify(value):undefined,signal:AbortSignal.timeout(8000)}),v=await r.json();if(!r.ok)throw Error(v.error||'姓名暂未读取');return v;}
 async function refresh(){self=await api('/identity');onIdentity?.(self);}
 function open(member){editing=member?.id||'';input.value=member?.name||self.name||'';status.textContent='';dialog.showModal();input.focus();}
 dialog.querySelector('[data-cancel]').onclick=()=>dialog.close();
 dialog.querySelector('form').onsubmit=async event=>{event.preventDefault();save.disabled=true;try{
  const result=await api(editing?'/members/'+encodeURIComponent(editing)+'/name':'/profile','POST',{name:input.value.trim()});
  if(!editing){self={...self,name:result.name};onIdentity?.(self);}dialog.close();window.dispatchEvent(new CustomEvent('team-identity-changed'));
 }catch(error){status.textContent=error.message;}finally{save.disabled=false;}};
 void refresh().catch(()=>onIdentity?.({name:''}));
 return {editName:()=>open(),async editMember(id){const member=getMember?.(id);if(!member)throw Error('成员已变化，请刷新后重试');open(member);}};
}
