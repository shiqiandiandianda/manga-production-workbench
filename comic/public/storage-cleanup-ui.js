const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const size=n=>n>=1024*1024*1024?(n/(1024*1024*1024)).toFixed(2)+' GB':(n/(1024*1024)).toFixed(1)+' MB';
export function mountStorageCleanup({api,getProject,isDirty,flushSave,modal,closeModal,toast,clientId}){
 const button=document.querySelector('#storage-cleanup');let polling=null,opened=false,rendering=false;
 async function activity(){try{await api('/api/storage-maintenance/activity','POST',{clientId,projectId:getProject()?.id||'',dirty:isDirty()});}catch{}}
 const heartbeat=setInterval(activity,30000);window.addEventListener('focus',activity);window.addEventListener('pagehide',()=>{clearInterval(heartbeat);clearInterval(polling);});
 function paint(state){
  const u=state.usage,r=state.run,p=getProject(),row=u?.projects?.find(x=>x.id===p?.id),running=r&&!['done','failed'].includes(r.phase);
  const rows=u?.projects||[];
  const content='<p>制作中每话目标150 MB，达到200 MB检查；已完成归档目标20 MB。全工具业务缓存目标1 GB、上限2 GB。</p>'+
   (u?'<p><strong>业务资料 '+size(u.bytes)+' / 2 GB</strong> · 历史开发副本 '+size(u.developmentBytes)+' · 可检查清理 '+size(u.reclaimableBytes)+'</p>':'')+
   (row?'<p>当前话：<strong>'+size(row.bytes)+'</strong> · '+(row.completed?'已完成归档':'制作中')+' · '+(row.backup?'墨库备份 r'+row.backup.revision+'，已验证':'等待墨库备份')+'</p>':'')+
   '<p>一键清理会先备份到本人可访问的墨库项目，再清理历史残留；正在使用、尚未保存或备份失败的资料会保留。原图按固定版本恢复，模型、账号和运行环境保留。</p>'+
   '<label><input type="checkbox" id="storage-auto" '+(state.enabled?'checked':'')+'> 每5分钟自动检查，空闲时分批清理</label>'+
   (p?'<label><input type="checkbox" id="storage-complete" '+(row?.completed?'checked':'')+'> 本话已完成：备份验证后允许回收本地原图缓存</label>':'')+
   '<p id="storage-cleanup-progress" role="status">'+(r?esc(r.message)+'；已释放 '+size(r.releasedBytes)+'，清理 '+r.removedFiles+' 个文件，无损压缩 '+r.compactedFiles+' 份快照':'尚未开始清理')+'</p>'+
   (r?.protected?.length?'<details open><summary>已保留 '+r.protected.length+' 项需要处理的资料</summary>'+r.protected.map(x=>'<p>'+esc(x.reason)+'</p>').join('')+'</details>':'')+
   '<details><summary>各工程占用</summary>'+rows.map(x=>'<p>'+esc(x.title)+'：'+size(x.bytes)+(x.active?' · 正在使用':'')+(x.backup?' · 已备份':' · 待备份')+'</p>').join('')+'</details>';
  modal('存储管理 · 一键清理',content,[{label:'关闭',run:()=>{opened=false;clearInterval(polling);closeModal();}},{label:running?'正在备份 / 清理…':'一键备份并清理',primary:true,run:async()=>{
   if(running)return;await flushSave();await activity();
   await api('/api/storage-maintenance/settings','POST',{enabled:document.querySelector('#storage-auto').checked});
   const completedProjectId=document.querySelector('#storage-complete')?.checked?getProject()?.id:'';
   const next=await api('/api/storage-maintenance/clean','POST',{completedProjectId});paint(next);toast('清理已开始，先备份墨库并校验，可关闭此窗口继续工作');
  }}]);
  document.querySelector('#storage-auto')?.addEventListener('change',async e=>{await api('/api/storage-maintenance/settings','POST',{enabled:e.target.checked});});
  document.querySelector('#storage-complete')?.addEventListener('change',async e=>{if(!e.target.checked&&p)await api('/api/storage-maintenance/settings','POST',{projectId:p.id,completed:false});});
  const actions=document.querySelector('#modal-actions');if(running&&actions?.lastElementChild)actions.lastElementChild.disabled=true;
 }
 async function refresh(){if(!opened||rendering)return;rendering=true;try{const state=await api('/api/storage-maintenance/status');if(opened&&state.run&&(!['done','failed'].includes(state.run.phase)||!document.querySelector('#storage-cleanup-progress')?.textContent?.startsWith(state.run.message)))paint(state);}catch(e){toast(e.message,true);}finally{rendering=false;}}
 button?.addEventListener('click',async()=>{try{await flushSave();opened=true;await activity();toast('正在检查本机占用和历史残留…');paint(await api('/api/storage-maintenance/scan','POST',{}));clearInterval(polling);polling=setInterval(()=>{if(document.querySelector('#modal-title')?.textContent!=='存储管理 · 一键清理'){opened=false;clearInterval(polling);return;}void refresh();},2000);}catch(e){toast(e.message,true);}});
 return {activity};
}
