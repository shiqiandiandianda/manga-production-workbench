import {currentBoardEpisode,resolveBoard,hasEpisodeBoard,boardSvg,BOARD_LABELS} from './episode-boards.js';
import {layoutLongStrip} from './model.js';
import {assetUrl} from './asset-url.js';
import {planEpisodeBoardTransition,boardBridgeSvg} from './episode-board-transitions.js';

/** Fixed boards and their joining areas are display-only; saved comic coordinates stay unchanged. */
export function canvasEpisodeBoards(project,currentPage,assets=project.assets||[],options={}){
 if(!project?.episodeBoards)return null;const number=currentBoardEpisode(project,currentPage),original=layoutLongStrip(project.pages),make=kind=>{
  if(!hasEpisodeBoard(project,kind,number))return null;const board=resolveBoard(project,kind,number,assets),transition=planEpisodeBoardTransition(project,original,board,null,options),height=board.height+(transition?.height||0);
  return {board,transition,page:{id:'fixed-'+kind+'-'+project.id,width:1280,height,name:BOARD_LABELS[kind],background:board.background,panels:[],bubbles:[],fixedEpisodeBoard:kind}};
 };const cover=make('cover'),tail=make('tail');return cover||tail?{cover,tail}:null;
}
export function comicViewOffset(project,state,originalLayout){
 if(state.mode==='page')return originalLayout.pages.find(e=>e.pageId===state.currentPageId)?.y||0;
 const pages=new Map(originalLayout.pages.map(e=>[e.pageId,e]));
 const viewEntry=state.layout?.pages.find(e=>!e.page.fixedEpisodeBoard&&pages.has(e.pageId));
 return viewEntry?pages.get(viewEntry.pageId).y-viewEntry.y:0;
}
export function canvasBoardTransitionPlans(project,state,originalLayout,measurement,options={}){
 if(state.mode!=='continuous'||!state.decorations)return {};
 return Object.fromEntries(['cover','tail'].map(kind=>[kind,state.decorations[kind]?.transition||null]));
}
// Under both board and body content, bridge subpixel SVG clip edges without masking art.
export function canvasBoardBoundaryUnderlay(state,transitions){
 if(state.mode!=='continuous'||!state.decorations)return '';const bleed=1/Math.max(.01,state.zoom);let content='';
 for(const kind of ['cover','tail']){const plan=transitions[kind],item=state.decorations[kind];if(!plan||!item)continue;const entry=state.layout.pages.find(e=>e.pageId===item.page.id);if(!entry)continue;const y=kind==='cover'?entry.endY:entry.y;content+=`<rect x="0" y="${y-bleed}" width="1280" height="${bleed*2}" fill="${plan.color}" pointer-events="none"/>`;}
 return content;
}
export function canvasBoardMarkup(state,measurement,{transitions={},idPrefix=''}={}){
 if(state.mode!=='continuous'||!state.decorations)return '';let content='';
 for(const kind of ['cover','tail']){const decoration=state.decorations[kind];if(!decoration)continue;const entry=state.layout.pages.find(e=>e.pageId===decoration.page.id);if(!entry||entry.endY<=state.window.startY||entry.y>=state.window.endY)continue;const board=decoration.board,transition=transitions[kind]||null,bridgeHeight=transition?.height||0,boardY=entry.y+(kind==='tail'?bridgeHeight:0),bridgeY=entry.y+(kind==='cover'?board.height:0);
  const selected=state.fixedBoardSelection?.kind===board.kind&&state.fixedBoardSelection?.episode===board.episode,svg=boardSvg(board,measurement,{assetUrl,controls:selected,selectedKey:selected?state.fixedBoardSelection.key:''}).replace('<svg ',`<svg x="0" y="${boardY}" width="1280" height="${board.height}" `);
  const label=BOARD_LABELS[kind],font=Math.min(64,12/Math.max(.01,state.zoom)),margin=font*.6,art=`${svg}<rect x="${margin}" y="${boardY+margin}" width="${font*8.5}" height="${font*1.8}" rx="8" fill="#14283a" fill-opacity=".85" pointer-events="none"/><text x="${margin+font*.4}" y="${boardY+margin+font*1.3}" fill="#d8ecff" font-size="${font}" pointer-events="none">${label}${selected?' · 已选中':''}</text>`;
  const bridge=boardBridgeSvg(board,transition,{y:bridgeY,idPrefix}),inside=kind==='cover'?art+bridge:bridge+art;content+=`<g data-fixed-board="${kind}" data-fixed-episode="${board.episode}" role="button" tabindex="0" aria-label="在连续画布编辑第 ${board.context.displayNumber} 话${label}" style="cursor:pointer"><title>直接编辑${label}</title>${inside}</g>`;
 }
 return content;
}
