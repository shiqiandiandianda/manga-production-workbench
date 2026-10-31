import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {createStudio} from '../server.mjs';
import {migrateLayerDocument} from '../public/layers.js';
import {ensureLayoutHistory} from '../public/layout-history.js';
import {deliveryFixture,native} from './fixtures/comic-delivery.mjs';
import {listenForFetch} from './helpers/listen-for-fetch.mjs';

test('editor: removed export features have no UI entry; continuous PNG and client ZIP still download and preserve the source',{timeout:90000},async t=>{
 const f=await deliveryFixture(t),fake={status:async()=>({connected:false}),close(){}},studio=createStudio({dataDir:path.join(f.dir,'editor'),bridge:fake,jimengBridge:fake,seedReference:false});
 const project=migrateLayerDocument(structuredClone(f.project)).project;for(const p of project.pages)for(const frame of p.panels){frame.h=Math.min(frame.h,3000);delete frame.productionSegment;}ensureLayoutHistory(project);
 studio.store.db.projects.push(project);studio.store.db.assets.push(...structuredClone(f.assets).map(a=>({...a,mime:'image/png'})));studio.store.save();
 const origin=await listenForFetch(studio.server),{chromium}=createRequire(import.meta.url)(process.env.COMIC_TEST_PLAYWRIGHT_MODULE||path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
 let browser;t.after(async()=>{await browser?.close();studio.close();studio.server.closeAllConnections();if(studio.server.listening)await new Promise(resolve=>studio.server.close(resolve));});
 const hashes=()=>f.assets.map(a=>createHash('sha256').update(fs.readFileSync(a.filePath)).digest('hex')),originals=hashes();
 browser=await chromium.launch({channel:'msedge',headless:true,args:['--disable-gpu']});const page=await browser.newPage({viewport:{width:1600,height:1000},acceptDownloads:true}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',route=>{const u=new URL(route.request().url());return u.origin===origin||['data:','blob:'].includes(u.protocol)?route.continue():route.abort();});
 await page.goto(origin+'/?project='+f.project.id);await page.waitForSelector('#canvas-tool-dock');try{await page.waitForFunction(()=>document.querySelector('#save-state')?.textContent==='已保存到本机',null,{timeout:10000});}catch(error){throw Error(JSON.stringify({errors,state:await page.evaluate(()=>({save:document.querySelector('#save-state')?.textContent,toast:document.querySelector('#toast')?.textContent}))}));}
 const before=structuredClone(studio.store.project(f.project.id));
 await page.locator('#export-toggle').click();const labels=await page.locator('#export-menu button').allTextContents();assert.deepEqual(labels,['整话连续 PNG','甲方交付：正文 3 张＋封尾']);assert.equal(await page.locator('#export-menu button:disabled').count(),0);
 assert.equal(await page.locator('#export-page,#export-cover,#export-tail,#export-project,#export-layout,#layout-adjustments,#layout-history-paused').count(),0);await page.screenshot({path:path.join(f.proof,'精简后导出菜单.png')});await page.locator('#export-toggle').click();
 if(!await page.locator('#history-steps-toggle').isVisible())await page.locator('#display-menu>summary').click();await page.locator('#history-steps-toggle').click();await page.locator('#display-menu').evaluate(e=>e.open=false);
 assert.equal(await page.locator('#layout-history-steps').isVisible(),true);assert.equal(await page.locator('[data-history-export]').count(),0);await page.locator('#layout-history-steps [data-history-close]').click();
 await page.locator('#export-toggle').click();const pendingPng=page.waitForEvent('download',{timeout:25000}).catch(async()=>{throw Error(JSON.stringify({errors,toast:await page.locator('#toast').textContent()}));});await page.locator('#export-episode').click();const png=await pendingPng,pngPath=path.join(f.proof,'保留功能_整话连续.png');await png.saveAs(pngPath);const decoded=await native.loadImage(pngPath);assert.equal(decoded.width,1280);assert.ok(decoded.height>=10240);
 await page.locator('#export-toggle').click();await page.locator('#export-client').click();await page.waitForFunction(()=>document.querySelector('[data-delivery-download]')?.disabled===false,null,{timeout:25000});
 const pendingZip=page.waitForEvent('download',{timeout:25000});await page.locator('[data-delivery-download]').click();const zip=await pendingZip,zipPath=path.join(f.proof,'保留功能_甲方交付.zip');await zip.saveAs(zipPath);assert.equal(fs.readFileSync(zipPath).readUInt32LE(0),0x04034b50);await page.waitForFunction(()=>document.querySelector('[data-delivery-files]')?.querySelectorAll('a').length===6);
 const after=studio.store.project(f.project.id);assert.deepEqual(after.pages,before.pages);assert.equal(after.revision,before.revision);assert.deepEqual(hashes(),originals);assert.equal(studio.store.db.jobs.length,0);assert.deepEqual(errors,[]);
 fs.writeFileSync(path.join(f.proof,'simplified-export-verification.json'),JSON.stringify({ok:true,synthetic:true,labels,removedFeatures:6,historyStepsAvailable:true,standaloneAdjustmentExportRemoved:true,continuousPng:{width:decoded.width,height:decoded.height},clientPngs:5,sourceUnchanged:true,realAI:false,errors},null,2));
});
