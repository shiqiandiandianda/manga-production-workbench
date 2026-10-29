import {missingEpisodePages} from './project-episode-classification.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function mountProjectSyncSetup({api,getProject,flushSave,modal,closeModal,toast,assignEpisodes}){
 let uploading=false;
 return {async open(){
  if(uploading){toast('工程正在上传，请等待当前上传结果');return;}
  await flushSave();const project=getProject();if(!project)return;
  const {items:projects=[]}=await api('/api/library/projects');
  if(getProject()?.id!==project.id)return;
  let status,progress,message,elapsed,host,submit,cancel,controls=[],timer,started=0,busy=false,outcome='idle';
  const active=()=>status?.isConnected;
  const paint=(state,text)=>{outcome=state;if(!active())return;status.hidden=false;status.dataset.syncState=state;status.setAttribute('aria-busy',String(state==='busy'));progress.hidden=state!=='busy';message.textContent=text;};
  const checkProject=()=>{if(getProject()?.id!==project.id)throw Error('工程已切换，请返回原工程重新上传');};
  const setBusy=value=>{busy=value;uploading=value;if(active()){for(const control of controls)control.disabled=value;if(submit)submit.textContent=value?'上传处理中…':outcome==='success'?'已上传':outcome==='error'?'重试上传':outcome==='pending'?'重新检查并上传':'保存并上传';if(cancel)cancel.textContent=outcome==='success'?'完成':'关闭';if(submit&&outcome==='success')submit.disabled=true;}};
  const run=async()=>{
   if(busy||outcome==='success')return;checkProject();
   const remoteProjectId=host.querySelector('[data-sync-project]').value;
   if(!remoteProjectId){paint('error','请选择墨库项目');return;}
   const entries=Object.fromEntries([...host.querySelectorAll('[data-sync-episode]')].map(n=>[n.dataset.syncEpisode,n.value]));
   started=Date.now();paint('busy','1 / 3 · 正在保存本机工程…');setBusy(true);elapsed.textContent='已用时 0 秒';timer=setInterval(()=>{if(active())elapsed.textContent='已用时 '+Math.floor((Date.now()-started)/1000)+' 秒';},1000);
   try{
    if(Object.keys(entries).length)await assignEpisodes(entries);await flushSave();checkProject();
    paint('busy','2 / 3 · 正在保存墨库项目归属…');
    await api('/api/project-sync/link','POST',{projectId:project.id,remoteProjectId,classification:{characterIds:[],sceneIds:[]}});checkProject();
    paint('busy','3 / 3 · 正在打包并上传工程和图片，请等待墨库确认…');
    const result=await api('/api/project-sync/push','POST',{projectId:project.id});
    if(result.status==='synced'||result.status==='unchanged'){
     const text=result.status==='unchanged'?'上传成功：墨库已有最新工程快照。':'上传成功：工程已保存到墨库'+(result.target?.name?'「'+result.target.name+'」':'')+'。';
     paint('success',text+(result.warning?' 提示：'+result.warning:''));toast(result.status==='unchanged'?'墨库已有最新工程快照':'工程已上传墨库');
    }else if(result.status==='generating')paint('pending','本机已保存，上传暂缓：当前工程仍在生成，生成结束后会继续同步。');
    else if(result.status==='formal-only')paint('pending','本机已保存，尚未上传正式版本。请在“本话版本”中提交正式版本。');
    else throw Error(result.state?.error||result.message||'尚未收到墨库上传成功确认，请重试或检查同步状态');
   }catch(error){paint('error','保存或上传失败：'+(error.message||'未知错误')+'。请处理原因后点击“重试上传”。');toast('保存或上传失败：'+(error.message||'未知错误'),true);}
   finally{clearInterval(timer);if(active())elapsed.textContent='用时 '+Math.max(1,Math.round((Date.now()-started)/1000))+' 秒';setBusy(false);}
  };
  modal('墨库工程归属','<label>墨库项目<select data-sync-project><option value="">请选择项目</option>'+projects.map(p=>'<option value="'+esc(p.id)+'">'+esc(p.name)+'</option>').join('')+'</select></label>'+missingEpisodePages(project).map(p=>'<label>'+esc(p.name||'画板')+' · 话号<input data-sync-episode="'+esc(p.id)+'" inputmode="numeric" placeholder="如 31"></label>').join('')+'<section class="sync-upload-status" data-sync-status hidden role="status" aria-live="polite" aria-atomic="true"><p data-sync-message></p><progress data-sync-progress aria-label="工程上传处理中" hidden></progress><small data-sync-elapsed></small></section>',[
   {label:'取消',run:()=>{if(!busy)closeModal();}},
   {label:'保存并上传',primary:true,run}
  ]);
  status=document.querySelector('[data-sync-status]');host=status.closest('#modal')||status.parentElement;progress=status.querySelector('[data-sync-progress]');message=status.querySelector('[data-sync-message]');elapsed=status.querySelector('[data-sync-elapsed]');controls=[...host.querySelectorAll('button,select,input')];const buttons=[...host.querySelectorAll('button')];submit=buttons.at(-1);cancel=buttons.at(-2);
  const preventClose=event=>{if(busy)event.preventDefault();};host.addEventListener('cancel',preventClose);host.addEventListener('close',()=>host.removeEventListener('cancel',preventClose),{once:true});
 }};
}
