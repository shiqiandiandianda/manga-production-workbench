import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {createRequire} from 'node:module';
import {createStudio} from '../server.mjs';import {createProject} from '../public/model.js';import {migrateLayerDocument} from '../public/layers.js';
const deps=path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'),{chromium}=createRequire(import.meta.url)(path.join(deps,'playwright'));

// Two windows on one project. Window B saves a move; window A (no unsaved edits) refreshes while a
// job keeps polling active, then edits something else. B's move must survive A's later save.
test('两个窗口编辑同一工程：另一窗口的保存不会被本窗口随后的保存覆盖',{timeout:90000},async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'comic-multi-window-'));
  const studio=createStudio({dataDir:path.join(dir,'data'),bridge:{status:async()=>({connected:true,imageFeature:true,message:'ok'}),generate:()=>new Promise(()=>{}),close(){}},jimengBridge:{close(){}},seedReference:false});let browser;
  t.after(async()=>{await browser?.close();studio.close();fs.rmSync(dir,{recursive:true,force:true});});
  const p=migrateLayerDocument(createProject('双窗口',true)).project;studio.store.db.projects.push(p);studio.store.save();
  await new Promise(resolve=>studio.server.listen(0,'127.0.0.1',resolve));const url=`http://127.0.0.1:${studio.server.address().port}`;
  const api=async(route,method='GET',data)=>(await fetch(url+route,{method,headers:data?{'Content-Type':'application/json'}:{},body:data?JSON.stringify(data):undefined})).json();
  const jobs=await api('/api/jobs','POST',{projectId:p.id,panelIds:[p.pages[0].panels.at(-1).id]});assert.ok(['queued','running'].includes(jobs[0]?.status),'后台任务让窗口保持轮询');
  browser=await chromium.launch({channel:'msedge',headless:true});const context=await browser.newContext({viewport:{width:1600,height:1000}});
  const open=async()=>{const page=await context.newPage();await page.goto(url+'/?project='+p.id);await page.waitForFunction(()=>document.querySelector('#save-state')?.textContent.includes('已保存'));return page;};
  const A=await open(),B=await open(),x='[data-section="panel"][data-field="x"]',y='[data-section="panel"][data-field="y"]';
  const original=(await api('/api/projects/'+p.id)).pages[0].panels[0];
  await B.fill(x,String(original.x+37));await B.press(x,'Enter');await B.waitForFunction(()=>document.querySelector('#save-state').textContent.includes('已保存到本机'));
  await A.waitForFunction(()=>document.querySelector('#save-state').textContent.includes('已载入其他窗口的最新修改'),null,{timeout:10000});
  assert.equal(Number(await A.inputValue(x)),original.x+37,'A 载入了 B 的内容');
  await A.fill(y,String(original.y+11));await A.press(y,'Enter');await A.waitForFunction(()=>document.querySelector('#save-state').textContent.includes('已保存到本机'));
  const saved=(await api('/api/projects/'+p.id)).pages[0].panels[0];
  assert.equal(saved.x,original.x+37,'B 的修改保留');assert.equal(saved.y,original.y+11,'A 的修改保存');
});
