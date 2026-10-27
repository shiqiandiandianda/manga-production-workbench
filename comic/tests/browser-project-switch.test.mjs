import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
import {createStudio} from '../server.mjs';
import {createProject,clone,layoutLongStrip} from '../public/model.js';
import {migrateLayerDocument} from '../public/layers.js';
import {ensureLayoutHistory} from '../public/layout-history.js';
import {ensureEpisodeBoards} from '../public/episode-boards.js';
import {canvasEpisodeBoards,comicViewOffset} from '../public/episode-board-canvas.js';
import {documentView} from '../public/scene-svg.js';

const require=createRequire(import.meta.url),deps=path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules');
const evidence=path.resolve('merge-audit/project-switch');
function fixture(title){const p=migrateLayerDocument(createProject(title,true)).project;ensureEpisodeBoards(p);ensureLayoutHistory(p);return p;}
function stateFor(p){const decorations=canvasEpisodeBoards(p,p.pages[0]);return {mode:'continuous',currentPageId:p.pages[0].id,decorations,layout:layoutLongStrip([decorations.cover.page,...p.pages,decorations.tail.page]),window:{startY:0,endY:2500}};}

test('跨工程和已删除画板的旧视口不会读取不存在的坐标',()=>{
 const old=fixture('合成旧工程'),next=fixture('合成新工程'),state=stateFor(old),before=clone(next);
 assert.equal(comicViewOffset(next,state,layoutLongStrip(next.pages)),0);
 assert.equal(documentView(next,state).offset,0);
 assert.deepEqual(next,before);
 const oldState=stateFor(old),removed=clone(old);removed.pages=[];
 assert.equal(documentView(removed,oldState).offset,0);
 assert.equal(comicViewOffset(next,{...state,mode:'page'},layoutLongStrip(next.pages)),0);
 assert.equal(comicViewOffset(next,{...state,layout:layoutLongStrip([]),decorations:null},layoutLongStrip(next.pages)),0);
});

test('有效视口保留封面和跨页坐标，首个旧画板消失后仍可用后续共同画板定位',()=>{
 const p=fixture('合成多画板'),extra=clone(p.pages[0]);extra.id+='-second';p.pages.push(extra);
 const state=stateFor(p),layout=layoutLongStrip(p.pages);
 assert.equal(comicViewOffset(p,state,layout),-state.decorations.cover.page.height);
 const next=clone(p);next.pages.shift();
 assert.equal(comicViewOffset(next,state,layoutLongStrip(next.pages)),-state.layout.pages.find(e=>e.pageId===extra.id).y);
});

