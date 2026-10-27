import {clone,panel,rectangle,layoutLongStrip,fitImage} from './model.js';
import {allLayers,orderedLayers,sceneLayers} from './layers.js';
import {layerDocumentBox} from './multi-selection.js';
import {applyBubbleEdit} from './bubble-editor.js';
import {archiveRemovedDialogue} from './dialogue-archive.js';

const fail=message=>{throw Error(message);};
/** Only explicit selection is flattened. Group selection expansion must never swallow editable dialogue. */
export function planLayerMerge(project,keys,measurement,assets=new Map()){
 if(!Array.isArray(keys)||keys.length<2||keys.length>100||new Set(keys).size!==keys.length)fail('请选择 2—100 个要合并的图层');
 const wanted=new Set(keys),entries=orderedLayers(project).filter(e=>wanted.has(e.item.id));
 if(entries.length!==keys.length)fail('部分图层已删除，请重新选择');
 if(entries.some(e=>e.item.locked||e.page?.locked))fail('请先解锁选中的图层和画板');
 if(entries.some(e=>e.item.visible===false||e.item.stripSpace||e.item.productionBackgroundResource||e.type==='gradient'&&e.item.coverage==='document'))fail('请选择可见的普通图层合并');
 const pageIds=new Set(entries.filter(e=>e.pageId).map(e=>e.pageId));if(pageIds.size!==1)fail('请在同一画板内选择要合并的图层');
 const page=project.pages.find(p=>p.id===[...pageIds][0]),layout=layoutLongStrip(project.pages),pageEntry=layout.pages.find(p=>p.pageId===page.id),offset=pageEntry.y,ratio=pageEntry.scale;
 const boxFor=e=>{const box=layerDocumentBox(project,e.item.id,measurement);if(!box)fail('所选图层当前不可见');const pad=(e.item.border??e.item.strokeWidth??0)/2*ratio;return {x:box.x-pad,y:box.y-pad,w:box.w+pad*2,h:box.h+pad*2};};
 const boxes=entries.map(boxFor),left=Math.floor(Math.min(...boxes.map(b=>b.x))/ratio),top=Math.floor((Math.min(...boxes.map(b=>b.y))-offset)/ratio),right=Math.ceil(Math.max(...boxes.map(b=>b.x+b.w))/ratio),bottom=Math.ceil((Math.max(...boxes.map(b=>b.y+b.h))-offset)/ratio),region={x:left,y:top,w:Math.max(20,right-left),h:Math.max(20,bottom-top)};
 const ordered=sceneLayers(project,layout),indices=entries.map(e=>ordered.findIndex(s=>s.item.id===e.item.id));if(indices.some(i=>i<0))fail('所选图层当前不可见');
 const roots=entries.filter(e=>e.type==='panel'&&!e.item.cutoutLayer),anchor=roots.find(e=>e.item.productionSegment)||roots[0]||entries.find(e=>e.type==='panel'),anchorId=anchor?.item.id||panel('',0,0,20,20).id;
 const scale=Math.max(1,...entries.filter(e=>e.type==='panel'&&e.item.imageAssetId).map(e=>{const t=e.item.imageTransform||fitImage(e.item,assets.get(e.item.imageAssetId));return 1/t.scale;}));
 const isolated={...clone(project),pages:[{...clone(page),width:region.w,height:region.h,background:'rgba(0,0,0,0)',panels:[],bubbles:[]}],gradients:[],layerOrder:entries.map(e=>e.item.id)},target=isolated.pages[0];
 for(const entry of entries){let item=clone(entry.item);if(entry.type==='bubble')item=applyBubbleEdit(item,{type:'move',dx:-region.x,dy:-region.y});else{item.x-=region.x;item.y-=region.y+(entry.type==='gradient'?offset/ratio:0);}delete item.productionBackgroundInstance;delete item.productionBackgroundResource;if(entry.type==='gradient')isolated.gradients.push(item);else target[entry.type==='panel'?'panels':'bubbles'].push(item);}
 return {keys:[...keys],entries,pageId:page.id,region,scale,anchorId,isolated,layout:layoutLongStrip(isolated.pages,{width:region.w})};
}
export function applyLayerMerge(project,plan,asset){
 const next=clone(project),page=next.pages.find(p=>p.id===plan.pageId),wanted=new Set(plan.keys),old=page.panels.find(f=>f.id===plan.anchorId),merged=old?clone(old):panel('',0,0,20,20);
 merged.id=plan.anchorId;Object.assign(merged,{name:(old?.name||'合并图层').slice(0,100),...plan.region,points:rectangle(),kind:old?.kind||'panel',border:0,feather:0,visible:true,locked:false,imageAssetId:asset.id,imageTransform:{x:0,y:0,scale:1/plan.scale},candidates:[...new Set([...(old?.candidates||[]),old?.imageAssetId,asset.id].filter(Boolean))].slice(-40),generationToken:null});
 for(const key of ['mask','featherEdges','gradient','localRegion','imageEffects','sfxImage','breakoutForeground','productionBackgroundInstance','productionBackgroundResource'])delete merged[key];
 delete merged.cutoutLayer;delete merged.parentPanelId;
 const removedParents=new Set(plan.entries.filter(e=>e.type==='panel'&&e.item.id!==merged.id).map(e=>e.item.id));
 for(const item of page.panels){if(item.cutoutLayer&&removedParents.has(item.cutoutLayer.parentPanelId))item.cutoutLayer.parentPanelId=merged.id;if(item.localRegion&&removedParents.has(item.localRegion.sourcePanelId))item.localRegion.sourcePanelId=merged.id;}
 for(const bubble of page.bubbles){if(removedParents.has(bubble.parentPanelId))bubble.parentPanelId=merged.id;if(bubble.localReplacement&&wanted.has(bubble.localReplacement.patchLayerId))bubble.localReplacement.patchLayerId=merged.id;}
 page.panels=page.panels.filter(f=>!wanted.has(f.id));page.panels.push(merged);page.bubbles=page.bubbles.filter(b=>!wanted.has(b.id));next.gradients=(next.gradients||[]).filter(g=>!wanted.has(g.id));
 const order=orderedLayers(project).map(e=>e.item.id),at=order.slice(0,Math.max(0,order.indexOf(plan.anchorId))).filter(key=>!wanted.has(key)).length;next.layerOrder=order.filter(key=>!wanted.has(key));next.layerOrder.splice(at,0,merged.id);
 // Unselected source text remains editable; explicitly flattened source text remains recoverable in its archive.
 archiveRemovedDialogue(next,project);return {project:next,layerId:merged.id};
}
