const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const text=v=>typeof v==='string'?v.trim():'';
const validRange=r=>Number.isSafeInteger(r.chapter)&&r.chapter>0&&Number.isSafeInteger(r.startLine)&&r.startLine>0&&Number.isSafeInteger(r.endLine)&&r.endLine>=r.startLine;

/** Exact imported line references only; never search by clothing or guess a quotation. */
export function novelSourceRanges(source){
 const explicit=(Array.isArray(source.sourceLocations)?source.sourceLocations:[]).filter(r=>r&&typeof r==='object').map(r=>({chapter:Number(r.chapter||/^N(\d+)$/u.exec(r.id||'')?.[1]),startLine:Number(r.startLine),endLine:Number(r.endLine??r.startLine)})).filter(validRange);
 if(explicit.length)return explicit;
 return [...String(source.novelLocation||'').matchAll(/第\s*(\d+)\s*章\s*[·:：,，]?\s*第?\s*(\d+)\s*(?:[—－–\-~～至]\s*(\d+)\s*)?行/gu)].map(m=>({chapter:Number(m[1]),startLine:Number(m[2]),endLine:Number(m[3]||m[2])})).filter(validRange);
}

export function assetSourcePassages(sources,{chapters=new Map()}={}){
 const entries=new Map();
 for(const source of sources||[]){
  let quote=text(source.novelQuote),kind='novel';
  if(!quote){
   const ranges=novelSourceRanges(source),parts=ranges.map(r=>{const body=chapters.get(r.chapter);if(typeof body!=='string')return '';const lines=body.replace(/^\uFEFF/u,'').split(/\r?\n/u);return r.endLine<=lines.length?lines.slice(r.startLine-1,r.endLine).join('\n').trim():'';});
   if(parts.length&&parts.every(Boolean))quote=parts.join('\n\n');
  }
  let dialogue='';
  if(!quote){kind='storyboard';quote=text(source.description);dialogue=text(source.dialogue);}
  if(!quote&&!dialogue)continue;
  const label=kind==='novel'?'小说原文':/甲方|客户|审核/u.test(source.source?.file||'')?'甲方审核分镜':'分镜表';
  const key=JSON.stringify([kind,label,quote,dialogue]),entry=entries.get(key)||{kind,label,quote,dialogue,sources:[]};
  entry.sources.push(source);entries.set(key,entry);
 }
 return [...entries.values()];
}

function passageMarkup(entry){
 const locations=[...new Map(entry.sources.map(s=>[JSON.stringify([s.episode,s.code,s.novelLocation,s.source]),s])).values()];
 return `<article class="asset-source-passage" data-source-kind="${entry.kind}"><strong>${esc(entry.label)}</strong>${entry.quote?`<blockquote>${esc(entry.quote)}</blockquote>`:''}${entry.dialogue?`<p class="asset-source-dialogue">台词：${esc(entry.dialogue)}</p>`:''}<details class="asset-source-location"><summary>查看定位${locations.length>1?' · '+locations.length+'处':''}</summary>${locations.map(s=>`<p>${esc([s.episode?'第'+s.episode+'话':'',s.code,s.novelLocation].filter(Boolean).join(' · '))}${s.source?.file?`<br>${esc(s.source.file)}${s.source.sheet?' · '+esc(s.source.sheet):''}${s.source.row?' · 第'+esc(s.source.row)+'行':''}${s.source.pointer?' · '+esc(s.source.pointer):''}`:''}</p>`).join('')}</details></article>`;
}

export function assetSourcePassagesMarkup(row,{compact=false,chapters}={}){
 const entries=assetSourcePassages(row.sources,{chapters}),first=compact?entries.slice(0,3):entries,remaining=compact?entries.slice(3):[];
 return `<div class="asset-source-passages" data-asset-source-passages="${esc(row.key)}">${first.map(passageMarkup).join('')||'<p>资料没有提供小说摘录或分镜正文，请补充原文或分镜表。</p>'}${remaining.length?`<details class="asset-source-more"><summary>查看其余 ${remaining.length} 段</summary>${remaining.map(passageMarkup).join('')}</details>`:''}</div>`;
}

export const assetCardSourceMarkup=row=>`<details class="asset-card-sources" data-asset-source-card="${esc(row.key)}"><summary>原文出处</summary>${assetSourcePassagesMarkup(row,{compact:true})}</details>`;
