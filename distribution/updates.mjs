import {backupPrimarySource,isPrimaryUpdateHost,cleanupInstalledUpdate,pruneUpdateArchives} from './update-cleanup.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {sign,verify} from 'node:crypto';
import {gzipSync,gunzipSync} from 'node:zlib';
import {allowedCodePath,safeTarget,digest} from './code-policy.mjs';
import {nextReleaseVersion} from '../comic/public/team-version.js';
// Optional installation-specific extensions are not included in source releases.
// Their absence must not prevent the ordinary launcher and updater from loading.
const extensionUrl=new URL('../runtime-data/distribution/local-fixes/managed-overrides.mjs',import.meta.url);
const localExtensions=fs.existsSync(extensionUrl)?await import(extensionUrl.href):null;
export const writeJson=(file,value)=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file+'.tmp',JSON.stringify(value,null,2));fs.renameSync(file+'.tmp',file);};
export function createRelease(files,privateKey,{previous=null,now=new Date().toISOString(),author,note,changeSummary,previousReleases=[]}={}){
 const rows=[...files].map(([name,bytes])=>({path:name,bytes:bytes.length,sha256:digest(bytes)})).sort((a,b)=>a.path.localeCompare(b.path,'en'));
 const contentId=digest(JSON.stringify(rows)),manifest={format:'comic-code-update-v1',version:nextReleaseVersion(previous?.version,now),contentId,createdAt:now,files:rows,removed:(previous?.files||[]).filter(r=>!files.has(r.path)).map(r=>r.path)};
 if(author)manifest.author={id:author.id,name:author.name};if(note)manifest.releaseNotes=note;if(changeSummary)manifest.changeSummary=changeSummary;if(previousReleases.length)manifest.previousReleases=previousReleases;
 const signature=sign(null,Buffer.from(JSON.stringify(manifest)),privateKey).toString('base64'),envelope={manifest,signature};
 const archive=gzipSync(Buffer.from(JSON.stringify({...envelope,files:Object.fromEntries([...files].map(([name,bytes])=>[name,bytes.toString('base64')]))})),{level:6});return {...envelope,archive,archiveSha256:digest(archive)};
}
export function validateEnvelope(envelope,publicKey){
 const m=envelope?.manifest;if(m?.format!=='comic-code-update-v1'||!Array.isArray(m.files)||m.files.length>10000||!Array.isArray(m.removed)||!verify(null,Buffer.from(JSON.stringify(m)),publicKey,Buffer.from(envelope.signature||'','base64')))throw Error('升级包主版本签名无效');
 const seen=new Set();for(const r of m.files){if(!allowedCodePath(r.path)||seen.has(r.path)||!Number.isSafeInteger(r.bytes)||r.bytes<0||r.bytes>32*1024*1024||!/^[a-f0-9]{64}$/.test(r.sha256))throw Error('升级文件清单无效：'+r.path);seen.add(r.path);}
 if(m.removed.some(p=>!allowedCodePath(p)||seen.has(p)))throw Error('升级删除清单无效');
 if(digest(JSON.stringify(m.files))!==m.contentId)throw Error('升级版本摘要无效');return m;
}
export function decodeRelease(bytes,publicKey){
 if(bytes.length>64*1024*1024)throw Error('升级包过大');const bundle=JSON.parse(gunzipSync(bytes,{maxOutputLength:128*1024*1024}).toString()),m=validateEnvelope(bundle,publicKey),files=new Map();
 if(Object.keys(bundle.files||{}).length!==m.files.length)throw Error('升级包文件数量不一致');
 for(const row of m.files){const data=Buffer.from(bundle.files[row.path]||'','base64');if(data.length!==row.bytes||digest(data)!==row.sha256)throw Error('升级文件校验失败：'+row.path);files.set(row.path,data);}return {...bundle,files};
}
function applyReleaseUnmanaged(root,bundle,{allowModified=false,failAfter=Infinity}={}){
 const m=bundle.manifest,installedFile=path.join(root,'runtime-data/distribution/installed.local.json'),installed=fs.existsSync(installedFile)?JSON.parse(fs.readFileSync(installedFile)):null;
 if(installed?.contentId===m.contentId){const cleanup=cleanupInstalledUpdate(root,{version:m.version,contentId:m.contentId});try{writeJson(path.join(root,'runtime-data/distribution/cleanup.local.json'),cleanup);}catch{}return {upToDate:true,version:m.version,cleanup};}
 const previous=new Map((installed?.files||[]).map(r=>[r.path,r])),incoming=new Map(m.files.map(r=>[r.path,r]));
 // Accumulated deletions come from the colleague's installed manifest, even when it skipped releases.
 const changed=[...new Set([...m.files.filter(r=>!fs.existsSync(safeTarget(root,r.path))||digest(fs.readFileSync(safeTarget(root,r.path)))!==r.sha256).map(r=>r.path),...[...previous.keys()].filter(p=>!incoming.has(p)&&fs.existsSync(safeTarget(root,p)))])];
 for(const p of changed){const target=safeTarget(root,p),old=previous.get(p);if(fs.existsSync(target)&&old&&digest(fs.readFileSync(target))!==old.sha256&&!allowModified)throw Error('同事本机代码已修改，先保留差异再升级：'+p);if(fs.existsSync(target)&&!old&&installed&&!incoming.has(p))throw Error('未登记的文件不删除：'+p);}
 const sourceBackup=backupPrimarySource(root,installed);
 if(typeof m.version!=='string'||!/^[a-zA-Z0-9 ._-]{1,100}$/.test(m.version)||m.version.includes('..'))throw Error('升级版本名称无效');
 const backup=path.join(root,'runtime-data/distribution/backups',m.version),journal={version:m.version,status:'preparing',previous:installed,files:changed.map(p=>({path:p,existed:fs.existsSync(safeTarget(root,p))}))};fs.mkdirSync(backup,{recursive:true});
 for(const item of journal.files)if(item.existed){const target=path.join(backup,'files',...item.path.split('/'));fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(safeTarget(root,item.path),target);}writeJson(path.join(backup,'journal.json'),journal);
 try{let count=0;for(const p of changed){const target=safeTarget(root,p),bytes=bundle.files.get(p);if(bytes){fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target+'.upgrading',bytes);fs.renameSync(target+'.upgrading',target);}else fs.unlinkSync(target);if(++count===failAfter)throw Error('故障注入：验证回滚');}
  writeJson(installedFile,m);journal.status='applied';writeJson(path.join(backup,'journal.json'),journal);const removed=changed.filter(name=>!incoming.has(name));const cleanup=cleanupInstalledUpdate(root,{version:m.version,contentId:m.contentId,removed});try{writeJson(path.join(root,'runtime-data/distribution/cleanup.local.json'),cleanup);}catch{}return {version:m.version,changed:changed.length,backup:sourceBackup?.directory||null,cleanup};
 }catch(error){restoreBackup(root,backup);throw error;}
}
function restoreBackupUnmanaged(root,backup){
 const journal=JSON.parse(fs.readFileSync(path.join(backup,'journal.json')));for(const item of journal.files){const target=safeTarget(root,item.path);if(item.existed){fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(backup,'files',...item.path.split('/')),target);}else if(fs.existsSync(target))fs.unlinkSync(target);if(fs.existsSync(target+'.upgrading'))fs.unlinkSync(target+'.upgrading');}
 const installed=path.join(root,'runtime-data/distribution/installed.local.json');if(journal.previous)writeJson(installed,journal.previous);else if(fs.existsSync(installed))fs.unlinkSync(installed);journal.status='rolled-back';writeJson(path.join(backup,'journal.json'),journal);
}
export async function checkUpdate(root,channel){
 const response=await fetch(channel.masterUrl+'/api/releases/latest',{signal:AbortSignal.timeout(10000)});if(!response.ok)throw Error('主版本服务暂时不可达：'+response.status);const envelope=await response.json(),manifest=validateEnvelope(envelope,channel.publicKey),installedFile=path.join(root,'runtime-data/distribution/installed.local.json'),installed=fs.existsSync(installedFile)?JSON.parse(fs.readFileSync(installedFile)):null;
 return {...envelope,available:installed?.contentId!==manifest.contentId};
}
export async function stageUpdate(root,channel,envelope){
 const m=validateEnvelope(envelope,channel.publicKey);pruneUpdateArchives(root,'runtime-data/distribution/pending',{protect:[m.contentId]});const cached=path.join(root,'runtime-data/distribution/pending',m.contentId+'.json.gz');if(fs.existsSync(cached)&&fs.lstatSync(cached).isSymbolicLink())throw Error('升级缓存文件不能是链接');if(fs.existsSync(cached)){try{const bundle=decodeRelease(fs.readFileSync(cached),channel.publicKey);if(bundle.manifest.contentId===m.contentId){pruneUpdateArchives(root,'runtime-data/distribution/pending',{protect:[m.contentId]});return {file:cached,bundle,reused:true};}}catch{}}const response=await fetch(channel.masterUrl+'/releases/'+m.contentId+'.json.gz',{signal:AbortSignal.timeout(60000)});if(!response.ok)throw Error('升级包下载失败：'+response.status);const bytes=Buffer.from(await response.arrayBuffer()),bundle=decodeRelease(bytes,channel.publicKey);if(bundle.manifest.contentId!==m.contentId)throw Error('下载版本与发布版本不一致');const file=path.join(root,'runtime-data/distribution/pending',m.contentId+'.json.gz');fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,bytes);try{pruneUpdateArchives(root,'runtime-data/distribution/pending',{protect:[m.contentId]});}catch{}return {file,bundle};
}

