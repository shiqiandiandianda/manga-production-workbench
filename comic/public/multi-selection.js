import {isSfxImage,sfxImageBounds} from './sfx-image-layer.js';
import {isLibrarySfx,sfxBounds} from './sfx-library.js';
import {resizeStripSpace} from './strip-space.js';
import {bounds,layoutLongStrip,clone} from './model.js';
import {allLayers,sceneLayers,normalizeLayerOrder} from "./layers.js";
import {panelInPage} from './layer-groups.js';
import {bubbleLayout,bubbleTailGeometry} from './lettering.js';
import {applyBubbleEdit} from './bubble-editor.js';
import {constrainedPanelDelta} from './panel-width.js';
export function expandedSelection(project,keys){
 const entries=allLayers(project),wanted=new Set(keys||[]),panels=new Set(entries.filter(e=>e.type==='panel'&&wanted.has(e.item.id)).map(e=>e.item.id));
 if(panels.size)for(const entry of entries)if(entry.item.cutoutLayer&&panels.has(entry.item.cutoutLayer.parentPanelId))wanted.add(entry.item.id);
 if(panels.size)for(const entry of entries)if(entry.type==='bubble'&&!wanted.has(entry.item.id)){const owner=panelInPage(entry.page,entry.item);if(owner&&panels.has(owner.id))wanted.add(entry.item.id);}
 return entries.filter(entry=>wanted.has(entry.item.id));
}
const locked=(project,e)=>e.item.locked||e.page?.locked||(e.item.stripSpace&&project.pages.find(p=>p.id===e.item.stripSpace.pageId)?.locked);
const intersects=(a,b)=>a.x+a.w>=b.x&&a.x<=b.x+b.w&&a.y+a.h>=b.y&&a.y<=b.y+b.h;
function sceneContext(project){const layout=layoutLongStrip(project.pages);return {layout,map:new Map(sceneLayers(project,layout).map(e=>[e.item.id,e]))};}
function boxForScene(entry,measurement){
 if(!entry)return null;const f=entry.frame,shape=entry.type==='bubble'?(measurement?bubbleLayout(measurement,f):{w:f.w,h:f.h,tail:bubbleTailGeometry(f)}):bounds(f);
 if(isSfxImage(f)){const box=sfxImageBounds(f);return {x:box.x*entry.scale,y:entry.offsetY+box.y*entry.scale,w:box.w*entry.scale,h:box.h*entry.scale};}
 if(isLibrarySfx(f)){const box=sfxBounds(f,shape.w,shape.h);return {x:box.x*entry.scale,y:entry.offsetY+box.y*entry.scale,w:box.w*entry.scale,h:box.h*entry.scale};}
 let x=entry.type==='bubble'?0:shape.x,y=entry.type==='bubble'?0:shape.y,w=shape.w,h=shape.h;
 if(entry.type==='bubble'&&shape.tail?.tip){const tip=shape.tail.tip,right=Math.max(w,tip.x),bottom=Math.max(h,tip.y);x=Math.min(0,tip.x);y=Math.min(0,tip.y);w=right-x;h=bottom-y;}
 return {x:(f.x+x)*entry.scale,y:entry.offsetY+(f.y+y)*entry.scale,w:w*entry.scale,h:h*entry.scale};
}
function union(boxes){if(!boxes.length)return null;let x=Infinity,y=Infinity,right=-Infinity,bottom=-Infinity;for(const b of boxes){x=Math.min(x,b.x);y=Math.min(y,b.y);right=Math.max(right,b.x+b.w);bottom=Math.max(bottom,b.y+b.h);}return {x,y,w:right-x,h:bottom-y};}
export function layerDocumentBox(project,key,measurement){return boxForScene(sceneContext(project).map.get(key),measurement);}
export function selectAllLayerKeys(project,{scope='page',pageId}={}){
 const entries=allLayers(project);if(scope==='all')return entries.filter(e=>e.type!=='gradient'||e.item.visible&&e.item.gradient.enabled).map(e=>e.item.id);
 if(scope!=='page')throw new Error('全选范围无效');const context=sceneContext(project),page=context.layout.pages.find(e=>e.pageId===pageId);if(!page)return [];
 const region={x:0,y:page.y,w:context.layout.width,h:page.height};return entries.filter(e=>e.pageId===pageId||e.type==='gradient'&&e.item.visible&&e.item.gradient.enabled&&intersects(boxForScene(context.map.get(e.item.id)),region)).map(e=>e.item.id);
}
export function marqueeSelection(project,rect,{measurement}={}){const context=sceneContext(project);return allLayers(project).filter(e=>e.item.visible&&(e.type!=='gradient'||e.item.gradient.enabled)&&intersects(boxForScene(context.map.get(e.item.id),measurement),rect)).map(e=>e.item.id);}
export function selectionDocumentBox(project,keys,measurement){const context=sceneContext(project);return union(expandedSelection(project,keys).map(e=>boxForScene(context.map.get(e.item.id),measurement)).filter(Boolean));}
export function translateSelection(project,keys,{dx,dy},initial=project){
 const selected=expandedSelection(initial,keys);if(!selected.length||selected.some(e=>locked(initial,e)||e.item.stripSpace)||![dx,dy].every(Number.isFinite))return false;
 const layout=layoutLongStrip(initial.pages),pages=new Map(layout.pages.map(p=>[p.pageId,p])),current=new Map(allLayers(project).map(e=>[e.item.id,e.item]));
 dx=constrainedPanelDelta(selected.filter(entry=>entry.type==='panel').map(entry=>({...entry,scale:pages.get(entry.pageId)?.scale||1})),dx);
 for(const entry of selected){const item=current.get(entry.item.id);if(!item)continue;const scale=entry.pageId?pages.get(entry.pageId).scale:1,x=dx/scale,y=dy/scale;if(entry.type==='bubble')Object.assign(item,applyBubbleEdit(entry.item,{type:'move',dx:x,dy:y}));else{item.x=entry.item.x+x;item.y=entry.item.y+y;}}
 return true;
}
export function deleteSelection(project,keys,{bubbleSizes={}}={}){
 const selected=expandedSelection(project,keys);if(!selected.length||selected.some(e=>locked(project,e)))return false;
 const ids=new Set(selected.map(e=>e.item.id)),spaces=selected.filter(e=>e.item.stripSpace).sort((a,b)=>b.item.y-a.item.y),spaceIds=new Set(spaces.map(e=>e.item.id));let draft=clone(project);
 for(const page of draft.pages){page.panels=page.panels.filter(e=>!ids.has(e.id));page.bubbles=page.bubbles.filter(e=>!ids.has(e.id));}draft.gradients=(draft.gradients||[]).filter(e=>!ids.has(e.id)||spaceIds.has(e.id));
 for(const entry of spaces)draft=resizeStripSpace(draft,entry.item.id,0,{bubbleSizes}).project;
 if(draft.layerOrder)draft.layerOrder=draft.layerOrder.filter(key=>!ids.has(key));normalizeLayerOrder(draft);Object.assign(project,draft);return true;
}

