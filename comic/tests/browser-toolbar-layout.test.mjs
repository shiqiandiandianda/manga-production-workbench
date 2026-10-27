import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createStudio} from '../server.mjs';
import {createProject} from '../public/model.js';

const {chromium}=createRequire(import.meta.url)('C:/Users/EDY/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const out=path.resolve('../verification/toolbar-current-20261022');fs.mkdirSync(out,{recursive:true});
// The retired AI-design/rule-dialog controls are intentionally absent. Verify
// today's import entry, episode navigation, and current panel tools instead.
test('当前工作台七种视口：制作资料入口、本话资产导航、图片工具和页面设置可用',{timeout:60000},async t=>{
 const data=fs.mkdtempSync(path.join(out,'fixture-'));process.env.COMIC_PROJECT_SYNC='0';const fake={close(){},status:async()=>({connected:false}),generate(){throw Error('不得调用真实生成');}},studio=createStudio({dataDir:data,seedReference:false,bridge:fake,jimengBridge:fake});
 await new Promise(r=>studio.server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+studio.server.address().port;let browser;t.after(async()=>{await browser?.close();studio.close();studio.server.closeAllConnections();});browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:1864,height:980}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(origin);await page.locator('#storyboard-import-empty').waitFor();assert.equal(await page.locator('[data-tab="shots"]').count(),0);await page.locator('#storyboard-import-empty').click();await page.locator('#storyboard-import-dialog').waitFor();await page.locator('[data-storyboard-import-close]').click();
 const p=createProject('工具栏合成回归');studio.store.db.projects.push(p);studio.store.save();await page.goto(origin+'/?project='+p.id);await page.waitForFunction(()=>document.querySelector('#save-state').textContent.includes('已保存'));await page.locator('[data-rail-tab="layers"]').click();await page.locator('#layer-list [data-layer="'+p.pages[0].panels[0].id+'"]').click();await page.locator('.dock-primary-tools [data-tool="image"]').click();assert.equal(await page.locator('.dock-primary-tools [data-tool="image"]').textContent(),'图片');await page.locator('#page-marker').click();assert.equal(await page.locator('#inspector-kind').textContent(),'页面设置');await page.locator('#inspector-close').click();
 for(const width of [1864,1440,1280,1024,768,614,375]){
  await page.setViewportSize({width,height:980});await page.waitForTimeout(80);const layout=await page.evaluate(()=>{const box=s=>{const b=document.querySelector(s).getBoundingClientRect();return {left:b.left,right:b.right,top:b.top,bottom:b.bottom};};return {width:innerWidth,documentWidth:document.documentElement.scrollWidth,top:box('.topbar'),bar:box('.canvas-toolbar'),shell:box('.app-shell'),overflow:[...document.querySelectorAll('body *')].filter(n=>n.getBoundingClientRect().right>innerWidth+1).slice(0,15).map(n=>({id:n.id,tag:n.tagName,width:n.getBoundingClientRect().width,right:n.getBoundingClientRect().right}))};});assert.ok(layout.documentWidth<=width+1,JSON.stringify(layout));assert.ok(layout.top.bottom<=layout.bar.top+1);assert.ok(layout.bar.bottom<=layout.shell.top+1);
  await page.locator('[data-rail-tab="references"]').click();if(!await page.locator('#asset-gallery-workspace').isVisible())await page.locator('[data-rail-tab="references"]').click();assert.equal(await page.locator('#asset-gallery-workspace').isVisible(),true);assert.equal(await page.locator('#moku-library-browser').isVisible(),false);assert.equal(await page.locator('#asset-studio-open').getAttribute('href'),'/api/project-center/asset-studio/open');await page.screenshot({path:path.join(out,'viewport-'+width+'.png')});await page.locator('[data-gallery-close]').click();
 }
 assert.deepEqual(errors,[]);assert.equal(studio.store.db.jobs.length,0);
});
