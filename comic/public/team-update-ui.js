import {localUpdateUrl} from './workbench-update-navigation.mjs';
let controlUrl=null,installed=false,notice,managed=null;
function unmanagedNotice(){
 let d=document.querySelector('#local-update-mode-dialog');if(!d){d=document.createElement('dialog');d.id='local-update-mode-dialog';d.setAttribute('aria-label','本机修订版更新说明');const h=document.createElement('h2');h.textContent='本机修订版';const p=document.createElement('p');p.textContent='当前工作台通过独立启动器运行，未接入自动更新管理器。编辑、墨库和 Codex 连接可以继续使用。';const note=document.createElement('p');note.textContent='此副本包含本地修订。团队升级前需先打包并核对这些改动，避免被其他版本覆盖。';const b=document.createElement('button');b.textContent='关闭';b.onclick=()=>d.close();d.append(h,p,note,b);document.body.append(d);}if(!d.open)d.showModal();
}
function showUnmanaged(){managed=false;controlUrl=null;if(notice){notice.textContent='本机修订版';notice.title='独立启动，未启用自动更新管理器；点击查看说明';notice.style.background='#9acefa';}}

function openUpdate(){
 if(managed===false){unmanagedNotice();return;}
 if(controlUrl){window.open(localUpdateUrl(controlUrl,location.href),'comic-team-update-'+location.port);return;}
 // Reserve the new tab during the click so a delayed health response is not blocked.
 const target=window.open('about:blank','comic-team-update-'+location.port);
 fetch('/api/health').then(r=>r.json()).then(health=>{controlUrl=health.teamControlUrl;if(!controlUrl){target?.close();showUnmanaged();unmanagedNotice();return;}const url=localUpdateUrl(controlUrl,location.href);if(target)target.location.href=url;else location.href=url;}).catch(()=>{target?.close();if(notice){notice.textContent='更新服务暂未就绪';notice.title='请确认本版启动器正在运行后重试';}});
}
function mount(){
 const menu=document.querySelector('#project-tools-menu .workbench-menu-panel'),group=document.querySelector('#project-tools-menu');if(!menu||!group||installed)return;
 installed=true;const button=document.createElement('button');button.type='button';button.textContent='检查更新 / 安全升级';button.addEventListener('click',openUpdate);menu.append(button);
 notice=document.createElement('button');notice.id='team-update-notice';notice.type='button';notice.textContent='检查更新 / 升级';notice.title='打开当前工作台的本机更新页；自动检查保持开启';notice.style.cssText='background:#9acefa;color:#192b3a;border:0;border-radius:6px;padding:8px 12px;white-space:nowrap';notice.addEventListener('click',openUpdate);group.parentNode.insertBefore(notice,group);observer.disconnect();
}
const observer=new MutationObserver(mount);observer.observe(document.body,{childList:true,subtree:true});mount();
async function refresh(){try{
 const r=await fetch('/api/team-release/status',{signal:AbortSignal.timeout(4000),cache:'no-store'});if(!r.ok)throw Error();const status=await r.json();if(status.managed===false){showUnmanaged();return;}if(!status.controlUrl)throw Error();managed=true;localUpdateUrl(status.controlUrl,location.href);controlUrl=status.controlUrl;
 if(!notice)return;const current=status.current||'待核对';notice.textContent=status.role==='publisher'?(status.available?'主机新版 · 启用':'主机 · '+current.replace(/^\d{4}-\d{2}-\d{2} /,'')):status.available?'收到新版 · 升级':'检查更新 · '+current.replace(/^\d{4}-\d{2}-\d{2} /,'');notice.style.background=status.available?'#e9c879':'#9acefa';notice.title='当前工作台：'+current+'；主机：'+(status.latest||'待连接')+'。自动检查已开启，点击进入本机检查与安全升级。';
 }catch{if(notice){notice.textContent='更新服务连接失败 · 重试';notice.title='已配置的更新管理器暂不可达；点击重试，不影响继续制作';}}}
void refresh();setInterval(()=>void refresh(),20000);
