import {panelDisplayMarkup} from './panel-display.js';
import {generationPromptSelection} from './prompt-source.js';
import {panelNoteBox} from './panel-note-layout.js';
export const PANEL_INFO_WIDTH=280,PANEL_INFO_FONT_SIZE=13;
export function placePanelInfo(anchors,{matrix,origin,width,height}){
 if(!matrix||width<32||height<32)return [];
 const cardWidth=Math.min(PANEL_INFO_WIDTH,width-16),out=[];
 for(const anchor of [...anchors].reverse()){
  const b=anchor.box,x=matrix.a*b.x+matrix.c*b.y+matrix.e-origin.left,y=matrix.b*b.x+matrix.d*b.y+matrix.f-origin.top;
  const w=Math.abs(matrix.a*b.w)+Math.abs(matrix.c*b.h),h=Math.abs(matrix.b*b.w)+Math.abs(matrix.d*b.h);
  if(anchor.displayMode){
   const left=Math.max(0,x),top=Math.max(0,y),right=Math.min(width,x+w),bottom=Math.min(height,y+h),visibleW=right-left,visibleH=bottom-top;
   const available=panelNoteBox({x:left,y:top,w:visibleW,h:visibleH},out.map(p=>({x:p.left,y:p.top,w:p.width,h:p.height})),4);
   if(!available||available.w<64||available.h<28)continue;const blockWidth=Math.min(anchor.displayMode==='technical'?320:520,available.w-8),blockHeight=Math.min(anchor.displayMode==='technical'?76:340,available.h-6);
   out.push({...anchor,left:available.x+(available.w-blockWidth)/2,top:available.y+(available.h-blockHeight)/2,width:blockWidth,height:blockHeight});continue;
  }
  if(anchor.placeholder){
   if(w<64||h<56||x+w<0||x>width||y+h<0||y>height)continue;
   const blockWidth=Math.min(520,w-16),blockHeight=Math.min(340,h-16);
   out.push({...anchor,left:x+(w-blockWidth)/2,top:y+(h-blockHeight)/2,width:blockWidth,height:blockHeight});continue;
  }
  if(w<48||h<24||x+w<0||x>width||y+h<0||y>height||y<-100)continue;
  out.push({...anchor,left:Math.max(8,Math.min(x+8,width-cardWidth-8)),top:Math.max(8,y+8),width:cardWidth});
 }
 return out.reverse();
}
export function panelInfoMarkup(frame,shot,escape){
 const prompt=generationPromptSelection(frame,{shots:shot?[shot]:[]}).text;return '<div class="panel-info-heading"><strong>'+escape(shot?.code||frame.name||'画格')+'</strong></div><div class="panel-info-sections"><section class="panel-info-section"><strong>分镜表提示词</strong><div class="panel-info-section-content">'+escape(prompt)+'</div></section><section class="panel-info-section"><strong>画面内容</strong><div class="panel-info-section-content">'+escape(shot?.description||'')+'</div></section></div>';
}
export function initPanelInfoUI({root,stage,scroll,getProject,getSelectedPanelId=()=>null,escape,onSelect}){
 root.innerHTML='<div class="panel-info-cards"></div>';const cards=root.firstElementChild;let lastAnchors=[],shown=false;
 const locate=id=>{const project=getProject();for(const page of project?.pages||[]){const frame=page.panels.find(frame=>frame.id===id);if(frame)return {project,page,frame};}return null;};
 function render(anchors,visible){lastAnchors=anchors;shown=visible;cards.hidden=!visible;if(!visible){cards.replaceChildren();return;}const rect=root.getBoundingClientRect(),placed=placePanelInfo(anchors,{matrix:stage.getScreenCTM(),origin:rect,width:scroll.clientWidth,height:scroll.clientHeight});cards.innerHTML=placed.map(anchor=>{const found=locate(anchor.panelId);if(!found)return '';const shot=found.project.shots.find(shot=>shot.id===found.frame.shotId);return '<article class="panel-shot-info '+(anchor.displayMode?'panel-mode-info':'panel-placeholder-info')+'" data-info-panel="'+escape(anchor.panelId)+'" '+(anchor.displayMode?'data-panel-display-mode="'+escape(anchor.displayMode)+'" ':'')+'style="left:'+anchor.left+'px;top:'+anchor.top+'px;width:'+anchor.width+'px;'+(anchor.height?'height:'+anchor.height+'px;':'')+'">'+(anchor.displayMode?panelDisplayMarkup(found.frame,shot,escape,anchor.displayMode,found.project):panelInfoMarkup(found.frame,shot,escape))+'</article>';}).join('');}
 root.addEventListener('click',event=>{const card=event.target.closest('[data-info-panel]'),found=card&&locate(card.dataset.infoPanel);if(found&&getSelectedPanelId()!==found.frame.id)onSelect(found.frame.id,found.page.id);});
 root.addEventListener('wheel',event=>{const text=event.target.closest('.panel-info-section-content,.panel-mode-content');if(!event.ctrlKey&&text&&((event.deltaY>0&&text.scrollTop+text.clientHeight<text.scrollHeight-1)||(event.deltaY<0&&text.scrollTop>0))){event.stopPropagation();return;}event.preventDefault();const forwarded=new WheelEvent('wheel',{deltaX:event.deltaX,deltaY:event.deltaY,deltaMode:event.deltaMode,ctrlKey:event.ctrlKey,clientX:event.clientX,clientY:event.clientY,cancelable:true});scroll.dispatchEvent(forwarded);if(!forwarded.defaultPrevented&&!event.ctrlKey){const factor=event.deltaMode===1?16:event.deltaMode===2?scroll.clientHeight:1;scroll.scrollTop+=event.deltaY*factor;scroll.scrollLeft+=event.deltaX*factor;}},{passive:false});
 return {render,refresh:()=>render(lastAnchors,shown)};
}
