import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {createProject,id,clone} from '../public/model.js';
import {migrateLayerDocument} from '../public/layers.js';
import {ensureProjectPanelGeneration} from '../public/panel-generation.js';
import {setPanelReferences} from '../public/panel-references.js';
import {assetWorkspaceInventory} from '../public/asset-workspace-model.js';
import {galleryRemovalTargets} from '../public/asset-workspace-removal.js';
import {removeWorkspaceReference,restoreWorkspaceReference} from '../lib/asset-workspace-removal.mjs';

test('卡片删除固定当前话，去重目标，保留其他话和文字资产，锁定位置不会部分删除',()=>{
 const row={assetIds:['image'],uses:[{episode:41,panelId:'p',needId:'n'},{episode:41,panelId:'p',needId:'n'},{episode:42,panelId:'other',needId:'n'},{episode:41,panelId:'text',needId:'t',text:true}]};
 assert.deepEqual(galleryRemovalTargets(row,41),[{panelId:'p',needId:'n'}]);
 assert.throws(()=>galleryRemovalTargets(row,43),/本话没有/);
 assert.throws(()=>galleryRemovalTargets({...row,assetIds:[]},41),/尚未选用/);
 assert.throws(()=>galleryRemovalTargets({...row,uses:[...row.uses,{episode:41,panelId:'locked',needId:'n',locked:true}]},41),/已锁定/);
});

