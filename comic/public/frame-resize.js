import {bounds,rectangle,clamp} from './model.js';
import {proportionalFrameDrag} from './panel-proportional-resize.js';
import {rectangleDragY,frameDragHeightLimit} from './panel-size-limits.js';
import {artworkDelta} from './artwork-transform.js';

// Rectangle mode edits the crop boundary while preserving the artwork transform.
export function moveFrameBoundary(initial,{dx,dy}){
 const result=structuredClone(initial);result.x+=dx;result.y+=dy;
 if(result.imageTransform){const delta=artworkDelta(initial.imageTransform,dx,dy);result.imageTransform.x-=delta.x;result.imageTransform.y-=delta.y;}
 return result;
}
export function frameResizeHandles(frame){const b=bounds(frame);return rectangle().map(p=>({x:(b.x+p.x*b.w)/frame.w,y:(b.y+p.y*b.h)/frame.h}));}
export function preserveFrameArtwork(initial,result){
 if(!initial.imageTransform)return result;const a=bounds(initial),b=bounds(result),dcx=a.x+a.w/2-b.x-b.w/2,dcy=a.y+a.h/2-b.y-b.h/2,t=initial.imageTransform,d=artworkDelta(t,initial.x-result.x+dcx,initial.y-result.y+dcy);result.imageTransform={...t,x:t.x+d.x-dcx,y:t.y+d.y-dcy};return result;
}
export function resizeFrameCorner(initial,index,{dx,dy},{pageWidth=1280}={}){
 if(!Number.isInteger(index)||index<0||index>3||![dx,dy].every(Number.isFinite))return structuredClone(initial);
 const b=bounds(initial),proxy={...structuredClone(initial),x:initial.x+b.x,y:initial.y+b.y,w:b.w,h:b.h,points:rectangle()};
 if(proxy.imageTransform){proxy.imageTransform.x-=b.x;proxy.imageTransform.y-=b.y;}
 let next;
 const maxHeight=frameDragHeightLimit(initial,{dx,dy});
 if(initial.proportionalResize)next=proportionalFrameDrag(proxy,index,{dx,dy},{pageWidth,maxHeight});
 else{
  const minX=Math.min(initial.cutoutLayer?-pageWidth:0,proxy.x),maxX=Math.max(initial.cutoutLayer?pageWidth*2:pageWidth,proxy.x+proxy.w);
  const left=index===0||index===3,top=index<2,opposite=proxy.points[(index+2)%4],ox=clamp(proxy.x+opposite.x*proxy.w,left?minX+20:minX,left?maxX:maxX-20),oy=proxy.y+opposite.y*proxy.h;
  let x=proxy.x+proxy.points[index].x*proxy.w+dx,y=proxy.y+proxy.points[index].y*proxy.h+dy;
  x=left?clamp(x,minX,ox-20):clamp(x,ox+20,maxX);y=rectangleDragY(oy,y,top,maxHeight);
  next={...proxy,x:Math.min(x,ox),y:Math.min(y,oy),w:Math.abs(x-ox),h:Math.abs(y-oy)};
 }
 const sx=next.w/b.w,sy=next.h/b.h,result={...structuredClone(initial),x:next.x-b.x*sx,y:next.y-b.y*sy,w:initial.w*sx,h:initial.h*sy};
 preserveFrameArtwork(initial,result);
 if(initial.proportionalResize){if(next.featherEdges)result.featherEdges=next.featherEdges;if(next.feather!==undefined)result.feather=next.feather;}
 return result;
}
