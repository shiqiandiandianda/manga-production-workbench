import {novelEpisodeContext,isSourceParagraph} from './production-display-context.js';
import {chapterParagraphs} from './novel-reader-core.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function mountNovelSourcePanel({getProject,getPage,getSelected,onVisibility=()=>{}}){
 const host=document.querySelector('.canvas-wrap'),panel=document.createElement('aside'),button=document.createElement('button');
 panel.id='novel-source-panel';panel.hidden=true;panel.setAttribute('aria-label','本话小说原文');
 panel.innerHTML='<header><strong>本话小说原文</strong><button data-novel-close aria-label="关闭小说原文">×</button></header><p class="novel-source-status" role="status"></p><div class="novel-source-body" tabindex="0"></div>';
 host.append(panel);button.id='novel-source-toggle';button.textContent='小说原文';button.setAttribute('aria-controls',panel.id);button.setAttribute('aria-expanded','false');
 document.querySelector('#history-steps-toggle').after(button);
 const body=panel.querySelector('.novel-source-body'),status=panel.querySelector('[role=status]');
 const style=document.createElement('style');style.textContent=`
 .canvas-wrap.novel-source-open{display:grid;grid-template-columns:minmax(0,1fr) min(340px,40vw)}
 .canvas-wrap.novel-source-open.history-steps-open{grid-template-columns:minmax(0,1fr) min(260px,28vw) min(340px,35vw)}
 .novel-source-open>#canvas-scroll{grid-column:1;grid-row:1;min-width:0}
 #novel-source-panel{grid-column:2;grid-row:1;min-width:0;min-height:0;display:flex;flex-direction:column;overflow:hidden;background:var(--panel,#18222d);border-left:1px solid var(--line);color:var(--text)}
 .history-steps-open>#novel-source-panel{grid-column:3}#novel-source-panel[hidden]{display:none}
 #novel-source-panel header{display:flex;justify-content:space-between;align-items:center;padding:12px;gap:8px}
 #novel-source-panel header button{min-height:28px;padding:4px 8px}.novel-source-status{font-size:12px;color:var(--muted);padding:0 12px;margin:0 0 8px}
 .novel-source-body{overflow:auto;flex:1;min-height:0;padding:0 14px 24px;overscroll-behavior:contain;font-size:16px;line-height:1.9}
 .novel-source-body h3{font-size:17px;margin:16px 0}.novel-source-body p{margin:0 0 14px;white-space:pre-wrap;overflow-wrap:anywhere;padding:5px 7px;border-left:3px solid transparent}
 .novel-source-body p[data-novel-highlight]{background:#624d23;color:#fff1bf;border-left-color:#f4bf52;border-radius:3px}
 .panel-character-card{display:flex;gap:10px;padding:8px 0;border-bottom:1px solid #c8d5df;white-space:normal}
 .panel-character-card img{width:64px;height:86px;object-fit:contain;background:#e4eaf0;border-radius:4px;flex:none}
 .panel-character-card strong,.panel-character-card small{display:block}.panel-character-card small{margin-top:4px;line-height:1.5}
 `;document.head.append(style);
 let signature='',token=0,controller=null,documentKey='',cache=new Map();
 function highlight(context){
  let count=0;
  for(const section of body.querySelectorAll('[data-novel-chapter]')){
   [...section.querySelectorAll('[data-novel-line]')].forEach((node,index)=>{
    const selected=isSourceParagraph({line:Number(node.dataset.novelLine),text:node.textContent},index,Number(section.dataset.novelChapter),context.locations);
    node.toggleAttribute('data-novel-highlight',selected);if(selected)count++;
   });
  }
  status.textContent='第'+context.episode.episode+'话 · '+(context.gridId||context.segment?.id||'请选择屏段')+(count?' · 已高亮 '+count+' 处':' · 本次选择没有可核对的原文行号');
  const first=body.querySelector('[data-novel-highlight]');
  if(first)body.scrollTop=Math.max(0,body.scrollTop+first.getBoundingClientRect().top-body.getBoundingClientRect().top-body.clientHeight*.3);
 }
 async function refresh(){
  if(panel.hidden)return;
  const project=getProject(),context=novelEpisodeContext(project,getPage(),getSelected());
  const key=[project?.id,project?.productionPackage?.hash,context.episode?.episode,context.chapters.join(',')].join('|');
  const next=key+'|'+JSON.stringify(context.locations)+'|'+(context.segment?.id||'')+'|'+(context.gridId||'');
  if(signature===next)return;signature=next;const current=++token;
  if(!context.episode){controller?.abort();documentKey='';body.textContent='请先打开制作资料工程并选择话数。';status.textContent='';return;}
  if(documentKey===key){highlight(context);return;}
  controller?.abort();controller=new AbortController();documentKey='';
  body.textContent=context.chapters.length?'正在读取本话小说原文…':'资料包未提供本话的小说章节对应关系。';status.textContent='第'+context.episode.episode+'话';
  try{
   const chapters=await Promise.all(context.chapters.map(async chapter=>{
    const ck=project.id+'|'+project.productionPackage.hash+'|'+chapter;
    if(cache.has(ck))return cache.get(ck);
    const response=await fetch('/api/projects/'+encodeURIComponent(project.id)+'/novel-source?chapter='+chapter,{signal:controller.signal});
    if(!response.ok)return {chapter,error:response.status===404?'资料包中缺少这章原文。':'原文读取失败，请检查原文件后重新打开。'};
    const result={chapter,paragraphs:chapterParagraphs(await response.text())};if(cache.size>60)cache.clear();cache.set(ck,result);return result;
   }));
   if(current!==token||panel.hidden)return;
   body.innerHTML=chapters.map(c=>'<section data-novel-chapter="'+c.chapter+'"><h3>第'+c.chapter+'章</h3>'+(c.error?'<p>'+esc(c.error)+'</p>':c.paragraphs.map(p=>'<p data-novel-line="'+p.line+'">'+esc(p.text)+'</p>').join(''))+'</section>').join('')||'资料包未提供本话的小说章节对应关系。';
   documentKey=key;highlight(context);
  }catch(error){if(current===token&&error.name!=='AbortError'){body.textContent='读取小说原文失败：'+error.message;signature='';}}
 }
 function setOpen(open){panel.hidden=!open;host.classList.toggle('novel-source-open',open);button.setAttribute('aria-expanded',String(open));if(open){signature='';refresh();}else{++token;controller?.abort();}onVisibility(open);}
 button.onclick=()=>setOpen(panel.hidden);panel.querySelector('[data-novel-close]').onclick=()=>setOpen(false);
 return {refresh,open:()=>setOpen(true),close:()=>setOpen(false)};
}
