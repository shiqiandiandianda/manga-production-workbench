import {createProject as fixtureProject} from '../public/model.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import {createStudio} from '../server.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const pixel=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64');
function png(width,height){
 const crc=bytes=>{let value=0xffffffff;for(const byte of bytes){value^=byte;for(let i=0;i<8;i++)value=value&1?(value>>>1)^0xedb88320:value>>>1;}return (value^0xffffffff)>>>0;};
 const chunk=(type,data)=>{const name=Buffer.from(type),result=Buffer.alloc(data.length+12);result.writeUInt32BE(data.length);name.copy(result,4);data.copy(result,8);result.writeUInt32BE(crc(Buffer.concat([name,data])),data.length+8);return result;};
 const header=Buffer.alloc(13);header.writeUInt32BE(width,0);header.writeUInt32BE(height,4);header[8]=8;header[9]=6;
 return Buffer.concat([pixel.subarray(0,8),chunk('IHDR',header),chunk('IDAT',deflateSync(Buffer.alloc(height*(1+width*4),255))),chunk('IEND',Buffer.alloc(0))]);
}
async function fixture(t,{generate}={}){
 fs.mkdirSync(path.join(root,'.runtime'),{recursive:true});
 const directory=fs.mkdtempSync(path.join(root,'.runtime','jimeng-api-tests-')),calls=[],submitId=randomUUID();
 const jimeng={status:async()=>({provider:'jimeng',installed:true,connected:true,version:'1.0.2',message:'mock',login:{running:false}}),models:async()=>({items:[{model:'discovered-model',modes:[]}]}),publicLogin:()=>({running:false}),publicState:s=>({canvasId:s.canvasId,nodeId:s.nodeId,submitId:s.submitId,operationRef:s.submitId}),resumeState:()=>({submissionAttempted:true,recovery:{submitId,nodeId:'node_mock',operationRef:submitId}}),close(){},generate:async(dir,input,refs,options)=>{calls.push({dir,input,refs,options});if(generate)return generate(dir,input,refs,options);if(options.approvalCeiling!==undefined)return {bytes:pixel,provider:'jimeng',recovery:{submitId,operationRef:submitId}};return {awaitingConfirmation:true,quote:{items:[{nodeId:'node_mock',maxCredits:120}],totalMaxCredits:120,confirmationRequired:true,confirmable:true},recovery:{submitId,nodeId:'node_mock'}};}};
 const studio=createStudio({dataDir:directory,bridge:{status:async()=>({connected:false,message:'Codex mock unused'})},jimengBridge:jimeng,seedReference:false});studio.store.db.projects.push(fixtureProject('隔离回归样本',true));studio.store.save();
 await new Promise(resolve=>studio.server.listen(0,'127.0.0.1',resolve));const url='http://127.0.0.1:'+studio.server.address().port;
 t.after(async()=>{studio.close();await new Promise(resolve=>studio.server.close(resolve));const resolved=path.resolve(directory);assert.equal(path.dirname(resolved),path.resolve(path.join(root,'.runtime')));assert.ok(path.basename(resolved).startsWith('jimeng-api-tests-'));fs.rmSync(resolved,{recursive:true,force:true});});
 const request=async(route,method='GET',body)=>{const response=await fetch(url+route,{method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});return {status:response.status,data:await response.json()};};
 const settled=async()=>{for(let i=0;i<100;i++){const state=(await request('/api/state')).data;if(state.jobs.every(j=>!['running','queued'].includes(j.status)))return state;await new Promise(resolve=>setTimeout(resolve,5));}throw new Error('Mock job did not settle');};
 return {studio,jimeng,request,calls,settled,directory};
}
test('即梦API状态/实时目录与生成provider可独立连接，审批前没有图片',async t=>{
 const f=await fixture(t),project=f.studio.store.db.projects[0],panel=project.pages[0].panels[0];
 assert.equal((await f.request('/api/jimeng/status')).data.provider,'jimeng');assert.equal((await f.request('/api/jimeng/models')).data.items[0].model,'discovered-model');
 assert.equal((await f.request('/api/jobs','POST',{projectId:project.id,panelIds:[panel.id],provider:'jimeng',model:'discovered-model',mode:'t2i'})).status,202);
 let state=await f.settled(),job=state.jobs[0];assert.equal(job.status,'awaiting_confirmation');assert.equal(state.assets.length,0);assert.equal(job.provider,'jimeng');assert.ok(!Object.hasOwn(job,'input'));
 assert.equal((await f.request('/api/jobs/'+job.id+'/approve','POST',{creditCeiling:120})).status,400);assert.equal((await f.request('/api/jobs/'+job.id+'/approve','POST',{approved:true,creditCeiling:119})).status,409);assert.equal(f.calls.length,1);
 assert.equal((await f.request('/api/jobs/'+job.id+'/approve','POST',{approved:true,creditCeiling:120})).status,202);state=await f.settled();assert.equal(state.jobs[0].status,'done');assert.equal(state.assets[0].source,'jimeng');assert.equal(f.calls[1].options.approvalCeiling,120);
});
test('恢复接口只指定recoveryOnly，不批准新积分',async t=>{
 const f=await fixture(t,{generate:async(dir,input,refs,options)=>options.recoveryOnly?{bytes:pixel,provider:'jimeng'}:Promise.reject(Object.assign(new Error('unknown submission'),{recoverable:true,requiredAction:'resume'}))}),project=f.studio.store.db.projects[0],panel=project.pages[0].panels[0];
 await f.request('/api/jobs','POST',{projectId:project.id,panelIds:[panel.id],provider:'jimeng',model:'discovered-model',mode:'t2i'});let state=await f.settled(),job=f.studio.store.db.jobs[0];job.recovery={submitId:randomUUID()};f.studio.store.save();assert.equal(state.jobs[0].status,'recoverable');
 assert.equal((await f.request('/api/jobs/'+job.id+'/resume','POST',{})).status,202);state=await f.settled();assert.equal(state.jobs[0].status,'done');assert.equal(f.calls[1].options.recoveryOnly,true);assert.equal(f.calls[1].options.approvalCeiling,undefined);
});
test('局部重绘快照按页坐标精确校验，不把裁图误当整页或截断长页',async t=>{
 const patch=png(20,20),f=await fixture(t,{generate:async(dir,input)=>({bytes:patch,alignedBytes:patch,provider:'jimeng'})}),project=f.studio.store.db.projects[0],page=project.pages[0],panel=page.panels[0];page.height=90000;Object.assign(panel,{x:0,y:70000,w:20,h:20,points:[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}]});
 const original=path.join(f.studio.store.root,'original.png');fs.writeFileSync(original,pixel);const asset=(await f.request('/api/assets','POST',{filePath:original,name:'mock'})).data;await f.request('/api/projects/'+project.id+'/panels/'+panel.id+'/image','POST',{assetId:asset.id});
 const payload={projectId:project.id,panelIds:[panel.id],provider:'jimeng',model:'discovered-model',mode:'i2i',action:'edit',editPrompt:'改光线',basePanelDataUrl:'data:image/png;base64,'+patch.toString('base64'),baseRegion:{x:0,y:70000,w:20,h:20}};
 assert.equal((await f.request('/api/jobs','POST',{...payload,baseRegion:{...payload.baseRegion,y:0}})).status,409);assert.equal(f.calls.length,0);
 assert.equal((await f.request('/api/jobs','POST',payload)).status,202);const state=await f.settled();assert.equal(state.jobs[0].status,'done');assert.deepEqual(f.calls[0].input.cropBox,[0,70000,20,20]);assert.ok(f.calls[0].input.basePanelPath);assert.equal(f.calls[0].input.basePagePath,undefined);assert.equal(state.projects[0].pages[0].height,90000);
});
test('图内文字字段能保存且校验，既有sfx/system图层不会被提示词变更删除',async t=>{
 const f=await fixture(t),project=structuredClone(f.studio.store.db.projects[0]);project.shots[0].embeddedTexts=[{type:'sign',text:'霓虹酒馆',placement:'门上方'}];
 const before=structuredClone(project.pages[0].bubbles);assert.equal((await f.request('/api/projects/'+project.id,'PUT',project)).status,200);
 let saved=(await f.request('/api/state')).data.projects[0];assert.deepEqual(saved.shots[0].embeddedTexts,project.shots[0].embeddedTexts);assert.deepEqual(saved.pages[0].bubbles,before);
 saved.shots[0].embeddedTexts=[{text:123}];assert.equal((await f.request('/api/projects/'+project.id,'PUT',saved)).status,400);
});

