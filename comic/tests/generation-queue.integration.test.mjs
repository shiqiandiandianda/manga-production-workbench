import {createProject as fixtureProject} from '../public/model.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createStudio} from '../server.mjs';

const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64');
function seedFixture(studio){const p=fixtureProject('合成队列验收',true);studio.store.db.projects.push(p);studio.store.save();return p;}
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check,message){for(let attempt=0;attempt<150;attempt++){if(await check())return;await delay(10);}throw new Error(message);}
async function request(url,route,method='GET',data){const response=await fetch(url+route,{method,headers:data?{'Content-Type':'application/json'}:{},body:data?JSON.stringify(data):undefined});return {status:response.status,data:await response.json()};}

test('two unknown cloud images do not deadlock their recovery behind two new waiting image jobs',async t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'comic-cloud-queue-test-'));
  let studio, codexCalls=0, recoveryQueries=0, finishCodex;
  const gate=new Promise(resolve=>{finishCodex=resolve;});
  const publicState=state=>({submitId:state.submitId,nodeId:state.nodeId,operationRef:state.submitId,phase:state.phase});
  const bridge={status:async()=>({connected:true,imageFeature:true}),generate:async()=>{
    codexCalls++;
    assert.ok(studio.generationSlots.snapshot().running<=2);
    await gate;
    return {bytes:png,imageToolSeen:true,description:'mock image, no AI'};
  }};
  const jimeng={status:async()=>({connected:true}),publicState,resumeState:taskDirectory=>{
    const state=JSON.parse(fs.readFileSync(path.join(taskDirectory,'jimeng-state.json'),'utf8'));
    return {submissionAttempted:state.submissionAttempted,recovery:publicState(state)};
  },generate:async(taskDirectory,input,refs,options)=>{
    const file=path.join(taskDirectory,'jimeng-state.json');
    if(options.recoveryOnly){
      recoveryQueries++;
      const state=JSON.parse(fs.readFileSync(file,'utf8'));
      state.phase='done';fs.writeFileSync(file,JSON.stringify(state));
      return {bytes:png,imageToolSeen:true,recovery:publicState(state),description:'mock recovered image, no AI'};
    }
    const state={submissionAttempted:true,phase:'submission_unknown',submitId:'mock-submit-'+path.basename(taskDirectory),nodeId:'mock-node-'+path.basename(taskDirectory)};
    fs.writeFileSync(file,JSON.stringify(state));
    options.onProgress?.('模拟云任务已提交',{phase:'generating',recovery:publicState(state)});
    throw Object.assign(new Error('mock submission response unknown'),{recoverable:true,requiredAction:'resume',recovery:publicState(state)});
  }};
  studio=createStudio({dataDir:directory,maxConcurrent:2,bridge,jimengBridge:jimeng,seedReference:false});
  t.after(async()=>{finishCodex();studio.close();await new Promise(resolve=>studio.server.close(resolve));await until(()=>studio.idle(),'mock service did not finish cleanup');fs.rmSync(directory,{recursive:true,force:true});});
  await new Promise(resolve=>studio.server.listen(0,'127.0.0.1',resolve));
  const url=`http://127.0.0.1:${studio.server.address().port}`;
  const project=seedFixture(studio);
  const panels=project.pages.flatMap(page=>page.panels);
  assert.ok(panels.length>=4);
  const cloud=(await request(url,'/api/jobs','POST',{projectId:project.id,panelIds:panels.slice(0,2).map(panel=>panel.id),provider:'jimeng',model:'mock-official-model',mode:'t2i'}));
  assert.equal(cloud.status,202);
  await until(()=>studio.store.db.jobs.filter(job=>job.status==='recoverable').length===2,'mock unknown cloud tasks did not preserve recovery');
  assert.equal(studio.generationSlots.snapshot().running,2);
  assert.equal(studio.generationSlots.listRemote().length,2);
  const next=await request(url,'/api/jobs','POST',{projectId:project.id,panelIds:panels.slice(2,4).map(panel=>panel.id),provider:'codex'});
  assert.equal(next.status,202);
  await delay(35);
  assert.equal(codexCalls,0,'new generation must wait while two cloud images are unknown');
  assert.equal(studio.store.db.jobs.filter(job=>job.status==='running').length,2);
  for(const job of cloud.data){
    const resumed=await request(url,`/api/jobs/${job.id}/resume`,'POST',{});
    assert.equal(resumed.status,202);
  }
  await until(()=>recoveryQueries===2,'recovery queries were blocked by ordinary waiting jobs');
  await until(()=>codexCalls===2,'completed remote queries did not allow waiting image jobs to continue');
  assert.equal(studio.generationSlots.listRemote().length,0);
  assert.equal(studio.generationSlots.snapshot().running,2);
  finishCodex();
  await until(()=>studio.store.db.jobs.every(job=>job.status==='done'),'image jobs did not finish after cloud recovery');
  assert.equal(studio.generationSlots.snapshot().running,0);
  assert.equal(recoveryQueries,2,'queries must resume the same submission, not submit a second image');
});

