import {episodeNumber} from './episode-boards.js';
export function explicitPageEpisode(project,page){return episodeNumber(page.storyboard?.episode)||episodeNumber(project.shots?.find(s=>page.panels?.some(p=>p.shotId===s.id))?.episode)||null;}
export function missingEpisodePages(project){const declared=(project.productionPackage?.episodes||[]).map(e=>episodeNumber(e.episode)).filter(Boolean);return (project.pages||[]).filter(p=>!p.designEpisodeRole&&!explicitPageEpisode(project,p)&&declared.length!==1);}
export function assignMissingEpisodes(project,entries){
 const missing=missingEpisodePages(project);if(!missing.length)return;
 if(!entries||typeof entries!=='object'||Array.isArray(entries)||Object.keys(entries).length!==missing.length)throw Error('请为每个未归属画板填写话号');
 const values=missing.map(p=>{const raw=String(entries[p.id]??'');if(!/^[0-9]+$/.test(raw)||!Number.isSafeInteger(Number(raw))||Number(raw)<1||Number(raw)>9999)throw Error('话号只允许1到9999的阿拉伯数字');return [p,Number(raw)];});
 for(const [p,n]of values)p.storyboard={...p.storyboard,episode:n};
}