test('从已有正文、封面、关闭状态新建工程可立即编辑，切回原工程和刷新均保留内容',{timeout:90000},async t=>{
 const parent=path.resolve('.runtime/temp');fs.mkdirSync(parent,{recursive:true});fs.mkdirSync(evidence,{recursive:true});
 const data=fs.mkdtempSync(path.join(parent,'project-switch-')),original=fixture('合成旧工程 · 内容应保留'),before=clone(original);let browser,aiCalls=0;
 const fake={status:async()=>({connected:false,message:'合成测试'}),close(){},generate:async()=>{aiCalls++;throw Error('不应调用 AI');}};
 const studio=createStudio({dataDir:data,bridge:fake,jimengBridge:fake,storyboardGenerator:{close(){}}});studio.store.db.projects.push(original);studio.store.save();
 await new Promise(r=>studio.server.listen(0,'127.0.0.1',r));
 t.after(async()=>{await browser?.close();studio.close();await new Promise(r=>studio.server.close(r));assert.equal(path.dirname(data),parent);fs.rmSync(data,{recursive:true,force:true});});
 const origin='http://127.0.0.1:'+studio.server.address().port,{chromium}=require(path.join(deps,'playwright'));
 browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
 const context=await browser.newContext({viewport:{width:1864,height:949}}),page=await context.newPage(),errors=[];let createRequests=0,failNextOpen=false;
 page.on('pageerror',e=>errors.push(e.stack||e.message));
 await context.route('**/*',async route=>{const req=route.request(),url=new URL(req.url());if(url.origin!==origin&&!['data:','blob:'].includes(url.protocol))return route.abort();if(failNextOpen&&req.method()==='GET'&&/^\/api\/projects\/[^/]+$/.test(url.pathname)){failNextOpen=false;return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'合成测试：打开工程失败'})});}if(url.pathname==='/api/projects'&&req.method()==='POST'){createRequests++;await new Promise(r=>setTimeout(r,200));}return route.continue();});
 await page.goto(origin);await page.waitForFunction(()=>document.querySelector('#save-state').textContent==='已保存到本机');
 async function choose(id){await page.locator('#project-trigger').click();await page.locator('[data-choose-project="'+id+'"]').click();await page.waitForFunction(value=>document.querySelector('#project-select').value===value,id);await page.locator('#stage [data-panel]').first().waitFor();}
 async function create(title,{retry=false}={}){
  const count=studio.store.db.projects.length,requests=createRequests;await page.locator('#project-trigger').click();await page.locator('#new-project').click();await page.locator('#new-title').fill(title);
  // Two synchronous clicks expose duplicate submissions even when the server is slow.
  if(retry)failNextOpen=true;
  await page.locator('#modal-actions .primary').evaluate(button=>{button.click();button.click();});
  assert.equal(await page.locator('#modal-actions .primary').isDisabled(),true);
  if(retry){await page.waitForFunction(()=>document.querySelector('#toast').textContent==='合成测试：打开工程失败');assert.equal(studio.store.db.projects.length,count+1);assert.equal(await page.locator('#modal').evaluate(el=>el.open),true);await page.getByRole('button',{name:'打开工程',exact:true}).evaluate(button=>{button.click();button.click();});}
  try{await page.waitForFunction(()=>!document.querySelector('#modal').open,{},{timeout:10000});}catch(error){throw Error(JSON.stringify({message:error.message,toast:await page.locator('#toast').textContent(),errors,createRequests}));}
  await page.waitForFunction(value=>document.querySelector('#project-label').textContent===value,title);await page.locator('#stage [data-panel]').first().waitFor();
  assert.equal(studio.store.db.projects.length,count+1);assert.equal(createRequests,requests+1);assert.equal(await page.locator('#episode-board-editor').isVisible(),false);
  const created=studio.store.db.projects.find(p=>p.title===title);assert.ok(created);await page.locator('#stage [data-panel="'+created.pages[0].panels[0].id+'"]').first().waitFor();assert.equal(await page.locator('#stage [data-panel="'+original.pages[0].panels[0].id+'"]').count(),0);
  await page.waitForFunction(()=>document.querySelector('#save-state').textContent==='已保存到本机');return created;
 }
 const first=await create('合成新工程 · 从正文创建');await page.screenshot({path:path.join(evidence,'01-new-from-comic.png')});
 await page.reload();await page.waitForFunction(value=>document.querySelector('#project-select').value===value,first.id);await page.locator('#stage [data-panel="'+first.pages[0].panels[0].id+'"]').first().waitFor();
 await choose(original.id);await page.locator('#canvas-scroll').evaluate(el=>el.scrollTop=0);await page.locator('#stage [data-fixed-board="cover"]').click();await page.locator('#episode-board-editor').waitFor({state:'visible'});
 await create('合成新工程 · 从封面创建');
 await page.locator('#project-trigger').click();await page.locator('#close-project').click();await page.waitForFunction(()=>document.querySelector('#project-label').textContent==='选择 / 新建漫画');await create('合成新工程 · 从关闭状态创建');
 await choose(original.id);await page.locator('#view-mode').selectOption('page');await create('合成新工程 · 从单页创建');
 await create('合成新工程 · 打开失败只重试一次',{retry:true});
 await choose(original.id);assert.deepEqual(studio.store.project(original.id).pages,before.pages);assert.deepEqual(studio.store.project(original.id).shots,before.shots);assert.equal(aiCalls,0);assert.deepEqual(errors,[]);
 await page.screenshot({path:path.join(evidence,'02-original-preserved.png')});fs.writeFileSync(path.join(evidence,'report.json'),JSON.stringify({ok:true,synthetic:true,realAI:false,createRequests,browserErrors:errors,originalContentPreserved:true,retryReusesCreatedProject:true},null,2));
});
