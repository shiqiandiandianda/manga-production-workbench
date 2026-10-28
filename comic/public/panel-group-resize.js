import {bounds} from './model.js';
import {allLayers} from './layers.js';
import {groupForLayer} from './layer-groups.js';
import {resizeFrameCorner} from './frame-resize.js';
const scaleFields=(value,keys,scale)=>{if(value)for(const key of keys)if(Number.isFinite(value[key]))value[key]*=scale;};
/** Selection transforms the whole shot group; rectangle mode edits only its crop. */
export function resizePanelGroup(project,key,index,delta,initial=project){
 const entries=allLayers(initial),root=entries.find(e=>e.type==='panel'&&e.item.id===key);if(!root||root.page.locked)return false;
 // Free resize edits the crop without stretching source pixels or text layers.
 if(root.item.proportionalResize===false){const target=allLayers(project).find(e=>e.type==='panel'&&e.item.id===key)?.item;if(!target||root.item.locked||target.locked)return false;Object.assign(target,resizeFrameCorner(root.item,index,delta,{pageWidth:root.page.width}));return true;}
 const group=root.item.cutoutLayer?[root]:[...(groupForLayer(initial,key)?.members||[]),...entries.filter(e=>e.item.breakoutForeground?.backgroundPanelId===key)];if(!group.length||group.some(e=>e.item.locked))return false;
 const frame=root.item,next=resizeFrameCorner({...frame,proportionalResize:true},index,delta,{pageWidth:root.page.width}),b=bounds(frame),opposite=(index+2)%4,ax=frame.x+b.x+([1,2].includes(opposite)?b.w:0),ay=frame.y+b.y+(opposite>=2?b.h:0);let scale=next.w/frame.w,min=0,max=Infinity;
 // Negative Y is valid for overlays and artwork spanning a page boundary. A
 // minimum Y of zero used to force scale < 1 on the first tiny pointer move.
 for(const e of group){const v=e.item;if(e.type==='bubble')continue;min=Math.max(min,20/v.w,20/v.h);if(e.type==='panel'){if(v.x<ax)max=Math.min(max,(ax-Math.min(-root.page.width,v.x))/(ax-v.x));if(v.x+v.w>ax)max=Math.min(max,(Math.max(root.page.width*2,v.x+v.w)-ax)/(v.x+v.w-ax));max=Math.min(max,Math.max(root.page.width*3,v.w)/v.w);}}
 if(max<min)return false;scale=Math.max(min,Math.min(max,scale));const current=new Map(allLayers(project).map(e=>[e.item.id,e.item]));
 for(const e of group){const before=e.item,value=structuredClone(before);if(e.type==='bubble'){
   // Keep the bubble and lettering at their actual size while its centre follows the resized frame.
   value.x=ax+(before.x+before.w/2-ax)*scale-before.w/2;value.y=ay+(before.y+before.h/2-ay)*scale-before.h/2;
   if(value.tail?.mode!=='normalized'&&Number.isFinite(value.tail?.x)&&Number.isFinite(value.tail?.y)){value.tail.x+=value.x-before.x;value.tail.y+=value.y-before.y;}
  }else{value.x=ax+(value.x-ax)*scale;value.y=ay+(value.y-ay)*scale;scaleFields(value,['w','h','border','feather','fontSize','outlineWidth','padding','letterSpacing','shadowOffsetX','shadowOffsetY'],scale);scaleFields(value.imageTransform,['x','y','scale'],scale);scaleFields(value.textBox,['x','y','w','h'],scale);if(value.featherEdges)for(const k of Object.keys(value.featherEdges))value.featherEdges[k]=Math.min(10000,value.featherEdges[k]*scale);if(value.fontSize)value.fontSize=Math.min(2048,value.fontSize);if(value.outlineWidth)value.outlineWidth=Math.min(256,value.outlineWidth);if(value.border)value.border=Math.min(256,value.border);if(value.feather)value.feather=Math.min(10000,value.feather);}Object.assign(current.get(value.id),value);}
 return true;
}
