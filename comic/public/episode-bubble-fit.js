import {episodePages} from './episode-workspace.js';
import {currentBoardEpisode} from './episode-boards.js';
import {fitDialogueBubble,bubbleLayout,normalizeBubbleStyle} from './lettering.js';
import {panelForBubble} from './layer-groups.js';
import {isLibrarySfx} from './sfx-library.js';

// Plan first so a failed measurement cannot leave a partially edited episode.
export function episodeBubbleFitPlan(context,project,currentPage){
 const result={episode:currentBoardEpisode(project,currentPage),changes:[],total:0,locked:0,hidden:0,empty:0,unsupported:0,unchanged:0,overflow:0};
 for(const page of episodePages(project,currentPage)){
  if(page.designEpisodeRole)continue;
  for(const bubble of page.bubbles||[]){
   result.total++;
   const owner=panelForBubble(project,bubble.id)?.item;
   if(page.locked||bubble.locked||owner?.locked){result.locked++;continue;}
   if(page.visible===false||bubble.visible===false){result.hidden++;continue;}
   if(bubble.type!=='speech'||isLibrarySfx(bubble)||normalizeBubbleStyle(bubble).shape==='none'){result.unsupported++;continue;}
   if(!String(bubble.text||'').trim()){result.empty++;continue;}
   const fitted=fitDialogueBubble(context,bubble,{maxWidth:page.width*.55});
   if(bubbleLayout(context,fitted,{autoFit:false}).overflow)result.overflow++;
   if(JSON.stringify(fitted)===JSON.stringify(bubble)){result.unchanged++;continue;}
   result.changes.push({pageId:page.id,bubble:fitted});
  }
 }
 return result;
}

export function episodeBubbleFitMessage(result){
 const skipped=result.locked+result.hidden+result.empty+result.unsupported;
 return '第'+result.episode+'话：已适配 '+result.changes.length+' 个对白气泡'+(result.unchanged?'，'+result.unchanged+' 个无需调整':'')+(skipped?'；跳过 '+skipped+' 个（锁定 '+result.locked+'、隐藏 '+result.hidden+'、空白 '+result.empty+'、旁白/其他文字或无框气泡 '+result.unsupported+'）':'')+(result.overflow?'；'+result.overflow+' 个仍有文字溢出，请单独检查':'')+(result.changes.length?'。可一次撤销。':'。');
}
