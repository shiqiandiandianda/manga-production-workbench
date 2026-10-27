import {bounds} from './model.js';
import {frameDragHeightLimit} from './panel-size-limits.js';
/** Scale about the opposite corner; dragging a point never changes the polygon or the image's framing. */
export function proportionalFrameDrag(initial,index,{dx,dy},{pageWidth=1280,maxHeight=frameDragHeightLimit(initial,{dx,dy})}={}){
 const point=initial.points[index];if(!point||![dx,dy].every(Number.isFinite))return structuredClone(initial);const b=bounds(initial),px=point.x*initial.w,py=point.y*initial.h,ax=initial.x+(px<=b.x+b.w/2?b.x+b.w:b.x),ay=initial.y+(py<=b.y+b.h/2?b.y+b.h:b.y),vx=initial.x+px-ax,vy=initial.y+py-ay,den=vx*vx+vy*vy;
 if(!den)return structuredClone(initial);const min=Math.max(20/b.w,20/b.h),left=initial.x+b.x-ax,right=initial.x+b.x+b.w-ax,minX=Math.min(initial.cutoutLayer?-pageWidth:0,initial.x+b.x),maxX=Math.max(initial.cutoutLayer?pageWidth*2:pageWidth,initial.x+b.x+b.w);let max=maxHeight/b.h;if(left<0)max=Math.min(max,(ax-minX)/-left);if(right>0)max=Math.min(max,(maxX-ax)/right);if(max<min)return structuredClone(initial);
 const scale=Math.max(min,Math.min(max,((vx+dx)*vx+(vy+dy)*vy)/den)),frame=structuredClone(initial);frame.x=ax+(initial.x-ax)*scale;frame.y=ay+(initial.y-ay)*scale;frame.w*=scale;frame.h*=scale;
 if(frame.imageTransform){const t=frame.imageTransform;frame.imageTransform={...t,x:t.x*scale,y:t.y*scale,scale:t.scale*scale};}if(frame.featherEdges)for(const key of Object.keys(frame.featherEdges))frame.featherEdges[key]=Math.min(10000,frame.featherEdges[key]*scale);if(frame.feather)frame.feather*=scale;return frame;
}
