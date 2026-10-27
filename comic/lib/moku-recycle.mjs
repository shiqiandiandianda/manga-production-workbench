import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {writeFileAtomicSync} from './durable-files.mjs';

const uuid=v=>typeof v==='string'&&/^[a-f0-9-]{36}$/i.test(v);
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
const globalKinds=new Set(['image:bubble','image:nameplate','image:sfx_text','file:font']);

// The confirmation plan stores no credentials. A commit uses a persistent key,
// so a lost response can be retried by the same account without a second write.
export function createMokuRecycle({dataDir,baseUrl,request,read,assertSession=()=>{},invalidate=()=>{}}){
 const file=path.join(dataDir,'moku-recycle-plans.local.json');let plans={};try{plans=JSON.parse(fs.readFileSync(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
 const persist=()=>writeFileAtomicSync(file,JSON.stringify(plans));
 async function actor(){const me=await read('/api/auth/me');const id=me.user?.id||me.id;if(!uuid(id))fail('请先登录有权整理素材的墨库账号',401);return id;}
 const call=async(route,body,key)=>{const response=await request(route,{method:'POST',body:JSON.stringify(body),headers:{'Idempotency-Key':key}});const result=await response.json();assertSession();return result;};
 async function preview(input){
  const projectId=input?.projectId,global=projectId==='public'||projectId==='global',action=input?.action;
  if(!global&&!uuid(projectId)||!['recycle','restore'].includes(action)||!Array.isArray(input.items)||!input.items.length||input.items.length>1000)fail('请选择同一墨库项目的有效资产');
  const actorId=await actor(),seen=new Set(),entries=[];if(input.expectedUserId!==actorId)fail('墨库账号已切换，请刷新素材并重新选择',409);
  for(const item of input.items){
   const {id,objectVersion,assetKind,assetType}=item||{},scopeId=global?'global':item?.scopeId;
   if(!uuid(id)||seen.has(id)||!Number.isInteger(objectVersion)||objectVersion<1||!['image','file'].includes(assetKind)||typeof assetType!=='string'||!/^[a-z_]+$/.test(assetType)||!global&&!(scopeId==='project'||uuid(scopeId)))fail('所选资产缺少分类或版本，请刷新后重新选择');
   if(global&&!globalKinds.has(assetKind+':'+assetType))fail('全局资产类别无效');seen.add(id);
   entries.push({id,objectVersion,scopeId,assetKind,assetType});
  }
  if(global&&new Set(entries.map(i=>i.assetKind+':'+i.assetType)).size!==1)fail('全局资产请按同一类别分批回收或恢复');
  const planId=randomUUID(),plan={id:planId,actorId,baseUrl,projectId:global?'public':projectId,action,entries,state:'previewed',commitKey:randomUUID(),createdAt:new Date().toISOString()};
  if(global){let cursor=0;await Promise.all(Array.from({length:Math.min(4,entries.length)},async()=>{for(;;){const item=entries[cursor++];if(!item)return;const route='/api/global-library/'+item.assetKind+'/'+item.assetType;const value=await request(route+'/assets/'+item.id).then(r=>r.json());assertSession();if(value.id!==item.id||value.objectVersion!==item.objectVersion||Boolean(value.deletedAt)!==(action==='restore')||value.projectId!==null)fail('所选资产已变化；请刷新后重新选择',409);item.name=value.name;}}));}
  else{const p=await call('/api/project-library/'+projectId+'/batch/preview',{action,items:entries},randomUUID());if(!uuid(p.id)||p.total!==entries.length||!Array.isArray(p.items))fail('墨库返回的批量预览不完整',502);const names=new Map(p.items.map(i=>[i.id,i.name]));for(const item of entries){if(!names.has(item.id))fail('墨库返回的批量预览不完整',502);item.name=names.get(item.id);}plan.remotePlanId=p.id;}
  plans[planId]=plan;persist();return {id:planId,action,total:entries.length,atomic:true,items:entries.map(({id,name,scopeId,assetKind,assetType})=>({id,name,scopeId,assetKind,assetType}))};
 }
 async function commit(input){
  const plan=plans[input?.planId];if(!plan||plan.baseUrl!==baseUrl)fail('批量预览不存在，请重新选择',404);
  if(input.expectedUserId!==plan.actorId||await actor()!==plan.actorId)fail('请切换回创建预览的墨库账号后继续',403);
  if(plan.state==='completed')return plan.result;
  if(plan.state==='rejected')throw Object.assign(Error('该批次已明确被拒绝，请刷新并重新预览'),{status:409,code:'RECYCLE_PLAN_REJECTED'});
  if(plan.state==='previewed'&&Date.now()-Date.parse(plan.createdAt)>60*60*1000)fail('预览已过期，请重新选择',409);
  const firstAttempt=plan.state==='previewed';plan.state='pending';persist();let result;
  try{
   if(plan.projectId==='public'){
    const first=plan.entries[0],route='/api/global-library/'+first.assetKind+'/'+first.assetType+'/batch/'+plan.action;
    result=await call(route,{projectId:null,items:plan.entries.map(({id,objectVersion})=>({id,objectVersion}))},plan.commitKey);
   }else result=await call('/api/project-library/'+plan.projectId+'/batch/'+plan.remotePlanId+'/commit',{},plan.commitKey);
  }catch(error){
   // A definitive rejection of the first request means the transaction did not
   // commit. A lost response, a later retry, or a switched session is uncertain.
   if(firstAttempt&&[400,401,403,404,409,422].includes(error.status)&&error.code!=='SESSION_ACCOUNT_CHANGED'){plan.state='rejected';persist();error.message+='；该批次未提交，请刷新并重新预览';error.code='RECYCLE_PLAN_REJECTED';}
   throw error;
  }
  plan.state='completed';plan.result={state:'completed',changedCount:result.changedCount,planId:plan.id};persist();invalidate();return plan.result;
 }
 async function pending(projectId){
  const global=projectId==='public'||projectId==='global';
  if(!global&&!uuid(projectId))fail('请选择有效的墨库项目');
  const actorId=await actor(),scope=global?'public':projectId;
  return {items:Object.values(plans).filter(plan=>plan.state==='pending'&&plan.actorId===actorId&&plan.baseUrl===baseUrl&&plan.projectId===scope)
   .sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).map(plan=>({id:plan.id,action:plan.action,createdAt:plan.createdAt,total:plan.entries.length,items:plan.entries.map(({id,name,scopeId,assetKind,assetType})=>({id,name,scopeId,assetKind,assetType}))}))};
 }
 return {preview,commit,pending};
}
