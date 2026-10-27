import {COMIC_PAGE_WIDTH,layoutLongStrip,pageAtStripPoint,visibleStripPages,clamp} from './model.js';

export const MAX_VIEWPORT_CSS_HEIGHT=1000000;
export const VIEWPORT_OVERSCAN=384;
/** Logical document length is independent of browser CSS/texture limits. */
export function calculateViewport(layout,{zoom=1,scrollTop=0,viewportHeight=800,overscan=VIEWPORT_OVERSCAN,maxPhysicalHeight=MAX_VIEWPORT_CSS_HEIGHT,logicalTop=null}={}) {
  if(!layout||!Number.isSafeInteger(layout.height)||layout.height<0||!Number.isFinite(zoom)||zoom<=0)throw new Error('画布视窗参数无效');
  viewportHeight=Math.max(1,Number.isFinite(viewportHeight)?viewportHeight:800);
  overscan=Math.max(0,Number.isFinite(overscan)?overscan:VIEWPORT_OVERSCAN);
  const physicalHeight=Math.max(viewportHeight,Math.min(Math.max(viewportHeight,maxPhysicalHeight),layout.height*zoom));
  const physicalMax=Math.max(0,physicalHeight-viewportHeight),logicalVisibleHeight=viewportHeight/zoom;
  const logicalMax=Math.max(0,layout.height-logicalVisibleHeight),compressed=layout.height*zoom>physicalHeight;
  scrollTop=clamp(Number.isFinite(scrollTop)?scrollTop:0,0,physicalMax);
  const top=clamp(Number.isFinite(logicalTop)?logicalTop:compressed?(physicalMax?scrollTop/physicalMax*logicalMax:0):scrollTop/zoom,0,logicalMax);
  const startY=Math.max(0,top-overscan/zoom),endY=Math.min(layout.height,top+logicalVisibleHeight+overscan/zoom);
  const height=Math.max(1,endY-startY);
  return {startY,endY,height,logicalTop:top,logicalVisibleHeight,logicalMax,physicalHeight,physicalMax,scrollTop,compressed,stageTop:Math.max(0,scrollTop-(top-startY)*zoom),visiblePages:visibleStripPages(layout,startY,endY)};
}
export function scrollPositionForY(layout,y,{zoom=1,viewportHeight=800,maxPhysicalHeight=MAX_VIEWPORT_CSS_HEIGHT}={}) {
  const window=calculateViewport(layout,{zoom,viewportHeight,maxPhysicalHeight});
  const target=clamp(Number.isFinite(y)?y:0,0,window.logicalMax);
  return window.compressed?(window.logicalMax?target/window.logicalMax*window.physicalMax:0):target*zoom;
}

