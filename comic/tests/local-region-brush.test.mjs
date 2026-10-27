import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {mountLocalRegionUI,localRegionError} from '../public/local-region-ui.js';
const require=createRequire(import.meta.url),{chromium}=require('C:/Users/EDY/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const evidence=path.resolve('../verification/cutout-brush-fix-20261022');fs.mkdirSync(evidence,{recursive:true});
test('圆形笔刷与原图直径和缩放一致，滑块与数值同步，悬停不绘图，平移隐藏光标',{timeout:30000},async t=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});t.after(()=>browser.close());
 const page=await browser.newPage({viewport:{width:1600,height:1000},deviceScaleFactor:2}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('http://local-region.test/**',r=>r.fulfill({body:'<!doctype html>'}));await page.goto('http://local-region.test');
 await page.setContent(`<style>${fs.readFileSync('public/local-region.css','utf8')}</style><dialog id="modal"><h2></h2><div id="modal-body"></div><div id="modal-actions"></div></dialog>`);
 const script=fs.readFileSync('public/local-region-ui.js','utf8').replace('export function mountLocalRegionUI','function mountLocalRegionUI').replace('export function localRegionError','function localRegionError');
 await page.addScriptTag({content:script+';window.mountLocalRegionUI=mountLocalRegionUI;'});
 await page.evaluate(async()=>{
  const source=document.createElement('canvas');source.width=2400;source.height=1800;const c=source.getContext('2d');c.fillStyle='#d5cdc1';c.fillRect(0,0,2400,1800);c.fillStyle='#ae4148';c.fillRect(650,300,1000,1200);
  const panel={id:'panel',imageAssetId:'asset'},project={id:'project',revision:0,pages:[{panels:[panel]}]};
  window.requests=[];const api=async(url,method,data)=>{window.requests.push({url,method,data});if(url.endsWith('/latest?panelId=panel&operation=cutout'))return {};if(url.endsWith('/local-region'))return {id:'session',size:{width:2400,height:1800},sourceUrl:source.toDataURL(),bubbles:[],texts:[]};throw Error('未预期请求：'+url);};
  const ui=window.mountLocalRegionUI({api,getProject:()=>project,getSelected:()=>panel,flushSave:async()=>{},modal(title,body,actions){document.querySelector('h2').textContent=title;document.querySelector('#modal-body').innerHTML=body;for(const a of actions){const b=document.createElement('button');b.textContent=a.label;if(a.primary)b.className='primary';document.querySelector('#modal-actions').append(b);}document.querySelector('dialog').showModal();},closeModal(){document.querySelector('dialog').close();}});await ui.open('cutout');
 });
 const canvas=page.locator('[data-region-canvas]'),ring=page.locator('[data-region-brush-cursor]'),num=page.locator('[data-region-brush]'),range=page.locator('[data-region-brush-range]'),box=await canvas.boundingBox(),x=box.x+box.width/2,y=box.y+box.height/2;
 await page.locator('[data-region-tool=keep]').click();await num.fill('180');await page.mouse.move(x,y);await ring.waitFor({state:'visible'});
 const check=async n=>{const r=await ring.boundingBox(),z=Number(await canvas.getAttribute('data-zoom'));assert.ok(Math.abs(r.width-n*z)<.06);assert.ok(Math.abs(r.height-n*z)<.06);};await check(180);assert.equal(await canvas.evaluate(c=>c.style.cursor),'none');
 await num.fill('360');await ring.waitFor({state:'visible'});await check(360);assert.equal(await range.inputValue(),'360');
 await range.fill('240');await check(240);assert.equal(await num.inputValue(),'240');await page.mouse.move(x,y);await page.mouse.wheel(0,-200);await check(240);
 await page.locator('[data-region-tool=remove]').click();await page.mouse.move(x,y);assert.equal(await ring.getAttribute('data-kind'),'remove');
 await canvas.focus();await page.keyboard.down('Space');assert.equal(await ring.isVisible(),false);const pan=await canvas.getAttribute('data-pan-x');await page.mouse.down();await page.mouse.move(x+25,y+20);await page.mouse.up();await page.keyboard.up('Space');assert.notEqual(await canvas.getAttribute('data-pan-x'),pan);assert.equal(await ring.isVisible(),true);
 assert.equal(await page.evaluate(()=>sessionStorage.length),0);assert.equal(await page.evaluate(()=>window.requests.filter(r=>r.method==='POST'&&r.url.includes('/process')).length),0);
 await page.screenshot({path:path.join(evidence,'circular-brush-ui.png')});
 await page.mouse.move(10,10);assert.equal(await ring.isVisible(),false);await page.locator('[data-region-tool=rect]').click();assert.equal(await canvas.evaluate(c=>c.style.cursor),'crosshair');assert.deepEqual(errors,[]);
});
test('只排除保留模型主体、明确保留筛选目标、缩小处理不丢小笔画及空目标提示',{timeout:30000},()=>{
 const result=spawnSync(process.env.COMIC_PYTHON_BIN||path.resolve('../runtime/python/python.exe'),['-B',path.resolve('tests/local-region-refinement.py')],{encoding:'utf8',env:{...process.env,PYTHONUTF8:'1',PYTHONDONTWRITEBYTECODE:'1'},timeout:25000});assert.equal(result.status,0,result.stdout+'\n'+result.stderr);fs.writeFileSync(path.join(evidence,'refinement-check.json'),result.stdout);
});
test('旧失败任务恢复时显示可操作原因，保留任务原始报错',()=>{const raw='本地模型处理失败：Traceback\n  File "D:/test.py", line 65\nValueError: 请在要保留的人物或元素内部涂一笔\n';assert.equal(localRegionError(raw),'请在要保留的人物或元素内部涂一笔');assert.equal(localRegionError('工程已切换'),'工程已切换');});
