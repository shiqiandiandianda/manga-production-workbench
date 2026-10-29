import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {createStudio} from '../server.mjs';
import {listenForFetch} from './fixtures/loopback-http.mjs';
import {syntheticFiles} from './fixtures/production-synthetic.mjs';
import {mockMoku} from './moku-project-library-fixture.mjs';
import {assetWorkspaceInventory} from '../public/asset-workspace-model.js';
import {workspaceUploadTags} from '../lib/asset-workspace-upload.mjs';
const require=createRequire(import.meta.url),{createCanvas}=require(process.env.COMIC_TEST_CANVAS_MODULE),{chromium}=require('playwright');
const evidence=path.resolve('../verification/compact-asset-upload');fs.mkdirSync(evidence,{recursive:true});
process.env.COMIC_TEAM_CHANNEL_FILE=path.join(evidence,'isolated-channel.json');

async function fixture(t){
 const dir=fs.mkdtempSync(path.join(evidence,'fixture-')),m=mockMoku(),userId=randomUUID();let failImport=false,holdComplete=null;
 const remote=http.createServer(async(req,res)=>{try{
  const u=new URL(req.url,'http://local'),chunks=[];for await(const c of req)chunks.push(c);const bytes=Buffer.concat(chunks);
  let result;
  if(holdComplete&&u.pathname.endsWith('/complete')){const hold=holdComplete;holdComplete=null;hold.arrived();await hold.wait;}
  if(u.pathname==='/api/auth/me')result=Response.json({user:{id:userId,name:'合成上传验收'}});
  else if(u.pathname==='/api/projects')result=Response.json({items:[{id:m.projectId,name:'合成制作资料'}]});
  else if(u.pathname.includes('/production-records'))result=Response.json({items:[]});
  else if(u.pathname.endsWith('/catalog')){const rows=[...m.assets.values()].filter(a=>(!u.searchParams.get('assetType')||a.assetType===u.searchParams.get('assetType'))&&a.name.includes(u.searchParams.get('q')||''));result=Response.json({items:rows,total:rows.length});}
  else if(/\/revisions\/[^/]+\/(download|preview\/)/.test(u.pathname)){
   if(failImport){failImport=false;result=Response.json({error:'模拟下载暂时失败'},{status:503});}
   else{const id=u.pathname.split('/revisions/')[1].split('/')[0],a=[...m.assets.values()].find(a=>a.recommendedRevisionId===id);result=new Response(a.bytes,{headers:{'content-type':a.mime}});}
  }else result=await m.request(req.url,{method:req.method,headers:{'Idempotency-Key':req.headers['idempotency-key'],'X-Chunk-SHA256':req.headers['x-chunk-sha256']},...(bytes.length?{body:req.headers['content-type']?.includes('application/json')?bytes.toString():bytes}:{})});
  res.writeHead(result.status,Object.fromEntries(result.headers));res.end(Buffer.from(await result.arrayBuffer()));
 }catch(e){res.writeHead(500,{'content-type':'application/json'});res.end(JSON.stringify({error:e.message}));}});
 const remoteOrigin=await listenForFetch(remote);t.after(()=>{remote.closeAllConnections();remote.close();});
 process.env.COMIC_PROJECT_SYNC='0';process.env.COMIC_SLOT_DIR=path.join(dir,'slots');process.env.COMIC_LIBRARY_CONFIG=path.join(dir,'moku.json');
 fs.writeFileSync(process.env.COMIC_LIBRARY_CONFIG,JSON.stringify({base:remoteOrigin}));
 const studio=createStudio({dataDir:path.join(dir,'comic'),seedReference:false,bridge:{close(){},status:async()=>({connected:false})},jimengBridge:{close(){}}});
 const origin=await listenForFetch(studio.server);t.after(()=>{studio.close();studio.server.closeAllConnections();});
 const request=async(route,input)=>{const response=await fetch(origin+route,{method:input?'POST':'GET',headers:{'content-type':'application/json'},body:input?JSON.stringify(input):undefined});return {status:response.status,value:await response.json()};};
 const api=async(...args)=>{const r=await request(...args);assert.ok(r.status<400,JSON.stringify(r));return r.value;};
 const scan=await api('/api/production-packages/scan',{files:syntheticFiles().map(f=>({relativePath:f.relativePath,dataBase64:f.bytes.toString('base64')}))}),project=await api('/api/production-packages/import',{scanId:scan.scanId});
 const current=()=>studio.store.project(project.id),row=()=>assetWorkspaceInventory(current(),studio.store.db.assets,{scope:'work'}).find(r=>r.role==='scene');
 const canvas=createCanvas(800,450),ctx=canvas.getContext('2d');ctx.fillStyle='#234f69';ctx.fillRect(0,0,800,450);ctx.fillStyle='#c5ac7b';ctx.fillRect(80,150,640,240);ctx.fillStyle='#213f40';ctx.fillRect(280,210,240,180);const png=canvas.toBuffer('image/png');
 const input=()=>({...row().uses[0],expectedRevision:current().revision}),route='/api/projects/'+project.id+'/asset-workspace/';
 return {m,dir,studio,origin,api,request,current,row,png,input,route,failImport(){failImport=true;},pauseComplete(){let arrived,release;const ready=new Promise(r=>arrived=r),wait=new Promise(r=>release=r);holdComplete={arrived,wait};return {ready,release};}};
}

