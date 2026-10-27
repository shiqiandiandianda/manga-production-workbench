import os from 'node:os';
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import http from 'node:http';import {createRequire}from'node:module';import {randomUUID}from'node:crypto';
import {galleryReturnDecision}from'../public/asset-gallery-batch.js';
import {referenceRecordMatch}from'../lib/reference-generation-results.mjs';
import {syntheticFiles}from'./fixtures/production-synthetic.mjs';import {inspectProductionPackage}from'../lib/production-package.mjs';import {productionProject}from'../lib/production-package-document.mjs';import {ensureProjectPanelGeneration}from'../public/panel-generation.js';import {assetWorkspaceInventory}from'../public/asset-workspace-model.js';import {prepareWorkspaceBinding,workspaceTarget}from'../lib/asset-workspace-api.mjs';
const projectId='project-'+randomUUID(),use={panelId:'panel-a',needId:'need-a',missing:true},row={name:'测试人物',role:'character',state:'白衣',uses:[use]},record={id:'production-'+randomUUID(),name:row.name,role:row.role,state:row.state,status:'completed',partial:false,available:true,imageUrl:'/result.png',context:{projectId}};
test('批量接回保护身份、版本、完整性和既有采用；仅填补可编辑的缺图位置',()=>{
 assert.equal(galleryReturnDecision(row,[record],{projectId}).status,'ready');
 for(const extra of[{partial:true},{status:'failed'},{matchNote:'服装待核对'},{state:'黑衣'},{name:'另一人物'},{context:{projectId:'other'}}])assert.notEqual(galleryReturnDecision(row,[{...record,...extra}],{projectId}).status,'ready');
 assert.equal(galleryReturnDecision(row,[record,{...record,id:'another'}],{projectId}).status,'review');
 assert.equal(galleryReturnDecision(row,[record,{...record,id:'running',status:'running',available:false}],{projectId}).status,'skip');
 for(const extra of[{missing:false},{locked:true},{skipped:true},{text:true}])assert.equal(galleryReturnDecision({...row,uses:[{...use,...extra}]},[record],{projectId}).status,'skip');
 assert.deepEqual(galleryReturnDecision({...row,uses:[use,{...use,panelId:'already',missing:false}]},[record],{projectId}).targets,[{panelId:use.panelId,needId:use.needId}]);
 assert.notEqual(galleryReturnDecision({...row,state:'未指定'},[record],{projectId}).status,'ready');
});

