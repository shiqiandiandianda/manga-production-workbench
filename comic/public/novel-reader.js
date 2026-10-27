import {readerSettings,chapterParagraphs,findChapterMatches} from './novel-reader-core.js';

const $=selector=>document.querySelector(selector),params=new URLSearchParams(location.search),storageKey='comic-novel-reader-view-v1',article=$('#reader-document'),input=$('#search-input'),status=$('#reader-status');
const controller=new AbortController();let preferences=readerSettings(),paragraphs=[],nodes=new Map(),texts=new Map(),matches=[],limited=false,current=-1,searchTimer,painted=new Set();
try{preferences=readerSettings(JSON.parse(localStorage.getItem(storageKey)||'{}'));}catch{}
const projectId=params.get('projectId'),chapter=Number(params.get('chapter')),originLine=Number(params.get('line'))||0;

function applyPreferences(){
 document.documentElement.style.setProperty('--reader-font',preferences.fontSize+'px');document.body.dataset.theme=preferences.theme;document.body.dataset.wide=String(preferences.wide);
 $('#font-size').textContent=preferences.fontSize;$('#font-smaller').disabled=preferences.fontSize<=16;$('#font-larger').disabled=preferences.fontSize>=32;
 $('#reader-width').setAttribute('aria-pressed',String(preferences.wide));$('#reader-theme').setAttribute('aria-pressed',String(preferences.theme==='dark'));$('#reader-theme').textContent=preferences.theme==='dark'?'日间':'夜间';
 try{localStorage.setItem(storageKey,JSON.stringify(preferences));}catch{}
}
function scrollToNode(node){if(node)node.scrollIntoView({block:'center',behavior:'instant'});}
function showCurrent(){
 article.querySelector('mark[data-current]')?.removeAttribute('data-current');const node=article.querySelector('mark[data-match="'+current+'"]');if(node){node.dataset.current='true';scrollToNode(node);}
 $('#search-count').textContent=input.value.trim()?(matches.length?`${current+1} / ${matches.length}${limited?'+':''}`:'未找到'):'输入关键词';
 $('#search-prev').disabled=$('#search-next').disabled=!matches.length;
}
function paintSearch(){
 const grouped=new Map();matches.forEach((match,index)=>{if(!grouped.has(match.line))grouped.set(match.line,[]);grouped.get(match.line).push({...match,id:index});});
 for(const line of new Set([...painted,...grouped.keys()])){const node=nodes.get(line);if(!node)continue;const fragment=document.createDocumentFragment(),text=texts.get(line);let offset=0;
  for(const match of grouped.get(line)||[]){fragment.append(document.createTextNode(text.slice(offset,match.index)));const mark=document.createElement('mark');mark.dataset.match=match.id;mark.textContent=text.slice(match.index,match.index+match.length);fragment.append(mark);offset=match.index+match.length;}
  fragment.append(document.createTextNode(text.slice(offset)));node.replaceChildren(fragment);
 }
 painted=new Set(grouped.keys());showCurrent();
}
function search(){
 clearTimeout(searchTimer);searchTimer=null;({matches,limited}=findChapterMatches(paragraphs,input.value));current=matches.length?0:-1;paintSearch();
}
function step(direction){
 if(searchTimer){clearTimeout(searchTimer);searchTimer=null;search();return;}
 if(!matches.length)return;current=(current+direction+matches.length)%matches.length;showCurrent();
}
$('#reader-search').addEventListener('submit',event=>{event.preventDefault();step(1);});
input.addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>{searchTimer=null;search();},140);});
$('#search-prev').addEventListener('click',()=>step(-1));
document.addEventListener('keydown',event=>{
 if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='f'){event.preventDefault();input.focus();input.select();}
 else if(event.key==='F3'){event.preventDefault();step(event.shiftKey?-1:1);}
 else if(document.activeElement===input&&event.key==='Enter'&&event.shiftKey){event.preventDefault();step(-1);}
 else if(document.activeElement===input&&event.key==='Escape'){event.preventDefault();input.value='';search();}
});
$('#font-smaller').addEventListener('click',()=>{preferences.fontSize=Math.max(16,preferences.fontSize-2);applyPreferences();});
$('#font-larger').addEventListener('click',()=>{preferences.fontSize=Math.min(32,preferences.fontSize+2);applyPreferences();});
$('#reader-theme').addEventListener('click',()=>{preferences.theme=preferences.theme==='dark'?'paper':'dark';applyPreferences();});
$('#reader-width').addEventListener('click',()=>{preferences.wide=!preferences.wide;applyPreferences();});
$('#reader-origin').addEventListener('click',()=>scrollToNode(document.getElementById('line-'+originLine)));
$('#reader-top').addEventListener('click',()=>window.scrollTo({top:0,behavior:'instant'}));
$('#reader-close').addEventListener('click',()=>{if(history.length<=1)window.close();else history.back();status.textContent='可关闭此标签页，回到原来的资产页面。';});
window.addEventListener('pagehide',()=>{controller.abort();clearTimeout(searchTimer);},{once:true});
applyPreferences();

async function load(){
 if(!/^project_[a-f0-9-]{36}$/u.test(projectId||'')||!Number.isInteger(chapter)||chapter<=0)throw Error('缺少有效工程或章节，请从资产页的“查看本章原文”重新打开。');
 $('#chapter-label').textContent='第'+chapter+'章 · 原文';
 const url='/api/projects/'+projectId+'/novel-source?chapter='+chapter,response=await fetch(url,{signal:controller.signal});
 if(!response.ok){let message='原文暂时无法读取';try{message=(await response.json()).error||message;}catch{}throw Error(message);}
 paragraphs=chapterParagraphs(await response.text());const fragment=document.createDocumentFragment();
 paragraphs.forEach((paragraph,index)=>{const heading=index===0&&/^\s*第\s*\d+\s*章/u.test(paragraph.text),node=document.createElement(heading?'h1':'p'),text=document.createElement('span');node.id='line-'+paragraph.line;node.dataset.line=paragraph.line;text.className='reader-paragraph-text';text.textContent=paragraph.text;
  if(!heading){const number=document.createElement('span');number.className='reader-line-number';number.setAttribute('aria-hidden','true');number.textContent=paragraph.line;node.append(number);}node.append(text);fragment.append(node);nodes.set(paragraph.line,text);texts.set(paragraph.line,paragraph.text);
  if(heading)document.title=paragraph.text.trim()+' · 小说原文';
 });article.replaceChildren(fragment);article.setAttribute('aria-busy','false');
 $('#reader-meta').textContent='第'+chapter+'章 · '+paragraphs.length+'段'+(params.get('name')?' · '+params.get('name').slice(0,60):'');
 const download=$('#reader-download');download.href=url;download.download='第'+chapter+'章.txt';download.hidden=false;
 const origin=document.getElementById('line-'+originLine);if(origin){origin.classList.add('reader-origin-line');$('#reader-origin').disabled=false;status.textContent='已定位到第'+originLine+'行引用原文。';requestAnimationFrame(()=>scrollToNode(origin));}if(input.value.trim())search();
}
void load().catch(error=>{if(error.name==='AbortError')return;article.setAttribute('aria-busy','false');article.textContent='暂时没有可显示的章节正文。';status.textContent=error.message;});
