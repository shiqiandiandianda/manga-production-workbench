import {currentBoardEpisode,pageEpisode,episodeCatalog,episodeNumber} from './episode-boards.js';
import {layoutLongStrip} from './model.js';

export function episodePages(project,currentPage){
 if(!project)return [];
 const number=currentBoardEpisode(project,currentPage),pages=project.pages.filter(page=>pageEpisode(project,page)===number);
 return pages.length?pages:project.pages.filter(page=>!pageEpisode(project,page));
}
export function episodeShots(project,currentPage){
 if(!project)return [];
 const number=currentBoardEpisode(project,currentPage),ids=new Set(episodePages(project,currentPage).flatMap(page=>page.panels.map(frame=>frame.shotId))),source=project.storyboardImport?.episodes.find(entry=>entry.episode===number);
 for(const id of source?.shotIds||[])ids.add(id);
 return project.shots.filter(shot=>episodeNumber(shot.episode??shot.storyboard?.episode)===number||ids.has(shot.id)||!episodeNumber(shot.episode??shot.storyboard?.episode)&&episodeCatalog(project).length===1);
}
export function episodeLayerProject(project,currentPage){
 if(!project)return null;
 const pages=episodePages(project,currentPage),ids=new Set(pages.map(page=>page.id)),number=currentBoardEpisode(project,currentPage),layout=layoutLongStrip(project.pages),bands=layout.pages.filter(entry=>ids.has(entry.pageId));
 const gradients=(project.gradients||[]).filter(layer=>Number.isInteger(layer.designEpisode)?layer.designEpisode===number:layer.stripSpace?.pageId?ids.has(layer.stripSpace.pageId):layer.coverage==='document'||bands.some(entry=>layer.y+layer.h>entry.y&&layer.y<entry.endY));
 return {...project,pages,shots:episodeShots(project,currentPage),gradients};
}