test('上传自动分类打标签、固定版本回读，重试沿用同一墨库回执且不改变画格用图',async t=>{
 const f=await fixture(t),context=await f.api(f.route+'upload-context',f.input());
 assert.equal(context.projectId,f.m.projectId);assert.deepEqual(context.tags,['测试庭院','场景','本地上传']);
 const input={...f.input(),sessionVersion:context.sessionVersion,mokuProjectId:context.projectId,fileName:'庭院原图.png',dataBase64:f.png.toString('base64')},before=structuredClone(f.current());
 f.failImport();const failed=await f.request(f.route+'upload',input);assert.equal(failed.status,503);assert.equal(f.m.uploads.size,1);
 const result=await f.api(f.route+'upload',input);assert.equal(f.m.uploads.size,1);assert.equal(result.asset.library.assetType,'scene');assert.deepEqual(result.asset.library.tags,context.tags);assert.ok(result.asset.library.revisionId);assert.equal(result.asset.assetWorkspaceUpload.projectId,before.id);assert.deepEqual(f.current(),before);assert.equal(f.row().assetIds.length,0);
 const retry=await f.api(f.route+'upload',input);assert.equal(retry.asset.id,result.asset.id);assert.equal(f.m.uploads.size,1);
 const uploads=[...f.m.uploads.values()];assert.equal(uploads[0].tagDecision,'provided');assert.ok(uploads[0].sceneIds.includes(uploads[0].objectId));
 assert.deepEqual(workspaceUploadTags({role:'character',name:'测试人物',state:'黑衣'}),['测试人物','人物','黑衣','本地上传']);
 assert.deepEqual(workspaceUploadTags({role:'prop',name:'茶杯',state:''}),['茶杯','道具','本地上传']);
 const character=assetWorkspaceInventory(f.current(),f.studio.store.db.assets,{scope:'work'}).find(r=>r.role==='character');
 const characterInput={...character.uses[0],expectedRevision:f.current().revision},ci=await f.api(f.route+'upload-context',characterInput);
 const cr=await f.api(f.route+'upload',{...input,...characterInput,dataBase64:f.png.toString('base64'),fileName:'人物.png',sessionVersion:ci.sessionVersion});
 assert.equal(cr.asset.library.assetType,'character');assert.ok(cr.tags.includes('黑衣'));assert.equal(cr.asset.libraryState,'黑衣');
});

test('上传拒绝错误账号、作品、过期工程和伪图片；归属不明确时不代选',async t=>{
 const f=await fixture(t),context=await f.api(f.route+'upload-context',f.input()),input={...f.input(),sessionVersion:context.sessionVersion,mokuProjectId:context.projectId,fileName:'庭院.png',dataBase64:f.png.toString('base64')};
 for(const change of [{sessionVersion:-1},{mokuProjectId:randomUUID()},{expectedRevision:-1},{dataBase64:Buffer.from('not an image').toString('base64')}]){const result=await f.request(f.route+'upload',{...input,...change});assert.ok(result.status>=400,JSON.stringify(result));}
 assert.equal(f.m.uploads.size,0);f.current().title='未关联的测试作品';
 const unknown=await f.api(f.route+'upload-context',f.input());assert.equal(unknown.projectId,'');assert.equal(unknown.projects.length,1);
});

