(()=>{
 const remove=document.createElement('button'),trash=document.createElement('button');remove.id='library-delete-script';remove.textContent='删除本话';remove.className='danger';trash.id='library-deleted-scripts';trash.textContent='已删除';
 document.querySelector('.section-head').append(remove,trash);
 document.querySelector('.section-head').style.flexWrap='wrap';
 const dialog=document.createElement('dialog');dialog.id='scriptLibraryDialog';dialog.style.cssText='width:min(650px,calc(100vw - 32px));max-height:80vh;overflow:auto;border:1px solid #c5d4c7;border-radius:12px;padding:22px';document.body.append(dialog);
 let working=false;
 const originalRenderList=renderList;
 renderList=function(){originalRenderList();remove.hidden=trash.hidden=mode!=='draft';remove.disabled=!script||!currentId||working;};
 function button(text,handler){const b=document.createElement('button');b.textContent=text;b.onclick=handler;return b;}
 function message(text){const p=document.createElement('p');p.textContent=text;dialog.append(p);return p;}
 function heading(text){dialog.replaceChildren();const h=document.createElement('h2');h.textContent=text;dialog.append(h);}
 remove.onclick=()=>{
  if(!script||mode!=='draft')return;
  if(dirty){status('当前布局有未保存修改，请先保存布局，再删除。',true);return;}
  const pendingScript=structuredClone(script),pendingPacket=structuredClone(packet),key=currentId;
  heading('删除这份分镜排版？');message(pendingScript.title+'（'+pendingScript.shots.length+'格）');message('将从排版库列表移除，可在“已删除”中恢复。原漫画工程、图片、学习参考和已完成结果都会保留。');
  const error=message(''),cancel=button('取消',()=>dialog.close()),confirm=button('删除并保留恢复备份',async()=>{
   if(working)return;working=true;confirm.disabled=cancel.disabled=true;
   try{
    if(currentId!==key||dirty)throw Error('当前排版已经变化，请关闭后重新操作');
    await api('/api/script/archive',{id:key,script:pendingScript,packet:pendingPacket});
    currentId=null;ref=script=packet=null;selected=-1;dirty=false;
    await refreshState();render();inspector();$('title').textContent='已从排版库移除';$('subtitle').textContent='可在左侧“已删除”中恢复';status('已删除库内条目并保留恢复备份，原工程和图片未改动。');dialog.close();
   }catch(e){error.textContent=e.message;}finally{working=false;confirm.disabled=cancel.disabled=false;renderList();}
  });confirm.className='danger';dialog.append(cancel,confirm);dialog.showModal();
 };
 trash.onclick=async()=>{
  if(dirty){status('请先保存当前修改，再查看已删除条目。',true);return;}
  heading('已删除的分镜排版');message('仅显示当前作品。恢复后会重新出现在排版库，已有排版结果继续保留。');const list=document.createElement('div'),error=message('');dialog.append(list,button('关闭',()=>dialog.close()));dialog.showModal();
  try{
   const data=await api('/api/script-archive'),entries=data.entries.filter(x=>x.projectId===project);
   if(!entries.length){list.textContent='当前作品没有已删除条目。';return;}
   for(const entry of entries){const row=document.createElement('p'),name=document.createElement('span');name.textContent=entry.title+' ';const restore=button('恢复',async()=>{
    restore.disabled=true;try{await api('/api/script/restore',{id:entry.id});await refreshState();await load(entry.id);status('已恢复这份分镜及已有排版结果。');dialog.close();}catch(e){error.textContent=e.message;restore.disabled=false;}
   });row.append(name,restore);list.append(row);}
  }catch(e){error.textContent=e.message;}
 };
 dialog.addEventListener('cancel',e=>{if(working)e.preventDefault();});
 const timer=setInterval(()=>{if(state){clearInterval(timer);renderList();}},150);
})();
