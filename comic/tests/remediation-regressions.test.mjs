import {createRequire} from 'node:module';
const context=createRequire(import.meta.url)(process.env.COMIC_TEST_CANVAS_MODULE).createCanvas(1,1).getContext('2d');
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createStudio} from '../server.mjs';
import {createProject,id} from '../public/model.js';
import {productionProject} from '../lib/production-package-document.mjs';
import {inspectProductionPackage} from '../lib/production-package.mjs';
import {syntheticFiles} from './helpers/two-screen-package.mjs';
import {placementRows,placementSettings,preparePlacement,placePreparedDialogue} from '../public/manual-dialogue-placement.js';
import {dialogueInventory} from '../public/dialogue-system.js';
import {productionReferenceVersions} from '../lib/production-reference-files.mjs';
async function fixture(t){
 const dataDir=fs.mkdtempSync(path.join(process.env.QUALITY_EVIDENCE_DIR,'storage-'));let calls=0;
 const bridge={close(){},status:async()=>({connected:true,imageFeature:true}),generate:async()=>{calls++;throw Error('Synthetic provider must not run during disk failure');}};
 const studio=createStudio({dataDir,bridge,jimengBridge:bridge,seedReference:false});
 await new Promise(r=>studio.server.listen(0,'127.0.0.1',r));t.after(()=>{studio.close();studio.server.closeAllConnections();studio.server.close();});
 const project=createProject('合成保存故障',true);studio.store.db.projects.push(project);studio.store.save();
 const api=async(route,method,body)=>{const r=await fetch('http://127.0.0.1:'+studio.server.address().port+route,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};};
 return {studio,project,api,calls:()=>calls};
}
test('写盘失败返回503且旧版本保持；同一份编辑重试成功并可从硬盘读回',async t=>{
 const {studio,project,api}=await fixture(t),store=studio.store,file=path.join(store.projectDir,project.id+'.json'),before=fs.readFileSync(file,'utf8'),write=store.writeProject.bind(store);
 store.writeProject=()=>{throw Object.assign(Error('SYNTHETIC_ENOSPC'),{code:'ENOSPC'});};
 const templates=JSON.stringify(store.db.episodeBoardTemplates);const input=structuredClone(project);input.title='修改后的标题';
 const failed=await api('/api/projects/'+project.id,'PUT',input);assert.equal(failed.status,503);assert.match(failed.body.error,/尚未保存/);assert.equal(store.project(project.id).revision,project.revision);assert.equal(fs.readFileSync(file,'utf8'),before);assert.equal(JSON.stringify(store.db.episodeBoardTemplates),templates);
 store.writeProject=write;const saved=await api('/api/projects/'+project.id,'PUT',input);assert.equal(saved.status,200);assert.equal(saved.body.revision,project.revision+1);assert.equal(JSON.parse(fs.readFileSync(file)).title,input.title);
 const conflict=await api('/api/projects/'+project.id,'PUT',{...input,title:'另一个窗口'});assert.equal(conflict.status,409);
});
test('拒绝未落盘的排队任务；磁盘恢复和定时调度都不能启动被拒绝的任务',async t=>{
 const f=await fixture(t),store=f.studio.store,write=store.writeProject.bind(store);store.writeProject=()=>{throw Error('SYNTHETIC_ENOSPC');};
 const result=await f.api('/api/jobs','POST',{projectId:f.project.id,panelIds:[f.project.pages[0].panels[0].id],expectedRevision:f.project.revision});
 assert.equal(result.status,503);assert.equal(f.calls(),0);assert.ok(store.db.jobs.every(j=>j.status==='failed'));assert.equal(JSON.parse(fs.readFileSync(store.file)).jobs.length,0);
 store.writeProject=write;assert.equal(store.save(),true);await new Promise(r=>setTimeout(r,1200));assert.equal(f.calls(),0);assert.ok(JSON.parse(fs.readFileSync(store.file)).jobs.every(j=>j.status==='failed'));
});
test('隐藏来源不重复列出；显式重摆隐藏台词后可见，锁定对象仍禁止移动',async()=>{
 const p=productionProject(await inspectProductionPackage(syntheticFiles())),page=p.pages[0],row=placementRows(p,page)[0],hidden=preparePlacement(context,row,placementSettings(p,page)).bubble;
 Object.assign(hidden,{visible:false,productionModeHidden:true,parentPanelId:page.panels[0].id});const visible={...structuredClone(hidden),id:id('bubble'),visible:true};delete visible.productionModeHidden;page.bubbles=[hidden,visible];
 let rows=placementRows(p,page);assert.equal(rows.length,dialogueInventory(p,row.segmentId,'episode').length);assert.equal(rows[0].bubbleId,visible.id);assert.equal(rows[0].placed,true);
 page.bubbles=[hidden];rows=placementRows(p,page);assert.equal(rows[0].placed,false);const prepared=preparePlacement(context,rows[0],placementSettings(p,page),{preserveExisting:true});const placed=placePreparedDialogue(p,rows[0],prepared.bubble,page,{x:400,y:500},page.panels[0]);assert.equal(placed.visible,true);assert.equal(placed.productionModeHidden,undefined);assert.equal(placed.id,hidden.id);
 placed.locked=true;assert.throws(()=>placePreparedDialogue(p,rows[0],prepared.bubble,page,{x:700,y:600},page.panels[0]),/解锁/);
 page.visible=false;assert.equal(placementRows(p,page)[0].placed,false);
});
test('屏段、底图、单格和裁格保留相同的参考版本和本地SHA',async()=>{
 const p=productionProject(await inspectProductionPackage(syntheticFiles())),segment=p.productionPackage.episodes[0].segments[0],assetId=id('asset'),sha256='a'.repeat(64);
 segment.references[0].binding={sourceType:'local',assetId,sha256,revisionId:'local-sha256:'+sha256};
 for(const frame of [{productionSegment:segment.id},{productionBackground:segment.id+'-BG'},{productionGrid:{segmentId:segment.id}},{panelSlice:{segmentId:segment.id}}]){
  const [version]=productionReferenceVersions(p,frame,[{assetId,name:'合成固定参考'}],[{id:assetId}]);assert.equal(version.sha256,sha256);assert.equal(version.sourceType,'local');assert.equal(version.revisionId,'local-sha256:'+sha256);
 }
});

