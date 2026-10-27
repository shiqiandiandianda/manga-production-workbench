import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createStudio} from '../../server.mjs';
import {createProject} from '../../public/model.js';
import {listenForFetch} from '../../tests/helpers/listen-for-fetch.mjs';
const {createCanvas}=createRequire(import.meta.url)(process.env.COMIC_TEST_CANVAS_MODULE);

async function fixture(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'repair-'));
  const fake={close(){},status:async()=>({connected:false}),generate(){assert.fail('real generation prohibited');}};
  const studio=createStudio({dataDir:dir,bridge:fake,jimengBridge:fake,seedReference:false});
  const origin=await listenForFetch(studio.server);
  t.after(()=>{studio.close();studio.server.closeAllConnections();});
  const canvas=createCanvas(80,60),file=path.join(dir,'source.png');
  canvas.getContext('2d').fillRect(0,0,80,60);fs.writeFileSync(file,canvas.toBuffer('image/png'));
  const request=async(route,input)=>{const response=await fetch(origin+route,{method:input?'POST':'GET',headers:input?{'Content-Type':'application/json'}:undefined,body:input?JSON.stringify(input):undefined});return {status:response.status,body:await response.json()};};
  const api=async(...args)=>{const result=await request(...args);assert.ok(result.status<300,JSON.stringify(result));return result.body;};
  const asset=await api('/api/assets',{filePath:file}),project=createProject('合成修图工程'),panel=project.pages[0].panels[0];
  panel.imageAssetId=asset.id;panel.imageTransform={x:0,y:0,scale:16};studio.store.db.projects.push(project);studio.store.save();
  const session=await api('/api/integrated-repair/sessions',{projectId:project.id,panelId:panel.id,expectedRevision:project.revision});
  const result=await api('/repair/api/exports',{sourceId:session.metadata.id,sourceRevision:0,layers:[],exportMode:'repaired'});
  return {dir,studio,project,panel,request,session,result,apply:extra=>request('/api/integrated-repair/sessions/'+session.session.id+'/apply',{resultUrl:result.url,expectedRevision:project.revision,...extra})};
}
test('同页修图回写有回执，重复提交不重复产生资产',async t=>{const f=await fixture(t),result=await f.apply();assert.equal(result.status,200);assert.equal(result.body.applied,true);const count=f.studio.store.db.assets.length,revision=f.project.revision;const retry=await f.apply();assert.equal(retry.status,200);assert.equal(retry.body.asset.id,result.body.asset.id);assert.equal(f.studio.store.db.assets.length,count);assert.equal(f.project.revision,revision);});
test('取景变化后保留候选，不能覆盖原画格',async t=>{const f=await fixture(t);f.panel.imageTransform.x=12;const result=await f.apply();assert.equal(result.status,200);assert.equal(result.body.applied,false);assert.equal(f.panel.imageTransform.x,12);assert.ok(f.panel.candidates.includes(result.body.asset.id));});
test('旧工程版本和路径穿越被拒绝，已生成结果保留',async t=>{const f=await fixture(t),old=f.project.revision;f.project.revision++;assert.equal((await f.apply({expectedRevision:old})).status,409);assert.ok(fs.existsSync(path.join(f.dir,'repair/exports',path.basename(decodeURIComponent(new URL(f.result.url,'http://local').pathname)))));assert.equal((await f.apply({resultUrl:'/repair/exports/../../studio.json',expectedRevision:f.project.revision})).status,400);});
test('格子删除后迟到回写不会重建格子',async t=>{const f=await fixture(t);f.project.pages[0].panels=[];assert.equal((await f.apply()).status,409);assert.equal(f.project.pages[0].panels.length,0);});
test('无效和不存在的修图源版本明确拒绝，不生成额外结果',async t=>{const f=await fixture(t),before=fs.readdirSync(path.join(f.dir,'repair/exports'));for(const [revision,status] of [[-1,400],[999,404]]){const result=await f.request('/repair/api/exports',{sourceId:f.session.metadata.id,sourceRevision:revision,layers:[],exportMode:'repaired'});assert.equal(result.status,status);}assert.deepEqual(fs.readdirSync(path.join(f.dir,'repair/exports')),before);assert.equal(f.studio.store.db.jobs.length,0);});
