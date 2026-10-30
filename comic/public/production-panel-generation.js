import {roundBubbleSize} from './round-bubble-default.js';
import {bubbleSourceTextIds} from './bubble-dialogue-segments.js';
import {productionTailVisible} from './bubble-tail-compat.js';
import {panel,clone,id} from './model.js';
import {productionTextContent} from './production-text.js';
import {productionSegment,productionFrame} from './production-package-model.js';
import {validateSliceRegion} from './panel-slices.js';
import {productionPanelPromptSource,productionPanelPrompts} from './production-panel-prompts.js';
import {applyProductionStyle,resolveProductionStyle} from './production-lettering-style.js';
import {fitDialogueObject} from './auto-lettering.js';

export const productionPanelSource=frame=>frame?.productionGrid||frame?.panelSlice;
export function productionPanelRecord(project,segmentId,gridId){return project?.productionPackage?.episodes.flatMap(e=>e.panelRecords).find(r=>r.segmentId===segmentId&&r.id===gridId);}
export function findProductionPanel(project,segmentId,gridId){const matches=project.pages.flatMap(p=>p.panels).filter(f=>{const source=productionPanelSource(f);return source?.segmentId===segmentId&&source.panelId===gridId&&!f.productionSupersededBy;});return matches.find(f=>f.panelSlice&&f.imageAssetId&&f.visible!==false)||matches.find(f=>f.imageAssetId)||matches[0];}
/** Confirmed regions take precedence. Otherwise the table's row/column order supplies an editable initial slot. */
export function productionPanelRegion(project,segmentId,gridId){
 const segment=productionSegment(project,segmentId),confirmed=segment?.regions?.[gridId];
 if(validateSliceRegion(confirmed))return {region:clone(confirmed),from:'confirmed'};
 const planned=segment?.plannedRegions?.[gridId];if(validateSliceRegion(planned))return {region:clone(planned),from:'layout-design'};
 const table=segment?.tableRegions?.[gridId];if(validateSliceRegion(table))return {region:clone(table),from:'storyboard-layout'};
 const rows=project.productionPackage.episodes.flatMap(e=>e.panelRecords).filter(r=>r.segmentId===segmentId),record=rows.find(r=>r.id===gridId);
 if(!record)throw Error('单格来源不存在：'+gridId);
 const rowKeys=[...new Set(rows.map(r=>r.layout?.['排']??r.id))],row=record.layout?.['排']??record.id,siblings=rows.filter(r=>(r.layout?.['排']??r.id)===row);
 const column=siblings.indexOf(record),rowIndex=rowKeys.indexOf(row),margin=.015,gap=.012;
 const w=(1-margin*2-gap*(siblings.length-1))/siblings.length,h=(1-margin*2-gap*(rowKeys.length-1))/rowKeys.length;
 const region={x:margin+column*(w+gap),y:margin+rowIndex*(h+gap),w,h},fields={...record.production,...record.original},declared=fields['目标宽高比']||fields['宽高比'];
 if(declared){
  const match=String(declared).normalize('NFKC').trim().match(/^(\d+(?:\.\d+)?)\s*[:/]\s*(\d+(?:\.\d+)?)$/u),ratio=match&&Number(match[1])/Number(match[2]),root=productionFrame(project,segmentId);
  if(!Number.isFinite(ratio)||ratio<1/12||ratio>12)throw Object.assign(Error('单格目标宽高比无效：'+gridId+'（请写16:9等比例）'),{status:400});
  const width=Math.min(region.w*root.w,region.h*root.h*ratio),height=width/ratio;
  return {region:{x:region.x+(region.w-width/root.w)/2,y:region.y+(region.h-height/root.h)/2,w:width/root.w,h:height/root.h},from:'storyboard-aspect'};
 }
 return {region,from:'storyboard-rows'};
}
export function prepareProductionPanel(project,segmentId,gridId){
 const segment=productionSegment(project,segmentId),root=productionFrame(project,segmentId),record=productionPanelRecord(project,segmentId,gridId);
 if(!segment||!root||!record)throw Object.assign(Error('请选择本屏段内的源格ID'),{status:400});
 const owner=project.pages.find(p=>p.panels.includes(root));
 if(owner.locked)throw Object.assign(Error('请先解锁画板'),{status:409});
 if(segment.pendingSourceFields)throw Object.assign(Error('此屏段有待处理的源提示词更新'),{status:409});
 let target=findProductionPanel(project,segmentId,gridId);
 if(target?.locked)throw Object.assign(Error('请先解锁本格'),{status:409});
 if(!target){
  const {region,from}=productionPanelRegion(project,segmentId,gridId);
  target=panel('',root.x+region.x*root.w,root.y+region.y*root.h,Math.max(20,region.w*root.w),Math.max(20,region.h*root.h));
  target.name=gridId+' · 单格';target.border=record.layout?.['边框']==='无框'?0:2;target.referenceIds=[];
  target.productionGrid={version:1,panelId:gridId,segmentId,rootPanelId:root.id,placementSource:from};
  owner.panels.push(target);project.layerOrder||=[];const index=project.layerOrder.indexOf(root.id);project.layerOrder.splice(index<0?project.layerOrder.length:index+1,0,target.id);
 }else if(!target.productionGrid)target.productionGrid={version:1,panelId:gridId,segmentId,rootPanelId:root.id,placementSource:'existing-slice'};
 const source=productionPanelPromptSource(record,segment.panelPromptSources?.[gridId]||(target.productionGrid?.sourceBindingVersion===1?target.generation?.promptSource:undefined));
 target.generation={...target.generation,version:1,promptSource:source};
 return {panel:target,source,prompts:productionPanelPrompts(record)};
}
/** Add only this source grid's tool text. Existing lettering, including manual positioning, stays intact. */
const letteringSnapshot=bubble=>JSON.stringify(Object.fromEntries(Object.entries(bubble).filter(([key])=>!['productionAutoLettering','productionModeHidden','productionModeVisible','visible'].includes(key))));
export const automaticLetteringUntouched=bubble=>!!bubble.productionAutoLettering&&bubble.productionAutoLettering.snapshot===letteringSnapshot(bubble)&&!bubble.locked;
export function productionPanelLetteringPending(project,segmentId){
 return false;
}
export function ensureProductionSegmentLettering(){return {created:0,skipped:0};}
export function applyProductionPanelLettering(project,segmentId,gridId,{automatic=false}={}){
 const frame=findProductionPanel(project,segmentId,gridId),episode=project.productionPackage.episodes.find(e=>e.panelRecords.some(r=>r.id===gridId&&r.segmentId===segmentId));
 if(!frame)throw Object.assign(Error('请先切换为单格生成'),{status:409});
 return applyProductionFrameLettering(project,frame,episode,segmentId,episode.texts.filter(t=>t['格ID']===gridId&&t['渲染']==='工具'),{automatic,gridId});
}
export function applyProductionFrameLettering(project,frame,episode,segmentId,texts,{automatic=false,gridId,rectForText}={}){
 if(automatic)return {created:0,skipped:0,manualPlacementRequired:true};
 const page=project.pages.find(p=>p.panels.includes(frame));if(frame.locked||page.locked){throw Object.assign(Error('请先解锁本格和画板'),{status:409});}
 const source=frame.generation?.promptSource||'post-lettering',empty=source!=='post-lettering',style=resolveProductionStyle(project,segmentId),fontSize=style.fontSize||episode.typography?.['字号']||36;
 let created=0,skipped=0;const placed=new Map();
 for(const text of texts){
  const box=rectForText?.(text)||frame,key=text['格ID']||'',index=placed.get(key)||0;
  const existing=page.bubbles.find(b=>b.parentPanelId===frame.id&&bubbleSourceTextIds(b).includes(text['文字ID']));
  if(existing){skipped++;continue;}
  const lines=text['分行']||[text['文本']];let w=Math.min(box.w,Math.max(80,Math.min(box.w*.7,Math.max(...lines.map(l=>[...String(l)].length))*fontSize+fontSize))),wrap=Math.max(1,Math.floor(w*(empty ? .9 : .68)/fontSize)),rows=lines.reduce((n,l)=>n+Math.max(1,Math.ceil([...String(l)].length/wrap)),0),h=Math.min(box.h,Math.max(35,rows*fontSize*1.333+fontSize*.8));
  const anchor=episode.anchors[text['锚点']]?.['中心']||[.5,.16],thought=/心声|内心|意念/u.test(text['类型']),caption=/旁白|字幕|人名|地点|时间/u.test(text['类型']);
  const custom=style.boxes?.[thought?'thought':'speech']?.styleId;if(!empty&&!caption&&(!custom||['default','builtin-oval'].includes(custom)))({w,h}=roundBubbleSize(productionTextContent(text),fontSize,{maxSize:Math.min(box.w,box.h)}));
  const bubble={id:id('bubble'),parentPanelId:frame.id,shotId:frame.shotId,productionTextId:text['文字ID'],productionSegment:segmentId,productionGridId:gridId||text['格ID'],name:text['文字ID']+' · '+text['类型'],productionOriginal:clone(text),speaker:text['说话人']||'',text:productionTextContent(text),x:Math.max(0,Math.min(page.width-w,box.x+box.w*anchor[0]-w/2)),y:Math.max(box.y,box.y+Math.min(box.h-h,Math.max(0,box.h*anchor[1]-h/2+index*(h+12)))),w,h,type:thought?'thought':caption?'caption':'speech',shape:empty?'none':caption?'rounded-rect':thought?'burst':'oval',fillColor:'#ffffff',fillOpacity:empty?0:1,outlineWidth:empty?0:2,textColor:'#111111',fontFamily:style.fontFamily||'source-han-sans',fontWeight:style.fontWeight||500,fontSize,lineHeight:48/36,lineBreakMode:'auto',textFlowVersion:1,textAlign:'center',visible:true,locked:false,tail:{visible:!empty&&productionTailVisible(text,thought?'thought':caption?'caption':'speech'),side:({上:'top',下:'bottom',左:'left',右:'right'})[text['泡尾']?.['方向']]||'bottom',base:.5}};
  bubble.x=Math.max(box.x,Math.min(box.x+box.w-w,bubble.x));
  const occupied=page.bubbles.filter(b=>b.parentPanelId===frame.id&&b.visible!==false).sort((a,b)=>a.y-b.y);for(const b of occupied)if(bubble.x<b.x+b.w+8&&bubble.x+w+8>b.x&&bubble.y<b.y+b.h+12&&bubble.y+h+12>b.y)bubble.y=Math.min(box.y+box.h-h,b.y+b.h+12);
  applyProductionStyle(bubble,style);if(!empty){const fitted=fitDialogueObject(null,bubble,{pageWidth:page.width,parentWidth:box.w,maxHeight:box.h});if(fitted.status==='fitted')Object.assign(bubble,fitted.bubble);}bubble.x=Math.max(box.x,Math.min(box.x+box.w-bubble.w,bubble.x));bubble.y=Math.max(box.y,Math.min(box.y+box.h-bubble.h,bubble.y));for(const other of occupied)if(bubble.x<other.x+other.w+8&&bubble.x+bubble.w+8>other.x&&bubble.y<other.y+other.h+12&&bubble.y+bubble.h+12>other.y&&other.y+other.h+12+bubble.h<=box.y+box.h)bubble.y=other.y+other.h+12;page.bubbles.push(bubble);project.layerOrder||=[];project.layerOrder.push(bubble.id);created++;placed.set(key,index+1);
 }
 return {created,skipped};
}
