import {collaborationStorage} from './collaboration-storage.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {check} from './store.mjs';
import {writeFileAtomicSync} from './durable-files.mjs';
import {sourceOriginalPath} from './source-originals.mjs';
import {teamProjectBody} from '../public/team-project-model.js';
import {FONT_FAMILIES} from '../public/lettering.js';
export const hashBytes=bytes=>createHash('sha256').update(bytes).digest('hex');
export const hashValue=value=>hashBytes(Buffer.from(JSON.stringify(value)));
const uuid=v=>/^[a-f0-9-]{36}$/i.test(v||'');
const assetId=v=>/^asset_[a-f0-9-]{36}$/i.test(v||'');
const metadata=['libraryRole','libraryName','libraryState','libraryAliases','libraryStateAliases','productionStatus','productionAssetId','productionStageId','referenceGeneration'];
function strings(value,set=new Set(),depth=0){if(depth>60)return set;if(typeof value==='string')set.add(value);else if(Array.isArray(value))for(const v of value)strings(v,set,depth+1);else if(value&&typeof value==='object')for(const v of Object.values(value))strings(v,set,depth+1);return set;}
export function createTeamProjectFiles({store,library,dataDir,receipts,persist}){
 async function upload(bytes,name,projectId,key,mime='application/octet-stream',category='reference',folder,context={}){
  const sha256=hashBytes(bytes),receiptKey=projectId+':'+key+':'+sha256,cached=receipts[receiptKey];if(cached){if(typeof library.organizeCollaborationAsset==='function'&&cached.storageLayoutVersion!==1){const updated=await library.organizeCollaborationAsset(cached,folder);const organized={...updated,storageLayoutVersion:1};receipts[receiptKey]=organized;persist();return organized;}return cached;}
  const sent=await library.uploadAsset({projectId,name,bytes,mime,category,folder,...context});check(uuid(sent.assetId)&&uuid(sent.revisionId),'墨库没有返回固定版本');
  const receipt={assetId:sent.assetId,revisionId:sent.revisionId,projectId:sent.projectId===null?null:projectId,sha256,size:bytes.length,folder:sent.folder||folder,storageLayoutVersion:1,...Object.fromEntries(['scopeId','episodeId','assetKind','assetType','engineeringId','panelId'].filter(k=>sent[k]!==undefined).map(k=>[k,sent[k]]))};receipts[receiptKey]=receipt;persist();return receipt;
 }
 async function pack(project,projectId){
  const folders=collaborationStorage(project),view=teamProjectBody(project),values=strings(view),assets=[];
  for(const id of values){if(!assetId(id))continue;const asset=store.db.assets.find(a=>a.id===id);check(asset,'工程引用的图片未登记：'+id,409);const file=store.assetPath(id);check(fs.existsSync(file),'图片原件缺失：'+asset.name,409);const bytes=fs.readFileSync(file);check(bytes.length<=256*1024*1024,'图片超过256MB：'+asset.name,413);const sha=hashBytes(bytes);
   let reference=asset.library?.revisionId&&asset.library.sha256===sha&&(!asset.library.projectId||asset.library.projectId===projectId)?{...asset.library}:null;
   if(!reference)reference=await upload(bytes,asset.name||id+'.png',projectId,'image:'+id,asset.mime||'image/png',asset.libraryRole||'reference',folders.asset(id),await library.projectUploadContext?.(project,projectId,{assetId:id})||{});
   assets.push({id,name:asset.name,width:asset.width,height:asset.height,mime:asset.mime||'image/png',sha256:sha,library:reference,...Object.fromEntries(metadata.filter(k=>asset[k]!==undefined).map(k=>[k,asset[k]]))});
  }
  const fonts=[];for(const font of store.db.libraryFonts||[]){if(!values.has(font.key))continue;check(font.provenance?.assetId&&font.revisionId,'墨库字体来源不完整：'+font.name);let ref={assetId:font.provenance.assetId,revisionId:font.revisionId};if(font.provenance.projectId&&font.provenance.projectId!==projectId){check(fs.existsSync(font.filePath),'字体原件缺失：'+font.name);const name=/\.(otf|ttf|ttc|woff2?)$/i.test(font.name)?font.name:font.name+path.extname(font.filePath);ref=await upload(fs.readFileSync(font.filePath),name,projectId,'font:'+font.key,'application/octet-stream','font',folders.font,await library.projectUploadContext?.(project,projectId,{role:'font'})||{});}fonts.push({key:font.key,name:font.name,...ref});}
  const originals=[];for(const file of project.sourceOriginalFiles||[]){const source=sourceOriginalPath(dataDir,project.id,file.hash);check(fs.existsSync(source),'导入原件缺失：'+file.name,409);const bytes=fs.readFileSync(source);check(hashBytes(bytes)===file.hash,'导入原件摘要不符：'+file.name,409);originals.push({...file,library:await upload(bytes,file.name,projectId,'original:'+file.hash,'application/octet-stream','reference',folders.original,await library.projectUploadContext?.(project,projectId,{role:file.role==='novel'?'novel':file.role==='storyboard'?'storyboard':'production_table',episode:file.episode})||{})});}
  return {format:'comic-strip-project-snapshot',version:1,projectId:project.id,title:project.title,revision:project.revision,exportedAt:new Date().toISOString(),stableHash:hashValue(view),project:view,assets,fonts,originals};
 }
 async function restore(snapshot){
  check(Array.isArray(snapshot.assets)&&snapshot.assets.length<=100000,'工程图片清单无效');const assets=[];
  const declared=new Set(snapshot.assets.map(a=>a.id));for(const id of strings(snapshot.project)){if(!assetId(id)||declared.has(id))continue;const existing=store.db.assets.find(a=>a.id===id);check(existing&&fs.existsSync(store.assetPath(id)),'工程缺少图片原件清单：'+id,409);}
  // Download and verify every file before replacing an editable project.
  for(const record of snapshot.assets){check(assetId(record.id)&&uuid(record.library?.assetId)&&uuid(record.library?.revisionId)&&/^[a-f0-9]{64}$/.test(record.sha256||record.library.sha256||''),'工程包含没有固定版本的图片：'+(record.name||record.id));const expected=record.sha256||record.library.sha256,old=store.db.assets.find(a=>a.id===record.id);
   if(old){const file=store.assetPath(old.id);if(fs.existsSync(file)&&hashBytes(fs.readFileSync(file))===expected){assets.push(old);continue;}}
   const imported=await library.importAsset(record.library);check(imported.kind==='image','工程引用不是图片：'+record.name);const file=store.assetPath(imported.asset.id);check(hashBytes(fs.readFileSync(file))===expected,'工程图片摘要不符：'+record.name,409);
   // IDs stay stable across computers. Imported cache records may have a different local ID.
   const local={...imported.asset,...record,id:record.id,filePath:file,library:{...record.library,sha256:expected},source:'team-project'};assets.push(local);
  }
  for(const font of snapshot.fonts||[]){check(uuid(font.assetId)&&uuid(font.revisionId)&&/^moku_[a-f0-9]{32}$/.test(font.key),'工程字体版本无效');if(!(store.db.libraryFonts||[]).some(f=>f.key===font.key)){const result=await library.importAsset(font);check(result.kind==='font','字体恢复失败：'+font.name);if(result.font.key!==font.key){const imported=store.db.libraryFonts.find(f=>f.key===result.font.key);check(imported,'字体缓存不存在');store.db.libraryFonts.push({...imported,key:font.key});FONT_FAMILIES[font.key]=FONT_FAMILIES[result.font.key];}}}
  for(const file of snapshot.originals||[]){check(/^[a-f0-9]{64}$/.test(file.hash||'')&&uuid(file.library?.revisionId),'导入原件版本无效');const target=sourceOriginalPath(dataDir,snapshot.projectId,file.hash);if(fs.existsSync(target)&&hashBytes(fs.readFileSync(target))===file.hash)continue;const response=await library.remote('/api/revisions/'+file.library.revisionId+'/download');check(Number(response.headers.get('content-length')||file.size)<=40*1024*1024,'导入原件过大');const bytes=Buffer.from(await response.arrayBuffer());check(bytes.length===file.size&&hashBytes(bytes)===file.hash,'导入原件恢复摘要不符：'+file.name);fs.mkdirSync(path.dirname(target),{recursive:true});writeFileAtomicSync(target,bytes);}
  return assets;
 }
 return {pack,restore};
}
