import fs from 'node:fs';
import path from 'node:path';
export function createPanelImageImports({store,dataDir}){
 const file=path.join(dataDir,'panel-image-imports','history.json');let history=[];
 if(fs.existsSync(file)){history=JSON.parse(fs.readFileSync(file,'utf8'));if(!Array.isArray(history))throw Error('本地换图记录格式无效');}
 function record(project,frame,asset){const next=[...history,{projectId:project.id,panelId:frame.id,from:frame.imageAssetId||null,to:asset.id,at:new Date().toISOString()}].slice(-2000);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file+'.tmp',JSON.stringify(next));fs.renameSync(file+'.tmp',file);history=next;}
 function restorableImages(old,next){
  const result=new Set(),prior=new Map(old.pages.flatMap(page=>page.panels.map(frame=>[frame.id,{page,frame}])));
  for(const page of next.pages)for(const frame of page.panels){
   const source=prior.get(frame.id),current=source?.frame;if(!current||current.imageAssetId===frame.imageAssetId||current.locked||source.page.locked||current.cutoutLayer||frame.cutoutLayer||current.breakoutForeground||frame.breakoutForeground)continue;
   if(store.db.jobs.some(j=>j.projectId===old.id&&j.panelId===frame.id&&['queued','preparing','running','recoverable','awaiting_confirmation','delegated'].includes(j.status)))continue;
   const edges=history.filter(h=>h.projectId===old.id&&h.panelId===frame.id),connected=new Set([current.imageAssetId||null]);let changed=true;
   while(changed){changed=false;for(const edge of edges)if(connected.has(edge.from)||connected.has(edge.to))for(const value of [edge.from,edge.to])if(!connected.has(value)){connected.add(value);changed=true;}}
   if(connected.has(frame.imageAssetId||null)&&(!frame.imageAssetId||store.db.assets.some(a=>a.id===frame.imageAssetId)))result.add(frame.id);
  }return result;
 }
 return {record,restorableImages};
}
