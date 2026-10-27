const copy=v=>v===undefined?undefined:structuredClone(v);
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const forbidden=new Set(['__proto__','prototype','constructor']);
export const TEAM_STAGES={todo:'待制作',doing:'制作中',ready:'待审核',changes:'待修改',approved:'审核通过'};
export const ISSUE_STAGES={open:'待修改',fixed:'已修改，待复核',verified:'已复核通过'};
export function teamProjectBody(project){
 const p=copy(project);for(const key of ['revision','updated','layoutHistory','layoutImports','designHistory','storyboardWorkflow','novelProductionWorkflow','productionAssets'])delete p[key];
 if(p.episodeBoards){delete p.episodeBoards.templateRevision;delete p.episodeBoards.sharedKey;}
 // Local folder discovery is not part of the shared image identity.
 if(p.assetLibrary)p.assetLibrary.directories=[];
 return p;
}
/** Three-way merge: independent object/field edits combine; competing edits are never overwritten. */
export function mergeTeamProjects(base,local,remote,{choices={}}={}){
 const conflicts=[];
 function merge(b,l,r,path){
  if(equal(l,r))return copy(l);if(equal(l,b))return copy(r);if(equal(r,b))return copy(l);
  if(plain(l)&&plain(r)&&(plain(b)||b===undefined)){
   const unit=/^\/teamwork\/units\/[^/]+$/.test(path),eventKeys=unit?['lastEditor','editedAt','updatedBy','updatedAt']:[];
   const value={};for(const key of new Set([...Object.keys(b||{}),...Object.keys(l),...Object.keys(r)])){if(forbidden.has(key)){conflicts.push(path+'/'+key);continue;}if(eventKeys.includes(key))continue;const next=merge(b?.[key],l[key],r[key],path+'/'+key);if(next!==undefined)value[key]=next;}
   if(unit){for(const [time,author]of [['editedAt','lastEditor'],['updatedAt','updatedBy']]){const source=String(l[time]||'')>String(r[time]||'')?l:r;if(source[time]){value[time]=source[time];value[author]=source[author];}}}return value;
  }
  if(Array.isArray(l)&&Array.isArray(r)&&(Array.isArray(b)||b===undefined)){
   b||=[];const all=[...b,...l,...r],identity=['id','assetId'].find(key=>all.length&&all.every(v=>plain(v)&&typeof v[key]==='string')&&[b,l,r].every(a=>new Set(a.map(v=>v[key])).size===a.length));
   if(identity){
    const maps=[b,l,r].map(a=>new Map(a.map(v=>[v[identity],v]))),order=a=>a.map(v=>v[identity]),bo=order(b),lo=order(l),ro=order(r);
    // Concurrent insertions retain both IDs. Reordering existing IDs in two ways is a conflict.
    const oldOrder=a=>a.filter(id=>maps[0].has(id));let ids;
    if(equal(oldOrder(lo),oldOrder(bo)))ids=[...ro,...lo.filter(id=>!ro.includes(id))];
    else if(equal(oldOrder(ro),oldOrder(bo))||equal(oldOrder(lo),oldOrder(ro)))ids=[...lo,...ro.filter(id=>!lo.includes(id))];
    else{const selected=choices[path+'/顺序'];if(selected==='local')ids=[...lo,...ro.filter(id=>!lo.includes(id))];else{if(selected!=='remote')conflicts.push(path+'/顺序');ids=[...ro,...lo.filter(id=>!ro.includes(id))];}}
    return ids.map(id=>merge(maps[0].get(id),maps[1].get(id),maps[2].get(id),path+'/'+id)).filter(v=>v!==undefined);
   }
   // Add-only identity/order lists can safely retain both additions.
   if(all.every(v=>typeof v==='string')&&b.every(v=>l.includes(v)&&r.includes(v))&&equal(l.filter(v=>b.includes(v)),b)&&equal(r.filter(v=>b.includes(v)),b))return [...new Set([...r,...l])];
  }
  const key=path||'/工程';if(choices[key]==='local')return copy(l);if(choices[key]==='remote')return copy(r);conflicts.push(key);return copy(l);
 }
 const project=merge(base,local,remote,'');return {project,conflicts};
}
export function teamConflictValue(project,path){let value=project;for(const key of path.split('/').filter(Boolean)){if(Array.isArray(value)){if(key==='顺序')return value.map(v=>v?.id||v?.assetId||v);value=value.find(v=>v?.id===key||v?.assetId===key);}else value=value?.[key];}return value;}
export function teamProgress(project){
 const team=project.teamwork||{},issues=team.issues||[];
 return project.pages.filter(p=>!p.fixedEpisodeBoard).map(page=>{
  const state=team.units?.[page.id]||{},panels=page.panels.filter(p=>p.visible!==false&&!p.productionBackground&&!p.productionBackgroundInstance&&!p.designDecoration&&!p.coordinatePlaceholder),unitIssues=issues.filter(i=>i.pageId===page.id);
  const episode=page.storyboard?.episode,imageCount=panels.filter(p=>p.imageAssetId).length,name=page.name||page.id;
  return {id:page.id,name:episode&&!name.startsWith('第'+episode+'话')?'第'+episode+'话 · '+name:name,width:page.width,height:page.height,stage:state.stage||(imageCount?'doing':'todo'),owner:state.owner||'',lastEditor:state.lastEditor||'',editedAt:state.editedAt||'',submittedAt:state.submittedAt||'',imageCount,total:panels.length,open:unitIssues.filter(i=>i.status!=='verified').length,issues:unitIssues.length};
 });
}
export function normalizedReviewRect(a,b){
 const x=Math.max(0,Math.min(1,Math.min(a.x,b.x))),y=Math.max(0,Math.min(1,Math.min(a.y,b.y))),right=Math.max(0,Math.min(1,Math.max(a.x,b.x))),bottom=Math.max(0,Math.min(1,Math.max(a.y,b.y)));
 return {x,y,w:right-x,h:bottom-y};
}
export function validReviewRect(r){return !!r&&['x','y','w','h'].every(k=>Number.isFinite(r[k]))&&r.x>=0&&r.y>=0&&r.w>0&&r.h>0&&r.x+r.w<=1.000001&&r.y+r.h<=1.000001;}
