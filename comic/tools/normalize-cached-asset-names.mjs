import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {canonicalAssetNaming} from '../public/asset-naming.js';
const args=process.argv.slice(2),value=flag=>{const at=args.indexOf(flag),input=at<0?'':args[at+1];if(!input||input.startsWith('--')||!path.isAbsolute(input))throw Error(flag+' requires an absolute path');return input;};
const dataDir=path.resolve(value('--data-root')),snapshotFile=path.resolve(value('--snapshot')),backupDir=path.resolve(value('--backup-root')),apply=args.includes('--apply');
const snapshot=JSON.parse(fs.readFileSync(snapshotFile,'utf8'));
if(snapshot.errors.length||snapshot.projects.some(p=>!p.complete))throw Error('资产目录不完整');
const session=JSON.parse(fs.readFileSync(path.join(dataDir,'library-session.local.json'),'utf8')),base=String(session.base||session.baseUrl||'').replace(/\/$/,'');
const file=path.join(dataDir,'studio.json'),original=fs.readFileSync(file),db=JSON.parse(original),entries=new Map(),changes=[],skipped=[];
for(const p of snapshot.projects){const subjects=new Map(p.subjects.map(s=>[s.id,s]));for(const a of p.assets)entries.set(p.id+':'+a.id,{p,a,subject:subjects.get(a.objectId||a.characterIds?.[0]||a.sceneIds?.[0])});}
const protectedIds=db.assets.map(a=>[a.id,a.filePath,a.library?.assetId,a.library?.revisionId,a.library?.sha256]),outsideAssets=JSON.stringify({...db,assets:undefined});
for(const asset of db.assets){
 const lib=asset.library,entry=lib&&entries.get(lib.projectId+':'+lib.assetId);
 if(!entry||String(lib.baseUrl||'').replace(/\/$/,'')!==base||!['character','scene','prop','pet'].includes(entry.a.assetType)||!entry.subject||!lib.revisionId||!/^[a-f0-9]{64}$/i.test(lib.sha256||''))continue;
 const {p,a,subject}=entry,variant=lib.canonicalVariantName??lib.outfitName??asset.libraryState??a.variantName;
 if(!lib.outfitName&&!asset.libraryState&&a.displayRevisionId!==lib.revisionId&&a.recommendedRevisionId!==lib.revisionId){skipped.push({assetId:asset.id,reason:'保留非推荐历史版本的原名称，缺少当时变体元数据'});continue;}
 const named=canonicalAssetNaming({role:a.assetType,workName:p.name,objectName:lib.characterName||subject.name,variantName:variant,name:lib.sourceName||asset.name});
 if(!named.subjectName)continue;
 const current=canonicalAssetNaming({role:a.assetType,workName:p.name,objectName:subject.name,variantName:a.variantName,name:a.name});
 if(named.subjectName!==current.subjectName||named.variantName!==current.variantName||named.variantName.includes(named.subjectName)||named.variantName.length>40){skipped.push({assetId:asset.id,reason:'历史命名或变体与目录不一致，保留原名称待核对'});continue;}
 const oldName=asset.name,extension=String(oldName).match(/\.(png|jpe?g|webp|avif)$/i)?.[0]||'',before=JSON.stringify(asset),sourceName=lib.sourceName||oldName;
 Object.assign(lib,{sourceName,projectName:p.name,subjectName:named.subjectName,canonicalName:named.identityName,canonicalVariantName:named.variantName,namingVersion:named.namingVersion,...(a.assetType==='character'?{characterName:named.subjectName,outfitName:named.variantName}:a.assetType==='scene'?{sceneName:named.identityName}:a.assetType==='prop'?{propName:named.subjectName}:{})});
 asset.name=named.displayName+extension;
 if(JSON.stringify(asset)!==before)changes.push({assetId:asset.id,cloudAssetId:lib.assetId,revisionId:lib.revisionId,sha256:lib.sha256,oldName,newName:asset.name});
}
if(JSON.stringify(protectedIds)!==JSON.stringify(db.assets.map(a=>[a.id,a.filePath,a.library?.assetId,a.library?.revisionId,a.library?.sha256]))||JSON.stringify({...db,assets:undefined})!==outsideAssets)throw Error('名称迁移触及了受保护的数据');
fs.mkdirSync(backupDir,{recursive:true});
if(apply){
 let online=false;try{const response=await fetch('http://127.0.0.1:18909/api/health',{signal:AbortSignal.timeout(1200)});online=response.ok;}catch{}
 if(online)throw Error('漫画服务仍在运行，不能离线改写资产索引');
 const backup=path.join(backupDir,'studio.before-name-normalization.json');if(fs.existsSync(backup))throw Error('备份已存在，不覆盖首次备份');
 fs.writeFileSync(backup,original);
 const current=fs.readFileSync(file);if(!current.equals(original))throw Error('资产索引刚有变化，未执行迁移');
 const temp=file+'.asset-naming.tmp';fs.writeFileSync(temp,JSON.stringify(db));fs.renameSync(temp,file);
}
const report={applied:apply,remoteWrites:0,changed:changes.length,skipped:skipped.length,changes,skippedItems:skipped,protectedIdentityFieldsUnchanged:true,otherStudioFieldsUnchanged:true,beforeSha256:createHash('sha256').update(original).digest('hex')};
fs.writeFileSync(path.join(backupDir,apply?'cached-name-migration.json':'cached-name-preview.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({applied:apply,changed:changes.length,skipped:skipped.length,protectedIdentityFieldsUnchanged:true,remoteWrites:0}));
