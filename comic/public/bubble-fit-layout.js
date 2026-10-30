import {bubbleLayout,bubbleOutlinePoints,normalizeBubbleStyle,measureLettering,fitBubbleTailToBody} from './lettering.js';
import {freezeBubbleTextLayout,bubbleTextLayoutKey} from './bubble-text-flow.js';
import {dialogueSegments} from './bubble-dialogue-segments.js';
import {isLibrarySfx} from './sfx-library.js';

// Canvas pixels, measured to the bubble body; tails and decorative rays are excluded.
export const CURRENT_LAYOUT_MARGINS=Object.freeze({horizontal:48,vertical:72});

export function renderedTextBounds(context,layout){
 context.font=layout.font;
 const rects=layout.lines.flatMap(line=>{
  const glyphs=line.glyphs||[{text:line.text,x:line.x,y:line.y}];
  return glyphs.map(g=>{const width=measureLettering(context,g.text,line.glyphs?0:layout.letterSpacing),align=line.glyphs?'center':layout.textAlign;
   return {x:g.x-(align==='center'?width/2:align==='right'?width:0),y:g.y-layout.fontSize*.525,w:width,h:layout.fontSize*1.05};});
 });
 const x=Math.min(...rects.map(r=>r.x)),y=Math.min(...rects.map(r=>r.y));
 return {x,y,w:Math.max(...rects.map(r=>r.x+r.w))-x,h:Math.max(...rects.map(r=>r.y+r.h))-y};
}

// A whole padded rectangle must remain inside the body, including concave contours.
function containsRect(points,rect){
 const ys=[rect.y,rect.y+rect.h,...points.flatMap(p=>p.y>rect.y&&p.y<rect.y+rect.h?[p.y-1e-5,p.y+1e-5]:[])];
 return ys.every(y=>{
  const xs=[];
  for(let i=0;i<points.length;i++){const a=points[i],b=points[(i+1)%points.length];if((a.y<=y&&b.y>y)||(b.y<=y&&a.y>y))xs.push(a.x+(y-a.y)*(b.x-a.x)/(b.y-a.y));}
  xs.sort((a,b)=>a-b);
  for(let i=0;i+1<xs.length;i+=2)if(xs[i]<=rect.x&&xs[i+1]>=rect.x+rect.w)return true;
  return false;
 });
}

export function fitBubbleToCurrentLayout(context,bubble,{maxWidth=4096,maxHeight=8192}={}){
 const original=structuredClone(bubble),style=normalizeBubbleStyle(bubble);
 if(bubble.locked||bubble.visible===false||style.shape==='none'||bubble.type==='sfx'||isLibrarySfx(bubble)||!String(bubble.text||'').trim())return {bubble:original,status:'skipped'};
 if(dialogueSegments(bubble).length)return {bubble:original,status:'segments'};
 const layout=bubbleLayout(context,bubble),bounds=renderedTextBounds(context,layout);
 if(![bounds.x,bounds.y,bounds.w,bounds.h].every(Number.isFinite)||bounds.w<=0||bounds.h<=0)return {bubble:original,status:'skipped'};
 // Material contours may occupy only part of their texture. Size and center the
 // actual body, rather than the transparent/decorative texture canvas around it.
 const unitOutline=bubbleOutlinePoints(bubble,1,1);
 if(!unitOutline?.length)return {bubble:original,status:'contour-space'};
 const body={left:Math.min(...unitOutline.map(p=>p.x)),right:Math.max(...unitOutline.map(p=>p.x)),top:Math.min(...unitOutline.map(p=>p.y)),bottom:Math.max(...unitOutline.map(p=>p.y))};
 const bodyWidth=body.right-body.left,bodyHeight=body.bottom-body.top;
 if(!Number.isFinite(bodyWidth)||!Number.isFinite(bodyHeight)||bodyWidth<=0||bodyHeight<=0)return {bubble:original,status:'contour-space'};
 const w=(bounds.w+CURRENT_LAYOUT_MARGINS.horizontal*2)/bodyWidth,h=(bounds.h+CURRENT_LAYOUT_MARGINS.vertical*2)/bodyHeight;
 if(w>maxWidth||h>maxHeight)return {bubble:original,status:'too-large'};
 const cx=w*(body.left+body.right)/2,cy=h*(body.top+body.bottom)/2;
 const safety=style.outlineWidth/2+2,contentW=bounds.w+safety*2,contentH=bounds.h+safety*2;
 const outline=bubbleOutlinePoints(bubble,w,h),rect={x:cx-contentW/2,y:cy-contentH/2,w:contentW,h:contentH};
 // Do not silently change the requested margins when an unusual contour cannot fit.
 if(!outline||!containsRect(outline,rect))return {bubble:original,status:'contour-space'};
 // Keep every word at its current page position; center the bubble body around it.
 const dx=cx-(bounds.x+bounds.w/2),dy=cy-(bounds.y+bounds.h/2);
 const next={...original,x:layout.x-dx,y:layout.y-dy,w,h,overflow:'fit'};
 delete next.textFrameLayout;delete next.textLayout;
 const lines=layout.lines.map(l=>({...l,x:l.x+dx,y:l.y+dy,left:l.left+dx,right:l.right+dx,overflow:false,glyphs:l.glyphs?.map(g=>({...g,x:g.x+dx,y:g.y+dy}))||null}));
 // Rebase the existing frame into the new body coordinates. Its page position,
 // width and height belong to the user's text edit and must not be re-fitted.
 const textBox={...layout.textBox,x:layout.textBox.x+dx,y:layout.textBox.y+dy};
 freezeBubbleTextLayout(next,{...layout,lines,textBox,textLayoutStyleKey:bubbleTextLayoutKey(next,normalizeBubbleStyle(next))});
 // Avoid a second history entry caused only by floating point translation noise.
 if(bubble.textLayout&&['x','y','w','h'].every(k=>Math.abs(next[k]-bubble[k])<1e-7)&&['x','y','w','h'].every(k=>Math.abs(next.textBox[k]-(bubble.textBox?.[k]??Infinity))<1e-7))return {bubble:original,status:'fitted'};
 fitBubbleTailToBody(bubble,next,layout);
 return {bubble:next,status:'fitted'};
}
