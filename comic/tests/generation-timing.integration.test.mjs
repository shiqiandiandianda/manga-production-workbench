import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createStudio} from '../server.mjs';
import {createProject} from '../public/model.js';
import {formatJobTime} from '../public/job-timing.js';
const root=fileURLToPath(new URL('../',import.meta.url)),png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));

test('真实服务事件管线保存生图完成与调度档位，生成结果仍按原规则采用',{timeout:10000},async t=>{
 const tempRoot=path.join(root,'test-temp');fs.mkdirSync(tempRoot,{recursive:true});const directory=fs.mkdtempSync(path.join(tempRoot,'generation-timing-api-'));
 const bridge={close(){},status:async()=>({connected:true,imageFeature:true}),generate:async(_directory,_input,_references,{onProgress})=>{
  onProgress('mock references',{phase:'reference',stage:'turn/start'});await delay(20);
  onProgress('mock native image',{phase:'generating',stage:'image_generation',dispatchEffort:'low'});await delay(20);
  onProgress('mock image complete',{phase:'reading',stage:'image_generation_completed',imageGenerationMs:20});await delay(10);
  return {bytes:png,imageToolSeen:true,timings:{prepareMs:1,nativeMs:40,totalMs:50,preImageMs:20,imageGenerationMs:20,outputMs:10,dispatchEffort:'low'}};
 }};
 const studio=createStudio({dataDir:directory,maxConcurrent:1,bridge,jimengBridge:{close(){},status:async()=>({connected:false})},storyboardGenerator:{close(){}}});
 await new Promise(resolve=>studio.server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+studio.server.address().port;
 t.after(async()=>{studio.close();await new Promise(resolve=>studio.server.close(resolve));assert.equal(path.dirname(path.resolve(directory)),path.resolve(tempRoot));assert.ok(path.basename(directory).startsWith('generation-timing-api-'));fs.rmSync(directory,{recursive:true,force:true});});
 const project=createProject('合成生图阶段时长');studio.store.db.projects.push(project);studio.store.save();const panel=project.pages[0].panels[0];
 const response=await fetch(origin+'/api/jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({projectId:project.id,panelIds:[panel.id],provider:'codex'})});assert.equal(response.status,202,await response.text());
 let job;for(let attempt=0;attempt<100;attempt++){job=(await (await fetch(origin+'/api/state')).json()).jobs[0];if(job.status==='done')break;await delay(10);}
 assert.equal(job.status,'done');assert.ok(job.generationStartedAt);assert.ok(job.generationCompletedAt);assert.ok(Date.parse(job.generationCompletedAt)>=Date.parse(job.generationStartedAt));
 assert.equal(job.imageGenerationMs,20);assert.equal(job.timings.imageGenerationMs,20);assert.equal(job.dispatchEffort,'low');assert.equal(job.applied,true);assert.equal(panel.imageAssetId,job.assetId);
 const display=formatJobTime(job);assert.match(display,/总处理.*包含以下阶段.*生图前.*生图.*收尾/);
});
