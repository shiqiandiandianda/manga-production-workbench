import fs from 'node:fs';
import path from 'node:path';
import {allowedCodePath,collectCode,digest} from './code-policy.mjs';

// Cleanup is confined to managed update storage; links and unknown files are retained.
function directory(root,relative){
 const base=path.resolve(root),target=path.resolve(base,relative);
 if(!target.startsWith(base+path.sep))throw Error('更新清理路径越界');
 let current=base;for(const part of path.relative(base,target).split(path.sep)){current=path.join(current,part);try{if(fs.lstatSync(current).isSymbolicLink())throw Error('更新清理路径不能是链接');}catch(e){if(e.code!=='ENOENT')throw e;}}
 return target;
}
const isArchive=name=>/^[a-f0-9]{64}\.json\.gz$/.test(name);
export function pruneUpdateArchives(root,relative,{keep=3,protect=[]}={}){
 if(!/^runtime-data\/distribution\/(pending|master\/releases|master\/releases-by-port\/\d+)$/.test(relative))throw Error('不是受管的版本包目录');
 const dir=directory(root,relative),result={removed:0,bytes:0};if(!fs.existsSync(dir))return result;
 const items=fs.readdirSync(dir).filter(isArchive).map(name=>({name,stat:fs.lstatSync(path.join(dir,name))})).filter(item=>item.stat.isFile()&&!item.stat.isSymbolicLink()).sort((a,b)=>b.stat.mtimeMs-a.stat.mtimeMs),retained=new Set(protect.filter(id=>/^[a-f0-9]{64}$/.test(id)).map(id=>id+'.json.gz'));
 for(const item of items)if(retained.size<keep)retained.add(item.name);
 for(const item of items)if(!retained.has(item.name)){fs.unlinkSync(path.join(dir,item.name));result.removed++;result.bytes+=item.stat.size;}
 return result;
}
function backupContents(dir,journal){
 if(!Array.isArray(journal.files)||journal.files.some(row=>!allowedCodePath(row.path)||typeof row.existed!=='boolean'))return null;
 const known=new Set(['journal.json',...journal.files.filter(row=>row.existed).map(row=>'files/'+row.path)]),files=[],dirs=[];
 function walk(current,prefix=''){for(const item of fs.readdirSync(current,{withFileTypes:true})){if(item.isSymbolicLink())return false;const relative=prefix+item.name,full=path.join(current,item.name);if(item.isDirectory()){if(!walk(full,relative+'/'))return false;dirs.push(full);}else if(item.isFile()&&known.has(relative))files.push(full);else return false;}return true;}
 return walk(dir)?{files,dirs}:null;
}
export function pruneUpdateBackups(root,{keep=0,protectVersion}={}){
 const base=directory(root,'runtime-data/distribution/backups'),result={removed:0,bytes:0,retainedUnknown:0};if(!fs.existsSync(base))return result;
 const items=[];for(const item of fs.readdirSync(base,{withFileTypes:true})){
  if(!item.isDirectory()||item.isSymbolicLink())continue;const dir=directory(root,'runtime-data/distribution/backups/'+item.name),file=path.join(dir,'journal.json');
  try{const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink())continue;const journal=JSON.parse(fs.readFileSync(file));if(journal.status!=='applied'||journal.version!==item.name)continue;const contents=backupContents(dir,journal);if(!contents){result.retainedUnknown++;continue;}items.push({dir,name:item.name,stamp:stat.mtimeMs,...contents});}catch{result.retainedUnknown++;}
 }
 items.sort((a,b)=>b.stamp-a.stamp);const retained=new Set(items.filter(item=>item.name===protectVersion).map(item=>item.name));for(const item of items)if(retained.size<keep)retained.add(item.name);
 for(const item of items)if(!retained.has(item.name)){
  // Every file was checked against this backup's code-only journal above.
  for(const file of item.files){result.bytes+=fs.statSync(file).size;fs.unlinkSync(file);}for(const dir of item.dirs)fs.rmdirSync(dir);fs.rmdirSync(item.dir);result.removed++;
 }
 return result;
}
export function removeEmptyCodeDirectories(root,removed){
 let count=0;for(const name of removed){if(!allowedCodePath(name))continue;const parts=name.split('/');if(parts.length<2)continue;let dir=path.dirname(path.join(root,...parts)),component=path.join(path.resolve(root),parts[0]);
  while(path.resolve(dir)!==component&&path.resolve(dir).startsWith(component+path.sep)){const target=directory(root,path.relative(root,dir));try{if(fs.readdirSync(target).length)break;fs.rmdirSync(target);count++;}catch{break;}dir=path.dirname(dir);}
 }return count;
}
export function cleanupInstalledUpdate(root,{version,contentId,removed=[]}){
 const result={version,at:new Date().toISOString(),retention:{sourceBackups:isPrimaryUpdateHost(root)?5:0,archives:3},removedCodeFiles:removed.length,emptyCodeDirectories:0,backupsRemoved:0,archivesRemoved:0,bytesFreed:0,warnings:[]};
 try{result.emptyCodeDirectories=removeEmptyCodeDirectories(root,removed);}catch{result.warnings.push('部分空代码目录待下次清理');}
 try{const r=pruneUpdateBackups(root,{keep:0});result.backupsRemoved=r.removed;result.bytesFreed+=r.bytes;if(r.retainedUnknown)result.warnings.push('含未登记文件的备份已保留');}catch{result.warnings.push('部分旧回滚备份待下次清理');}
 try{if(isPrimaryUpdateHost(root)){const r=pruneSourceBackups(root);result.sourceBackupsRemoved=r.removed;result.bytesFreed+=r.bytes;}}catch{result.warnings.push('部分旧源码备份待下次清理');}
 try{const r=pruneUpdateArchives(root,'runtime-data/distribution/pending',{protect:[contentId]});result.archivesRemoved=r.removed;result.bytesFreed+=r.bytes;}catch{result.warnings.push('部分旧下载包待下次清理');}
 return result;
}

