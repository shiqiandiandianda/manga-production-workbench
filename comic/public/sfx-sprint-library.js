const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export async function sprintRequest(url,options={},decode='json',{timeout=6000,fetcher=globalThis.fetch}={}){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);
 try{const response=await fetcher(url,{...options,signal:controller.signal});if(!response.ok){let error;try{error=(await response.json()).error;}catch{}throw new Error(error||'资源请求失败（'+response.status+'）');}return await response[decode]();}
 catch(error){if(error.name==='AbortError')throw new Error('读取超时，请检查共享盘连接后重试');throw error;}
 finally{clearTimeout(timer);}
}
export function mountSprintLibrary(host,{addImage,getProject,configUrl='/sfx-sprints.json'}={}){
 const details=document.createElement('details');details.id='sfx-sprint-library';details.innerHTML='<summary>冲刺线 · 图片图层</summary><p>点击“加入画板”添加独立图片层。仅引用本地路径，不复制原图。</p><div class="sfx-sprint-list"></div><p class="sfx-sprint-status" role="status"></p>';host.append(details);if(host.querySelector('#sfx-custom'))host.insertBefore(details,host.querySelector('#sfx-custom'));
 const style=document.createElement('style');style.textContent='.sfx-sprint-list{display:grid;grid-template-columns:1fr 1fr;gap:8px}.sfx-sprint-card{border:1px solid #ccd6e0;padding:6px;border-radius:6px}.sfx-sprint-card img{display:block;object-fit:contain;width:100%;height:96px;background:repeating-conic-gradient(#eee 0% 25%,#fff 0% 50%) 0/16px 16px}.sfx-sprint-card strong{display:block;font-size:12px}.sfx-sprint-card small{display:block;font-size:11px;overflow-wrap:anywhere;color:#56687c}.sfx-sprint-card button{width:100%;margin-top:6px}.sfx-sprint-status{overflow-wrap:anywhere}';host.ownerDocument.head.append(style);
 let started=false,observer,serial=Promise.resolve(),unavailable=false;const states=new Map(),status=details.querySelector('.sfx-sprint-status');
 const prepare=(state,{preview=true,manual=false}={})=>{
  if(state.promise)return state.promise;
  state.promise=serial.then(async()=>{
   const {item,card}=state,small=card.querySelector('small');small.textContent='正在读取本地路径…';
   try{
    if(unavailable&&!manual)throw new Error('共享盘读取失败，请点击重试预览');
    state.asset||=await sprintRequest('/api/assets',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({filePath:item.filePath,name:'冲刺线 · '+item.label})});
    if(preview&&!state.url){const blob=await sprintRequest('/assets/'+state.asset.id,{},'blob');state.url=URL.createObjectURL(blob);const img=card.querySelector('img');img.onerror=()=>{small.textContent='预览无法解码，请检查源文件';};img.src=state.url;}
    unavailable=false;small.textContent=state.asset.width+' × '+state.asset.height;card.querySelector('[data-sprint-retry]').hidden=true;return state.asset;
   }catch(error){unavailable=true;small.textContent='资源不可用：'+error.message;card.querySelector('[data-sprint-retry]').hidden=false;status.textContent='部分冲刺线资源不可用；请检查源文件或共享盘连接，随后点击重试。';throw error;}
  }).finally(()=>state.promise=null);serial=state.promise.catch(()=>{});return state.promise;
 };
 const start=async()=>{if(started)return;started=true;status.textContent='正在读取资源路径配置…';try{
  const config=await sprintRequest(configUrl);if(config.version!==1||!Array.isArray(config.items)||config.items.length>30)throw new Error('冲刺线配置格式无效');
  details.querySelector('.sfx-sprint-list').innerHTML=config.items.map(item=>`<article class="sfx-sprint-card" data-sprint-id="${escape(item.id)}"><img loading="lazy" decoding="async" alt="${escape(item.label)}"><strong>${escape(item.label)}</strong><small>尚未预览</small><button type="button" data-sprint-add>加入画板</button><button type="button" data-sprint-retry hidden>重试预览</button></article>`).join('');
  for(const item of config.items){if(typeof item.filePath!=='string'||!item.id||!item.label)throw new Error('资源路径配置缺失');const card=details.querySelector('[data-sprint-id="'+CSS.escape(item.id)+'"]');states.set(item.id,{item,card});}
  observer=new IntersectionObserver(entries=>{for(const entry of entries)if(entry.isIntersecting){observer.unobserve(entry.target);const state=states.get(entry.target.dataset.sprintId);void prepare(state).catch(()=>{});}},{root:host,rootMargin:'80px'});for(const state of states.values())observer.observe(state.card);status.textContent='共 '+states.size+' 张透明冲刺线；盘符变化请修改 sfx-sprints.json。';
 }catch(error){started=false;status.textContent='字库资源不可用：'+error.message+'；关闭后重新打开可重试。';}};
 details.addEventListener('toggle',()=>{if(details.open)void start();});
 details.addEventListener('click',async event=>{const button=event.target.closest('[data-sprint-add],[data-sprint-retry]');if(!button)return;const state=states.get(button.closest('[data-sprint-id]').dataset.sprintId),projectId=getProject()?.id;if(!projectId)return;button.disabled=true;status.textContent='正在读取 '+state.item.label+'，共享盘异常时会提示…';try{const asset=await prepare(state,{manual:true});if(button.hasAttribute('data-sprint-retry'))return;if(getProject()?.id!==projectId)throw new Error('工程已切换，请重新点选添加');await addImage(asset,state.item);status.textContent='已添加 '+state.item.label+'，可重复添加、独立移动缩放旋转。';}catch(error){status.textContent='未添加：'+error.message;}finally{button.disabled=false;}});
 return {destroy(){observer?.disconnect();for(const state of states.values())if(state.url)URL.revokeObjectURL(state.url);details.remove();style.remove();}};
}
