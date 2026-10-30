import {findLayer} from './layers.js';
import {assetUrl} from './asset-url.js';
import {panelReferencePreview} from './panel-reference-preview-model.js';
import {productionSegment} from './production-package-model.js';

const clamp=(v,min,max)=>Math.max(min,Math.min(v,max));
const validPanel=entry=>entry?.type==='panel'&&!entry.item.cutoutLayer&&!entry.item.sfxImage&&!entry.item.breakoutForeground&&!entry.item.designDecoration;
export function mountPanelReferencePreview({toolbar,getState}){
 const shortcut=document.createElement('button');shortcut.id='canvas-reference-preview';shortcut.type='button';shortcut.innerHTML='<b aria-hidden="true">▧</b><span>参考图</span>';shortcut.title='查看本格人物与场景参考图';shortcut.setAttribute('aria-controls','panel-reference-preview');shortcut.setAttribute('aria-pressed','false');
 toolbar.addAction(shortcut,{visible:state=>validPanel(findLayer(state.project,state.keys[0]))});
 const root=document.createElement('section');root.id='panel-reference-preview';root.className='panel-reference-preview';root.hidden=true;root.setAttribute('role','dialog');root.setAttribute('aria-modal','false');root.setAttribute('aria-label','本格参考图预览');
 root.innerHTML='<header tabindex="0" title="拖动标题移动窗口"><strong>本格参考图</strong><button type="button" data-ref-preview-close aria-label="关闭参考图预览">×</button></header><div class="panel-reference-preview-context" data-ref-preview-context></div><div class="panel-reference-preview-controls"><button type="button" data-ref-preview-role="character" aria-pressed="true">人物</button><button type="button" data-ref-preview-role="scene" aria-pressed="false">场景</button><select data-ref-preview-choice aria-label="本格参考图片"></select></div><div class="panel-reference-preview-viewport" data-ref-preview-viewport><img class="panel-reference-preview-image" data-ref-preview-image alt="" draggable="false" hidden><div class="panel-reference-preview-message" data-ref-preview-message role="status"></div></div><footer class="panel-reference-preview-zoom"><button type="button" data-ref-preview-zoom="out" aria-label="缩小参考图">−</button><output data-ref-preview-scale>—</output><button type="button" data-ref-preview-zoom="in" aria-label="放大参考图">＋</button><button type="button" data-ref-preview-fit>适应窗口</button><button type="button" data-ref-preview-original>100%</button></footer><button type="button" class="panel-reference-preview-resize" data-ref-preview-resize aria-label="调整参考图窗口大小" title="拖动调整窗口大小"></button>';
 document.body.append(root);
 const $=s=>root.querySelector(s),image=$('[data-ref-preview-image]'),viewport=$('[data-ref-preview-viewport]'),choice=$('[data-ref-preview-choice]'),storageKey='comic-panel-reference-window-v1';
 let category='character',items=[],selected='',stamp='',ticket=0,loaded=false,natural={w:0,h:0},scale=1,pan={x:0,y:0},fitMode=true,gesture=null,positioned=false;
 let geometry={x:0,y:0,w:430,h:540};try{const stored=JSON.parse(localStorage.getItem(storageKey));if(['x','y','w','h'].every(k=>Number.isFinite(stored?.[k]))){geometry=stored;positioned=true;}}catch{}
 function place(){const w=Math.max(1,innerWidth-16),h=Math.max(1,innerHeight-16);geometry.w=clamp(geometry.w,Math.min(320,w),w);geometry.h=clamp(geometry.h,Math.min(270,h),h);geometry.x=clamp(geometry.x,8,Math.max(8,innerWidth-geometry.w-8));geometry.y=clamp(geometry.y,8,Math.max(8,innerHeight-geometry.h-8));Object.assign(root.style,{left:geometry.x+'px',top:geometry.y+'px',width:geometry.w+'px',height:geometry.h+'px'});}
 function saveGeometry(){try{localStorage.setItem(storageKey,JSON.stringify(geometry));}catch{}}
 function message(text){const node=$('[data-ref-preview-message]');node.textContent=text;node.hidden=!text;}
 function paint(){if(!loaded)return;image.style.transform=`translate(-50%,-50%) translate(${pan.x}px,${pan.y}px) scale(${scale})`;$('[data-ref-preview-scale]').value=Math.round(scale*100)+'%';}
 function fit(){if(!loaded)return;scale=clamp(Math.min(viewport.clientWidth/natural.w,viewport.clientHeight/natural.h)*.94,.02,8);pan={x:0,y:0};fitMode=true;paint();}
 function zoom(value,anchor={x:0,y:0}){if(!loaded)return;const next=clamp(value,.02,8),factor=next/scale;pan={x:anchor.x-(anchor.x-pan.x)*factor,y:anchor.y-(anchor.y-pan.y)*factor};scale=next;fitMode=false;paint();}
 function controls(){for(const button of root.querySelectorAll('[data-ref-preview-zoom],[data-ref-preview-fit],[data-ref-preview-original]'))button.disabled=!loaded;}
 function clear(){ticket++;loaded=false;natural={w:0,h:0};image.hidden=true;image.removeAttribute('src');image.alt='';delete root.dataset.assetId;$('[data-ref-preview-scale]').value='—';controls();}
 function load(item){clear();if(!item){message(!root.dataset.panelId?'请选择一个格子':'本格没有已采用的'+(category==='character'?'人物':'场景')+'参考图');return;}
  root.dataset.assetId=item.assetId;message('正在读取参考图…');const turn=ticket,loader=new Image();
  loader.onload=()=>{if(root.hidden||turn!==ticket)return;natural={w:loader.naturalWidth,h:loader.naturalHeight};if(!natural.w||!natural.h){message('参考图无法读取');return;}image.src=loader.src;image.alt=[item.name,item.state,item.purpose==='blocking'?'站位图':''].filter(Boolean).join(' · ');image.style.width=natural.w+'px';image.style.height=natural.h+'px';loaded=true;image.hidden=false;message('');controls();fit();};
  loader.onerror=()=>{if(turn===ticket&&!root.hidden)message('参考图读取失败，请检查原图是否可用');};loader.src=assetUrl(item.assetId);
 }
 function list(){const rows=items.filter(item=>item.role===category).sort((a,b)=>Number(a.purpose==='blocking')-Number(b.purpose==='blocking')),previous=selected;selected=rows.some(item=>item.key===selected)?selected:rows[0]?.key||'';choice.replaceChildren();
  for(const item of rows){const option=document.createElement('option');option.value=item.key;option.textContent=[item.name,item.state,item.purpose==='blocking'&&!/站位图/u.test(item.name)?'站位图':''].filter(Boolean).join(' · ');choice.append(option);}choice.disabled=!rows.length;choice.value=selected;
  for(const button of root.querySelectorAll('[data-ref-preview-role]')){const role=button.dataset.refPreviewRole;button.setAttribute('aria-pressed',String(role===category));button.textContent=(role==='character'?'人物':'场景')+' '+items.filter(item=>item.role===role).length;}
  if(previous!==selected||!loaded)load(rows.find(item=>item.key===selected));
 }
 function sync(){if(root.hidden)return;const state=getState(),panel=state.fixed?null:state.panel,project=state.project,assets=state.assets||[],source=panel&&productionSegment(project,panel.productionSegment||panel.productionBackground);
  const next=JSON.stringify([project?.id,project?.revision,panel?.id,panel?.referenceIds,panel?.referenceNeedBindings,panel?.referenceTextBindings,panel?.generation?.referenceRoles,source?.references,project?.references,project?.assetBindings,project?.assetWorkspaceTrash,assets.map(a=>[a.id,a.library?.revisionId,a.library?.sha256,a.name,a.libraryName,a.libraryState,a.libraryRole,a.productionStatus,a.deletedAt,a.trashedAt])]);if(next===stamp)return;stamp=next;
  $('[data-ref-preview-context]').textContent=panel?(panel.name||project.shots?.find(s=>s.id===panel.shotId)?.code||'当前格'):'请选择一个格子';
  const previousAsset=items.find(item=>item.key===selected),oldPanel=root.dataset.panelId;items=[];if(panel&&project){root.dataset.panelId=panel.id;try{items=panelReferencePreview(project,panel,assets);}catch{selected='';clear();list();message('本格参考信息暂不可用');return;}}else delete root.dataset.panelId;
  if(oldPanel!==panel?.id){selected='';clear();}const current=items.find(item=>item.key===selected);if(previousAsset&&current&&previousAsset.revisionId!==current.revisionId)clear();list();
 }
 function close(){root.hidden=true;clear();stamp='';gesture=null;shortcut.setAttribute('aria-pressed','false');}
 shortcut.onclick=()=>{if(!root.hidden){close();return;}root.hidden=false;shortcut.setAttribute('aria-pressed','true');if(!positioned){const box=shortcut.getBoundingClientRect();geometry.x=box.right+12;geometry.y=box.top;positioned=true;}place();stamp='';sync();};
 $('[data-ref-preview-close]').onclick=close;
 choice.onchange=()=>{selected=choice.value;load(items.find(item=>item.key===selected));};
 for(const button of root.querySelectorAll('[data-ref-preview-role]'))button.onclick=()=>{category=button.dataset.refPreviewRole;selected='';clear();list();};
 for(const button of root.querySelectorAll('[data-ref-preview-zoom]'))button.onclick=()=>zoom(scale*(button.dataset.refPreviewZoom==='in'?1.25:.8));
 $('[data-ref-preview-fit]').onclick=fit;$('[data-ref-preview-original]').onclick=()=>{pan={x:0,y:0};zoom(1);};
 viewport.addEventListener('wheel',event=>{event.preventDefault();event.stopPropagation();const box=viewport.getBoundingClientRect();zoom(scale*Math.exp(clamp(-event.deltaY,-300,300)*.002),{x:event.clientX-box.left-box.width/2,y:event.clientY-box.top-box.height/2});},{passive:false});
 root.addEventListener('pointerdown',event=>{event.stopPropagation();if(event.button!==0)return;const kind=event.target.closest('[data-ref-preview-resize]')?'resize':event.target.closest('header')&&!event.target.closest('button')?'move':event.target.closest('[data-ref-preview-viewport]')&&loaded?'pan':'';if(!kind)return;event.preventDefault();gesture={kind,id:event.pointerId,x:event.clientX,y:event.clientY,geometry:{...geometry},pan:{...pan}};root.setPointerCapture(event.pointerId);});
 root.addEventListener('pointermove',event=>{if(!gesture||event.pointerId!==gesture.id)return;const dx=event.clientX-gesture.x,dy=event.clientY-gesture.y;if(gesture.kind==='pan'){pan={x:gesture.pan.x+dx,y:gesture.pan.y+dy};paint();}else if(gesture.kind==='move'){geometry={...gesture.geometry,x:gesture.geometry.x+dx,y:gesture.geometry.y+dy};place();}else{geometry={...gesture.geometry,w:gesture.geometry.w+dx,h:gesture.geometry.h+dy};place();if(fitMode)fit();}});
 function finish(event){if(!gesture||event.pointerId!==gesture.id)return;gesture=null;if(root.hasPointerCapture(event.pointerId))root.releasePointerCapture(event.pointerId);saveGeometry();}
 root.addEventListener('pointerup',finish);root.addEventListener('pointercancel',finish);root.addEventListener('lostpointercapture',()=>{gesture=null;});
 root.addEventListener('keydown',event=>{event.stopPropagation();if(event.key==='Escape'){event.preventDefault();close();shortcut.focus();}if(event.target.matches('[data-ref-preview-resize]')&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)){event.preventDefault();geometry.w+=event.key==='ArrowLeft'?-16:event.key==='ArrowRight'?16:0;geometry.h+=event.key==='ArrowUp'?-16:event.key==='ArrowDown'?16:0;place();saveGeometry();}});
 const observer=new ResizeObserver(()=>{if(!root.hidden&&fitMode)fit();});observer.observe(viewport);
 const resize=()=>{if(!root.hidden)place();};window.addEventListener('resize',resize);
 return {sync,close,destroy(){close();observer.disconnect();window.removeEventListener('resize',resize);shortcut.remove();root.remove();}};
}
