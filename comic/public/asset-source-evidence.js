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
 const docs=assetNovelDocuments(project,row),design=assetDesignEvidence(project,row);
 const character=row.role==='character';
 return `<section class="asset-source-review"><h3>${esc(row.name)} · ${character?'服装 / 状态核对':'资料出处'}</h3><p class="asset-variant-state">${esc(row.state||'资料未指定')}</p><p class="asset-inline-warning">制作方案待核对。</p>${character?stateActions(row):''}
 ${assetSourcePassagesMarkup(row)}<details class="asset-original-documents"><summary>查看随包小说原件</summary>${docs.length?docs.map(d=>`<article data-asset-novel-document="${esc(d.relativePath)}"><a target="_blank" rel="noopener" href="/api/projects/${encodeURIComponent(project.id)}/production/source?path=${encodeURIComponent(d.relativePath)}">${esc(d.relativePath)}</a><div data-asset-novel-passages>正在读取原文原件…</div></article>`).join(''):'<p>工程未附带小说正文，以上显示导入资料中提供的内容。</p>'}</details>
 ${design.map(d=>`<details class="asset-design-evidence"><summary>资料方案：${esc(d.version)}（含美术补足）</summary><p>${esc(d.basis||'资料未提供设计依据')}</p><small>${esc(d.source)}</small></details>`).join('')}
 <details><summary>在画布中定位使用位置</summary>${row.sources.map(s=>`<p>第${s.episode||'?'}话 · ${esc(s.code)} <button data-asset-locate="${esc(s.panelId)}">定位</button></p>`).join('')}</details></section>`;
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
  await Promise.all(numbers.map(async number=>{try{const url='/api/projects/'+encodeURIComponent(project.id)+'/novel-source?chapter='+number;chapters.set(number,await requests.load(nextOwner+':chapter:'+number,()=>readSource(url)));}catch{/* Keep the imported storyboard readable if the novel is unavailable. */}}));
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
 return {load,loadPassages,clear,stats:()=>requests.stats()};
}
