import {clone} from './model.js';
import {scaleReflowLettering} from './reflow-lettering.mjs';
import {productionFrame} from './production-package-model.js';

const fail=message=>{throw Object.assign(Error(message),{status:409});};
const parent=f=>f.cutoutLayer?.parentPanelId||f.parentPanelId||f.breakoutForeground?.backgroundPanelId;

/** Transfer the confirmed result into the source episode, keeping its document and boards. */
export function returnReflowToCanvas(original,rendered,{episode,items,geometry,script,batchId}){
 const next=clone(original),ep=next.productionPackage.episodes.find(e=>e.episode===episode);
 const source=rendered.pages[0],newFrames=source.panels.filter(f=>f.visible!==false&&f.autoLayoutCrop?.batchId===batchId);
 if(newFrames.length!==items.length)fail('接回格数与本话来源不一致');
 const targets=new Map(),pagePlans=new Map();
 for(const segment of ep.segments){
  const root=productionFrame(next,segment.id),page=next.pages.find(p=>p.panels.includes(root));
  if(!page||page.locked)fail('请先核对并解锁本话原画板');
  targets.set(segment.id,page);
  if(!pagePlans.has(page.id)){const first=geometry.panels.find(p=>p.key===segment.panelIds[0]);if(!first)fail('缺少屏段首格');pagePlans.set(page.id,{page,start:pagePlans.size?Math.floor(first.y):0});}
 }
 const plans=[...pagePlans.values()];
 for(let i=0;i<plans.length;i++){
  const {page,start}=plans[i],height=(plans[i+1]?.start??geometry.canvas.height)-start;
  if(height<1)fail('重排结果跨画板顺序无效');
  const previous=page.productionUnit||'screen';page.productionLayoutViews||={version:1};
  page.productionLayoutViews[previous]={height:page.height,background:page.background};
  page.productionLayoutViews.panel={height,background:'#ffffff'};page.height=height;page.background='#ffffff';page.productionUnit='panel';
 }
 const segmentIds=new Set(ep.segments.map(s=>s.id)),gridIds=new Set(ep.panelRecords.map(r=>r.id));
 const all=next.pages.flatMap(p=>p.panels),oldById=new Map(all.map(f=>[f.id,clone(f)])),owned=new Set(all.filter(f=>segmentIds.has(f.productionSegment)||segmentIds.has(f.panelSlice?.segmentId)||segmentIds.has(f.productionGrid?.segmentId)||segmentIds.has(f.productionBackground?.replace(/-BG$/,''))||segmentIds.has(f.productionBackgroundInstance?.segmentId)).map(f=>f.id));
 let grew;do{grew=false;for(const f of all)if(!owned.has(f.id)&&owned.has(parent(f))){owned.add(f.id);grew=true;}}while(grew);
 const hide=f=>{if(f.productionModeHidden!==true){f.productionModeVisible=f.visible!==false;f.productionModeHidden=true;}f.visible=false;};
 for(const page of next.pages)for(const f of [...page.panels,...page.bubbles])if(owned.has(f.id)||owned.has(f.parentPanelId)||segmentIds.has(f.productionSegment)||gridIds.has(f.productionGridId))hide(f);
 const active=f=>{f.visible=true;delete f.productionModeHidden;delete f.productionModeVisible;};
 const frameIds=new Map(),shotIds=new Map(),placements=new Map(),visibleOrder=[];
 for(const f of newFrames){
  const item=items.find(i=>i.key===f.panelSlice.panelId),page=targets.get(item.segmentId),start=pagePlans.get(page.id).start,old=item.existingPanelId&&oldById.get(item.existingPanelId);
  if(old?.locked)fail('请先解锁本格：'+item.key);
  const replacement={...(old||{}),...clone(f),id:old?.id||f.id,y:f.y-start};
  const shot=rendered.shots.find(s=>s.id===f.shotId),existingShot=next.shots.find(s=>s.id===old?.shotId)||next.shots.find(s=>s.productionGridId===item.key&&s.productionSliceSegment===item.segmentId);
  const shotId=existingShot?.id||shot.id;if(!existingShot)next.shots.push(clone(shot));replacement.shotId=shotId;
  replacement.productionGrid={...(old?.productionGrid||{}),version:1,rootPanelId:item.rootPanelId,segmentId:item.segmentId,panelId:item.key,placementSource:'assistant-preview'};
  active(replacement);frameIds.set(f.id,replacement.id);shotIds.set(f.shotId,shotId);placements.set(f.id,{page,start,old,replacement});
  if(old){const owner=next.pages.find(p=>p.panels.some(x=>x.id===old.id));if(owner!==page)fail('已有裁格不在来源画板中：'+item.key);owner.panels[owner.panels.findIndex(x=>x.id===old.id)]=replacement;}
  else page.panels.push(replacement);
  visibleOrder.push(replacement.id);
 }
 const movedBubbles=new Set();
 for(const b of source.bubbles.filter(b=>b.visible!==false)){
  const placement=placements.get(b.parentPanelId);if(!placement)continue;
  const oldId=b.autoLayoutSourceBubbleId,old=next.pages.flatMap(p=>p.bubbles).find(x=>x.id===oldId);
  if(old?.locked)fail('请先解锁本格文字');
  const moved={...clone(b),id:old?.id||b.id,parentPanelId:frameIds.get(b.parentPanelId),shotId:shotIds.get(b.shotId),y:b.y-placement.start};
  if(moved.tail?.mode!=='normalized'&&Number.isFinite(moved.tail?.y))moved.tail.y-=placement.start;
  active(moved);if(old){const owner=next.pages.find(p=>p.bubbles.includes(old));owner.bubbles.splice(owner.bubbles.indexOf(old),1);}
  placement.page.bubbles.push(moved);movedBubbles.add(moved.id);visibleOrder.push(moved.id);
 }
 // Preserve patch, upscale and other manually attached children alongside their original parent IDs.
 for(const {old,replacement,page} of placements.values())if(old){
  const family=new Set([old.id]);let more;do{more=false;for(const f of all)if(!family.has(f.id)&&family.has(parent(f))){family.add(f.id);more=true;}}while(more);
  const ratio=replacement.w/old.w;
  for(const f of [...page.panels,...page.bubbles])if(f.id!==old.id&&!movedBubbles.has(f.id)&&(family.has(f.id)||family.has(f.parentPanelId))){
   if(f.locked)fail('请先解锁本格关联图层');
   const before=original.pages.flatMap(p=>[...p.panels,...p.bubbles]).find(x=>x.id===f.id);if(!before)continue;
   Object.assign(f,{x:replacement.x+(before.x-old.x)*ratio,y:replacement.y+(before.y-old.y)*ratio,w:before.w*ratio,h:before.h*ratio,visible:before.visible});
   delete f.productionModeHidden;delete f.productionModeVisible;
   if(f.imageTransform)for(const k of ['x','y','scale'])if(Number.isFinite(f.imageTransform[k]))f.imageTransform[k]*=ratio;
   if(f.text!==undefined){scaleReflowLettering(f,ratio);if(f.tail?.mode!=='normalized'&&Number.isFinite(f.tail?.x)&&Number.isFinite(f.tail?.y)){f.tail.x=replacement.x+(before.tail.x-old.x)*ratio;f.tail.y=replacement.y+(before.tail.y-old.y)*ratio;}}
  }
 }
 const oldBackgrounds=(next.gradients||[]).filter(g=>g.assistantLayoutAnchor?.episode===episode||g.designEpisode===episode||original.autoLayoutSource?.mode==='screen-crop-reflow'&&!g.assistantLayoutAnchor&&!g.designEpisode);
 for(const g of oldBackgrounds){if(g.locked)fail('请先解锁本话底图');hide(g);}
 const backgrounds=rendered.gradients.filter(g=>!original.gradients?.some(old=>old.id===g.id)).map(g=>({...clone(g),designEpisode:episode,assistantLayoutAnchor:{episode,pageId:plans[0].page.id,y:g.y}}));
 next.gradients||=[];next.gradients.push(...backgrounds);
 next.layerOrder=[...backgrounds.map(g=>g.id),...(next.layerOrder||[]).filter(key=>!visibleOrder.includes(key)),...visibleOrder];
 next.productionEpisodeViews||={};next.productionEpisodeViews[episode]={...(next.productionEpisodeViews[episode]||{}),unit:'panel',segments:Object.fromEntries(ep.segments.map(s=>[s.id,'panel']))};
 next.episodeReflows||={};next.episodeReflows[episode]={...clone(rendered.autoLayoutSource),sourceProjectId:original.id,geometry:clone(geometry),appliedToCurrentProject:true};
 next.layoutRuleBindings||={};next.layoutRuleBindings[episode]={...(next.layoutRuleBindings[episode]||{}),contract:clone(script.layoutRuleContract),scriptId:script.id,geometry:clone(geometry),targetPanels:clone(geometry.panels),appliedToCurrentProject:true};
 return next;
}