test('重绘等待时同一资产迁到相同内容的缓存路径，不误拦截结果',async t=>{
 let release;const held=new Promise(resolve=>release=resolve),patch=png(20,20),f=await fixture(t,{generate:async()=>{await held;return {bytes:patch,alignedBytes:patch,provider:'jimeng'};}}),project=f.studio.store.db.projects[0],panel=project.pages[0].panels[0];Object.assign(panel,{x:0,y:0,w:20,h:20,points:[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}]});
 const before=path.join(f.studio.store.root,'before.png'),after=path.join(f.studio.store.root,'after.png');fs.writeFileSync(before,patch);fs.writeFileSync(after,patch);const asset=(await f.request('/api/assets','POST',{filePath:before})).data;await f.request(`/api/projects/${project.id}/panels/${panel.id}/image`,'POST',{assetId:asset.id});
 const queued=await f.request('/api/jobs','POST',{projectId:project.id,panelIds:[panel.id],provider:'jimeng',model:'discovered-model',mode:'i2i',action:'edit',editPrompt:'调整光线',basePanelDataUrl:'data:image/png;base64,'+patch.toString('base64'),baseRegion:{x:0,y:0,w:20,h:20}});assert.equal(queued.status,202);
 assert.equal((await f.request('/api/assets/'+asset.id+'/path','PUT',{filePath:after})).status,200);release();const state=await f.settled();assert.equal(state.jobs[0].status,'done');assert.equal(state.jobs[0].applied,true);assert.equal(state.projects[0].pages[0].panels[0].imageAssetId,state.jobs[0].assetId);
});
test('重绘等待时原图内容改变，结果只进候选并保留当前原图',async t=>{
 let release;const held=new Promise(resolve=>release=resolve),patch=png(20,20),f=await fixture(t,{generate:async()=>{await held;return {bytes:patch,alignedBytes:patch,provider:'jimeng'};}}),project=f.studio.store.db.projects[0],panel=project.pages[0].panels[0];Object.assign(panel,{x:0,y:0,w:20,h:20,points:[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}]});
 const before=path.join(f.studio.store.root,'before.png'),after=path.join(f.studio.store.root,'after.png');fs.writeFileSync(before,patch);fs.writeFileSync(after,Buffer.concat([patch,Buffer.from('changed')]));
 const asset=(await f.request('/api/assets','POST',{filePath:before})).data;await f.request(`/api/projects/${project.id}/panels/${panel.id}/image`,'POST',{assetId:asset.id});
 const queued=await f.request('/api/jobs','POST',{projectId:project.id,panelIds:[panel.id],provider:'jimeng',model:'discovered-model',mode:'i2i',action:'edit',editPrompt:'调整光线',basePanelDataUrl:'data:image/png;base64,'+patch.toString('base64'),baseRegion:{x:0,y:0,w:20,h:20}});assert.equal(queued.status,202);
 assert.equal((await f.request('/api/assets/'+asset.id+'/path','PUT',{filePath:after})).status,200);release();const state=await f.settled();assert.equal(state.jobs[0].status,'done');assert.equal(state.jobs[0].applied,false);assert.equal(state.projects[0].pages[0].panels[0].imageAssetId,asset.id);assert.ok(state.projects[0].pages[0].panels[0].candidates.includes(state.jobs[0].assetId));
});

