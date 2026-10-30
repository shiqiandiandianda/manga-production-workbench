import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
import {createStudio} from '../server.mjs';
import {createProject,panel,id,clone} from '../public/model.js';
import {migrateLayerDocument} from '../public/layers.js';
import {ensureProjectPanelGeneration} from '../public/panel-generation.js';
import {panelCancellationJobs} from '../public/canvas-panel-cancel.js';

const require=createRequire(import.meta.url);
const {chromium}=require(process.env.COMIC_TEST_PLAYWRIGHT_MODULE||'playwright'),{createCanvas}=require(process.env.COMIC_TEST_CANVAS_MODULE||'@napi-rs/canvas');
const proof=path.resolve('../../verification/panel-cancel-20261030');fs.mkdirSync(proof,{recursive:true});
const until=async predicate=>{for(let i=0;i<400;i++){if(await predicate())return;await new Promise(r=>setTimeout(r,20));}throw Error('等待单格取消验收超时');};

test('单格取消仅选择当前工程当前格的可取消任务，保留历史和其他工程',()=>{
 const p={id:'current'},states=['queued','running','awaiting_confirmation','recoverable','delegated','done','failed','cancelled'],jobs=states.map((status,i)=>({id:'job'+i,projectId:p.id,panelId:'frame',status}));
 jobs.push({id:'other-frame',projectId:p.id,panelId:'other',status:'running'},{id:'other-project',projectId:'foreign',panelId:'frame',status:'running'});
 assert.deepEqual(panelCancellationJobs(p,'frame',jobs).map(j=>j.status),states.slice(0,5));assert.deepEqual(panelCancellationJobs(null,'frame',jobs),[]);assert.deepEqual(panelCancellationJobs(p,null,jobs),[]);
});

