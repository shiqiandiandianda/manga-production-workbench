import {fixedRatioRect} from './core.mjs';
export function selectionHandles(frame){const {x,y,width:w,height:h}=frame;return[{name:'nw',x,y},{name:'n',x:x+w/2,y},{name:'ne',x:x+w,y},{name:'e',x:x+w,y:y+h/2},{name:'se',x:x+w,y:y+h},{name:'s',x:x+w/2,y:y+h},{name:'sw',x,y:y+h},{name:'w',x,y:y+h/2}];}
export function selectionHandleAt(point,frame,zoom=1,radius=10){return selectionHandles(frame).find(handle=>Math.hypot((point.x-handle.x)*zoom,(point.y-handle.y)*zoom)<=radius)||null;}
export function selectionResizeCursor(name){return{name:'default',nw:'nwse-resize',se:'nwse-resize',ne:'nesw-resize',sw:'nesw-resize',n:'ns-resize',s:'ns-resize',e:'ew-resize',w:'ew-resize'}[name]||'default';}
export function resizeSelectionFrame(frame,handle,point,ratio,width,height){
 const [rw,rh]=(ratio||'1:1').split(':').map(Number),r=rw/rh,cx=frame.x+frame.width/2,cy=frame.y+frame.height/2;
 if(handle.length===2){const opposite={x:handle.includes('w')?frame.x+frame.width:frame.x,y:handle.includes('n')?frame.y+frame.height:frame.y};return fixedRatioRect(opposite,point,ratio,width,height);}
 if(handle==='e'||handle==='w'){const anchor=handle==='e'?frame.x:frame.x+frame.width,limit=Math.min(handle==='e'?width-anchor:anchor,2*Math.min(cy,height-cy)*r),units=Math.max(1,Math.min(Math.floor(limit/rw),Math.round(Math.abs(point.x-anchor)/rw))),w=units*rw,h=units*rh;return{x:handle==='e'?anchor:anchor-w,y:cy-h/2,width:w,height:h};}
 const anchor=handle==='s'?frame.y:frame.y+frame.height,limit=Math.min(handle==='s'?height-anchor:anchor,2*Math.min(cx,width-cx)/r),units=Math.max(1,Math.min(Math.floor(limit/rh),Math.round(Math.abs(point.y-anchor)/rh))),w=units*rw,h=units*rh;return{x:cx-w/2,y:handle==='s'?anchor:anchor-h,width:w,height:h};
}