test('主库映射占位说明允许唯一、完整、由本需求生成的记录接回，仍保护真正未知服装及其他来源',()=>{
 const state='待与项目主库对应，未绑定实际图片或固定版本；本批没有生成资产图。',pending={...row,state},generated={...record,state:'未指定（原创候选，待确认）',source:{projectId,panelId:use.panelId,needId:use.needId}};
 assert.equal(galleryReturnDecision(pending,[generated],{projectId}).status,'ready');
 for(const extra of [{source:undefined},{source:{...generated.source,projectId:'other'}},{source:{...generated.source,needId:'other'}},{status:'failed',partial:true},{matchNote:'服装待核对'}])assert.notEqual(galleryReturnDecision(pending,[{...generated,...extra}],{projectId}).status,'ready');
 assert.equal(galleryReturnDecision(pending,[generated,{...generated,id:'other'}],{projectId}).status,'review');assert.notEqual(galleryReturnDecision({...pending,state:'服装待确认'},[generated],{projectId}).status,'ready');
 const raw={...generated,type:'character',outfit:state},context={project:{id:projectId},panel:{id:use.panelId},need:pending};assert.equal(referenceRecordMatch(raw,context).matchNote,'');assert.match(referenceRecordMatch(raw,{...context,need:{...pending,state:'服装待确认'}}).matchNote,/核对/);
});
test('浏览器一键接回按筛选范围串行采用，单项失败继续，多版本及部分图待确认，重复点击不覆盖',{timeout:60000},async t=>{
 const names=['正常甲','正常乙','失败项','多版本项','部分项','进行中项','已有项','无结果项'],files=syntheticFiles(),board=JSON.parse(files[0].bytes),screen=JSON.parse(files[1].bytes);
 for(const p of board['格']){p['当前场景']='';p['出现角色']=names;p['服装']=Object.fromEntries(names.map(n=>[n,'白衣']));p['台词']=[];}
 for(const s of screen['屏段'])s['附图']=names.map(n=>({'类型':'设定卡','人物':n,'服装':'白衣','必须':true}));screen['文字']=[];
 files[0].bytes=Buffer.from(JSON.stringify(board));files[1].bytes=Buffer.from(JSON.stringify(screen));
 let project=productionProject(await inspectProductionPackage(files));const assets=[],attempts=[];ensureProjectPanelGeneration(project,assets);
 const store={db:{assets,jobs:[]},asset:id=>assets.find(a=>a.id===id)},inventory=()=>assetWorkspaceInventory(project,assets,{scope:'work'}),rowFor=name=>inventory().find(r=>r.name===name);
 function makeAsset(name){const a={id:'asset_'+randomUUID(),name:name+'_白衣.png',width:32,height:48,libraryRole:'character',libraryName:name,libraryState:'白衣',productionStatus:'confirmed',library:{assetId:randomUUID(),revisionId:randomUUID(),sha256:'a'.repeat(64),projectId:randomUUID()}};assets.push(a);return a;}
 const existing=makeAsset('已有项'),oldUse=rowFor('已有项').uses[0];project=prepareWorkspaceBinding(store,project,{expectedRevision:project.revision,targets:[oldUse]},existing);
 const ids=Object.fromEntries(names.map(n=>[n,'production_'+randomUUID()]));let submissions=0;
 const records=()=>names.filter(n=>n!=='无结果项').flatMap(name=>{const r=rowFor(name),use=r.uses[0],v={id:ids[name],name,role:'character',state:'白衣',status:name==='部分项'?'failed':name==='进行中项'?'running':'completed',partial:name==='部分项'||name==='进行中项',available:name!=='进行中项',imageUrl:'/pixel.png',context:{projectId:project.id,panelId:use.panelId,needId:use.needId}};return name==='多版本项'?[v,{...v,id:ids[name]+'-v2'}]:[v];});
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aHHsAAAAASUVORK5CYII=','base64'),publicRoot=path.resolve('public');
 const html=`<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/asset-workspace.css"><style>body{margin:0;font:14px Microsoft YaHei;background:#111c27}.app-shell{position:relative;height:100vh}button,input,select{font:inherit;padding:8px;background:#213a4e;color:#deebf7;border:1px solid #56768b;border-radius:5px}button:disabled{opacity:.5}</style><div class="app-shell"><section id="references-tab"></section><section id="inspector-body"></section></div><script type="module">import{mountAssetWorkspace}from'/asset-workspace-ui.js';let data=await(await fetch('/fixture')).json();window.errors=[];const api=async(url,method='GET',body)=>{const r=await fetch(url,{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined}),v=await r.json();if(!r.ok)throw Error(v.error);return v;};window.ui=mountAssetWorkspace({api,getProject:()=>data.project,getPage:()=>data.project.pages[0],getSelected:()=>data.project.pages[0].panels.find(p=>p.productionSegment),getAssets:()=>data.assets,flushSave:async()=>{},accept:async p=>{data.project=p;window.ui.refresh(true);},onAssets:items=>{for(const a of items)if(!data.assets.some(v=>v.id===a.id))data.assets.push(a);},toast:(m,e)=>{if(e)window.errors.push(m)},renderInspector:()=>{},onChooseEpisode:()=>{}});window.ui.open();</script>`;
 const server=http.createServer(async(req,res)=>{try{
  const url=new URL(req.url,'http://local'),json=(v,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(v));};
  if(url.pathname==='/')return res.end(html);if(url.pathname==='/fixture')return json({project,assets});if(url.pathname.endsWith('/results'))return json({items:records()});
  if(url.pathname.endsWith('/adopt')){const chunks=[];for await(const c of req)chunks.push(c);const input=JSON.parse(Buffer.concat(chunks));attempts.push(input);const name=names.find(n=>ids[n]===input.recordId);if(name==='失败项')return json({error:'合成接回失败'},409);const currentNeed=workspaceTarget(store,project,input).need,a=makeAsset(name);project=prepareWorkspaceBinding(store,project,input,a,currentNeed);project.revision++;return json({asset:a,project});}
  if(url.pathname==='/api/project-center/reference-generation'){submissions++;return json({error:'不能提交生成'},500);}
  if(url.pathname==='/pixel.png'||url.pathname.startsWith('/api/assets/')){res.writeHead(200,{'Content-Type':'image/png'});return res.end(png);}
  const full=path.resolve(publicRoot,'.'+url.pathname);assert.ok(full.startsWith(publicRoot+path.sep));if(!fs.existsSync(full)){res.writeHead(404);return res.end();}const bytes=fs.readFileSync(full);res.writeHead(200,{'Content-Type':full.endsWith('.css')?'text/css':'text/javascript'});res.end(bytes);
 }catch(e){res.writeHead(500);res.end(e.message);}});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close();});
 const require=createRequire(import.meta.url),{chromium}=require((process.env.COMIC_TEST_PLAYWRIGHT_MODULE||path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')));const browser=await chromium.launch({channel:'msedge',headless:true});t.after(()=>browser.close());const page=await browser.newPage({viewport:{width:1864,height:949}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:'+server.address().port);
 await page.locator('[data-asset-return-results]').waitFor();await page.waitForFunction(()=>document.querySelector('.asset-gallery-card')?.textContent.includes('待接回'));
 await page.locator('[data-asset-return-results]').evaluate(b=>{b.click();b.click();});await page.waitForFunction(()=>document.querySelector('[data-asset-search-status]').textContent.startsWith('接回完成'));
 assert.equal(attempts.length,3);assert.equal(submissions,0);assert.match(await page.locator('[data-asset-search-status]').textContent(),/已接回 2.*待确认 2.*失败 1/);
 assert.equal(rowFor('正常甲').uses.every(u=>!u.missing),true);assert.equal(rowFor('正常乙').uses.every(u=>!u.missing),true);assert.equal(attempts.some(v=>v.recordId===ids['已有项']),false);assert.equal(rowFor('已有项').uses.every(u=>!u.missing),true);assert.ok(rowFor('已有项').assetIds.includes(existing.id));
 const completedAttempts=attempts.filter(v=>v.recordId!==ids['失败项']).length;await page.locator('[data-asset-return-results]').click();await page.waitForFunction(()=>document.querySelector('[data-asset-search-status]').textContent.startsWith('接回完成'));assert.equal(attempts.filter(v=>v.recordId!==ids['失败项']).length,completedAttempts);
 await page.locator('[data-asset-query]').fill('多版本项');await page.locator('[data-asset-return-results]').click();await page.waitForFunction(()=>document.querySelector('[data-asset-search-status]').textContent.startsWith('接回完成'));assert.match(await page.locator('[data-asset-search-status]').textContent(),/已接回 0.*待确认 1.*失败 0/);
 await page.locator('[data-asset-query]').fill('');const evidence=path.resolve('../verification/gallery-return-20261024');fs.mkdirSync(evidence,{recursive:true});await page.screenshot({path:evidence+'/one-click-return.png'});
 for(const width of[1180,760]){await page.setViewportSize({width,height:949});assert.ok(await page.locator('#asset-gallery-workspace').evaluate(n=>n.scrollWidth<=n.clientWidth+1));assert.equal(await page.locator('[data-asset-return-results]').isVisible(),true);}
 assert.deepEqual(errors,[]);assert.deepEqual(await page.evaluate(()=>window.errors),[]);
});