// On the first launch of the new updater, remove successful legacy peer backups too.
export function finalizeInstalledUpdate(root){
 const installedFile=path.join(root,'runtime-data/distribution/installed.local.json'),transactions=path.join(root,'runtime-data/distribution/backups');
 if(!fs.existsSync(installedFile)||!fs.existsSync(transactions))return null;
 const installed=JSON.parse(fs.readFileSync(installedFile));if(installed.format!=='comic-code-update-v1'||!Array.isArray(installed.files))return null;
 if(isPrimaryUpdateHost(root))return null; // Master backups must be created before replacement.
 const hasSuccessful=fs.readdirSync(transactions,{withFileTypes:true}).some(item=>{if(!item.isDirectory()||item.isSymbolicLink())return false;try{return JSON.parse(fs.readFileSync(path.join(transactions,item.name,'journal.json'))).status==='applied';}catch{return false;}});
 if(!hasSuccessful)return null;
 const cleanup=cleanupInstalledUpdate(root,{version:installed.version,contentId:installed.contentId});writeJson(path.join(root,'runtime-data/distribution/cleanup.local.json'),cleanup);return cleanup;
}

export function applyRelease(root,bundle,options={}){return localExtensions?localExtensions.applyManagedRelease(root,bundle,options,{apply:applyReleaseUnmanaged,restore:restoreBackupUnmanaged}):applyReleaseUnmanaged(root,bundle,options);}
export function restoreBackup(root,backup){return localExtensions?localExtensions.restoreManagedBackup(root,backup,restoreBackupUnmanaged):restoreBackupUnmanaged(root,backup);}

export function recoverLocalExtensions(root){return localExtensions?.recoverManagedUpdate(root)??null;}
export function localExtensionsStatus(root){return localExtensions?.managedExtensionStatus(root)??{enabled:false};}
