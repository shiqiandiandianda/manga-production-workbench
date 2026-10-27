import fs from 'node:fs';import path from 'node:path';import {randomUUID,randomBytes} from 'node:crypto';import {writeJson} from './updates.mjs';
const check=(ok,message,status=400)=>{if(!ok)throw Object.assign(Error(message),{status});};
const normalized=v=>String(v||'').normalize('NFKC').replace(/\s+/g,'').toLowerCase();
const workKey=v=>normalized(String(v||'').replace(/(?:\s*·\s*(?:导入|协作工程))+$/gu,''));
const clean=(v,max)=>typeof v==='string'?v.trim().slice(0,max):'';
export function assetGenerationIdentity(input){
 const work=input?.work;check(work&&typeof work==='object','请先选择资产所属作品');const title=clean(work.title,180),projectId=clean(work.projectId,120),mokuProjectId=clean(work.mokuProjectId,120);
 check(title||projectId||mokuProjectId,'资产所属作品缺失');check(['character','scene','prop'].includes(input.role),'资产类型无效');const name=clean(input.name,180);check(name,'资产名称不能为空');
 const state=input.role==='character'?clean(input.state,4000):'';return {work:{title,projectId,mokuProjectId},role:input.role,name,state:/^(?:未指定|未知|待确认|原创候选)/u.test(state)?'':state};
}
export function sameGenerationAsset(a,b){
 if(a.role!==b.role||normalized(a.name)!==normalized(b.name)||normalized(a.state)!==normalized(b.state))return false;
 if(a.work.projectId&&a.work.projectId===b.work.projectId)return true;
 if(a.work.mokuProjectId&&b.work.mokuProjectId)return a.work.mokuProjectId===b.work.mokuProjectId;
 return !!(a.work.projectId&&a.work.projectId===b.work.projectId||a.work.title&&workKey(a.work.title)===workKey(b.work.title));
}
/** A missed heartbeat marks the owner uncertain; it never grants a second execution. */
export function createAssetGenerationLocks({file,authenticate,getMembers,clock=()=>Date.now()}){
 let state={version:1,items:[]};if(fs.existsSync(file)){state=JSON.parse(fs.readFileSync(file));check(state.version===1&&Array.isArray(state.items),'团队资产占用记录损坏，已停止新建生成任务',503);}const save=()=>writeJson(file,state);
 const publicItem=r=>({id:r.id,asset:r.asset,ownerId:r.ownerId,ownerName:r.ownerName,status:r.finishedAt?r.status:clock()-r.seenAt>60000?'uncertain':r.status,message:r.message,createdAt:r.createdAt,seenAt:r.seenAt,finishedAt:r.finishedAt||null,recordId:r.recordId||'',machine:r.machine||''});
 async function body(req){let size=0,parts=[];for await(const b of req){size+=b.length;check(size<=20000,'资产占用请求过大',413);parts.push(b);}return JSON.parse(Buffer.concat(parts).toString()||'{}');}
 const send=(res,status,v)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(v));};
 return {get items(){return state.items.map(publicItem);},async handle(req,res,url){
  if(!url.pathname.startsWith('/api/team-asset-generations/'))return false;check(!req.headers.origin,'请由本机工具核验资产占用',403);const actor=authenticate(req);check(req.method==='POST','资产占用接口只支持POST',405);const input=await body(req),action=url.pathname.split('/').at(-1);
  if(action==='status'){send(res,200,{version:1,activeCount:state.items.filter(r=>!r.finishedAt).length});return true;}
  if(action==='claim'){
   const asset=assetGenerationIdentity(input.asset);check(typeof input.requestId==='string'&&/^[\w-]{8,180}$/.test(input.requestId),'资产请求编号无效');
   const members=await getMembers(),ownerName=members.find(m=>m.id===actor)?.name||clean(input.ownerName,80)||'待填写姓名';
   const previous=state.items.find(r=>r.ownerId===actor&&r.requestId===input.requestId);if(previous){check(sameGenerationAsset(previous.asset,asset),'请求编号已用于另一资产',409);check(!previous.finishedAt,'这次生成已经结束，请使用新的生成请求编号',409);send(res,200,{claim:{...publicItem(previous),token:previous.token},reused:true});return true;}
   const existing=state.items.find(r=>!r.finishedAt&&sameGenerationAsset(r.asset,asset));if(existing){const item=publicItem(existing);send(res,409,{code:'asset_generation_occupied',error:(item.ownerName||'另一位同事')+'正在生成「'+asset.name+(asset.state?' · '+asset.state:'')+'」'+(item.status==='uncertain'?'，连接或执行状态待核实，保留占用':item.message?'：'+item.message:'')+'。已拦截重复生成，请等待原任务完成。',occupied:item});return true;}
   // Commit synchronously before any await, including member-name lookup.
   const r={id:randomUUID(),token:randomBytes(32).toString('hex'),asset,ownerId:actor,ownerName,requestId:input.requestId,recordId:clean(input.recordId,100),machine:clean(input.machine,100),status:'active',message:'正在准备生成',createdAt:clock(),seenAt:clock()};state.items.push(r);save();
   send(res,201,{claim:{...publicItem(r),token:r.token}});return true;
  }
  check(['heartbeat','finish'].includes(action),'资产占用接口不存在',404);const r=state.items.find(v=>v.id===input.id);check(r,'资产占用记录不存在',404);check(r.ownerId===actor&&r.token===input.token,'无权更改其他同事的资产占用',403);check(!r.finishedAt,'这份资产占用已结束，请重新核验',409);
  if(action==='finish')check(['completed','failed','cancelled'].includes(input.status)&&input.executionEnded===true,'必须确认本机执行已结束才能释放资产',409);
  r.seenAt=clock();r.message=clean(input.message,240)||r.message;if(action==='heartbeat')r.status=input.uncertain===true?'uncertain':'active';
  else{check(['completed','failed','cancelled'].includes(input.status)&&input.executionEnded===true,'必须确认本机执行已结束才能释放资产',409);r.status=input.status;r.finishedAt=clock();}save();send(res,200,{claim:publicItem(r)});return true;
 }};
}
