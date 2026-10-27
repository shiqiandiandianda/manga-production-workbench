import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import {createHubServer} from '../../协作/lib/hub-server.mjs';
import {createNodeAgent} from '../../协作/lib/node-core.mjs';
import {createComicFixture,seedProject,waitFor,sha256Hex} from './helpers/collab-fixture.mjs';
import {HubState} from '../../协作/lib/hub-state.mjs';import {HubQueue} from '../../协作/lib/hub-queue.mjs';
const proof=path.resolve(import.meta.dirname,'../../verification/team-volunteer-20261026');fs.mkdirSync(proof,{recursive:true});
const silent={info(){},warn(){},error(){}};
test('主动帮忙真实HTTP：暂停自动接单仍可手动领取，双击幂等、并发保护、原参考与结果回传',{timeout:30000},async t=>{
 const hub=createHubServer({dataDir:fs.mkdtempSync(path.join(proof,'hub-')),config:{host:'127.0.0.1',port:0},logger:silent,startTimers:false});await hub.listen({host:'127.0.0.1',port:0});t.after(()=>hub.close());const origin='http://127.0.0.1:'+hub.server.address().port;
 const directory=fs.mkdtempSync(path.join(proof,'helper-')),nodeFile=path.join(directory,'node-config.json');
 const fetcher=(url,options)=>url.endsWith('/api/team/generation-board')?Promise.resolve({ok:true,json:async()=>({items:[],members:[]})}):fetch(url,options);
 const a=await createComicFixture(t),b=await createComicFixture(t,{directory,teamProductionNodeFile:nodeFile,teamProductionFetcher:fetcher,maxConcurrent:1}),seed=await seedProject(a,{panelCount:4,referenceCount:1});
 for(const [fixture,name]of [[a,'发起同事'],[b,'主动帮忙同事']]){assert.equal((await fixture.api('/api/collab/pair','POST',{hubUrl:origin,pairingCode:hub.hub.state.pairingCode,clientName:name})).status,200);fixture.studio.collabClient.stop();}
 const pair=async name=>(await(await fetch(origin+'/api/pair',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pairingCode:hub.hub.state.pairingCode,role:'node',name})})).json()),helper=await pair('主动帮忙同事'),other=await pair('其他同事');
 fs.writeFileSync(nodeFile,JSON.stringify({hubUrl:origin,nodeId:helper.nodeId,token:helper.token}));hub.hub.updateNodeSettings(helper.nodeId,{paused:true,maxConcurrency:1});
 const agent=createNodeAgent({config:{hubUrl:origin,token:helper.token,dataDir:path.join(directory,'node'),localComic:{origin:b.origin,provider:'codex'},heartbeatMs:40,pollMs:15,maxConcurrency:1},logger:()=>{}});t.after(()=>agent.stop());await agent.start();
 await waitFor(()=>hub.hub.getNode(helper.nodeId).capabilities?.volunteerVersion===1,'接单器没有上报主动帮忙能力');
 const dispatch=async(index,preferredNodeId=null)=>{const r=await a.api('/api/production-center/dispatch','POST',{projectId:seed.project.id,expectedRevision:seed.project.revision,panelIds:[seed.panels[index].id],preferredNodeId});assert.equal(r.status,202,JSON.stringify(r.value));return r.value.tasks[0].taskId;};
 const first=await dispatch(0),second=await dispatch(1),designated=await dispatch(2,other.nodeId);
 let view=(await b.api('/api/production-center/status')).value;assert.equal(view.self.manualHelp.available,true);assert.equal(view.tasks.find(t=>t.id===first).canVolunteer,true);assert.equal(view.tasks.find(t=>t.id===designated).canVolunteer,false);
 assert.equal((await b.api('/api/production-center/volunteer','POST',{taskId:designated,nodeId:other.nodeId})).status,409);
 const release=b.holdNext(),responses=await Promise.all([1,2].map(()=>b.api('/api/production-center/volunteer','POST',{taskId:first})));
 assert.deepEqual(responses.map(r=>r.status),[202,202]);await b.waitForCalls(1);assert.equal(b.calls.length,1);assert.equal(hub.hub.getNode(helper.nodeId).settings.paused,true);
 assert.equal((await b.api('/api/production-center/volunteer','POST',{taskId:second})).status,409);assert.equal((await b.api('/api/production-center/volunteer','POST',{taskId:'asset:already-running'})).status,404);
 const forbidden=await fetch(origin+'/api/node/volunteer',{method:'POST',headers:{'Content-Type':'application/json','x-collab-token':a.studio.collabClient.config.token},body:JSON.stringify({taskId:second})});assert.equal(forbidden.status,403);
 assert.equal(sha256Hex(fs.readFileSync(b.calls[0].refs[0])),sha256Hex(fs.readFileSync(seed.assets[0].filePath)));assert.equal(b.calls[0].input.prompt,hub.queue.getTaskOrThrow(first).generationInput.prompt);
 release();await waitFor(()=>hub.queue.getTaskOrThrow(first).status==='done','手动帮忙任务没有完成',{timeout:15000});await a.studio.collabClient.pollOnce();assert.equal(hub.queue.getTaskOrThrow(first).apply.status,'applied');assert.ok(seed.panels[0].imageAssetId);assert.equal(b.calls.length,1);assert.equal(a.calls.length,0);assert.equal(hub.queue.getTaskOrThrow(second).status,'queued');
 view=(await b.api('/api/production-center/status')).value;assert.doesNotMatch(JSON.stringify(view),new RegExp(helper.token));assert.equal(hub.hub.getNode(helper.nodeId).settings.paused,true);
 fs.writeFileSync(path.join(proof,'http-acceptance.json'),JSON.stringify({ok:true,pausedManualHelp:true,oneActualExecution:true,capacityEnforced:true,designatedTaskProtected:true,credentialsNotExposed:true,originalReferencesPreserved:true,resultReturned:true,realAI:false},null,2));
});

