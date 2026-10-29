import {pageEpisode} from './episode-boards.js';
export function bringEpisodeLetteringToFront(project,episode){
 const ids=new Set(project.pages.filter(p=>pageEpisode(project,p)===Number(episode)).flatMap(p=>p.bubbles.filter(b=>b.visible!==false).map(b=>b.id)));
 const order=project.layerOrder||[],top=order.filter(id=>ids.has(id));
 for(const id of ids)if(!top.includes(id))top.push(id);
 project.layerOrder=[...order.filter(id=>!ids.has(id)),...top];return project;
}
