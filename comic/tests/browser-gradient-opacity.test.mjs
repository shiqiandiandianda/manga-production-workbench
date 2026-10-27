import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
import {createStudio} from '../server.mjs';
import {createProject} from '../public/model.js';
import {makeGradientLayer,normalizeLayerOrder} from '../public/layers.js';
import {paintGradient} from '../public/panel-effects.js';

const require=createRequire(import.meta.url),{chromium}=require(path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const {createCanvas}=require(path.resolve('../runtime/node/node_modules/@napi-rs/canvas'));
const evidence=path.resolve('../verification/gradient-opacity-20261026');fs.mkdirSync(evidence,{recursive:true});

test('渐变起终点及中点采用0透明、100不透明；实际导出像素、保存刷新与撤销重做一致',{timeout:40000},async t=>{
 const directory=fs.mkdtempSync(path.join(evidence,'fixture-'));process.env.COMIC_PROJECT_SYNC='0';process.env.COMIC_LIBRARY_CONFIG=path.join(directory,'no-library.json');
 const fake={close(){},status:async()=>({connected:false})},studio=createStudio({dataDir:directory,seedReference:false,bridge:fake,jimengBridge:fake});let browser;
 t.after(async()=>{await browser?.close();studio.close();studio.server.closeAllConnections();});
 const project=createProject('渐变不透明度验证');project.pages[0].height=1000;project.pages[0].panels=[];project.pages[0].bubbles=[];
 const layer=makeGradientLayer(project,{y:120});Object.assign(layer,{x:100,w:600,h:220});Object.assign(layer.gradient,{start:{x:0,y:.5},end:{x:1,y:.5},startColor:'#336699',endColor:'#336699'});
 project.gradients=[layer];normalizeLayerOrder(project);studio.store.db.projects.push(project);studio.store.save();const original=structuredClone(layer.gradient);
 await new Promise(resolve=>studio.server.listen(0,'127.0.0.1',resolve));browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:1864,height:949}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto('http://127.0.0.1:'+studio.server.address().port+'/?project='+project.id);await page.locator('#canvas-tool-dock').waitFor();
 const select=async()=>{await page.locator('[data-rail-tab="layers"]').click();await page.locator('#layer-list [data-layer="'+layer.id+'"]').click();};await select();
 const input=index=>page.locator('[data-section="gradient-stop"][data-stop-index="'+index+'"][data-field="opacity"]');
 await page.screenshot({path:path.join(evidence,'initial.png')});assert.equal(await input(0).inputValue(),'100','颜色端默认完全不透明');assert.equal(await input(1).inputValue(),'0','透明端默认完全透明');assert.deepEqual(studio.store.project(project.id).gradients[0].gradient,original,'打开属性不改变既有渐变');
 const current=()=>studio.store.project(project.id).gradients[0].gradient;
 const save=async()=>{await page.keyboard.press('Control+s');await page.waitForFunction(()=>document.querySelector('#save-state').textContent==='已保存到本机');};
 const set=async(index,value)=>{await input(index).fill(String(value));await input(index).blur();await save();assert.equal(current().stops[index].opacity,value/100);assert.equal(await input(index).inputValue(),String(value));};
 const alpha=()=>{const canvas=createCanvas(200,20),ctx=canvas.getContext('2d');paintGradient(ctx,{...layer,w:200,h:20,gradient:current()},{x:0,y:0,w:200,h:20});return ctx.getImageData(100,10,1,1).data[3];};
 const checks=[];
 for(const [value,expected]of [[0,0],[50,128],[100,255]]){await set(0,value);await set(1,value);const actual=alpha();assert.ok(Math.abs(actual-expected)<=1,JSON.stringify({value,expected,actual}));checks.push({percent:value,alpha:actual});}
 await page.locator('#undo').click();await save();assert.equal(current().stops[1].opacity,.5);assert.equal(await input(1).inputValue(),'50');await page.locator('#redo').click();await save();assert.equal(current().stops[1].opacity,1);
 await page.locator('[data-action="gradient-add-midpoint"]').click();await save();assert.equal(await input(1).inputValue(),'100');await set(1,0);assert.ok(alpha()<=2);await set(1,100);assert.equal(alpha(),255);await set(1,50);assert.ok(Math.abs(alpha()-128)<=2);
 await page.screenshot({path:path.join(evidence,'gradient-opacity-fixed.png')});await page.reload();await page.locator('#canvas-tool-dock').waitFor();await select();assert.equal(await input(0).inputValue(),'100');assert.equal(await input(1).inputValue(),'50');assert.equal(await input(2).inputValue(),'100');assert.deepEqual(errors,[]);assert.equal(studio.store.db.jobs.length,0);
 fs.writeFileSync(path.join(evidence,'report.json'),JSON.stringify({ok:true,checks,midpoint:true,undoRedo:true,persisted:true,existingGradientPreserved:true,noRealGeneration:true,errors},null,2));
});
