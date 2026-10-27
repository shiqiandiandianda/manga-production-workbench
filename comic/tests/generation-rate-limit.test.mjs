import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createStudio} from '../server.mjs';
import {GenerationSlots} from '../lib/generation-slots.mjs';
import {GenerationSettings} from '../lib/generation-settings.mjs';
import {createProject,panel,id} from '../public/model.js';

const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check,message,timeout=4000){const end=Date.now()+timeout;while(Date.now()<end){if(check())return;await delay(10);}throw new Error(message);}

function tempDir(t,prefix){const directory=fs.mkdtempSync(path.join(os.tmpdir(),prefix));t.after(()=>{assert.equal(path.dirname(path.resolve(directory)),path.resolve(os.tmpdir()));fs.rmSync(directory,{recursive:true,force:true});});return directory;}

async function studioFixture(t,{bridge,panels=2}={}){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'comic-rate-limit-'));
  const studio=createStudio({dataDir:directory,maxConcurrent:6,bridge,jimengBridge:{close(){},status:async()=>({connected:false})},storyboardGenerator:{close(){}}});
  await new Promise(resolve=>studio.server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{
    try{studio.close();}catch{}
    await until(()=>studio.idle(),'mock cleanup').catch(()=>{});
    await new Promise(resolve=>{studio.server.close(()=>resolve());studio.server.closeAllConnections?.();});
    assert.equal(path.dirname(path.resolve(directory)),path.resolve(os.tmpdir()));
    fs.rmSync(directory,{recursive:true,force:true});
  });
  const project=createProject('限流合成测试',true);
  while(project.pages[0].panels.length<panels){const shot={...structuredClone(project.shots[0]),id:id('shot'),code:'RL'+project.shots.length};project.shots.push(shot);project.pages[0].panels.push(panel(shot.id,0,0,100,100));}
  studio.store.db.projects.push(project);studio.store.save();
  const origin='http://127.0.0.1:'+studio.server.address().port;
  const request=async(route,method='GET',value)=>{const response=await fetch(origin+route,{method,headers:value?{'Content-Type':'application/json'}:{},body:value?JSON.stringify(value):undefined});return {status:response.status,data:await response.json()};};
  return {directory,studio,project,request};
}

test('Codex 429 只暂停队列：任务保持 queued，冷却后自动重试并成功',async t=>{
  const previous=process.env.COMIC_RATE_LIMIT_COOLDOWN_MS;
  process.env.COMIC_RATE_LIMIT_COOLDOWN_MS='120';
  t.after(()=>{if(previous===undefined)delete process.env.COMIC_RATE_LIMIT_COOLDOWN_MS;else process.env.COMIC_RATE_LIMIT_COOLDOWN_MS=previous;});
  let calls=0;
  const rate=Object.assign(new Error('exceeded retry limit, last status: 429 Too Many Requests'),{code:'account_rate_limited',stage:'turn/start',generationEnded:false,mayHaveStarted:false});
  const bridge={close(){},status:async()=>({connected:true,imageFeature:true}),generate:async()=>{calls++;if(calls===1)throw rate;return {bytes:png,imageToolSeen:true,description:'合成测试图，无真实生成'};}};
  const f=await studioFixture(t,{bridge,panels:2});
  const submitted=await f.request('/api/jobs','POST',{projectId:f.project.id,panelIds:[f.project.pages[0].panels[0].id],provider:'codex'});
  assert.equal(submitted.status,202);
  await until(()=>calls===1,'first call');
  const job=f.studio.store.db.jobs.find(j=>j.id===submitted.data[0].id);
  assert.equal(job.status,'queued','429 后任务必须回到 queued，不能标 failed');
  assert.equal(job.errorCode,'account_rate_limited');
  assert.match(job.message,/限流/);
  assert.ok(f.studio.generationSlots.mainLimit()>0);
  await delay(30);
  assert.equal(calls,1,'冷却期间不能继续补位');
  await until(()=>f.studio.store.db.jobs.every(j=>j.status==='done'),'cooldown retry should finish',5000);
  assert.equal(calls,2);
  assert.equal(job.status,'done');
});

