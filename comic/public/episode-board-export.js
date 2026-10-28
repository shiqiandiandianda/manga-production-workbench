import {layoutLongStrip} from './model.js';
import {pageEpisode,currentBoardEpisode,resolveBoard,hasEpisodeBoard} from './episode-boards.js';
import {planEpisodeBoardTransition} from './episode-board-transitions.js';

/** Fixed templates wrap each episode. Source page geometry is preserved. */
export function episodeExportLayout(project,{episode=null,assets=project.assets||[],draft=false}={}){
 const original=layoutLongStrip(project.pages);if(!project.episodeBoards&&episode===null)return original;
 const byEpisode=new Map();for(const entry of original.pages){const number=pageEpisode(project,entry.page)||currentBoardEpisode(project,entry.page);if(!byEpisode.has(number))byEpisode.set(number,{episode:number,entries:[]});byEpisode.get(number).entries.push(entry);}const groups=[...byEpisode.values()];
 const parts=[],pages=[];let y=0;
 const append=(part,height,page)=>{const id=page?.id||`fixed-${part.kind}-${part.episode}-${parts.length}`;parts.push({...part,y,height,endY:y+height});pages.push({page:page||{id,width:1280,height,panels:[],bubbles:[]},pageId:id,index:pages.length,x:0,y,height,width:1280,scale:1,endY:y+height});y+=height;};
 for(const group of groups){if(episode!==null&&group.episode!==episode)continue;
  for(const kind of ['cover','comic','tail'])if(kind==='comic'){for(const entry of group.entries)append({kind,episode:group.episode,sourcePageId:entry.pageId,sourceY:entry.y,sourceHeight:entry.height,...(entry.page.designEpisodeRole?{designEpisodeRole:entry.page.designEpisodeRole}:{})},entry.height,entry.page);}else if(hasEpisodeBoard(project,kind,group.episode)){const board=resolveBoard(project,kind,group.episode,assets),transition=planEpisodeBoardTransition(project,original,board,null,{draft});append({kind,episode:group.episode,board,transition},board.height+(transition?.height||0));}
 }
 return {width:1280,height:y,pages,episodeBoardParts:parts,originalLayout:original};
}
