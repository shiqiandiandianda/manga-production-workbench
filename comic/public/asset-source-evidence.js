import {assetNovelSourceDocuments,findAssetNovelDescriptions,assetNovelDescriptionsMarkup} from './asset-novel-descriptions.js';
import {createAsyncCache} from './bounded-cache.js';
import {novelSourceRanges,assetSourcePassagesMarkup} from './asset-source-passages.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const value=v=>typeof v==='string'?v:Array.isArray(v)?v.map(value).filter(Boolean).join('\n'):v?JSON.stringify(v):'';
export function assetPreparationMarkup(row){
 const notes=row.preparationNotes||[];
 return notes.length?`<details class="asset-preparation-note"><summary>资料准备说明</summary>${notes.map(note=>`<p>${esc(note)}</p>`).join('')}</details>`:'';
}

export function assetDesignEvidence(project,row){
 const versions=new Set(row.sources.map(s=>s.assetVersion).filter(Boolean)),found=new Map();
 for(const ledger of project.productionPackage?.ledger||[])for(const asset of ledger.records||[]){
  const key=asset['资产ID']+'/'+asset['版本'];
  if(versions.has(key)||asset['名称']===row.name&&asset['状态说明']===row.state)found.set(key,{version:key,state:asset['状态说明'],basis:value(asset['依据']),source:ledger.file});
 }
 return [...found.values()];
}
export function assetNovelDocuments(project,row){
 const chapters=new Set(row.sources.flatMap(s=>[...String(s.novelLocation||'').matchAll(/第\s*(\d+)\s*章/gu)].map(m=>Number(m[1]))));
 return (project.productionPackage?.manifest||[]).filter(f=>{
  if(!/\.(txt|md)$/iu.test(f.relativePath)||!/(?:原文核对|原著|小说)/u.test(f.relativePath))return false;
  const chapter=/第\s*(\d+)\s*章/u.exec(f.relativePath.split('/').at(-1));return chapter?chapters.has(Number(chapter[1])):chapters.size===0;
 }).slice(0,6);
}
export function originalClothingPassages(text){
 let paragraph=0;return String(text).split(/\r?\n/u).flatMap((line,i)=>{const quote=line.trim();if(!quote)return [];paragraph++;return /长衫|衣衫|衣袍|衣裙|衣裳|衣袖|衣服|长袍|官服|令牌|换装|乔装|甲胄|面具|[黑白青灰红蓝紫黄锦道便儒旅战布](?:色)?(?:衣(?!卫|楼)|袍|衫|服|裙)|身穿|穿着/u.test(quote)?[{line:i+1,paragraph,quote}]:[];});
}
const stateActions=row=>`<div class="asset-evidence-actions"><button class="primary" data-asset-state-confirm="${esc(row.key)}">核对后，按此状态选图</button><button data-asset-state-generate="${esc(row.key)}">核对后，按此状态生成</button></div>`;
export function assetVariantMarkup(project,rows){
 return `<section class="asset-variant-review"><h3>${esc(rows[0]?.name)} · ${rows.length} 种服装 / 状态待核对</h3><p>制作设定，需核对原文。</p>${rows.map((row,i)=>`<article data-asset-variant="${esc(row.key)}"><h4>状态 ${i+1} · ${row.uses.length} 处使用</h4><p class="asset-variant-state">${esc(row.state||'资料未指定服装')}</p>${assetSourcePassagesMarkup(row,{compact:true})}${assetDesignEvidence(project,row).map(e=>`<details><summary>资料方案 ${esc(e.version)} 的依据</summary><p>${esc(e.basis||'未提供直接原文依据')}</p><small>${esc(e.source)}</small></details>`).join('')}<button data-asset-variant-source="${esc(row.key)}">查看本状态的原文与出处</button>${stateActions(row)}</article>`).join('')}</section>`;
}
export function assetSourceMarkup(project,row){
 const design=assetDesignEvidence(project,row),label={character:'人物',scene:'场景',prop:'道具'}[row.role]||'资产';
 return `<section class="asset-source-review"><h4>小说中的${label}描写</h4><div data-asset-novel-descriptions aria-busy="true"><p class="asset-inline-note">正在从小说原件查找对应描写…</p></div>${row.role==='character'?stateActions(row).replaceAll('核对后，',''):''}
 <div class="asset-source-secondary"><details><summary>分镜使用依据 · ${row.sources.length} 处</summary><p class="asset-inline-note">以下是分镜及制作资料，和小说原文分开核对。</p>${assetSourcePassagesMarkup(row)}</details>
 ${design.length?`<details class="asset-design-evidence"><summary>制作设定 · ${design.length} 项</summary><p class="asset-inline-note">制作设定含美术补足，不作为小说原文。</p>${design.map(d=>`<p><b>${esc(d.version)}</b> · ${esc(d.basis||'资料未提供设计依据')}<small>${esc(d.source)}</small></p>`).join('')}</details>`:''}
 <details><summary>画布使用位置 · ${row.uses.length} 处</summary>${row.uses.map(u=>`<p>第${u.episode||'?'}话 · ${esc(u.code)} <button data-asset-locate="${esc(u.panelId)}">定位</button></p>`).join('')}</details></div></section>`;
}

