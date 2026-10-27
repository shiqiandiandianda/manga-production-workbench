import {teamDashboardUrl} from './workbench-update-navigation.mjs';
import {mountTeamComms} from './team-comms.js';
export function mountTeamToolbar({getProject,getPage}){
 const header=document.querySelector('.topbar'),nav=document.createElement('nav');nav.id='workbench-primary-nav';nav.setAttribute('aria-label','制作与协作入口');document.querySelector('.project-switcher').after(nav);
 for(const id of ['workspace-modes','storyboard-import','asset-studio-open']){const node=document.getElementById(id);if(node)nav.append(node);}
 const library=document.createElement('a');library.id='moku-shortcut';library.textContent='墨库';library.title='打开墨库网盘';library.href='/api/library/open';library.target='_blank';library.rel='noopener';
 const center=document.querySelector('#project-center-open')||document.createElement('a');if(!center.id){center.id='project-center-shortcut';center.textContent='项目中心';center.target='_blank';center.rel='noopener';center.href='/api/team-release/center';}
 const team=document.createElement('a');team.addEventListener('click',()=>{team.href=teamDashboardUrl(location.href);});team.id='team-shortcut';team.className='team-status';team.href='/team-dashboard.html';team.target='_blank';team.rel='noopener';team.textContent='团队 · 连接中';team.title='查看同事、版本、当前项目和任务';nav.append(library,center,team);
 const spacer=header.querySelector('.top-spacer');if(spacer)nav.after(spacer);
 mountTeamComms({host:nav});
 let reporting=false;
 async function activity(){if(reporting)return;reporting=true;try{const p=getProject(),page=getPage();let stage=document.body.classList.contains('repair-workspace-active')?'repair':'layout';if(document.querySelector('#teamwork-dialog[open] [data-team-tab="review"][aria-pressed="true"]'))stage='review';if(document.body.classList.contains('asset-workspace-open'))stage='assets';await fetch('/api/team-release/activity',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({projectId:p?.id||'',pageId:page?.id||'',stage:p?stage:'idle'}),signal:AbortSignal.timeout(3000)});}catch{}finally{reporting=false;}}
 async function refresh(){try{const r=await fetch('/api/team-release/team',{signal:AbortSignal.timeout(7000)});if(!r.ok)throw Error();const s=await r.json();team.textContent='团队 · '+s.online+' 在线';team.dataset.connection='online';team.title='在线 '+s.online+' 台 · 已登记 '+s.registered+' 位同事，点击查看详情';if(center.tagName==='A')center.href='/project-center.html';}catch{team.textContent='团队 · 未连接';team.dataset.connection='offline';team.title='团队中心暂时不可达，点击查看连接说明';}}
 window.addEventListener('production-activity',()=>void activity());document.addEventListener('visibilitychange',()=>void activity());activity();refresh();setInterval(activity,10000);setInterval(refresh,15000);
 return {activity,refresh};
}
