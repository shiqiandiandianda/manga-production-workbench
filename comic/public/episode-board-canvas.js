import {currentBoardEpisode,resolveBoard,boardSvg,BOARD_LABELS} from './episode-boards.js';
import {assetUrl} from './asset-url.js';

/** Fixed templates share the continuous canvas; saved comic coordinates stay unchanged. */
export function canvasEpisodeBoards(project,currentPage,assets=project.assets||[]){
 if(!project?.episodeBoards)return null;const number=currentBoardEpisode(project,currentPage),make=kind=>{const board=resolveBoard(project,kind,number,assets);return {board,page:{id:'fixed-'+kind+'-'+project.id,width:1280,height:board.height,name:BOARD_LABELS[kind],background:board.background,panels:[],bubbles:[],fixedEpisodeBoard:kind}};};
 return {cover:make('cover'),tail:make('tail')};
}
export function comicViewOffset(project,state,originalLayout){
 if(state.mode==='page')return originalLayout.pages.find(e=>e.pageId===state.currentPageId)?.y||0;
 // A transition can still carry the previous project's viewport, or a deleted page.
 const pages=new Map(originalLayout.pages.map(e=>[e.pageId,e]));
 const viewEntry=state.layout?.pages.find(e=>!e.page.fixedEpisodeBoard&&pages.has(e.pageId));
 return viewEntry?pages.get(viewEntry.pageId).y-viewEntry.y:0;
}
export function canvasBoardMarkup(state,measurement){
 if(state.mode!=='continuous'||!state.decorations)return '';let content='';const cover=state.decorations.cover,tail=state.decorations.tail;
 for(const decoration of [cover,tail]){const entry=state.layout.pages.find(e=>e.pageId===decoration.page.id);if(!entry||entry.endY<=state.window.startY||entry.y>=state.window.endY)continue;const board=decoration.board;
  const selected=state.fixedBoardSelection?.kind===board.kind&&state.fixedBoardSelection?.episode===board.episode,svg=boardSvg(board,measurement,{assetUrl,controls:selected,selectedKey:selected?state.fixedBoardSelection.key:''}).replace('<svg ',`<svg x="0" y="${entry.y}" width="1280" height="${entry.height}" `);
  const label=BOARD_LABELS[board.kind],font=Math.min(64,12/Math.max(.01,state.zoom)),margin=font*.6;content+=`<g data-fixed-board="${board.kind}" data-fixed-episode="${board.episode}" role="button" tabindex="0" aria-label="在连续画布编辑第 ${board.context.displayNumber} 话${label}" style="cursor:pointer"><title>直接编辑${label}</title>${svg}<rect x="${margin}" y="${entry.y+margin}" width="${font*8.5}" height="${font*1.8}" rx="8" fill="#14283a" fill-opacity=".85" pointer-events="none"/><text x="${margin+font*.4}" y="${entry.y+margin+font*1.3}" fill="#d8ecff" font-size="${font}" pointer-events="none">${label}${selected?' · 已选中':''}</text></g>`;
 }
 return content;
}
