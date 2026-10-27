/** Keep only the newest slider value in a frame. Commit flushes it; Escape discards it. */
export function createPreviewScheduler({preview,requestFrame=callback=>requestAnimationFrame(callback),cancelFrame=id=>cancelAnimationFrame(id)}){
 let frame=null,pending=null;
 function flush(){if(frame!==null)cancelFrame(frame);frame=null;const value=pending;pending=null;if(value)preview(...value);}
 function cancel(){if(frame!==null)cancelFrame(frame);frame=null;pending=null;}
 return {schedule(...value){pending=value;if(frame===null)frame=requestFrame(()=>{frame=null;flush();});},flush,cancel};
}