test('恢复原任务回到积分确认后，approve切回运行路径且保留同一submit',async t=>{
 const submitId=randomUUID(),nodeId='node_'+randomUUID();let accepted=0;
 const f=await fixture(t,{generate:async(dir,input,refs,options)=>{
   const recovery={submitId,nodeId,operationRef:submitId};
   if(options.recoveryOnly)return {awaitingConfirmation:true,quote:{items:[{nodeId,maxCredits:120}],totalMaxCredits:120,confirmationRequired:true,confirmable:true},recovery};
   if(options.approvalCeiling===120){accepted++;return {bytes:pixel,provider:'jimeng',recovery};}
   options.onProgress('提交结果尚未确认',{phase:'generating',recovery});throw Object.assign(new Error('unknown submission'),{recoverable:true,requiredAction:'resume'});
 }}),project=f.studio.store.db.projects[0],panel=project.pages[0].panels[0];
 await f.request('/api/jobs','POST',{projectId:project.id,panelIds:[panel.id],provider:'jimeng',model:'discovered-model',mode:'t2i'});let state=await f.settled(),job=state.jobs[0];assert.equal(job.status,'recoverable');assert.equal(job.recovery.submitId,submitId);
 assert.equal((await f.request('/api/jobs/'+job.id+'/resume','POST',{})).status,202);state=await f.settled();assert.equal(state.jobs[0].status,'awaiting_confirmation');assert.equal(f.calls[1].options.recoveryOnly,true);assert.equal(accepted,0);
 assert.equal((await f.request('/api/jobs/'+job.id+'/approve','POST',{approved:true,creditCeiling:120})).status,202);state=await f.settled();assert.equal(state.jobs[0].status,'done');assert.equal(f.calls[2].options.recoveryOnly,false);assert.equal(accepted,1);assert.equal(state.jobs.length,1);assert.equal(state.jobs[0].recovery.submitId,submitId);assert.equal(f.calls[0].dir,f.calls[2].dir);
});

