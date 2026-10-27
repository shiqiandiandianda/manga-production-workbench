import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {createComicFixture,seedProject} from './helpers/collab-fixture.mjs';
import {createProductionWorkspace} from '../../asset-studio/app/roles/production-workspace.mjs';
test('强制升级停止当前漫画及排队任务，保存取消状态、工程和已有参考原图',async t=>{
 const f=await createComicFixture(t,{maxConcurrent:1}),seed=await seedProject(f,{panelCount:3,referenceCount:1}),before=fs.readFileSync(seed.assets[0].filePath),release=f.holdNext();
 const response=await f.api('/api/jobs','POST',{projectId:seed.project.id,panelIds:seed.panels.map(p=>p.id)});assert.equal(response.status,202,JSON.stringify(response.value));await f.waitForCalls(1);f.studio.forceStop();release();
 const db=JSON.parse(fs.readFileSync(path.join(f.dataDir,'studio.json')));assert.ok(db.jobs.length>=3);assert.ok(db.jobs.every(j=>j.status==='cancelled'));assert.deepEqual(fs.readFileSync(seed.assets[0].filePath),before);assert.ok(db.projectOrder.includes(seed.project.id));assert.ok(seed.panels.every(p=>!p.imageAssetId));
});

test('资产工作室强制升级保留已有组件，停止待生成组件和自动反打',()=>{
 const base=path.resolve(import.meta.dirname,'../../verification/forced-upgrades-20261024'),dataDir=(fs.mkdirSync(base,{recursive:true}),fs.mkdtempSync(path.join(base,'asset-stop-')));fs.mkdirSync(path.join(dataDir,'production-records'));const index=path.join(dataDir,'production-records/index.json'),original=[{id:'a',type:'scene',status:'running',phases:{'scene-front':{status:'running'}},slots:{reference:{file:'KEEP.png'}}},{id:'b',status:'completed',phases:{views:{status:'done'}},slots:{views:{file:'DONE.png'}}}];fs.writeFileSync(index,JSON.stringify(original));
 const old=process.env.ASSET_CANVAS_MODULE;process.env.ASSET_CANVAS_MODULE||=path.resolve(import.meta.dirname,'../../runtime/node/node_modules/@napi-rs/canvas');try{const production=createProductionWorkspace({root:dataDir,dataDir,editorJson:async()=>{throw Error('不应发起任务');},generationClient:{enabled:false}});production.forceStop();const result=JSON.parse(fs.readFileSync(index));assert.equal(result[0].status,'cancelled');assert.equal(result[0].sceneReverseSubmitted,true);assert.deepEqual(result[0].slots,original[0].slots);assert.deepEqual(result[1],{...original[1],teamBusy:false});production.close();}finally{if(old===undefined)delete process.env.ASSET_CANVAS_MODULE;else process.env.ASSET_CANVAS_MODULE=old;}
});
