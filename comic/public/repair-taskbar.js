const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const labels={waiting:'等待结果',queued:'排队中',running:'正在修图',compositing:'正在接回',ready:'等待合成',applied:'图片修改已合成',failed:'修图失败',cancelled:'已取消',attention:'需要核对'};
const active=t=>['waiting','queued','running','compositing','ready'].includes(t.status);
export function mountRepairTaskbar({api,getProject,canApply,apply,onLocate,onResult,toast}){
 const button=document.createElement('button');button.id='repair-tasks-toggle';button.setAttribute('aria-controls','repair-task-drawer');button.setAttribute('aria-expanded','false');
 document.querySelector('.job-heading .footer-spacer').before(button);
 const drawer=document.createElement('section');drawer.id='repair-task-drawer';drawer.hidden=true;drawer.setAttribute('aria-label','后台修图任务');drawer.innerHTML='<header><strong>后台修图任务</strong><span>点击任务定位画格</span><button data-repair-tasks-close aria-label="收起修图任务">×</button></header><div data-repair-task-list></div>';document.body.append(drawer);
 let tasks=[],busy=false,online=true;const seenKey='comic-repair-seen-v1';let seen;try{seen=new Set(JSON.parse(localStorage.getItem(seenKey)||'[]'));}catch{seen=new Set();}
 const key=t=>t.id+':'+t.completedAt;
 function acknowledge(){for(const t of tasks.filter(t=>t.status==='applied'))seen.add(key(t));localStorage.setItem(seenKey,JSON.stringify([...seen].slice(-300)));}
 function position(){drawer.style.bottom=(innerHeight-button.closest('.job-heading').getBoundingClientRect().top+8)+'px';}
 function render(){
  const pending=tasks.filter(active),unread=tasks.filter(t=>t.status==='applied'&&!seen.has(key(t))),attention=tasks.filter(t=>['attention','failed'].includes(t.status));
  button.classList.toggle('repair-complete-pulse',unread.length>0);button.classList.toggle('repair-task-busy',pending.length>0);button.textContent=!online?'修图状态连接中断 · 点击重试':unread.length?`图片修改已合成 · ${unread.length} 张${pending.length?' · '+pending.length+' 项处理中':''} ▴`:pending.length?`局部修图 ${pending.length} 项 · ${labels[pending[0].status]} ▴`:attention.length?`修图 ${attention.length} 项需核对 ▴`:'修图任务'+(tasks.length?' · '+tasks.length:'')+' ▴';button.title='展开全部修图任务与进度；完成后自动合成到原格';
  const ordered=[...tasks.filter(active),...tasks.filter(t=>!active(t))],list=drawer.querySelector('[data-repair-task-list]'),scrollTop=list.scrollTop,focused=document.activeElement?.dataset.repairTask;
  drawer.querySelector('[data-repair-task-list]').innerHTML=ordered.length?ordered.map(t=>{
   const index={queued:0,waiting:1,running:1,compositing:2,ready:2,applied:3}[t.status],seconds=Math.max(0,Math.floor(((t.completedAt?Date.parse(t.completedAt):Date.now())-Date.parse(t.createdAt))/1000));
   return `<button class="repair-task-row ${t.status}" data-repair-task="${esc(t.id)}" title="${esc(t.label+' · '+t.instruction+' · '+(t.message||'点击定位画格'))}"><span class="repair-task-top"><strong>${esc(t.label)}</strong><span class="repair-task-instruction">${esc(t.instruction||'局部修图')}</span><span class="repair-task-status">${esc(labels[t.status]||t.status)}</span><small>${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}</small></span><span class="repair-task-bottom"><small class="repair-task-project">${esc(t.projectTitle)}</small><span class="repair-task-steps" aria-label="${esc(labels[t.status])}">${['排队','修图','合成','完成'].map((step,i)=>`<span class="${index>=i?'reached':''}">${step}</span>`).join('')}</span><span class="repair-locate">定位 ↗</span></span>${['attention','failed'].includes(t.status)?`<span class="repair-task-error">${esc(t.message)}</span>`:''}</button>`;
  }).join(''):'<p class="repair-task-empty">暂无修图任务。框选局部修图提交后，可返回排版继续工作。</p>';
  list.scrollTop=scrollTop;if(focused)list.querySelector('[data-repair-task="'+CSS.escape(focused)+'"]')?.focus({preventScroll:true});
  if(!drawer.hidden)position();
 }
 function toggle(open=!drawer.hidden){drawer.hidden=open;button.setAttribute('aria-expanded',String(!open));if(!open){acknowledge();render();position();}}
 button.onclick=()=>{toggle();void poll();};drawer.querySelector('[data-repair-tasks-close]').onclick=()=>toggle(true);
 drawer.addEventListener('click',async e=>{const row=e.target.closest('[data-repair-task]');if(!row)return;const t=tasks.find(t=>t.id===row.dataset.repairTask);try{await onLocate(t);toggle(true);}catch(error){toast(error.message,true);}});
 window.addEventListener('resize',position);document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!drawer.hidden){toggle(true);e.stopImmediatePropagation();}},true);
 async function poll(){if(busy)return;busy=true;try{
   const data=await api('/api/integrated-repair/tasks');tasks=data.tasks;online=true;render();
   for(const task of tasks.filter(t=>t.status==='ready')){
    if(!canApply())break;
    try{const result=await apply(task);if(!result)break;if(result.task){tasks=tasks.map(t=>t.id===task.id?result.task:t);render();}if(!result.alreadyApplied){onResult?.(result);toast('图片修改已合成 · '+task.label);}}
    catch(error){if(!/工程已有修改|正在接回上一张|请稍后/.test(error.message))toast(error.message,true);break;}
   }
  }catch{online=false;render();}finally{busy=false;}}
 window.addEventListener('message',e=>{if(e.origin===location.origin&&e.source===document.querySelector('#repair-editor')?.contentWindow&&e.data?.type==='comic:repair-job')void poll();});
 render();void poll();setInterval(()=>void poll(),1000);return {refresh:poll};
}