test('工程已写而索引失败仍返回503；原请求重试不会陷入409或重复增加版本',async t=>{
 const {studio,project,api}=await fixture(t),store=studio.store,save=store.save.bind(store),input=structuredClone(project);input.title='合成索引失败';
 store.save=()=>false;
 const failed=await api('/api/projects/'+project.id,'PUT',input);assert.equal(failed.status,503);assert.equal(store.project(project.id).revision,project.revision+1);
 store.save=save;const retry=await api('/api/projects/'+project.id,'PUT',input);assert.equal(retry.status,200);assert.equal(retry.body.revision,project.revision+1);assert.equal(retry.body.title,input.title);assert.equal(store.lastSaveError,null);
});
test('执行开始状态落盘失败时不调用通道；已接受的队列在存储恢复后继续一次',async t=>{
 const f=await fixture(t),store=f.studio.store,save=store.save.bind(store);let writes=0;
 store.save=()=>{writes++;if(writes===3){store.lastSaveError='SYNTHETIC_START_WRITE_FAILURE';return false;}return save();};
 const result=await f.api('/api/jobs','POST',{projectId:f.project.id,panelIds:[f.project.pages[0].panels[0].id],expectedRevision:f.project.revision});
 assert.equal(result.status,202);assert.equal(f.calls(),0);assert.equal(store.db.jobs[0].status,'queued');assert.equal(JSON.parse(fs.readFileSync(store.file)).jobs[0].status,'queued');
 store.save=save;for(let i=0;i<60&&!f.calls();i++)await new Promise(r=>setTimeout(r,30));assert.equal(f.calls(),1);
});
