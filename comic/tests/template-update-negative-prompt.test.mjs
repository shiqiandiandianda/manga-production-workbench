import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {createProject,clone,id} from '../public/model.js';
import {migrateLayerDocument} from '../public/layers.js';
import {ensurePanelGeneration,ensureProjectPanelGeneration,resolvePanelGeneration,panelProductionShot,panelProductionSnapshot,panelContentKey} from "../public/panel-generation.js";
import {panelGenerationFieldsMarkup} from '../public/panel-generation-ui.js';
import {DEFAULT_NEGATIVE_PROMPT,resolveNegativePrompt,negativePromptInstructions} from '../public/generation-constraints.js';

import {captureLayout,ensureLayoutHistory,recordLayoutAdjustment} from '../public/layout-history.js';
import {buildImagePrompt} from '../lib/codex.mjs';
import {buildJimengPrompt} from '../lib/jimeng.mjs';
import {validateProject} from '../lib/store.mjs';
import {createStudio} from '../server.mjs';

const root=fileURLToPath(new URL('../',import.meta.url)),audit=path.join(root,'merge-audit','negative-prompt'),png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64');
const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
function legacy(){const p=createProject('Synthetic negative prompt'),f=p.pages[0].panels[0];ensurePanelGeneration(p,f);delete f.generation.negativePrompt;return {p,f};}







