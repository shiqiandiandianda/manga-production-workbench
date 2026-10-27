import {bubbleBoundary,boundaryPointAt} from './bubble-tail-anchor.js';
export function validBubbleRays(r){return !!r&&Number.isInteger(r.count)&&r.count>=32&&r.count<=240&&Number.isFinite(r.length)&&r.length>=.02&&r.length<=.22&&Number.isFinite(r.jitter)&&r.jitter>=0&&r.jitter<=.65&&Number.isFinite(r.strokeScale)&&r.strokeScale>=.1&&r.strokeScale<=1&&Number.isInteger(r.seed)&&r.seed>=0&&r.seed<=1000000000;}
export function bubbleRaySegments(bubble,outline,w,h){
 if(bubble.shape!=='asset'||!validBubbleRays(bubble.assetRays))return [];
 const path=bubbleBoundary(outline);if(!path)return [];const r=bubble.assetRays,xs=outline.map(p=>p.x),ys=outline.map(p=>p.y),cx=(Math.max(...xs)+Math.min(...xs))/2,cy=(Math.max(...ys)+Math.min(...ys))/2,random=i=>{const n=Math.sin((i+r.seed)*12.9898)*43758.5453;return n-Math.floor(n);};
 return Array.from({length:r.count},(_,i)=>{const outer=boundaryPointAt(path,(i+.15*random(i))/r.count).point,dx=outer.x-cx,dy=outer.y-cy,d=Math.max(1,Math.hypot(dx,dy)),length=Math.min(w,h)*r.length*(1-r.jitter+2*r.jitter*random(i+991));return {outer,inner:{x:outer.x-dx/d*length,y:outer.y-dy/d*length}};});
}
