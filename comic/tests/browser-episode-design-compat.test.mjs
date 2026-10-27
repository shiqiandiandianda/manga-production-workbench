import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
import {createStudio} from '../server.mjs';
import {createProject,clone} from '../public/model.js';
import {migrateLayerDocument} from '../public/layers.js';
import {ensureProjectPanelGeneration} from '../public/panel-generation.js';
import {ensureLayoutHistory} from '../public/layout-history.js';
import {ensureEpisodeBoards,resolveBoard} from '../public/episode-boards.js';

const require=createRequire(import.meta.url),modules=path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules');
const {chromium}=require(path.join(modules,'playwright')),graphics=require(path.join(modules,'@napi-rs/canvas'));
const qaRoot=path.resolve('../verification/synthetic-browser');
const outline={version:1,sourceKey:'synthetic-browser-design-compat',workTitle:'合成兼容作品',episodes:[{episode:1,title:'第一话自动话名'},{episode:2,title:'第二话自动话名'}]};

function fixture(episode=1){
 const project=migrateLayerDocument(createProject('合成兼容测试 · 第'+episode+'话',true)).project;
 project.pages.forEach(page=>{page.storyboard={episode};});project.episodeOutline=clone(outline);ensureEpisodeBoards(project);ensureProjectPanelGeneration(project,[]);ensureLayoutHistory(project);return project;
}
async function harness(t,{siblings=false}={}){
 fs.mkdirSync(qaRoot,{recursive:true});const directory=fs.mkdtempSync(path.join(qaRoot,'run-')),evidence=path.join(directory,'evidence');fs.mkdirSync(evidence);
 const image=graphics.createCanvas(128,180),ctx=image.getContext('2d');ctx.fillStyle='#335577';ctx.fillRect(0,0,128,180);ctx.fillStyle='#77bb99';ctx.fillRect(20,20,88,130);const filePath=path.join(directory,'synthetic-background.png');fs.writeFileSync(filePath,image.toBuffer('image/png'));
 let generationCalls=0;const rejectGeneration=async()=>{generationCalls++;throw Error('Real AI and image generation are forbidden in this synthetic test');};
 const fake={status:async()=>({connected:false,installed:false,needsLogin:false,message:'synthetic browser compatibility'}),models:async()=>({items:[]}),generate:rejectGeneration,close(){}};
 const studio=createStudio({dataDir:path.join(directory,'data'),bridge:fake,jimengBridge:fake,storyboardGenerator:{generate:rejectGeneration,close(){}}});
 await new Promise(resolve=>studio.server.listen(0,'127.0.0.1',resolve));assert.notEqual(studio.server.address().port,18896);const origin='http://127.0.0.1:'+studio.server.address().port;
 const request=async(route,method='GET',body)=>{const response=await fetch(origin+route,{method,headers:body?{'Content-Type':'application/json'}:undefined,...(body?{body:JSON.stringify(body)}:{})});const value=await response.json();assert.ok(response.ok,JSON.stringify({status:response.status,value}));return value;};
 const asset=await request('/api/assets','POST',{filePath}),project=fixture(),sibling=siblings?fixture(2):null;
 for(const p of [project,sibling].filter(Boolean)){p.episodeBoards.templates.cover.backgroundAssetId=asset.id;studio.store.db.projects.push(p);}studio.store.save();
 // Persistent browser profiles, downloads, screenshots and synthetic project data all stay on D:.
 const context=await chromium.launchPersistentContext(path.join(directory,'browser-profile'),{channel:'msedge',headless:true,args:['--disable-gpu'],viewport:{width:1600,height:1050},acceptDownloads:true,downloadsPath:path.join(directory,'downloads'),env:{...process.env,TEMP:directory,TMP:directory}});
 const errors=[];context.on('page',page=>page.on('pageerror',error=>errors.push(error.message)));
 await context.route('**/*',route=>{const url=new URL(route.request().url());return url.origin===origin||['data:','blob:'].includes(url.protocol)?route.continue():route.abort();});
 const page=context.pages()[0]||await context.newPage();page.on('pageerror',error=>errors.push(error.message));
 t.after(async()=>{await context.close();studio.close();await new Promise(resolve=>studio.server.close(resolve));assert.equal(generationCalls,0);assert.deepEqual(errors,[]);});
 const state=id=>request('/api/projects/'+(id||project.id));
 const load=async(target=page,id=project.id)=>{await target.goto(origin);await target.waitForFunction(()=>document.querySelector('#save-state')?.textContent==='已保存到本机');if((await target.locator('#project-label').textContent())!==(id===project.id?project.title:sibling.title)){await target.locator('#project-trigger').click();await target.locator('[data-choose-project="'+id+'"]').click();}await target.waitForFunction(title=>document.querySelector('#project-label')?.textContent===title,id===project.id?project.title:sibling.title);if(await target.locator('#sidebar-toggle').getAttribute('aria-expanded')!=='true')await target.locator('[data-rail-tab="pages"]') .click();};
 const openCover=async target=>{await target.locator('[data-episode-board="cover"]').click();await target.locator('#episode-board-editor').waitFor({state:'visible'});};
 const saveResponse=(target,id)=>target.waitForResponse(response=>response.url()===origin+'/api/projects/'+id&&response.request().method()==='PUT');
 const changeStyle=async(target,id,key,value)=>{const saving=saveResponse(target,id),field=target.locator('[data-board-style="'+key+'"]');if(await field.evaluate(element=>element.tagName==='SELECT'))await field.selectOption(String(value));else{await field.fill(String(value));await field.blur();}const response=await saving;assert.equal(response.status(),200,await response.text());await target.waitForFunction(()=>document.querySelector('#save-state')?.textContent==='已保存到本机');};
 return {directory,evidence,origin,context,page,project,sibling,asset,load,openCover,state,saveResponse,changeStyle,errors};
}

