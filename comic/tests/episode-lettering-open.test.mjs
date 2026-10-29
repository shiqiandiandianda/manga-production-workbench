import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
import {syntheticFiles} from './helpers/two-screen-package.mjs';
import {inspectProductionPackage} from '../lib/production-package.mjs';import {productionProject} from '../lib/production-package-document.mjs';
import {ensureProjectPanelGeneration} from '../public/panel-generation.js';import {ensureProductionScreenLettering} from '../public/production-screen-lettering.js';import {productionFrame} from '../public/production-package-model.js';import {createStudio} from '../server.mjs';
const {chromium}=createRequire(import.meta.url)('playwright');
test('打开制作资料补齐本话后续屏段；手工修改、删除、图层数和任务不变',{timeout:60000},async t=>{
 const proof=path.resolve('../verification/compact-tools-20261028'),dir=fs.mkdtempSync(path.join(proof,'lettering-'));
 process.env.COMIC_SLOT_DIR=path.join(dir,'slots');process.env.COMIC_LIBRARY_CONFIG=path.join(dir,'library.json');fs.writeFileSync(process.env.COMIC_LIBRARY_CONFIG,'{"base":"http://127.0.0.1:9"}');
 const fake={close(){},status:async()=>({connected:false}),generate(){throw Error('No generation allowed');}},studio=createStudio({dataDir:path.join(dir,'data'),seedReference:false,bridge:fake,jimengBridge:fake});await new Promise(r=>studio.server.listen(0,'127.0.0.1',r));t.after(()=>{studio.close();studio.server.closeAllConnections();});
 const p=productionProject(await inspectProductionPackage(syntheticFiles()));ensureProjectPanelGeneration(p,[]);ensureProductionScreenLettering(p,'E011-S001');const manual=p.pages.flatMap(p=>p.bubbles)[0];manual.x=177;manual.text='保留手改台词';const before=structuredClone(manual),frames=p.pages.flatMap(p=>p.panels).length;studio.store.db.projects.push(p);studio.store.save();
 assert.equal(productionFrame(p,'E011-S002').productionLetteringVersion,undefined);
 const origin='http://127.0.0.1:'+studio.server.address().port,browser=await chromium.launch({channel:'msedge',headless:true});t.after(()=>browser.close());const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());
 await page.goto(origin+'/?project='+p.id);await Promise.all([page.waitForResponse(r=>r.url().endsWith('/production/episode-lettering')&&r.ok()),page.locator('[data-rail-tab=production]').click()]);
 const current=()=>studio.store.project(p.id);assert.equal(current().pages.flatMap(p=>p.bubbles).length,2);assert.deepEqual(current().pages.flatMap(p=>p.bubbles).find(b=>b.id===before.id),before);assert.equal(current().pages.flatMap(p=>p.panels).length,frames);assert.equal(studio.store.db.jobs.length,0);
 const firstPage=current().pages.find(p=>p.bubbles.some(b=>b.id===before.id));firstPage.bubbles=firstPage.bubbles.filter(b=>b.id!==before.id);current().layerOrder=current().layerOrder.filter(id=>id!==before.id);studio.store.save();await page.reload();await page.locator('[data-rail-tab=production]').click();await page.waitForTimeout(700);assert.equal(current().pages.flatMap(p=>p.bubbles).length,1);assert.deepEqual(errors,[]);
 fs.writeFileSync(path.join(proof,'lettering-acceptance.json'),JSON.stringify({allSegments:true,manualPreserved:true,manualDeletionPreserved:true,framesUnchanged:true,noGeneration:true},null,2));
});
