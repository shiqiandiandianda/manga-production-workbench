import fs from 'node:fs';import path from 'node:path';
import {collectCode,digest} from './code-policy.mjs';
import {validateEnvelope,writeJson} from './updates.mjs';
import {backupPrimarySource,cleanupInstalledUpdate} from './update-cleanup.mjs';
import {isPrimaryInstallation} from './master-startup.mjs';
/** The primary activates its own source; a peer release can never replace primary files. */
export function primaryReleaseState(root,manifest){
 const files=collectCode(root),incoming=new Map((manifest?.files||[]).map(r=>[r.path,r.sha256]));
 const differences=[...new Set([...files.keys(),...incoming.keys()])].filter(name=>!files.has(name)||digest(files.get(name))!==incoming.get(name));
 return {matches:!!manifest&&!differences.length,differences:differences.slice(0,20)};
}
export function activatePrimaryRelease(root,envelope){
 if(!isPrimaryInstallation(root))throw Error('此电脑没有主机发布身份');
 const identity=JSON.parse(fs.readFileSync(path.join(root,'runtime-data/distribution/master/master.local.json'))),manifest=validateEnvelope(envelope,identity.publicKey),source=primaryReleaseState(root,manifest);
 if(!source.matches)throw Error('主机源码与已发布版本尚未合并，已保留主机代码：'+source.differences.join('、'));
 const file=path.join(root,'runtime-data/distribution/installed.local.json'),old=fs.existsSync(file)?JSON.parse(fs.readFileSync(file)):null;
 const backup=old?.contentId!==manifest.contentId?backupPrimarySource(root,manifest):null;
 writeJson(file,manifest);writeJson(path.join(root,'runtime-data/distribution/active-primary.local.json'),{role:'publisher',root:path.resolve(root),version:manifest.version,contentId:manifest.contentId,activatedAt:new Date().toISOString()});
 const cleanup=cleanupInstalledUpdate(root,{version:manifest.version,contentId:manifest.contentId});writeJson(path.join(root,'runtime-data/distribution/cleanup.local.json'),cleanup);
 return {version:manifest.version,changed:0,primary:true,backup:backup?.directory||null,cleanup};
}
