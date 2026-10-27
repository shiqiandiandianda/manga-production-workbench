import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {createStudio} from '../server.mjs';
import {syntheticFiles} from './fixtures/production-synthetic.mjs';
import {productionFrame} from '../public/production-package-model.js';
const require=createRequire(import.meta.url),{createCanvas}=require(process.env.COMIC_TEST_CANVAS_MODULE),evidence=fileURLToPath(new URL('../../verification/generated-result-return-20261022/',import.meta.url));
fs.mkdirSync(evidence,{recursive:true});
const image=color=>{const canvas=createCanvas(256,768),context=canvas.getContext('2d');context.fillStyle=color;context.fillRect(0,0,256,768);return canvas.toBuffer('image/png');};
async function fixture(t){
 const dir=fs.mkdtempSync(path.join(evidence,'fixture-'));let release;const gate=new Promise(resolve=>release=resolve),calls=[];
 const studio=createStudio({dataDir:path.join(dir,'data'),seedReference:false,bridge:{close(){},status:async()=>({connected:true,imageFeature:true}),ensurePoolSize(){},async generate(_dir,input){calls.push(structuredClone(input));await gate;return {bytes:image('#a68758'),imageToolSeen:true};}},jimengBridge:{close(){}}});
 await new Promise(resolve=>studio.server.listen(0,'127.0.0.1',resolve));t.after(()=>{release();studio.close();studio.server.closeAllConnections();});
 const origin='http://127.0.0.1:'+studio.server.address().port;
 const api=async(route,body,method=body?'POST':'GET')=>{const response=await fetch(origin+route,{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined}),value=await response.json();assert.ok(response.ok,JSON.stringify(value));return value;};
 const scan=await api('/api/production-packages/scan',{files:syntheticFiles().map(f=>({relativePath:f.relativePath,dataBase64:f.bytes.toString('base64')}))}),project=await api('/api/production-packages/import',{scanId:scan.scanId}),assets=[];
 for(const [name,color] of [['测试人物_黑衣','#657897'],['前段原图','#887c63'],['前段新图','#6c9959']]){const filePath=path.join(dir,name+'.png');fs.writeFileSync(filePath,image(color));assets.push(await api('/api/assets',{filePath,name}));}
 Object.assign(studio.store.asset(assets[0].id),{libraryRole:'character',libraryName:'测试人物',libraryState:'黑衣'});studio.store.save();
 await api('/api/projects/'+project.id+'/production/bind',{expectedRevision:studio.store.project(project.id).revision,segmentId:'E011-S001',slot:0,assetId:assets[0].id,applyMatching:true});
 await api('/api/projects/'+project.id+'/panels/'+productionFrame(studio.store.project(project.id),'E011-S001').id+'/image',{assetId:assets[1].id});
 return {dir,studio,api,assets,calls,release,get project(){return studio.store.project(project.id);}};
}
async function until(predicate){for(let i=0;i<200;i++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,20));}throw Error('合成生成任务未结束');}
for(const change of ['derived-cache','prompt','previous-image'])test(`整屏生成回填按实际接续引用校验：${change}`,{timeout:15000},async t=>{
 const f=await fixture(t),target=productionFrame(f.project,'E011-S002');await f.api('/api/jobs',{projectId:f.project.id,panelIds:[target.id],provider:'codex'});await until(()=>f.calls.length===1);assert.equal(f.calls[0].referenceRoles.length,2);
 if(change==='previous-image')await f.api('/api/projects/'+f.project.id+'/panels/'+productionFrame(f.project,'E011-S001').id+'/image',{assetId:f.assets[2].id});
 else{
  const stale=structuredClone(f.project),frame=productionFrame(stale,'E011-S002');
  if(change==='derived-cache'){frame.referenceIds=frame.referenceIds.filter(id=>id!==f.assets[1].id);frame.generation.referenceRoles=frame.generation.referenceRoles.filter(ref=>ref.assetId!==f.assets[1].id);}
  else frame.generation.promptSource='post-lettering';
  await f.api('/api/projects/'+f.project.id,stale,'PUT');
 }
 f.release();await until(()=>f.studio.store.db.jobs.at(-1)?.status==='done');const job=f.studio.store.db.jobs.at(-1),frame=productionFrame(f.project,'E011-S002');
 if(change==='derived-cache'){
  assert.equal(job.applied,true);assert.equal(frame.imageAssetId,job.assetId);assert.deepEqual(job.autoApplyBlocked,[]);assert.ok(frame.referenceIds.includes(f.assets[1].id));
 }else{
  assert.equal(job.applied,false);assert.equal(frame.imageAssetId,null);assert.ok(frame.candidates.includes(job.assetId));assert.ok(job.autoApplyBlocked.some(message=>/内容|绑定/.test(message)));
  if(change==='prompt'){
   await f.api('/api/projects/'+f.project.id+'/panels/'+frame.id+'/image',{assetId:job.assetId});assert.equal(job.applied,true);assert.ok(job.previousAutoApplyBlocked.length);assert.deepEqual(job.autoApplyBlocked,[]);assert.match(job.message,/已采用/);
   const current=productionFrame(f.project,'E011-S002');current.imageTransform={x:31,y:47,scale:.7};f.studio.store.save();await f.api('/api/projects/'+f.project.id+'/panels/'+frame.id+'/image',{assetId:job.assetId});assert.deepEqual(productionFrame(f.project,'E011-S002').imageTransform,{x:31,y:47,scale:.7});
  }
 }
 fs.writeFileSync(path.join(f.dir,'result.json'),JSON.stringify({change,applied:job.applied,blocked:job.autoApplyBlocked},null,2));
});