test('领取原子性与恢复：双人抢单、过期预约释放、重启保留预约、忙碌时不派单、禁止接手运行任务',()=>{
 const dir=fs.mkdtempSync(path.join(proof,'queue-')),clock={now:Date.now()};let hub=new HubState({dataDir:dir,now:()=>clock.now,logger:silent}),queue=new HubQueue({hub});
 try{
 const pair=name=>hub.pair({pairingCode:hub.state.pairingCode,role:'node',name}).node,node=pair('甲'),other=pair('乙');
 const beat=(n,local={concurrency:1,active:0,queued:0,available:true})=>queue.heartbeat(n.id,{freeSlots:0,running:[],local,capabilities:{volunteerVersion:1}});
 hub.updateNodeSettings(node.id,{paused:true,maxConcurrency:1});hub.updateNodeSettings(other.id,{paused:true,maxConcurrency:1});beat(node);beat(other);
 const task=queue.submitTask({type:'panel-generation',projectId:'p',panelId:'f',panelCode:'f',prompt:'合成图',generationInput:{prompt:'合成图'},references:[],size:{w:64,h:48}}).task;
 assert.equal(queue.requestVolunteer(node.id,task.id).reused,false);assert.equal(queue.requestVolunteer(node.id,task.id).reused,true);assert.throws(()=>queue.requestVolunteer(other.id,task.id),/已有同事/);
 const stored=JSON.parse(fs.readFileSync(path.join(dir,'hub-state.json')));assert.equal(stored.tasks[0].volunteer.nodeId,node.id);hub.close();hub=new HubState({dataDir:dir,now:()=>clock.now,logger:silent});queue=new HubQueue({hub});assert.equal(queue.getTaskOrThrow(task.id).volunteer.nodeId,node.id);
 assert.equal(beat(node,{concurrency:1,active:1,queued:0,available:true}).assignments.length,0,'领取后本机变忙，应继续等待');
 clock.now+=31000;beat(other);assert.equal(queue.requestVolunteer(other.id,task.id).reused,false);const assignments=beat(other).assignments;assert.equal(assignments.length,1);assert.equal(assignments[0].manualHelp,true);assert.throws(()=>queue.requestVolunteer(node.id,task.id),/已被领取/);assert.equal(queue.getTaskOrThrow(task.id).attempts.length,1);
 }finally{hub.close();}
});