export function isPrimaryUpdateHost(root){
 const file=path.join(root,'runtime-data/distribution/master/master.local.json');try{const identity=JSON.parse(fs.readFileSync(file));return !!(identity.privateKey&&identity.publicKey);}catch{return false;}
}
const sourcePath=name=>allowedCodePath(name)||name.startsWith('distribution/portable/')&&allowedCodePath(name.slice('distribution/portable/'.length));
export function backupPrimarySource(root,installed){
 if(!isPrimaryUpdateHost(root))return null;
 const version=installed?.version||'首次升级前',label=version.replace(/[^a-zA-Z0-9 ._-]/g,'_')+'-'+(installed?.contentId?.slice(0,12)||'unversioned'),dir=directory(root,'runtime-data/distribution/source-backups/'+label),index=path.join(dir,'snapshot.json');
 if(fs.existsSync(index)){const prior=JSON.parse(fs.readFileSync(index));if(prior.format!=='comic-source-backup-v1'||prior.contentId!==installed?.contentId)throw Error('源码备份目录已存在其他内容，未覆盖');return {directory:dir,version,reused:true};}
 const files=collectCode(root),portable=path.join(root,'distribution/portable');
 // A source backup includes the actual root launchers and their portable source copies.
 for(const entry of fs.readdirSync(root,{withFileTypes:true}))if(entry.isFile()&&allowedCodePath(entry.name))files.set(entry.name,fs.readFileSync(path.join(root,entry.name)));
 if(fs.existsSync(portable))for(const entry of fs.readdirSync(portable,{withFileTypes:true}))if(entry.isFile()&&allowedCodePath(entry.name))files.set('distribution/portable/'+entry.name,fs.readFileSync(path.join(portable,entry.name)));
 const records=[];for(const [name,bytes]of files){if(!sourcePath(name))throw Error('源码备份出现非代码路径');const target=path.join(dir,'files',...name.split('/'));fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,bytes);records.push({path:name,bytes:bytes.length,sha256:digest(bytes)});}
 const snapshot={format:'comic-source-backup-v1',version,contentId:installed?.contentId,createdAt:new Date().toISOString(),files:records};fs.writeFileSync(index,JSON.stringify(snapshot,null,2));return {directory:dir,version,files:records.length};
}
export function pruneSourceBackups(root,{keep=5}={}){
 const base=directory(root,'runtime-data/distribution/source-backups'),items=[],result={removed:0,bytes:0};if(!fs.existsSync(base))return result;
 for(const entry of fs.readdirSync(base,{withFileTypes:true})){if(!entry.isDirectory()||entry.isSymbolicLink())continue;const dir=directory(root,'runtime-data/distribution/source-backups/'+entry.name),index=path.join(dir,'snapshot.json');try{const meta=fs.lstatSync(index);if(!meta.isFile()||meta.isSymbolicLink())continue;const snapshot=JSON.parse(fs.readFileSync(index));if(snapshot.format!=='comic-source-backup-v1'||!Array.isArray(snapshot.files)||snapshot.files.some(row=>!sourcePath(row.path)))continue;
 const known=new Set(['snapshot.json',...snapshot.files.map(row=>'files/'+row.path)]),files=[],dirs=[];
 const walk=current=>{for(const item of fs.readdirSync(current,{withFileTypes:true})){const file=path.join(current,item.name),relative=path.relative(dir,file).split(path.sep).join('/');if(item.isSymbolicLink())return false;if(item.isDirectory()){if(!walk(file))return false;dirs.push(file);}else if(item.isFile()&&known.has(relative)){if(relative!=='snapshot.json'){const record=snapshot.files.find(row=>'files/'+row.path===relative);if(!record||digest(fs.readFileSync(file))!==record.sha256)return false;}files.push(file);}else return false;}return true;};
 if(walk(dir))items.push({dir,files,dirs,stamp:meta.mtimeMs});}catch{}}
 items.sort((a,b)=>b.stamp-a.stamp);for(const item of items.slice(keep)){for(const file of item.files){result.bytes+=fs.statSync(file).size;fs.unlinkSync(file);}for(const dir of item.dirs)fs.rmdirSync(dir);fs.rmdirSync(item.dir);result.removed++;}return result;
}