test('尚未run的保存恢复入口保留旧节点，只到新报价并清除旧批准上限',async t=>{
 const submitId=randomUUID(),nodeId='node_'+randomUUID();let accepted=0;const recovery={submitId,nodeId};
 const f=await fixture(t,{generate:async(dir,input,refs,options)=>{
   if(options.preparationOnly)return {awaitingConfirmation:true,quote:{items:[{nodeId,maxCredits:120}],totalMaxCredits:120,confirmationRequired:false,confirmable:true},recovery};
   if(options.approvalCeiling===120){accepted++;return {bytes:pixel,provider:'jimeng',recovery};}
   throw Object.assign(new Error('save response lost'),{recoverable:true,requiredAction:'resume',recovery});
 }});
 f.jimeng.resumeState=()=>({submissionAttempted:false,recovery});const project=f.studio.store.db.projects[0],panel=project.pages[0].panels[0];
 await f.request('/api/jobs','POST',{projectId:project.id,panelIds:[panel.id],provider:'jimeng',model:'discovered-model',mode:'t2i'});let state=await f.settled(),job=f.studio.store.db.jobs[0];assert.equal(state.jobs[0].status,'recoverable');assert.equal(job.recovery.nodeId,nodeId);job.approvalCeiling=999;f.studio.store.save();
 assert.equal((await f.request('/api/jobs/'+job.id+'/resume','POST',{})).status,202);state=await f.settled();assert.equal(state.jobs[0].status,'awaiting_confirmation');assert.equal(f.calls[1].options.recoveryOnly,false);assert.equal(f.calls[1].options.preparationOnly,true);assert.equal(f.calls[1].options.approvalCeiling,undefined);assert.equal(accepted,0);assert.equal(state.assets.length,0);
 assert.equal((await f.request('/api/jobs/'+job.id+'/approve','POST',{approved:true,creditCeiling:120})).status,202);state=await f.settled();assert.equal(state.jobs[0].status,'done');assert.equal(f.calls[2].options.preparationOnly,false);assert.equal(accepted,1);assert.equal(state.jobs[0].recovery.nodeId,nodeId);assert.equal(state.jobs[0].recovery.submitId,submitId);assert.equal(state.jobs.length,1);
});

