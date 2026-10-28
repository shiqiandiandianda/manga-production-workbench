import {collaborationStorage} from './collaboration-storage.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {check} from './store.mjs';
import {sourceOriginalPath} from './source-originals.mjs';
import {portableProject} from './project-portability.mjs';
import {writeZip} from './xlsx.mjs';
function projectSnapshotBody(project){
 const p=portableProject(project);for(const key of ['revision','updated'])delete p[key];
 if(p.episodeBoards){delete p.episodeBoards.templateRevision;delete p.episodeBoards.sharedKey;}
 if(p.assetLibrary)p.assetLibrary.directories=[];
 return p;
}
export const hashBytes=bytes=>createHash('sha256').update(bytes).digest('hex');
export const hashValue=value=>hashBytes(Buffer.from(JSON.stringify(value)));
const uuid=v=>/^[a-f0-9-]{36}$/i.test(v||'');
const assetId=v=>/^asset_[a-f0-9-]{36}$/i.test(v||'');
const metadata=['libraryRole','libraryName','libraryState','libraryAliases','libraryStateAliases','productionStatus','productionAssetId','productionStageId','referenceGeneration'];
function strings(value,set=new Set(),depth=0){if(depth>60)return set;if(typeof value==='string')set.add(value);else if(Array.isArray(value))for(const v of value)strings(v,set,depth+1);else if(value&&typeof value==='object')for(const v of Object.values(value))strings(v,set,depth+1);return set;}
export function createProjectMediaFiles({store,library,dataDir,receipts,persist,exportSources=()=>undefined}){
 async function upload(bytes,name,projectId,key,mime='application/octet-stream',category='reference',folder,context={}){
  const sha256=hashBytes(bytes),receiptKey='v2:'+hashValue([projectId,key,sha256,context]),legacy=receipts[projectId+':'+key+':'+sha256],fields=['scopeId','episodeId','assetKind','assetType','engineeringId','panelId'];
  // Keep an old receipt only when its recorded classification still matches.
  const expected={...context,episodeId:context.episodeId??(uuid(context.scopeId)?context.scopeId:null)};
  const legacyMatches=legacy&&legacy.projectId===(context.projectId===null?null:projectId)&&fields.every(k=>(legacy[k]??null)===(expected[k]??null));
  const cached=receipts[receiptKey]||(legacyMatches?legacy:null);if(cached){if(typeof library.organizeCollaborationAsset==='function'&&cached.storageLayoutVersion!==1){const updated=await library.organizeCollaborationAsset(cached,folder);const organized={...updated,storageLayoutVersion:1};receipts[receiptKey]=organized;persist();return organized;}return cached;}
  const sent=await library.uploadAsset({projectId,name,bytes,mime,category,folder,...context,operationId:'project-media:'+hashValue([projectId,key,sha256,context])});check(uuid(sent.assetId)&&uuid(sent.revisionId),'墨库没有返回固定版本');
  const receipt={assetId:sent.assetId,revisionId:sent.revisionId,projectId:sent.projectId===null?null:projectId,sha256,size:bytes.length,folder:sent.folder||folder,storageLayoutVersion:1,...Object.fromEntries(['scopeId','episodeId','assetKind','assetType','engineeringId','panelId'].filter(k=>sent[k]!==undefined).map(k=>[k,sent[k]]))};receipts[receiptKey]=receipt;persist();return receipt;
 }
 async function pack(project,projectId){
  const folders=collaborationStorage(project),view=projectSnapshotBody(project),values=strings(view),assets=[];let metadataChanged=false;
  for(const id of values){if(!assetId(id))continue;const asset=store.db.assets.find(a=>a.id===id);check(asset,'工程引用的图片未登记：'+id,409);const file=store.assetPath(id);check(fs.existsSync(file),'图片原件缺失：'+asset.name,409);check(fs.statSync(file).size<=256*1024*1024,'图片超过256MB：'+asset.name,413);const bytes=fs.readFileSync(file);const sha=hashBytes(bytes);
   let reference=uuid(asset.library?.assetId)&&uuid(asset.library?.revisionId)&&asset.library.sha256===sha&&(!asset.library.projectId||asset.library.projectId===projectId)?{...asset.library}:null;
   if(!reference)reference=await upload(bytes,asset.name||id+'.png',projectId,'image:'+id,asset.mime||'image/png',asset.libraryRole||'reference',folders.asset(id),await library.projectUploadContext?.(project,projectId,{assetId:id})||{});
   library.assertSession?.();reference={...reference,baseUrl:library.baseUrl,sha256:sha};if(JSON.stringify(asset.library)!==JSON.stringify(reference)){asset.library=reference;metadataChanged=true;}
   assets.push({id,name:asset.name,width:asset.width,height:asset.height,mime:asset.mime||'image/png',sha256:sha,library:reference,...Object.fromEntries(metadata.filter(k=>asset[k]!==undefined).map(k=>[k,asset[k]]))});
  }
  if(metadataChanged)store.save();
  const fonts=[];for(const font of store.db.libraryFonts||[]){if(!values.has(font.key))continue;check(font.provenance?.assetId&&font.revisionId,'墨库字体来源不完整：'+font.name);let ref={assetId:font.provenance.assetId,revisionId:font.revisionId};if(font.provenance.projectId&&font.provenance.projectId!==projectId){check(fs.existsSync(font.filePath),'字体原件缺失：'+font.name);const name=/\.(otf|ttf|ttc|woff2?)$/i.test(font.name)?font.name:font.name+path.extname(font.filePath);ref=await upload(fs.readFileSync(font.filePath),name,projectId,'font:'+font.key,'application/octet-stream','font',folders.font,await library.projectUploadContext?.(project,projectId,{role:'font'})||{});}fonts.push({key:font.key,name:font.name,...ref});}
  const originals=[];for(const file of project.sourceOriginalFiles||[]){const source=sourceOriginalPath(dataDir,project.id,file.hash);check(fs.existsSync(source),'导入原件缺失：'+file.name,409);const bytes=fs.readFileSync(source);check(hashBytes(bytes)===file.hash,'导入原件摘要不符：'+file.name,409);originals.push({...file,library:await upload(bytes,file.name,projectId,'original:'+file.hash,'application/octet-stream','reference',folders.original,await library.projectUploadContext?.(project,projectId,{role:file.role==='novel'?'novel':file.role==='storyboard'?'storyboard':'production_table',episode:file.episode})||{})});}
  for(const f of fonts){const source=(store.db.libraryFonts||[]).find(x=>x.key===f.key);if(!f.sha256){check(source?.filePath&&fs.existsSync(source.filePath),'字体原件缺失：'+f.name);Object.assign(f,{...source.provenance,assetId:f.assetId,revisionId:f.revisionId,sha256:hashBytes(fs.readFileSync(source.filePath)),projectId:null,scopeId:'global',assetKind:'file',assetType:'font'});}}
  let packageSources=exportSources(project),packageSourcesArchive;
  if(packageSources){
   const raw=Buffer.from(JSON.stringify(packageSources));
   if(raw.length>8*1024*1024){
    const taxonomy=await library.read('/api/project-library/taxonomy');
    if((taxonomy.items||[]).some(item=>item.kind==='file'&&item.type==='project_archive')){
     check(raw.length<=200*1024*1024,'制作资料快照超过200MiB，请按话拆分工程',413);
     const bytes=writeZip([{name:'package-sources.json',data:raw}]);
     check(bytes.length<=256*1024*1024,'制作资料归档超过256MiB，请按话拆分工程',413);
     packageSourcesArchive=await upload(bytes,'制作资料快照_'+hashBytes(raw).slice(0,12)+'.zip',projectId,'package-sources:'+hashBytes(raw),'application/zip','reference',folders.original,{projectId,scopeId:'project',assetKind:'file',assetType:'project_archive'});
     library.assertSession?.();packageSources=undefined;
    }
   }
  }
  return {format:'comic-strip-project-snapshot',version:1,projectId:project.id,title:project.title,revision:project.revision,exportedAt:new Date().toISOString(),stableHash:hashValue(view),project:view,assets,fonts,originals,...(packageSources?{packageSources}:{}),...(packageSourcesArchive?{packageSourcesArchive}:{})};
 }
 return {pack};
}
