const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export async function openMokuProject({api,flushSave,getProject,onImported,toast}){
 await flushSave();const current=getProject(),identity=current?.id,revision=current?.revision;
 const dlg=document.createElement('dialog');dlg.className='moku-project-open';
 dlg.innerHTML='<h2>从墨库打开工程</h2><p>按保存版本打开，本机工程保留。</p><label>墨库项目<select data-project><option value="">请选择项目</option></select></label><label>话<select data-episode><option value="all">全部话</option></select></label><label>搜索工程<input data-search type="search" placeholder="工程名称"></label><p data-status role="status">正在读取墨库项目…</p><div data-files></div><button data-more hidden>加载更多</button><button data-close>关闭</button>';
 document.body.append(dlg);dlg.showModal();dlg.addEventListener('close',()=>{epoch++;dlg.remove();});
 const find=s=>dlg.querySelector(s),projects=find('[data-project]'),episodes=find('[data-episode]'),search=find('[data-search]'),status=find('[data-status]'),files=find('[data-files]'),more=find('[data-more]');
 let epoch=0,offset=0,busy=false,timer;find('[data-close]').onclick=()=>dlg.close();
 async function list(reset=true){
  if(!projects.value)return;const ticket=++epoch;if(reset){offset=0;files.replaceChildren();}status.textContent='正在读取工程…';more.hidden=true;
  try{const value=await api('/api/library/assets?'+new URLSearchParams({projectId:projects.value,scopeId:episodes.value,assetKind:'file',assetType:'comic_project',q:search.value.trim(),limit:'40',offset:String(offset)}));if(ticket!==epoch||!dlg.isConnected)return;
   for(const item of value.items||[]){const button=document.createElement('button');button.type='button';button.style.cssText='display:block;width:100%;text-align:left;margin:8px 0;padding:12px';const stamp=item.updatedAt||item.createdAt;button.textContent=item.name+(item.scopeLabel?' · '+item.scopeLabel:'')+(stamp?' · '+new Date(stamp).toLocaleString():'');button.dataset.openEngineering=item.id;button.onclick=async()=>{
    if(busy)return;busy=true;button.disabled=true;status.textContent='正在恢复工程和固定版本原件，请稍候…';
    try{const id=item.recommendedRevisionId||item.currentRevision?.id; if(!id)throw Error('工程缺少固定文件版本，请在墨库核对');const imported=await api('/api/projects/import','POST',{mokuFile:{projectId:item.projectId,scopeId:item.scopeId||item.episodeId||'project',assetKind:'file',assetType:'comic_project',assetId:item.id,revisionId:id}});
     const activate=getProject()?.id===identity&&getProject()?.revision===revision&&dlg.isConnected&&ticket===epoch;
     await onImported(imported,{activate});if(activate&&dlg.isConnected)dlg.close();else if(dlg.isConnected)status.textContent='此前所选工程已恢复到本机列表，当前选择保留。';toast(activate?'墨库工程和原件已恢复':'工程已恢复到本机列表；当前正在编辑的工程保留');
    }catch(error){if(dlg.isConnected&&ticket===epoch)status.textContent='打开失败：'+error.message;else toast('此前所选工程打开失败：'+error.message,true);}finally{busy=false;button.disabled=false;}
   };files.append(button);}
   offset+=(value.items||[]).length;more.hidden=!value.more;status.textContent=offset?'选择工程即可打开，原图按固定版本下载。':'这一范围没有漫画工程。';
  }catch(error){if(ticket===epoch&&dlg.isConnected)status.textContent='读取失败：'+error.message;}
 }
 projects.onchange=async()=>{const ticket=++epoch;files.replaceChildren();episodes.innerHTML='<option value="all">全部话</option>';if(!projects.value)return;try{const value=await api('/api/library/projects/'+projects.value+'/episodes');if(ticket!==epoch||!dlg.isConnected)return;episodes.innerHTML+=[...(value.items||[])].filter(e=>!e.deletedAt).map(e=>'<option value="'+esc(e.id)+'">'+esc(e.name)+'</option>').join('');await list();}catch(error){if(ticket===epoch)status.textContent=error.message;}};
 episodes.onchange=()=>list();search.oninput=()=>{clearTimeout(timer);timer=setTimeout(()=>list(),250);};more.onclick=()=>list(false);
 try{const value=await api('/api/library/projects');if(dlg.isConnected){projects.innerHTML+=(value.items||[]).filter(p=>!p.deletedAt).map(p=>'<option value="'+esc(p.id)+'">'+esc(p.name)+'</option>').join('');status.textContent='请选择墨库项目。';}}catch(error){if(dlg.isConnected)status.textContent='请先登录墨库：'+error.message;}
 return dlg;
}
