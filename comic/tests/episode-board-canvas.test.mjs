import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
import {createProject,clone,id,makePage,panel,layoutLongStrip} from '../public/model.js';
import {migrateLayerDocument} from '../public/layers.js';
import {ensureEpisodeBoards} from '../public/episode-boards.js';
import {canvasEpisodeBoards} from '../public/episode-board-canvas.js';
import {documentView,renderSceneSvg} from '../public/scene-svg.js';
import {createStudio} from '../server.mjs';

const require=createRequire(import.meta.url),modules=path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'),native=require(path.join(modules,'@napi-rs/canvas'));
const qaRoot=path.resolve('../verification/inline-boards-20261022'),evidence=path.join(qaRoot,'evidence');fs.mkdirSync(evidence,{recursive:true});
const fixture=()=>{const p=migrateLayerDocument(createProject('画布测试 · 合成漫画')).project;p.pages[0].height=500;p.pages[0].panels=[panel('',100,50,400,200)];p.shots=[];const second=makePage([], 'overlay',1280,600);second.panels=[panel('',200,80,400,200)];p.pages.push(second);p.layerOrder=p.pages.flatMap(p=>p.panels.map(f=>f.id));ensureEpisodeBoards(p);return p;};
const escaped=v=>String(v||'');

test('连续显示增加头尾画板，漫画坐标、蒙版、跨页几何均保持原值',()=>{
 const p=fixture(),before=clone(p),decorations=canvasEpisodeBoards(p,p.pages[0]),layout=layoutLongStrip([decorations.cover.page,...p.pages,decorations.tail.page]);
 assert.deepEqual(layout.pages.map(e=>e.pageId),[decorations.cover.page.id,...p.pages.map(p=>p.id),decorations.tail.page.id]);assert.equal(layout.height,4700);assert.equal(layout.pages[1].y,1800);assert.equal(layout.pages[2].y,2300);
 const ctx=native.createCanvas(100,100).getContext('2d'),options={assets:new Map(),measurement:ctx,selection:null,tool:'move',escape:escaped,shotFor:()=>null,activeJob:()=>null};
 const state={mode:'continuous',currentPageId:p.pages[0].id,zoom:.3,layout,decorations,window:{startY:0,endY:2500}};
 const view=documentView(p,state);assert.equal(view.offset,-1800);assert.equal(view.region.y,-1800);assert.equal(view.layout.pages[0].y,0);
 const head=renderSceneSvg(p,state,options);assert.match(head.content,/data-fixed-board="cover"/);assert.match(head.content,/translate\(0 1800\)/);assert.match(head.content,/translate\(100 50\)/);
 const end=renderSceneSvg(p,{...state,window:{startY:2800,endY:4700}},options);assert.match(end.content,/data-fixed-board="tail"/);assert.match(end.content,/<svg x="0" y="2900"/);assert.doesNotMatch(end.content,/data-fixed-board="cover"/);
 const single=renderSceneSvg(p,{...state,mode:'page',decorations:null,currentPageId:p.pages[1].id,window:{startY:0,endY:600}},options);assert.equal(single.view.offset,500);assert.doesNotMatch(single.content,/data-fixed-board=/);assert.deepEqual(p,before);
});

