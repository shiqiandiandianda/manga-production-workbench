import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {createProject,makePage,id} from '../public/model.js';
import {migrateLayerDocument} from '../public/layers.js';
import {ensureProjectPanelGeneration} from '../public/panel-generation.js';
import {assetWorkspaceInventory} from '../public/asset-workspace-model.js';
import {galleryGenerationState,galleryReturnDecision} from '../public/asset-gallery-batch.js';
import {prepareWorkspaceText,prepareWorkspaceBinding,workspaceTarget} from '../lib/asset-workspace-api.mjs';

test('文生场景的完整结果优先展示，显式接回可改用图片，仍保护已有图片和不完整结果',()=>{
 const use={panelId:'panel',needId:'scene',text:true,missing:false},row={role:'scene',name:'小径',state:'',status:'text',assetIds:[],availableIds:[],uses:[use]};
 const record={id:'result',role:'scene',name:'小径',status:'completed',partial:false,available:true,imageUrl:'/image',context:{projectId:'p'},source:{projectId:'p'}};
 assert.equal(galleryGenerationState(row,[record]),'result');assert.equal(galleryGenerationState(row,[]),'text');
 assert.equal(galleryReturnDecision(row,[record],{projectId:'p'}).status,'skip');
 const options={projectId:'p',includeText:true};assert.equal(galleryReturnDecision(row,[record],options).status,'ready');
 assert.equal(galleryReturnDecision(row,[record,{...record,id:'v2'}],options).status,'review');
 for(const patch of [{partial:true},{status:'failed'},{source:{projectId:'other'}},{name:'别处'},{matchNote:'请核对'}])assert.notEqual(galleryReturnDecision(row,[{...record,...patch}],options).status,'ready');
 for(const patch of [{locked:true},{skipped:true},{text:false,missing:false}])assert.equal(galleryReturnDecision({...row,uses:[{...use,...patch}]},[record],options).status,'skip');
});