test('封面共用文字手改后保存、工具撤销、重载保留当前共享版本',{timeout:90000},async t=>{
 const h=await harness(t);await h.load();await h.openCover(h.page);const original=(await h.state()).episodeBoards.templates.cover.layers[0];
 await h.changeStyle(h.page,h.project.id,'fontFamily','system-serif');await h.changeStyle(h.page,h.project.id,'x',original.x+70);
 let saved=await h.state();assert.equal(saved.episodeBoards.templates.cover.layers[0].fontFamily,'system-serif');assert.equal(saved.episodeBoards.templates.cover.layers[0].x,original.x+70);const afterEditRevision=saved.episodeBoards.templateRevision;
 for(const expected of [{x:original.x,fontFamily:'system-serif'},{x:original.x,fontFamily:original.fontFamily}]){const response=h.saveResponse(h.page,h.project.id);await h.page.locator('#undo').click();assert.equal((await response).status(),200);await h.page.waitForFunction(()=>document.querySelector('#save-state')?.textContent==='已保存到本机');saved=await h.state();const layer=saved.episodeBoards.templates.cover.layers[0];assert.equal(layer.x,expected.x);assert.equal(layer.fontFamily,expected.fontFamily);assert.ok(saved.episodeBoards.templateRevision>afterEditRevision);}
 await h.page.reload();await h.page.waitForFunction(()=>document.querySelector('#save-state')?.textContent==='已保存到本机');if(await h.page.locator('#sidebar-toggle').getAttribute('aria-expanded')!=='true')await h.page.locator('[data-rail-tab="pages"]') .click();await h.openCover(h.page);assert.equal(await h.page.locator('[data-board-style="x"]').inputValue(),String(original.x));assert.equal(await h.page.locator('[data-board-style="fontFamily"]').inputValue(),original.fontFamily);assert.equal((await h.state()).episodeBoards.templates.cover.backgroundAssetId,h.asset.id);await h.page.screenshot({path:path.join(h.evidence,'cover-after-undo-reload.png')});
});

