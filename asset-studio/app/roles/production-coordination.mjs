import fs from 'node:fs';import path from 'node:path';import {randomUUID} from 'node:crypto';
import {createAssetGenerationClient} from '../../../distribution/asset-generation-client.mjs';
const active=new Set(['queued','running','awaiting_confirmation','recoverable','delegated']);const terminal=new Set(['done','failed','cancelled']);
const read=file=>{try{return JSON.parse(fs.readFileSync(file));}catch{return {};}};
export function createProductionCoordination({root,dataDir,records,save,editorJson,refresh,client=createAssetGenerationClient({root:path.resolve(root,'..')})}){
 let checking=false;const busy=new Map(),releases=new Map();for(const r of records){r.teamBusy=false;if(r.teamPending){r.teamPendingSubmissions={...r.teamPendingSubmissions,[r.teamPending.component]:r.teamPending};delete r.teamPending;}}
 async function identity(r){
  let work=r.source?.work;if(!work){if(r.source?.projectId){const p=await editorJson('/api/projects/'+r.source.projectId);let link={};try{link=await editorJson('/api/teamwork/status?projectId='+encodeURIComponent(p.id));}catch{}work={projectId:p.id,title:p.title,mokuProjectId:link.remoteProjectId||''};}else{const moku=read(path.join(dataDir,'moku.json'));work={mokuProjectId:moku.projectId||'',title:moku.projectName||''};}}
  if(!work?.projectId&&!work?.mokuProjectId&&!work?.title)throw Error('请先在资产工作室选择所属墨库作品，再生成资产');
  r.source={...r.source,work};return {work,role:r.type,name:r.name,state:r.outfit||''};
 }
 async function ensure(r,requestId){
  if(!client.enabled)return;if(releases.has(r.id))await releases.get(r.id);if(r.teamClaim&&!r.teamClaim.released){await client.heartbeat(r.teamClaim,{message:'正在准备资产组件'});return;}
  if(!r.teamRequestId||r.teamClaim?.released)r.teamRequestId=requestId||randomUUID();save();try{const result=await client.claim({asset:await identity(r),requestId:r.teamRequestId,recordId:r.id});r.teamClaim={...result.claim,released:false};r.teamClaimUncertain=false;save();}catch(error){r.teamClaimUncertain=error.status===503;save();throw error;}
 }
 async function run(r,operation,requestId){
  if(!client.enabled)return operation();busy.set(r.id,(busy.get(r.id)||0)+1);r.teamBusy=true;save();try{await ensure(r,requestId);return await operation();}finally{busy.set(r.id,busy.get(r.id)-1);r.teamBusy=busy.get(r.id)>0;save();}
 }
 async function submit(r,component,route,input,locator){
  if(!client.enabled)return editorJson(route,input);await ensure(r);r.teamPendingSubmissions||={};r.teamPendingSubmissions[component]={component,...locator,previousIds:[...Object.values(r.jobs||{}),...(r.jobHistory||[]).map(j=>j.jobId)]};save();
  try{const value=await editorJson(route,input),job=Array.isArray(value)?value[0]:value.job;if(job?.id)r.jobs[component]=job.id;delete r.teamPendingSubmissions[component];save();return value;}
  catch(error){if(error.status>=400&&error.status<500){delete r.teamPendingSubmissions[component];save();}throw error;}
 }
 async function reconcile(r,state){
  if(!r.teamClaim||r.teamClaim.released)return;
  const pending=r.teamPendingSubmissions||{},ownJobs=state.jobs.filter(j=>Object.values(r.jobs||{}).includes(j.id)||r.assetId&&j.assetProductionRequest?.stageSnapshot?.assetId===r.assetId||Object.values(pending).some(p=>p.panelId&&p.panelId===j.panelId));
  for(const [component,p]of Object.entries(pending)){const found=ownJobs.find(j=>!(p.previousIds||[]).includes(j.id)&&(p.panelId?j.panelId===p.panelId:j.assetProductionRequest?.stageSnapshot?.stageId===p.stageId));if(found){r.jobs[component]=found.id;delete pending[component];save();}}
  const running=ownJobs.filter(j=>active.has(j.status)||j.executionActive===true),unknown=Object.keys(pending).length>0||Object.values(r.jobs||{}).some(id=>!ownJobs.some(j=>j.id===id));
  if(r.teamBusy||running.length||unknown){await client.heartbeat(r.teamClaim,{uncertain:unknown,message:unknown?'提交或执行状态待核实，保留占用':running[0]?.message||'正在准备组件'});return;}
  if((ownJobs.length||r.status==='failed')&&ownJobs.every(j=>terminal.has(j.status))&&['completed','failed','cancelled'].includes(r.status)){
   if(releases.has(r.id)){await releases.get(r.id);return;}
   const operation=(async()=>{const health=await editorJson('/api/health');if(health.generation?.remoteUnknown||ownJobs.some(j=>j.executionActive===undefined)&&health.generation?.running){await client.heartbeat(r.teamClaim,{uncertain:true,message:'执行是否结束待核实，保留占用'});return;}
    await client.finish(r.teamClaim,{executionEnded:true,status:r.status==='completed'?'completed':ownJobs.every(j=>j.status==='cancelled')?'cancelled':'failed',message:r.status==='completed'?'生成完成，可在墨库接回使用':'本机执行已结束'});r.teamClaim.released=true;r.teamClaim.status=r.status;save();})();releases.set(r.id,operation);try{await operation;}finally{releases.delete(r.id);}return;
  }
  await client.heartbeat(r.teamClaim,{uncertain:true,message:r.error||'任务状态待核实，保留占用'});
 }
 async function tick(){
  if(checking||!client.enabled)return;checking=true;try{const state=await editorJson('/api/state');for(const r of records){const actual=state.jobs.some(j=>Object.values(r.jobs||{}).includes(j.id)&&(active.has(j.status)||j.executionActive===true));if(!r.teamClaim&&!actual&&!r.teamClaimUncertain||r.teamClaim?.released)continue;try{if(!r.teamClaim)await ensure(r,'adopt-'+r.id);if(!r.teamBusy)await refresh(r,state);await reconcile(r,await editorJson('/api/state'));delete r.teamConnectionError;}catch(error){r.teamConnectionError=error.message;save();}}}finally{checking=false;}}
 const timer=setInterval(()=>void tick().catch(()=>{}),10000);timer.unref?.();
 return {enabled:client.enabled,async status(){return client.enabled?{required:true,connected:true,...await client.status()}:{required:false,connected:false};},ensure,run,submit,reconcile,tick,close(){clearInterval(timer);}};
}
