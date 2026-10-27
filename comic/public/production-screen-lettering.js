import {productionFrame,productionSegment} from './production-package-model.js';
import {applyProductionFrameLettering,productionPanelRegion} from './production-panel-generation.js';

function context(project,segmentId,{manual=false}={}){
 if(['single-mode-20261027','post-lettering-20261027'].includes(project?.productionPackage?.sourceFormat))return null;
 const segment=productionSegment(project,segmentId),frame=productionFrame(project,segmentId),episode=project?.productionPackage?.episodes.find(e=>e.episode===segment?.episode),page=project?.pages.find(p=>p.panels.includes(frame));
 // In empty-bubble mode the source image owns the bubbles. Guessing a text
 // position can cover artwork or miss the bubble; the crop editor requires an
 // explicit placement before applying text.
 return segment&&frame&&episode&&page&&(manual||!frame.locked&&!page.locked)&&!['direct','imported'].includes(frame.generation?.promptSource)?{segment,frame,episode,page}:null;
}
export function productionScreenLetteringPending(project,segmentId){
 const c=context(project,segmentId);return !!c&&c.frame.productionLetteringVersion!==1;
}
/** Use source-grid regions for an editable initial placement, without changing the screen image or layout. */
export function ensureProductionScreenLettering(project,segmentId,{manual=false}={}){
 const c=context(project,segmentId,{manual});if(!c)return {created:0,skipped:0};
 const {segment,frame,episode}=c,rects=new Map();
 const texts=episode.texts.filter(t=>t['段ID']===segment.localId&&t['渲染']==='工具');
 for(const gridId of new Set(texts.map(t=>t['格ID']))){
  if(!segment.panelIds.includes(gridId))continue;
  const {region:r}=productionPanelRegion(project,segmentId,gridId);
  rects.set(gridId,{x:frame.x+r.x*frame.w,y:frame.y+r.y*frame.h,w:r.w*frame.w,h:r.h*frame.h});
 }
 return applyProductionFrameLettering(project,frame,episode,segmentId,texts.filter(t=>rects.has(t['格ID'])),{automatic:!manual,rectForText:t=>rects.get(t['格ID'])});
}