test('画格工具条取消排队和运行中的单格任务，重复点击与切换选择不影响其他格',{timeout:60000},async t=>{
 const directory=fs.mkdtempSync(path.join(proof,'fixture-')),calls=[],aborts=[],releases=new Map(),requests=[],errors=[];
 process.env.COMIC_PROJECT_SYNC='0';process.env.COMIC_SLOT_DIR=path.join(directory,'slots');process.env.COMIC_LIBRARY_CONFIG=path.join(directory,'library.json');fs.writeFileSync(process.env.COMIC_LIBRARY_CONFIG,'{"base":"http://127.0.0.1:9"}');
 const png=createCanvas(700,500).toBuffer('image/png'),bridge={close(){},status:async()=>({connected:true,imageFeature:true}),generate:async(_directory,input,_refs,{signal})=>{calls.push(input.panel.id);return await new Promise((resolve,reject)=>{releases.set(input.panel.id,()=>resolve({bytes:png,imageToolSeen:true}));signal.addEventListener('abort',()=>{aborts.push(input.panel.id);reject(Object.assign(Error('合成取消'),{name:'AbortError'}));},{once:true});});}};
 const studio=createStudio({dataDir:path.join(directory,'data'),maxConcurrent:2,bridge,jimengBridge:{close(){},status:async()=>({connected:false})}});let browser;let unlockCancel;
 t.after(async()=>{unlockCancel?.();for(const release of releases.values())release();await browser?.close();studio.close();studio.server.closeAllConnections();});
 const p=migrateLayerDocument(createProject('单格取消 · 隔离验收')).project,page=p.pages[0],base=clone(p.shots[0]);p.references=[];p.shots=[];page.height=2600;page.storyboard={episode:43};page.bubbles=[];
 const frames=Array.from({length:4},(_,i)=>{const shot={...clone(base),id:id('shot'),episode:43,code:'E043-00'+(i+1),title:'合成格 '+(i+1),referenceIds:[],description:'合成画面，用于单格取消验证',dialogue:''};p.shots.push(shot);return {...panel(shot.id,120,80+i*600,700,500),name:shot.code};});
 page.panels=frames;p.pages=[page];p.layerOrder=frames.map(f=>f.id);ensureProjectPanelGeneration(p,[]);studio.store.db.projects.push(p);studio.store.save();await new Promise(resolve=>studio.server.listen(0,'127.0.0.1',resolve));
 const origin='http://127.0.0.1:'+studio.server.address().port,submitted=await fetch(origin+'/api/jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({projectId:p.id,panelIds:frames.slice(0,3).map(f=>f.id),provider:'codex',expectedRevision:p.revision})});
 assert.equal(submitted.status,202,await submitted.clone().text());const jobs=await submitted.json(),[a,b,c]=jobs;await until(()=>calls.length===2);
 const currentJob=job=>studio.store.db.jobs.find(j=>j.id===job.id),geometry=()=>JSON.stringify(studio.store.project(p.id).pages.map(pg=>pg.panels.map(f=>({id:f.id,x:f.x,y:f.y,w:f.w,h:f.h,imageAssetId:f.imageAssetId,points:f.points})))),before=geometry();
 browser=await chromium.launch({channel:'msedge',headless:true});const context=await browser.newContext({viewport:{width:1760,height:1000}});await context.route('**/*',route=>{const url=new URL(route.request().url());return url.origin===origin||['data:','blob:'].includes(url.protocol)?route.continue():route.abort();});
 const view=await context.newPage();view.on('pageerror',error=>errors.push(error.message));view.on('request',request=>{if(request.method()==='POST'&&new URL(request.url()).pathname.includes('/cancel'))requests.push(new URL(request.url()).pathname);});
 await view.goto(origin+'/?project='+p.id);await view.locator('#canvas-tool-dock').waitFor();await view.locator('#zoom').selectOption('0.25');await view.locator('[data-rail-tab="layers"]').click();
 const select=async frame=>{await view.locator('[data-layer="'+frame.id+'"]').first().click();},button=view.locator('#canvas-cancel-current-panel');
 await select(frames[3]);assert.equal(await button.isVisible(),false,'无任务的格子不显示取消');
 await select(frames[2]);await button.waitFor({state:'visible'});assert.equal(await button.isEnabled(),true);assert.equal(currentJob(c).status,'queued');await button.click();await until(()=>currentJob(c).status==='cancelled');await button.waitFor({state:'hidden'});
 assert.equal(calls.length,2,'已取消的排队格不能进入生成通道');assert.equal(currentJob(a).status,'running');assert.equal(currentJob(b).status,'running');assert.deepEqual(aborts,[]);
 await select(frames[0]);await button.waitFor({state:'visible'});const placement=await button.evaluate(el=>{const r=el.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {height:r.height,visible:r.top>=0&&r.bottom<=innerHeight,hit:hit===el||el.contains(hit)};});assert.ok(placement.height>=28&&placement.visible&&placement.hit,JSON.stringify(placement));
 const labelFits=await button.evaluate(el=>{const button=el.getBoundingClientRect(),label=el.querySelector('span').getBoundingClientRect();return label.left>=button.left&&label.right<=button.right;});assert.equal(labelFits,true,'取消按钮文字应完整显示');await view.screenshot({path:path.join(proof,'isolated-button.png')});
 let intercepted=false;const gate=new Promise(resolve=>unlockCancel=resolve);await view.route('**/api/jobs/'+a.id+'/cancel',async route=>{intercepted=true;await gate;await route.continue();});
 await button.click();await until(()=>intercepted);assert.equal(await button.isDisabled(),true);await button.evaluate(el=>el.dispatchEvent(new MouseEvent('click',{bubbles:true})));assert.equal(requests.filter(url=>url.includes(a.id)).length,1,'连点不能重复取消');
 await select(frames[1]);await until(()=>button.isEnabled());unlockCancel();await until(()=>currentJob(a).status==='cancelled');await until(()=>aborts.includes(frames[0].id));
 assert.equal(currentJob(b).status,'running');assert.equal(aborts.includes(frames[1].id),false);assert.equal(await button.isVisible(),true,'切换后的格子仍保留自己的取消按钮');assert.ok(requests.every(url=>url===('/api/jobs/'+a.id+'/cancel')||url===('/api/jobs/'+c.id+'/cancel')));assert.equal(geometry(),before,'取消不更改画板、图片和几何');assert.deepEqual(errors,[]);
 releases.get(frames[1].id)();await until(()=>studio.idle());await button.waitFor({state:'hidden'});
 fs.writeFileSync(path.join(proof,'acceptance.json'),JSON.stringify({ok:true,realAI:false,queuedCancelledWithoutGeneration:true,runningTargetAborted:true,otherRunningFrameUnaffected:true,selectionSwitchSafe:true,duplicateClickSafe:true,artworkAndGeometryUnchanged:true,requests,browserErrors:errors},null,2));
});

test('取消自动批次中的一个运行格，其他格完成后仍继续下一批',{timeout:15000},async t=>{
 const directory=fs.mkdtempSync(path.join(proof,'batch-')),calls=[],aborts=[],releases=new Map(),png=createCanvas(700,500).toBuffer('image/png');
 process.env.COMIC_PROJECT_SYNC='0';process.env.COMIC_SLOT_DIR=path.join(directory,'slots');process.env.COMIC_LIBRARY_CONFIG=path.join(directory,'library.json');fs.writeFileSync(process.env.COMIC_LIBRARY_CONFIG,'{"base":"http://127.0.0.1:9"}');
 const bridge={close(){},status:async()=>({connected:true,imageFeature:true}),generate:async(_d,input,_refs,{signal})=>{calls.push(input.panel.id);return await new Promise((resolve,reject)=>{releases.set(input.panel.id,()=>resolve({bytes:png,imageToolSeen:true}));signal.addEventListener('abort',()=>{aborts.push(input.panel.id);reject(Object.assign(Error('合成取消'),{name:'AbortError'}));},{once:true});});}};
 const studio=createStudio({dataDir:path.join(directory,'data'),maxConcurrent:2,bridge,jimengBridge:{close(){}}});t.after(()=>{for(const release of releases.values())release();studio.close();studio.server.closeAllConnections();});
 const p=migrateLayerDocument(createProject('单格取消保留后续批次')).project,page=p.pages[0],base=clone(p.shots[0]);p.references=[];p.shots=[];page.height=2600;page.storyboard={episode:43};page.bubbles=[];
 page.panels=Array.from({length:4},(_,i)=>{const shot={...clone(base),id:id('shot'),episode:43,code:'G'+i,description:'合成批次镜头',referenceIds:[]};p.shots.push(shot);return {...panel(shot.id,120,80+i*600,700,500),name:shot.code};});p.pages=[page];p.layerOrder=page.panels.map(f=>f.id);ensureProjectPanelGeneration(p,[]);studio.store.db.projects.push(p);studio.store.save();await new Promise(resolve=>studio.server.listen(0,'127.0.0.1',resolve));
 const origin='http://127.0.0.1:'+studio.server.address().port,post=async(url,body)=>{const r=await fetch(origin+url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),value=await r.json();assert.ok(r.ok,JSON.stringify(value));return value;};
 await post('/api/episode-generation-batches',{projectId:p.id,pageId:page.id,episode:43,panelIds:page.panels.map(f=>f.id),provider:'codex',expectedRevision:p.revision});await until(()=>calls.length===2);
 const plan=studio.store.db.episodeGenerationBatches[0],first=studio.store.db.jobs.find(j=>j.panelId===page.panels[0].id);await post('/api/jobs/'+first.id+'/cancel',{});await until(()=>aborts.length===1);assert.equal(plan.state,'running');assert.equal(studio.store.db.jobs.find(j=>j.panelId===page.panels[1].id).status,'running');
 releases.get(page.panels[1].id)();await until(()=>plan.state==='waiting');assert.equal(plan.cursor,2);assert.equal(plan.finished,2);assert.equal(plan.failed,0);
 plan.nextAt=0;await until(()=>calls.length===4);for(const frame of page.panels.slice(2))releases.get(frame.id)();await until(()=>plan.state==='done');
 assert.deepEqual(aborts,[page.panels[0].id]);assert.equal(plan.submitted,4);assert.equal(plan.finished,4);assert.deepEqual(studio.store.db.jobs.map(j=>j.status),['cancelled','done','done','done']);
 fs.writeFileSync(path.join(proof,'batch-continuation.json'),JSON.stringify({ok:true,realAI:false,cancelledFrames:1,completedFrames:3,remainingBatchesContinued:true},null,2));
});
