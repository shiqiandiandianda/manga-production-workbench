import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createStudio} from '../../server.mjs';
import {createProject} from '../../public/model.js';

test('顶部操作栏和画布工具栏在桌面与窄屏不越界',{timeout:90000},async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'toolbar-layout-')),fake={status:async()=>({connected:false}),close(){}};
 const studio=createStudio({dataDir:dir,bridge:fake,jimengBridge:fake,seedReference:false}),project=createProject('合成工具栏工程');
 studio.store.db.projects.push(project);studio.store.save();await new Promise(r=>studio.server.listen(0,'127.0.0.1',r));
 const {chromium}=createRequire(import.meta.url)(process.env.COMIC_TEST_PLAYWRIGHT_MODULE),browser=await chromium.launch({channel:'msedge',headless:true});
 t.after(async()=>{await browser.close();studio.close();studio.server.closeAllConnections();studio.server.close();});
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:'+studio.server.address().port+'/?project='+project.id);await page.waitForSelector('#canvas-tool-dock');
 const all=[];
 for(const width of [1864,1440,1024,768,614,375,245]){
  await page.setViewportSize({width,height:980});await page.waitForTimeout(100);
  all.push(await page.evaluate(()=>{const rect=e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom};},top=document.querySelector('.topbar'),bar=document.querySelector('.canvas-toolbar');return {width:innerWidth,documentWidth:document.documentElement.scrollWidth,top:rect(top),bar:rect(bar),children:[...top.children].filter(e=>getComputedStyle(e).display!=='none'&&!['absolute','fixed'].includes(getComputedStyle(e).position)).map(e=>({id:e.id,cls:e.className,rect:rect(e)})),toolbar:[...bar.children].filter(e=>getComputedStyle(e).display!=='none').map(e=>({id:e.id,cls:e.className,rect:rect(e)}))};}));
  const version=await page.locator('#episode-version-open').boundingBox();assert.ok(version&&version.x>=0&&version.x+version.width<=width+1&&version.width>20,'本话版本按钮在 '+width+' px 不可见');
 }
 console.log('TOOLBAR_LAYOUT '+JSON.stringify(all));
 for(const layout of all){assert.ok(layout.documentWidth<=layout.width+1,JSON.stringify(layout));assert.ok(layout.children.every(e=>e.rect.bottom<=layout.top.bottom+1&&e.rect.left>=-1&&e.rect.right<=layout.width+1),JSON.stringify(layout));assert.ok(layout.top.bottom<=layout.bar.top+1,JSON.stringify(layout));}
 await page.setViewportSize({width:375,height:980});await page.locator('.canvas-toolbar #zoom').scrollIntoViewIfNeeded();assert.ok(await page.locator('.canvas-toolbar').evaluate(el=>el.scrollLeft>0),'窄屏应能滚动到缩放控件');
 assert.deepEqual(errors,[]);
});
