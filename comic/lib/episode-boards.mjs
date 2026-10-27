import {defaultBoardTemplates,ensureEpisodeBoards,episodeNumber,validateEpisodeBoards} from '../public/episode-boards.js';

const copy=value=>structuredClone(value);
export function readEpisodeOutline(workbook,{fileKey='',fileName='',sheet=''}={}){
 const candidates=[];let workTitle='';
 for(const page of workbook||[]){const rows=page.table||page.rows||[];for(const row of rows.slice(0,6)){for(const cell of row||[]){const match=/《([^》]+)》/u.exec(String(cell??''));if(match&&!workTitle)workTitle=match[1].trim();}}
  let header=-1,columns,numberIndex,titleIndex;for(let i=0;i<Math.min(15,rows.length);i++){columns=(rows[i]||[]).map(v=>String(v??'').trim());numberIndex=columns.findIndex(c=>['话数','话','第几话','集数'].includes(c));titleIndex=columns.findIndex(c=>['话名','本话名称','本话名','章节标题','集名'].includes(c));if(numberIndex>=0&&titleIndex>=0){header=i;break;}}
  if(header<0)continue;for(const row of rows.slice(header+1)){const number=episodeNumber(row?.[numberIndex]);if(!number)continue;const title=String(row?.[titleIndex]??'').trim().slice(0,1000);candidates.push({episode:number,title,sourceSheet:page.name,priority:/分话细纲|分集细纲|细纲/u.test(page.name)?2:1});}
 }
 const map=new Map();for(const row of candidates){const previous=map.get(row.episode);if(!previous||row.priority>previous.priority||row.priority===previous.priority&&row.title&&!previous.title)map.set(row.episode,row);}
 const episodes=[...map.values()].sort((a,b)=>a.episode-b.episode).map(({priority,...row})=>row);let currentEpisode=episodeNumber(/第\s*([0-9０-９零〇一二两三四五六七八九十百千]+)\s*话/u.exec(sheet)?.[0]||sheet)||null;
 if(!currentEpisode){const selected=(workbook||[]).find(w=>w.name===sheet),rows=selected?.table||selected?.rows||[];for(let i=0;i<Math.min(15,rows.length);i++){const cols=rows[i].map(v=>String(v??'').trim()),index=cols.findIndex(c=>['话','话数','episode'].includes(c));if(index<0||!cols.some(c=>['画面内容','画面描述','description'].includes(c)))continue;const numbers=new Set(rows.slice(i+1).map(row=>episodeNumber(row[index])).filter(Boolean));if(numbers.size===1)currentEpisode=[...numbers][0];break;}currentEpisode||=episodeNumber(/第\s*([0-9０-９零〇一二两三四五六七八九十百千]+)\s*话/u.exec(fileName)?.[0]);}
 return {version:1,sourceKey:fileKey,workTitle:workTitle||fileName.replace(/\.[^.]+$/u,'').replace(/[_\s]*(分镜|分话细纲|分集细纲|改编方案).*$/u,'').slice(0,180)||null,episodes,...(currentEpisode?{currentEpisode}:{})};
}
export function createEpisodeBoardSharing(store){
 store.db.episodeBoardTemplates||={};
 const scope=project=>project.episodeBoards?.sharedKey||((project.episodeOutline?.sourceKey||project.importReview?.fileKey)?'source:'+(project.episodeOutline?.sourceKey||project.importReview.fileKey):project.id);
 function view(project){const result=copy(project),key=scope(project),record=store.db.episodeBoardTemplates[key];const state=ensureEpisodeBoards(result);state.sharedKey=key;if(record){state.templates=copy(record.templates);state.templateRevision=record.revision;}if(!state.currentEpisode&&result.episodeOutline?.currentEpisode)state.currentEpisode=result.episodeOutline.currentEpisode;return result;}
 function inherit(project,parent=null){if(parent?.episodeBoards){project.episodeBoards=copy(parent.episodeBoards);project.episodeBoards.episodes=copy(project.episodeBoards.episodes||{});}const hydrated=view(project);project.episodeBoards=hydrated.episodeBoards;return project;}
 function accept(old,next,{rebindSource=false}={}){
  if(!next.episodeBoards)next.episodeBoards=view(old).episodeBoards;validateEpisodeBoards(next);
  const key=rebindSource&&next.episodeOutline?.sourceKey?'source:'+next.episodeOutline.sourceKey:scope(old),record=store.db.episodeBoardTemplates[key];
  if(rebindSource&&key!==scope(old)){if(record)next.episodeBoards.templates=copy(record.templates);next.episodeBoards.templateRevision=record?.revision||0;}
  if(record&&next.episodeBoards.templateRevision!==record.revision)throw Object.assign(new Error('共用封面 / 尾图模板已在其他话修改，请重新载入'),{status:409,code:'episode_board_revision_conflict'});
  const previous=record?.templates||old.episodeBoards?.templates||defaultBoardTemplates(),changed=JSON.stringify(next.episodeBoards.templates)!==JSON.stringify(previous);
  next.episodeBoards.sharedKey=key;
  if(changed||!record){const revision=(record?.revision||0)+(changed?1:0);store.db.episodeBoardTemplates[key]={revision,templates:copy(next.episodeBoards.templates)};for(const sibling of store.db.projects){if(sibling.id===old.id||scope(sibling)!==key)continue;const state=ensureEpisodeBoards(sibling);state.sharedKey=key;state.templates=copy(next.episodeBoards.templates);state.templateRevision=revision;sibling.revision++;sibling.updated=new Date().toISOString();}}
  const current=store.db.episodeBoardTemplates[key];next.episodeBoards.templates=copy(current.templates);next.episodeBoards.templateRevision=current.revision;return next;
 }
 return {view,inherit,accept};
}
