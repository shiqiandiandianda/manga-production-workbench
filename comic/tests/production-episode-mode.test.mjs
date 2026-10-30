import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {syntheticFiles} from './helpers/two-screen-package.mjs';
import {inspectProductionPackage} from '../lib/production-package.mjs';
import {productionProject} from '../lib/production-package-document.mjs';
import {applyProductionEpisodeMode} from '../lib/production-episode-mode.mjs';
import {productionFrame} from '../public/production-package-model.js';
import {prepareProductionPanel} from '../public/production-panel-generation.js';
import {ensureProjectPanelGeneration} from '../public/panel-generation.js';
import {generationPromptSelection} from '../public/prompt-source.js';
import {createStudio} from '../server.mjs';

const proof=path.resolve(import.meta.dirname,'../../verification/episode-mode-20261030');fs.mkdirSync(proof,{recursive:true});
async function fixture(){
 const files=syntheticFiles();
 const board=JSON.parse(files[0].bytes);for(const row of board['格'])Object.assign(row,{'生图提示词(空泡)':'人物站立，留空气泡','生图提示词(无泡)':'人物站立，禁止气泡和文字'});
 files[0].bytes=Buffer.from(JSON.stringify(board));
 const more=files.map(f=>({...f,relativePath:f.relativePath.replaceAll('011','012'),bytes:Buffer.from(f.bytes.toString().replaceAll('011','012').replaceAll('"话":11','"话":12'))}));
 const p=productionProject(await inspectProductionPackage([...files,...more]));
 const e=p.productionPackage.episodes[0];prepareProductionPanel(p,e.segments[0].id,e.panelRecords[0].id);ensureProjectPanelGeneration(p,[]);return p;
}
const fingerprint=p=>p.pages.map(page=>({id:page.id,width:page.width,height:page.height,bubbles:page.bubbles,panels:page.panels.map(f=>({id:f.id,x:f.x,y:f.y,w:f.w,h:f.h,visible:f.visible,imageAssetId:f.imageAssetId,imageTransform:f.imageTransform,candidates:f.candidates}))}));
test('整话修改覆盖屏段、已有及后续单格，保留内容、提示词编辑及其他话',async()=>{
 const p=await fixture(),e=p.productionPackage.episodes[0],other=structuredClone(p.productionPackage.episodes[1]);
 const root=productionFrame(p,e.segments[0].id);root.imageAssetId='existing-image';root.imageTransform={x:12,y:30,scale:1.2};root.generation.promptOverrides={'post-lettering':'手工改写保留'};
 const before=structuredClone(fingerprint(p)),otherFrames=structuredClone(p.pages.flatMap(page=>page.panels).filter(f=>f.productionSegment?.startsWith('E012')));
 const result=applyProductionEpisodeMode(p,11,'clean');assert.deepEqual(result,{episode:11,source:'post-lettering',segments:2,panels:2});
 assert.deepEqual(fingerprint(p),before);assert.deepEqual(p.productionPackage.episodes[1],other);assert.deepEqual(p.pages.flatMap(page=>page.panels).filter(f=>f.productionSegment?.startsWith('E012')),otherFrames);
 for(const s of e.segments){assert.equal(productionFrame(p,s.id).generation.promptSource,'post-lettering');for(const gridId of s.panelIds)assert.equal(s.panelPromptSources[gridId],'post-lettering');}
 const later=prepareProductionPanel(p,e.segments[1].id,e.panelRecords[1].id).panel;assert.equal(later.generation.promptSource,'post-lettering');ensureProjectPanelGeneration(p,[]);assert.match(generationPromptSelection(later,p).text,/禁止气泡/);
 applyProductionEpisodeMode(p,11,'empty');assert.equal(later.generation.promptSource,'imported');assert.match(generationPromptSelection(later,p).text,/留空气泡/);assert.deepEqual(root.generation.promptOverrides,{'post-lettering':'手工改写保留'});
});
test('缺原文、锁定和来源冲突均整笔拒绝，不留下半套设置',async()=>{
 for(const mutate of [p=>{const r=p.productionPackage.episodes[0].panelRecords[1];delete r.original['生图提示词(空泡)'];delete r.production?.['生图提示词(空泡)'];},p=>productionFrame(p,'E011-S002').locked=true,p=>p.pages[0].locked=true,p=>p.productionPackage.episodes[0].segments[1].pendingSourceFields={}]){
  const p=await fixture();mutate(p);const before=structuredClone(p);assert.throws(()=>applyProductionEpisodeMode(p,11,'empty'),/整话出字方式未更改/);assert.deepEqual(p,before);
 }
 const p=await fixture();assert.throws(()=>applyProductionEpisodeMode(p,99,'clean'),/有效/);assert.throws(()=>applyProductionEpisodeMode(p,11,'invalid'),/空泡或无泡/);
});
async function serverFixture(t){
 const fake={status:async()=>({connected:false}),close(){},generate(){throw Error('Must not generate');}};
 const studio=createStudio({dataDir:fs.mkdtempSync(path.join(proof,'synthetic-')),seedReference:false,bridge:fake,jimengBridge:fake});
 const p=await fixture();studio.store.db.projects.push(p);studio.store.save();await new Promise(r=>studio.server.listen(0,'127.0.0.1',r));
 t.after(async()=>{studio.close();studio.server.closeAllConnections();await new Promise(r=>studio.server.close(r));});
 const base='http://127.0.0.1:'+studio.server.address().port;
 const apply=async(body={})=>{const res=await fetch(base+'/api/projects/'+p.id+'/production/episode-mode',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({episode:11,mode:'clean',expectedRevision:studio.store.project(p.id).revision,...body})});return {status:res.status,body:await res.json()};};
 return {studio,p,base,apply};
}
test('接口只保存一次；拒绝旧版本与正在生成的工程；不提交任务',async t=>{
 const {studio,p,apply}=await serverFixture(t),revision=p.revision,before=structuredClone(fingerprint(p));
 let r=await apply();assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.project.revision,revision+1);assert.equal(r.body.panels,2);assert.deepEqual(fingerprint(r.body.project),before);
 r=await apply({mode:'empty',expectedRevision:revision});assert.equal(r.status,409);assert.equal(studio.store.project(p.id).revision,revision+1);
 studio.store.db.jobs.push({projectId:p.id,status:'running'});r=await apply({mode:'empty'});assert.equal(r.status,409);assert.equal(studio.store.project(p.id).revision,revision+1);studio.store.db.jobs=[];
 const current=studio.store.project(p.id);productionFrame(current,'E011-S002').locked=true;const unchanged=structuredClone(current);r=await apply({mode:'empty'});assert.equal(r.status,409);assert.deepEqual(studio.store.project(p.id),unchanged);assert.equal(studio.store.db.jobs.length,0);
});
test('浏览器点击整话按钮、切换单位和刷新后保持一致，零生图请求',{skip:!process.env.COMIC_PLAYWRIGHT_PATH},async t=>{
 const {studio,p,base}=await serverFixture(t),{chromium}=createRequire(import.meta.url)(process.env.COMIC_PLAYWRIGHT_PATH);
 const browser=await chromium.launch({headless:true,executablePath:process.env.COMIC_TEST_BROWSER_EXECUTABLE});t.after(()=>browser.close());
 const page=await browser.newPage({viewport:{width:1600,height:1000}}),errors=[],jobs=[],requests=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()==='POST'){if(r.url().includes('/api/jobs'))jobs.push(r.url());if(r.url().includes('/production/episode-mode'))requests.push(r.postDataJSON());}});
 await page.route('**/api/library/**',r=>r.fulfill({json:{connected:false,items:[]}}));await page.goto(base+'/?project='+p.id);await page.locator('#stage [data-panel]').first().waitFor();await page.locator('[data-rail-tab="production"]').click();
 const button=page.locator('[data-production-episode-mode]');assert.equal(await button.innerText(),'一键调整整话出字方式');assert.equal(await page.locator('#production-tab [data-production-generate]').count(),0);
 const firstMode=page.waitForResponse(r=>r.url().endsWith('/production/mode')&&r.status()===200);await page.locator('[data-production-mode]').selectOption('post-lettering');await firstMode;
 const response=page.waitForResponse(r=>r.url().endsWith('/production/episode-mode'));await button.click();assert.equal((await response).status(),200);await button.waitFor({state:'visible'});
 assert.equal(requests.length,1);assert.equal(requests[0].episode,11);for(const s of studio.store.project(p.id).productionPackage.episodes[0].segments)assert.equal(productionFrame(studio.store.project(p.id),s.id).generation.promptSource,'post-lettering');
 await page.locator('[data-production-unit]').selectOption('panel');await page.waitForFunction(()=>document.querySelector('[data-production-grid]')&&!document.querySelector('[data-production-episode-mode]').disabled);
 assert.equal(await page.locator('[data-production-mode]').inputValue(),'post-lettering');const saved=page.waitForResponse(r=>r.url().endsWith('/production/mode'));await page.locator('[data-production-mode]').selectOption('imported');await saved;
 const applied=page.waitForResponse(r=>r.url().endsWith('/production/episode-mode'));await button.click();assert.equal((await applied).status(),200);await page.reload();await page.locator('#stage [data-panel]').first().waitFor();await page.locator('[data-rail-tab="production"]').click();assert.equal(await page.locator('[data-production-mode]').inputValue(),'imported');
 await page.screenshot({path:path.join(proof,'episode-mode.png')});assert.deepEqual(errors,[]);assert.deepEqual(jobs,[]);assert.equal(studio.store.db.jobs.length,0);
 fs.writeFileSync(path.join(proof,'report.json'),JSON.stringify({ok:true,bulkRequests:requests.length,noGeneration:true,reloadPersisted:true,errors},null,2));
});
