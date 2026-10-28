import fs from 'node:fs';
import path from 'node:path';
import {recordLayoutAdjustment} from '../public/layout-history.js';
import {ensureProjectPanelGeneration} from '../public/panel-generation.js';

/** A durable backup and one revision of the existing project; no new project entry. */
export function commitLayoutCanvas({store,dataDir,original,next,validateProject,checkAssets,saveProject,receipt}){
 if(store.project(original.id)!==original||next.id!==original.id)throw Object.assign(Error('原画布已变化，请重新读取预览'),{status:409});
 next.title=original.title;next.created=original.created;next.layoutCanvasReturn=receipt;
 ensureProjectPanelGeneration(next,store.db.assets);
 recordLayoutAdjustment(structuredClone(original),next,{source:'automatic',operation:'layout.return-to-original-canvas'});
 validateProject(next);checkAssets(next);
 const backup=path.join(dataDir,'backups',original.id+'_before_canvas_layout_'+original.revision+'.json');
 fs.mkdirSync(path.dirname(backup),{recursive:true});if(!fs.existsSync(backup))fs.writeFileSync(backup,JSON.stringify(original),{flag:'wx'});
 const index=store.db.projects.indexOf(original);store.db.projects[index]=next;
 try{
  if(saveProject){const saved=saveProject(next,{editor:true});if(store.lastSaveError)throw Error(store.lastSaveError);return saved;}
  next.revision=original.revision+1;next.updated=new Date().toISOString();store.markProject?.(next);store.save();
  if(store.lastSaveError)throw Error(store.lastSaveError);return next;
 }catch(error){store.db.projects[index]=original;store.markProject?.(original);store.save();throw error;}
}
