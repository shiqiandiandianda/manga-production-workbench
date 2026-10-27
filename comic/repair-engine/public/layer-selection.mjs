import {regionLayers,chosenRegionLayer} from './repair-versions.mjs';
import {canEditRegion,canEditLayer,contentRegion} from './editor-tools.mjs';
// List selection is UI state; saved images and layer geometry stay independent.
export class LayerSelection {
  constructor(){this.order=[];this.ids=new Set();this.anchor=null;}
  get size(){return this.ids.size;}
  get keys(){return this.order.filter(key=>this.ids.has(key));}
  has(key){return this.ids.has(key);}
  reconcile(order){this.order=[...new Set(order)];const valid=new Set(this.order);this.ids=new Set([...this.ids].filter(key=>valid.has(key)));if(!valid.has(this.anchor))this.anchor=this.keys[0]||null;}
  single(key){this.ids=new Set(key?[key]:[]);this.anchor=key||null;}
  select(key,{shiftKey=false,ctrlKey=false,metaKey=false}={}){
    if(!this.order.includes(key))return;
    const additive=ctrlKey||metaKey;
    if(shiftKey&&this.order.includes(this.anchor)){
      const start=this.order.indexOf(this.anchor),end=this.order.indexOf(key),range=this.order.slice(Math.min(start,end),Math.max(start,end)+1);
      this.ids=new Set(additive?[...this.ids,...range]:range);
    }else if(additive){
      if(this.ids.has(key))this.ids.delete(key);else this.ids.add(key);
      this.anchor=key;
    }else this.single(key);
  }
  all(){this.ids=new Set(this.order);if(!this.order.includes(this.anchor))this.anchor=this.order[0]||null;}
  clear(){this.ids.clear();this.anchor=null;}
}
export function resizeInspectorBox(box,delta,edge,viewport,minWidth=280,maxWidth=680){
  const margin=4,right=box.left+box.width,available=edge==='left'?right-margin:viewport.width-box.left-margin;
  const limit=Math.max(1,Math.min(maxWidth,available)),minimum=Math.min(minWidth,limit);
  const width=Math.round(Math.max(minimum,Math.min(limit,box.width+(edge==='left'?-delta:delta))));
  return {left:Math.round(edge==='left'?right-width:box.left),width};
}
export function clampListHeight(height,available){
  return Math.round(Math.max(Math.min(96,available/2),Math.min(height,Math.max(96,available-140))));
}
export function resizeInspectorHeight(box,delta,edge,viewport,minHeight=360){
 const upper=60,lower=Math.max(upper+1,viewport.height-12),top=Math.max(upper,Math.min(lower-1,box.top)),bottom=Math.min(lower,Math.max(top+1,box.top+box.height)),limit=edge==='top'?bottom-upper:lower-top,minimum=Math.min(minHeight,limit);
 const height=Math.round(Math.max(minimum,Math.min(limit,box.height+(edge==='top'?-delta:delta))));return{top:Math.round(edge==='top'?bottom-height:top),height};
}
export function bindInspectorResize(panel,{content,list,splitter,onChange=()=>{}}){
  const widthKey='patch-inspector-width',heightKey='patch-layer-list-height';
  const panelHeightKey='patch-inspector-height',panelTopKey='patch-inspector-top';
  let listHeight=Number(localStorage.getItem(heightKey))||0;
  const savedWidth=Number(localStorage.getItem(widthKey));
  if(savedWidth>=280)panel.style.setProperty('--inspector-user-width',Math.min(680,innerWidth-16,savedWidth)+'px');
  const saveWidth=()=>localStorage.setItem(widthKey,String(Math.round(panel.getBoundingClientRect().width)));
  const layoutList=()=>{if(listHeight&&!panel.classList.contains('multiselect'))list.style.flexBasis=clampListHeight(listHeight,content.clientHeight)+'px';};
  const updateGrip=()=>{
    const width=Math.round(panel.getBoundingClientRect().width);
    for(const grip of panel.querySelectorAll('.inspector-resize')){grip.setAttribute('aria-valuemin','280');grip.setAttribute('aria-valuemax',String(Math.min(680,innerWidth-16)));grip.setAttribute('aria-valuenow',String(width));grip.setAttribute('aria-valuetext',width+' 像素');}
    for(const grip of panel.querySelectorAll('.inspector-height-resize')){grip.setAttribute('aria-valuemin',String(Math.min(360,innerHeight-72)));grip.setAttribute('aria-valuemax',String(innerHeight-72));grip.setAttribute('aria-valuenow',String(Math.round(panel.getBoundingClientRect().height)));grip.setAttribute('aria-valuetext',Math.round(panel.getBoundingClientRect().height)+' 像素');}
    if(listHeight)layoutList();splitter.setAttribute('aria-valuemin','96');splitter.setAttribute('aria-valuemax',String(Math.max(96,content.clientHeight-140)));splitter.setAttribute('aria-valuenow',String(Math.round(list.getBoundingClientRect().height)));onChange();
  };
  const applyHeight=(box,delta,edge)=>{const result=resizeInspectorHeight(box,delta,edge,{height:innerHeight});panel.style.setProperty('--inspector-user-height',result.height+'px');panel.style.top=result.top+'px';updateGrip();};
  const saveHeight=()=>{const box=panel.getBoundingClientRect();localStorage.setItem(panelHeightKey,String(Math.round(box.height)));localStorage.setItem(panelTopKey,String(Math.round(box.top)));};
  const savedHeight=Number(localStorage.getItem(panelHeightKey)),savedTop=Number(localStorage.getItem(panelTopKey));
  if(savedHeight>0)applyHeight({top:savedTop||Number.parseFloat(getComputedStyle(panel).top)||78,height:savedHeight},0,'bottom');
  for(const grip of panel.querySelectorAll('.inspector-height-resize')){
    let drag=null;const edge=grip.dataset.edge;
    grip.addEventListener('pointerdown',event=>{if(event.button!==0||panel.classList.contains('collapsed'))return;event.preventDefault();event.stopPropagation();grip.setPointerCapture(event.pointerId);const box=panel.getBoundingClientRect();drag={id:event.pointerId,y:event.clientY,box:{top:box.top,height:box.height}};panel.classList.add('resizing-height');});
    grip.addEventListener('pointermove',event=>{if(drag&&drag.id===event.pointerId)applyHeight(drag.box,event.clientY-drag.y,edge);});
    for(const type of ['pointerup','pointercancel','lostpointercapture'])grip.addEventListener(type,()=>{if(!drag)return;drag=null;panel.classList.remove('resizing-height');saveHeight();});
    grip.addEventListener('keydown',event=>{if(!['ArrowUp','ArrowDown'].includes(event.key))return;event.preventDefault();event.stopPropagation();applyHeight(panel.getBoundingClientRect(),event.key==='ArrowUp'?-24:24,edge);saveHeight();});
    grip.addEventListener('dblclick',()=>{panel.style.removeProperty('--inspector-user-height');localStorage.removeItem(panelHeightKey);localStorage.removeItem(panelTopKey);const box=panel.getBoundingClientRect();panel.style.top=Math.max(60,Math.min(innerHeight-box.height-12,box.top))+'px';updateGrip();});
  }
  for(const grip of panel.querySelectorAll('.inspector-resize')){
    let drag=null;
    const apply=(box,delta)=>{
      const result=resizeInspectorBox(box,delta,grip.dataset.edge,{width:innerWidth});
      panel.style.setProperty('--inspector-user-width',result.width+'px');panel.style.left=result.left+'px';panel.style.right='auto';updateGrip();
    };
    grip.addEventListener('pointerdown',event=>{
      if(event.button!==0||panel.classList.contains('collapsed'))return;
      event.preventDefault();event.stopPropagation();grip.setPointerCapture(event.pointerId);
      const box=panel.getBoundingClientRect();drag={id:event.pointerId,x:event.clientX,box:{left:box.left,width:box.width}};
      panel.classList.add('resizing');
    });
    grip.addEventListener('pointermove',event=>{if(drag&&event.pointerId===drag.id)apply(drag.box,event.clientX-drag.x);});
    for(const type of ['pointerup','pointercancel','lostpointercapture'])grip.addEventListener(type,()=>{if(!drag)return;drag=null;panel.classList.remove('resizing');saveWidth();});
    grip.addEventListener('keydown',event=>{
      if(!['ArrowLeft','ArrowRight'].includes(event.key))return;event.preventDefault();event.stopPropagation();
      apply(panel.getBoundingClientRect(),event.key==='ArrowLeft'?-24:24);saveWidth();
    });
    grip.addEventListener('dblclick',()=>{
      panel.style.setProperty('--inspector-user-width',Math.min(360,innerWidth-16)+'px');panel.style.left=Math.max(4,Math.min(innerWidth-panel.offsetWidth-4,panel.getBoundingClientRect().left))+'px';panel.style.right='auto';saveWidth();updateGrip();
    });
  }
  let vertical=null;
  const setHeight=value=>{listHeight=clampListHeight(value,content.clientHeight);list.style.flexBasis=listHeight+'px';splitter.setAttribute('aria-valuenow',String(listHeight));onChange();};
  splitter.addEventListener('pointerdown',event=>{if(event.button!==0)return;event.preventDefault();splitter.setPointerCapture(event.pointerId);vertical={id:event.pointerId,y:event.clientY,height:list.getBoundingClientRect().height};});
  splitter.addEventListener('pointermove',event=>{if(vertical&&event.pointerId===vertical.id)setHeight(vertical.height+event.clientY-vertical.y);});
  for(const type of ['pointerup','pointercancel','lostpointercapture'])splitter.addEventListener(type,()=>{if(!vertical)return;vertical=null;localStorage.setItem(heightKey,String(listHeight));});
  splitter.addEventListener('keydown',event=>{if(!['ArrowUp','ArrowDown'].includes(event.key))return;event.preventDefault();event.stopPropagation();setHeight(list.getBoundingClientRect().height+(event.key==='ArrowUp'?-24:24));localStorage.setItem(heightKey,String(listHeight));});
  splitter.addEventListener('dblclick',()=>{listHeight=0;list.style.flexBasis='';localStorage.removeItem(heightKey);onChange();});
  new ResizeObserver(updateGrip).observe(panel);
  window.addEventListener('resize',()=>{
    if(panel.classList.contains('collapsed'))return;
    const box=panel.getBoundingClientRect(),width=Math.min(box.width,innerWidth-16);
    panel.style.setProperty('--inspector-user-width',width+'px');if(panel.style.left)panel.style.left=Math.max(4,Math.min(innerWidth-width-4,box.left))+'px';
    layoutList();onChange();
    if(panel.style.getPropertyValue('--inspector-user-height'))applyHeight(panel.getBoundingClientRect(),0,'bottom');
  });
}

export function planLayerDeletion(keys,regions,layers){
 const regionIds=new Set(),layerIds=new Set(),skipped=[],removed=[];
 for(const key of new Set(keys)){
  if(key.startsWith('region:')){
   const region=regions.find(item=>item.id===key.slice(7));if(!region)continue;
   if(!canEditRegion(region,chosenRegionLayer(region,layers))){skipped.push(key);continue;}
   regionIds.add(region.id);for(const layer of regionLayers(region,layers))layerIds.add(layer.id);removed.push(key);
  }else if(key.startsWith('layer:')){
   const layer=layers.find(item=>item.id===key.slice(6));if(!layer)continue;
   if(!canEditLayer(layer,contentRegion(layer,regions))){skipped.push(key);continue;}layerIds.add(layer.id);removed.push(key);
  }
 }
 return{regionIds:[...regionIds],layerIds:[...layerIds],skipped,removed};
}
