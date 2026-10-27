import {bounds,clamp} from './model.js';
// User's production limit. It does not rewrite imported or existing artwork.
export const MAX_PANEL_DRAG_HEIGHT=3840;
export const panelPixelHeight=frame=>Math.round(bounds(frame).h);
export const rectangleDragY=(oppositeY,nextY,isTop,maxHeight=MAX_PANEL_DRAG_HEIGHT)=>isTop?clamp(nextY,oppositeY-maxHeight,oppositeY-20):clamp(nextY,oppositeY+20,oppositeY+maxHeight);
// Imported backgrounds can already exceed the normal panel limit. A small edit must
// not shorten them to 3840 px or move the corner anchored on the opposite edge.
export function frameDragHeightLimit(frame,{dx=0,dy=0}={}){const b=bounds(frame);return b.h>MAX_PANEL_DRAG_HEIGHT?b.h+Math.abs(dy)+Math.abs(dx)*b.h/Math.max(1,b.w):MAX_PANEL_DRAG_HEIGHT;}
export function nodeDragY(frame,index,nextY){
 const others=frame.points.filter((_p,i)=>i!==index).map(point=>point.y*frame.h),low=Math.min(...others),high=Math.max(...others);
 // A legacy oversized polygon can be reduced without moving its other vertices automatically.
 const limit=frameDragHeightLimit(frame,{dy:(nextY-frame.points[index].y)*frame.h});
 return clamp(nextY*frame.h,high-limit,low+limit)/frame.h;
}