test('卡片一键删除本话用图、重复点击保护和详情恢复；其他话、提示词、原文件保持不变',{timeout:60000},async t=>{
 const require=createRequire(import.meta.url),{chromium}=require(process.env.COMIC_TEST_PLAYWRIGHT_MODULE||'playwright'),native=require(process.env.COMIC_TEST_CANVAS_MODULE||'@napi-rs/canvas');
 const directory=fs.mkdtempSync(path.join(process.env.QUALITY_EVIDENCE_DIR||os.tmpdir(),'gallery-delete-')),png=native.createCanvas(64,96).toBuffer('image/png'),imageFile=path.join(directory,'original.png');fs.writeFileSync(imageFile,png);
 const image={id:id('asset'),name:'人物甲_白衣.png',libraryName:'人物甲',libraryRole:'character',libraryState:'白衣',productionStatus:'confirmed',filePath:imageFile,width:64,height:96},assets=[image],project=migrateLayerDocument(createProject('合成删除用图')).project;
 project.references=[];project.shots=[project.shots[0]];Object.assign(project.shots[0],{participants:'人物甲',description:'人物甲站在原地',characterStates:'人物甲:白衣',episode:41});project.pages=[project.pages[0]];project.pages[0].panels=[project.pages[0].panels[0]];project.pages[0].bubbles=[];project.pages[0].storyboard={episode:41};
 const other=clone(project.pages[0]);other.id=id('page');other.storyboard={episode:42};other.panels[0].id=id('panel');project.pages.push(other);project.assetLibrary={version:1,assetIds:[image.id],directories:[],recursive:true};
 project.layerOrder=project.pages.flatMap(page=>page.panels.map(panel=>panel.id));ensureProjectPanelGeneration(project,assets);for(const page of project.pages)setPanelReferences(page.panels[0],[image.id],{project,assets});
 const store={db:{assets,jobs:[]}},requests=[],errors=[],promptBefore=JSON.stringify(project.shots),hash=()=>createHash('sha256').update(fs.readFileSync(imageFile)).digest('hex'),beforeHash=hash();let current=project;
 const html=`<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/asset-workspace.css"><style>body{margin:0;background:#111c27;color:#e1edf7;font:14px sans-serif}.app-shell{position:relative;height:100vh}button,input,select{padding:8px}</style><div class="app-shell"><section id="references-tab"></section><span id="inspector-kind"></span><span id="inspector-title"></span><section id="inspector-body"></section></div><script type="module">import{mountAssetWorkspace}from'/asset-workspace-ui.js';let d=await(await fetch('/fixture')).json();window.ui=mountAssetWorkspace({api:async(url,method='GET',body)=>{const r=await fetch(url,{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined}),v=await r.json();if(!r.ok)throw Error(v.error);return v;},getProject:()=>d.project,getPage:()=>d.project.pages[0],getSelected:()=>d.project.pages[0].panels[0],getAssets:()=>d.assets,flushSave:async()=>{},accept:async p=>{d.project=p},onAssets(){},toast(message,error){if(error)window.errors.push(message);},renderInspector(){}});window.errors=[];window.ui.open();</script>`;
 const publicRoot=path.resolve(import.meta.dirname,'../public'),server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://fixture'),json=(value,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
  try{
   if(url.pathname==='/')return res.end(html);
   if(url.pathname==='/fixture')return json({project:current,assets});
   if(url.pathname.startsWith('/api/assets/')){res.setHeader('Content-Type','image/png');return res.end(png);}
   if(req.method==='POST'&&/\/asset-workspace\/(remove|restore)$/.test(url.pathname)){
    const chunks=[];for await(const b of req)chunks.push(b);const input=JSON.parse(Buffer.concat(chunks)),action=url.pathname.endsWith('/remove')?'remove':'restore';requests.push({action,input});
    if(action==='remove')await new Promise(r=>setTimeout(r,120));
    current=action==='remove'?removeWorkspaceReference(store,current,input):restoreWorkspaceReference(store,current,input);current.revision++;return json({project:current});
   }
   if(url.pathname.endsWith('/reuse'))return json({changed:false});
   if(url.pathname.startsWith('/api/'))return json({items:[],more:false});
   const file=path.resolve(publicRoot,'.'+url.pathname);if(!file.startsWith(publicRoot+path.sep)||!fs.existsSync(file))return json({},404);
   res.setHeader('Content-Type',file.endsWith('.css')?'text/css':'text/javascript');res.end(fs.readFileSync(file));
  }catch(error){json({error:error.message},error.status||400);}
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close();});
 const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({channel:'msedge',headless:true});t.after(()=>browser.close());const page=await browser.newPage({viewport:{width:1600,height:1000}});page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());
 await page.goto(origin);await page.locator('[data-gallery-remove]').waitFor();await page.locator('[data-project-assets-browse]').click();await page.locator('[data-gallery-remove]').waitFor();
 const removalResponse=page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname.endsWith('/asset-workspace/remove'));
 await page.evaluate(()=>{const b=document.querySelector('[data-gallery-remove]');b.click();b.click();});
 const removed=await removalResponse;assert.equal(removed.status(),200,await removed.text());
 await page.waitForFunction(()=>!document.querySelector('[data-gallery-remove]:disabled'),null,{timeout:6000});
 for(let i=0;i<100&&requests.filter(x=>x.action==='remove').length!==1;i++)await page.waitForTimeout(20);
 assert.equal(requests.filter(x=>x.action==='remove').length,1);assert.ok(requests[0].input.targets.every(x=>x.panelId===current.pages[0].panels[0].id));
 let rows=assetWorkspaceInventory(current,assets,{scope:'work'}),uses=rows[0].uses;assert.ok(uses.find(u=>u.episode===41).missing);assert.equal(uses.find(u=>u.episode===42).missing,false);
 await page.locator('[data-gallery-settings]').click();await page.locator('[data-asset-restore-removal]').click();await page.locator('[data-asset-action="remove-current"]').waitFor();
 rows=assetWorkspaceInventory(current,assets,{scope:'work'});assert.ok(rows[0].uses.every(u=>!u.missing));assert.equal(requests.filter(x=>x.action==='restore').length,1);
 assert.equal(hash(),beforeHash);assert.equal(JSON.stringify(current.shots),promptBefore);assert.equal(store.db.assets.length,1);assert.deepEqual(errors,[]);assert.deepEqual(await page.evaluate(()=>window.errors),[]);
 await page.locator('[data-asset-close]').click();await page.screenshot({path:path.join(directory,'delete-button.png')});
});
