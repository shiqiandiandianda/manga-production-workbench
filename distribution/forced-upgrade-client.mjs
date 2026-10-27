import fs from 'node:fs';
import path from 'node:path';
import {parsedReleaseVersion} from '../comic/public/team-version.js';
import {stageUpdate,applyRelease,writeJson} from './updates.mjs';
import {isPrimaryInstallation} from './master-startup.mjs';
import {upgradeMemberId,verifyUpgradeCommand} from './forced-upgrades.mjs';

const read=file=>{try{return JSON.parse(fs.readFileSync(file));}catch(e){if(e.code==='ENOENT')return null;throw e;}};
const newer=(a,b)=>{a=parsedReleaseVersion(a);b=parsedReleaseVersion(b);return a&&b&&(a.day>b.day||a.day===b.day&&a.sequence>b.sequence);};
/** A signed fixed operation; no shell text or arbitrary URL is accepted from the server. */
export function createForcedUpgradeReceiver({root,channel,stop,restart,readiness=async()=>({allowed:false}),recover=async()=>{},report=async()=>{},request=fetch,clock=()=>Date.now()}){
 const file=path.join(root,'runtime-data/distribution/forced-upgrade.local.json'),installedFile=path.join(root,'runtime-data/distribution/installed.local.json');
 let state=read(file),running=null;const primary=isPrimaryInstallation(root);
 const status=()=>state?{commandId:state.commandId,phase:state.phase,message:state.message||'',targetVersion:state.version}:null;
 const progress=async(phase,message,extra={})=>{state={...state,...extra,phase,message,updatedAt:clock()};writeJson(file,state);await report(status()).catch(()=>{});};
 async function execute(command){
  let stopped=false;
  try{
   state={commandId:command.id,version:command.version,contentId:command.contentId,phase:'received',failures:state?.commandId===command.id?state.failures||0:0};await progress('received','已收到主机升级安排，按本机任务状态独立执行');
   const installed=read(installedFile);
   if(installed?.contentId===command.contentId){await progress('completed','本机已是目标版本');return;}
   if(newer(installed?.version,command.version)){await progress('failed','本机版本更新，已拒绝降级',{retryAt:clock()+86400000});return;}
   await progress('downloading','正在下载并核验主机签名代码包');
   const response=await request(channel.masterUrl+'/api/releases/latest',{signal:AbortSignal.timeout(10000)});if(!response.ok)throw Error('暂时无法读取主版本');
   const envelope=await response.json();if(envelope.manifest?.contentId!==command.contentId)throw Error('主机版本已更新，等待重新核对升级指令');
   const staged=await stageUpdate(root,channel,envelope); // Signature, path, length and file digests are verified before any stop.
   const local=await readiness();
   if(!local.allowed){await progress('waiting','本机任务尚未结束或状态待确认，保留任务继续执行；结束后自动升级，其他同事照常升级。');return;}
   await progress('stopping','本机已空闲，正在安全关闭本机服务');stopped=true;await stop();
   await progress('applying','正在替换代码并清理已淘汰文件');const result=applyRelease(root,staged.bundle);
   await progress('restarting','代码已更新，正在重新启动工具');await restart(result);
  }catch(error){
   if(error.code==='upgrade_blocked')await progress('waiting','本机又有任务开始，已暂缓升级；任务结束后自动继续。');
   else await progress('failed',String(error.message).slice(0,240),{failures:(state?.failures||0)+1,retryAt:clock()+Math.min(300000,15000*2**Math.min(state?.failures||0,4))});
   if(stopped)await recover().catch(()=>{});
  }
 }
 function accept(envelope){
  if(!envelope||primary)return null;const identity=read(path.join(root,'runtime-data/team/identity.local.json'));if(!identity)return null;
  const command=verifyUpgradeCommand(envelope,{publicKey:channel.publicKey,memberId:upgradeMemberId(identity)});
  if(running)return running;if(state?.commandId===command.id&&state.contentId===command.contentId&&(state.phase==='completed'||state.retryAt>clock()))return null;
  running=execute(command).finally(()=>{running=null;});return running;
 }
 async function confirmRestart(){
  if(!state||primary)return;const installed=read(installedFile);
  if(['restarting','applying'].includes(state.phase)&&installed?.contentId===state.contentId)await progress('completed','新版工具已重新启动并上报安装版本');
 }
 return {accept,status,confirmRestart,get primary(){return primary;},get running(){return !!running;}};
}
