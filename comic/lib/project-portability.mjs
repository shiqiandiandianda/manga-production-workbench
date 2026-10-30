import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {check,imageInfo,validateProject} from './store.mjs';
import {writeFileAtomicSync} from './durable-files.mjs';
import {decodeProjectSnapshot,SNAPSHOT_FORMAT} from './project-snapshot-codec.mjs';
import {sourceOriginalPath,validateOriginalRecords} from './source-originals.mjs';
import {readZip} from './xlsx.mjs';
import {expandProjectFile} from './compact-project-file.mjs';
import {backupEntryBytes} from './maintenance-backup.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const uuid=value=>typeof value==='string'&&/^[a-f0-9-]{36}$/i.test(value);
const sha=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const MAX_FILE=256*1024*1024,MAX_PROJECT=512*1024*1024;
function fontExtension(bytes,name){
 const magic=bytes.subarray(0,4).toString('latin1');
 if(magic==='OTTO')return '.otf';if(magic==='ttcf')return '.ttc';if(magic==='wOFF')return '.woff';if(magic==='wOF2')return '.woff2';
 if(magic==='true'||bytes.subarray(0,4).equals(Buffer.from([0,1,0,0])))return '.ttf';
 const ext=path.extname(String(name||'')).toLowerCase();if(/^\.(ttf|otf|ttc|woff2?)$/.test(ext))return ext;
 check(false,'字体原件格式无法识别，请在墨库核对',422);
}
const metadata=['libraryRole','libraryName','libraryState','libraryAliases','libraryStateAliases','productionStatus','productionAssetId','productionStageId','referenceGeneration','comicKind'];
const localFields=new Set(['layoutHistory','layoutImports','designHistory','storyboardWorkflow','novelProductionWorkflow']);
export function portableProject(project){
 const result=structuredClone(project);for(const key of localFields)delete result[key];
 if(result.assetLibrary)result.assetLibrary.directories=[];
 const clean=value=>{if(!value||typeof value!=='object')return;for(const [key,item]of Object.entries(value)){
  if(key==='generationToken')value[key]=null;
  else if(['filePath','originalFilePath','localPath','sourceDirectory','directory','root','path'].includes(key)&&typeof item==='string'&&/^(?:[a-z]:[\\/]|\\\\|\/)/i.test(item))delete value[key];
  else clean(item);
 }};clean(result);return result;
}
export function projectAssetIds(project){
 const ids=new Set();const walk=(v,depth=0)=>{check(depth<=80,'工程嵌套层级过深');if(typeof v==='string'&&/^asset_[a-f0-9-]{36}$/i.test(v))ids.add(v);else if(v&&typeof v==='object')for(const x of Object.values(v))walk(x,depth+1);};walk(portableProject(project));return ids;
}
export function fixedResourceReferences(content){
 return [...(content.assets||[]),...(content.originals||[]),...(content.fonts||[]),...(content.packageSourcesArchive?[content.packageSourcesArchive]:[])].map(a=>a.library||a).filter(r=>uuid(r.assetId)&&uuid(r.revisionId));
}
export function createProjectPortability({store,library,dataDir,productionPackages,maxEmbeddedBytes=MAX_PROJECT}){
 const cache=path.join(dataDir,'portable-project-cache');
 const active=()=>library.assertSession?.();
 const safeRef=ref=>Object.fromEntries(['baseUrl','projectId','scopeId','episodeId','assetKind','assetType','assetId','revisionId','sha256','size','engineeringId','panelId','objectId','category'].filter(k=>ref?.[k]!==undefined).map(k=>[k,ref[k]]));
 const fixed=ref=>uuid(ref?.assetId)&&uuid(ref?.revisionId)&&sha(ref?.sha256);
 function remember(ref){if(ref?.assetId)library.rememberClassifiedAsset?.({...ref,id:ref.assetId,recommendedRevisionId:ref.revisionId});}
 async function bytesFrom(response,expected,max=MAX_FILE){
  check(Number(response.headers?.get('content-length')||0)<=max,'工程资源超过大小上限',413);
  const chunks=[];let size=0;for await(const chunk of response.body){active();size+=chunk.length;check(size<=max,'工程资源超过大小上限',413);chunks.push(Buffer.from(chunk));}
  const bytes=Buffer.concat(chunks);check(!expected||hash(bytes)===expected,'工程资源 SHA-256 校验失败，未载入工程',422);return bytes;
 }
 async function exportFile(project,{syncMedia=false,remoteProjectId='',manifests={}}={}){
  const ticket=project.revision,view=portableProject(project);validateProject(view);
  const usedIds=[...projectAssetIds(view)],archivedReady=usedIds.length>0&&usedIds.every(id=>{const a=store.db.assets.find(x=>x.id===id),ref=a?.storageBackupRef;if(!ref?.fileSha256)return false;const file=store.assetPath(id);return fs.existsSync(file)?hash(fs.readFileSync(file))===ref.fileSha256:a.storageEvicted?.sha256===ref.fileSha256;});
  if(syncMedia&&remoteProjectId&&!archivedReady){
   const complete=await library.packProject(view,remoteProjectId);check(complete,'墨库不支持固定资源归档');active();
   check(store.project(project.id).revision===ticket,'归档期间工程已修改，请重新保存',409);
  }
  let total=0;const assets=[];
  for(const id of projectAssetIds(view)){
   const a=store.db.assets.find(x=>x.id===id);check(a,'工程图片未登记：'+id,409);
   const file=store.assetPath(id);let bytes;
   if(fs.existsSync(file)){check(fs.statSync(file).size<=MAX_FILE,'图片超过256MB：'+a.name,413);bytes=fs.readFileSync(file);}
   else check(fixed(a.library)||a.storageBackupRef,'图片原件缺失且没有墨库固定版本：'+a.name,409);
   const digest=bytes?hash(bytes):a.storageBackupRef?.fileSha256||a.library.sha256,ref=fixed(a.library)&&a.library.sha256===digest?safeRef(a.library):null,archive=a.storageBackupRef?.fileSha256===digest?structuredClone(a.storageBackupRef):null;
   if(!ref&&!archive){total+=bytes.length;check(total<=MAX_PROJECT,'离线工程原件超过512MB，请先上传墨库再保存',413);}
   assets.push({id,name:a.name,width:a.width,height:a.height,mime:a.mime,sha256:digest,...(archive?{archive,...(ref?{library:ref}:{})}:ref?{library:ref}:{dataBase64:bytes.toString('base64')}),...Object.fromEntries(metadata.filter(k=>a[k]!==undefined).map(k=>[k,a[k]]))});
  }
  const text=JSON.stringify(view),fonts=[];
  for(const f of store.db.libraryFonts||[]){if(!text.includes(JSON.stringify(f.key)))continue;const ref=safeRef({...f.provenance,revisionId:f.revisionId});check(fixed(ref),'字体缺少墨库固定版本：'+f.name,409);fonts.push({key:f.key,name:f.name,library:ref,...(f.provenance?.archiveRef?{archive:f.provenance.archiveRef}:{})});}
  const originals=[];for(const f of project.sourceOriginalFiles||[]){const file=sourceOriginalPath(dataDir,project.id,f.hash);check(fs.existsSync(file),'导入原件缺失：'+f.name,409);const bytes=fs.readFileSync(file);check(hash(bytes)===f.hash,'导入原件摘要不符：'+f.name,409);total+=bytes.length;originals.push({...f,dataBase64:bytes.toString('base64')});}
  const packageSources=project.productionPackage?productionPackages.exportSources(project):undefined;
  const targets=library.projectSnapshotTargets?.(project.id,remoteProjectId)||[],restoreSnapshots=targets.length?targets:project.mokuRestoreSnapshots||[];
  const result={format:'comic-strip-studio',version:3,imageStorage:assets.length&&assets.every(a=>a.library)?'moku':'portable',project:view,assets,fonts,originals,...manifests,...(packageSources?{packageSources}:{}),...(restoreSnapshots.length?{restoreSnapshots}:{}),portability:{fixedImages:assets.filter(a=>a.library).length,embeddedImages:assets.filter(a=>!a.library).length,localPathsRequired:false},...(remoteProjectId?{moku:{projectId:remoteProjectId}}:{})};
  check(Buffer.byteLength(JSON.stringify(result))<=MAX_PROJECT*1.4,'工程文件超过大小上限，请先上传墨库再保存',413);active();return result;
 }
 async function prepareImport(raw){
  let input=expandProjectFile(raw),sourceFile;
  if(uuid(raw?.documentId)){
   const document=await library.read('/api/documents/'+raw.documentId);input={...document.content,restoreSnapshots:document.restoreSnapshots};
  }else if(raw?.mokuFile){
   const ref=raw.mokuFile;check(uuid(ref.assetId)&&uuid(ref.revisionId),'请选择工程文件的固定版本');remember(ref);
   const detail=await library.read('/api/assets/'+ref.assetId);check(detail.assetType==='comic_project','请选择漫画工程文件');
   const revision=await library.read('/api/assets/'+ref.assetId+'/revisions/'+ref.revisionId);check(revision.assetId===ref.assetId,'工程文件版本不匹配');
   sourceFile={projectId:detail.projectId,engineeringId:detail.engineeringId,revisionId:revision.id};
   input=JSON.parse((await bytesFrom(await library.remote('/api/revisions/'+revision.id+'/download'),revision.sha256,128*1024*1024)).toString('utf8'));
  }
  // Moku's downloadable snapshot archive wraps the editor format in content.
  for(let i=0;i<4&&!input?.format&&input?.content;i++)input=input.content;
  input=expandProjectFile(input);
  const restoreSnapshots=input?.restoreSnapshots;
  if(input?.format===SNAPSHOT_FORMAT){
   const envelope=input;remember(envelope.payload);input=await decodeProjectSnapshot(envelope,library);
   input={...input,format:'comic-strip-studio',version:3,moku:input.moku||envelope.moku,restoreSnapshots};
  }
  check(input?.format==='comic-strip-studio'&&[1,2,3].includes(input.version)&&input.project&&Array.isArray(input.assets)&&input.assets.length<=1200,'工程文件格式无效；支持本地工程与墨库工程快照');
  input=structuredClone(input);validateProject(input.project);validateOriginalRecords(input.project.sourceOriginalFiles);
  const ids=new Set();for(const a of input.assets){check(/^asset_[a-f0-9-]{36}$/i.test(a?.id||'')&&!ids.has(a.id),'工程图片编号无效或重复');ids.add(a.id);}
  for(const id of projectAssetIds(input.project))check(ids.has(id),'工程缺少图片清单：'+id+'；原工程未改变',409);
  const retained=new Map();
  async function addSnapshot(target,snapshotId){
   check(uuid(target.projectId)&&uuid(target.engineeringId)&&uuid(snapshotId),'工程快照归属无效');
   const route='/api/project-library/'+target.projectId+'/engineerings/'+target.engineeringId+'/snapshots/'+snapshotId;
   const value=await library.read(route);input.restoreSnapshots||=[];if(!input.restoreSnapshots.some(s=>s.snapshotId===snapshotId))input.restoreSnapshots.push({...target,snapshotId});
   for(const r of value.references||[])retained.set(r.assetId+':'+r.revisionId,{...r,route:route+'/references/'+r.revisionId+'/download'});
  }
  check(!input.restoreSnapshots||Array.isArray(input.restoreSnapshots)&&input.restoreSnapshots.length<=1000,'工程快照清单无效');
  let retainedReady=false;async function ensureRetained(){if(retainedReady)return;retainedReady=true;
  for(const target of [...input.restoreSnapshots||[]])await addSnapshot(target,target.snapshotId);
  const target=sourceFile||input.moku;
  if(target?.engineeringId&&uuid(target.projectId)&&uuid(target.engineeringId)&&!retained.size){
   const route='/api/project-library/'+target.projectId+'/engineerings/'+target.engineeringId+'/snapshots';
   const items=(await library.read(route)).items||[];
   for(const item of items){
    if(sourceFile){if(item.engineeringRevisionId===sourceFile.revisionId){await addSnapshot(target,item.id);break;}}
    else{const s=await library.read(route+'/'+item.id);if(input.stableHash&&s.content?.stableHash===input.stableHash){await addSnapshot(target,item.id);break;}}
   }
  }
  }
  let embeddedTotal=0;const archiveCache=new Map();
  async function resource(item,expected){
   const ref=item.library||((item.assetId&&item.revisionId)?item:null);let bytes,identity=ref?safeRef(ref):null;
   if(item.archive){
    const a=item.archive;check(uuid(a.assetId)&&uuid(a.revisionId)&&sha(a.sha256)&&sha(a.fileSha256)&&a.fileSha256===expected&&a.entry==='objects/'+a.fileSha256&&a.assetType!=='comic_panel','工程归档原件身份无效',422);
    check(!a.baseUrl||!library.baseUrl||a.baseUrl.replace(/\/$/,'')===library.baseUrl.replace(/\/$/,''),'归档原件属于其他墨库服务器',409);
    remember({...a,scopeId:'project',assetKind:'file',assetType:'project_archive'});const key=a.revisionId+':'+a.sha256;
    let zip=archiveCache.get(key);if(!zip){zip=await bytesFrom(await library.remote('/api/revisions/'+a.revisionId+'/download'),a.sha256,240*1024*1024);if(archiveCache.size>=1)archiveCache.delete(archiveCache.keys().next().value);archiveCache.set(key,zip);}
    bytes=backupEntryBytes(zip,a.entry);check(hash(bytes)===expected&&(!a.fileBytes||bytes.length===a.fileBytes),'工程归档原件摘要不符',422);if(identity){identity.sha256=expected;identity.archiveRef=a;}
   }else if(ref){
    check(uuid(ref.assetId)&&uuid(ref.revisionId),'工程资源固定版本身份无效');remember(ref);
    // A verified local cache may be reused offline; never trust a path supplied by the file.
    if(sha(expected)){
     const candidates=[...(store.db.assets||[]).filter(a=>a.library?.assetId===ref.assetId&&a.library?.revisionId===ref.revisionId&&a.library?.sha256===expected).map(a=>store.assetPath(a.id)),...(store.db.libraryFonts||[]).filter(f=>f.provenance?.assetId===ref.assetId&&f.revisionId===ref.revisionId&&f.provenance?.sha256===expected).map(f=>f.filePath)];
     for(const file of candidates){if(!file||!fs.existsSync(file)||fs.statSync(file).size>MAX_FILE)continue;const cached=fs.readFileSync(file);if(hash(cached)!==expected)continue;active();return {bytes:cached,library:{...identity,sha256:expected}};}
    }
    await ensureRetained();const saved=retained.get(ref.assetId+':'+ref.revisionId);
    const revision=saved||await library.read('/api/assets/'+ref.assetId+'/revisions/'+ref.revisionId);
    check((!revision.assetId||revision.assetId===ref.assetId)&&sha(revision.sha256),'工程资源版本归属或摘要无效',409);
    check((!expected||revision.sha256===expected)&&(!ref.sha256||revision.sha256===ref.sha256),'工程资源固定版本摘要不匹配，未改用其他版本',422);
    identity={...identity,sha256:revision.sha256};
    bytes=await bytesFrom(await library.remote(saved?.route||'/api/revisions/'+ref.revisionId+'/download'),revision.sha256);
   }else if(typeof item.dataBase64==='string'){
    check(item.dataBase64.length<=Math.ceil(MAX_FILE/3)*4&&/^[A-Za-z0-9+/]*={0,2}$/.test(item.dataBase64),'工程内嵌原件格式或大小无效',413);bytes=Buffer.from(item.dataBase64,'base64');embeddedTotal+=bytes.length;check(embeddedTotal<=maxEmbeddedBytes,'工程内嵌原件超过大小限制，请先在原电脑上传墨库',413);check(sha(expected)&&hash(bytes)===expected,'工程内嵌原件摘要不符',422);
   }else return null;
   active();return {bytes,library:identity,archive:item.archive};
  }
  const stage=(bytes,name,ref,localId='')=>{
   const extension=path.extname(String(name||'')).toLowerCase(),suffix=/^\.[a-z0-9]{1,8}$/.test(extension)?extension:'.bin';
   const key=hash(Buffer.from([library.baseUrl||'',ref?.assetId||localId,ref?.revisionId||'',hash(bytes)].join(':'))),file=path.join(cache,key+suffix);fs.mkdirSync(cache,{recursive:true});
   if(!fs.existsSync(file)||hash(fs.readFileSync(file))!==hash(bytes))writeFileAtomicSync(file,bytes);return file;
  };
  for(const a of input.assets){
   const result=await resource(a,a.sha256||a.library?.sha256);
   if(result){const info=imageInfo(result.bytes);check((!a.width||a.width===info.width)&&(!a.height||a.height===info.height),'工程图片尺寸与固定版本不符：'+a.name,422);a.filePath=stage(result.bytes,'image'+info.extension,result.library,a.id);if(result.library)a.library=result.library;delete a.dataBase64;}
   else check(input.version<3&&typeof a.filePath==='string'&&fs.existsSync(a.filePath),'旧工程图片原件不可读且未记录墨库版本：'+(a.name||a.id)+'；请在原电脑重新导出跨机工程',409);
  }
  if(input.packageSourcesArchive){
   check(!input.packageSources,'工程制作资料同时含内嵌和归档版本，无法确定来源',409);
   const ref=input.packageSourcesArchive;check(ref.assetKind==='file'&&ref.assetType==='project_archive'&&uuid(ref.projectId)&&ref.scopeId==='project'&&sha(ref.sha256)&&(!input.moku?.projectId||input.moku.projectId===ref.projectId),'制作资料归档分类、项目或摘要无效',409);
   const result=await resource({library:ref},ref.sha256);check(result,'制作资料归档不可读取',409);
   let entries;try{const zip=readZip(result.bytes);check(zip.names().length===1&&zip.has('package-sources.json'),'制作资料归档清单无效',422);entries=JSON.parse(zip.read('package-sources.json'));}catch(error){if(error?.status)throw error;throw Object.assign(Error('制作资料归档损坏或超过大小限制'),{status:422});}
   check(Array.isArray(entries),'制作资料归档内容无效',422);input.packageSources=entries;
  }
  const fontMap=new Map(),fontFiles=[];for(const f of input.fonts||[]){const data=await resource(f,f.sha256||f.library?.sha256);check(data?.library,'工程字体固定来源缺失');const ext=fontExtension(data.bytes,f.name);fontFiles.push({f,library:data.library,file:stage(data.bytes,'font'+ext,data.library)});}
  const originalBytes=[];for(const f of input.project.sourceOriginalFiles||[]){
   const entry=input.originals?.find(x=>x.hash===f.hash&&x.role===f.role&&x.name===f.name);
   let data=entry&&await resource(entry,f.hash);
   if(!data&&input.version<3){const file=sourceOriginalPath(dataDir,input.project.id,f.hash);if(fs.existsSync(file))data={bytes:fs.readFileSync(file)};}
   check(data&&hash(data.bytes)===f.hash&&data.bytes.length===f.size,'工程缺少导入原件：'+f.name,409);originalBytes.push({...f,staged:stage(data.bytes,f.name,data.library,'original:'+f.hash)});
  }
  for(const {f,file,library:ref}of fontFiles){const font=await library.registerSnapshotFont(file,{...ref,originalName:f.name});fontMap.set(f.key,font.key);}
  const remap=v=>{if(!v||typeof v!=='object')return;for(const [k,x]of Object.entries(v))if(typeof x==='string'&&fontMap.has(x))v[k]=fontMap.get(x);else remap(x);};remap(input.project);
  active();return {input,finish(project){active();if(input.restoreSnapshots?.length)project.mokuRestoreSnapshots=input.restoreSnapshots;for(const f of originalBytes){const target=sourceOriginalPath(dataDir,project.id,f.hash);fs.mkdirSync(path.dirname(target),{recursive:true});writeFileAtomicSync(target,fs.readFileSync(f.staged));}}};
 }
 return {exportFile,prepareImport};
}
