import {editDialogueSegment,dialogueSegments,segmentBubble} from './bubble-dialogue-segments.js';
import {isLibrarySfx,scaleSfx,sfxRotation} from './sfx-library.js';
import {saveBubbleTextFlow,freezeBubbleTextLayout} from './bubble-text-flow.js';
import {normalizeBubbleStyle,bubbleTextBox,bubbleTailGeometry,bubbleShapePoints,validBubblePoints,bubbleOutlinePoints} from './lettering.js';
import {applyBubbleMaterial,clearBubbleMaterial,defaultBubbleMaterial} from './bubble-material.js';
import {validAssetContour} from './comic-styles.js';
import {bubbleBoundary,projectPointToBoundary} from './bubble-tail-anchor.js';
import {editBubblePart} from './bubble-parts.js';
const finite=(value,fallback=0)=>Number.isFinite(value)?value:fallback;
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const copy=bubble=>structuredClone(bubble);

// All returned coordinates are page pixels. The stored textBox remains local to its bubble.
export function bubbleEditGeometry(bubble){
  const style=normalizeBubbleStyle(bubble),box=bubbleTextBox(bubble,style),tail=bubbleTailGeometry(bubble),x=finite(bubble.x),y=finite(bubble.y),w=Math.max(30,finite(bubble.w,100)),h=Math.max(20,finite(bubble.h,60));
  return {x,y,w,h,textBox:{x:x+box.x,y:y+box.y,w:box.w,h:box.h},tail:tail?{x:x+tail.tip.x,y:y+tail.tip.y}:null,
    points:(validBubblePoints(bubble.points)?bubble.points:bubbleShapePoints('custom')).map(p=>({x:x+p.x*w,y:y+p.y*h}))};
}
export function applyBubbleEdit(bubble,change){
  if(['segment-move','segment-resize'].includes(change.type))return editDialogueSegment(bubble,change.index,{dx:finite(change.dx),dy:finite(change.dy),resize:change.type==='segment-resize'});
  if(change.type==='part-move'||change.type==='part-resize')return editBubblePart(bubble,change.index,{dx:finite(change.dx),dy:finite(change.dy),resize:change.type==='part-resize'});
  let next=copy(bubble);const geometry=bubbleEditGeometry(bubble),dx=finite(change.dx),dy=finite(change.dy);
  if(change.type==='tail-width'){
    if(bubble.locked)return next;const g=bubbleTailGeometry({...bubble,tail:{...bubble.tail,visible:true}}),path=bubbleBoundary(bubbleOutlinePoints(bubble));if(!g?.anchor||!path)return next;
    let width=change.width;
    if(!Number.isFinite(width)){
      const projected=projectPointToBoundary(path,{x:change.x-geometry.x,y:change.y-geometry.y});if(!projected)return next;
      const delta=Math.abs(projected.t-g.anchorT),span=Math.min(delta,1-delta)*path.length,axis=g.side==='top'||g.side==='bottom'?geometry.w:geometry.h;width=2*span/axis;
    }
    const tail=next.tail||{},hasTip=Number.isFinite(tail.x)&&Number.isFinite(tail.y);
    next.tail={...tail,...(hasTip?{}:{mode:'absolute',x:geometry.x+g.tip.x,y:geometry.y+g.tip.y}),width:clamp(width,.01,.8),anchorT:g.anchorT,visible:true};
    if(next.styleTextureId&&next.outlineWidth===0)next.outlineWidth=Number.isFinite(next.materialOutlineWidth)?next.materialOutlineWidth:2.8;
    return next;
  }
  if(change.type==='tail-anchor'){
    if(bubble.locked)return next;const path=bubbleBoundary(bubbleOutlinePoints(bubble,geometry.w,geometry.h));if(!path)return next;
    const projected=Number.isFinite(change.anchorT)?{t:clamp(change.anchorT,0,1)}:projectPointToBoundary(path,{x:change.x-geometry.x,y:change.y-geometry.y});if(!projected)return next;
    const tail=next.tail||{},hasTip=Number.isFinite(tail.x)&&Number.isFinite(tail.y);next.tail={...tail,...(hasTip?{}:{mode:'absolute',x:geometry.tail?.x??geometry.x+geometry.w*.57,y:geometry.tail?.y??geometry.y+geometry.h+30}),anchorT:projected.t,visible:true};
    if(next.styleTextureId&&next.outlineWidth===0)next.outlineWidth=Number.isFinite(next.materialOutlineWidth)?next.materialOutlineWidth:2.8;
    return next;
  }
  if(isLibrarySfx(bubble)&&['sfx-scale','sfx-rotate'].includes(change.type)){
    const cx=geometry.x+geometry.w/2,cy=geometry.y+geometry.h/2;
    if(change.type==='sfx-scale')return scaleSfx(bubble,Math.hypot(change.x-cx,change.y-cy)/Math.max(1,Math.hypot(change.startX-cx,change.startY-cy)));
    const delta=Math.atan2(change.y-cy,change.x-cx)-Math.atan2(change.startY-cy,change.startX-cx);next.rotation=((sfxRotation(bubble)+delta*180/Math.PI+540)%360)-180;
  }else if(change.type==='move'){
    next.x=geometry.x+dx;next.y=geometry.y+dy;
    if(next.tail&&next.tail.mode!=='normalized'&&Number.isFinite(next.tail.x)&&Number.isFinite(next.tail.y)){next.tail.x+=dx;next.tail.y+=dy;}
  }else if(change.type==='resize'){
    if(change.preserveAspectRatio){const factor=Math.max(30/geometry.w,20/geometry.h,1+(geometry.w*dx+geometry.h*dy)/(geometry.w**2+geometry.h**2));next.w=geometry.w*factor;next.h=geometry.h*factor;}
    else{next.w=Math.max(30,geometry.w+dx);next.h=Math.max(20,geometry.h+dy);}
    saveBubbleTextFlow(next);
  }else if(change.type==='text-move'||change.type==='text-resize'){
    const box=bubbleTextBox(bubble);
    next.textBox=change.type==='text-move'?{...box,x:box.x+dx,y:box.y+dy}:{...box,w:Math.max(1,box.w+dx),h:Math.max(1,box.h+dy)};
    if(change.type==='text-resize'){delete next.textLayout;next.textFrameLayout=true;saveBubbleTextFlow(next);}
  }else if(change.type==='tail'){
    const x=finite(change.x,geometry.tail?.x??geometry.x+geometry.w*.57),y=finite(change.y,geometry.tail?.y??geometry.y+geometry.h+30);
    next.tail={...next.tail,mode:'normalized',x:clamp((x-geometry.x)/geometry.w,-2,3),y:clamp((y-geometry.y)/geometry.h,-2,3),visible:true,directionOnly:false};
  }else if(change.type==='point'){
    const points=(validBubblePoints(next.points)?next.points:bubbleShapePoints('custom')).map(p=>({...p}));
    if(!Number.isInteger(change.index)||change.index<0||change.index>=points.length)return next;
    points[change.index]={x:clamp((finite(change.x)-geometry.x)/geometry.w,0,1),y:clamp((finite(change.y)-geometry.y)/geometry.h,0,1)};
    if(validBubblePoints(points)){next=clearBubbleMaterial(next);next.shape='custom';next.points=points;}
  }else if(change.type==='insert-point'){
    const points=(validBubblePoints(next.points)?next.points:bubbleShapePoints('custom')).map(p=>({...p}));
    if(!Number.isInteger(change.index)||change.index<0||change.index>=points.length||points.length>=32)return next;
    const a=points[change.index],b=points[(change.index+1)%points.length];
    points.splice(change.index+1,0,{x:(a.x+b.x)/2,y:(a.y+b.y)/2});
    if(validBubblePoints(points)){next=clearBubbleMaterial(next);next.shape='custom';next.points=points;}
  }else if(change.type==='remove-point'){
    const points=(validBubblePoints(next.points)?next.points:bubbleShapePoints('custom')).map(p=>({...p}));
    if(points.length<=3||!Number.isInteger(change.index)||change.index<0||change.index>=points.length)return next;
    points.splice(change.index,1);
    if(validBubblePoints(points)){next=clearBubbleMaterial(next);next.shape='custom';next.points=points;}
  }else if(change.type==='shape'){
    if(change.shape==='asset'){if(validAssetContour(next.assetContour))next.shape='asset';else next=applyBubbleMaterial(next,defaultBubbleMaterial(next).id);}
    else if(['','oval','rounded-rect','cloud','burst','custom','none'].includes(change.shape)){next=clearBubbleMaterial(next);if(change.shape==='')delete next.shape;else next.shape=change.shape;if(change.shape==='custom'&&!validBubblePoints(next.points))next.points=bubbleShapePoints('custom');}
    if(next.type==='speech'&&!['none','asset'].includes(change.shape))next.tail={side:'bottom',base:.54,...next.tail,visible:true};
  }
  return next;
}