test('重新批准与恢复清除旧完成和错误字段，只有已提交恢复保留原生图开始时间',async t=>{
 const previousGeneration='2026-10-08T08:29:00.000Z',previousCompletion='2026-10-08T08:30:00.000Z';
 for(const action of ['approve','submitted-resume','preparation-resume']){
   let release;const gate=new Promise(resolve=>release=resolve),submitId=randomUUID(),recovery={submitId,nodeId:'node_0123456789',operationRef:submitId};
   const quote={items:[{nodeId:recovery.nodeId,maxCredits:120}],totalMaxCredits:120,confirmationRequired:true,confirmable:true};
   const f=await fixture(t,{generate:async(dir,input,refs,options)=>{
     const continued=options.approvalCeiling!==undefined||options.recoveryOnly||options.preparationOnly;
     if(!continued){if(action==='approve')return {awaitingConfirmation:true,quote,recovery};throw Object.assign(new Error('interrupted'),{recoverable:true,recovery,requiredAction:'resume'});}
     options.onProgress('mock continued',{phase:options.preparationOnly?'quoting':'generating',recovery});await gate;
     return options.preparationOnly?{awaitingConfirmation:true,quote,recovery}:{bytes:pixel,provider:'jimeng',recovery};
   }});
   f.jimeng.resumeState=()=>({submissionAttempted:action==='submitted-resume',recovery});
   const project=f.studio.store.db.projects[0],panel=project.pages[0].panels[0];
   await f.request('/api/jobs','POST',{projectId:project.id,panelIds:[panel.id],provider:'jimeng',model:'discovered-model',mode:'t2i'});await f.settled();
   const job=f.studio.store.db.jobs[0];Object.assign(job,{completedAt:previousCompletion,generationStartedAt:previousGeneration,errorDetails:{message:'old failure'},errorCode:'old_error',requiredAction:'inspect',validation:{reasonCode:'old'},protocol:{outputKind:'old'},elapsedMs:-1,timings:{old:true}});f.studio.store.save();
   const before=Date.now(),route='/api/jobs/'+job.id+'/'+(action==='approve'?'approve':'resume'),result=await f.request(route,'POST',action==='approve'?{approved:true,creditCeiling:120}:{});
   try{
     assert.equal(result.status,202);const active=(await f.request('/api/state')).data.jobs[0];assert.equal(active.status,'running');assert.ok(Date.parse(active.startedAt)>=before);
     for(const key of ['completedAt','errorDetails','validation','protocol','timings'])assert.equal(Object.hasOwn(active,key),false,action+': stale '+key);
     assert.notEqual(active.errorCode,'old_error');assert.notEqual(active.requiredAction,'inspect');assert.notEqual(active.elapsedMs,-1);
     if(action==='submitted-resume')assert.equal(active.generationStartedAt,previousGeneration);
     else if(action==='preparation-resume')assert.equal(Object.hasOwn(active,'generationStartedAt'),false);
     else assert.ok(Date.parse(active.generationStartedAt)>=before);
   }finally{release();}
   const completed=(await f.settled()).jobs[0];
   if(action==='preparation-resume')assert.equal(Object.hasOwn(completed,'completedAt'),false);
   else assert.ok(Date.parse(completed.completedAt)>=Date.parse(completed.startedAt));
 }
});
