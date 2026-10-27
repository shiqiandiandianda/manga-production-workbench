import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import {localPrimaryChannel} from './primary-channel.mjs';
export function createAssetGenerationClient({root,channelFile=process.env.COMIC_TEAM_CHANNEL_FILE||path.join(root,'distribution/channel.json'),identityRoot=process.env.COMIC_TEAM_IDENTITY_ROOT||root}={}){
 const enabled=fs.existsSync(channelFile);
 async function call(action,input){
  let channel;try{channel=localPrimaryChannel(identityRoot,JSON.parse(fs.readFileSync(channelFile)));}catch{throw Error('无法读取团队中心配置，已停止资产生成，请恢复团队连接');}
  const headers={'Content-Type':'application/json','X-Team-Invitation':channel.enrollmentCode},identity=path.join(identityRoot,'runtime-data/team/identity.local.json');
  if(fs.existsSync(identity)&&fs.existsSync(path.join(identityRoot,'runtime-data/distribution/installed.local.json'))){const i=JSON.parse(fs.readFileSync(identity));headers['X-Team-Registration']=i.registrationKey;headers['X-Team-Machine']=encodeURIComponent(i.machineId);}
  let response,value;try{response=await fetch(channel.masterUrl+'/api/team-asset-generations/'+action,{method:'POST',headers,body:JSON.stringify({...input,machine:os.hostname()}),signal:AbortSignal.timeout(6000)});value=await response.json();}catch{throw Object.assign(Error('团队中心暂不可达，无法核验谁正在生成；已停止新任务，未离线重复生成。'),{status:503,code:'asset_generation_center_unavailable'});}
  if(!response.ok)throw Object.assign(Error(value.error||'资产占用核验失败'),{status:response.status,code:value.code,occupied:value.occupied});return value;
 }
 return {enabled,status:()=>call('status',{}),claim:input=>call('claim',input),heartbeat:(claim,input={})=>call('heartbeat',{id:claim.id,token:claim.token,...input}),finish:(claim,input)=>call('finish',{id:claim.id,token:claim.token,...input})};
}