export function freezeBubbleForGeometry(bubble,layout){
 if(!layout)return bubble;
 if(dialogueSegments(bubble).length){bubble.dialogueSegments.forEach((segment,i)=>{const part=segmentBubble(bubble,i);freezeBubbleTextLayout(part,layout.dialogueLayouts?.[i],normalizeBubbleStyle(part));segment.independentBox=part.textBox;segment.textLayout=part.textLayout;});}
 else freezeBubbleTextLayout(bubble,layout,normalizeBubbleStyle(bubble));
 return bubble;
}

/** Delegates handle drags so rerendering SVG children does not lose the current interaction.
 * onChange(updated, meta) previews; onCommit(updated, meta) records one undo/save.
 * meta.before is the untouched original. The host owns selection and persistence.
 */
export class BubbleEditor {
  constructor({root,getBubble,getLayout,onChange,onCommit=()=>{},onStart=()=>{},toPagePoint}={}){
    if(!root||typeof getBubble!=='function'||typeof onChange!=='function')throw new Error('BubbleEditor 需要 root、getBubble 和 onChange');
    this.root=root;this.getBubble=getBubble;this.getLayout=getLayout;this.onChange=onChange;this.onCommit=onCommit;this.onStart=onStart;
    this.toPagePoint=toPagePoint||((event)=>{
      const svg=root.ownerSVGElement||root,point=svg.createSVGPoint();point.x=event.clientX;point.y=event.clientY;
      return point.matrixTransform(svg.getScreenCTM().inverse());
    });
    this.document=root.ownerDocument;this.window=this.document.defaultView;this.active=null;
    this.down=this.pointerDown.bind(this);this.move=this.pointerMove.bind(this);this.up=this.pointerUp.bind(this);this.cancel=this.pointerCancel.bind(this);this.lost=event=>{if(event.target===this.root)this.pointerCancel(event);};this.blur=()=>{const active=this.active;if(active)this.pointerCancel({pointerId:active.pointerId,preventDefault(){},stopImmediatePropagation(){}});};
    root.addEventListener('pointerdown',this.down,true);root.addEventListener('lostpointercapture',this.lost,true);this.window?.addEventListener?.('blur',this.blur);
    this.document.addEventListener('pointermove',this.move,true);this.document.addEventListener('pointerup',this.up,true);this.document.addEventListener('pointercancel',this.cancel,true);
  }
  pointerDown(event){
    if(event.button!==0||this.active)return;
    const handle=event.target.closest?.('[data-bubble-handle]'),group=handle?.closest('[data-bubble]');
    if(!handle||!group||!this.root.contains(handle))return;
    const bubble=this.getBubble(group.dataset.bubble);if(!bubble||bubble.locked)return;
    const kind=handle.dataset.bubbleHandle,index=Number(handle.dataset.bubblePoint),before=copy(bubble),point=this.toPagePoint(event);
    const working=copy(before),renderW=Number(group.dataset.renderW),renderH=Number(group.dataset.renderH);
    if(Number.isFinite(renderW)&&renderW>=30)working.w=renderW;if(Number.isFinite(renderH)&&renderH>=20)working.h=renderH;
    if(['text-move','resize','segment-move','part-move','part-resize'].includes(kind)&&this.getLayout){
      if(dialogueSegments(working).length||['text-move','resize'].includes(kind))freezeBubbleForGeometry(working,this.getLayout(before));
    }
    this.active={before,working,current:working,point,kind,index,pointerId:event.pointerId};
    this.onStart(before,{bubbleId:before.id,kind,index,before});try{this.root.setPointerCapture?.(event.pointerId);}catch{}event.preventDefault();event.stopImmediatePropagation();
  }
  pointerMove(event){
    const drag=this.active;if(!drag||event.pointerId!==drag.pointerId)return;
    const point=this.toPagePoint(event),change={type:drag.kind,dx:point.x-drag.point.x,dy:point.y-drag.point.y,x:point.x,y:point.y,startX:drag.point.x,startY:drag.point.y,index:drag.index,preserveAspectRatio:drag.kind==='resize'&&event.shiftKey===true};
    drag.current=applyBubbleEdit(drag.working,change);this.onChange(drag.current,{bubbleId:drag.before.id,kind:drag.kind,before:drag.before,commit:false});event.preventDefault();event.stopImmediatePropagation();
  }
  pointerUp(event){
    const drag=this.active;if(!drag||event.pointerId!==drag.pointerId)return;
    this.active=null;this.releaseCapture(drag.pointerId);this.onCommit(drag.current,{bubbleId:drag.before.id,kind:drag.kind,before:drag.before,commit:true});event.preventDefault();event.stopImmediatePropagation();
  }
  pointerCancel(event){
    const drag=this.active;if(!drag||event.pointerId!==drag.pointerId)return;
    this.active=null;this.releaseCapture(drag.pointerId);this.onChange(drag.before,{bubbleId:drag.before.id,kind:drag.kind,before:drag.before,cancelled:true});event.preventDefault();event.stopImmediatePropagation();
  }
  releaseCapture(pointerId){try{if(this.root.hasPointerCapture?.(pointerId))this.root.releasePointerCapture?.(pointerId);}catch{}}
  destroy(){
    this.window?.removeEventListener?.('blur',this.blur);this.root.removeEventListener('lostpointercapture',this.lost,true);this.root.removeEventListener('pointerdown',this.down,true);this.document.removeEventListener('pointermove',this.move,true);this.document.removeEventListener('pointerup',this.up,true);this.document.removeEventListener('pointercancel',this.cancel,true);this.active=null;
  }
}


