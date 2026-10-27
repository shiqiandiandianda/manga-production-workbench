const labels={queued:'等待接收',received:'已收到指令',downloading:'正在下载校验',waiting:'等待本机任务结束',stopping:'正在安全关闭服务',applying:'正在替换代码',restarting:'正在重新启动',completed:'已升级',failed:'升级失败，稍后重试',uncertain:'升级状态待核实',offline:'离线待执行',unsupported:'旧版需先升级一次',superseded:'已由新指令接替'};
const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function mountForcedUpgrades({mode,refresh,message}){
 const button=document.querySelector('#force-upgrade-all'),section=document.createElement('section');section.className='panel forced-upgrades';section.hidden=true;
 section.innerHTML='<div class="section-heading"><div><h2>同事升级进度</h2><p data-force-summary></p></div></div><p class="note">每台电脑独立升级：空闲同事先升级，正在生图的同事继续生成，任务结束后自动升级。不会因某位同事忙碌而阻塞其他电脑。工程、图片和账号保留。</p><p class="force-legacy-note">旧版客户端需先升级一次以接入空闲升级功能；之后可由主机统一操作。离线电脑重新启动工具后接收指令。</p><div class="force-targets"></div>';
 document.querySelector('.metrics').after(section);let state,busy=false,requestId=null;
 button.onclick=async()=>{
  if(busy||!state?.canForceUpgrade)return;busy=true;button.disabled=true;requestId||=crypto.randomUUID();
  try{const response=await fetch(mode==='publisher'?'/api/dashboard/force-upgrade':'/api/team-release/force-upgrade',{method:'POST',headers:{'Content-Type':'application/json','X-Dashboard-Control':state.nameControl},body:JSON.stringify({requestId})}),value=await response.json();if(!response.ok)throw Error(value.error||'强制升级指令未发出');requestId=null;await refresh();message(value.message||'指令已发出，请查看每台电脑的执行回传。');}
  catch(e){message(e.message);}finally{busy=false;button.disabled=false;}
 };
 return {update(value){state=value;button.textContent='一键升级所有同事';button.hidden=!value.canForceUpgrade;button.disabled=busy||!value.latest;section.hidden=!value.canForceUpgrade&&!value.forcedUpgrades?.campaign;
  const c=value.forcedUpgrades?.campaign;section.querySelector('[data-force-summary]').textContent=c?'本次目标 '+c.version+' · '+c.completed+' / '+c.total+' 台已完成 · '+(c.waiting||0)+' 台等待任务结束':'主机可一键要求所有已登记的同事升级到当前发布版本。';
  section.querySelector('.force-targets').innerHTML=c?c.targets.map(t=>'<article class="force-target" data-member-upgrade="'+escape(t.memberId)+'"><div><strong>'+escape(t.name)+'</strong><small>'+escape(t.machine)+'</small></div><span class="pill '+(t.status==='completed'?'current':t.status==='failed'||t.status==='unsupported'?'outdated':'')+'">'+escape(labels[t.status]||'状态待刷新')+'</span><p>'+escape(t.message)+'</p><small>本机 '+escape(t.currentVersion||'尚未上报')+' → '+escape(t.targetVersion)+'</small></article>').join(''):'';
 }};
}
