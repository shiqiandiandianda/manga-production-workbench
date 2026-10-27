import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID,sign,verify} from 'node:crypto';
import {writeJson} from './updates.mjs';

const text=(v,n=240)=>typeof v==='string'?v.slice(0,n):'';
const phases=new Set(['received','downloading','waiting','stopping','applying','restarting','completed','failed']);
const terminal=new Set(['completed','superseded']);
const fail=(ok,message,status=400)=>{if(!ok)throw Object.assign(Error(message),{status});};
export const upgradeMemberId=identity=>createHash('sha256').update(identity.machineId+':'+identity.registrationKey).digest('hex').slice(0,16);
export function verifyUpgradeCommand(envelope,{publicKey,memberId}){
 const c=envelope?.command;fail(c?.format==='comic-force-upgrade-v1'&&c.action==='force-upgrade'&&c.memberId===memberId,'主机升级指令身份不匹配');
 fail(typeof c.id==='string'&&/^[\w-]{8,100}$/.test(c.id)&&/^[a-f0-9]{64}$/.test(c.contentId||'')&&/^\d{4}-\d{2}-\d{2} V\d+$/.test(c.version||'')&&typeof c.stopTasks==='boolean','主机升级指令格式无效');
 fail(verify(null,Buffer.from(JSON.stringify(c)),publicKey,Buffer.from(envelope.signature||'','base64')),'主机升级指令签名无效',403);return c;
}

/** Durable administrative intent, delivered only to the authenticated installation. */
export function createForcedUpgrades({dataDir,privateKey,getLatest,getMembers,clock=()=>Date.now()}){
 const file=path.join(dataDir,'forced-upgrades.local.json');let state={version:1,campaigns:[]};
 if(fs.existsSync(file)){state=JSON.parse(fs.readFileSync(file));fail(state.version===1&&Array.isArray(state.campaigns),'团队升级记录损坏，请保留原记录后修复',503);}
 const save=()=>writeJson(file,state);
 async function start({requestId,author='主机管理员'}={}){
  fail(/^[\w-]{8,100}$/.test(requestId||''),'升级请求编号无效');const reused=state.campaigns.find(c=>c.requestId===requestId);if(reused)return view(reused);
  const latest=getLatest()?.manifest;fail(latest,'请先发布一个完整版本',409);const members=await getMembers(),primary=members.find(m=>m.id==='publisher');
  const targets=members.filter(m=>m.id!=='publisher'&&m.machine!==primary?.machine).map(m=>({memberId:m.id,name:m.name||m.machine,machine:m.machine,phase:'queued',message:'等待该电脑接收指令',updatedAt:clock(),delivered:null}));
  fail(targets.length,'当前没有已登记的同事电脑',409);
  for(const c of state.campaigns)for(const r of c.targets)if(!terminal.has(r.phase)){r.phase='superseded';r.message='已由新的主机升级指令接替';}
  const campaign={id:randomUUID(),requestId,author:text(author,80),version:latest.version,contentId:latest.contentId,policy:'when-idle',createdAt:clock(),targets};state.campaigns.push(campaign);
  state.campaigns=state.campaigns.slice(-20);save();return view(campaign);
 }
 async function view(campaign=state.campaigns.at(-1)){
  const members=await getMembers();if(!campaign)return {campaign:null,protocolVersion:2};
  const targets=campaign.targets.map(r=>{const m=members.find(m=>m.id===r.memberId),supported=m?.forcedUpgradeVersion>=2;let status=r.phase;
   if(!terminal.has(status)&&!['stopping','applying','restarting'].includes(status))status=m?.connection!=='online'?'offline':!supported?'unsupported':status;
   else if(!terminal.has(status)&&m?.connection!=='online'&&clock()-r.updatedAt>120000)status='uncertain';
   return {memberId:r.memberId,name:m?.name||r.name,machine:m?.machine||r.machine,status,phase:r.phase,supported,online:m?.connection==='online',currentVersion:m?.version||'',targetVersion:r.delivered?.version||campaign.version,message:status==='uncertain'?'尚未收到升级后的状态，请检查该电脑是否已启动工具':status==='offline'?'离线，启动工具后执行':status==='unsupported'?'旧版尚无远程升级接收器，需先在该电脑升级一次':r.message,updatedAt:r.updatedAt};});
  return {protocolVersion:2,campaign:{id:campaign.id,author:campaign.author,version:campaign.version,policy:'when-idle',createdAt:campaign.createdAt,targets,total:targets.length,waiting:targets.filter(t=>t.status==='waiting').length,completed:targets.filter(t=>t.phase==='completed').length}};
 }
 function heartbeat(memberId,input){
  let changed=false;const report=input.forcedUpgradeStatus;
  for(const c of state.campaigns){const target=c.targets.find(r=>r.memberId===memberId);if(!target||terminal.has(target.phase)||report?.commandId!==c.id||!phases.has(report.phase))continue;
   if(report.phase==='completed'&&(!target.delivered||input.contentId!==target.delivered.contentId||input.version!==target.delivered.version))continue;
   target.phase=report.phase;target.message=text(report.message);target.updatedAt=clock();changed=true;
  }
  const campaign=[...state.campaigns].reverse().find(c=>c.targets.some(r=>r.memberId===memberId&&!terminal.has(r.phase)));
  // Older receivers force-cancel jobs. Never send them a destructive fallback.
  if(changed)save();if(!campaign||input.forcedUpgradeVersion<2||!Number.isInteger(input.forcedUpgradeVersion))return null;
  const target=campaign.targets.find(r=>r.memberId===memberId),latest=getLatest()?.manifest;if(!latest)return null;
  // Keep a delivered version stable through application. Failed downloads may receive the newest signed release.
  if(!target.delivered||target.phase==='failed'){
   if(target.delivered?.contentId!==latest.contentId){target.delivered={version:latest.version,contentId:latest.contentId};save();}
  }
  const command={format:'comic-force-upgrade-v1',action:'force-upgrade',id:campaign.id,memberId,version:target.delivered.version,contentId:target.delivered.contentId,stopTasks:false,policy:'when-idle',issuedAt:clock()};
  return {command,signature:sign(null,Buffer.from(JSON.stringify(command)),privateKey).toString('base64')};
 }
 return {start,view,heartbeat};
}
