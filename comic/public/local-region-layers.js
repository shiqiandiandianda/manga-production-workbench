import {id,clone,rectangle} from './model.js';
import {productionTextContent} from './production-text.js';
import {sliceFrame,sourceRegionOnFrame} from './panel-slices.js';
import {normalizeLayerOrder} from './layers.js';
import {applyProductionStyle,resolveProductionStyle,productionStyleKind} from './production-lettering-style.js';
import {applyBubbleEdit} from './bubble-editor.js';
export function localRegionLayer(project,source,asset,size,crop,{sessionId,taskId,operation,sourceAssetId}){
 const page=project.pages.find(p=>p.panels.some(f=>f.id===source.id)),parent=source.cutoutLayer?page?.panels.find(f=>f.id===source.cutoutLayer.parentPanelId):source;if(!page||!parent||source.locked||parent.locked||page.locked)throw Error('请先解锁来源图层和画板');
 const layer=sliceFrame(source,size,crop,asset,{panelId:'本地选区'});delete layer.panelSlice;Object.assign(layer,{shotId:parent.shotId,name:operation==='inpaint'?'气泡补图层':'选区抠图层',cutoutLayer:{version:1,parentPanelId:parent.id,sourceAssetId,sessionId,kind:operation==='inpaint'?'repair-patch':'selected-cutout',taskId},localRegion:{version:1,sourcePanelId:source.id,taskId,crop:clone(crop),sourceSize:clone(size)}});page.panels.push(layer);normalizeLayerOrder(project);const order=project.layerOrder.filter(k=>k!==layer.id),last=Math.max(order.indexOf(source.id),...page.panels.filter(f=>f.id!==layer.id&&f.cutoutLayer?.parentPanelId===parent.id).map(f=>order.indexOf(f.id)));order.splice(last+1,0,layer.id);project.layerOrder=order;return {layer,parent,page};
}
export function replacementBubble(project,source,patch,size,roi,{existingBubbleId,textRecord,styleKind='current',emptyText=''}){
 const page=project.pages.find(p=>p.panels.some(f=>f.id===source.id)),parent=source.cutoutLayer?page.panels.find(f=>f.id===source.cutoutLayer.parentPanelId):source,segmentId=parent.productionSegment||parent.panelSlice?.segmentId||source.productionBackground?.replace(/-BG$/,'');let bubble=existingBubbleId&&page.bubbles.find(b=>b.id===existingBubbleId);
 if(existingBubbleId&&!bubble)throw Error('原台词图层已删除');if(bubble?.locked)throw Error('请先解锁对应台词图层');const r=sourceRegionOnFrame(source,source,size,roi),box={x:source.x+r.x*source.w,y:source.y+r.y*source.h,w:Math.max(30,r.w*source.w),h:Math.max(20,r.h*source.h)};
 if(bubble){const moved=applyBubbleEdit(bubble,{type:'move',dx:box.x-bubble.x,dy:box.y-bubble.y}),next=applyBubbleEdit(moved,{type:'resize',dx:box.w-moved.w,dy:box.h-moved.h});Object.assign(bubble,next);}
 else{const text=textRecord?productionTextContent(textRecord):emptyText,type=textRecord?.['类型']||'对白';bubble={id:id('bubble'),...box,parentPanelId:parent.id,shotId:parent.shotId,name:'替换气泡'+(textRecord?' · '+textRecord['文字ID']:''),text,speaker:textRecord?.['说话人']||'',type:/内心|心声|意念/.test(type)?'thought':/旁白|字幕|时间|地点|人名/.test(type)?'caption':'speech',shape:'oval',visible:true,locked:false,fillColor:'#ffffff',fillOpacity:1,outlineWidth:2.8,outlineColor:'#171b20',textColor:'#111111',fontFamily:'source-han-sans',fontSize:36,fontWeight:500,lineHeight:1.3333,padding:12,lineBreakMode:'auto',textFlowVersion:1,textAlign:'center',tail:{visible:true,side:'bottom',base:.54}};if(textRecord)Object.assign(bubble,{productionTextId:textRecord['文字ID'],productionSegment:segmentId,productionGridId:textRecord['格ID'],productionOriginal:clone(textRecord)});page.bubbles.push(bubble);}
 bubble.visible=true;bubble.tail||={visible:true,side:'bottom',base:.54};
 const config=resolveProductionStyle(project,segmentId);
 if(styleKind!=='current'){bubble.type=styleKind; bubble.productionBoxKind=styleKind==='caption'?'narration':styleKind;}
 const kind=productionStyleKind(bubble);if(styleKind!=='current'||config.boxes?.[kind]?.styleId==='none')config.boxes={...config.boxes,[kind]:{styleId:'default'}};
 applyProductionStyle(bubble,config);if(styleKind==='thought')bubble.shape='burst';if(styleKind==='caption')bubble.shape='rounded-rect';if(styleKind==='speech')bubble.shape='oval';
 if(bubble.type==='caption')bubble.tail.visible=false;if(bubble.shape==='none')bubble.shape='oval';if(bubble.fillOpacity===0&&bubble.outlineWidth===0){bubble.fillOpacity=1;bubble.outlineWidth=2.8;}
 bubble.parentPanelId=parent.id;bubble.localReplacement={version:1,patchLayerId:patch.id,taskId:patch.cutoutLayer.taskId};normalizeLayerOrder(project);project.layerOrder=project.layerOrder.filter(k=>k!==bubble.id);project.layerOrder.push(bubble.id);return bubble;
}
