import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';
import {writeFileAtomicSync} from './durable-files.mjs';
const check=(ok,message,status=409)=>{if(!ok)throw Object.assign(Error(message),{status});};
const valid=id=>/^project_[0-9a-f-]{36}$/u.test(id);
const folders=new Set(['projects','backups','original-uploads','project-center-cache','auto-layout-planning','production-sources','novel-sources','jobs','panel-slices','local-regions','repair','library-cache','assets','thumbnails','local-tools','teamwork']);
const inside=(root,file)=>{const relative=path.relative(root,path.resolve(file));return relative!==''&&!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative);};
const key=file=>path.resolve(file).toLowerCase();
function strings(value,into=new Set()){if(typeof value==='string')into.add(value);else if(Array.isArray(value))for(const v of value)strings(v,into);else if(value&&typeof value==='object')for(const v of Object.values(value))strings(v,into);return into;}
function safe(root,file){check(inside(root,file),'清理路径超出本机工程数据目录');const relative=path.relative(root,file);check(folders.has(relative.split(path.sep)[0])||/^studio\.json\.(?:bak|v1-backup)$/u.test(relative),'此位置不属于可清理的工程文件');const stat=fs.lstatSync(file);check(!stat.isSymbolicLink(),'清理位置包含目录链接，请先移走链接后重试');check(inside(root,fs.realpathSync(file)),'清理路径指向工程数据目录之外');return stat;}
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const journalPath=(root,id)=>path.join(root,'project-purges',id+'.json');
export function readPendingPurges(root){const result=new Map(),folder=path.join(root,'project-purges');if(!fs.existsSync(folder))return result;for(const name of fs.readdirSync(folder)){if(!/^project_[0-9a-f-]{36}\.json$/u.test(name))continue;const record=read(path.join(folder,name));check(valid(record.id)&&record.id+'.json'===name&&Array.isArray(record.files)&&Array.isArray(record.directories)&&Array.isArray(record.assetIds)&&Array.isArray(record.jobIds),'彻底删除进度文件无效');result.set(record.id,record);}return result;}
export function filterPurgedIndex(index,records){
 const ids=new Set(records.keys()),assets=new Set([...records.values()].flatMap(r=>r.assetIds)),jobs=new Set([...records.values()].flatMap(r=>r.jobIds));
 return {...index,...(index.projectOrder?{projectOrder:index.projectOrder.filter(id=>!ids.has(id))}:{}),...(index.projects?{projects:index.projects.filter(p=>!ids.has(p.id))}:{}),assets:(index.assets||[]).filter(a=>!assets.has(a.id)),jobs:(index.jobs||[]).filter(j=>!jobs.has(j.id)&&!ids.has(j.projectId))};
}
function sanitizeBackups(root,record){
 for(const name of ['studio.json.bak','studio.json.v1-backup']){const file=path.join(root,name);if(!fs.existsSync(file))continue;safe(root,file);const data=filterPurgedIndex(read(file),new Map([[record.id,record]]));writeFileAtomicSync(file,JSON.stringify(data));}
}
function forgetMetadata(root,id){
 for(const [name,field]of [['project-sync.local.json','projects'],['teamwork/local.json','links'],['project-center-sync.local.json',null]]){const file=path.join(root,name);if(!fs.existsSync(file))continue;const data=read(file),map=field?data[field]:data;if(!map||typeof map!=='object')continue;for(const key of Object.keys(map))if(key===id||key.startsWith('reference-generation:'+id+':'))delete map[key];writeFileAtomicSync(file,JSON.stringify(data));}
 for(const name of ['repair/hd-image-history.json','panel-image-imports/history.json']){const file=path.join(root,name);if(!fs.existsSync(file))continue;const data=read(file);if(Array.isArray(data))writeFileAtomicSync(file,JSON.stringify(data.filter(row=>row.projectId!==id)));}
}
// The small intent file contains paths/IDs only. It makes interrupted deletion
// resumable without archiving a recoverable copy of the deleted project.
export function finishPendingPurge(store,record){
 const root=path.resolve(store.root);sanitizeBackups(root,record);forgetMetadata(root,record.id);
 const retained=strings(store.db.projects),protectedPaths=new Set((store.db.assets||[]).map(a=>a.filePath&&key(a.filePath)).filter(Boolean));for(const value of retained)if(path.isAbsolute(value))protectedPaths.add(key(value));
 for(const relative of record.files){check(typeof relative==='string'&&!path.isAbsolute(relative),'清理文件列表无效');const file=path.resolve(root,relative);check(inside(root,file),'清理路径超出数据目录');const parts=relative.split(path.sep);if(protectedPaths.has(key(file))||parts[0]==='production-sources'&&retained.has(parts[1]))continue;if(!fs.existsSync(file))continue;const stat=safe(root,file);check(stat.isFile(),'清理对象不是普通文件');fs.unlinkSync(file);}
 for(const relative of [...record.directories].sort((a,b)=>b.length-a.length)){const file=path.resolve(root,relative);check(inside(root,file),'清理目录超出数据目录');if(!fs.existsSync(file))continue;const stat=safe(root,file);if(stat.isDirectory()&&!fs.readdirSync(file).length)fs.rmdirSync(file);}
 fs.unlinkSync(journalPath(root,record.id));store.pendingPurges.delete(record.id);return {id:record.id,removedFiles:record.files.length,removedBytes:record.bytes,removedAssets:record.assetIds.length,sharedAssets:record.sharedAssets};
}
export async function planProjectPurge(store,id){
 check(valid(id),'项目编号无效',400);if(store.pendingPurges.has(id))return store.pendingPurges.get(id);
 const project=store.db.projects.find(p=>p.id===id);check(project?.deletedAt,'只能彻底删除“已删除项目”中的项目',404);
 const root=path.resolve(store.root),targetJobs=store.db.jobs.filter(j=>j.projectId===id),owned=strings([project,targetJobs]),others=strings([store.db.projects.filter(p=>p.id!==id),store.db.jobs.filter(j=>j.projectId!==id),store.db.layouts]);
 // Existing backups of other projects may still use an image. Preserve those too.
 const scanBackup=async folder=>{if(!fs.existsSync(folder))return;for(const entry of await fs.promises.readdir(folder,{withFileTypes:true})){const file=path.join(folder,entry.name);if(entry.isSymbolicLink())continue;if(entry.isDirectory()){await scanBackup(file);continue;}if(!/\.json(?:\.bak)?$/u.test(entry.name)||entry.name.startsWith(id))continue;const text=await fs.promises.readFile(file,'utf8');for(const match of text.matchAll(/(?:asset_[0-9a-f-]{36}|\b[a-f0-9]{64}\b)/gu))others.add(match[0]);}};
 await scanBackup(path.join(root,'backups'));await scanBackup(path.join(root,'projects','removed'));
 const candidates=(store.db.assets||[]).filter(a=>owned.has(a.id)&&!others.has(a.id)),candidateIds=new Set(candidates.map(a=>a.id)),protectedFiles=new Set((store.db.assets||[]).filter(a=>!candidateIds.has(a.id)).map(a=>a.filePath&&key(a.filePath)).filter(Boolean));
 for(const value of others)if(path.isAbsolute(value))protectedFiles.add(key(value));
 const files=new Map(),directories=new Set();let bytes=0;
 async function add(file){if(!fs.existsSync(file))return;const stat=safe(root,file);if(stat.isDirectory()){directories.add(path.relative(root,file));for(const name of await fs.promises.readdir(file))await add(path.join(file,name));}else if(stat.isFile()&&!protectedFiles.has(key(file))){files.set(path.relative(root,file),{size:stat.size,mtime:stat.mtimeMs});}}
 const removeIds=[];let sharedAssets=(store.db.assets||[]).filter(a=>owned.has(a.id)&&others.has(a.id)).length;
 for(const asset of candidates){const file=asset.filePath||path.join(root,'assets',asset.id+asset.extension);if(!inside(root,file)||!folders.has(path.relative(root,file).split(path.sep)[0])||protectedFiles.has(key(file))){sharedAssets++;continue;}await add(file);removeIds.push(asset.id);}
 await add(path.join(root,'projects',id+'.json'));await add(path.join(root,'projects',id+'.json.bak'));
 for(const folder of ['original-uploads','project-center-cache','auto-layout-planning','novel-sources'])await add(path.join(root,folder,id));
 for(const hash of owned)if(/^[a-f0-9]{64}$/u.test(hash)&&!others.has(hash))await add(path.join(root,'production-sources',hash));
 async function byName(folder){if(!fs.existsSync(folder))return;for(const entry of await fs.promises.readdir(folder,{withFileTypes:true})){const file=path.join(folder,entry.name);if(entry.name.startsWith(id)&&(entry.name===id||/[._-]/u.test(entry.name[id.length]||''))){await add(file);continue;}if(entry.isDirectory()&&!entry.isSymbolicLink())await byName(file);}}
 await byName(path.join(root,'backups'));await byName(path.join(root,'projects','removed'));
 await byName(path.join(root,'teamwork'));
 for(const job of targetJobs)if(/^job_[0-9a-f-]{36}$/u.test(job.id))await add(path.join(root,'jobs',job.id));
 // Generated session directories declare ownership in their small manifests.
 const repairSources=new Set(),sharedRepairSources=new Set();
 for(const [folder,manifest]of [['panel-slices','manifest.json'],['local-regions','session.json'],['repair/sessions',null]]){const base=path.join(root,folder);if(!fs.existsSync(base))continue;for(const entry of await fs.promises.readdir(base,{withFileTypes:true})){if(entry.isSymbolicLink())continue;const location=path.join(base,entry.name),file=manifest?path.join(location,manifest):location;if(!fs.existsSync(file)||!fs.statSync(file).isFile()||!file.endsWith('.json'))continue;const data=read(file);if(data.projectId===id){await add(manifest?location:file);if(folder==='repair/sessions')repairSources.add(data.sourceId);}else if(folder==='repair/sessions')sharedRepairSources.add(data.sourceId);}}
 for(const source of repairSources){if(!/^[a-f0-9]{32}$/u.test(source)||sharedRepairSources.has(source))continue;
  const sourceDir=path.join(root,'repair','sources',source);for(const recordFile of ['export-files.json','project-files.json']){const file=path.join(sourceDir,recordFile);if(fs.existsSync(file)){const names=read(file);if(Array.isArray(names))for(const name of names)if(typeof name==='string'&&path.basename(name)===name)await add(path.join(root,'repair','exports',name));}}
  for(const folder of ['sources','project-assets','project-fonts'])await add(path.join(root,'repair',folder,source));
  const archives=path.join(root,'repair','保存与归档');if(fs.existsSync(archives))for(const name of await fs.promises.readdir(archives)){const file=path.join(archives,name,'原始漫画','原图信息.json');if(fs.existsSync(file)&&read(file).id===source)await add(path.join(archives,name));}
  const jobs=path.join(root,'repair','jobs');if(fs.existsSync(jobs))for(const name of await fs.promises.readdir(jobs)){const request=path.join(jobs,name,'request.json');if(fs.existsSync(request)&&read(request).sourceId===source)await add(path.join(jobs,name));}
 }
 for(const f of files.values())bytes+=f.size;
 return {version:1,id,title:project.title,revision:project.revision,deletedAt:project.deletedAt,pageCount:project.pages.length,shotCount:project.shots.length,files:[...files.keys()],directories:[...directories],assetIds:removeIds,jobIds:targetJobs.map(j=>j.id),bytes,sharedAssets,token:createHash('sha256').update(JSON.stringify([...files])).digest('hex')};
}
export function executeProjectPurge(store,record){
 const root=path.resolve(store.root),file=journalPath(root,record.id);fs.mkdirSync(path.dirname(file),{recursive:true});writeFileAtomicSync(file,JSON.stringify(record));store.pendingPurges.set(record.id,record);
 store.db={...store.db,...filterPurgedIndex(store.db,new Map([[record.id,record]]))};store.meta.delete(record.id);store.dirty.delete(record.id);store.save();check(!store.lastSaveError,'项目清理尚未完成，磁盘写入失败，请重试',500);return finishPendingPurge(store,record);
}
export const purgeSummary=record=>({id:record.id,title:record.title,revision:record.revision,deletedAt:record.deletedAt,pageCount:record.pageCount,shotCount:record.shotCount,purgePending:true,files:record.files.length,bytes:record.bytes,sharedAssets:record.sharedAssets,token:record.token});
