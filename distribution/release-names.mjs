import fs from 'node:fs';import path from 'node:path';import {gunzipSync} from 'node:zlib';
import {writeJson} from './updates.mjs';
import {releaseDay,parsedReleaseVersion,displayReleaseVersion} from '../comic/public/team-version.js';
/** Friendly labels for signed legacy releases; technical identities stay intact. */
export function createReleaseNames(directory,{legacyDirectory,initial=[]}={}){
 const file=path.join(directory,'version-labels.local.json');let labels={};try{labels=JSON.parse(fs.readFileSync(file));}catch{}
 const highest=day=>Object.values(labels).map(parsedReleaseVersion).filter(p=>p?.day===day).reduce((n,p)=>Math.max(n,p.sequence),0);
 function remember(manifest){if(!manifest?.version)return '';if(labels[manifest.version])return labels[manifest.version];const parsed=parsedReleaseVersion(manifest.version),day=releaseDay(manifest.createdAt);labels[manifest.version]=parsed?manifest.version:day+' V'+String(highest(day)+1).padStart(2,'0');return labels[manifest.version];}
 if(!Object.keys(labels).length){const manifests=[...initial];for(const dir of new Set([directory,legacyDirectory].filter(Boolean)))if(fs.existsSync(dir))for(const name of fs.readdirSync(dir).filter(n=>/^[a-f0-9]{64}\.json\.gz$/.test(n))){try{manifests.push(JSON.parse(gunzipSync(fs.readFileSync(path.join(dir,name)),{maxOutputLength:128*1024*1024})).manifest);}catch{}}
  for(const m of manifests.filter(m=>m?.createdAt&&m?.version).sort((a,b)=>a.createdAt.localeCompare(b.createdAt)))remember(m);
 }
 fs.mkdirSync(directory,{recursive:true});writeJson(file,labels);
 return {label:value=>labels[value]||displayReleaseVersion(value),previous(now){const day=releaseDay(now);return day+' V'+String(highest(day)).padStart(2,'0');},remember(manifest){const value=remember(manifest);writeJson(file,labels);return value;}};
}
