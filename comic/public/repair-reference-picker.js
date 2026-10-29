const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// A separate top-layer dialog keeps the repair iframe and its selection mounted.
export function mountRepairReferencePicker({api,onPick}){
 const dialog=document.createElement('dialog');dialog.className='repair-reference-picker';dialog.setAttribute('aria-label','墨库参考图');
 dialog.innerHTML='<header><strong>墨库参考图</strong><button data-close aria-label="关闭参考图库">×</button></header><form><select data-scope aria-label="素材库"><option value="public">公共素材库</option></select><input type="search" data-search placeholder="搜索图片" aria-label="搜索图片"><button type="submit">搜索</button></form><p role="status"></p><div data-images></div><footer><button data-prev>上一页</button><span data-page></span><button data-next>下一页</button></footer>';
 document.body.append(dialog);const $=s=>dialog.querySelector(s);let epoch=0,offset=0,items=[],context=null,choosing=false,loading=false;const limit=40;
 const status=text=>$('[role=status]').textContent=text;
 const controls=()=>{for(const el of dialog.querySelectorAll('form input,form select,form button,[data-images] button'))el.disabled=choosing||loading||el.hasAttribute('data-image')&&!items[Number(el.dataset.image)]?.displayRevisionId&&!items[Number(el.dataset.image)]?.recommendedRevisionId;$('[data-prev]').disabled=choosing||loading||offset===0;$('[data-next]').disabled=choosing||loading||items.length<limit;};
 function close(){if(choosing)return;epoch++;dialog.close();}
 $('[data-close]').onclick=close;dialog.addEventListener('cancel',e=>{e.preventDefault();close();});
 async function load(){const ticket=++epoch;loading=true;items=[];$('[data-images]').replaceChildren();status('读取墨库图片…');controls();
  try{const params=new URLSearchParams({projectId:$('[data-scope]').value,kind:'image',groupCharacters:'true',limit:String(limit),offset:String(offset)}),query=$('[data-search]').value.trim();if(query)params.set('q',query);const value=await api('/api/library/assets?'+params);if(ticket!==epoch||!dialog.open)return;items=value.items||[];
   $('[data-images]').innerHTML=items.map((item,index)=>{const rev=item.displayRevisionId||item.recommendedRevisionId;return `<button type="button" data-image="${index}" ${rev?'':'disabled'}><img loading="lazy" src="/api/library/revisions/${encodeURIComponent(rev||'')}/preview/thumb.webp" alt="${esc(item.name)}"><strong title="${esc(item.name)}">${esc(item.name)}</strong><span>使用此图</span></button>`;}).join('');
   for(const img of dialog.querySelectorAll('[data-images] img'))img.onerror=()=>{img.onerror=null;const item=items[Number(img.closest('[data-image]').dataset.image)],rev=item.displayRevisionId||item.recommendedRevisionId;img.src='/api/library/revisions/'+encodeURIComponent(rev)+'/download';};
   status(items.length?'':'没有找到图片');$('[data-page]').textContent='第 '+(offset/limit+1)+' 页';
  }catch(error){if(ticket===epoch)status(error.message);}finally{if(ticket===epoch){loading=false;controls();}}
 }
 $('form').onsubmit=e=>{e.preventDefault();offset=0;void load();};$('[data-scope]').onchange=()=>{offset=0;void load();};$('[data-prev]').onclick=()=>{offset=Math.max(0,offset-limit);void load();};$('[data-next]').onclick=()=>{offset+=limit;void load();};
 $('[data-images]').onclick=async e=>{const button=e.target.closest('[data-image]');if(!button||choosing||loading)return;const item=items[Number(button.dataset.image)],revisionId=item?.displayRevisionId||item?.recommendedRevisionId;if(!revisionId)return;choosing=true;controls();status('正在加入参考图…');
  try{const result=await api('/api/library/import','POST',{assetId:item.id,revisionId});if(!result.asset)throw Error('这项素材不是可用图片');await onPick(result.asset,context);choosing=false;close();}catch(error){status(error.message);}finally{choosing=false;controls();}
 };
 return {async open(value){if(choosing)return;context=value;offset=0;items=[];$('[data-images]').replaceChildren();$('[data-page]').textContent='';dialog.showModal();const ticket=++epoch;loading=true;controls();status('连接墨库…');try{const state=await api('/api/library/status');if(ticket!==epoch||!dialog.open)return;if(!state.connected)throw Error(state.error||'墨库未连接，请先在主界面连接墨库');const projects=await api('/api/library/projects');if(ticket!==epoch||!dialog.open)return;const selected=$('[data-scope]').value;$('[data-scope]').innerHTML='<option value="public">公共素材库</option>'+(projects.items||[]).map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');if([...$('[data-scope]').options].some(o=>o.value===selected))$('[data-scope]').value=selected;await load();}catch(error){if(ticket===epoch){loading=false;status(error.message);controls();}}},close};
}
