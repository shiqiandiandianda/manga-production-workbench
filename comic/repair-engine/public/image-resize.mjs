import {layerMatrix,mapPoint,poseOf} from './affine-links.mjs';
const corners={nw:[0,0],ne:[1,0],se:[1,1],sw:[0,1]};
export function imageCornerPoints(layer,width,height){
 const matrix=layerMatrix(layer);
 return Object.entries(corners).map(([corner,[x,y]])=>({corner,...mapPoint(matrix,{x:x*width,y:y*height})}));
}
// Scale from the original pose on every move, keeping the opposite corner fixed.
export function resizeImageFromCorner(base,width,height,corner,delta){
 const local=corners[corner];
 if(!local||!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)throw new Error('图片尺寸无效');
 const pose=poseOf(base),sx=pose.scaleX,sy=pose.scaleY;
 if(sx<=0||sy<=0||![sx,sy,delta.x,delta.y].every(Number.isFinite))throw new Error('图片缩放无效');
 const matrix=layerMatrix(pose),fixed={x:(1-local[0])*width,y:(1-local[1])*height},anchor=mapPoint(matrix,fixed),handle=mapPoint(matrix,{x:local[0]*width,y:local[1]*height}),vector={x:handle.x-anchor.x,y:handle.y-anchor.y};
 const minimum=Math.min(.1,sx,sy),maximum=Math.max(4,sx,sy);
 const raw=1+(delta.x*vector.x+delta.y*vector.y)/(vector.x*vector.x+vector.y*vector.y);
 const factor=Math.max(minimum/Math.min(sx,sy),Math.min(maximum/Math.max(sx,sy),raw));
 const next={...pose,scale:sx*factor,scaleX:sx*factor,scaleY:sy*factor,scaleMode:base.scaleMode||(Math.abs(sx-sy)<1e-7?'uniform':'independent')},mapped=mapPoint(layerMatrix({...next,x:0,y:0}),fixed);
 next.x=anchor.x-mapped.x;next.y=anchor.y-mapped.y;
 return next;
}
export function imageResizeCursor(vector){
 const angle=(Math.atan2(vector.y,vector.x)*180/Math.PI+180)%180;
 return ['ew-resize','nwse-resize','ns-resize','nesw-resize'][Math.round(angle/45)%4];
}
