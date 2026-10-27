const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function mountVolunteer({getData,api,refresh,notice}){
 const dialog=document.querySelector('#volunteer-dialog'),open=document.querySelector('#volunteer-open'),list=document.querySelector('#volunteer-tasks'),next=document.querySelector('#volunteer-next'),status=document.querySelector('#volunteer-message');let busy=false;
 const candidates=()=>getData().tasks.filter(t=>t.canVolunteer).sort((a,b)=>(Date.parse(a.createdAt)||Number(a.createdAt)||0)-(Date.parse(b.createdAt)||Number(b.createdAt)||0));
 function update(){
  const data=getData(),help=data.self?.manualHelp,rows=candidates(),available=!!data.connection?.reachable&&!!help?.available;
  open.textContent='＋ 我来帮忙生图';
  document.querySelector('#volunteer-capacity').textContent=help?.message||'本机尚未接入接单器，请升级并启动工具';
  next.disabled=busy||!available||!rows.length;
  list.innerHTML=rows.length?rows.map(t=>'<article class="volunteer-task"><div><strong>'+escape(t.name)+'</strong><p>'+escape(t.work)+' · '+escape(t.owner)+'</p></div><button data-volunteer-task="'+escape(t.id)+'" '+(busy||!available?'disabled':'')+'>我来生成</button></article>').join(''):'<div class="empty"><strong>暂无可领取的协作任务</strong><p>正在生成的任务由原同事继续执行。请同事通过“请求帮忙生图”发布尚未开始的工作，发布后可在这里领取。</p></div>';
 }
 async function claim(taskId){
  if(busy)return;busy=true;status.textContent='正在核对任务与本机空闲名额…';update();
  try{const value=await api('/api/production-center/volunteer',{taskId});await refresh();status.textContent=value.message;notice(value.message);}
  catch(error){status.textContent=error.message;notice(error.message);await refresh();}
  finally{busy=false;update();}
 }
 open.onclick=()=>{status.textContent='';update();dialog.showModal();};
 next.onclick=()=>{const task=candidates()[0];if(task)void claim(task.id);};
 document.addEventListener('click',event=>{const button=event.target.closest('[data-volunteer-task]');if(button&&!button.disabled)void claim(button.dataset.volunteerTask);});
 return {update};
}
