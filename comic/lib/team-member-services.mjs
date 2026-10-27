import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {memberName} from '../public/team-member-name.js';
import {readMemberProfile,saveMemberProfile} from './member-profile.mjs';
import {localPrimaryChannel} from '../../distribution/primary-channel.mjs';

export function createTeamMemberProxy({root,dataDir,library,body,json,channelFile=process.env.COMIC_TEAM_CHANNEL_FILE||path.join(root,'../distribution/channel.json'),identityRoot=process.env.COMIC_TEAM_IDENTITY_ROOT||path.join(root,'..')}){
 const requests=new Set();
 function config(){
  const c=localPrimaryChannel(identityRoot,JSON.parse(fs.readFileSync(channelFile))),headers={'X-Team-Invitation':c.enrollmentCode};
  const identityFile=path.join(identityRoot,'runtime-data/team/identity.local.json'),primaryFile=path.join(identityRoot,'runtime-data/distribution/master/master.local.json');
  const primary=fs.existsSync(primaryFile)&&JSON.parse(fs.readFileSync(primaryFile)).publicKey===c.publicKey;
  if(!primary&&fs.existsSync(identityFile)&&fs.existsSync(path.join(identityRoot,'runtime-data/distribution/installed.local.json'))){const i=JSON.parse(fs.readFileSync(identityFile));headers['X-Team-Registration']=i.registrationKey;headers['X-Team-Machine']=encodeURIComponent(i.machineId);}
  return {base:c.masterUrl,headers};
 }
 async function identity(){
  let profile=readMemberProfile(dataDir);if(profile.name)return {...profile,machine:os.hostname(),source:'profile'};
  const account=await library.memberIdentity(),name=memberName(account.displayName||account.name||account.username,{confirmed:true});
  if(name)profile=saveMemberProfile(dataDir,name);
  return {...profile,machine:os.hostname(),source:name?'moku':'missing'};
 }
 async function request(route,method,input,extra={}){
  const c=config(),controller=new AbortController();requests.add(controller);
  try{const response=await fetch(c.base+'/api/team-members'+route,{method,headers:{...c.headers,...extra,...(input?{'Content-Type':'application/json'}:{})},body:input?JSON.stringify(input):undefined,signal:AbortSignal.any([controller.signal,AbortSignal.timeout(7000)])});
   const value=await response.json();if(!response.ok)throw Object.assign(Error(value.error||'成员服务暂时不可达'),{status:response.status});return value;
  }finally{requests.delete(controller);}
 }
 return {close(){for(const c of requests)c.abort();requests.clear();},async handle(req,res,url){
  if(!url.pathname.startsWith('/api/team-members/'))return false;
  const route=url.pathname.slice('/api/team-members'.length),method=req.method;
  if(route==='/identity'&&method==='GET'){json(res,200,await identity());return true;}
  if(route==='/profile'&&method==='POST'){
   const profile=saveMemberProfile(dataDir,(await body(req,16384)).name);let pending=false;
   try{await request('/profile','POST',profile);}catch{pending=true;}
   json(res,200,{ok:true,...profile,pending});return true;
  }
  if(/^\/members\/[^/]+\/name$/.test(route)&&method==='POST'){
   const input=method==='POST'?await body(req,16384):undefined,headers={'X-Dashboard-Control':req.headers['x-dashboard-control']||''};
   const result=await request(route+url.search,method,input,headers);json(res,200,result);return true;
  }
  json(res,404,{error:'成员服务接口不存在'});return true;
 }};
}
