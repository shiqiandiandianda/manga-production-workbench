import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {createRequire} from 'node:module';
import {assetSourcePassages,novelSourceRanges,assetCardSourceMarkup} from '../public/asset-source-passages.js';
import {syntheticFiles} from './fixtures/production-synthetic.mjs';
import {inspectProductionPackage} from '../lib/production-package.mjs';
import {productionProject} from '../lib/production-package-document.mjs';

test('source passages resolve exact physical lines, prefer supplied quotations, and deduplicate repeated uses',()=>{
 const source={code:'E041-001',novelLocation:'第84章 第3—3行',description:'分镜描述',dialogue:'宋玄：分镜台词',source:{file:'甲方审核分镜.xlsx',row:2}},chapters=new Map([[84,'章名\n\n宋玄在书桌前提笔。\n另一个人的黑衣。']]);
 assert.deepEqual(novelSourceRanges(source),[{chapter:84,startLine:3,endLine:3}]);
 assert.deepEqual(novelSourceRanges({...source,sourceLocations:'{"id":"N84","startLine":3,"endLine":3}'}),[{chapter:84,startLine:3,endLine:3}]);
 const entries=assetSourcePassages([source,{...source,code:'E041-002'}],{chapters});assert.equal(entries.length,1);assert.equal(entries[0].kind,'novel');assert.equal(entries[0].quote,'宋玄在书桌前提笔。');assert.equal(entries[0].sources.length,2);assert.equal(entries[0].dialogue,'');
 assert.equal(assetSourcePassages([{...source,novelQuote:'原资料的直接摘录'}],{chapters})[0].quote,'原资料的直接摘录');
 assert.deepEqual(novelSourceRanges({...source,sourceLocations:[{id:'N85',startLine:7,endLine:9}]}),[{chapter:85,startLine:7,endLine:9}]);
});

test('missing or invalid novel ranges fall back to labeled storyboard text, never metadata, adaptation notes or prompts',()=>{
 const source={novelLocation:'第84章 第9—9行',description:'宋玄推开房门。',dialogue:'宋玄：进来。',adaptationNote:'编排意见',notes:'站位计划',source:{file:'甲方审核分镜.xlsx'}};
 const entry=assetSourcePassages([source],{chapters:new Map([[84,'只有一行']])})[0];assert.equal(entry.kind,'storyboard');assert.equal(entry.label,'甲方审核分镜');assert.equal(entry.quote,source.description);assert.equal(entry.dialogue,source.dialogue);
 assert.deepEqual(assetSourcePassages([{novelLocation:'第84章 第3行',notes:'编排',adaptationNote:'改编',productionPrompt:'生图提示词'}]),[]);
 const html=assetCardSourceMarkup({key:'"<x>',sources:[{...source,description:'<img src=x onerror="bad()">'}]});assert.ok(html.includes('&lt;img'));assert.ok(!html.includes('<img'));assert.ok(!html.includes('<p>第84章 第9—9行</p></details></section>'));
});

