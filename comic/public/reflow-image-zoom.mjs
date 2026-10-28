import {artworkZoomPercent,scaleArtwork} from './artwork-transform.js';
/** Raise reflowed artwork to the editor's 100% fill, retaining larger manual views. */
export function ensureReflowZoom(frame,asset){
 if(!asset||![asset.width,asset.height,frame.w,frame.h].every(n=>Number.isFinite(n)&&n>0))return false;
 const percent=artworkZoomPercent(frame,asset);
 if(!Number.isFinite(percent)||percent>=100-1e-8)return false;
 scaleArtwork(frame,asset,100);return true;
}
export function reflowCoverViewFromTransform(frame,asset){
 const t=frame.imageTransform,scale=Math.max(frame.w/asset.width,frame.h/asset.height),axis=(space,position)=>Math.abs(space)<1e-8?.5:Math.max(0,Math.min(1,position/space));
 return {focusX:axis(frame.w-asset.width*t.scale,t.x),focusY:axis(frame.h-asset.height*t.scale,t.y),zoom:Math.max(1,Math.min(3,t.scale/scale))};
}