test('429 错误在最坏情况下也不会把任务标成远端状态未知',async t=>{
  const previous=process.env.COMIC_RATE_LIMIT_COOLDOWN_MS;
  process.env.COMIC_RATE_LIMIT_COOLDOWN_MS='5000';
  t.after(()=>{if(previous===undefined)delete process.env.COMIC_RATE_LIMIT_COOLDOWN_MS;else process.env.COMIC_RATE_LIMIT_COOLDOWN_MS=previous;});
  const rate=Object.assign(new Error('429 Too Many Requests'),{code:'account_rate_limited',stage:'turn/start',generationEnded:false,mayHaveStarted:false,diagnostics:{classification:'rate_limited_not_started',retry:{automatic:false,action:'retry_after_cooldown',note:'账号限流'}}});
  const bridge={close(){},status:async()=>({connected:true,imageFeature:true}),generate:async()=>{throw rate;}};
  const f=await studioFixture(t,{bridge,panels:1});
  const submitted=await f.request('/api/jobs','POST',{projectId:f.project.id,panelIds:[f.project.pages[0].panels[0].id],provider:'codex'});
  await until(()=>f.studio.store.db.jobs.find(j=>j.id===submitted.data[0].id)?.errorCode==='account_rate_limited','rate limit recorded');
  const job=f.studio.store.db.jobs.find(j=>j.id===submitted.data[0].id);
  assert.equal(job.status,'queued');
  assert.notEqual(job.requiredAction,'inspect_existing_job_and_remote_state');
  assert.notEqual(job.nativeDiagnostics?.classification,'remote_state_unknown');
  await f.request('/api/jobs/cancel-all','POST',{projectId:f.project.id});
});

test('名额层同时约束主队列与旁路渠道，并按渠道计数',async t=>{
  const directory=tempDir(t,'comic-slot-provider-');
  const slots=new GenerationSlots({directory,platforms:{main:6,repair:2}});
  slots.setProviderLimits({codex:1,jimeng:6});
  const first=await slots.acquire({ownerId:'center:1',ownerPid:process.pid,requestId:'a',provider:'codex'});
  assert.equal(slots.tryAcquire({ownerId:'comic:2',ownerPid:process.pid,requestId:'b',provider:'codex'}),null,'Codex 名额已满时主队列也必须等待');
  const jimeng=await slots.acquire({ownerId:'comic:3',ownerPid:process.pid,requestId:'c',provider:'jimeng'});
  assert.ok(jimeng.token,'其他渠道不受 Codex 名额影响');
  first.release({completed:true});
  const second=await slots.acquire({ownerId:'comic:2',ownerPid:process.pid,requestId:'b',provider:'codex'});
  assert.ok(second.token,'释放后可以补位');
  jimeng.release({completed:true});second.release({completed:true});
});

test('共享并发改小会同步降低 Codex 上限，不再只升不降',async t=>{
  const directory=tempDir(t,'comic-generation-settings-');
  const settings=new GenerationSettings(directory,6,{main:6,repair:2});
  settings.update('codex',8);
  const platforms=settings.updatePlatforms({main:4,repair:2});
  assert.equal(platforms.main,4);
  assert.equal(new GenerationSettings(directory,6).limits.codex,4);
});

test('远端未知名额有 TTL，不会永久占用生图槽',async t=>{
  const directory=tempDir(t,'comic-slot-ttl-');
  const slots=new GenerationSlots({directory,platforms:{main:6,repair:2},remoteTtlMs:60});
  const lease=await slots.acquire({ownerId:'center:lost',ownerPid:process.pid,requestId:'lost'});
  lease.keepRemote();
  assert.equal(slots.snapshot().running,1);
  await delay(120);
  assert.equal(slots.snapshot().running,0,'超过 TTL 的远端未知租约必须回收');
});

test('delegated 画格不能再次本机提交，并能被取消',async t=>{
  const bridge={close(){},status:async()=>({connected:true,imageFeature:true}),generate:async()=>({bytes:png,imageToolSeen:true,description:'合成测试图，无真实生成'})};
  const f=await studioFixture(t,{bridge,panels:1});
  const panelId=f.project.pages[0].panels[0].id;
  f.studio.store.db.jobs.push({id:id('job'),projectId:f.project.id,panelId,provider:'codex',action:'generate',status:'delegated',remoteTaskId:'task_mock',created:new Date().toISOString(),updated:new Date().toISOString()});
  f.studio.store.save();
  const submitted=await f.request('/api/jobs','POST',{projectId:f.project.id,panelIds:[panelId],provider:'codex'});
  assert.equal(submitted.status,409,'已委派的画格必须被去重清单拦住');
  assert.match(submitted.data.error,/已经在排队或生成/);
  const cancelled=await f.request('/api/jobs/cancel-all','POST',{projectId:f.project.id});
  assert.equal(cancelled.status,200);
  assert.equal(f.studio.store.db.jobs.find(j=>j.status==='delegated'),undefined,'取消全部必须覆盖 delegated');
});

test('单次批量提交有上限，避免一键排空整话',async t=>{
  const bridge={close(){},status:async()=>({connected:true,imageFeature:true}),generate:async()=>({bytes:png,imageToolSeen:true,description:'合成测试图，无真实生成'})};
  const f=await studioFixture(t,{bridge,panels:25});
  const submitted=await f.request('/api/jobs','POST',{projectId:f.project.id,panelIds:f.project.pages[0].panels.slice(0,25).map(item=>item.id),provider:'codex'});
  assert.equal(submitted.status,400);
  assert.match(submitted.data.error,/一批最多提交 24 个/);
});
