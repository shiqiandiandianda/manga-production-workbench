import {mountVolunteer} from './project-center-volunteer.js';
const $=s=>document.querySelector(s);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const labels={queued:'等待接单',running:'正在生成',uploading:'回传图片',verifying:'核验图片',done:'已生成',failed:'执行失败',cancelled:'已取消',uncertain:'状态待核实'};
const ongoing=new Set(['queued','running','uploading','verifying']);
let data={tasks:[],nodes:[],projects:[],members:[]},filter='active',search='',onlyMine=false,limit=40,loading=false,requestBusy=false,requestSnapshot=null,selectedTask=null,settingsDirty=false;
const volunteer=mountVolunteer({getData:()=>data,api,refresh:load,notice});
const time=v=>v?new Date(v).toLocaleTimeString('zh-CN',{hour12:false,timeZone:'Asia/Shanghai'}):'尚未回传';
async function api(url,input){const r=await fetch(url,{method:input===undefined?'GET':'POST',headers:input===undefined?{}:{'Content-Type':'application/json'},...(input===undefined?{}:{body:JSON.stringify(input)}),cache:'no-store',signal:AbortSignal.timeout(input===undefined?12000:120000)}),v=await r.json();if(!r.ok)throw Error(v.error||'操作失败');return v;}
function notice(message){$('#notice').hidden=!message;$('#notice').textContent=message||'';}
function needsResult(t){return t.mine&&t.hasResult&&t.apply?.status!=='applied';}
function stateLabel(t){if(t.status==='queued'&&t.volunteerNodeId)return '已主动领取 · 待确认';return t.status==='done'&&t.kind==='collaboration'?(t.apply?.status==='applied'?'已接回原画格':['candidate','conflict'].includes(t.apply?.status)?'已存候选':'结果待接回'):labels[t.status]||'状态待核实';}
function matches(t){return (filter==='all'||filter==='active'&&ongoing.has(t.status)||filter==='results'&&needsResult(t)||filter==='attention'&&['failed','uncertain'].includes(t.status)||t.status===filter)&&(!onlyMine||t.mine)&&(!search||[t.work,t.name,t.owner,t.helper,t.message].join(' ').toLocaleLowerCase().includes(search));}
function taskMarkup(t){return `<article class="task-card" data-task-id="${esc(t.id)}"><div class="task-card-top"><small>${t.kind==='asset'?'资产工作室':t.mine?'我发起的请求':'同事的请求'}</small><span class="task-state state-${esc(t.status)}">${esc(stateLabel(t))}</span></div><h3 title="${esc(t.name)}">${esc(t.name)}</h3><p class="task-work" title="${esc(t.work)}">${esc(t.work)}${t.episode?' · 第'+esc(t.episode)+'话':''}</p><p class="task-people" title="${esc(t.owner)} → ${esc(t.helper||t.preferredName||'空闲同事')}">${esc(t.owner)} → ${esc(t.helper||t.preferredName||'空闲同事')}</p><p class="task-current">${esc(t.message||labels[t.status])}</p><footer><span>更新 ${esc(time(t.updatedAt))}</span><span class="task-actions">${t.canVolunteer?`<button data-volunteer-task="${esc(t.id)}" ${!data.self?.manualHelp?.available?'disabled':''}>我来生成</button>`:''}<button data-detail="${esc(t.id)}">查看详情</button></span></footer></article>`;}
function render(){
  const own=data.nodes.find(n=>n.mine);$('#connection').textContent=data.connection?.reachable?(own?.enabled?'已连接团队 · 自动接单中':own?'已连接团队 · 自动帮忙已暂停':'已连接团队'):'团队连接待恢复';
  const counts=[['可帮忙的电脑',data.nodes.filter(n=>n.ready&&n.freeSlots>0).length],['等待接单',data.tasks.filter(t=>t.status==='queued').length],['正在生成',data.tasks.filter(t=>['running','uploading','verifying'].includes(t.status)).length],['我的结果待接回',data.tasks.filter(needsResult).length]];
  $('#metrics').innerHTML=counts.map(([name,n])=>'<article class="metric"><span>'+name+'</span><strong>'+n+'</strong></article>').join('');
  $('#helpers-summary').textContent=data.nodes.filter(n=>n.online).length+' 台接单器在线 · '+data.nodes.reduce((n,i)=>n+i.freeSlots,0)+' 个空闲名额';
  $('#helpers').innerHTML=data.nodes.map(n=>'<article class="helper '+(n.ready?'ready':'')+'"><span class="avatar">'+esc(n.name[0]||'?')+'</span><div><strong title="'+esc(n.machine)+'">'+esc(n.name)+(n.mine?' · 本机':'')+'</strong><small title="'+esc(n.message)+'">'+esc(!n.online?'离线':!n.enabled?'暂停帮忙':!n.ready?'连接待修复':n.freeSlots>0?'可接 '+n.freeSlots+' 项 · 并发 '+n.concurrency:'正在忙 · 等待空闲')+'</small></div></article>').join('')||'<div class="empty"><strong>还没有可用的帮忙电脑</strong><p>同事升级并启动工具后，接单器会自动连接到团队。</p></div>';
  const missing=[...new Set((data.members||[]).filter(m=>m.connection==='online'&&!m.connected).map(m=>m.name).filter(Boolean))];
  $('#missing-helpers').textContent=missing.length?'在线但尚未接入画格接单器：'+missing.join('、')+'。需要在各自电脑升级并启动新版工具。':'';
  for(const b of document.querySelectorAll('[data-status]'))b.setAttribute('aria-pressed',String(b.dataset.status===filter));
  const rank={running:0,uploading:1,verifying:2,queued:3,uncertain:4,failed:5,done:6,cancelled:7};
  const rows=data.tasks.filter(matches).sort((a,b)=>(rank[a.status]??9)-(rank[b.status]??9)||(Date.parse(b.updatedAt)||Number(b.updatedAt)||0)-(Date.parse(a.updatedAt)||Number(a.updatedAt)||0));
  const html=rows.slice(0,limit).map(taskMarkup).join('')||'<div class="empty"><strong>当前没有符合条件的任务</strong><p>点击上方请求帮忙生图，或切换筛选查看已完成记录。</p></div>';
  if($('#tasks').innerHTML!==html)$('#tasks').innerHTML=html;
  $('#more').hidden=rows.length<=limit;
  const mine=data.nodes.find(n=>n.mine);$('#help-enabled').disabled=!mine;$('#help-concurrency').disabled=!mine;$('#save-settings').disabled=!mine;
  if(!settingsDirty&&document.activeElement!==$('#help-enabled'))$('#help-enabled').checked=!!mine?.enabled;
  if(!settingsDirty&&document.activeElement!==$('#help-concurrency'))$('#help-concurrency').value=String(mine?.concurrency||1);
  $('#my-node-state').textContent=mine?(mine.online?(mine.enabled?'已连接团队，空闲时自动领取帮忙任务。':'自动帮忙已暂停，仍可通过“我来帮忙生图”手动领取。'):'本机接单器暂未在线，请检查团队接入。'):'本机尚未接入画格接单器，请升级并启动工具。';
  $('#request-open').disabled=!data.connection?.reachable;$('#updated').textContent='最后更新 '+time(data.updatedAt)+' · 每 5 秒自动刷新';
  volunteer.update();if($('#task-dialog').open)renderDetail();
}
async function load(){if(loading)return;loading=true;$('#refresh').disabled=true;try{const next=await api('/api/production-center/status');
  if(!next.connection?.reachable&&data.updatedAt){data.connection=next.connection;notice('团队连接暂时中断，保留上次任务状态。'+(next.connection?.message||''));}
  else{data=next;notice(next.connection?.reachable?next.pendingRequests?.length?'有提交结果待核实的请求，请保留原请求查看回传，不要另开重复任务。':'':next.connection?.message||'团队连接尚未完成，请检查接单器与协作中控。');}
  render();
}catch(e){notice((data.updatedAt?'连接中断，保留已有任务记录。':'生产中心暂不可达。')+e.message);}finally{loading=false;$('#refresh').disabled=false;}}
function selectedProject(){return requestSnapshot?.projects.find(p=>p.id===$('#request-project').value);}
function selectedPage(){return selectedProject()?.pages.find(p=>p.id===$('#request-page').value);}
function selectionCount(){const count=$$('#panel-options input:checked').length;$('#selection-count').textContent='已选择 '+count+' 个画格';$('#request-submit').disabled=requestBusy||count===0;}
const $$=s=>[...document.querySelectorAll(s)];
function panelOptions(){const p=selectedPage();$('#panel-options').innerHTML=(p?.panels||[]).map(f=>'<label class="panel-option '+(f.locked||f.busy?'disabled':'')+'"><input type="checkbox" value="'+esc(f.id)+'" data-has-image="'+String(f.hasImage)+'" '+(f.locked||f.busy?'disabled':'')+'><span><strong>'+esc(f.name)+'</strong><small>'+esc(f.locked?'已锁定':f.busy?'已有生成请求':f.hasImage?'已有图片，可重新生成':'尚未出图')+'</small></span></label>').join('')||'<p>本画板没有可请求生成的画格。</p>';selectionCount();}
function pageOptions(){const p=selectedProject();$('#request-page').innerHTML=(p?.pages||[]).map(v=>'<option value="'+esc(v.id)+'">'+esc([v.episode?'第'+v.episode+'话':'',v.name].filter(Boolean).join(' · '))+'</option>').join('');panelOptions();}
$('#request-open').onclick=()=>{requestSnapshot=structuredClone(data);$('#request-project').innerHTML=data.projects.map(p=>'<option value="'+esc(p.id)+'">'+esc(p.title)+'</option>').join('');$('#request-helper').innerHTML='<option value="">空闲同事自动接单</option>'+data.nodes.map(n=>'<option value="'+esc(n.id)+'">指定 '+esc(n.name)+(n.online?'':'（离线，等待上线）')+'</option>').join('');const projectId=new URLSearchParams(location.search).get('project');if(data.projects.some(p=>p.id===projectId))$('#request-project').value=projectId;$('#request-message').textContent='';pageOptions();$('#request-dialog').showModal();};
$('#request-project').onchange=pageOptions;$('#request-page').onchange=panelOptions;$('#panel-options').onchange=selectionCount;
$('#select-missing').onclick=()=>{$$('#panel-options input:not(:disabled)').forEach(n=>n.checked=n.dataset.hasImage==='false');selectionCount();};
$('#clear-selection').onclick=()=>{$$('#panel-options input').forEach(n=>n.checked=false);selectionCount();};
$('#request-form').onsubmit=async e=>{e.preventDefault();if(requestBusy)return;const p=selectedProject(),panelIds=$$('#panel-options input:checked').map(n=>n.value);if(!p||!panelIds.length)return;requestBusy=true;selectionCount();$('#request-message').textContent='正在校验提示词和参考图，并提交帮忙请求…';
  try{const result=await api('/api/production-center/dispatch',{projectId:p.id,expectedRevision:p.revision,panelIds,preferredNodeId:$('#request-helper').value||null});
    if(result.errors?.length){$('#request-message').textContent=result.message+'\n'+result.errors.map(v=>v.panelId+'：'+v.error).join('\n');}
    else{$('#request-dialog').close();filter='active';notice(result.message);}
    await load();
  }catch(error){$('#request-message').textContent=error.message;}finally{requestBusy=false;selectionCount();}
};
function renderDetail(){const t=data.tasks.find(t=>t.id===selectedTask);if(!t)return;const detail=$('#task-detail'),html='<span class="task-state state-'+esc(t.status)+'">'+esc(stateLabel(t))+'</span><h3 class="detail-title">'+esc(t.name)+'</h3><dl class="detail-grid">'+[['所属作品',t.work],['发起人',t.owner],['执行同事',t.helper||t.preferredName||'空闲同事自动接单'],['当前进度',t.message||labels[t.status]],['接回状态',t.kind==='asset'?'在资产工作室查看':t.apply?.status==='applied'?'已接回原画格':['candidate','conflict'].includes(t.apply?.status)?'已保留为候选':t.apply?.detail||'等待成图后接回'],['最近更新',time(t.updatedAt)]].map(([k,v])=>'<dt>'+k+'</dt><dd>'+esc(v)+'</dd>').join('')+'</dl>'+(t.hasResult?'<img class="detail-preview" src="'+esc(t.resultUrl)+'" alt="协作生成结果">':'')+'<div class="detail-actions">'+(t.canVolunteer?'<button data-volunteer-task="'+esc(t.id)+'" '+(!data.self?.manualHelp?.available?'disabled':'')+'>我来生成</button>':'')+(t.mine&&t.hasResult&&t.apply?.status!=='applied'?'<button class="primary" data-result-action="safe">接回原画格</button><button data-result-action="candidate">仅存为候选</button>':'')+(t.mine&&ongoing.has(t.status)?'<button data-cancel-task>取消帮忙请求</button>':'')+(t.mine&&['failed','cancelled'].includes(t.status)?'<button data-retry-task>重试原请求</button>':'')+'</div>'+(t.mine&&t.hasResult&&t.apply?.status!=='applied'?'<p class="detail-note">画格或参考已修改时会保留候选，供你核对。</p>':'');if(detail.innerHTML!==html)detail.innerHTML=html;}
$('#tasks').onclick=e=>{const b=e.target.closest('[data-detail]');if(!b)return;selectedTask=b.dataset.detail;renderDetail();$('#task-dialog').showModal();};
$('#task-detail').onclick=async e=>{const b=e.target.closest('button');if(!b)return;const task=data.tasks.find(t=>t.id===selectedTask);if(!task?.mine)return;b.disabled=true;try{if(b.hasAttribute('data-cancel-task'))await api('/api/collab/tasks/'+encodeURIComponent(task.id)+'/cancel',{});else if(b.hasAttribute('data-retry-task'))await api('/api/collab/tasks/'+encodeURIComponent(task.id)+'/retry',{});else if(b.dataset.resultAction)await api('/api/collab/tasks/'+encodeURIComponent(task.id)+'/apply-choice',{choice:b.dataset.resultAction});await load();}catch(err){notice(err.message);b.disabled=false;}};
$$('dialog [data-close]').forEach(b=>b.onclick=()=>{if(!requestBusy)b.closest('dialog').close();});
$('#task-tabs').onclick=e=>{const b=e.target.closest('[data-status]');if(b){filter=b.dataset.status;limit=40;render();}};
$('#owner-filter').onchange=e=>{onlyMine=e.target.value==='mine';limit=40;render();};$('#search').oninput=e=>{search=e.target.value.trim().toLocaleLowerCase();limit=40;render();};$('#more').onclick=()=>{limit+=40;render();};$('#refresh').onclick=()=>void load();
$('#help-enabled').onchange=$('#help-concurrency').onchange=()=>{settingsDirty=true;};
$('#save-settings').onclick=async()=>{const b=$('#save-settings');b.disabled=true;try{const v=await api('/api/production-center/node-settings',{enabled:$('#help-enabled').checked,concurrency:Number($('#help-concurrency').value)});settingsDirty=false;await load();notice(v.message);}catch(e){notice(e.message);}finally{b.disabled=!data.nodes.some(n=>n.mine);}};
void load();setInterval(()=>{if(document.visibilityState==='visible'&&!requestBusy)void load();},5000);