test('从封面编辑进入AI假方案后采用返回正文，保留模板底图、自动话名和55项能力',{timeout:90000},async t=>{
 const h=await harness(t);await h.load();await h.openCover(h.page);assert.equal(await h.page.locator('[data-board-meta="episodeTitle"]').inputValue(),outline.episodes[0].title);await h.changeStyle(h.page,h.project.id,'fontFamily','system-serif');
 const before=await h.state(),bubble=before.pages.flatMap(page=>page.bubbles).find(b=>b.type!=='sfx');assert.ok(bubble);
 await h.page.locator('#ai-design-open').click();const dialog=h.page.locator('.comic-design-dialog');await dialog.waitFor({state:'visible'});assert.equal(await dialog.locator('.design-capability-list p').count(),55);
 const plan={format:'comic-design-plan-v2',schemaVersion:2,baseProjectId:h.project.id,operations:[{id:'compat-font',tool:'bubble.typography',target:{kind:'bubble',id:bubble.id},args:{fontSize:bubble.fontSize+4,fontFamily:'system-sans'}}]};
 await dialog.locator('details').filter({has:h.page.locator('[data-design-json]')}).locator('summary').first().click();await dialog.locator('[data-design-json]').fill(JSON.stringify(plan));await dialog.locator('[data-design-action="import"]').click();await dialog.locator('[data-design-after] > svg').waitFor({state:'visible'});assert.equal(await dialog.locator('[data-design-after] > svg').getAttribute('width'),'390');
 await dialog.locator('[data-design-action="apply"]').click();await h.page.waitForFunction(()=>document.querySelector('#save-state')?.textContent.includes('AI设计已保存'));await dialog.locator('[data-design-action="close"]').click();assert.equal(await h.page.locator('#episode-board-editor').isVisible(),false);assert.equal(await h.page.locator('#canvas-document').isVisible(),true);
 const saved=await h.state();assert.equal(saved.pages.flatMap(page=>page.bubbles).find(b=>b.id===bubble.id).fontSize,bubble.fontSize+4);assert.equal(saved.pages.flatMap(page=>page.bubbles).find(b=>b.id===bubble.id).text,bubble.text);assert.deepEqual(saved.episodeOutline,before.episodeOutline);assert.deepEqual(saved.episodeBoards.templates,before.episodeBoards.templates);assert.deepEqual(saved.episodeBoards.episodes,before.episodeBoards.episodes);
 await h.openCover(h.page);assert.equal(await h.page.locator('[data-board-meta="episodeTitle"]').inputValue(),outline.episodes[0].title);assert.equal(await h.page.locator('[data-board-style="fontFamily"]').inputValue(),'system-serif');assert.equal(await h.page.locator('#episode-board-editor image').count(),1);assert.equal(resolveBoard(saved,'tail',1).context.nextEpisodeTitle,outline.episodes[1].title);await h.page.screenshot({path:path.join(h.evidence,'cover-after-ai-apply.png')});
});

test('同作品兄弟话真实双窗口编辑拒绝陈旧模板保存，保留最新共用样式',{timeout:90000},async t=>{
 const h=await harness(t,{siblings:true});await h.load();await h.openCover(h.page);const other=await h.context.newPage();await h.load(other,h.sibling.id);await h.openCover(other);
 const staleField=other.locator('[data-board-style="x"]');await staleField.fill('350'); // Keep the edit in progress while the sibling publishes its template.
 await h.changeStyle(h.page,h.project.id,'fontFamily','system-serif');const current=await h.state(h.sibling.id);assert.equal(current.episodeBoards.templates.cover.layers[0].fontFamily,'system-serif');
 const rejected=h.saveResponse(other,h.sibling.id);await staleField.blur();const response=await rejected;assert.equal(response.status(),409,await response.text());await other.waitForFunction(()=>document.querySelector('#save-state')?.textContent.includes('保存失败'));
 const saved=await h.state(h.sibling.id);assert.equal(saved.episodeBoards.templates.cover.layers[0].x,128);assert.equal(saved.episodeBoards.templates.cover.layers[0].fontFamily,'system-serif');assert.equal(saved.episodeOutline.episodes[1].title,outline.episodes[1].title);assert.equal((await h.state()).episodeBoards.templates.cover.layers[0].fontFamily,'system-serif');await other.screenshot({path:path.join(h.evidence,'stale-template-save-rejected.png')});
});
