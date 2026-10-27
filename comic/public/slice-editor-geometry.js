import {slicePolygon} from './panel-slices.js';
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
export function changeSliceBounds(region,box){
 const next={x:box.x,y:box.y,w:box.w,h:box.h};
 if(region?.points)next.points=region.points.map(p=>({x:next.x+(p.x-region.x)/region.w*next.w,y:next.y+(p.y-region.y)/region.h*next.h}));
 return next;
}
export function moveSliceRegion(region,dx,dy){return changeSliceBounds(region,{...region,x:clamp(region.x+dx,0,1-region.w),y:clamp(region.y+dy,0,1-region.h)});}
export function resizeSliceRegion(region,handle,dx,dy,minW=.001,minH=.001){
 let left=region.x,top=region.y,right=left+region.w,bottom=top+region.h;
 if(handle.includes('w'))left=clamp(left+dx,0,right-minW);if(handle.includes('e'))right=clamp(right+dx,left+minW,1);
 if(handle.includes('n'))top=clamp(top+dy,0,bottom-minH);if(handle.includes('s'))bottom=clamp(bottom+dy,top+minH,1);
 return changeSliceBounds(region,{x:left,y:top,w:right-left,h:bottom-top});
}
export function sliceContains(region,p){const points=slicePolygon(region);let inside=false;for(let i=0,j=points.length-1;i<points.length;j=i++){const a=points[i],b=points[j];if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)inside=!inside;}return inside;}
export function sliceHandles(r){return [['nw',r.x,r.y],['n',r.x+r.w/2,r.y],['ne',r.x+r.w,r.y],['e',r.x+r.w,r.y+r.h/2],['se',r.x+r.w,r.y+r.h],['s',r.x+r.w/2,r.y+r.h],['sw',r.x,r.y+r.h],['w',r.x,r.y+r.h/2]];}