test('browser edits, source sync, reopening and mock jobs use the exact per-panel restrictions; changes during a job retain a stale candidate',{timeout:60000},async t=>{
 fs.mkdirSync(audit,{recursive:true});const directory=fs.mkdtempSync(path.join(audit,'synthetic-')),calls=[],checks=[];let hold=null,release=()=>{},browser;
 const bridge={close(){},status:async()=>({connected:true,imageFeature:true}),generate:async(_directory,input,refs)=>{calls.push({input:clone(input),refs:[...refs]});if(hold)await hold;const filePath=path.join(directory,'fake-'+calls.length+'.png');fs.writeFileSync(filePath,png);return {filePath,imageToolSeen:true};}};
 const studio=createStudio({dataDir:path.join(directory,'data'),bridge,jimengBridge:bridge});await new Promise(resolve=>studio.server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{release();await browser?.close();studio.close();await new Promise(resolve=>studio.server.close(resolve));});
 const p=migrateLayerDocument(createProject('合成限制提示词')).project,f=p.pages[0].panels[0];Object.assign(f,{x:100,y:100,w:1000,h:600});p.pages[0].height=1600;ensureProjectPanelGeneration(p);delete f.generation.negativePrompt;
 const copied=clone(f);copied.id=id('panel');copied.y=850;copied.generation.negativePrompt='副本限制：避免道具变形。';p.pages[0].panels.push(copied);p.layerOrder.push(copied.id);ensureLayoutHistory(p);const source=clone(p.shots[0]);studio.store.db.projects.push(p);studio.store.save();
 const origin='http://127.0.0.1:'+studio.server.address().port,api=async(route,method='GET',input)=>{const response=await fetch(origin+route,{method,headers:input?{'Content-Type':'application/json'}:{},body:input?JSON.stringify(input):undefined});return {status:response.status,body:await response.json()};},state=async()=>(await api('/api/projects/'+p.id)).body;
 const require=createRequire(import.meta.url),{chromium}=require(path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
 browser=await chromium.launch({channel:'msedge',headless:true,args:['--disable-gpu']});const context=await browser.newContext({viewport:{width:1800,height:1100}});await context.addInitScript(()=>localStorage.setItem('comic-generation-provider','codex'));
 await context.route('**/*',route=>{const url=new URL(route.request().url());return url.hostname==='127.0.0.1'||['data:','blob:'].includes(url.protocol)?route.continue():route.abort();});
 const page=await context.newPage(),errors=[],writes=[];page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(request.method()==='PUT')writes.push(request.url());});
 const field=()=>page.locator('[data-section="panel-generation"][data-field="negativePrompt"]'),save=async()=>{await page.keyboard.press('Control+s');await page.waitForFunction(()=>document.querySelector('#save-state').textContent==='已保存到本机');},waitCalls=async count=>{for(let i=0;calls.length<count&&i<200;i++)await new Promise(resolve=>setTimeout(resolve,10));assert.equal(calls.length,count);},settle=async()=>{for(let i=0;i<200;i++){const value=(await api('/api/state')).body;if(value.jobs.every(job=>!['queued','running'].includes(job.status)))return value;await new Promise(resolve=>setTimeout(resolve,10));}throw Error('mock job timed out');};
 try{
  await page.goto(origin);await page.waitForFunction(()=>document.querySelector('#save-state').textContent==='已保存到本机');assert.equal(await field().inputValue(),DEFAULT_NEGATIVE_PROMPT);assert.equal(writes.length,0);assert.equal(Object.hasOwn((await state()).pages[0].panels[0].generation,'negativePrompt'),false);checks.push('legacy rendering adds no persisted default');
  const custom='  自定义：避免反向手腕。\n保留指定的清泉楼牌匾。  ';await field().fill(custom);await save();let saved=await state();assert.equal(saved.pages[0].panels[0].generation.negativePrompt,custom);assert.equal(saved.pages[0].panels[1].generation.negativePrompt,copied.generation.negativePrompt);assert.deepEqual(saved.shots[0],source);
  await page.locator('[data-action="panel-source"]').click();await page.getByRole('button',{name:'带入此格一次',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('#modal').open);await save();assert.equal((await state()).pages[0].panels[0].generation.negativePrompt,custom);
  await page.reload();await page.waitForFunction(()=>document.querySelector('#save-state').textContent==='已保存到本机');assert.equal(await field().inputValue(),custom);checks.push('local edit and source sync survive reopening without touching copied layer');
  await page.locator('#generate-selected').click();await waitCalls(1);await settle();assert.equal(calls[0].input.shot.negativePrompt,custom);assert.ok(buildImagePrompt(calls[0].input).includes(custom.trim()));checks.push('real HTTP mock adapter receives exact custom text');
  if(!await page.locator('#image-layer-copy').isVisible())await page.locator('#compact-edit-toggle').click();await page.locator('#image-layer-copy').click();if(!await page.locator('#image-layer-paste').isVisible())await page.locator('#compact-edit-toggle').click();await page.locator('#image-layer-paste').click();await save();saved=await state();assert.equal(saved.pages[0].panels.length,3);assert.equal(saved.pages[0].panels[2].generation.negativePrompt,custom);
  await field().fill('粘贴层自己的限制');await save();saved=await state();assert.equal(saved.pages[0].panels[2].generation.negativePrompt,'粘贴层自己的限制');assert.equal(saved.pages[0].panels[0].generation.negativePrompt,custom);
  if(!await page.locator('#layer-list').isVisible())await page.locator('[data-rail-tab="layers"]').click();await page.locator('[data-layer="'+f.id+'"]').click();assert.equal(await field().inputValue(),custom);checks.push('copy and paste inherits restrictions, then editing its field remains independent');
  await field().fill('');await save();await page.reload();await page.waitForFunction(()=>document.querySelector('#save-state').textContent==='已保存到本机');assert.equal(await field().inputValue(),'');assert.equal((await state()).pages[0].panels[0].generation.negativePrompt,'');
  await page.locator('#generate-selected').click();await waitCalls(2);await settle();assert.equal(calls[1].input.shot.negativePrompt,'');for(const build of [buildImagePrompt,buildJimengPrompt])assert.ok(!build(calls[1].input).includes('限制提示词（'));checks.push('explicit empty stays empty and omits restrictions from both adapters');
  await field().fill('旧限制');await save();hold=new Promise(resolve=>release=resolve);await page.locator('#generate-selected').click();await waitCalls(3);await field().fill('新的限制');await save();release();hold=null;const finished=await settle(),job=finished.jobs.at(-1),current=finished.projects.find(value=>value.id===p.id);assert.equal(calls[2].input.shot.negativePrompt,'旧限制');assert.equal(job.applied,false);assert.ok(current.pages[0].panels[0].candidates.includes(job.assetId));assert.equal(current.pages[0].panels[0].generation.negativePrompt,'新的限制');assert.equal(current.pages[0].panels[1].generation.negativePrompt,copied.generation.negativePrompt);checks.push('changed restriction rejects stale autofill while preserving its candidate');
  const invalid=await state(),validBefore=clone(invalid);invalid.pages[0].panels[0].generation.negativePrompt='限'.repeat(4001);assert.equal((await api('/api/projects/'+p.id,'PUT',invalid)).status,400);assert.deepEqual(await state(),validBefore);checks.push('oversized API update rejects and keeps the saved project');
  await page.screenshot({path:path.join(directory,'negative-prompt.png')});assert.deepEqual(errors,[]);fs.writeFileSync(path.join(directory,'report.json'),JSON.stringify({ok:true,synthetic:true,realGeneration:false,productionDataTouched:false,checks,errors},null,2));
 }catch(error){release();fs.writeFileSync(path.join(directory,'failure.json'),JSON.stringify({error:error.stack,checks,errors},null,2));await page.screenshot({path:path.join(directory,'failure.png')}).catch(()=>{});throw error;}
});
