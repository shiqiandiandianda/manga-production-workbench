/** Histories are requested only when expanded; saved projects keep fixed IDs. */
export function attachLibraryVersionHistory(dialog,{api,assetId,value}){
 const select=dialog.querySelector('[data-version]');
 if(!Number.isInteger(value.versionCount)||value.versionCount<=(value.revisions||[]).length)return;
 const button=document.createElement('button'),status=document.createElement('span');
 button.type='button';button.textContent='展开历史版本';button.dataset.moreVersions='';status.setAttribute('role','status');select.closest('label').after(button,status);
 let cursor=null,closed=false;dialog.addEventListener('close',()=>{closed=true;});
 button.onclick=async()=>{
  if(button.disabled||closed)return;button.disabled=true;status.textContent='读取版本…';
  try{
   const page=await api('/api/library/assets/'+encodeURIComponent(assetId)+'/revisions?limit=50'+(cursor?'&cursor='+encodeURIComponent(cursor):''));
   if(closed)return;
   const known=new Set([...select.options].map(o=>o.value));
   for(const revision of page.items||[]){if(known.has(revision.id))continue;const option=document.createElement('option');option.value=revision.id;option.textContent=(revision.originalName||value.name)+' · '+(revision.createdAt||'')+' · v'+revision.versionNumber;select.append(option);known.add(revision.id);}
   cursor=page.nextCursor||null;button.hidden=!cursor;button.textContent='加载更多版本';status.textContent='已加载 '+select.options.length+' 个版本';
  }catch(error){if(!closed)status.textContent=error.message;}finally{button.disabled=false;}
 };
}
