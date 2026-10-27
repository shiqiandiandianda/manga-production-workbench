import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
import {createStudio} from '../server.mjs';
import {createProject,panel,id,clone} from '../public/model.js';
import {migrateLayerDocument,makeGradientLayer} from '../public/layers.js';
import {ensureLayoutHistory} from '../public/layout-history.js';
import {ensureEpisodeBoards} from '../public/episode-boards.js';
import {attachBubbleGroups,moveGroupedLayer} from '../public/layer-groups.js';
import {layerOrderAvailability} from '../public/canvas-layer-order.js';

const require=createRequire(import.meta.url),deps=path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'),{chromium}=require(path.join(deps,'playwright'));
const geometry=p=>({pages:p.pages.map(page=>({id:page.id,panels:page.panels.map(f=>({id:f.id,x:f.x,y:f.y,w:f.w,h:f.h,points:f.points,imageAssetId:f.imageAssetId,imageTransform:f.imageTransform})),bubbles:page.bubbles.map(b=>({id:b.id,x:b.x,y:b.y,w:b.w,h:b.h,text:b.text,parentPanelId:b.parentPanelId}))})),gradients:p.gradients.map(g=>({id:g.id,x:g.x,y:g.y,w:g.w,h:g.h,gradient:g.gradient}))});

test('对白逐层升降跨过同组文字和画格，不改变归属或坐标',()=>{
 const p=migrateLayerDocument(createProject('合成对白排序')).project,a=p.pages[0].panels[0];p.pages[0].bubbles=[{id:id('bubble'),type:'speech',text:'第一句',visible:true,x:100,y:100,w:100,h:60,fontSize:24,parentPanelId:a.id,shotId:a.shotId},{id:id('bubble'),type:'speech',text:'第二句',visible:true,x:200,y:200,w:100,h:60,fontSize:24,parentPanelId:a.id,shotId:a.shotId}];
 const [one,two]=p.pages[0].bubbles;p.layerOrder=[a.id,one.id,two.id];const before=clone(p.pages);
 assert.equal(layerOrderAvailability(p,two.id).up,false);assert.equal(moveGroupedLayer(p,two.id,-1),true);assert.deepEqual(p.layerOrder,[a.id,two.id,one.id]);assert.equal(moveGroupedLayer(p,two.id,-1),true);assert.deepEqual(p.layerOrder,[two.id,a.id,one.id]);assert.equal(layerOrderAvailability(p,two.id).down,false);moveGroupedLayer(p,two.id,1);moveGroupedLayer(p,two.id,1);assert.deepEqual(p.layerOrder,[a.id,one.id,two.id]);assert.deepEqual(p.pages,before);
});

