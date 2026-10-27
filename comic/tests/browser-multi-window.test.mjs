import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {createRequire} from 'node:module';
import {createStudio} from '../server.mjs';import {createProject} from '../public/model.js';import {migrateLayerDocument} from '../public/layers.js';
import {ensureLayoutHistory} from '../public/layout-history.js';
const deps=path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'),{chromium}=createRequire(import.meta.url)(path.join(deps,'playwright'));

// Two windows on one project. Window B saves a move; window A (no unsaved edits) refreshes while a
// job keeps polling active, then edits something else. B's move must survive A's later save.
test('两个窗口编辑同一工程：另一窗口的保存不会被本窗口随后的保存覆盖',{timeout:90000},async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'comic-multi-window-'));
  const studio=createStudio({dataDir:path.join(dir,'data'),bridge:{status:async()=>({connected:true,imageFeature:true,message:'ok'}),generate:()=>new Promise(()=>{}),close(){}},jimengBridge:{close(){}},seedReference:false});let browser;
  t.after(async()=>{await browser?.close();studio.close();fs.rmSync(dir,{recursive:true,force:true});});
  const p=migrateLayerDocument(createProject('双窗口',true)).project;Object.assign(p.pages[0].panels[0],{x:100,w:800});ensureLayoutHistory(p);studio.store.db.projects.push(p);studio.store.save();
  await new Promise(resolve=>studio.server.listen(0,'127.0.0.1',resolve));const url=`http://127.0.0.1:${studio.server.address().port}`;
  const api=async(route,method='GET',data)=>(await fetch(url+route,{method,headers:data?{'Content-Type':'application/json'}:{},body:data?JSON.stringify(data):undefined})).json();
  const jobs=await api('/api/jobs','POST',{projectId:p.id,panelIds:[p.pages[0].panels.at(-1).id]});assert.ok(['queued','running'].includes(jobs[0]?.status),'后台任务让窗口保持轮询');
  browser=await chromium.launch({channel:'msedge',headless:true});const context=await browser.newContext({viewport:{width:1600,height:1000}});
  const updates=[];const open=async label=>{const page=await context.newPage();page.on('request',req=>{if(req.method()==='PUT'&&req.url().endsWith('/api/projects/'+p.id)){try{const v=req.postDataJSON();updates.push({label,revision:v.revision,x:v.pages?.[0]?.panels?.[0]?.x,y:v.pages?.[0]?.panels?.[0]?.y});}catch{}}});await page.goto(url+'/?project='+p.id);await page.waitForFunction(()=>document.querySelector('#save-state')?.textContent.includes('已保存'));await page.locator('[data-properties-shortcut="toolbar"]').click();await page.locator('[data-panel-inspector-tab="layout"]').click();return page;};
  const A=await open('A'),B=await open('B'),x='[data-section="panel"][data-field="x"]',y='[data-section="panel"][data-field="y"]';
  const original=(await api('/api/projects/'+p.id)).pages[0].panels[0];
  async function persisted(field,value){for(let i=0;i<100;i++){if((await api('/api/projects/'+p.id)).pages[0].panels[0][field]===value)return;await new Promise(resolve=>setTimeout(resolve,100));}throw Error('工程未保存 '+field+'='+value+'：'+JSON.stringify(updates));}
  await B.fill(x,String(original.x+37));await B.locator(x).blur();await persisted('x',original.x+37);
  await A.waitForFunction(()=>document.querySelector('#save-state').textContent.includes('已载入其他窗口的最新修改'),null,{timeout:10000}).catch(async error=>{const state=await api('/api/projects/'+p.id);console.error('MULTI_WINDOW_DEBUG',JSON.stringify({display:await A.locator('#save-state').textContent(),field:await A.inputValue(x),active:await A.evaluate(()=>document.activeElement?.outerHTML?.slice(0,300)),serverRevision:state.revision,serverX:state.pages[0].panels[0].x,updates}));throw error;});
  assert.equal(Number(await A.inputValue(x)),original.x+37,'A 载入了 B 的内容');
  await A.fill(y,String(original.y+11));await A.locator(y).blur();await persisted('y',original.y+11);
  const saved=(await api('/api/projects/'+p.id)).pages[0].panels[0];
  assert.equal(saved.x,original.x+37,'B 的修改保留');assert.equal(saved.y,original.y+11,'A 的修改保存');
});
