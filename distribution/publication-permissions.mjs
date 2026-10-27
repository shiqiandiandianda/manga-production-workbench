import fs from 'node:fs';import path from 'node:path';import {writeJson} from './updates.mjs';
const fail=(ok,message,status=400)=>{if(!ok)throw Object.assign(Error(message),{status});};
export function createPublicationPermissions({dataDir,clients,authenticate,ownMachine,controlNonce,getMembers,submit}){
 const file=path.join(dataDir,'publication-permissions.local.json'),audit=path.join(dataDir,'publication-audit.local.jsonl');
 let grants=fs.existsSync(file)?JSON.parse(fs.readFileSync(file)):{};
 const registered=id=>/^[a-f0-9]{16}$/.test(id)&&Object.keys(clients()).some(key=>key.slice(0,16)===id);
 const allowed=id=>id==='publisher'||registered(id)&&grants[id]?.enabled===true;
 const append=event=>fs.appendFileSync(audit,JSON.stringify({...event,at:new Date().toISOString()})+'\n');
 const info=req=>{let actor=null;try{actor=authenticate(req);}catch{}return {actor,canPublish:!!actor&&allowed(actor),canManagePublishPermissions:ownMachine(req)};};
 async function body(req){let size=0,parts=[];for await(const bytes of req){size+=bytes.length;fail(size<=64*1024*1024,'发布请求过大',413);parts.push(bytes);}return JSON.parse(Buffer.concat(parts).toString()||'{}');}
 return {allowed,info,async handle(req,res,url){
  if(!url.pathname.startsWith('/api/publication/'))return false;
  const send=(code,value)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
  fail(!req.headers.origin||req.headers.origin==='http://'+req.headers.host,'请从自己的工作台操作发布权限',403);
  const actor=authenticate(req);
  if(url.pathname==='/api/publication/permission'&&req.method==='POST'){
   fail(ownMachine(req)&&req.headers['x-dashboard-control']===controlNonce,'只有主版本管理员可以授予或撤销发布权限',403);
   const input=await body(req);fail(registered(input.memberId),'成员尚未登记，无法授权',404);fail(typeof input.enabled==='boolean','发布权限值无效');
   grants={...grants,[input.memberId]:{enabled:input.enabled,updatedAt:new Date().toISOString()}};writeJson(file,grants);
   const name=(await getMembers()).find(row=>row.id===input.memberId)?.name||'';append({action:input.enabled?'grant':'revoke',memberId:input.memberId,name});
   send(200,{ok:true,memberId:input.memberId,enabled:input.enabled});return true;
  }
  if(url.pathname==='/api/publication/submit'&&req.method==='POST'){
   fail(allowed(actor),'你没有发布新版本的权限，请联系主版本管理员授权',403);
   const input=await body(req);fail(allowed(actor),'发布权限已被撤销',403);
   const member=(await getMembers()).find(row=>row.id===actor);fail(member?.name,'请先填写自己的团队姓名',422);
   const result=await submit(input,{id:actor,name:member.name},()=>allowed(actor));
   if(!result.reused)append({action:'publish',memberId:actor,name:member.name,version:result.version,note:result.note});
   send(200,{...result,message:'新版已发布，团队成员可在任务空闲时安全升级'});return true;
  }
  send(404,{error:'发布接口不存在'});return true;
 }};
}
