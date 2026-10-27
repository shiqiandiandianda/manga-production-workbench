import {localUpdateUrl} from './workbench-update-navigation.mjs';
let controlUrl=null,installed=false,notice;
function openUpdate(){
 if(controlUrl){window.open(localUpdateUrl(controlUrl,location.href),'comic-team-update-'+location.port);return;}
 // Reserve the new tab during the click so a delayed health response is not blocked.
 const target=window.open('about:blank','comic-team-update-'+location.port);
 fetch('/api/health').then(r=>r.json()).then(health=>{controlUrl=health.teamControlUrl;const url=localUpdateUrl(controlUrl,location.href);if(target)target.location.href=url;else location.href=url;}).catch(()=>{target?.close();if(notice){notice.textContent='更新服务暂未就绪';notice.title='请确认本版启动器正在运行后重试';}});
}
function mount(){
 const menu=document.querySelector('#project-tools-menu .workbench-menu-panel'),group=document.querySelector('#project-tools-menu');if(!menu||!group||installed)return;
 installed=true;const button=document.createElement('button');button.type='button';button.textContent='检查更新 / 安全升级';button.addEventListener('click',openUpdate);menu.append(button);
 notice=document.createElement('button');notice.id='team-update-notice';notice.type='button';notice.textContent='检查更新 / 升级';notice.title='打开当前工作台的本机更新页；自动检查保持开启';notice.style.cssText='background:#9acefa;color:#192b3a;border:0;border-radius:6px;padding:8px 12px;white-space:nowrap';notice.addEventListener('click',openUpdate);group.parentNode.insertBefore(notice,group);observer.disconnect();
}
const observer=new MutationObserver(mount);observer.observe(document.body,{childList:true,subtree:true});mount();
async function refresh(){try{
 const r=await fetch('/api/team-release/status',{signal:AbortSignal.timeout(4000),cache:'no-store'});if(!r.ok)throw Error();const status=await r.json();if(!status.controlUrl)throw Error();localUpdateUrl(status.controlUrl,location.href);controlUrl=status.controlUrl;
 if(!notice)return;const current=status.current||'待核对';notice.textContent=status.role==='publisher'?(status.available?'主机新版 · 启用':'主机 · '+current.replace(/^\d{4}-\d{2}-\d{2} /,'')):status.available?'收到新版 · 升级':'检查更新 · '+current.replace(/^\d{4}-\d{2}-\d{2} /,'');notice.style.background=status.available?'#e9c879':'#9acefa';notice.title='当前工作台：'+current+'；主机：'+(status.latest||'待连接')+'。自动检查已开启，点击进入本机检查与安全升级。';
 }catch{if(notice)notice.title='更新服务暂不可达；点击重试，不影响继续制作';}}
void refresh();setInterval(()=>void refresh(),20000);
