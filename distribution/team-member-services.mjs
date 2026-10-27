import {createAssetCorrections} from './asset-corrections.mjs';
import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';import {writeJson} from './updates.mjs';import {memberName} from '../comic/public/team-member-name.js';
const fail=(ok,message,status=400)=>{if(!ok)throw Object.assign(Error(message),{status});};
const read=(file,fallback)=>{try{return JSON.parse(fs.readFileSync(file));}catch{return fallback;}};
export function createMemberDirectory(file){
 const saved=read(file,{});
 return {resolve(rows){return rows.map(row=>{const name=saved[row.id]?.name||memberName(row.name,{machine:row.machine,confirmed:['profile','moku'].includes(row.nameSource)});return {...row,name,needsName:!name};});},set(id,value){const name=memberName(value,{confirmed:true});fail(name,'请填写成员姓名或常用名字，不能使用电脑编号');saved[id]={name,updatedAt:Date.now()};writeJson(file,saved);return name;}};
}
export function createTeamMemberServices({dataDir,clients,invitation,ownMachine,equal,controlNonce,getMembers,directory,clock=()=>Date.now()}){
 const corrections=createAssetCorrections({dataDir,clock});
 function authenticate(req){
  fail(!req.headers.origin||req.method==='GET'||req.headers.origin==='http://'+req.headers.host,'请通过自己的工具访问成员服务',403);const key=req.headers['x-team-registration'],machine=decodeURIComponent(req.headers['x-team-machine']||'');
  if(key){fail(/^[a-f0-9]{64}$/.test(key),'设备身份无效',403);const id=createHash('sha256').update(machine+':'+key).digest('hex');fail(clients()[id],'设备尚未接入团队',403);return id.slice(0,16);}
  const port=/:(\d+)$/.exec(req.headers.host||'')?.[1]||'80',cookie=String(req.headers.cookie||'').split(';').map(v=>v.trim()).find(v=>v.startsWith('comic_team_owner_'+port+'='))?.split('=').slice(1).join('=');fail(ownMachine(req)&&(equal(req.headers['x-team-invitation'],invitation)||equal(cookie,controlNonce)||equal(req.headers['x-dashboard-control'],controlNonce)),'请从已接入团队的工具访问成员服务',403);return 'publisher';
 }
 async function jsonBody(req,limit=16384){let bytes=0,parts=[];for await(const b of req){bytes+=b.length;fail(bytes<=limit,'请求过大',413);parts.push(b);}try{return JSON.parse(Buffer.concat(parts).toString()||'{}');}catch{throw Object.assign(Error('请求格式错误'),{status:400});}}
 const send=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));};

 return {authenticate,async handle(req,res,url){
  if(!url.pathname.startsWith('/api/team-members/'))return false;
  const actor=authenticate(req),route=url.pathname.slice('/api/team-members'.length),method=req.method;
  const who=async()=>{const self=(await getMembers()).find(m=>m.id===actor);fail(self,'成员不存在',403);return self;};
  if(route==='/identity'&&method==='GET'){send(res,200,await who());return true;}
  if(route==='/asset-corrections'&&method==='GET'){send(res,200,{items:corrections.list(url.searchParams.get('workId'))});return true;}
  if(route==='/asset-corrections'&&method==='POST'){const self=await who();fail(self.name,'请先填写团队姓名',422);send(res,201,corrections.publish(await jsonBody(req),self));return true;}
  if(route==='/profile'&&method==='POST'){send(res,200,{ok:true,name:directory.set(actor,(await jsonBody(req)).name)});return true;}
  const rename=/^\/members\/([^/]+)\/name$/.exec(route);
  if(rename&&method==='POST'){fail(ownMachine(req)&&equal(req.headers['x-dashboard-control'],controlNonce),'只有主版本可以设置其他成员姓名',403);fail((await getMembers()).some(m=>m.id===rename[1]),'成员不存在',404);send(res,200,{ok:true,name:directory.set(rename[1],(await jsonBody(req)).name)});return true;}
  send(res,404,{error:'成员服务接口不存在'});return true;
 }};
}
