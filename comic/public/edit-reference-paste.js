const types=['image/png','image/jpeg','image/webp'];
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const editReferenceMarkup='<div class="edit-reference-paste" tabindex="0" aria-label="修改参考图片"><button type="button" data-edit-reference-paste>粘贴参考图</button><small>在修改意见中按 Ctrl+V 粘贴图片，最多 4 张</small><div data-edit-reference-list></div></div>';

export function mountEditReferencePaste({root,api,target,isBusy,refresh,toast}){
 const pending=new Set(),key=t=>'comic-edit-references:'+t.p.id+':'+t.panel.id;
 const list=(t=target())=>{if(!t)return [];try{const value=JSON.parse(localStorage.getItem(key(t))||'[]');return Array.isArray(value)?value.filter(a=>typeof a.id==='string').slice(0,4):[];}catch{return [];}};
 const busy=(t=target())=>!!t&&pending.has(key(t));
 function paint(){const t=target(),host=root.querySelector('.edit-reference-paste');if(!host||!t)return;const items=list(t),disabled=isBusy(t)||busy(t)||t.panel.locked||t.p.pages.find(p=>p.panels.includes(t.panel))?.locked;
  host.querySelector('[data-edit-reference-paste]').disabled=disabled||items.length>=4;
  host.querySelector('[data-edit-reference-list]').innerHTML=items.map((a,i)=>`<figure><img src="/assets/${esc(a.id)}" alt="修改参考图 ${i+1}"><figcaption>参考图 ${i+1}</figcaption><button type="button" data-edit-reference-remove="${esc(a.id)}" aria-label="移除参考图 ${i+1}" ${disabled?'disabled':''}>×</button></figure>`).join('');
  host.classList.toggle('uploading',busy(t));
 }
 async function receive(files,t=target()){
  if(!t)throw Error('请先选择画格');if(isBusy(t)||busy(t))throw Error('请等待当前提交或图片粘贴完成');if(t.panel.locked||t.p.pages.find(p=>p.panels.includes(t.panel))?.locked)throw Error('请先解锁画格和画板');
  const accepted=files.filter(f=>types.includes(f?.type));if(!accepted.length)throw Error('剪贴板里没有 PNG、JPEG 或 WebP 图片');if(accepted.length+list(t).length>4)throw Error('修改参考图最多 4 张，请先移除不需要的图片');
  if(accepted.some(f=>!f.size||f.size>20*1024*1024))throw Error('每张修改参考图需小于 20MB 且不能为空');
  pending.add(key(t));refresh();
  try{for(const file of accepted){const dataBase64=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(Error('无法读取剪贴板图片'));reader.readAsDataURL(file);});const {asset}=await api('/api/edit-reference-images','POST',{projectId:t.p.id,name:file.name||'粘贴修改参考图',dataBase64});const items=list(t);items.push({id:asset.id,name:asset.name});localStorage.setItem(key(t),JSON.stringify(items));}toast(target()?.p.id===t.p.id&&target()?.panel.id===t.panel.id?'参考图已加入，会随修改意见一起发送':'参考图已保存到原格子的修改意见中');}
  finally{pending.delete(key(t));refresh();}
 }
 root.addEventListener('paste',event=>{if(!event.target.closest?.('.prompt-rewrite'))return;const files=[...(event.clipboardData?.files||[])].filter(f=>types.includes(f.type));if(!files.length)return;event.preventDefault();event.stopPropagation();void receive(files).catch(e=>toast(e.message,true));});
 root.addEventListener('click',async event=>{const button=event.target.closest('[data-edit-reference-paste],[data-edit-reference-remove]');if(!button||button.disabled)return;const t=target();if(!t)return;try{if(button.dataset.editReferenceRemove){localStorage.setItem(key(t),JSON.stringify(list(t).filter(a=>a.id!==button.dataset.editReferenceRemove)));refresh();return;}if(!navigator.clipboard?.read)throw Error('请在修改意见里按 Ctrl+V 粘贴图片');const items=await navigator.clipboard.read(),files=[];for(const item of items){const type=item.types.find(t=>types.includes(t));if(type)files.push(await item.getType(type));}await receive(files,t);}catch(e){toast(e.name==='NotAllowedError'?'无法读取剪贴板，请在修改意见里按 Ctrl+V 粘贴图片':e.message,true);}});
 return {paint,busy,ids:t=>list(t).map(a=>a.id)};
}
