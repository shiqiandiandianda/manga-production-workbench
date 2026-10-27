import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import http from 'node:http';import {createRequire} from 'node:module';

test('批量选择跨页保留，取消不写入，提交失败使用同一预览重试',{timeout:60000},async t=>{
 const {chromium}=createRequire(import.meta.url)(path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules','playwright'));
 const source=fs.readFileSync(path.resolve(import.meta.dirname,'../../public/library-bulk-ui.js'));
 const html=`<!doctype html><meta charset="utf-8"><section id="fixture"><div id="library-summary"></div><div id="cards"></div></section><script type="module">
 import {mountLibraryBulkUI} from '/bulk.js';const section=document.querySelector('#fixture');let scope='project-one',attempt=0;window.calls=[];
 const items=[{id:'one',name:'角色一',objectVersion:1,assetKind:'image',assetType:'character',scopeId:'project'},{id:'two',name:'场景二',objectVersion:2,assetKind:'image',assetType:'scene',scopeId:'episode-2'}];
 const api=async(path,method,input)=>{window.calls.push({path,input});if(path.includes('/pending?'))return {items:[]};if(path.endsWith('/preview'))return {id:'plan-one',action:input.action,total:input.items.length,items:input.items.map(i=>({...i,name:items.find(x=>x.id===i.id).name}))};if(path.endsWith('/commit')){if(++attempt===1)throw Error('模拟网络中断');return {changedCount:2};}throw Error('unexpected');};
 const bulk=mountLibraryBulkUI({section,api,toast:m=>window.lastToast=m,getScope:()=>scope,onTrashChange:()=>{},onComplete:async()=>{}});bulk.setAccount('maker-one');
 window.show=i=>{section.__libraryItems=[items[i]];document.querySelector('#cards').innerHTML='<article data-library-asset="'+items[i].id+'"></article>';bulk.render([items[i]]);};window.changeScope=v=>{scope=v;bulk.setScope(v);};window.show(0);
 </script>`;
 const server=http.createServer((req,res)=>{if(req.url==='/bulk.js'){res.writeHead(200,{'Content-Type':'text/javascript'});res.end(source);}else{res.writeHead(200,{'Content-Type':'text/html'});res.end(html);}});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close();});
 const browser=await chromium.launch({channel:'msedge',headless:true});t.after(()=>browser.close());const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:'+server.address().port);
 await page.locator('[data-library-select=one]').check();await page.evaluate(()=>window.show(1));await page.locator('[data-library-select=two]').check();assert.match(await page.locator('[data-library-selection]').innerText(),/2 项/);
 await page.locator('[data-library-bulk]').click();await page.getByRole('dialog').getByText('角色一',{exact:false}).waitFor();await page.getByRole('button',{name:'取消',exact:true}).click();assert.equal(await page.evaluate(()=>window.calls.filter(x=>x.path.endsWith('/commit')).length),0);
 await page.locator('[data-library-bulk]').click();await page.getByRole('button',{name:'确认回收',exact:true}).click();await page.getByText(/模拟网络中断/).waitFor();await page.getByRole('button',{name:'确认回收',exact:true}).click();await page.waitForFunction(()=>window.lastToast==='已回收 2 项');const calls=await page.evaluate(()=>window.calls.filter(x=>x.path.endsWith('/commit')));assert.equal(calls.length,2);assert.equal(calls[0].input.planId,calls[1].input.planId);assert.match(await page.locator('[data-library-selection]').innerText(),/0 项/);
 await page.locator('[data-library-select=two]').check();await page.evaluate(()=>window.changeScope('project-two'));assert.match(await page.locator('[data-library-selection]').innerText(),/0 项/);assert.deepEqual(errors,[]);
});

test('刷新后找回未确认批次，核对后沿用原批次重试',{timeout:60000},async t=>{
 const {chromium}=createRequire(import.meta.url)(path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules','playwright'));
 const source=fs.readFileSync(path.resolve(import.meta.dirname,'../../public/library-bulk-ui.js'));
 const html=`<!doctype html><meta charset="utf-8"><section id="fixture"><div id="library-summary"></div><article data-library-asset="one"></article></section><script type="module">
 import {mountLibraryBulkUI} from '/bulk.js';const section=document.querySelector('#fixture'),items=[{id:'one',name:'待核对角色',objectVersion:1,assetKind:'image',assetType:'character',scopeId:'project'}];
 const api=async(path,method='GET',input)=>{const r=await fetch(path,{method,headers:input?{'Content-Type':'application/json'}:{},body:input?JSON.stringify(input):undefined});const value=await r.json();if(!r.ok)throw Error(value.error);return value;};
 const bulk=mountLibraryBulkUI({section,api,toast:m=>window.lastToast=m,getScope:()=> 'project-one',onTrashChange:()=>{},onComplete:async()=>{}});
 section.__libraryItems=items;bulk.setAccount('maker-one');bulk.render(items);
 </script>`;
 let pending=false,attempt=0;const requests=[],plan={id:'plan-persisted',action:'recycle',createdAt:'2026-10-27T00:00:00.000Z',total:1,items:[{id:'one',name:'待核对角色',assetType:'character',scopeId:'project'}]};
 const server=http.createServer((req,res)=>{
  if(req.url==='/bulk.js'){res.writeHead(200,{'Content-Type':'text/javascript'});return res.end(source);}
  if(req.url.startsWith('/api/library/recycle/')){let raw='';req.on('data',chunk=>raw+=chunk);req.on('end',()=>{const input=raw?JSON.parse(raw):null;requests.push({url:req.url,input});res.setHeader('Content-Type','application/json');if(req.url.includes('/pending?'))return res.end(JSON.stringify({items:pending?[plan]:[]}));if(req.url.endsWith('/preview'))return res.end(JSON.stringify(plan));if(req.url.endsWith('/commit')){if(++attempt===1){pending=true;res.statusCode=503;return res.end(JSON.stringify({error:'模拟回执丢失'}));}pending=false;return res.end(JSON.stringify({changedCount:1}));}res.statusCode=404;res.end('{}');});return;}
  res.writeHead(200,{'Content-Type':'text/html'});res.end(html);
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close();});
 const browser=await chromium.launch({channel:'msedge',headless:true});t.after(()=>browser.close());const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:'+server.address().port);
 await page.locator('[data-library-select=one]').check();await page.locator('[data-library-bulk]').click();await page.getByRole('button',{name:'确认回收'}).click();await page.getByText(/模拟回执丢失/).waitFor();
 await page.reload();await page.locator('[data-library-pending]:visible').click();await page.getByRole('button',{name:/回收 1 项/}).click();assert.match(await page.getByRole('dialog').innerText(),/结果尚未确认/);await page.getByRole('button',{name:'确认回收'}).click();await page.waitForFunction(()=>window.lastToast==='已回收 1 项');
 assert.deepEqual(requests.filter(r=>r.url.endsWith('/commit')).map(r=>r.input.planId),['plan-persisted','plan-persisted']);assert.deepEqual(errors,[]);
});
