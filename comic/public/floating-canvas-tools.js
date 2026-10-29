const STORAGE_KEY='comic-canvas-tool-position-v1';
const SIZE_KEY='comic-canvas-tool-scale-v1';
const DEFAULT_SCALE=.85,MIN_SCALE=.7,MAX_SCALE=1.1;
const margin=8;

// Store only this browser's tool position, never a change to the comic document.
export function mountFloatingCanvasTools({dock,area,toolbar}){
 const heading=dock.querySelector('.canvas-tool-heading');
 const canvas=area.querySelector('#canvas-scroll')||area;
 let preferred=null,drag=null,scale=DEFAULT_SCALE;
 try{const value=Number(localStorage.getItem(SIZE_KEY));if(Number.isFinite(value)&&value>=MIN_SCALE&&value<=MAX_SCALE)scale=value;}catch{}
 try{const value=JSON.parse(localStorage.getItem(STORAGE_KEY));if(Number.isFinite(value?.x)&&Number.isFinite(value?.y))preferred=value;}catch{}
 heading.tabIndex=0;
 heading.setAttribute('aria-label','移动常用工具');
 heading.title='拖动标题栏移动；方向键微调；双击恢复默认位置';
 function save(){try{if(preferred)localStorage.setItem(STORAGE_KEY,JSON.stringify(preferred));else localStorage.removeItem(STORAGE_KEY);}catch{}}
 function place(position=preferred){
  dock.style.transform='scale('+scale+')';
  const naturalWidth=Math.min(224,(innerWidth-margin*2)/scale),width=naturalWidth*scale,rect=canvas.getBoundingClientRect();
  dock.style.width=naturalWidth+'px';
  const top=Math.max(rect.top,toolbar.getBoundingClientRect().bottom);
  const target=position||{x:rect.right-width-12,y:top+12};
  const x=Math.max(margin,Math.min(innerWidth-width-margin,target.x));
  const minY=Math.max(margin,Math.min(top+margin,innerHeight-160-margin));
  const y=Math.max(minY,Math.min(innerHeight-160-margin,target.y));
  dock.style.left=x+'px';dock.style.top=y+'px';dock.style.maxHeight=Math.max(44,(innerHeight-y-margin)/scale)+'px';
  return {x,y};
 }
 function resizeTools(delta){
  scale=Math.max(MIN_SCALE,Math.min(MAX_SCALE,Math.round((scale+delta)*100)/100));
  try{localStorage.setItem(SIZE_KEY,String(scale));}catch{}
  syncSize();place();
 }
 function syncSize(){
  for(const button of dock.querySelectorAll('[data-tool-size]')){
   const shrink=button.dataset.toolSize==='smaller';
   button.disabled=shrink?scale<=MIN_SCALE:scale>=MAX_SCALE;
   button.title=(shrink?'缩小工具栏':'放大工具栏')+' · 当前 '+Math.round(scale*100)+'%';
  }
 }
 for(const button of dock.querySelectorAll('[data-tool-size]'))button.addEventListener('click',()=>resizeTools(button.dataset.toolSize==='smaller'?-.05:.05));
 syncSize();
 function finish(event){
  if(!drag||event.pointerId!==drag.id)return;
  if(event.type==='pointercancel'){preferred=drag.preferred;place();}else if(drag.moved){preferred=place();save();}
  drag=null;dock.classList.remove('is-dragging');
  if(heading.hasPointerCapture(event.pointerId))heading.releasePointerCapture(event.pointerId);
 }
 heading.addEventListener('pointerdown',event=>{
  if(event.button!==0||event.isPrimary===false||event.target.closest('button,input,select,a'))return;
  const rect=dock.getBoundingClientRect();
  drag={id:event.pointerId,x:event.clientX,y:event.clientY,left:rect.left,top:rect.top,preferred,moved:false};
  heading.setPointerCapture(event.pointerId);heading.focus({preventScroll:true});event.preventDefault();event.stopPropagation();
 });
 heading.addEventListener('pointermove',event=>{
  if(!drag||event.pointerId!==drag.id)return;
  const dx=event.clientX-drag.x,dy=event.clientY-drag.y;
  if(!drag.moved&&Math.hypot(dx,dy)<3)return;
  drag.moved=true;dock.classList.add('is-dragging');
  preferred=place({x:drag.left+dx,y:drag.top+dy});event.preventDefault();
 });
 for(const type of ['pointerup','pointercancel','lostpointercapture'])heading.addEventListener(type,finish);
 heading.addEventListener('dblclick',event=>{if(event.target.closest('button'))return;preferred=null;place();save();});
 heading.addEventListener('keydown',event=>{
  if(event.target!==heading)return;
  const step=event.shiftKey?1:10,delta={ArrowLeft:[-step,0],ArrowRight:[step,0],ArrowUp:[0,-step],ArrowDown:[0,step]}[event.key];
  if(!delta)return;
  event.preventDefault();event.stopPropagation();const rect=dock.getBoundingClientRect();preferred=place({x:rect.left+delta[0],y:rect.top+delta[1]});save();
 });
 const observer=new ResizeObserver(()=>{if(!drag)place();});observer.observe(area);observer.observe(canvas);observer.observe(toolbar);
 window.addEventListener('resize',()=>{if(!drag)place();});place();
 return {follow:()=>place()};
}
