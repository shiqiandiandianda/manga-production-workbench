import {dialogueEntries,dialogueVisible as visible} from './dialogue-entries.js';
import {dialogueSegments} from './bubble-dialogue-segments.js';
import {productionStyleSegments} from './production-lettering-style.js';

// Source text IDs remain the identity across screen, single-panel and cropped views.
// Prefer the visible rendition; never show the hidden source as another dialogue.
export function dialogueInventory(project,segmentId,scope='screen'){
 const segments=productionStyleSegments(project,segmentId,scope),{ordered:all,bySource}=dialogueEntries(project),ordered=all.filter(e=>segments.has(e.segmentId)),used=new Set(),rows=[];
 for(const episode of project.productionPackage?.episodes||[])for(const segment of episode.segments){
  if(!segments.has(segment.id))continue;
  for(const text of (episode.texts||[]).filter(t=>t['段ID']===segment.localId&&t['渲染']==='工具')){
   const matches=bySource.get(segment.id+':'+text['文字ID'])||[];for(const e of matches)used.add(e.bubble.id);
   const entry=matches[0],part=dialogueSegments(entry?.bubble||{}).find(s=>s.sourceTextId===text['文字ID']),locked=!!(entry&&(entry.page.locked||entry.bubble.locked||entry.parent?.locked));
   rows.push({key:segment.id+':'+text['文字ID'],segmentId:segment.id,episode:episode.episode,gridId:text['格ID'],textId:text['文字ID'],text:part?.text??entry?.bubble.text??text['文本'],speaker:part?.speaker||entry?.bubble.speaker||text['说话人']||'',kind:text['类型']||'对白',bubbleId:entry?.bubble.id,pageId:entry?.page.id,locked,status:!entry?'missing':locked?'locked':visible(entry)?'placed':'hidden'});
  }
 }
 const sourceKeys=new Set(rows.map(r=>r.key));
 for(const e of ordered){const parts=dialogueSegments(e.bubble),items=parts.length?parts.filter(s=>!sourceKeys.has(e.segmentId+':'+s.sourceTextId)):used.has(e.bubble.id)?[]:[e.bubble];for(const item of items){const key=e.bubble.id+':'+item.id;if(used.has(key))continue;used.add(key);const locked=!!(e.page.locked||e.bubble.locked||e.parent?.locked);rows.push({key,segmentId:e.segmentId,text:item.text,speaker:item.speaker||e.bubble.speaker||'',kind:({speech:'对白',thought:'内心',caption:'旁白'})[e.bubble.type]||'文字',bubbleId:e.bubble.id,pageId:e.page.id,locked,status:locked?'locked':visible(e)?'placed':'hidden',manual:true});}}
 return rows;
}
