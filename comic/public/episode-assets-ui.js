import {episodeAssetOverview} from './episode-assets.js';
import {assetUrl} from './asset-url.js';
const roles={character:'人物',scene:'场景',prop:'道具',other:'补充参考'},esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function mountEpisodeAssets({getProject,getPage,getAssets,selectPanel,chooseReferences,modal,closeModal,openLibrary}){
 const shell=document.querySelector('#references-tab'),host=document.createElement('section');host.id='episode-assets';shell.prepend(host);let filter='all',query='',stamp='',overview={items:[]};
 function grid(){return overview.items.filter(i=>(filter==='all'||i.role===filter)&&[i.name,i.state].join(' ').includes(query)).map(i=>{const ids=i.assetIds.length?i.assetIds:i.availableIds,id=ids[0];return `<article class="episode-asset-card ${i.status}" data-episode-asset="${esc(i.key)}"><button type="button" class="episode-asset-thumb" data-episode-preview="${esc(i.key)}" ${id?'':'disabled'}>${id?`<img loading="lazy" src="/api/assets/${encodeURIComponent(id)}/thumbnail" alt="${esc(i.name)}">`:'<span>缺图</span>'}<small>${i.status==='ready'?'已使用':i.status==='available'?'待采用':'待补齐'}${ids.length>1?' · '+ids.length+' 版':''}</small></button><strong title="${esc(i.name)}">${esc(i.name)}</strong><span>${esc(i.state||roles[i.role]||'参考')}</span><footer><button type="button" data-episode-locate="${esc(i.key)}" title="${esc(i.uses.map(u=>u.code).join('、'))}">${i.uses.length} 处使用</button><button type="button" data-episode-choose="${esc(i.key)}">${id?'换图':'选图'}</button></footer></article>`;}).join('')||'<p class="sub-note">本话尚未定义人物、场景或道具需求。</p>';}
 function paint(){host.innerHTML=`<header class="episode-assets-heading"><strong>第 ${overview.episode} 话资产</strong><button type="button" data-episode-expand>展开总览</button></header><p class="sub-note">${overview.items.length} 项需求 · ${overview.missing} 项缺图</p><input type="search" data-episode-query placeholder="搜索本话人物、场景、道具" value="${esc(query)}"><nav class="episode-asset-filters">${[['all','全部'],...Object.entries(roles).filter(([r])=>r!=='other')].map(([r,n])=>`<button type="button" data-episode-filter="${r}" aria-pressed="${filter===r}">${n}</button>`).join('')}</nav><div class="episode-assets-grid">${grid()}</div><button type="button" class="wide" data-episode-cloud>从墨库添加其他素材</button>`;}
 function refresh(force=false){const p=getProject(),key=JSON.stringify([p?.id,p?.revision,getPage()?.id,p?.productionPackage?.hash,p?.pages.map(page=>page.panels.map(f=>[f.id,f.referenceIds,f.referenceNeedBindings])),getAssets().length]);if(!force&&key===stamp)return;stamp=key;overview=episodeAssetOverview(p,getPage(),getAssets());paint();}
 function item(key){return overview.items.find(i=>i.key===key);}
 function showOverview(position={}){
  modal('第 '+overview.episode+' 话资产总览',`<div class="episode-assets-expanded"><p>本话 ${overview.items.length} 项需求 · ${overview.missing} 项缺图</p><div class="episode-assets-grid">${grid()}</div></div>`,[{label:'关闭',run:closeModal}]);
  const root=document.querySelector('.episode-assets-expanded');root.onclick=handle;
  root.closest('dialog').scrollTop=position.scrollTop||0;root.parentElement.scrollTop=position.bodyScrollTop||0;
 }
 function returnToOverview(context){
  if(!context)return;
  context.dialog.addEventListener('close',()=>{
   if(context.dialog.open||getProject()?.id!==context.projectId)return;
   refresh(true);if(overview.episode===context.episode)showOverview(context);
  },{once:true});
 }
 function handle(event){
  const b=event.target.closest('button');if(!b)return;
  const key=b.dataset.episodePreview||b.dataset.episodeLocate||b.dataset.episodeChoose,i=item(key);
  if(b.hasAttribute('data-episode-expand')){refresh(true);showOverview();return;}
  if(b.dataset.episodeFilter){filter=b.dataset.episodeFilter;paint();return;}
  if(b.hasAttribute('data-episode-cloud')){openLibrary();return;}if(!i)return;
  const expanded=b.closest('.episode-assets-expanded'),dialog=expanded?.closest('dialog');
  const context=expanded?{dialog,projectId:getProject()?.id,episode:overview.episode,scrollTop:dialog.scrollTop,bodyScrollTop:expanded.parentElement.scrollTop}:null;
  if(b.hasAttribute('data-episode-preview')){
   const ids=i.assetIds.length?i.assetIds:i.availableIds;
   modal(i.name+' · '+(roles[i.role]||'参考'),`<section class="episode-asset-preview">${ids.map(id=>`<img src="${assetUrl(id)}" alt="${esc(i.name)}">`).join('')}<p>${esc(i.state||'')}</p><p>用于：${esc(i.uses.map(u=>u.code).join('、'))}</p></section>`,[{label:'关闭',run:closeModal}]);
   returnToOverview(context);return;
  }
  // Keep the existing dialog open while replacing the overview with its picker.
  // Its next close then belongs to the picker, including Escape and the top X.
  if(!context||!b.hasAttribute('data-episode-choose'))closeModal();
  const use=i.uses[0];selectPanel(use.panelId);
  if(b.hasAttribute('data-episode-choose')){chooseReferences({id:use.needId,name:i.name,role:i.role,state:i.state});if(document.querySelector('.panel-reference-picker'))returnToOverview(context);}
 }
 host.onclick=handle;host.oninput=event=>{if(event.target.hasAttribute('data-episode-query')){query=event.target.value;host.querySelector('.episode-assets-grid').innerHTML=grid();}};
 return {refresh,open(){host.hidden=false;shell.querySelector('#moku-library-browser').hidden=true;refresh();},get overview(){return overview;}};
}
