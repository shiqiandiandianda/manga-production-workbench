import {createProject as fixtureProject} from '../public/model.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createStudio} from '../server.mjs';
import {Store,uid} from '../lib/store.mjs';

import {clone} from '../public/model.js';
const root=fileURLToPath(new URL('../',import.meta.url));
const tempParent=path.join(root,'.runtime','temp');
function tempDir(t,prefix){fs.mkdirSync(tempParent,{recursive:true});const directory=fs.mkdtempSync(path.join(tempParent,prefix));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));return directory;}
const submitId='11111111-1111-4111-8111-111111111111';
function jimengState(directory,jobId,state){fs.mkdirSync(path.join(directory,'jobs',jobId),{recursive:true});fs.writeFileSync(path.join(directory,'jobs',jobId,'jimeng-state.json'),JSON.stringify({nodeId:'node_0123456789',submitId,...state}));}
async function studioFor(t,directory){
  const studio=createStudio({dataDir:directory,bridge:{status:async()=>({connected:false}),close(){}},jimengBridge:{status:async()=>({connected:false}),publicState:s=>({phase:s.phase,submitId:s.submitId}),close(){}},storyboardGenerator:{close(){}},seedReference:false});
  await new Promise(resolve=>studio.server.listen(0,'127.0.0.1',resolve));t.after(async()=>{studio.close();await new Promise(resolve=>studio.server.close(resolve));});
  studio.store.db.projects.push(fixtureProject('合成审查回归',true));studio.store.save();
  const base='http://127.0.0.1:'+studio.server.address().port;
  const request=async(route,method='GET',data)=>{const response=await fetch(base+route,{method,headers:data?{'Content-Type':'application/json'}:{},body:data?JSON.stringify(data):undefined});return {status:response.status,data:await response.json()};};
  return {studio,request};
}

test('重启不会把已被拒绝或已结束失败的即梦任务改回“可恢复”，真正中断的仍可恢复',async t=>{
  const directory=tempDir(t,'review-restart-'),store=new Store(directory),project=fixtureProject('合成审查回归',true);
  store.db.projects.push(project);store.save();
  const ids={rejected:uid('job'),failed:uid('job'),interrupted:uid('job')};
  for(const id of Object.values(ids))store.db.jobs.push({id,provider:'jimeng',projectId:project.id,panelId:'x',status:'failed',phase:'failed',message:'原始失败原因'});store.save();
  jimengState(directory,ids.rejected,{submissionAttempted:true,phase:'rejected'});
  jimengState(directory,ids.failed,{submissionAttempted:true,generationEnded:true,phase:'failed'});
  jimengState(directory,ids.interrupted,{submissionAttempted:true,phase:'submission_unknown'});
  const {studio}=await studioFor(t,directory),job=id=>studio.store.db.jobs.find(j=>j.id===id);
  assert.equal(job(ids.rejected).status,'failed');assert.equal(job(ids.rejected).message,'原始失败原因');
  assert.equal(job(ids.failed).status,'failed');
  assert.equal(job(ids.interrupted).status,'recoverable');
});

test('云端结果未确认（含已取消但未查询）的即梦任务会阻止删除项目，避免隐藏占用的生图名额',async t=>{
  const directory=tempDir(t,'review-delete-'),{studio,request}=await studioFor(t,directory),project=studio.store.db.projects[0];
  const job={id:uid('job'),provider:'jimeng',projectId:project.id,panelId:'x',status:'cancelled',recovery:{submitId}};studio.store.db.jobs.push(job);studio.store.save();
  jimengState(directory,job.id,{submissionAttempted:true,phase:'submission_unknown'});
  const blocked=await request('/api/projects/'+project.id,'DELETE',{expectedRevision:project.revision});assert.equal(blocked.status,409);assert.match(blocked.data.error,/查询原任务/);
  jimengState(directory,job.id,{submissionAttempted:true,generationEnded:true,phase:'done'});
  assert.equal((await request('/api/projects/'+project.id,'DELETE',{expectedRevision:project.revision})).status,200);
});

test('报价缺失的待批准任务返回 409 而不是服务器错误',async t=>{
  const directory=tempDir(t,'review-approve-'),{studio,request}=await studioFor(t,directory),project=studio.store.db.projects[0];
  const job={id:uid('job'),provider:'jimeng',projectId:project.id,panelId:'x',status:'awaiting_confirmation'};studio.store.db.jobs.push(job);studio.store.save();
  assert.equal((await request('/api/jobs/'+job.id+'/approve','POST',{approved:true,creditCeiling:10})).status,409);
});




