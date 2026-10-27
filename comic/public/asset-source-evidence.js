import {createAsyncCache} from './bounded-cache.js';
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
 return `<section class="asset-variant-review"><h3>${esc(rows[0]?.name)} · ${rows.length} 种服装 / 状态待核对</h3><p>以下来自制作资料，可能包含美术补足。请比较原文与使用格号，再判断各处采用的状态；已有用图保留。</p>${rows.map((row,i)=>`<article data-asset-variant="${esc(row.key)}"><h4>状态 ${i+1} · ${row.uses.length} 处使用</h4><p class="asset-variant-state">${esc(row.state||'资料未指定服装')}</p><p>出处：${esc([...new Set(row.sources.map(s=>s.novelLocation).filter(Boolean))].join('；')||'资料未提供原著章节')}</p><p>源格：${esc([...new Set(row.sources.map(s=>s.code))].join('、')||row.uses.map(u=>u.code).join('、'))}</p>${assetDesignEvidence(project,row).map(e=>`<details><summary>资料方案 ${esc(e.version)} 的依据</summary><p>${esc(e.basis||'未提供直接原文依据')}</p><small>${esc(e.source)}</small></details>`).join('')}<button data-asset-variant-source="${esc(row.key)}">查看本状态的原文与出处</button>${stateActions(row)}</article>`).join('')}</section>`;
}
export function assetSourceMarkup(project,row){
 const docs=assetNovelDocuments(project,row),design=assetDesignEvidence(project,row);
 return `<section class="asset-source-review"><h3>${esc(row.name)} · 服装 / 状态核对</h3><p class="asset-variant-state">${esc(row.state||'资料未指定')}</p><p class="asset-inline-warning">制作资料中的状态是待判断的方案。分镜事件、设计说明和原著原文分别列出，请核对后决定用图。</p>${row.role==='character'?stateActions(row):''}
 <section class="asset-original-documents"><h4>随包原著原件</h4>${docs.length?docs.map(d=>`<article data-asset-novel-document="${esc(d.relativePath)}"><a target="_blank" rel="noopener" href="/api/projects/${encodeURIComponent(project.id)}/production/source?path=${encodeURIComponent(d.relativePath)}">${esc(d.relativePath)}</a><div data-asset-novel-passages>正在读取原文原件…</div></article>`).join(''):'<p>该工程未保存可定位的原著原件。下面仅为资料包提供的出处和摘录，不能当作已核实的原文服装依据。</p>'}</section>
 ${design.map(d=>`<details class="asset-design-evidence"><summary>资料方案：${esc(d.version)}（含美术补足）</summary><p>${esc(d.basis||'资料未提供设计依据')}</p><small>${esc(d.source)}</small></details>`).join('')}
 <h4>分镜使用位置与资料摘录</h4>${row.sources.map(s=>`<details class="asset-provenance-entry"><summary>第${s.episode||'?'}话 · ${esc(s.code)} · ${esc(s.novelLocation||'原著位置未提供')}</summary><dl><dt>来源文件</dt><dd>${esc(s.source.file||'资料未提供')}${s.source.pointer?' · '+esc(s.source.pointer):''}</dd><dt>来源方案</dt><dd>${esc(s.assetVersion||'未提供')}</dd><dt>原资料状态</dt><dd>${esc(s.sourceState||s.state||'未提供')}</dd></dl>${s.novelQuote?`<strong>${esc(s.novelQuoteLabel||'资料提供的原著摘录')}</strong><blockquote>${esc(s.novelQuote)}</blockquote>`:'<p>本格未提供直接原文摘录。</p>'}${s.adaptationNote?`<strong>分镜编排说明（不是原文）</strong><blockquote>${esc(s.adaptationNote)}</blockquote>`:''}${s.description?`<strong>分镜画面摘录</strong><blockquote>${esc(s.description)}</blockquote>`:''}${s.notes?`<p>分镜备注：${esc(s.notes)}</p>`:''}<button data-asset-locate="${esc(s.panelId)}">定位使用位置</button></details>`).join('')}</section>`;
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
 async function load(project,root,isCurrent=()=>true){
  const nextOwner=project.id+'@'+project.productionPackage.hash;if(owner!==nextOwner){clear();owner=nextOwner;}
  await Promise.all([...root.querySelectorAll('[data-asset-novel-document]')].map(async node=>{
   const path=node.dataset.assetNovelDocument,key=project.id+'@'+project.productionPackage.hash+':'+path,url='/api/projects/'+encodeURIComponent(project.id)+'/production/source?path='+encodeURIComponent(path),host=node.querySelector('[data-asset-novel-passages]');
   try{
    const text=await requests.load(key,()=>readSource(url));if(!isCurrent()||!node.isConnected)return;
    const passages=originalClothingPassages(text);
    host.innerHTML=`<p class="asset-inline-note">以下逐字读取自原件，列出本章服装相关段落供人工判断，未自动认定适用于当前状态。</p>${passages.length?passages.slice(0,20).map(p=>`<blockquote><small>原件第 ${p.line} 行 · 非空段 ${p.paragraph}</small><p>${esc(p.quote)}</p></blockquote>`).join(''):'<p>未检出服装关键词，请核对原文全文。</p>'}<details><summary>查看原文全文</summary><pre>${esc(text)}</pre></details>`;
   }catch(error){if(isCurrent()&&node.isConnected)host.textContent=error.message;}
  }));
 }
 return {load,clear,stats:()=>requests.stats()};
}
