import {clone,layoutLongStrip} from './model.js';
import {paintSceneRegion} from './render.js';
import {documentView} from './scene-svg.js';
import {bubbleLayout} from './lettering.js';
import {DEFAULT_SPACE_HEIGHT,insertStripSpace,insertionPage,spaceCutBlockers} from './strip-space.js';

/** Sample the composed picture/background at the line, excluding lettering and editor guides. */
export async function sampleStripColor(project,point,{canvasFactory=()=>document.createElement('canvas')}={}){
 const layout=layoutLongStrip(project.pages),x=Math.max(0,Math.min(layout.width-1,Math.round(point.x))),y=Math.max(0,Math.min(layout.height-1,Math.round(point.y)));
 const region={x:Math.max(0,x-3),y:Math.max(0,y-3),w:Math.min(7,layout.width-Math.max(0,x-3)),h:Math.min(7,layout.height-Math.max(0,y-3))};
 const canvas=canvasFactory();canvas.width=region.w;canvas.height=region.h;
 try{
  const background={...project,pages:project.pages.map(p=>({...p,bubbles:[]}))};
  const ctx=canvas.getContext('2d');ctx.translate(-region.x,-region.y);
  await paintSceneRegion(ctx,background,{region,layout,canvasFactory});
  const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data,channels=[[],[],[]];
  for(let i=0;i<pixels.length;i+=4)if(pixels[i+3]>0)for(let c=0;c<3;c++)channels[c].push(pixels[i+c]);
  if(!channels[0].length)throw Error('画线位置没有可取的底色');
  return '#'+channels.map(values=>{values.sort((a,b)=>a-b);return values[Math.floor(values.length/2)].toString(16).padStart(2,'0');}).join('');
 }finally{canvas.width=1;canvas.height=1;}
}