/** Keep #stage finite. Its viewBox uses logical strip coordinates for accurate pointer mapping. */
export function createViewportController({scroll,stage,onRender=()=>{},onModeChange=()=>{},onZoomChange=()=>{},mode='continuous',maxPhysicalHeight=MAX_VIEWPORT_CSS_HEIGHT,padding=24}={}) {
  if(!scroll||!stage)throw new Error('缺少漫画画布容器');
  const documentElement=scroll.ownerDocument.createElement('div');
  documentElement.id='canvas-document';documentElement.className='canvas-document';
  scroll.append(documentElement);documentElement.append(stage);
  stage.classList.add('viewport-stage');
  let panX=0,panY=0;let pages=[],decorations=null,currentPageId=null,zoom=1,currentMode='continuous',layout=layoutLongStrip([]),window=null,frame=null,destroyed=false,logicalTopOverride=null,expectedScroll=null;
  const ownerWindow=scroll.ownerDocument.defaultView||globalThis;
  const requestFrame=ownerWindow.requestAnimationFrame?.bind(ownerWindow)||((callback)=>setTimeout(callback,0));
  const cancelFrame=ownerWindow.cancelAnimationFrame?.bind(ownerWindow)||clearTimeout;
  const viewportHeight=()=>Math.max(1,scroll.clientHeight-padding*2);
  function buildLayout() {
    const current=pages.find(page=>page.id===currentPageId)||pages[0];
    const displayed=decorations&&pages.length?[decorations.cover.page,...pages,decorations.tail.page]:pages;
    layout=layoutLongStrip(displayed,{width:COMIC_PAGE_WIDTH});
  }
  function snapshot() {
    window=calculateViewport(layout,{zoom,scrollTop:scroll.scrollTop,viewportHeight:viewportHeight(),maxPhysicalHeight,logicalTop:logicalTopOverride});
    return {mode:currentMode,zoom,layout,window,currentPageId,decorations:currentMode==='continuous'&&pages.length?decorations:null};
  }
  function apply() {
    const state=snapshot(),width=layout.width*zoom,documentWidth=Math.max(scroll.clientWidth,width+padding*2);
    documentElement.style.width=documentWidth+'px';
    documentElement.style.height=(state.window.physicalHeight+padding*2)+'px';
    documentElement.dataset.compressed=String(state.window.compressed);
    stage.setAttribute('viewBox','0 '+state.window.startY+' '+layout.width+' '+state.window.height);
    stage.setAttribute('width',String(width));stage.setAttribute('height',String(state.window.height*zoom));
    stage.style.left=((documentWidth-width)/2+panX)+'px';
    stage.style.top=(padding+state.window.stageTop+panY)+'px';
    stage.dataset.viewMode=currentMode;stage.dataset.panX=String(panX);stage.dataset.panY=String(panY);
    return state;
  }
  function requestRender() {
    if(destroyed||frame!==null)return;
    frame=requestFrame(()=>{frame=null;const state=apply();onRender(state);});
  }
  function onScroll() {
    if(expectedScroll===null||Math.abs(scroll.scrollTop-expectedScroll)>.5)logicalTopOverride=null;
    expectedScroll=null;requestRender();
  }
  function wheelDelta(event) {
    return event.deltaY*(event.deltaMode===1?16:event.deltaMode===2?viewportHeight():1);
  }
  // Ctrl+wheel changes only the artwork scale, keeping the point under the mouse in place.
  function onWheel(event) {
    const state=snapshot();
    if(event.ctrlKey) {
      event.preventDefault();
      const delta=wheelDelta(event);
      if(!layout.pages.length||!Number.isFinite(delta)||delta===0)return;
      const minimumZoom=Math.min(.01,viewportHeight()/Math.max(1,layout.height));
      const nextZoom=clamp(zoom*Math.exp(-clamp(delta,-500,500)*.0015),Math.min(minimumZoom,zoom),Math.max(8,zoom));
      if(nextZoom===zoom)return;
      const rect=scroll.getBoundingClientRect();
      const cursorX=Number.isFinite(event.clientX)?clamp(event.clientX-rect.left-(scroll.clientLeft||0),0,scroll.clientWidth):scroll.clientWidth/2;
      const cursorY=Number.isFinite(event.clientY)?clamp(event.clientY-rect.top-(scroll.clientTop||0),0,scroll.clientHeight):scroll.clientHeight/2;
      const oldWidth=layout.width*zoom,oldLeft=(Math.max(scroll.clientWidth,oldWidth+padding*2)-oldWidth)/2;
      const anchorX=((scroll.scrollLeft||0)+cursorX-oldLeft)/zoom;
      const anchorY=state.window.logicalTop+(cursorY-padding)/zoom;
      zoom=nextZoom;
      const nextWindow=calculateViewport(layout,{zoom,viewportHeight:viewportHeight(),maxPhysicalHeight});
      logicalTopOverride=clamp(anchorY-(cursorY-padding)/zoom,0,nextWindow.logicalMax);
      // Resize before assigning scrollTop, so a growing document does not clamp to the old height.
      documentElement.style.height=(nextWindow.physicalHeight+padding*2)+'px';
      expectedScroll=scrollPositionForY(layout,logicalTopOverride,{zoom,viewportHeight:viewportHeight(),maxPhysicalHeight});
      scroll.scrollTop=expectedScroll;
      const nextState=apply(),newWidth=layout.width*zoom,newDocumentWidth=Math.max(scroll.clientWidth,newWidth+padding*2);
      scroll.scrollLeft=clamp((newDocumentWidth-newWidth)/2+anchorX*zoom-cursorX,0,newDocumentWidth-scroll.clientWidth);
      onZoomChange(zoom,nextState);requestRender();return;
    }
    // On an enormous compressed document ordinary wheel movement stays at editing scale.
    if(!state.window.compressed||Math.abs(event.deltaX)>Math.abs(event.deltaY))return;
    event.preventDefault();
    const delta=wheelDelta(event);
    if(!Number.isFinite(delta))return;
    logicalTopOverride=clamp(state.window.logicalTop+delta/zoom,0,state.window.logicalMax);
    expectedScroll=scrollPositionForY(layout,logicalTopOverride,{zoom,viewportHeight:viewportHeight(),maxPhysicalHeight});
    scroll.scrollTop=expectedScroll;requestRender();
  }
  function set(next={}) {
    const previous=window||snapshot().window,previousMode=currentMode,oldZoom=zoom,oldPageId=currentPageId;
    if(next.pages!==undefined)pages=next.pages;
    if(next.decorations!==undefined)decorations=next.decorations;
    if(next.currentPageId!==undefined)currentPageId=next.currentPageId;
    if(next.zoom!==undefined) {
      if(!Number.isFinite(next.zoom)||next.zoom<=0)throw new Error('缩放比例无效');
      zoom=next.zoom;
    }
    buildLayout();
    if(previousMode!==currentMode||currentMode==='page'&&oldPageId!==currentPageId) {
      logicalTopOverride=null;scroll.scrollTop=0;
    } else if(oldZoom!==zoom) {
      logicalTopOverride=previous.logicalTop;
      const nextWindow=calculateViewport(layout,{zoom,viewportHeight:viewportHeight(),maxPhysicalHeight});
      documentElement.style.height=(nextWindow.physicalHeight+padding*2)+'px';
      expectedScroll=scrollPositionForY(layout,logicalTopOverride,{zoom,viewportHeight:viewportHeight(),maxPhysicalHeight});
      scroll.scrollTop=expectedScroll;
    }
    return apply();
  }
  
  function panBy(dx,dy){if(!Number.isFinite(dx)||!Number.isFinite(dy))return;const state=snapshot(),desired=state.window.logicalTop-(dy+panY)/zoom;panX+=dx;logicalTopOverride=clamp(desired,0,state.window.logicalMax);panY=(logicalTopOverride-desired)*zoom;expectedScroll=scrollPositionForY(layout,logicalTopOverride,{zoom,viewportHeight:viewportHeight(),maxPhysicalHeight});scroll.scrollTop=expectedScroll;apply();requestRender();}
  function scrollToPage(pageId,{localY=0}={}) {panX=0;panY=0;
    const entry=layout.pages.find(page=>page.pageId===pageId);
    if(!entry)return false;
    logicalTopOverride=entry.y+Math.max(0,localY)*entry.scale;
    expectedScroll=scrollPositionForY(layout,logicalTopOverride,{zoom,viewportHeight:viewportHeight(),maxPhysicalHeight});
    scroll.scrollTop=expectedScroll;apply();requestRender();return true;
  }
  scroll.addEventListener('scroll',onScroll,{passive:true});
  scroll.addEventListener('wheel',onWheel,{passive:false});
  apply();
  return {
    set,panBy,getMode:()=>currentMode,snapshot,refresh:apply,scrollToPage,scrollToY:y=>{logicalTopOverride=Math.max(0,y);expectedScroll=scrollPositionForY(layout,logicalTopOverride,{zoom,viewportHeight:viewportHeight(),maxPhysicalHeight});scroll.scrollTop=expectedScroll;apply();requestRender();return true;},
    hitTest:point=>pageAtStripPoint(layout,point),
    selectionPage:selection=>pages.find(page=>(selection?.type==='bubble'?page.bubbles:page.panels)?.some(item=>item.id===selection?.id))||null,
    destroy() {destroyed=true;if(frame!==null)cancelFrame(frame);scroll.removeEventListener('scroll',onScroll);scroll.removeEventListener('wheel',onWheel);},
  };
}

