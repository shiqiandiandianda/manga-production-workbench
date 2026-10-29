import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {createRequire} from 'node:module';
import {createStudio} from '../server.mjs';
import {createProject,clone} from '../public/model.js';
import {migrateLayerDocument} from '../public/layers.js';
import {ensureLayoutHistory} from '../public/layout-history.js';
import {setPanelPromptText,generationPromptSelection} from '../public/prompt-source.js';
const root=path.resolve(import.meta.dirname,'../..'),require=createRequire(import.meta.url);
const {chromium}=require(process.env.COMIC_TEST_PLAYWRIGHT_MODULE||path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
test('后台图片回填时持续编辑、撤销和再次保存；真冲突可恢复或另存副本',{timeout:90000},async t=>{
 const evidence=path.join(root,'verification/save-conflict-20261029');fs.mkdirSync(evidence,{recursive:true});const dir=fs.mkdtempSync(path.join(evidence,'fixture-'));
 const remote=http.createServer((req,res)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify({items:[],connected:false}));});await new Promise(r=>remote.listen(0,'127.0.0.1',r));
 process.env.COMIC_PROJECT_SYNC='0';process.env.COMIC_SLOT_DIR=path.join(dir,'slots');process.env.COMIC_LIBRARY_CONFIG=path.join(dir,'moku.json');process.env.PROJECT_CENTER_URL='';process.env.ASSET_STUDIO_URL='http://127.0.0.1:'+remote.address().port;fs.writeFileSync(process.env.COMIC_LIBRARY_CONFIG,JSON.stringify({base:process.env.ASSET_STUDIO_URL}));
 const fake={close(){},status:async()=>({connected:true,imageFeature:true}),ensurePoolSize(){},models:async()=>({items:[]}),async generate(){throw Error('Real AI forbidden');}};
 const studio=createStudio({dataDir:path.join(dir,'data'),seedReference:false,bridge:fake,jimengBridge:fake});await new Promise(r=>studio.server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+studio.server.address().port;
 const p=migrateLayerDocument(createProject('后台回填同步验证',true)).project;ensureLayoutHistory(p);studio.store.db.projects.push(p);studio.store.save();
 const native=require(path.join(root,'runtime/node/node_modules/@napi-rs/canvas')),canvas=native.createCanvas(640,960);canvas.getContext('2d').fillRect(20,20,600,920);const file=path.join(dir,'synthetic.png');fs.writeFileSync(file,canvas.toBuffer('image/png'));
 const response=await fetch(origin+'/api/assets',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({filePath:file,name:'合成测试图'})});assert.ok(response.ok);const asset=await response.json();
 const browser=await chromium.launch({channel:'msedge',headless:true});t.after(async()=>{await browser.close();studio.close();studio.server.closeAllConnections();remote.closeAllConnections();remote.close();});
 const page=await browser.newPage({viewport:{width:1771,height:881}}),errors=[],saves=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()==='PUT'&&r.url().includes('/api/projects/'))saves.push(r.postDataJSON());});await page.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());
 await page.route('**/app.js',route=>route.fulfill({contentType:'text/javascript',body:fs.readFileSync(path.join(root,'comic/public/app.js'),'utf8')+'\nwindow.readRevisionTestState=()=>({project,dirty,conflictNotice});'}));
 await page.goto(origin+'/?project='+p.id);await page.waitForFunction(()=>!!window.readRevisionTestState&&document.querySelector('#save-state')?.textContent.includes('已保存'));if(!await page.locator('#inspector-panel').isVisible())await page.locator('[data-properties-shortcut="toolbar"]').click();
 const input=page.locator('textarea[data-section="panel-prompt"]');await input.waitFor();await page.waitForTimeout(2500);const original=await input.inputValue(),frameId=studio.store.project(p.id).pages[0].panels[0].id;
 const current=()=>studio.store.project(p.id),frame=()=>current().pages[0].panels.find(f=>f.id===frameId);
 // A focused but unchanged text field must not lock the document when a job finishes.
 await input.focus();frame().imageAssetId=asset.id;frame().imageTransform={x:0,y:0,scale:.8};frame().candidates=[asset.id];current().updated=new Date().toISOString();studio.store.markProject(current());studio.store.save();
 await page.waitForFunction(id=>window.readRevisionTestState().project.pages[0].panels[0].imageAssetId===id,asset.id,{timeout:8000});assert.equal(await input.inputValue(),original);assert.equal(await input.evaluate(n=>n===document.activeElement),true);assert.equal(await page.locator('#resolve-save-conflict').isVisible(),false);
 // Keep typing through several polls so this exercises a real unsaved draft.
 const before=clone(current()),beforeCount=saves.length;frame().imageTransform={x:3,y:4,scale:.75};studio.store.markProject(current());studio.store.save();
 for(let i=0;i<18;i++){await input.fill(original+'\n人工修改 '+i);await page.waitForTimeout(180);}
 assert.equal(await page.locator('#resolve-save-conflict').isVisible(),false);await input.blur();
 await page.waitForFunction(()=>document.querySelector('#save-state')?.textContent==='已保存到本机');assert.ok(saves.length>beforeCount);assert.equal(generationPromptSelection(frame(),current()).text,original+'\n人工修改 17');assert.equal(frame().imageTransform.x,3);
 await page.locator('#undo').click();await page.waitForTimeout(800);assert.equal(frame().imageAssetId,asset.id);assert.equal(frame().imageTransform.x,3);assert.equal(generationPromptSelection(frame(),current()).text,original);await page.locator('#redo').click();await page.waitForTimeout(800);assert.equal(generationPromptSelection(frame(),current()).text,original+'\n人工修改 17');
 // The same prompt changed on both sides: retain conflict protection.
 const acknowledged=generationPromptSelection(frame(),current()).text;await input.fill(acknowledged+'\n本窗口冲突');setPanelPromptText(frame(),'其他窗口修改');current().revision++;studio.store.markProject(current());studio.store.save();
 for(let i=0;i<17;i++){await input.fill(acknowledged+'\n本窗口冲突 '+i);await page.waitForTimeout(160);}
 await page.locator('#resolve-save-conflict').waitFor({state:'visible'});assert.equal(generationPromptSelection(frame(),current()).text,'其他窗口修改');
 // If the remote side is reverted, the existing conflict flag must clear automatically.
 setPanelPromptText(frame(),acknowledged);current().revision++;studio.store.markProject(current());studio.store.save();await page.waitForFunction(()=>document.querySelector('#resolve-save-conflict')?.hidden===true);await input.blur();await page.waitForTimeout(800);assert.match(generationPromptSelection(frame(),current()).text,/本窗口冲突 16/);
 // A genuine remaining conflict can keep BOTH projects and unblock editing.
 const preserved=generationPromptSelection(frame(),current()).text;await input.fill(preserved+'\n另存保留');setPanelPromptText(frame(),'原工程远端版本');current().revision++;studio.store.markProject(current());studio.store.save();for(let i=0;i<16;i++){await input.fill(preserved+'\n另存保留 '+i);await page.waitForTimeout(160);}await page.locator('#resolve-save-conflict').click();await page.getByRole('button',{name:'另存本窗口副本继续编辑',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#save-state')?.textContent==='已保存到本机');
 const duplicate=studio.store.db.projects.find(v=>v.id!==p.id&&v.title.includes('本窗口保留副本'));assert.ok(duplicate);assert.match(generationPromptSelection(duplicate.pages[0].panels[0],duplicate).text,/另存保留 15/);assert.equal(generationPromptSelection(frame(),current()).text,'原工程远端版本');assert.equal(duplicate.pages[0].panels[0].imageAssetId,asset.id);
 await page.screenshot({path:path.join(evidence,'continued-editing.png')});assert.deepEqual(errors,[]);fs.writeFileSync(path.join(evidence,'browser-acceptance.json'),JSON.stringify({errors,saveCount:saves.length,checks:['focused prompt','typing during completion','undo/redo retains result','same-field conflict','automatic conflict recovery','keep both and continue'],realAI:false},null,2));
});