export function createStripSpaceUI({stage,scroll,host,getProject,getTool,setTool,getPoint,measurement,render,onInsert,toast}){
 let drawing=null,pending=null,hover=null,serial=0,lastHeight=DEFAULT_SPACE_HEIGHT;
 const panel=document.createElement('section');panel.className='strip-space-panel';panel.hidden=true;
 panel.innerHTML=`<header><strong>插入一截底图</strong><button type="button" data-space-cancel aria-label="取消插入">×</button></header>
  <p class="space-location"></p><div class="space-fields"><label>高度 px<input data-space-height type="number" min="1" max="10000" step="1" value="${DEFAULT_SPACE_HEIGHT}"></label><label>底图颜色<input data-space-color type="color" value="#ded8d0"></label></div>
  <input data-space-slider type="range" min="24" max="2000" step="8" value="${DEFAULT_SPACE_HEIGHT}" aria-label="调整插入高度">
  <div class="space-color-row"><button type="button" data-space-sample>重新取色</button><span class="space-sample-status">取画线位置的颜色</span></div>
  <p class="space-error" role="status"></p><p class="space-description">下方画格、对白和底色一起下移。</p>
  <div class="space-actions"><button type="button" data-space-cancel>取消</button><button type="button" data-space-apply class="primary">插入</button></div>`;
 host.append(panel);
 const input=panel.querySelector('[data-space-height]'),picker=panel.querySelector('[data-space-color]'),slider=panel.querySelector('[data-space-slider]'),applyButton=panel.querySelector('[data-space-apply]'),status=panel.querySelector('.space-sample-status'),error=panel.querySelector('.space-error');
 const sizes=()=>Object.fromEntries((getProject()?.pages||[]).flatMap(p=>p.bubbles).map(b=>[b.id,bubbleLayout(measurement,b)]));
 const pointAt=event=>{const point=getPoint(event);return {x:Math.max(0,Math.min(1279,point.x)),y:Math.round(point.y)};};
 const stop=event=>{event.preventDefault();event.stopImmediatePropagation();};
 function cancel({repaint=true}={}){
  if(drawing&&scroll.hasPointerCapture(drawing.pointer))scroll.releasePointerCapture(drawing.pointer);
  serial++;drawing=null;pending=null;hover=null;panel.hidden=true;
  if(repaint)render();
 }
 function sync(){
  if(getTool()!=='insert-space'||pending&&pending.projectId!==getProject()?.id){cancel({repaint:false});}
 }
 function refreshPreview(){
  if(!pending)return;const source=getProject();if(!source||source.id!==pending.projectId){cancel();return;}
  pending.preview=null;pending.height=Number(input.value);pending.color=picker.value;
  try{
   const result=insertStripSpace(source,{y:pending.y,height:pending.height,color:pending.color,bubbleSizes:sizes()});
   pending.preview=result.project;pending.layerId=result.layerId;error.textContent='';applyButton.disabled=pending.sampling;
  }catch(e){error.textContent=e.message;applyButton.disabled=true;}
  render();
 }
 async function sample(){
  if(!pending)return;const active=pending,token=++serial;active.sampling=true;status.textContent='正在取色…';applyButton.disabled=true;
  try{
   const color=await sampleStripColor(clone(getProject()),{x:active.x,y:active.y});
   if(token!==serial||active!==pending)return;
   picker.value=color;status.textContent='已取画线位置的底色';
  }catch(e){if(token!==serial||active!==pending)return;status.textContent='可手动选择颜色';toast('自动取色未完成，请手动选择底图颜色',true);}
  if(token!==serial||active!==pending)return;active.sampling=false;refreshPreview();
 }
 function open(point){
  const project=getProject();if(!project)return;const position=insertionPage(project,point.y);
  pending={projectId:project.id,y:position.y,x:point.x,height:lastHeight,color:position.entry.page.background,preview:null,sampling:false};
  input.value=String(lastHeight);slider.value=String(lastHeight);picker.value=position.entry.page.background;
  panel.querySelector('.space-location').textContent='画线位置：'+position.y+' px';panel.hidden=false;
  refreshPreview();sample();
 }
 function apply(){
  if(!pending||!pending.preview||pending.sampling)return;
  const request={y:pending.y,height:pending.height,color:pending.color,bubbleSizes:sizes()};
  if(pending.projectId!==getProject()?.id){cancel();return;}
  lastHeight=request.height;cancel({repaint:false});
  try{onInsert(request);}catch(e){toast(e.message,true);render();}
 }
 function down(event){
  if(getTool()!=='insert-space'||!getProject()||event.button!==0||panel.contains(event.target))return;
  stop(event);if(pending)return;
  const point=pointAt(event);try{insertionPage(getProject(),point.y);}catch{return;}
  drawing={pointer:event.pointerId,x:point.x,y:point.y,ys:[point.y]};hover=point;
  scroll.setPointerCapture(event.pointerId);render();
 }
 function move(event){
  if(getTool()!=='insert-space'||!getProject()||panel.contains(event.target))return;
  if(pending)return;
  const point=pointAt(event);
  if(drawing&&event.pointerId===drawing.pointer){stop(event);drawing.ys.push(point.y);if(drawing.ys.length>128)drawing.ys.shift();const sorted=[...drawing.ys].sort((a,b)=>a-b);drawing.y=sorted[Math.floor(sorted.length/2)];hover={x:drawing.x,y:drawing.y};}
  else hover=point;
  render();
 }
 function up(event){
  if(!drawing||event.pointerId!==drawing.pointer)return;stop(event);
  const point={x:drawing.x,y:drawing.y};drawing=null;
  if(scroll.hasPointerCapture(event.pointerId))scroll.releasePointerCapture(event.pointerId);
  try{open(point);}catch(e){toast(e.message,true);cancel();}
 }
 function pointerCancel(event){if(drawing&&event.pointerId===drawing.pointer){stop(event);cancel();}}
 function leave(){if(!drawing&&!pending){hover=null;render();}}
 function key(event){
  if(getTool()!=='insert-space')return;
  if(event.key==='Escape'){stop(event);cancel();setTool('move');return;}
  if(pending&&(event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='z'){stop(event);cancel();return;}
  if(pending&&event.key==='Enter'){stop(event);apply();}
 }
 for(const [name,fn] of [['pointerdown',down],['pointermove',move],['pointerup',up],['pointercancel',pointerCancel]])scroll.addEventListener(name,fn,true);
 scroll.addEventListener('pointerleave',leave);document.addEventListener('keydown',key,true);
 for(const button of panel.querySelectorAll('[data-space-cancel]'))button.addEventListener('click',()=>cancel());
 panel.querySelector('[data-space-apply]').addEventListener('click',apply);
 panel.querySelector('[data-space-sample]').addEventListener('click',sample);
 input.addEventListener('input',()=>{slider.value=input.value;refreshPreview();});
 slider.addEventListener('input',()=>{input.value=slider.value;refreshPreview();});
 picker.addEventListener('input',()=>{serial++;if(pending)pending.sampling=false;status.textContent='使用手动颜色';refreshPreview();});
 return {cancel,sync,get previewProject(){return pending?.projectId===getProject()?.id?pending.preview:null;},get active(){return !!drawing||!!pending;},
  markup(state){
   if(getTool()!=='insert-space'||!getProject())return '';
   const p=pending||drawing||hover;if(!p)return '';
   const y=p.y,z=Math.max(.00001,state.zoom),{offset}=documentView(pending?.preview||getProject(),state);
   let valid=true;try{valid=!spaceCutBlockers(getProject(),y,{bubbleSizes:sizes()}).length;}catch{valid=false;}
   const color=valid?'#ff5966':'#ff9a70',width=1280;
   return `<g data-space-guide pointer-events="none" transform="translate(0 ${-offset})"><line x1="0" y1="${y}" x2="${width}" y2="${y}" stroke="${color}" stroke-width="${2/z}" stroke-dasharray="${9/z} ${5/z}"/><rect x="${12/z}" y="${y-31/z}" width="${200/z}" height="${25/z}" rx="${4/z}" fill="#15202c" opacity=".95"/><text x="${20/z}" y="${y-13/z}" fill="white" font-family="'Source Han Sans SC',sans-serif" font-size="${12/z}">${pending?'插入 '+pending.height+' px':valid?'在这里插入底图':'请画在格子间的空隙'}</text></g>`;
  }
 };
}