test('successful cloud generation followed by download failure frees its image slot and retains recovery identity',async t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'comic-cloud-download-test-'));
  const recovery={submitId:'mock-original-submit',nodeId:'mock-original-node',operationRef:'mock-original-submit'};
  const bridge={status:async()=>({connected:true,imageFeature:true}),generate:async()=>({bytes:png,imageToolSeen:true,description:'mock local image'})};
  const jimeng={status:async()=>({connected:true}),publicState:state=>state,generate:async(taskDirectory,input,refs,options)=>{
    fs.writeFileSync(path.join(taskDirectory,'jimeng-state.json'),JSON.stringify({submissionAttempted:true,phase:'downloading',generationEnded:true,...recovery}));
    options.onProgress?.('模拟原云生图已完成，下载中',{phase:'downloading',recovery});
    throw new Error('mock image download network unavailable');
  }};
  const studio=createStudio({dataDir:directory,maxConcurrent:2,bridge,jimengBridge:jimeng,seedReference:false});
  t.after(async()=>{studio.close();await new Promise(resolve=>studio.server.close(resolve));await until(()=>studio.idle(),'mock service did not finish cleanup');fs.rmSync(directory,{recursive:true,force:true});});
  await new Promise(resolve=>studio.server.listen(0,'127.0.0.1',resolve));
  const url=`http://127.0.0.1:${studio.server.address().port}`;
  const project=seedFixture(studio),panels=project.pages[0].panels;
  const cloud=await request(url,'/api/jobs','POST',{projectId:project.id,panelIds:[panels[0].id],provider:'jimeng',model:'mock-model',mode:'t2i'});
  assert.equal(cloud.status,202);
  await until(()=>studio.idle()&&studio.store.db.jobs[0].status==='failed','download failure did not settle');
  assert.equal(studio.generationSlots.snapshot().running,0);
  assert.equal(studio.generationSlots.listRemote().length,0);
  assert.equal(studio.store.db.jobs[0].recovery.submitId,recovery.submitId,'download recovery must preserve the original submission');
  const next=await request(url,'/api/jobs','POST',{projectId:project.id,panelIds:[panels[1].id],provider:'codex'});
  assert.equal(next.status,202);
  await until(()=>studio.idle()&&studio.store.db.jobs[1].status==='done','unrelated image job remained blocked by completed cloud generation');
  assert.equal(studio.generationSlots.snapshot().running,0);
});

test('configured six-image scheduler starts six images and queues a seventh without exceeding shared slots',async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'comic-six-images-'));
 const releases=[];let calls=0,active=0,peak=0;
 const bridge={status:async()=>({connected:true,imageFeature:true}),generate:async()=>{calls++;active++;peak=Math.max(peak,active);await new Promise(resolve=>releases.push(resolve));active--;return {bytes:png,imageToolSeen:true,description:'mock six-image concurrency, no AI'};},close(){releases.forEach(resolve=>resolve());}};
 const studio=createStudio({dataDir:directory,maxConcurrent:6,bridge,seedReference:false,storyboardGenerator:{close(){}}});
 await new Promise(resolve=>studio.server.listen(0,'127.0.0.1',resolve));const url=`http://127.0.0.1:${studio.server.address().port}`;
 t.after(async()=>{releases.forEach(resolve=>resolve());studio.close();await new Promise(resolve=>studio.server.close(resolve));await until(()=>studio.idle(),'six-image mock workers did not end');assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(directory,{recursive:true,force:true});});
 const {uid}=await import('../lib/store.mjs');const {panel}=await import('../public/model.js');
 const project=seedFixture(studio);
 while(project.pages[0].panels.length<7){const shot={...structuredClone(project.shots[0]),id:uid('shot'),code:'TEST'+project.shots.length};project.shots.push(shot);project.pages[0].panels.push(panel(shot.id,0,0,100,100));}
 assert.equal((await request(url,'/api/projects/'+project.id,'PUT',project)).status,200);
 const submitted=await request(url,'/api/jobs','POST',{projectId:project.id,panelIds:project.pages[0].panels.slice(0,7).map(p=>p.id),provider:'codex'});assert.equal(submitted.status,202);
 await until(()=>calls===6,'six mock images did not start');
 const state=(await request(url,'/api/state')).data;assert.deepEqual(state.scheduler,{concurrency:6,active:6,queued:1});assert.deepEqual(studio.generationSlots.snapshot(),{running:6,concurrency:6,platforms:{main:{running:6,concurrency:6},repair:{running:0,concurrency:2}}});
 await delay(25);assert.equal(calls,6);releases[0]();await until(()=>calls===7,'seventh image did not enter after one finished');assert.equal(peak,6);
 releases.forEach(resolve=>resolve());await until(()=>studio.store.db.jobs.every(j=>j.status==='done'),'six-image mock jobs did not finish');assert.equal(studio.generationSlots.snapshot().running,0);
});