test('封面尾图在连续画布直接编辑，缩放位置保持，正文拖动坐标正确',{timeout:90000},async t=>{
 const {chromium}=require(path.join(modules,'playwright')),data=fs.mkdtempSync(path.join(qaRoot,'browser-data-')),fake={status:async()=>({connected:false,message:'合成测试'}),close(){},ensurePoolSize(){}};
 const studio=createStudio({dataDir:data,bridge:fake,jimengBridge:fake});let browser;await new Promise(r=>studio.server.listen(0,'127.0.0.1',r));t.after(async()=>{await browser?.close();studio.close();studio.server.closeAllConnections();});
 const p=fixture();studio.store.db.projects.push(p);studio.store.save();const origin='http://127.0.0.1:'+studio.server.address().port;
 const source=path.join(data,'canvas.png');fs.writeFileSync(source,native.createCanvas(100,100).toBuffer('image/png'));const asset=await(await fetch(origin+'/api/assets',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({filePath:source})})).json();for(const kind of ['cover','tail'])p.episodeBoards.templates[kind].backgroundAssetId=asset.id;for(const pg of p.pages)for(const f of pg.panels){f.imageAssetId=asset.id;f.imageTransform={x:0,y:0,scale:4};}studio.store.save();
 browser=await chromium.launch({channel:'msedge',headless:true});const context=await browser.newContext({viewport:{width:1864,height:949}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await context.route('**/*',route=>['127.0.0.1','localhost'].includes(new URL(route.request().url()).hostname)||['data:','blob:'].includes(new URL(route.request().url()).protocol)?route.continue():route.abort());
 await page.goto(origin+'/?project='+p.id);await page.locator('#stage [data-fixed-board="cover"]').waitFor();await page.waitForFunction(()=>document.querySelector('#save-state').textContent==='已保存到本机');await page.waitForTimeout(600);await page.locator('#zoom').selectOption('0.25');await page.locator('[data-rail-tab="pages"]').click();
 for(const kind of ['tail','cover']){
  await page.locator('#page-list [data-episode-board="'+kind+'"]').click();await page.locator('#stage [data-fixed-board="'+kind+'"]').waitFor();
  assert.equal(await page.locator('#inspector-kind').textContent(),kind==='cover'?'封面 · 固定格子':'尾图 · 固定格子');assert.equal(await page.locator('#episode-board-editor,[data-board-back]').count(),0);assert.equal(await page.locator('#canvas-scroll').isVisible(),true);assert.equal(await page.locator('#zoom').inputValue(),'0.25');
  const key='image',before={x:0,y:0};
  // Use the body of the text control rather than its label; both boards remain in the same viewport.
  const target=page.locator('#stage [data-fixed-board="'+kind+'"] [data-board-layer="'+key+'"]').first();await target.evaluate(el=>el.scrollIntoView({block:'center'}));await page.waitForTimeout(120);const box=await target.boundingBox();await page.screenshot({path:path.join(evidence,'before-'+kind+'.png')});
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);const saved=page.waitForResponse(r=>r.url()===origin+'/api/projects/'+p.id&&r.request().method()==='PUT');await page.mouse.down();await page.mouse.move(box.x+box.width/2+12,box.y+box.height/2+8,{steps:5});await page.mouse.up();
  const savedResponse=await saved;assert.equal(savedResponse.status(),200);
  const after=(await(await fetch(origin+'/api/projects/'+p.id)).json()).episodeBoards.episodes[1][kind].imageTransform;assert.ok(Math.abs(after.x-before.x-48)<.2&&Math.abs(after.y-before.y-32)<.2,JSON.stringify({kind,before,after}));await page.screenshot({path:path.join(evidence,'inline-'+kind+'.png')});
 }
 for(const [index,dx,dy] of [[0,30,20],[1,20,15]]){const owner=p.pages[index],frame=owner.panels[0],before=clone(studio.store.project(p.id).pages[index].panels[0]);await page.locator('#page-list [data-page="'+owner.id+'"]').click();const target=page.locator('#stage [data-panel="'+frame.id+'"]').first();await page.waitForTimeout(200);await target.waitFor();const box=await target.boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);const saved=page.waitForResponse(r=>r.url()===origin+'/api/projects/'+p.id&&r.request().method()==='PUT');await page.mouse.down();await page.mouse.move(box.x+box.width/2+dx,box.y+box.height/2+dy,{steps:6});await page.mouse.up();assert.equal((await saved).status(),200);const after=studio.store.project(p.id).pages[index].panels[0];assert.ok(Math.abs(after.y-before.y-dy/.25)<.2);}
 const final=studio.store.project(p.id);assert.deepEqual(final.pages.map(p=>[p.id,p.height]),p.pages.map(p=>[p.id,p.height]));assert.deepEqual(errors,[]);
});