test('紧凑选图页面：本地选文件自动入库、候选立即可选、刷新保留，窄屏不溢出',{timeout:90000},async t=>{
 const f=await fixture(t),browser=await chromium.launch({channel:'msedge',headless:true});t.after(()=>browser.close());const page=await browser.newPage({viewport:{width:1864,height:949}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 const open=async()=>{await page.locator('[data-rail-tab=references]').click();await page.locator('.asset-gallery-card').filter({has:page.locator('.asset-gallery-caption>strong',{hasText:'测试庭院'})}).locator('[data-gallery-choose]').click();await page.locator('[data-asset-upload]').waitFor();};
 await page.goto(f.origin+'/?project='+f.current().id);await page.waitForSelector('#canvas-tool-dock');await open();
 await page.locator('[data-asset-upload]').click();await page.locator('[data-upload-project]').waitFor();assert.equal(await page.locator('[data-upload-project]').inputValue(),f.m.projectId);
 await page.screenshot({path:path.join(evidence,'upload-dialog.png')});
 await page.locator('[data-asset-upload-input]').setInputFiles([{name:'庭院A.png',mimeType:'image/png',buffer:f.png},{name:'庭院B.png',mimeType:'image/png',buffer:f.png}]);
 await page.waitForFunction(()=>!document.querySelector('.asset-upload-dialog'));await page.locator('[data-asset-use-local]').first().waitFor();assert.equal(await page.locator('[data-asset-use-local]').count(),2);assert.equal(f.m.uploads.size,2);assert.equal(f.row().assetIds.length,0);
 for(const width of [1864,1180,390]){await page.setViewportSize({width,height:949});const box=await page.locator('#asset-detail-panel').evaluate(el=>({width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height,overflow:el.scrollWidth>el.clientWidth+1,contentOverflow:el.querySelector('[data-asset-content]').scrollWidth>el.querySelector('[data-asset-content]').clientWidth+1}));assert.equal(box.overflow,false,JSON.stringify(box));assert.equal(box.contentOverflow,false,JSON.stringify(box));if(width===1864){assert.ok(box.width<=1181&&box.height<800,JSON.stringify(box));}await page.screenshot({path:path.join(evidence,'picker-'+width+'.png')});}
 await page.setViewportSize({width:1864,height:949});await page.reload();await page.waitForSelector('#canvas-tool-dock');await open();await page.locator('[data-asset-use-local]').first().waitFor();await page.locator('[data-asset-use-local]').first().click();await page.waitForFunction(()=>document.querySelector('#asset-detail-panel')?.hidden);assert.equal(f.row().assetIds.length,1);assert.equal(f.studio.store.db.jobs.length,0);assert.deepEqual(errors,[]);
 fs.writeFileSync(path.join(evidence,'acceptance.json'),JSON.stringify({ok:true,realMokuWrite:false,realAI:false,uploaded:2,automaticTags:true,fixedRevision:true,persisted:true,directAdoption:true,widths:[1864,1180,390],errors},null,2));
});


test('上传途中切换账号，旧操作停止回读和本地登记',async t=>{
 const f=await fixture(t),context=await f.api(f.route+'upload-context',f.input()),hold=f.pauseComplete();
 const pending=f.request(f.route+'upload',{...f.input(),sessionVersion:context.sessionVersion,mokuProjectId:context.projectId,fileName:'切换期间.png',dataBase64:f.png.toString('base64')});
 await hold.ready;await f.api('/api/library/logout',{});hold.release();
 const result=await pending;assert.equal(result.status,409);assert.match(JSON.stringify(result.value),/账号已切换/);assert.equal(f.studio.store.db.assets.filter(a=>a.assetWorkspaceUpload).length,0);
});
