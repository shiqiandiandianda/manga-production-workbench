import {currentBoardEpisode} from './episode-boards.js';

// Resolve the original records for a screen, a crop, or a text layer without changing selection.
export function productionDisplayContext(project,page,item){
 const episodes=project?.productionPackage?.episodes||[];
 const owner=item?.parentPanelId&&project?.pages?.flatMap(p=>p.panels).find(p=>p.id===item.parentPanelId);
 const frame=owner||item,gridId=item?.productionGridId||frame?.productionGrid?.panelId||frame?.panelSlice?.panelId;
 const segmentId=frame?.productionSegment||frame?.productionGrid?.segmentId||frame?.panelSlice?.segmentId||item?.productionSegment||page?.storyboard?.segmentId;
 const number=project?currentBoardEpisode(project,page):null;
 const episode=episodes.find(e=>e.segments?.some(s=>s.id===segmentId))||episodes.find(e=>e.episode===number);
 const segment=episode?.segments.find(s=>s.id===segmentId);
 const records=(episode?.panelRecords||[]).filter(r=>gridId?r.id===gridId:segment?r.segmentId===segment.id:false);
 return {episode,segment,records,gridId};
}

export function sourceLocations(record){
 const original=record.original||{},out=[];
 for(const text of [original['原著位置']].flat().filter(v=>typeof v==='string')){
  for(const match of text.matchAll(/第\s*(\d+)\s*章([^章]*?)(?=第\s*\d+\s*章|$)/gu)){
   const line=/(?:行\s*(\d+)|第\s*(\d+)\s*行)/u.exec(match[2]);
   const paragraph=/非空段\s*(\d+)/u.exec(match[2]);
   out.push({chapter:Number(match[1]),line:line?Number(line[1]||line[2]):null,paragraph:paragraph?Number(paragraph[1]):null});
  }
 }
 for(const entry of original['台词']||[]){
  const basis=entry['保留依据'];
  if(Number.isInteger(basis?.['章节']))out.push({chapter:basis['章节'],line:Number.isInteger(basis['纯文本行号'])?basis['纯文本行号']:null,quote:basis['原文摘录']||''});
 }
 return out.filter(v=>v.chapter>0);
}

export function novelEpisodeContext(project,page,item){
 const context=productionDisplayContext(project,page,item),all=context.episode?.panelRecords||[];
 return {...context,chapters:[...new Set(all.flatMap(sourceLocations).map(v=>v.chapter))].sort((a,b)=>a-b),locations:context.records.flatMap(sourceLocations)};
}

export function isSourceParagraph(paragraph,index,chapter,locations){
 return locations.some(loc=>loc.chapter===chapter&&(loc.line?loc.line===paragraph.line:loc.paragraph?loc.paragraph===index+1:false)&&(!loc.quote||paragraph.text.includes(loc.quote)));
}
