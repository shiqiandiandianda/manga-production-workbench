import {createHash} from 'node:crypto';
import {panel,id,clone} from '../public/model.js';
import {pageEpisode} from '../public/episode-boards.js';
export const documentHash=project=>createHash('sha256').update(JSON.stringify(project)).digest('hex');
// A plain import projection: full-width placeholders in source order.
export function storyboardPage(episode,shots){
 let y=0;const panels=shots.map(shot=>{const frame=panel(shot.id,0,y,1280,720);frame.name=shot.code;frame.border=0;frame.feather=0;y+=760;return frame;});
 return {id:id('page'),name:'第'+episode+'话',width:1280,height:Math.max(1,y-40),background:'#ffffff',panels,bubbles:[],storyboard:{episode,projection:'source-order'}};
}
// Match episode and source code, retaining artwork and manual geometry.
export function mergeStoryboardImport(existing,incoming){
 const next=clone(existing),known=new Map(next.shots.map(shot=>[String(shot.episode??shot.storyboard?.episode??next.pages.find(page=>page.panels.some(frame=>frame.shotId===shot.id))?.storyboard?.episode??0)+':'+String(shot.code),shot])),episodes=new Map((next.storyboardImport?.episodes||[]).map(episode=>[episode.episode,episode]));
 for(const entry of incoming.storyboardImport.episodes){
  const rows=incoming.shots.filter(shot=>entry.shotIds.includes(shot.id)),shotIds=[];
  for(const row of rows){const key=entry.episode+':'+String(row.code),prior=known.get(key),shot={...row,id:prior?.id||row.id,referenceIds:prior?.referenceIds||row.referenceIds||[]},index=next.shots.findIndex(value=>value.id===shot.id);if(index<0)next.shots.push(shot);else next.shots[index]=shot;known.set(key,shot);shotIds.push(shot.id);}
  let page=next.pages.find(value=>!value.designEpisodeRole&&pageEpisode(next,value)===entry.episode);
  if(!page){page=storyboardPage(entry.episode,shotIds.map(id=>next.shots.find(shot=>shot.id===id)));next.pages.push(page);}else{
   const placed=new Set(next.pages.flatMap(value=>value.panels.map(frame=>frame.shotId))),missing=shotIds.map(id=>next.shots.find(shot=>shot.id===id)).filter(shot=>!placed.has(shot.id));
   let y=Math.max(0,...page.panels.map(frame=>frame.y+frame.h))+40;for(const shot of missing){const frame=panel(shot.id,0,y,1280,720);frame.name=shot.code;frame.border=0;page.panels.push(frame);y+=760;}page.height=Math.max(page.height,y-40);
  }
  for(const page of next.pages)for(const frame of page.panels){const shot=next.shots.find(value=>value.id===frame.shotId);if(shot&&shotIds.includes(shot.id)&&frame.generation?.sourceSnapshot)frame.generation.sourceSnapshot.original=clone(shot);}
  episodes.set(entry.episode,{...entry,shotIds,status:'imported'});
 }
 next.storyboardImport={...incoming.storyboardImport,episodes:[...episodes.values()].sort((a,b)=>a.episode-b.episode)};
 return next;
}
