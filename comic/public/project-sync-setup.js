import {missingEpisodePages} from './project-episode-classification.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function mountProjectSyncSetup({api,getProject,flushSave,modal,closeModal,toast,assignEpisodes}){
 return {async open(){
  await flushSave();const project=getProject();if(!project)return;
  const {items:projects=[]}=await api('/api/library/projects');let subjects=[],epoch=0;
  modal('墨库工程归属','<label>墨库项目<select data-sync-project><option value="">请选择项目</option>'+projects.map(p=>'<option value="'+esc(p.id)+'">'+esc(p.name)+'</option>').join('')+'</select></label>'+missingEpisodePages(project).map(p=>'<label>'+esc(p.name||'画板')+' · 话号<input data-sync-episode="'+esc(p.id)+'" inputmode="numeric" placeholder="如 31"></label>').join('')+'<p>选择本工程使用的角色或场景</p><div data-sync-subjects></div>',[
   {label:'取消',run:closeModal},
   {label:'保存并上传',primary:true,run:async()=>{
    if(getProject()?.id!==project.id)throw Error('工程已切换，请重新打开设置');
    const remoteProjectId=document.querySelector('[data-sync-project]').value,ids=[...document.querySelectorAll('[data-sync-subject]:checked')].map(n=>n.value);
    if(!remoteProjectId||!ids.length)throw Error('请选择墨库项目及至少一个角色或场景');
    const entries=Object.fromEntries([...document.querySelectorAll('[data-sync-episode]')].map(n=>[n.dataset.syncEpisode,n.value]));
    if(Object.keys(entries).length)await assignEpisodes(entries);await flushSave();
    await api('/api/project-sync/link','POST',{projectId:project.id,remoteProjectId,classification:{characterIds:ids.filter(id=>subjects.some(s=>s.id===id&&s.kind==='character')),sceneIds:ids.filter(id=>subjects.some(s=>s.id===id&&s.kind==='scene'))}});
    await api('/api/project-sync/push','POST',{projectId:project.id});closeModal();toast('工程已上传墨库');
   }}]);
  const select=document.querySelector('[data-sync-project]'),host=document.querySelector('[data-sync-subjects]');
  select.onchange=async()=>{const ticket=++epoch;subjects=[];host.textContent='';if(!select.value)return;host.textContent='正在读取…';try{
   const value=await api('/api/project-sync/subjects?remoteProjectId='+encodeURIComponent(select.value));if(ticket!==epoch)return;subjects=value.items||[];
   host.innerHTML=subjects.filter(s=>['character','scene'].includes(s.kind)).map(s=>'<label><input type="checkbox" data-sync-subject value="'+esc(s.id)+'">'+esc(s.name)+'</label>').join('')||'该项目暂无角色或场景，请先在墨库添加。';
  }catch(error){if(ticket===epoch)host.textContent=error.message;}};
 }};
}
