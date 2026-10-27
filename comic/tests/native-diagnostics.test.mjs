import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {sanitizedNativeDiagnostics,bridgeError,JsonLineWorker} from '../lib/process.mjs';
import {createStudio} from '../server.mjs';
import {createProject as fixtureProject} from '../public/model.js';

test('native diagnostics retain bounded final reply and force explicit retry',()=>{
  const d=sanitizedNativeDiagnostics({classification:'completed_without_image',finalReply:'Bearer fake-secret '+ 'A'.repeat(13000),lastAgentReply:'last reply',replyPhase:'final_answer',finalReplyExplicit:true,replyCount:1,lastError:{code:'x',message:'sk-abcdefghi123'},remoteEnded:true,retry:{automatic:true,action:'review_and_explicit_resubmit'},imageStarted:-1});
  assert.equal(d.finalReply.length,12000);assert.equal(d.retry.automatic,false);assert.equal(d.imageStarted,0);
  assert.ok(!JSON.stringify(d).includes('fake-secret'));assert.ok(!JSON.stringify(d).includes('abcdefghi123'));
  assert.equal(d.lastAgentReply,'last reply');assert.equal(d.replyPhase,'final_answer');assert.equal(d.finalReplyExplicit,true);
  const e=bridgeError('missing',{code:'native_image_missing',diagnostics:d,generationEnded:true,requiredAction:d.retry.action});
  assert.equal(e.diagnostics.classification,'completed_without_image');assert.equal(e.generationEnded,true);assert.equal(e.requiredAction,'review_and_explicit_resubmit');
});

test('failed native job exposes diagnosis, retains original art and releases completed lease without retry',async t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'comic-native-diagnostic-'));
  let calls=0;
  const diagnosis=sanitizedNativeDiagnostics({classification:'completed_without_image',finalReply:'synthetic final reason',remoteEnded:true,turnStatus:'completed',retry:{action:'review_and_explicit_resubmit'}});
  const bridge={status:async()=>({connected:true,imageFeature:true}),generate:async()=>{calls++;throw bridgeError('synthetic no-image final reason',{code:'native_image_missing',diagnostics:diagnosis,generationEnded:true,requiredAction:'review_and_explicit_resubmit',mayHaveStarted:true});}};
  const studio=createStudio({dataDir:directory,maxConcurrent:2,bridge,seedReference:false});
  t.after(async()=>{studio.close();await new Promise(r=>studio.server.close(r));fs.rmSync(directory,{recursive:true,force:true});});
  await new Promise(r=>studio.server.listen(0,'127.0.0.1',r));
  const p=fixtureProject('synthetic diagnostic project',true),panel=p.pages.flatMap(p=>p.panels)[0];
  const originalFile=path.join(directory,'original.png');
  fs.writeFileSync(originalFile,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64'));
  studio.store.db.assets.push({id:'asset_11111111-1111-4111-8111-111111111111',name:'synthetic original',filePath:originalFile,width:1,height:1,mime:'image/png'});
  panel.imageAssetId='asset_11111111-1111-4111-8111-111111111111';
  studio.store.db.projects.push(p);studio.store.save();
  const original=panel.imageAssetId;
  const url=`http://127.0.0.1:${studio.server.address().port}`;
  const response=await fetch(url+'/api/jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({projectId:p.id,panelIds:[panel.id],provider:'codex'})});
  assert.equal(response.status,202);
  for(let i=0;i<100&&!studio.idle();i++)await new Promise(r=>setTimeout(r,10));
  const state=await (await fetch(url+'/api/state')).json(),job=state.jobs[0];
  assert.equal(job.status,'failed');assert.equal(job.errorCode,'native_image_missing');assert.equal(job.nativeDiagnostics.finalReply,'synthetic final reason');
  assert.equal(job.requiredAction,'review_and_explicit_resubmit');assert.equal(calls,1);
  assert.equal(studio.store.project(p.id).pages[0].panels[0].imageAssetId,original);
  assert.equal(studio.generationSlots.snapshot().running,0);assert.equal(studio.generationSlots.listRemote().length,0);
  assert.equal(JSON.parse(fs.readFileSync(path.join(directory,'studio.json'),'utf8')).jobs[0].nativeDiagnostics.finalReply,'synthetic final reason');
});

test('JSONL worker carries completed diagnosis and explicit action into a typed error',async t=>{
  const script=`require('node:readline').createInterface({input:process.stdin}).on('line',line=>{const r=JSON.parse(line);process.stdout.write(JSON.stringify({id:r.id,type:'error',code:'native_image_missing',message:'synthetic final reason',mayHaveStarted:true,generationEnded:true,requiredAction:'review_and_explicit_resubmit',diagnostics:{classification:'completed_without_image',finalReply:'synthetic reason Bearer fake-token',remoteEnded:true,retry:{automatic:true,action:'review_and_explicit_resubmit'}}})+'\\n');});`;
  const worker=new JsonLineWorker([process.execPath],['-e',script]);t.after(()=>worker.close());
  await assert.rejects(worker.request({action:'fake'}),e=>e.code==='native_image_missing'&&e.generationEnded===true&&e.requiredAction==='review_and_explicit_resubmit'&&e.diagnostics.retry.automatic===false&&!e.diagnostics.finalReply.includes('fake-token'));
});
