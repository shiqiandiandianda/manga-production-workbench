import {panel,bounds,validPolygon} from './model.js';
export function slicePolygon(region){return region.points||[{x:region.x,y:region.y},{x:region.x+region.w,y:region.y},{x:region.x+region.w,y:region.y+region.h},{x:region.x,y:region.y+region.h}];}
export function validateSliceRegion(region){
 if(!region||!['x','y','w','h'].every(k=>Number.isFinite(region[k]))||region.x<0||region.y<0||region.w<=0||region.h<=0||region.x+region.w>1.000001||region.y+region.h>1.000001)return false;
 if(!region.points)return true;
 if(!Array.isArray(region.points)||region.points.length<3||region.points.length>64)return false;
 return region.points.every(p=>p.x>=region.x-1e-7&&p.y>=region.y-1e-7&&p.x<=region.x+region.w+1e-7&&p.y<=region.y+region.h+1e-7)&&validPolygon(region.points.map(p=>({x:(p.x-region.x)/region.w,y:(p.y-region.y)/region.h})));
}
export function slicePixels(r,width,height){const x=Math.max(0,Math.floor(r.x*width)),y=Math.max(0,Math.floor(r.y*height));return {x,y,w:Math.min(width,Math.ceil((r.x+r.w)*width))-x,h:Math.min(height,Math.ceil((r.y+r.h)*height))-y};}
/** Convert native source selection into the root frame's normalized lettering space. */
export function sourceRegionOnFrame(source,root,size,r){
 const t=source.imageTransform||{x:0,y:0,scale:source.w/size.width},b=bounds(source),cx=b.x+b.w/2,cy=b.y+b.h/2,a=(t.rotation||0)*Math.PI/180,fx=t.flipX?-1:1,fy=t.flipY?-1:1;
 const points=slicePolygon(r).map(p=>{const x=t.x+p.x*size.width*t.scale-cx,y=t.y+p.y*size.height*t.scale-cy;return {x:(source.x-root.x+cx+fx*(x*Math.cos(a)-y*Math.sin(a)))/root.w,y:(source.y-root.y+cy+fy*(x*Math.sin(a)+y*Math.cos(a)))/root.h};}),xs=points.map(p=>p.x),ys=points.map(p=>p.y);return {x:Math.min(...xs),y:Math.min(...ys),w:Math.max(...xs)-Math.min(...xs),h:Math.max(...ys)-Math.min(...ys)};
}
export function frameRegionOnSource(source,root,size,r){
 const t=source.imageTransform||{x:0,y:0,scale:source.w/size.width},b=bounds(source),cx=b.x+b.w/2,cy=b.y+b.h/2,a=(t.rotation||0)*Math.PI/180,fx=t.flipX?-1:1,fy=t.flipY?-1:1;
 const points=slicePolygon(r).map(p=>{const x=(root.x+p.x*root.w-source.x-cx)*fx,y=(root.y+p.y*root.h-source.y-cy)*fy;return {x:(x*Math.cos(a)+y*Math.sin(a)+cx-t.x)/(size.width*t.scale),y:(-x*Math.sin(a)+y*Math.cos(a)+cy-t.y)/(size.height*t.scale)};}),xs=points.map(p=>p.x),ys=points.map(p=>p.y);return {x:Math.min(...xs),y:Math.min(...ys),w:Math.max(...xs)-Math.min(...xs),h:Math.max(...ys)-Math.min(...ys)};
}
/** Map a native-pixel crop to the current canvas without depending on viewport zoom. */
export function sliceFrame(source,sourceSize,crop,asset,provenance){
 const t=source.imageTransform||{x:0,y:0,scale:source.w/sourceSize.width},b=bounds(source),cx=b.x+b.w/2,cy=b.y+b.h/2,angle=(t.rotation||0)*Math.PI/180,fx=t.flipX?-1:1,fy=t.flipY?-1:1;
 const transform=(x,y)=>{const dx=t.x+x*t.scale-cx,dy=t.y+y*t.scale-cy;return {x:cx+fx*(dx*Math.cos(angle)-dy*Math.sin(angle)),y:cy+fy*(dx*Math.sin(angle)+dy*Math.cos(angle))};};
 const corners=[[crop.x,crop.y],[crop.x+crop.w,crop.y],[crop.x+crop.w,crop.y+crop.h],[crop.x,crop.y+crop.h]].map(([x,y])=>transform(x,y)),left=Math.min(...corners.map(p=>p.x)),top=Math.min(...corners.map(p=>p.y)),w=Math.max(...corners.map(p=>p.x))-left,h=Math.max(...corners.map(p=>p.y))-top;
 if(w<20||h<20)throw Error('裁格在画布上不足20像素，请扩大裁切区域');
 const result=panel('',source.x+left,source.y+top,w,h);Object.assign(result,{name:provenance.panelId+' · 裁格',border:0,referenceIds:[],coordinateSource:{generation:'不生成'},imageAssetId:asset.id,points:corners.map(p=>({x:(p.x-left)/w,y:(p.y-top)/h})),imageTransform:{x:(w-crop.w*t.scale)/2,y:(h-crop.h*t.scale)/2,scale:t.scale,rotation:t.rotation||0,flipX:!!t.flipX,flipY:!!t.flipY},panelSlice:{version:1,...provenance}});return result;
}