// Load only on opening evidence, and reuse the immutable source snapshot.
export function createAssetSourceReader(){
 const requests=createAsyncCache({name:'asset-original-chapters',maxEntries:12,maxBytes:8*1024*1024,ttl:120000,maxPending:6}),controllers=new Set();let owner='';
 function clear(){for(const controller of controllers)controller.abort();controllers.clear();requests.clear();owner='';}
 async function readSource(url){
  const controller=new AbortController();controllers.add(controller);const timer=setTimeout(()=>controller.abort(),20000);
  try{const r=await fetch(url,{signal:controller.signal});if(!r.ok)throw Error('原著原件暂不可读，请通过文件链接核对');
  const limit=2*1024*1024,large=()=>Error('原件较大，请通过文件链接查看全文');
  if(Number(r.headers.get('content-length'))>limit){await r.body?.cancel();throw large();}
  if(!r.body){const text=await r.text();if(text.length>limit)throw large();return text;}
  const reader=r.body.getReader(),decoder=new TextDecoder(),chunks=[];let bytes=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>limit){await reader.cancel();throw large();}chunks.push(decoder.decode(value,{stream:true}));}chunks.push(decoder.decode());return chunks.join('');}finally{reader.releaseLock();}
  }finally{clearTimeout(timer);controllers.delete(controller);}
 }
 async function loadPassages(project,row,root,isCurrent=()=>true,{compact=false}={}){
  const packageHash=project.productionPackage?.hash||'',nextOwner=project.id+'@'+packageHash;if(owner!==nextOwner){clear();owner=nextOwner;}
  const node=root.matches?.('[data-asset-source-passages]')?root:root.querySelector('[data-asset-source-passages]');if(!node)return;
  const chapters=new Map(),numbers=[...new Set(row.sources.filter(s=>!s.novelQuote).flatMap(novelSourceRanges).map(r=>r.chapter))];
  await Promise.all(numbers.map(async number=>{try{const url='/api/projects/'+encodeURIComponent(project.id)+'/novel-source?chapter='+number;chapters.set(number,await requests.load(nextOwner+':'+url,()=>readSource(url)));}catch{/* Keep the imported storyboard readable if the novel is unavailable. */}}));
  if(!isCurrent()||!node.isConnected||owner!==nextOwner)return;
  const template=document.createElement('template');template.innerHTML=assetSourcePassagesMarkup(row,{compact,chapters});node.replaceWith(template.content.firstElementChild);
 }
 async function load(project,root,isCurrent=()=>true,{role='character'}={}){
  const packageHash=project.productionPackage?.hash||'',nextOwner=project.id+'@'+packageHash;if(owner!==nextOwner){clear();owner=nextOwner;}
  await Promise.all([...root.querySelectorAll('[data-asset-novel-document]')].map(async node=>{
   const path=node.dataset.assetNovelDocument,key=project.id+'@'+packageHash+':'+path,url='/api/projects/'+encodeURIComponent(project.id)+'/production/source?path='+encodeURIComponent(path),host=node.querySelector('[data-asset-novel-passages]');
   try{
    const text=await requests.load(key,()=>readSource(url));if(!isCurrent()||!node.isConnected)return;
    const passages=originalClothingPassages(text);
    const excerpt=role==='character'?`<p class="asset-inline-note">原文服装段落，适用状态待核对。</p>${passages.length?passages.slice(0,20).map(p=>`<blockquote><small>原件第 ${p.line} 行 · 非空段 ${p.paragraph}</small><p>${esc(p.quote)}</p></blockquote>`).join(''):'<p>未检出服装关键词，请核对原文全文。</p>'}`:'<p class="asset-inline-note">原文摘录，需核对对应资产。</p>';
    host.innerHTML=`${excerpt}<details><summary>查看原文全文</summary><pre>${esc(text)}</pre></details>`;
   }catch(error){if(isCurrent()&&node.isConnected)host.textContent=error.message;}
  }));
 }
 async function loadDescriptions(project,row,root,isCurrent=()=>true){
  const nextOwner=project.id+'@'+(project.productionPackage?.hash||'');if(owner!==nextOwner){clear();owner=nextOwner;}
  const node=root.querySelector('[data-asset-novel-descriptions]');if(!node)return;
  const listed=assetNovelSourceDocuments(project,row),queue=listed.slice(0,128),documents=[],failures=[];let index=0,bytes=0;
  const current=()=>isCurrent()&&node.isConnected&&owner===nextOwner;
  async function worker(){while(index<queue.length&&current()&&bytes<16*1024*1024){const document=queue[index++];try{const text=await requests.load(nextOwner+':'+document.url,()=>readSource(document.url));if(!current())return;bytes+=new TextEncoder().encode(text).byteLength;documents.push({...document,text});}catch(error){if(current())failures.push({name:document.name,message:error.message});}}}
  await Promise.all([worker(),worker(),worker()]);if(!current())return;
  const result=findAssetNovelDescriptions(row,documents);node.innerHTML=assetNovelDescriptionsMarkup(project,row,result);
  if(failures.length||index<listed.length){const note=document.createElement('p');note.className='asset-inline-note';note.textContent=(failures.length?failures.length+' 份原件暂不可读。':'')+(index<listed.length?'原件较多，本次已检索 '+documents.length+' 份。':'');node.append(note);}
  node.setAttribute('aria-busy','false');
 }
 return {load,loadPassages,loadDescriptions,clear,stats:()=>requests.stats()};
}
