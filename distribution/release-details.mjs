import path from 'node:path';
import {digest} from './code-policy.mjs';

/** Explain only files actually changed in this signed release. */
export function sourceReleaseDetails(files,previous=[]){
 const old=new Map(previous.map(r=>[r.path,r.sha256])),changed=[...files].filter(([name,bytes])=>old.get(name)!==digest(bytes)).map(([name])=>name),removed=[...old.keys()].filter(name=>!files.has(name));
 let entries=[];try{entries=JSON.parse(files.get('distribution/release-notes.json')?.toString()||'{}').changes||[];}catch{}
 const all=[...changed,...removed],notes=[];
 for(const entry of entries)if(typeof entry.text==='string'&&Array.isArray(entry.files)&&entry.files.some(name=>all.includes(name)))notes.push(entry.text);
 const covered=new Set(entries.filter(e=>notes.includes(e.text)).flatMap(e=>e.files));
 const remainder=all.filter(name=>!covered.has(name)&&name!=='distribution/release-notes.json');
 if(remainder.length){const tests=remainder.filter(name=>/\/tests\//.test(name)),code=remainder.filter(name=>!tests.includes(name));if(tests.length)notes.push('更新 '+tests.length+' 项回归验证。');if(code.length)notes.push('其他代码调整：'+code.slice(0,5).map(name=>path.posix.basename(name)).join('、')+(code.length>5?'等 '+code.length+' 个文件':'')+'。');}
 if(!notes.length)notes.push(previous.length?'更新发布说明。':'首次发布漫画制作工作台。');
 return {note:notes.join('\n').slice(0,1000),changeSummary:{added:changed.filter(n=>!old.has(n)).length,modified:changed.filter(n=>old.has(n)).length,removed:removed.length,files:all}};
}

export function releaseDetails(manifest){
 if(!manifest)return null;
 return {version:manifest.version,author:manifest.author||null,createdAt:manifest.createdAt||null,notes:manifest.releaseNotes||'',changes:manifest.changeSummary||null};
}

export function pendingReleaseDetails(manifest,installedId){
 if(!manifest||manifest.contentId===installedId)return [];
 const records=[manifest,...(manifest.previousReleases||[])],index=records.findIndex(m=>m.contentId===installedId);
 return (index<0?records:records.slice(0,index)).map(releaseDetails);
}