test('浏览器文生场景显示已生成缩略图，唯一结果接回、多版本选图、保存刷新不重复生成',{timeout:60000},async t=>{
 const names=['枣林外小径','枣林木屋外','无结果场景'];let project=createProject('场景接回隔离验收');project.shots=names.map((name,i)=>({id:id('shot'),code:'S'+i,title:name,description:name,location:name,participants:'',dialogue:'',referenceIds:[]}));project.pages=[makePage(project.shots.map(s=>s.id))];project=migrateLayerDocument(project).project;
 const assets=[],attempts=[];ensureProjectPanelGeneration(project,assets);const store={db:{assets,jobs:[]},asset:id=>assets.find(a=>a.id===id)};const inventory=()=>assetWorkspaceInventory(project,assets,{scope:'work'});const rowFor=name=>inventory().find(r=>r.name===name);
 for(const name of names){const row=rowFor(name);assert.ok(row,name);project=prepareWorkspaceText(store,project,{expectedRevision:project.revision,targets:row.uses,mode:'text',description:name+'原始文字描述'});}
 const records=names.slice(0,2).flatMap((name,i)=>Array.from({length:i+1},(_,version)=>{const row=rowFor(name),use=row.uses[0];return {id:'production_'+randomUUID(),name,role:'scene',state:'侧视',status:'completed',partial:false,available:true,imageUrl:'/pixel.png',context:{projectId:project.id,panelId:use.panelId,needId:use.needId},source:{projectId:project.id,panelId:use.panelId,needId:use.needId},version:String(version)};}));
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aHHsAAAAASUVORK5CYII=','base64'),publicRoot=path.resolve('public');let submissions=0;
 const html=`<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/asset-workspace.css"><style>body{margin:0;font:14px Microsoft YaHei;background:#111c27}.app-shell{height:100vh}button,input,select{font:inherit;padding:8px}</style><div class="app-shell"><section id="references-tab"></section><span id="inspector-kind"></span><span id="inspector-title"></span><section id="inspector-body"></section></div><script type="module">import{mountAssetWorkspace}from'/asset-workspace-ui.js';let data=await(await fetch('/fixture')).json();window.errors=[];const api=async(url,method='GET',body)=>{const r=await fetch(url,{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined}),v=await r.json();if(!r.ok)throw Error(v.error);return v;};window.ui=mountAssetWorkspace({api,getProject:()=>data.project,getPage:()=>data.project.pages[0],getSelected:()=>data.project.pages[0].panels[0],getAssets:()=>data.assets,flushSave:async()=>{},accept:async p=>{data.project=p;window.ui.refresh(true);},onAssets:items=>{for(const a of items)if(!data.assets.some(v=>v.id===a.id))data.assets.push(a);},toast:(m,e)=>{if(e)window.errors.push(m)},renderInspector:()=>{}});window.ui.open();</script>`;
 const server=http.createServer(async(req,res)=>{try{const url=new URL(req.url,'http://local'),json=(v,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(v));};
  if(url.pathname==='/')return res.end(html);if(url.pathname==='/fixture')return json({project,assets});
  if(url.pathname.endsWith('/results'))return json({items:records});if(url.pathname.endsWith('/record'))return json(records.find(r=>r.id===url.searchParams.get('recordId')));
  if(url.pathname.endsWith('/reuse'))return json({changed:false,summary:{reused:0}});
  if(url.pathname.endsWith('/adopt')){const chunks=[];for await(const c of req)chunks.push(c);const input=JSON.parse(Buffer.concat(chunks));attempts.push(input);const record=records.find(r=>r.id===input.recordId),need=workspaceTarget(store,project,input).need;const asset={id:id('asset'),name:record.name+'.png',width:32,height:32,libraryRole:'scene',libraryName:record.name,libraryState:need.state,productionStatus:'confirmed',library:{assetId:randomUUID(),revisionId:randomUUID(),sha256:'a'.repeat(64),projectId:randomUUID()}};assets.push(asset);project=prepareWorkspaceBinding(store,project,input,asset,need);project.revision++;return json({project,asset});}
  if(url.pathname==='/api/project-center/reference-generation'){submissions++;return json({error:'禁止真实生成'},500);}
  if(url.pathname==='/pixel.png'||url.pathname.startsWith('/api/assets/')){res.writeHead(200,{'Content-Type':'image/png'});return res.end(png);}
  if(url.pathname.startsWith('/api/'))return json({items:[]});
  const full=path.resolve(publicRoot,'.'+url.pathname);assert.ok(full.startsWith(publicRoot+path.sep));if(!fs.existsSync(full)){res.writeHead(404);return res.end();}res.writeHead(200,{'Content-Type':full.endsWith('.css')?'text/css':'text/javascript'});res.end(fs.readFileSync(full));
 }catch(e){res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:e.message}));}});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close();});
 const {chromium}=createRequire(import.meta.url)('playwright');const browser=await chromium.launch({channel:'msedge',headless:true});t.after(()=>browser.close());const page=await browser.newPage({viewport:{width:1864,height:949}});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:'+server.address().port);
 const card=name=>page.locator('.asset-gallery-card').filter({has:page.locator('.asset-gallery-caption>strong',{hasText:name})});
 await page.waitForFunction(()=>[...document.querySelectorAll('[data-gallery-generate]')].filter(b=>b.textContent==='接回结果').length===2);
 for(const name of names.slice(0,2)){assert.equal(await card(name).locator('.asset-gallery-media img').count(),1);assert.equal(await card(name).locator('.asset-text-thumb').count(),0);}
 await card(names[0]).locator('[data-gallery-generate]').click();try{await page.locator('[data-asset-record-open]').first().waitFor({timeout:5000});}catch(e){console.error('DETAIL',errors,await page.evaluate(()=>window.errors),await page.locator('#asset-detail-panel').innerText());throw e;}await page.locator('[data-asset-close]').click();assert.equal(submissions,0);
 await page.locator('[data-asset-return-results]').click();await page.waitForFunction(()=>document.querySelector('[data-asset-search-status]').textContent.startsWith('接回完成'));
 assert.match(await page.locator('[data-asset-search-status]').textContent(),/已接回 1.*待确认 1.*跳过 1.*失败 0/);assert.equal(attempts.length,1);assert.equal(rowFor(names[0]).status,'ready');assert.equal(rowFor(names[1]).status,'text');assert.equal(rowFor(names[2]).status,'text');
 await card(names[1]).locator('[data-asset-key]').click();await page.locator('[data-asset-record-open]').first().waitFor();const chosen=records.find(r=>r.name===names[1]);await page.locator('[data-asset-record-open="'+chosen.id+'"]').first().click();await page.locator('[data-asset-action="adopt-result"]').click();await page.waitForFunction(()=>document.querySelector('#asset-detail-panel').hidden);
 assert.equal(rowFor(names[1]).status,'ready');assert.equal(attempts.length,2);for(const panel of project.pages[0].panels)for(const binding of Object.values(panel.referenceTextBindings||{}))assert.match(binding.description,/原始文字描述/);
 await page.reload();await page.locator('[data-asset-return-results]').waitFor();await page.locator('[data-asset-return-results]').click();await page.waitForFunction(()=>document.querySelector('[data-asset-search-status]').textContent.startsWith('接回完成'));assert.equal(attempts.length,2);assert.equal(submissions,0);assert.deepEqual(errors,[]);assert.deepEqual(await page.evaluate(()=>window.errors),[]);
 const proof=path.resolve('../evidence');fs.mkdirSync(proof,{recursive:true});await page.screenshot({path:path.join(proof,'scene-results-returned.png')});
});