/** The canvas is the default workspace; every panel can immediately be reopened, including on phones. */
export function initWorkbenchChrome({root=globalThis.document,onChange=()=>{}}={}) {
  const shell=root.querySelector('.app-shell'),sidebar=root.querySelector('.sidebar'),inspector=root.querySelector('.inspector'),jobs=root.querySelector('.job-tray');
  if(!shell)return null;
  const state={sidebar:false,inspector:false,jobs:false},listeners=[];
  function apply() {
    shell.classList.toggle('sidebar-collapsed',!state.sidebar);
    shell.classList.toggle('inspector-collapsed',!state.inspector);
    jobs?.classList.toggle('collapsed',!state.jobs);
    sidebar?.classList.toggle('mobile-hidden',!state.sidebar);
    inspector?.classList.toggle('mobile-hidden',!state.inspector);
    for(const [id,key] of [['inspector-toggle','inspector'],['jobs-toggle','jobs']]) {
      const button=root.querySelector('#'+id);
      button?.setAttribute('aria-expanded',String(state[key]));
      if(id==='jobs-toggle'&&button)(button.querySelector?.('[data-job-label]')||button).textContent=state.jobs?'收起任务':'查看任务';
    }
    onChange({...state});
  }
  const set=(key,value)=>{state[key]=Boolean(value);apply();};
  for(const [id,key,value] of [['sidebar-close','sidebar',false],['inspector-toggle','inspector',null],['inspector-close','inspector',false],['jobs-toggle','jobs',null]]) {
    const element=root.querySelector('#'+id);
    if(!element)continue;
    const listener=()=>set(key,value===null?!state[key]:value);
    element.addEventListener('click',listener);listeners.push([element,listener]);
  }
  const onKey=event=>{
    if(event.key==='Escape'&&!root.querySelector('dialog[open]')) {
      state.sidebar=false;state.inspector=false;apply();
    }
  };
  root.addEventListener('keydown',onKey);apply();
  return {
    openSidebar:()=>set('sidebar',true),closeSidebar:()=>set('sidebar',false),
    openInspector:()=>set('inspector',true),closeInspector:()=>set('inspector',false),
    openJobs:()=>set('jobs',true),closeJobs:()=>set('jobs',false),
    snapshot:()=>({...state}),
    destroy(){for(const [element,listener] of listeners)element.removeEventListener('click',listener);root.removeEventListener('keydown',onKey);},
  };
}