test('左侧图层按钮：渐变逐层升降、画格带对白、锁定与边界、撤销重做和刷新保持',{timeout:90000},async t=>{
 const parent=path.resolve('.runtime/temp');fs.mkdirSync(parent,{recursive:true});const directory=fs.mkdtempSync(path.join(parent,'canvas-layer-order-')),proof=path.resolve('merge-audit/canvas-layer-order');fs.mkdirSync(proof,{recursive:true});let browser,calls=0;
 const fake={status:async()=>({connected:false,message:'隔离验证'}),close(){},generate:async()=>{calls++;throw Error('不应调用 AI');}},studio=createStudio({dataDir:directory,bridge:fake,jimengBridge:fake,storyboardGenerator:{close(){}}});
 const p=migrateLayerDocument(createProject('合成图层排序验证')).project,pg=p.pages[0];pg.height=2200;
 const a=panel(p.shots[0].id,100,200,600,600),b=panel('',380,300,600,500),bubble={id:id('bubble'),parentPanelId:a.id,shotId:a.shotId,type:'speech',text:'图层排序验证',visible:true,locked:false,x:180,y:170,w:220,h:100,fontSize:24};pg.panels=[a,b];pg.bubbles=[bubble];
 const g=makeGradientLayer(p,{y:150});Object.assign(g,{x:0,w:1280,h:1000});p.gradients=[g];p.layerOrder=[a.id,bubble.id,b.id,g.id];attachBubbleGroups(p);ensureEpisodeBoards(p);ensureLayoutHistory(p);const before=clone(p);studio.store.db.projects.push(p);studio.store.save();await new Promise(r=>studio.server.listen(0,'127.0.0.1',r));
 t.after(async()=>{await browser?.close();studio.close();await new Promise(r=>studio.server.close(r));assert.equal(path.dirname(directory),parent);fs.rmSync(directory,{recursive:true,force:true});});
 const origin='http://127.0.0.1:'+studio.server.address().port;browser=await chromium.launch({channel:'msedge',headless:true});const context=await browser.newContext({viewport:{width:1864,height:949}}),view=await context.newPage(),errors=[];view.on('pageerror',e=>errors.push(e.message));await context.route('**/*',r=>{const u=new URL(r.request().url());return u.origin===origin||['data:','blob:'].includes(u.protocol)?r.continue():r.abort();});
 await view.goto(origin);await view.waitForFunction(()=>document.querySelector('#save-state').textContent==='已保存到本机');await view.locator('#zoom').selectOption('0.25');await view.locator('[data-rail-tab="layers"]').click();
 const saved=()=>view.waitForFunction(()=>document.querySelector('#save-state').textContent==='已保存到本机'),toolbar=view.locator('.canvas-layer-order'),up=view.locator('[data-canvas-layer-order="up"]'),down=view.locator('[data-canvas-layer-order="down"]');
 const choose=async key=>{await view.locator('[data-layer="'+key+'"]').click();await toolbar.waitFor({state:'visible'});};
 const order=()=>studio.store.project(p.id).layerOrder;
 await choose(g.id);assert.equal(await up.isDisabled(),true);assert.equal(await down.isEnabled(),true);const placement=await view.evaluate(()=>{const tools=document.querySelector('.canvas-layer-order').getBoundingClientRect(),stage=document.querySelector('#stage').getBoundingClientRect(),scroll=document.querySelector('#canvas-scroll').getBoundingClientRect();return {tools:{x:tools.x,right:tools.right,height:tools.height,top:tools.top,bottom:tools.bottom},stageLeft:stage.left,scroll:{left:scroll.left,top:scroll.top,bottom:scroll.bottom}};});assert.ok(placement.tools.right<placement.stageLeft);assert.ok(placement.tools.height<=84,JSON.stringify(placement));assert.ok(placement.tools.top>=placement.scroll.top&&placement.tools.bottom<=placement.scroll.bottom);await view.screenshot({path:path.join(proof,'01-left-of-board.png')});
 await down.click();await saved();assert.deepEqual(order(),[a.id,bubble.id,g.id,b.id]);await down.click();await saved();assert.deepEqual(order(),[g.id,a.id,bubble.id,b.id]);assert.equal(await down.isDisabled(),true);
 await up.click();await saved();assert.deepEqual(order(),[a.id,bubble.id,g.id,b.id]);await view.locator('#undo').click();await saved();assert.deepEqual(order(),[g.id,a.id,bubble.id,b.id]);await view.locator('#redo').click();await saved();assert.deepEqual(order(),[a.id,bubble.id,g.id,b.id]);
 await choose(a.id);await up.click();await saved();assert.deepEqual(order(),[g.id,a.id,bubble.id,b.id]);assert.deepEqual(geometry(studio.store.project(p.id)),geometry(before));
 await view.locator('[data-group-lock="'+a.id+'"]').click();await saved();assert.equal(await up.isDisabled(),true);assert.equal(await down.isDisabled(),true);await view.locator('[data-group-lock="'+a.id+'"]').click();await saved();
 if(await view.locator('[data-toggle-group="'+a.id+'"]').getAttribute('aria-expanded')==='false')await view.locator('[data-toggle-group="'+a.id+'"]').click();await choose(bubble.id);assert.equal(await up.isDisabled(),true);await down.click();await saved();assert.deepEqual(order(),[g.id,bubble.id,a.id,b.id]);assert.equal(await down.isDisabled(),true);
 await choose(g.id);await view.locator('#zoom').selectOption('fit');await toolbar.waitFor({state:'visible'});assert.equal(await toolbar.evaluate(el=>el.classList.contains('compact')),true);const compact=await toolbar.boundingBox();assert.ok(compact.width<=40&&compact.height<=70);await view.screenshot({path:path.join(proof,'02-compact.png')});
 await view.locator('#canvas-scroll').click({position:{x:3,y:8}});assert.equal(await toolbar.isVisible(),false);await choose(g.id);await view.locator('#canvas-scroll').evaluate(el=>el.scrollTop=0);await view.locator('#stage [data-fixed-board="cover"]').click();await view.locator('#episode-board-editor').waitFor({state:'visible'});assert.equal(await toolbar.isVisible(),false);await view.locator('[data-board-back]').click();
 const expected=clone(order());await saved();await view.reload();await view.waitForFunction(()=>document.querySelector('#save-state').textContent==='已保存到本机');assert.deepEqual(order(),expected);assert.deepEqual(geometry(studio.store.project(p.id)),geometry(before));assert.equal(calls,0);assert.deepEqual(errors,[]);
 fs.writeFileSync(path.join(proof,'report.json'),JSON.stringify({ok:true,synthetic:true,realAI:false,browserErrors:errors,coordinatesPreserved:true,groupedLettering:true,undoRedo:true,refreshPersists:true,desktopPlacement:placement,compact},null,2));
});
