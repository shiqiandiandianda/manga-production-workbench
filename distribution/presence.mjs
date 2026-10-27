import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {createHash} from 'node:crypto';import {writeJson} from './updates.mjs';
export const PRESENCE_TIMEOUT=90000;
export function createPresence({file,clients,now=()=>Date.now()}){
 let records={};try{records=JSON.parse(fs.readFileSync(file));}catch{}
 function heartbeat(input){
  if(!/^[a-f0-9]{64}$/.test(input.registrationKey||'')||typeof input.machineId!=='string')throw Object.assign(Error('设备身份无效'),{status:403});
 const key=createHash('sha256').update(input.machineId+':'+input.registrationKey).digest('hex'),client=clients()[key];if(!client)throw Object.assign(Error('请先运行安装器接入团队'),{status:403});
 if(input.progressOnly)input={...records[key],...input};
  const text=(v,n)=>typeof v==='string'?v.slice(0,n):'';const generationTasks=(Array.isArray(input.generationTasks)?input.generationTasks:[]).slice(0,100).map(t=>({id:text(t.id,120),projectId:text(t.projectId,120),work:text(t.work,180),name:text(t.name,180),episode:Number.isInteger(t.episode)?t.episode:null,status:text(t.status,40),message:text(t.message,240),createdAt:text(t.createdAt,40)}));const item={name:text(input.name,80),nameSource:['profile','moku'].includes(input.nameSource)?input.nameSource:'',machine:text(input.machineId,100),version:text(input.version,100),contentId:/^[a-f0-9]{64}$/.test(input.contentId||'')?input.contentId:'',project:text(input.project,180),episode:text(String(input.episode||''),24),page:text(input.page,180),activity:text(input.activity,80),task:text(input.task,180),editorAlive:input.editorAlive===true,generationTasks,lastSeen:now()};item.forcedUpgradeVersion=Number.isInteger(input.forcedUpgradeVersion)?Math.max(0,Math.min(2,input.forcedUpgradeVersion)):0;records[key]=item;writeJson(file,records);return {ok:true,memberId:key.slice(0,16)};
 }
 function members(latest){return Object.entries(clients()).map(([key,c])=>{const p=records[key];return {id:key.slice(0,16),name:p?.name||'',nameSource:p?.nameSource||'',machine:p?.machine||c.name||'',version:p?.version||'',versionStatus:p?.contentId?(p.contentId===latest?'current':'outdated'):'unknown',project:p?.project||'',episode:p?.episode||'',page:p?.page||'',activity:p?.activity||'',task:p?.task||'',generationTasks:p?.generationTasks||[],forcedUpgradeVersion:p?.forcedUpgradeVersion||0,editorAlive:p?.editorAlive||false,lastSeen:p?.lastSeen||null,connection:p?(now()-p.lastSeen<PRESENCE_TIMEOUT?'online':'offline'):'unknown'};});}
 return {heartbeat,members};
}
export async function reportPresence(root,{masterUrl,comic,center,version,contentId,forcedUpgradeVersion=0,forcedUpgradeStatus=null,progressOnly=false}={}){
 const identityFile=path.join(root,'runtime-data/team/identity.local.json');if(!fs.existsSync(identityFile))return;
 const identity=JSON.parse(fs.readFileSync(identityFile));let context={};if(!progressOnly)try{const r=await fetch(comic+'/api/team-release/context',{signal:AbortSignal.timeout(2000)});if(r.ok)context=await r.json();}catch{}
 if(center&&!progressOnly)try{for(const status of ['running','queued']){const r=await fetch(center+'/api/lan/v1/jobs?status='+status+'&limit=1',{signal:AbortSignal.timeout(2000)});if(!r.ok)break;const job=(await r.json()).jobs?.[0];if(job){context.project||=job.project||'';context.activity=status==='running'?'正在生成资产':'资产生成排队';context.task=[job.project,job.message].filter(Boolean).join(' · ').slice(0,180);break;}}}catch{}
 const r=await fetch(masterUrl+'/api/team/heartbeat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...identity,...context,...(!progressOnly&&identity.instanceLabel?{name:(context.name||identity.machineId)+' · '+identity.instanceLabel,nameSource:context.nameSource||'profile'}:{}),version,contentId,forcedUpgradeVersion,forcedUpgradeStatus,progressOnly}),signal:AbortSignal.timeout(5000)});if(!r.ok)throw Error('团队状态上报失败：'+r.status);return r.json();
}
export const machineName=()=>os.hostname();
