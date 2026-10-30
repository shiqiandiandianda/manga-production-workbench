import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {writeFileAtomicSync} from './durable-files.mjs';
import {portableProject,projectAssetIds} from './project-portability.mjs';
import {compactProjectFile} from './compact-project-file.mjs';
import {uploadVerifiedBackup,bytesHash,backupEntryBytes} from './maintenance-backup.mjs';
import {collectCode} from '../../distribution/code-policy.mjs';
import {sourceOriginalPath} from './source-originals.mjs';
export const STORAGE_POLICY=Object.freeze({projectBytes:200*1024*1024,projectTargetBytes:150*1024*1024,completedTargetBytes:20*1024*1024,totalBytes:2*1024*1024*1024,totalTargetBytes:1024*1024*1024,intervalMs:300000,batchFiles:20,batchBytes:50*1024*1024,batchDelayMs:30000});
const activeStates=new Set(['queued','preparing','running','recoverable','delegated','awaiting_confirmation']);
const safeName=name=>!/(?:^|\/)(?:\.git|\.codex|runtime-data|node-data|data)(?:\/|$)/i.test(name)&&!/(?:^|\/)(?:\.env(?:\..*)?|moku\.json|auth\.json|tokens\.json|settings\.json|[^/]*\.local\.[^/]+|[^/]*session[^/]*|[^/]*secret[^/]*|[^/]*private[^/]*|[^/]*\.(?:psd|pem|pfx|key))$/i.test(name);
const inside=(root,file)=>{const rel=path.relative(path.resolve(root),path.resolve(file));return !!rel&&!rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel);};
export function safeMaintenanceFile(root,file){
 if(!inside(root,file))throw Error('清理路径超出允许的目录');
 let at=path.resolve(root);if(fs.lstatSync(at).isSymbolicLink())throw Error('清理根目录不能是链接');
 for(const part of path.relative(at,path.resolve(file)).split(path.sep)){at=path.join(at,part);if(fs.lstatSync(at).isSymbolicLink())throw Error('清理路径包含目录链接');}
 if(!inside(root,fs.realpathSync(file)))throw Error('清理路径指向允许目录之外');return fs.statSync(file);
}
async function hashFile(file){const h=createHash('sha256');for await(const b of fs.createReadStream(file))h.update(b);return h.digest('hex');}
async function walk(root){const rows=[];if(!fs.existsSync(root))return rows;
 async function visit(dir){for(const e of await fs.promises.readdir(dir,{withFileTypes:true})){const file=path.join(dir,e.name);if(e.isSymbolicLink())continue;if(e.isDirectory())await visit(file);else if(e.isFile()){const s=await fs.promises.stat(file);rows.push({file,bytes:s.size,mtime:s.mtimeMs,ctime:s.ctimeMs,identity:s.dev+':'+s.ino});}}}await visit(root);return rows;
}
function strings(v,set=new Set()){if(typeof v==='string')set.add(v);else if(v&&typeof v==='object')for(const x of Object.values(v))strings(x,set);return set;}
export function createStorageMaintenance({dataDir,codeRoot,store,library,projectSync,projectCenter,busy=()=>false,clock=Date.now,policy={},startTimer=true}){
 const root=path.resolve(dataDir),code=path.resolve(codeRoot),file=path.join(root,'storage-maintenance.local.json');
 let state={version:1,enabled:true,projects:{},assetProofs:{},archiveObjects:{},history:[]};if(fs.existsSync(file))state={...state,...JSON.parse(fs.readFileSync(file,'utf8'))};
 const limits={...STORAGE_POLICY,...policy},leases=new Map();let closed=false,run=null,scanning=null,lastScan=null,timer=null,continuation=null;
 const persist=()=>writeFileAtomicSync(file,JSON.stringify(state));
 const currentProjects=()=>store.db.projects.filter(p=>!p.deletedAt&&!p.internalAssetWorkspace);
 let legacyActivity={},legacyActivityAt=0;
 function activeProject(id){if(clock()-legacyActivityAt>2000){legacyActivityAt=clock();try{legacyActivity=JSON.parse(fs.readFileSync(path.join(root,'teamwork','activity.local.json'),'utf8'));}catch{legacyActivity={};}}
  return legacyActivity.projectId===id&&clock()-(legacyActivity.seenAt||0)<90000||[...leases.values()].some(l=>l.projectId===id&&clock()-l.at<90000)||store.db.jobs.some(j=>j.projectId===id&&activeStates.has(j.status));}
 function activeDirty(id){return [...leases.values()].some(l=>l.projectId===id&&l.dirty&&clock()-l.at<90000);}
 function touch({clientId,projectId,dirty=false}){if(typeof clientId!=='string'||clientId.length>100)throw Error('编辑会话编号无效');if(projectId&&!currentProjects().some(p=>p.id===projectId))throw Error('工程不存在');leases.set(clientId,{projectId,dirty:!!dirty,at:clock()});}
 let protectionStamp='',protectionCache=new Set();
 function protectedFiles(){const stamp=JSON.stringify([store.db.projects.map(p=>[p.id,p.revision,p.updated]),store.db.assets.map(a=>[a.id,a.filePath,a.originalFilePath]),store.db.jobs.map(j=>[j.id,j.status,j.updated])]);if(stamp===protectionStamp)return protectionCache;
  const out=new Set();for(const a of store.db.assets)for(const key of ['filePath','originalFilePath'])if(a[key])out.add(path.resolve(a[key]).toLowerCase());
  for(const s of strings([store.db.projects,store.db.jobs,store.db.layouts]))if(path.isAbsolute(s))out.add(path.resolve(s).toLowerCase());protectionStamp=stamp;protectionCache=out;return out;}
 const legacyRoots=()=>[path.join(code,'quality-runs'),path.join(code,'verification'),path.join(code,'audit','cache-tests')];
 async function scan(){
  if(scanning)return scanning;scanning=(async()=>{
   const files=await walk(root),seen=new Set();let bytes=0;for(const row of files)if(!seen.has(row.identity)){seen.add(row.identity);bytes+=row.bytes;}
   const protectedPaths=protectedFiles(),owners=new Map(),projectRows=[];
   for(const p of currentProjects()){const ids=projectAssetIds(p),paths=new Set(),info=state.projects[p.id]||{};for(const id of ids){const a=store.db.assets.find(a=>a.id===id);if(a?.filePath){paths.add(path.resolve(a.filePath).toLowerCase());const list=owners.get(a.filePath)||[];list.push(p.id);owners.set(a.filePath,list);}}
    const projectFiles=files.filter(r=>paths.has(path.resolve(r.file).toLowerCase())||r.file===path.join(root,'projects',p.id+'.json')||r.file.startsWith(path.join(root,'project-center-cache',p.id)+path.sep));
    projectRows.push({id:p.id,title:p.title,revision:p.revision,bytes:projectFiles.reduce((n,r)=>n+r.bytes,0),limit:limits.projectBytes,target:info.completed?limits.completedTargetBytes:limits.projectTargetBytes,completed:!!info.completed,active:activeProject(p.id),backup:info.backup?{verifiedAt:info.backup.verifiedAt,revision:info.backupRevision,assetId:info.backup.assetId,revisionId:info.backup.revisionId}:null,missingFixedImages:[...ids].filter(id=>!store.db.assets.find(a=>a.id===id)?.library?.revisionId).length});
   }
   const candidates=[];for(const row of files){const rel=path.relative(root,row.file).replaceAll('\\','/');if(protectedPaths.has(path.resolve(row.file).toLowerCase()))continue;
    if((/^(?:thumbnails|image-decode-cache|frame-upscale-cache)\//.test(rel)&&clock()-row.mtime>86400000)||(/^exports\//.test(rel)&&clock()-row.mtime>86400000))candidates.push({...row,root,kind:rel.startsWith('exports/')?'export':'regenerable',relative:rel});
   }
   const legacy=[];for(const folder of legacyRoots())for(const row of await walk(folder)){const rel=path.relative(code,row.file).replaceAll('\\','/');if(safeName(rel)&&!protectedPaths.has(path.resolve(row.file).toLowerCase()))legacy.push({...row,root:code,relative:rel,kind:'development'});}
   let centerBytes=0;try{const d=await projectCenter?.storageStatus?.();centerBytes=d?.bytes||0;}catch{}
   lastScan={at:new Date(clock()).toISOString(),bytes:bytes+centerBytes,comicBytes:bytes,centerBytes,developmentBytes:legacy.reduce((n,r)=>n+r.bytes,0),reclaimableBytes:candidates.reduce((n,r)=>n+r.bytes,0)+legacy.reduce((n,r)=>n+r.bytes,0),files:files.length,projects:projectRows,candidates,legacy,owners};return lastScan;
  })();try{return await scanning;}finally{scanning=null;}
 }
 function view(){const s=lastScan;return {version:1,enabled:state.enabled,policy:limits,usage:s?Object.fromEntries(['at','bytes','comicBytes','centerBytes','developmentBytes','reclaimableBytes','files','projects'].map(k=>[k,s[k]])):null,run:run?structuredClone(run):null,history:state.history.slice(-10)};}
 async function targetFor(project){
  let id=projectSync?.status(project.id).target?.projectId||project.assetLibrary?.mokuProjectId||project.mokuProjectId;
  if(!id){const ids=new Set([...projectAssetIds(project)].map(id=>store.db.assets.find(a=>a.id===id)?.library?.projectId).filter(Boolean));if(ids.size===1)id=[...ids][0];}
  const projects=(await library.read('/api/projects')).items||[];
  if(id){if(!projects.some(p=>p.id===id))throw Error('工程对应的墨库项目不可访问');return id;}
  const matches=projects.filter(p=>project.title.includes(p.name));if(matches.length===1)return matches[0].id;
  throw Error('请先为“'+project.title+'”选择墨库项目；未备份文件保持原位');
 }
 async function backupProject(id,{completed=false}={}){
  if(busy()||store.db.jobs.some(j=>j.projectId===id&&activeStates.has(j.status)))throw Error('工程正在处理任务，稍后再备份');
  if(activeDirty(id))throw Error('工程还有未保存编辑，请先完成保存');
  const project=store.db.projects.find(p=>p.id===id&&!p.deletedAt);if(!project)throw Error('工程不存在');
  const revision=project.revision,target=await targetFor(project),entry=state.projects[id]||={};
  if(entry.backupRevision===revision&&entry.backup&&entry.backupFormatVersion>=2){if(completed)entry.completed=true;persist();return entry.backup;}
  let pack;try{pack=await library.packProject(portableProject(project),target);if(!pack)throw Error('墨库不支持完整工程归档');
   for(const resource of [...pack.assets||[],...pack.fonts||[],...pack.originals||[]]){const ref=resource.library||resource;if(!ref.assetId||!ref.revisionId)continue;library.rememberClassifiedAsset?.({...ref,id:ref.assetId,recommendedRevisionId:ref.revisionId});const revision=await library.read('/api/assets/'+ref.assetId+'/revisions/'+ref.revisionId);if(revision.sha256!==ref.sha256&&ref.sha256)throw Error('固定原件版本摘要不符');}
  }catch(error){pack=await archiveProjectOriginals(project,target,error.message);}
  if(project.revision!==revision)throw Error('打包期间工程已有修改，请重新备份');
  const native={...pack,exportedAt:project.updated||project.created||null,format:'comic-strip-studio',version:3,imageStorage:'moku',moku:{projectId:target}};
  const compact=compactProjectFile(native),receipt=await uploadVerifiedBackup({library,dataDir:root,projectId:target,name:project.title.slice(0,100)+'_本机清理备份_r'+revision+'.zip',entries:[{name:'工程.json',data:JSON.stringify(compact)},{name:'备份说明.json',data:JSON.stringify({projectId:id,revision,project:project.title,created:new Date(clock()).toISOString(),imageCount:pack.assets.length,format:'comic-maintenance-backup-v1'})}]});
  if(project.revision!==revision)throw Error('上传期间工程已有修改，备份已保留但本机原件未清理');
  for(const item of pack.assets){const a=store.db.assets.find(a=>a.id===item.id);if(a&&item.archive)a.storageBackupRef=item.archive;if(a&&item.library?.sha256)state.assetProofs[a.id]={reference:{...item.library},backupRevisionId:receipt.revisionId};}
  for(const item of pack.fonts||[]){const f=store.db.libraryFonts?.find(f=>f.key===item.key);if(f&&item.archive){f.provenance||={};f.provenance.archiveRef=item.archive;}}
  if(!store.save())throw Error('备份恢复信息尚未写盘，原件保留');
  Object.assign(entry,{backup:receipt,backupRevision:revision,backupFormatVersion:2,targetProjectId:target,completed:completed||entry.completed||false,lastUsed:new Date(clock()).toISOString()});persist();return receipt;
 }
 async function verifyAsset(asset){
  if(asset.storageBackupRef){const ref=asset.storageBackupRef;if(!verifiedReceipt(ref,ref.fileSha256))return false;return await hashFile(store.assetPath(asset.id))===ref.fileSha256;}
  const proof=state.assetProofs[asset.id],ref=asset.library;if(!proof||proof.reference.revisionId!==ref?.revisionId||proof.reference.sha256!==ref.sha256)return false;
  const file=store.assetPath(asset.id),s=safeMaintenanceFile(root,file),stamp=[s.dev,s.ino,s.size,s.mtimeMs,s.ctimeMs].join('|');
  if(proof.localStamp===stamp&&proof.remoteVerifiedAt)return true;
  if(await hashFile(file)!==ref.sha256)return false;
  library.rememberClassifiedAsset?.({...ref,id:ref.assetId,recommendedRevisionId:ref.revisionId});
  const response=await library.remote('/api/revisions/'+ref.revisionId+'/download'),h=createHash('sha256');let size=0;
  for await(const b of response.body){size+=b.length;if(size>s.size)throw Error('墨库图片回读大小不符');h.update(b);}
  library.assertSession?.();if(size!==s.size||h.digest('hex')!==ref.sha256)throw Error('墨库图片回读摘要不符');
  Object.assign(proof,{localStamp:stamp,remoteVerifiedAt:new Date(clock()).toISOString()});persist();return true;
 }
 async function evict(s,force=false){
  let count=0,bytes=0,total=s.bytes;const remaining=new Map(s.projects.map(p=>[p.id,p.bytes]));state.trimming||={};
  for(const p of s.projects)if(p.bytes>(state.projects[p.id]?.completed?limits.completedTargetBytes:limits.projectBytes))state.trimming[p.id]=state.projects[p.id]?.completed?limits.completedTargetBytes:limits.projectTargetBytes;
  if(total>limits.totalBytes)state.trimTotal=true;
  for(const [file,ownerIds] of s.owners){if(count>=limits.batchFiles||bytes>=limits.batchBytes)break;
   if(ownerIds.some(id=>activeProject(id)||state.projects[id]?.backupRevision!==store.db.projects.find(p=>p.id===id)?.revision))continue;
   const over=force||state.trimTotal&&total>limits.totalTargetBytes||ownerIds.some(id=>state.trimming[id]!==undefined&&(remaining.get(id)||0)>state.trimming[id]);if(!over)continue;
   if(!fs.existsSync(file)||!inside(root,file))continue;
   const assets=store.db.assets.filter(a=>a.filePath===file);if(!assets.length||assets.some(a=>!a.library?.revisionId&&!a.storageBackupRef))continue;
   for(const asset of assets)if(!await verifyAsset(asset))throw Error('图片还没有可验证的墨库备份：'+asset.name);
   if(busy()||ownerIds.some(activeProject))break;
   const stat=safeMaintenanceFile(root,file);if(bytes+stat.size>limits.batchBytes&&count)break;
   const digest=await hashFile(file);if(assets.some(a=>(a.storageBackupRef?.fileSha256||a.library.sha256)!==digest))continue;
   // Persist the recovery pointer before unlink. A crash leaves either a local
   // original or an explicit, fixed cloud revision, never an unknown missing file.
   for(const a of assets)a.storageEvicted={at:new Date(clock()).toISOString(),sha256:digest,...(a.storageBackupRef?{archiveRef:a.storageBackupRef}:{})};
   if(!store.save())throw Error('原件恢复记录未写盘，停止清理');
   if(ownerIds.some(activeProject)||busy())continue;
   fs.unlinkSync(file);count++;bytes+=stat.size;total-=stat.size;for(const id of ownerIds)remaining.set(id,Math.max(0,(remaining.get(id)||0)-stat.size));
  }for(const [id,target]of Object.entries(state.trimming))if((remaining.get(id)||0)<=target)delete state.trimming[id];if(total<=limits.totalTargetBytes)state.trimTotal=false;persist();return {files:count,bytes};
 }
 async function backupCandidates(rows,target){
  const objects=new Map(),manifest=[],receipts=[],batchId=run?.id||randomUUID();
  for(const row of rows){if(busy())throw Error('有新任务开始，清理已暂停');const stat=safeMaintenanceFile(row.root,row.file);if(stat.size!==row.bytes||stat.mtimeMs!==row.mtime||stat.ctimeMs!==row.ctime)continue;
   const sha256=await hashFile(row.file);manifest.push({...row,sha256});
   const known=state.archiveObjects[sha256];if(known&&verifiedReceipt(known,sha256)){if(!receipts.some(r=>r.revisionId===known.revisionId))receipts.push(JSON.parse(fs.readFileSync(path.join(root,'storage-maintenance','backups',known.sha256+'.receipt.json'),'utf8')));}
   else if(!objects.has(sha256))objects.set(sha256,row);}
  let entries=[],raw=0,index=0;const flush=async()=>{if(!entries.length)return;receipts.push(await uploadVerifiedBackup({library,dataDir:root,projectId:target,name:'工作台历史残留备份_'+batchId.slice(0,8)+'_'+(++index)+'.zip',entries}));entries=[];raw=0;};
  for(const [sha,row] of objects){if(raw+row.bytes>64*1024*1024)await flush();if(row.bytes>200*1024*1024)throw Error('历史残留单文件超过200MB，已保留：'+row.relative);entries.push({name:'objects/'+sha,data:await fs.promises.readFile(row.file)});raw+=row.bytes;}
  await flush();receipts.push(await uploadVerifiedBackup({library,dataDir:root,projectId:target,name:'工作台清理恢复清单_'+batchId.slice(0,8)+'.zip',entries:[{name:'manifest.json',data:JSON.stringify({format:'comic-cleanup-archive-v1',files:manifest.map(({file,root,...r})=>r),archives:receipts.map(({entries,local,...r})=>r)})}]}));
  return {manifest,receipts};
 }
 async function archiveProjectOriginals(project,target,typedError){
  const rows=[],assets=[],fonts=[],originals=[],used=projectAssetIds(project),projectText=JSON.stringify(project);
  const add=async(file,meta)=>{if(!fs.existsSync(file))throw Error('本机原件缺失，尚未归档：'+meta.name);const s=fs.statSync(file);rows.push({file,root:path.dirname(file),relative:path.basename(file),bytes:s.size,mtime:s.mtimeMs,ctime:s.ctimeMs,...meta});};
  for(const id of used){const a=store.db.assets.find(a=>a.id===id);if(!a)throw Error('工程引用的原件未登记：'+id);if(a.storageEvicted)await library.ensureAsset(id);assets.push(a);await add(store.assetPath(id),{resourceKind:'image',localId:id,name:a.name});}
  for(const f of store.db.libraryFonts||[])if(projectText.includes(JSON.stringify(f.key))){fonts.push(f);await add(f.filePath,{resourceKind:'font',localId:f.key,name:f.name});}
  for(const f of project.sourceOriginalFiles||[]){originals.push(f);await add(sourceOriginalPath(root,project.id,f.hash),{resourceKind:'original',localId:f.hash,name:f.name});}
  const {manifest,receipts}=await backupCandidates(rows,target),refs=new Map();
  for(const receipt of receipts)for(const e of receipt.entries)if(e.name.startsWith('objects/')){const ref={projectId:target,assetId:receipt.assetId,revisionId:receipt.revisionId,sha256:receipt.sha256,size:receipt.size,entry:e.name,fileSha256:e.sha256,fileBytes:e.size,baseUrl:library.baseUrl};refs.set(e.sha256,ref);state.archiveObjects[e.sha256]=ref;}
  persist();run?.backups.push(...receipts.map(({entries,local,...r})=>r));const rowFor=(kind,id)=>manifest.find(r=>r.resourceKind===kind&&r.localId===id),refFor=(kind,id)=>refs.get(rowFor(kind,id)?.sha256);
  let packageSources=library.exportProjectSources?.(project),packageSourcesArchive;
  if(packageSources&&Buffer.byteLength(JSON.stringify(packageSources))>256*1024){const r=await uploadVerifiedBackup({library,dataDir:root,projectId:target,name:'制作资料备份.zip',entries:[{name:'package-sources.json',data:JSON.stringify(packageSources)}]});packageSourcesArchive={projectId:target,scopeId:'project',assetKind:'file',assetType:'project_archive',assetId:r.assetId,revisionId:r.revisionId,sha256:r.sha256,size:r.size};packageSources=undefined;}
  return {project:portableProject(project),assets:assets.map(a=>({id:a.id,name:a.name,width:a.width,height:a.height,mime:a.mime,sha256:rowFor('image',a.id).sha256,archive:refFor('image',a.id),...(a.library?.sha256===rowFor('image',a.id).sha256?{library:a.library}:a.library?{sourceLibrary:a.library}:{}),...Object.fromEntries(['libraryRole','libraryName','libraryState','libraryAliases','libraryStateAliases','productionStatus','productionAssetId','productionStageId','referenceGeneration','comicKind'].filter(k=>a[k]!==undefined).map(k=>[k,a[k]]))})),fonts:fonts.map(f=>({key:f.key,name:f.name,library:{...f.provenance,revisionId:f.revisionId},archive:refFor('font',f.key)})),originals:originals.map(f=>({...f,archive:refFor('original',f.hash)})),...(packageSources?{packageSources}:{}),...(packageSourcesArchive?{packageSourcesArchive}:{}),backupMode:'verified-original-archives',typedBackupUnavailable:typedError};
 }
 async function cleanRows(rows,{target,fast=false}={}){
  if(!rows.length)return;run.phase='backup';run.message='正在备份历史残留到墨库并回读校验';
  const {manifest,receipts}=await backupCandidates(rows,target);run.backups.push(...receipts.map(({entries,local,...r})=>r));persist();
  // No file is removed until every required archive and its restore manifest
  // have a verified fixed revision. The final pass guards concurrent changes.
  run.phase='cleaning';run.message='墨库备份已验证，正在分批清理历史残留';
  for(let i=0;i<manifest.length;i++){
   if(closed||busy())throw Error('有新任务开始，未处理文件保持原位');
   const r=manifest[i];if(protectedFiles().has(path.resolve(r.file).toLowerCase()))continue;
   if(!fs.existsSync(r.file))continue;const stat=safeMaintenanceFile(r.root,r.file);
   if(stat.size!==r.bytes||stat.mtimeMs!==r.mtime||stat.ctimeMs!==r.ctime||await hashFile(r.file)!==r.sha256)continue;
   fs.unlinkSync(r.file);run.removedFiles++;run.releasedBytes+=r.bytes;
   if(i%100===0)await new Promise(r=>setImmediate(r));
   if(!fast&&(i+1)%limits.batchFiles===0){run.message='本批已清理，等待下一批';await new Promise(resolve=>{continuation=setTimeout(resolve,limits.batchDelayMs);continuation.unref?.();});}
  }
  // Only empty directories below the explicitly audited roots are removed.
  const dirs=new Set(manifest.map(r=>path.dirname(r.file)));for(const dir of [...dirs].sort((a,b)=>b.length-a.length)){const owner=rows.find(r=>inside(r.root,dir))?.root;if(!owner)continue;try{safeMaintenanceFile(owner,dir);if(!(await fs.promises.readdir(dir)).length)await fs.promises.rmdir(dir);}catch{}}
 }
 function verifiedReceipt(backup,entrySha256){
  if(!/^[a-f0-9]{64}$/.test(backup?.sha256||''))return false;
  const receiptFile=path.join(root,'storage-maintenance','backups',backup.sha256+'.receipt.json');
  if(!fs.existsSync(receiptFile))return false;const receipt=JSON.parse(fs.readFileSync(receiptFile,'utf8'));
  return receipt.revisionId===backup.revisionId&&receipt.assetId===backup.assetId&&receipt.sha256===backup.sha256&&!!receipt.verifiedAt&&receipt.entries.some(e=>e.name==='objects/'+entrySha256&&e.sha256===entrySha256);
 }
 async function archiveCenter(){
  const inventory=await projectCenter?.storageInventory?.();if(!inventory)return;
  if(!inside(path.dirname(root),inventory.directory))throw Error('共享项目中心位于其他安装目录，未清理其资料');
  const projects=(await library.read('/api/projects')).items||[],seen=new Set(),groups=new Map();
  for(const record of inventory.files){if(!fs.existsSync(record.path)||seen.has(record.path))continue;
   if(activeProject(record.localProjectId)){
    const duplicate=record.type==='comic-image'&&store.db.assets.some(a=>a.projectCenterFile?.fileId===record.id&&a.projectCenterFile.sha256===record.sha256&&a.filePath!==record.path&&fs.existsSync(a.filePath));
    if(!duplicate)continue;
   }seen.add(record.path);
   const matches=projects.filter(p=>record.projectTitle.includes(p.name));if(matches.length!==1){continue;}
   const s=safeMaintenanceFile(inventory.directory,record.path),row={file:record.path,root:inventory.directory,relative:path.relative(inventory.directory,record.path).replaceAll('\\','/'),bytes:s.size,mtime:s.mtimeMs,ctime:s.ctimeMs,id:record.id,kind:'center'};
   const group=groups.get(matches[0].id)||[];group.push(row);groups.set(matches[0].id,group);
  }
  for(const [target,rows] of groups){if(busy())break;run.phase='backup';run.message='正在将项目中心历史原件备份到墨库';
   const {manifest,receipts}=await backupCandidates(rows,target);run.backups.push(...receipts.map(({entries,local,...r})=>r));
   const byHash=new Map();for(const receipt of receipts)for(const e of receipt.entries)if(e.name.startsWith('objects/')){const ref={projectId:receipt.projectId,assetId:receipt.assetId,revisionId:receipt.revisionId,sha256:receipt.sha256,size:receipt.size,entry:e.name,fileSha256:e.sha256,fileBytes:e.size,baseUrl:library.baseUrl};byHash.set(e.sha256,ref);state.archiveObjects[e.sha256]=ref;}persist();
   run.phase='cleaning';run.message='墨库历史原件已验证，正在回收项目中心本地副本';
   for(let i=0;i<manifest.length;){if(busy()||closed)throw Error('有新任务开始，未清理的历史原件保持原位');const batch=manifest.slice(i,i+limits.batchFiles).map(r=>({id:r.id,sha256:r.sha256,backup:byHash.get(r.sha256)}));
    const result=await projectCenter.evictStorage(batch);run.removedFiles+=result.files;run.releasedBytes+=result.bytes;
    // A center batch also has a byte limit; advance only over files now cold.
    let advanced=0;for(const r of manifest.slice(i,i+limits.batchFiles)){if(fs.existsSync(r.file))break;advanced++;}if(!advanced){i+=limits.batchFiles;}else i+=advanced;
    await new Promise(r=>setImmediate(r));
   }
  }
 }
 const restoringCenter=new Map();
 async function backupCode(target){
  const entries=[...collectCode(code)].map(([name,data])=>({name,data})),fingerprint=bytesHash(Buffer.from(JSON.stringify(entries.map(e=>[e.name,bytesHash(e.data)]))));
  if(state.codeBackup?.fingerprint===fingerprint)return;
  run.phase='backup';run.message='正在备份本机工作台源码（不含账号、模型和工程）';
  const receipt=await uploadVerifiedBackup({library,dataDir:root,projectId:target,name:'工作台源码备份.zip',entries});state.codeBackup={fingerprint,receipt};run.backups.push({kind:'code',revisionId:receipt.revisionId,verifiedAt:receipt.verifiedAt});persist();
 }
 async function evictOrphans(){
  const mentioned=strings([store.db.projects,store.db.jobs.filter(j=>activeStates.has(j.status))]),livePaths=new Set(store.db.assets.filter(a=>mentioned.has(a.id)).map(a=>a.filePath&&path.resolve(a.filePath).toLowerCase())),handled=new Set();let files=0,bytes=0;
  for(const asset of store.db.assets){if(files>=limits.batchFiles||bytes>=limits.batchBytes||busy())break;
   const file=asset.filePath;if(!file||asset.storageEvicted||!fs.existsSync(file)||!inside(root,file)||mentioned.has(asset.id)||livePaths.has(path.resolve(file).toLowerCase())||handled.has(file))continue;
   const rel=path.relative(root,file).replaceAll('\\','/');if(!/^(?:library-cache|project-center-cache|portable-project-cache)\//.test(rel))continue;
   handled.add(file);const stat=safeMaintenanceFile(root,file);if(files&&bytes+stat.size>limits.batchBytes)break;const sha=await hashFile(file),ref=state.archiveObjects[sha];if(!ref||!verifiedReceipt(ref,sha))continue;
   const linked=store.db.assets.filter(a=>a.filePath===file);for(const a of linked)a.storageEvicted={at:new Date(clock()).toISOString(),sha256:sha,archiveRef:ref};if(!store.save())throw Error('历史原图恢复指针未写盘，原件保留');
   if(busy())break;fs.unlinkSync(file);files++;bytes+=stat.size;
  }return {files,bytes};
 }
 async function restoreCenterFile(id){
  if(restoringCenter.has(id))return restoringCenter.get(id);
  const promise=(async()=>{const {directory,file:f}=await projectCenter.storageFile(id);if(!inside(path.dirname(root),directory)||!inside(directory,f.path))throw Error('历史原件不属于本机工作台');
   if(fs.existsSync(f.path))return;const ref=f.storageBackup;if(!ref||!verifiedReceipt(ref,ref.fileSha256))throw Error('缺少可核对的历史备份回执');
   let zip;const local=path.join(root,'storage-maintenance','backups',ref.sha256+'.zip');
   if(fs.existsSync(local)&&bytesHash(fs.readFileSync(local))===ref.sha256)zip=fs.readFileSync(local);
   else{library.rememberClassifiedAsset?.({...ref,id:ref.assetId,recommendedRevisionId:ref.revisionId,scopeId:'project',assetKind:'file',assetType:'project_archive'});const response=await library.remote('/api/revisions/'+ref.revisionId+'/download');const chunks=[];let size=0;for await(const b of response.body){size+=b.length;if(size>240*1024*1024)throw Error('历史备份大小无效');chunks.push(Buffer.from(b));}zip=Buffer.concat(chunks);}
   library.assertSession?.();if(bytesHash(zip)!==ref.sha256)throw Error('历史备份压缩包摘要不符');
   const bytes=backupEntryBytes(zip,ref.entry);if(bytes.length!==ref.fileBytes||bytesHash(bytes)!==ref.fileSha256)throw Error('历史原件还原摘要不符');
   const parent=path.dirname(f.path);fs.mkdirSync(parent,{recursive:true});const realParent=fs.realpathSync(parent);if(!inside(directory,realParent)||fs.lstatSync(parent).isSymbolicLink())throw Error('历史原件恢复目录无效');writeFileAtomicSync(f.path,bytes);
  })();restoringCenter.set(id,promise);try{await promise;}finally{restoringCenter.delete(id);}
 }
 async function execute({legacy=true,backup=true,completedProjectId='',automatic=false}={}){
  if(run&&['scanning','backup','cleaning','compacting'].includes(run.phase))return view();
  if(busy())throw Error('工作台有任务正在运行，请稍后清理');
  run={id:randomUUID(),phase:'scanning',started:new Date(clock()).toISOString(),message:'正在检查工程引用和本机占用',removedFiles:0,releasedBytes:0,compactedFiles:0,backups:[],protected:[]};
  const work=async()=>{try{
   let s=await scan();let firstTarget='';
   if(backup){for(const p of currentProjects()){if(activeDirty(p.id)){run.protected.push({id:p.id,reason:'窗口有未保存编辑'});continue;}try{run.phase='backup';run.message='正在备份“'+p.title+'”到墨库';const receipt=await backupProject(p.id,{completed:p.id===completedProjectId});firstTarget||=receipt.projectId;run.backups.push({projectId:p.id,revisionId:receipt.revisionId,verifiedAt:receipt.verifiedAt});}catch(e){run.protected.push({id:p.id,reason:e.message});}}}
   if(firstTarget&&!automatic)await backupCode(firstTarget);
   if(busy())throw Error('有新任务开始，清理暂停');
   run.phase='compacting';run.message='正在无损压缩工程历史快照';let remaining=1;
   for(let n=0;remaining&&n<1000&&!closed;n++){if(busy())break;const r=await projectCenter?.compact?.({limit:limits.batchFiles,maxBytes:limits.batchBytes});if(!r)break;run.compactedFiles+=r.files||0;run.releasedBytes+=r.savedBytes||0;remaining=r.remaining;if(!r.files)break;await new Promise(r=>setImmediate(r));}
   if(backup)await archiveCenter();
   s=await scan();const rows=[...s.candidates,...(legacy&&!automatic?s.legacy:[])];
   if(rows.length){if(!firstTarget){for(const p of currentProjects())try{firstTarget=await targetFor(p);break;}catch{}}if(firstTarget)await cleanRows(rows,{target:firstTarget,fast:!automatic});else run.protected.push({reason:'没有可验证的墨库备份归属，历史残留保持原位'});}
   const orphanEviction=await evictOrphans();
   const eviction=orphanEviction.files?orphanEviction:await (library.withSession?library.withSession(()=>evict(s)):evict(s));run.removedFiles+=eviction.files;run.releasedBytes+=eviction.bytes;
   run.phase='done';run.message=run.protected.length?'清理完成；需要确认的资料已保留':'清理完成';run.finished=new Date(clock()).toISOString();state.history.push(structuredClone(run));state.history=state.history.slice(-20);persist();await scan();
   if(eviction.files>=limits.batchFiles&&!closed){continuation=setTimeout(()=>{if(!busy())void execute({legacy:false,backup:false,automatic:true}).catch(()=>{});},limits.batchDelayMs);continuation.unref?.();}
  }catch(error){run.phase='failed';run.message=error.message;run.finished=new Date(clock()).toISOString();state.history.push(structuredClone(run));state.history=state.history.slice(-20);persist();}};
  void work();return view();
 }
 async function open(projectId,clientId){
  touch({projectId,clientId,dirty:false});const p=currentProjects().find(p=>p.id===projectId);if(!p)return;
  for(const id of projectAssetIds(p)){const a=store.db.assets.find(a=>a.id===id);if(a?.storageEvicted)await library.ensureAsset(id);}
  state.projects[projectId]||={};state.projects[projectId].lastUsed=new Date(clock()).toISOString();persist();
 }
 if(startTimer){timer=setInterval(()=>{if(!closed&&state.enabled&&!busy())void execute({legacy:false,backup:true,automatic:true}).catch(()=>{});},limits.intervalMs);timer.unref?.();}
 return {scan,view,touch,open,execute,backupProject,verifyAsset,restoreCenterFile,running:()=>!!run&&['scanning','backup','cleaning','compacting'].includes(run.phase),async handle(req,res,{pathname,method,url},json,body){
  if(!pathname.startsWith('/api/storage-maintenance'))return false;
  if(method==='GET'&&pathname.endsWith('/status')){if(!lastScan)await scan();json(res,200,view());return true;}
  const input=await body(req);
  if(method==='POST'&&pathname.endsWith('/restore-center')){await (library.withSession?library.withSession(()=>restoreCenterFile(input.fileId)):restoreCenterFile(input.fileId));json(res,200,{ok:true});return true;}
  if(method==='POST'&&pathname.endsWith('/verify-backup')){json(res,200,{ok:verifiedReceipt(input.backup,input.entrySha256)});return true;}
  if(method==='POST'&&pathname.endsWith('/activity')){touch(input);json(res,200,{ok:true});return true;}
  if(method==='POST'&&pathname.endsWith('/open')){await open(input.projectId,input.clientId);json(res,200,{ok:true});return true;}
  if(method==='POST'&&pathname.endsWith('/scan')){await scan();json(res,200,view());return true;}
  if(method==='POST'&&pathname.endsWith('/clean')){json(res,202,await execute({completedProjectId:input.completedProjectId||'',legacy:input.legacy!==false}));return true;}
  if(method==='POST'&&pathname.endsWith('/settings')){if(typeof input.enabled==='boolean')state.enabled=input.enabled;if(input.projectId&&input.completed===false&&state.projects[input.projectId])state.projects[input.projectId].completed=false;persist();json(res,200,view());return true;}
  throw Error('存储维护接口不存在');
 },close(){closed=true;clearInterval(timer);clearTimeout(continuation);try{persist();}catch(error){state.lastError=error.message;}}};
}
