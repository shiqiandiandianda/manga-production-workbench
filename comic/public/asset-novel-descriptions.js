import {novelSourceRanges} from './asset-source-passages.js';
import {novelReaderUrl} from './novel-reader-core.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const key=value=>String(value||'').normalize('NFKC').toLowerCase().replace(/[\s·•_｜|（）()\-]/gu,'');
const unique=items=>[...new Set(items.filter(Boolean))];
const chapterOf=name=>Number(/第\s*(\d+)\s*章/u.exec(name||'')?.[1]||0);
const labels={character:'人物',scene:'场景',prop:'道具'};
const descriptions={
 character:/身穿|穿着|一身|头戴|披着|面容|相貌|容貌|面貌|脸庞|脸色|面色|肤色|五官|眉眼|眉毛|双眼|眼睛|胡须|胡子|头发|长发|白发|身材|身形|体态|高大|矮小|清瘦|肥胖|魁梧|长衫|长袍|衣袍|官服|衣裙|甲胄|斗篷|面具|[黑白青灰红蓝紫黄](?:色)?[衣袍衫裙]|(?:年约|年纪|岁数|岁左右)/u,
 scene:/宽敞|宽阔|狭窄|幽暗|昏暗|明亮|破旧|陈旧|华丽|奢华|雕梁|画栋|青砖|青石|红漆|朱红|木柱|窗棂|灯火|烛光|灯笼|石阶|院墙|石墙|廊柱|房梁|陈设|布置|(?:摆着|摆放|放着|铺着|挂着|立着|设有|有一[张座排扇口])|(?:窗|门|庭院|屋|房|堂|廊|楼|墙|桌|椅).{0,8}(?:高|低|宽|窄|大|小|暗|亮|木|石|红|黑|白)/u,
 prop:/木制|木质|铁制|铜制|金属|瓷器|白瓷|青瓷|玉制|丝绸|绸缎|皮革|纸张|信笺|银色|金色|黑色|白色|红色|蓝色|青色|锋利|弯曲|细长|圆形|方形|通体|表面|花纹|纹路|雕刻|刻着|镶嵌|大小|长约|宽约|厚约|直径|寸|尺|[一二三四五六七八九十两\d]+(?:封|柄|把|枚|只|颗|张|卷|盏)/u,
};
const propNames={文房四宝:['毛笔','砚台','笔墨纸砚'],茶具:['茶壶','茶杯','茶盏'],传信白鸽:['白鸽'],书信:['信笺','信纸']};
const rooms=[/厅堂|内厅|大厅|正厅|大堂/u,/书房/u,/卧房|卧室|寝室|寝房/u,/阁楼/u,/院落|庭院|院中|前院|后院/u,/门外|院门|大门/u];

export function assetNovelTerms(row){
 const names=unique([row.name,row.sceneName,...(Array.isArray(row.aliases)?row.aliases:[])]),terms=[];
 for(const name of names){const parts=String(name).split(/[·•｜|/]/u).map(v=>v.trim()).filter(Boolean);terms.push(parts.at(-1));if(parts.length===1)terms.push(name);}
 if(row.role==='scene'&&row.state){const leaf=String(row.state).split(/[·•｜|/]/u).at(-1).trim();if(terms.some(t=>key(leaf).includes(key(t))))terms.push(leaf);}
 if(row.role==='prop')for(const name of names){terms.push(...String(name).split(/[与及和、，,]/u).map(s=>s.trim()));for(const [label,aliases]of Object.entries(propNames))if(key(name).includes(key(label)))terms.push(...aliases);}
 return unique(terms.map(t=>String(t||'').trim()).filter(t=>key(t).length>=2&&t.length<=80)).slice(0,12);
}

/** Only attached original texts and explicitly referenced supplemental chapters. */
export function assetNovelSourceDocuments(project,row){
 const numbers=unique((row.sources||[]).flatMap(s=>[...novelSourceRanges(s).map(r=>r.chapter),...[...String(s.novelLocation||'').matchAll(/第\s*(\d+)\s*章/gu)].map(m=>Number(m[1]))]));
 const docs=(project.productionPackage?.manifest||[]).filter(f=>/\.(txt|md)$/iu.test(f.relativePath)&&/原文核对|原著|小说/u.test(f.relativePath)).map(f=>{const chapter=chapterOf(f.relativePath),base='/api/projects/'+encodeURIComponent(project.id);return {name:f.relativePath,chapter,sha256:f.sha256,url:chapter?base+'/novel-source?chapter='+chapter:base+'/production/source?'+new URLSearchParams({path:f.relativePath})};});
 for(const number of numbers)if(!docs.some(d=>d.chapter===number))docs.push({name:'第'+number+'章',chapter:number,url:'/api/projects/'+encodeURIComponent(project.id)+'/novel-source?chapter='+number});
 return [...new Map(docs.map(d=>[d.url,d])).values()].sort((a,b)=>Number(numbers.includes(b.chapter))-Number(numbers.includes(a.chapter))||a.chapter-b.chapter||a.name.localeCompare(b.name,'zh-CN'));
}