export function selectionOverlaySvg(project,keys,{measurement,zoom=1,rect=null,region=null}={}){
 const stroke=1.5/zoom;let out='';
 if(keys?.size){const context=sceneContext(project),boxes=[];for(const entry of expandedSelection(project,keys)){if(!entry.item.visible)continue;const scene=context.map.get(entry.item.id);if(region&&entry.item.overflow!=='expand'&&!intersects(boxForScene(scene),region))continue;const b=boxForScene(scene,measurement);if(!b||region&&!intersects(b,region))continue;boxes.push(b);out+='<rect data-selected-outline="'+entry.item.id+'" x="'+b.x+'" y="'+b.y+'" width="'+b.w+'" height="'+b.h+'" fill="none" stroke="#48a4ef" stroke-width="'+stroke+'" pointer-events="none"/>';}
 const b=union(boxes);if(b)out+='<rect x="'+b.x+'" y="'+b.y+'" width="'+b.w+'" height="'+b.h+'" fill="none" stroke="#91c8fb" stroke-width="'+stroke+'" stroke-dasharray="'+5/zoom+' '+4/zoom+'" pointer-events="none"/>';}
 if(rect)out+='<rect data-selection-marquee="true" x="'+rect.x+'" y="'+rect.y+'" width="'+rect.w+'" height="'+rect.h+'" fill="#48a4ef" fill-opacity=".12" stroke="#91c8fb" stroke-width="'+stroke+'" pointer-events="none"/>';return out;
}
