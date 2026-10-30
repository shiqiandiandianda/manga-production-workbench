import {bubbleSourceTextIds} from './bubble-dialogue-segments.js';
import {productionBubbleSegment} from './production-lettering-style.js';
export const dialogueVisible=entry=>entry.page.visible!==false&&entry.bubble.visible!==false&&entry.parent?.visible!==false&&!entry.bubble.productionModeHidden;
export const dialogueLocked=entry=>!!entry&&(entry.page.locked||entry.bubble.locked||entry.parent?.locked)||false;
/** Build once per view. Every rendition of a source stays indexed, visible first. */
export function dialogueEntries(project,pages=project.pages){
 const visible=[],hidden=[],byId=new Map(),bySource=new Map();
 for(const page of pages){
  const parents=new Map(page.panels.map(frame=>[frame.id,frame]));
  for(const bubble of page.bubbles||[]){
   if(!['speech','thought','caption','label','system'].includes(bubble.type))continue;
   const parent=parents.get(bubble.parentPanelId),entry={page,bubble,parent,segmentId:productionBubbleSegment(project,bubble,page,parent||null)};
   (dialogueVisible(entry)?visible:hidden).push(entry);byId.set(bubble.id,entry);
  }
 }
 const ordered=[...visible,...hidden];
 for(const entry of ordered)for(const textId of bubbleSourceTextIds(entry.bubble)){
  const key=entry.segmentId+':'+textId;
  if(!bySource.has(key))bySource.set(key,[]);
  bySource.get(key).push(entry);
 }
 return {ordered,byId,bySource};
}