/** Retrieval only: every displayed passage is copied from an original document. */
export function findAssetNovelDescriptions(row,documents,{limit=6}={}){
 const terms=assetNovelTerms(row),sources=row.sources||[],specific=row.role==='scene'&&row.state?sources.filter(s=>key(s.scene)===key(row.state)):[],ranges=(specific.length?specific:sources).flatMap(novelSourceRanges),hits=[],descriptive=descriptions[row.role]||descriptions.scene,room=row.role==='scene'?rooms.find(pattern=>pattern.test(row.state||row.name)):null;
 for(const document of documents){
  const lines=String(document.text||'').replace(/^\uFEFF/u,'').split(/\r\n|\n|\r/u),paragraphs=lines.flatMap((quote,i)=>quote.trim()?[{quote:quote.trim(),line:i+1}]:[]);
  for(let index=0;index<paragraphs.length;index++){
   const p=paragraphs[index],normalized=key(p.quote),matched=terms.filter(t=>normalized.includes(key(t))),previous=paragraphs[index-1],previousMatch=previous&&terms.some(t=>key(previous.quote).includes(key(t))),pronoun=row.role==='character'&&previousMatch&&/^(?:他|她|其|此人|这人|那人|这一次[，,]?\s*[他她])/u.test(p.quote);
   if(room&&!room.test(p.quote)&&rooms.some(pattern=>pattern!==room&&pattern.test(p.quote)))continue;
   const referenced=ranges.some(r=>r.chapter===document.chapter&&p.line>=r.startLine&&p.line<=r.endLine);
   if(!matched.length&&!pronoun&&!referenced)continue;
   const hasDescription=!!(matched.length||pronoun)&&descriptive.test(p.quote),stateWords=String(row.state||'').match(/[黑白青灰红蓝紫黄]色|长衫|官服|长袍|甲胄|夜晚|白天/gu)||[];
   const score=(hasDescription?60:0)+(matched.length?30:pronoun?20:0)+(referenced?48:0)+stateWords.filter(word=>p.quote.includes(word)).length*3;
   const contextStart=Math.max(0,index-1),contextEnd=Math.min(paragraphs.length-1,index+1),context=lines.slice(paragraphs[contextStart].line-1,paragraphs[contextEnd].line).join('\n');
   hits.push({...p,chapter:document.chapter,file:document.name,url:document.url,sha256:document.sha256,matched,descriptive:hasDescription,referenced,score,context,contextStart:paragraphs[contextStart].line,contextEnd:paragraphs[contextEnd].line});
  }
 }
 const qualified=hits.some(h=>h.descriptive)?hits.filter(h=>h.descriptive||h.matched.length):hits.some(h=>h.matched.length)?hits.filter(h=>h.matched.length||h.referenced):hits;
 const sorted=qualified.sort((a,b)=>b.score-a.score||a.chapter-b.chapter||a.line-b.line),seen=new Set(),excerpts=[];
 for(const hit of sorted){const identity=key(hit.quote);if(seen.has(identity))continue;seen.add(identity);excerpts.push(hit);if(excerpts.length>=limit)break;}
 // Imported quotes are a last resort, explicitly distinguished from verified originals.
 if(!documents.length)for(const source of row.sources||[]){const quote=String(source.novelQuote||'').trim();if(!quote||seen.has(key(quote)))continue;seen.add(key(quote));excerpts.push({quote,file:source.source?.file||'导入资料',location:source.novelLocation,imported:true,descriptive:false,referenced:true,matched:[],score:0});if(excerpts.length>=limit)break;}
 return {terms,excerpts,descriptionCount:excerpts.filter(e=>e.descriptive).length,documentCount:documents.length};
}

function highlight(text,terms){
 const pattern=terms.length?new RegExp('('+terms.map(t=>t.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|')+')','giu'):null;
 return pattern?String(text).split(pattern).map((part,i)=>i%2?'<mark>'+esc(part)+'</mark>':esc(part)).join(''):esc(text);
}

export function assetNovelDescriptionsMarkup(project,row,result){
 const label=labels[row.role]||'资产',appearance=row.role==='character'?'外貌与服饰':row.role==='scene'?'环境与陈设':'外形与材质';
 const heading=result.descriptionCount?'找到 '+result.descriptionCount+' 段'+label+'描写':'未找到明确的'+appearance+'描写';
 const intro=`<p class="asset-novel-summary" role="status">${esc(heading)}<small>已读取 ${result.documentCount} 份小说原件${result.terms.length?' · 检索：'+esc(result.terms.join('、')):''}</small></p>`+
 (!result.descriptionCount?`<p class="asset-novel-empty">${result.excerpts.length?'下面保留对应的剧情原文，不能把其中未写明的'+appearance+'当成原著设定。':result.documentCount?'原件中未找到这个资产的对应名称或引用段落。':'当前工程未附带可读取的小说原文。'}</p>`:'');
 const articles=result.excerpts.map(e=>{
  const location=e.location||(Number.isInteger(e.line)?(e.chapter?'第'+e.chapter+'章 · ':'')+'第'+e.line+'行':'章节位置未提供'),url=e.imported?'':e.chapter?novelReaderUrl(project.id,e,row.name):e.url;
  const quote=e.quote.slice(0,1400),category=e.imported?'资料包附带摘录 · 未核对原件':e.descriptive?'描写原句':'相关剧情原文';
  return `<article class="asset-novel-excerpt" data-novel-description="${e.descriptive?'description':'context'}"><header><strong>${category}</strong><span>${esc(location||'章节位置未提供')}${url?' · <a href="'+esc(url)+'" target="_blank" rel="noopener">打开原文</a>':''}</span></header><blockquote>${highlight(quote,result.terms)}${e.quote.length>quote.length?'<small>（本段较长，打开原文可阅读全文）</small>':''}</blockquote><small class="asset-novel-file">${esc(e.file)}</small>${e.context?`<details><summary>上下文 · 第${e.contextStart}—${e.contextEnd}行</summary><p class="asset-novel-context">${highlight(e.context,result.terms)}</p></details>`:''}</article>`;
 });
 const visible=result.descriptionCount?3:2;
 return intro+articles.slice(0,visible).join('')+(articles.length>visible?`<details class="asset-novel-more"><summary>其余 ${articles.length-visible} 处原文</summary>${articles.slice(visible).join('')}</details>`:'');
}
