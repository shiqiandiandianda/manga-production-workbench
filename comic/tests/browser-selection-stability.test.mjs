import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
import {createStudio} from '../server.mjs';
import {createProject} from '../public/model.js';
import {normalizeLayerOrder} from '../public/layers.js';
test('selecting and deselecting frames keeps toolbar, canvas and scroll position stable',{timeout:60000},async t=>{
 const parent=path.resolve('.runtime/temp');fs.mkdirSync(parent,{recursive:true});const dir=fs.mkdtempSync(path.join(parent,'selection-stable-')),evidence=path.resolve('design-audit/layout-v5-20261016/selection-stability');fs.mkdirSync(evidence,{recursive:true});let browser;
 const fake={close(){},status:async()=>({connected:false}),generate(){throw Error('No AI');}},studio=createStudio({dataDir:dir,bridge:fake,jimengBridge:fake,storyboardGenerator:fake});await new Promise(r=>studio.server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+studio.server.address().port;
 t.after(async()=>{await browser?.close();studio.close();await new Promise(r=>studio.server.close(r));assert.equal(path.dirname(dir),parent);fs.rmSync(dir,{recursive:true,force:true});});
 const p=createProject('合成点击稳定性'),frame=p.pages[0].panels[0];p.pages[0].panels=[frame];p.pages[0].bubbles=[];p.pages[0].height=12000;Object.assign(frame,{x:90,y:3000,w:1000,h:900});normalizeLayerOrder(p);studio.store.db.projects.push(p);studio.store.save();
 const require=createRequire(import.meta.url),{chromium}=require(path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));browser=await chromium.launch({channel:'msedge',headless:true,args:['--disable-gpu']});const page=await browser.newPage({viewport:{width:1864,height:1000}}),errors=[],checks=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>new URL(r.request().url()).origin===origin||['data:','blob:'].includes(new URL(r.request().url()).protocol)?r.continue():r.abort());await page.goto(origin+'/?project='+p.id);await page.locator('#panel-display-mode').waitFor();
 const geometry=()=>page.evaluate(id=>{const target=document.querySelector('#stage [data-panel="'+id+'"]'),toolbar=document.querySelector('.canvas-toolbar').getBoundingClientRect(),shell=document.querySelector('.app-shell').getBoundingClientRect(),scroll=document.querySelector('#canvas-scroll');return {toolbarHeight:toolbar.height,shellTop:shell.top,canvasTop:scroll.getBoundingClientRect().top,scrollTop:scroll.scrollTop,frameTop:target.getBoundingClientRect().top};},frame.id);
 for(const width of [1864,1540]){
  await page.setViewportSize({width,height:1000});await page.locator('#zoom').selectOption('0.4');await page.locator('#canvas-scroll').evaluate(e=>e.scrollTop=1000);await page.waitForTimeout(100);
  const scroll=await page.locator('#canvas-scroll').boundingBox();
  for(let i=0;i<3;i++){
   await page.mouse.click(scroll.x+5,scroll.y+100);await page.waitForTimeout(80);await page.locator('#stage [data-panel="'+frame.id+'"] path').first().scrollIntoViewIfNeeded();await page.waitForTimeout(80);const before=await geometry();const target=await page.locator('#stage [data-panel="'+frame.id+'"] path').first().boundingBox();await page.screenshot({path:path.join(evidence,width+'-before.png')});await page.mouse.click(target.x+18,target.y+18);await page.waitForTimeout(80);const after=await geometry();
   console.log('selection geometry',width,JSON.stringify({before,after,target}));assert.ok(await page.locator('.frequent-tools').evaluate(e=>e.classList.contains('floating-tools')),'selection opens the floating tools');for(const key of Object.keys(before))assert.ok(Math.abs(after[key]-before[key])<=1,`${width} click ${i}: ${key} moved ${after[key]-before[key]}px`);checks.push({width,before,after});await page.screenshot({path:path.join(evidence,width+'-after.png')});
  }
 }
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(evidence,'report.json'),JSON.stringify({ok:true,checks,browserErrors:errors},null,2));
});