test('asset cards and source detail show readable novel or storyboard content; chapter reads are lazy, shared, safe and read-only',{timeout:60000},async t=>{
 const project=productionProject(await inspectProductionPackage(syntheticFiles())),episode=project.productionPackage.episodes[0];
 const first=episode.panelRecords[0],second=episode.panelRecords[1];for(const r of [first,second])Object.assign(r.original,{'出现角色':['测试人物'],'原著位置':'第84章 第3—3行','画面内容':'测试人物在书案旁核对折子。','台词':'测试人物：这份折子已经写好了。'});
 first.production.sourceLocations=[{id:'N84',startLine:3,endLine:3}];second.production.sourceLocations=[{id:'N84',startLine:3,endLine:3}];
 const segment=episode.segments[0];segment.references.push({slot:20,'类型':'设定卡','人物':'测试人物','服装':'白衣','必须':true});episode.panelRecords.push({...structuredClone(first),id:'E011-white',source:{file:'甲方审核分镜.xlsx',row:5},original:{...first.original,'原著位置':'第85章 第3—3行','服装':{'测试人物':'白衣'},'画面内容':'测试人物披上白衣，站在窗边。'},production:{...first.production,sourceLocations:[{id:'N85',startLine:3,endLine:3}]}});
 const sourceBefore=JSON.stringify(project),quote='晨光透过窗棂，测试人物一身黑衣，在案前提笔。<img src=x onerror="window.injected=true">',chapter='第84章\n\n'+quote+'\n另一个人的白衣。';
 const require=createRequire(import.meta.url),{chromium}=require(process.env.COMIC_TEST_PLAYWRIGHT_MODULE||'playwright'),publicRoot=path.resolve(import.meta.dirname,'../public'),proof=fs.mkdtempSync(path.join(process.env.QUALITY_EVIDENCE_DIR||os.tmpdir(),'source-passages-')),errors=[];let chapterReads=0,writes=0;
 const html=`<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/asset-workspace.css"><style>body{margin:0;background:#111c27;color:#e1edf7;font:14px sans-serif}.app-shell{position:relative;height:100vh}button,input,select{padding:8px}</style><div class="app-shell"><section id="references-tab"></section><span id="inspector-kind"></span><span id="inspector-title"></span><section id="inspector-body"></section></div><script type="module">import{mountAssetWorkspace}from'/asset-workspace-ui.js';const p=await(await fetch('/fixture')).json();window.ui=mountAssetWorkspace({api:async url=>(await fetch(url)).json(),getProject:()=>p,getPage:()=>p.pages[0],getSelected:()=>p.pages[0].panels[0],getAssets:()=>[],flushSave:async()=>{},accept(){},onAssets(){},toast(){},renderInspector(){}});window.ui.open();</script>`;
 const server=http.createServer((req,res)=>{const u=new URL(req.url,'http://fixture');if(req.method!=='GET')writes++;if(u.pathname==='/')return res.end(html);if(u.pathname==='/fixture'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify(project));}if(u.pathname.endsWith('/novel-source')){chapterReads++;res.setHeader('Content-Type','text/plain; charset=utf-8');if(u.searchParams.get('chapter')==='85'){res.writeHead(404);return res.end('本章未提供');}return setTimeout(()=>res.end(chapter),80);}if(u.pathname.startsWith('/api/')){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({items:[],more:false,changed:false}));}const file=path.resolve(publicRoot,'.'+u.pathname);if(!file.startsWith(publicRoot+path.sep)||!fs.existsSync(file)){res.writeHead(404);return res.end();}res.setHeader('Content-Type',file.endsWith('.css')?'text/css':'text/javascript');res.end(fs.readFileSync(file));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close();});const browser=await chromium.launch({channel:'msedge',headless:true});t.after(()=>browser.close());const page=await browser.newPage({viewport:{width:1440,height:1000}}),origin='http://127.0.0.1:'+server.address().port;page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());
 await page.goto(origin);const card=page.locator('[data-asset-source-card]').first();await card.waitFor();assert.equal(chapterReads,0);await card.locator(':scope > summary').click();await page.waitForFunction(()=>document.querySelector('.asset-card-sources [data-source-kind="novel"]'));assert.equal(chapterReads,1);assert.ok((await card.innerText()).includes(quote));assert.equal(await card.locator('[data-source-kind="novel"]').count(),1);assert.equal(await card.locator('.asset-source-passage img').count(),0);assert.equal(await page.evaluate(()=>window.injected),undefined);
 assert.equal(await card.locator('.asset-source-location').evaluate(n=>n.open),false);assert.ok(!(await card.innerText()).includes('第84章 第3—3行'));await card.locator(':scope > summary').click();await card.locator(':scope > summary').click();assert.equal(chapterReads,1);await page.screenshot({path:path.join(proof,'asset-card-source.png')});
 const white=page.locator('[data-identity-state]').filter({hasText:'白衣'}).locator('[data-asset-source-card]');await white.locator(':scope > summary').click();await page.waitForResponse(r=>r.status()===404&&r.url().includes('chapter=85'));assert.ok((await white.innerText()).includes('测试人物披上白衣，站在窗边。'));assert.ok((await white.innerText()).includes('甲方审核分镜'));assert.ok(!(await card.innerText()).includes('披上白衣'));assert.equal(chapterReads,2);
 await page.locator('[data-gallery-evidence]').first().click();await page.waitForFunction(()=>document.querySelector('#asset-detail-panel [data-source-kind="novel"]'));assert.ok((await page.locator('#asset-detail-panel [data-asset-source-passages]').innerText()).includes(quote));assert.equal(chapterReads,2);await page.screenshot({path:path.join(proof,'asset-detail-source.png')});assert.equal(writes,0);assert.equal(JSON.stringify(project),sourceBefore);assert.deepEqual(errors,[]);
});
