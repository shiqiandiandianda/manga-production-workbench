import {episodeNumber,pageEpisode} from './episode-boards.js';
export function episodeFromLabel(value){
 const text=String(value??'').trim(),match=/第\s*([0-9０-９零〇一二两三四五六七八九十百千]+)\s*[话集]/u.exec(text);
 return episodeNumber(text)||episodeNumber(match?.[1]);
}
export function storyboardEpisodes(project){
 const episodes=new Map();
 for(const item of project?.storyboardImport?.episodes||[])episodes.set(item.episode,{...item,count:item.shotIds.length});
 for(const page of project?.pages||[]){if(page.designEpisodeRole)continue;const episode=pageEpisode(project,page);if(episode&&!episodes.has(episode))episodes.set(episode,{episode,title:'',count:project.shots.filter(s=>page.panels.some(p=>p.shotId===s.id)).length});}
 if(!episodes.size){const episode=episodeFromLabel(project?.importReview?.sheet)||episodeFromLabel(project?.title);if(episode)episodes.set(episode,{episode,title:'',count:project.shots.length});}
 return [...episodes.values()].sort((a,b)=>a.episode-b.episode);
}
export function shotsForEpisode(project,episode){
 const source=project.storyboardImport?.episodes.find(item=>item.episode===episode);
 if(source)return project.shots.filter(shot=>source.shotIds.includes(shot.id));
 const pages=project.pages.filter(page=>!page.designEpisodeRole&&pageEpisode(project,page)===episode),ids=new Set(pages.flatMap(page=>page.panels.map(panel=>panel.shotId)));
 return ids.size?project.shots.filter(shot=>ids.has(shot.id)):storyboardEpisodes(project).length===1?project.shots:[];
}
