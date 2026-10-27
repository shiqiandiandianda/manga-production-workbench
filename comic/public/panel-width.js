import {bounds,clamp} from './model.js';
import {isSfxImage} from './sfx-image-layer.js';

/** Horizontal limits use the visible polygon, including nodes outside its base box. */
export function panelHorizontalLimits(panel,pageWidth){
 if(isSfxImage(panel)||!Number.isFinite(pageWidth)||pageWidth<=0)return null;
 const box=bounds(panel);
 return {min:-panel.x-box.x,max:pageWidth-panel.x-box.x-box.w};
}
export function constrainedPanelDelta(entries,dx){
 let min=-Infinity,max=Infinity;
 for(const {item,page,scale=1} of entries){const limits=panelHorizontalLimits(item,page?.width);if(!limits)continue;min=Math.max(min,limits.min*scale);max=Math.min(max,limits.max*scale);}
 // Existing geometry wider than the page cannot fit through translation alone.
 // Keep its horizontal position instead of silently scaling artwork or splitting a group.
 return min>max?0:clamp(dx,min,max);
}
export function constrainedNodeX(panel,pageWidth,index,dx){
 const world=panel.x+panel.points[index].x*panel.w+dx;
 if(isSfxImage(panel))return (world-panel.x)/panel.w;
 const b=bounds(panel),left=Math.min(panel.cutoutLayer?-pageWidth:0,panel.x+b.x),right=Math.max(panel.cutoutLayer?pageWidth*2:pageWidth,panel.x+b.x+b.w);
 return (clamp(world,left,right)-panel.x)/panel.w;
}
