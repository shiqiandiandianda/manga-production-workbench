import fs from 'node:fs';
import path from 'node:path';
import {writeFileAtomicSync} from './durable-files.mjs';
import {memberName} from '../public/team-member-name.js';

export function readMemberProfile(dataDir){
 for(const relative of ['member-profile.local.json','teamwork/local.json'])try{
  const value=JSON.parse(fs.readFileSync(path.join(dataDir,relative),'utf8'));
  const name=memberName((value.profile||value).name,{confirmed:true});
  if(name)return {name};
 }catch{}
 return {name:''};
}
export function saveMemberProfile(dataDir,value){
 const name=memberName(value,{confirmed:true});
 if(!name)throw Object.assign(Error('请填写成员姓名或常用名字，不能使用电脑编号'),{status:400});
 const profile={name};writeFileAtomicSync(path.join(dataDir,'member-profile.local.json'),JSON.stringify(profile));return profile;
}
