import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {createRemoteLibrary} from '../lib/remote-library.mjs';
import {createBubbleStyleLibrary} from '../lib/bubble-style-library.mjs';
import {createStudio} from '../server.mjs';
import {createProject} from '../public/model.js';
const source=process.env.MOKU_TEST_SOURCE||'file:///C:/Users/EDY/Documents/Codex/2026-10-23/new-chat/outputs/moku-extensionless-images/';
const {projectFixture}=await import(source+'tests/project-assets-fixture.mjs');
const {runOne}=await import(source+'server/tasks.mjs');
const {id,passwordHash}=await import(source+'server/core.mjs');
const sharp=createRequire(source+'package.json')('sharp');
const hash=b=>createHash('sha256').update(b).digest('hex');

test('editable bubble and nameplate publish through real HTTP, cold retrieval, retry, immutable updates',async()=>{
 const probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
 const dir=fs.mkdtempSync(path.resolve('../audit-data/editable-styles-')),f=await projectFixture({fixtureRoot:path.join(dir,'db'),port});
 await f.app.listen({host:'127.0.0.1',port});const base='http://127.0.0.1:'+port;
 const config=path.join(dir,'synthetic-session.json');fs.writeFileSync(config,JSON.stringify({base,cookie:f.cookie}));
 let workerError,studio,browser;const worker=setInterval(()=>runOne(f.db,f.c,()=>{throw Error('Backup prohibited');}).catch(e=>workerError=e),30);
 const file=path.join(dir,'bubble.png'),svg=path.join(dir,'source.svg');fs.writeFileSync(file,await sharp({create:{width:64,height:64,channels:4,background:'#ffffff'}}).png().toBuffer());fs.writeFileSync(svg,'<svg xmlns="http://www.w3.org/2000/svg"><circle cx="32" cy="32" r="30"/></svg>');
 const contour=[{x:0,y:0},{x:.5,y:0},{x:1,y:0},{x:1,y:.5},{x:1,y:1},{x:.5,y:1},{x:0,y:1},{x:0,y:.5}];
 const styles=[{id:'test-speech',label:'可编辑对白',kind:'bubble',contour,insets:{left:.1,right:.1,top:.1,bottom:.1},tailPreset:{visible:true,side:'bottom',tipX:.8,tipY:1.3},width:64,height:64,sourceSvgPath:svg},{id:'ref23-person-test',label:'人物铭牌',kind:'bubble',contour,insets:{left:.2,right:.2,top:.1,bottom:.1},tailPreset:{visible:false},width:64,height:64}];
 function client(name){const dataDir=path.join(dir,name);fs.mkdirSync(dataDir);const store={db:{assets:[],projects:[],libraryFonts:[]},save(){}};const library=createRemoteLibrary({dataDir,configPath:config,store,addAsset(){},body:async req=>req.payload,json(res,status,value){res.status=status;res.value=value;}});return {library,bubbles:createBubbleStyleLibrary({dataDir,library,getStyles:()=>styles,sourcePath:s=>s.filePath||file})};}
 try{
  const a=client('publisher');let lost=true;const remote=a.library.remote;a.library.remote=async(route,options)=>{const result=await remote(route,options);if(lost&&options?.method==='POST'&&route.endsWith('/styles')){lost=false;throw Error('simulated response lost');}return result;};
  await assert.rejects(a.bubbles.publish(),/response lost/);const accepted=await a.library.read('/api/global-library/image/bubble/styles');assert.equal(accepted.items.length,1);
  assert.equal((await a.bubbles.publish()).count,2);const first=await a.bubbles.readManifest();assert.equal(first.classified,true);assert.equal(first.items.length,2);assert.equal(first.items.find(i=>i.id==='ref23-person-test').assetType,'nameplate');
  const original=first.items.find(i=>i.id==='test-speech'),fixed='/api/global-library/image/bubble/assets/'+original.assetId+'/revisions/'+original.revisionId;
  assert.equal((await a.library.read('/api/global-library/image/bubble/assets/'+original.assetId)).versionCount,1);
  const cold=client('cold');const restored=await cold.bubbles.readManifest();assert.deepEqual(restored.items,first.items);
  const image=await cold.library.remote('/api/revisions/'+original.revisionId+'/download');assert.equal(hash(Buffer.from(await image.arrayBuffer())),hash(fs.readFileSync(file)));
  const sourceSvg=await cold.library.remote(fixed+'/styles/test-speech/source.svg');assert.equal(hash(Buffer.from(await sourceSvg.arrayBuffer())),hash(fs.readFileSync(svg)));
  styles[0].insets.left=.15;styles[0].tailPreset.tipX=.6;await a.bubbles.publish();const current=(await cold.bubbles.readManifest()).items.find(i=>i.id==='test-speech');assert.equal(current.assetId,original.assetId);assert.notEqual(current.revisionId,original.revisionId);assert.equal(current.insets.left,.15);assert.equal(current.tailPreset.tipX,.6);
  assert.deepEqual((await a.library.read(fixed+'/styles')).items[0],original);assert.equal((await a.library.read('/api/global-library/image/bubble/assets/'+original.assetId)).versionCount,2);
  await a.bubbles.publish();assert.equal((await a.library.read('/api/global-library/image/bubble/assets/'+original.assetId)).versionCount,2);assert.equal(workerError,undefined);
  // Two ordinary accounts: switch after a chunk has arrived, before completion.
  await f.db.query('INSERT INTO users(id,username,display_name,password_hash,is_admin) VALUES($1,$2,$2,$3,false)',[id(),'second-maker',await passwordHash('synthetic-maker-only-2026')]);
  const switching=client('switching'),input={projectId:null,assetKind:'image',assetType:'bubble',name:'账号切换测试.png',bytes:fs.readFileSync(file)},network=globalThis.fetch;
  let release,arrived;const gate=new Promise(r=>release=r),chunkArrived=new Promise(r=>arrived=r);let delayed=false;
  globalThis.fetch=async(url,options)=>{const response=await network(url,options);if(String(url).startsWith(base)&&String(url).endsWith('/chunks/0')&&!delayed){delayed=true;arrived();await gate;}return response;};
  const login=async(username,password)=>switching.library.handle({payload:{username,password}},{},{pathname:'/api/library/login',method:'POST',url:new URL('/api/library/login',base)});
  try{const uploading=switching.library.uploadAsset(input);const rejected=assert.rejects(uploading,/账号已切换/);await chunkArrived;await login('second-maker','synthetic-maker-only-2026');release();await rejected;
   const pending=(await f.db.query("SELECT id,state FROM uploads WHERE name='账号切换测试.png'")).rows;assert.equal(pending.length,1);assert.equal(pending[0].state,'uploading');
   await switching.library.uploadAsset(input);assert.equal((await f.db.query("SELECT count(*)::int n FROM uploads WHERE name='账号切换测试.png'")).rows[0].n,2);
   await login('test-maker','moku-test-only-2026');await switching.library.uploadAsset(input);assert.equal((await f.db.query("SELECT count(*)::int n FROM uploads WHERE name='账号切换测试.png'")).rows[0].n,2);assert.equal((await f.db.query('SELECT state FROM uploads WHERE id=$1',[pending[0].id])).rows[0].state,'completed');
  }finally{release();globalThis.fetch=network;}
  process.env.COMIC_LIBRARY_CONFIG=config;process.env.COMIC_PROJECT_SYNC='0';process.env.COMIC_TEAM_AUTO_SYNC='0';process.env.COMIC_SLOT_DIR=path.join(dir,'slots');
  const fake={close(){},status:async()=>({connected:false}),generate(){assert.fail('No real AI');}};
  studio=createStudio({dataDir:path.join(dir,'studio'),bridge:fake,jimengBridge:fake,seedReference:false});await new Promise(r=>studio.server.listen(0,'127.0.0.1',r));
  const p=createProject('可编辑气泡真实接口验收',true),pg=p.pages[0],b=pg.bubbles[0],frame=pg.panels[0];p.pages=[pg];pg.panels=[frame];pg.bubbles=[b];b.parentPanelId=frame.id;studio.store.db.projects.push(p);studio.store.save();
  const origin='http://127.0.0.1:'+studio.server.address().port,{chromium}=createRequire(import.meta.url)('C:/Users/EDY/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:1600,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>{const u=new URL(route.request().url());return u.origin===origin||['data:','blob:'].includes(u.protocol)?route.continue():route.abort();});
  await page.goto(origin+'/?project='+p.id);await page.locator('#project-label').waitFor();await page.locator('[data-rail-tab=layers]').click();if(!await page.locator('#layer-list [data-layer="'+b.id+'"]').count())await page.locator('[data-toggle-group="'+frame.id+'"]').click();await page.locator('#layer-list [data-layer="'+b.id+'"]').evaluate(n=>n.click());await page.locator('[data-bubble-properties]').waitFor();
  await page.locator('[data-bubble-inspector-tab="frame"]').click();await page.locator('[data-action="bubble-choose-material"]').click();await page.locator('[data-bubble-material="test-speech"]').click();await page.locator('#modal').waitFor({state:'hidden'});await page.waitForFunction(()=>document.querySelector('#save-state')?.textContent==='已保存到本机');
  const chosen=structuredClone(studio.store.project(p.id).pages[0].bubbles[0]);assert.equal(chosen.styleLibrary.revisionId,current.revisionId);assert.deepEqual(chosen.assetInsets,current.insets);assert.deepEqual(chosen.assetContour,current.contour);assert.equal(chosen.text,b.text);
  // Save via the public document protocol and verify the pinned style reference.
  const created=await (await a.library.remote('/api/projects',{method:'POST',headers:{'Idempotency-Key':id()},body:JSON.stringify({name:'气泡固定引用验收'})})).json();
  const project=structuredClone(studio.store.project(p.id));project.pages[0].storyboard={episode:61};const scene=await a.library.uploadAsset({projectId:created.id,assetKind:'image',assetType:'scene',objectName:'合成庭院',name:'庭院.png',bytes:fs.readFileSync(file)});const localSceneId='asset_'+id();project.pages[0].panels[0].imageAssetId=localSceneId;
  const content={format:'comic-strip-project-snapshot',version:1,projectId:project.id,title:project.title,project,assets:[{id:localSceneId,library:scene}],stableHash:hash(JSON.stringify(project))};
  const saved=await (await a.library.remote('/api/documents',{method:'POST',body:JSON.stringify({projectId:created.id,name:project.title,type:'engineering.snapshot',content,references:[]})})).json();
  const snapshotRoute='/api/project-library/'+created.id+'/engineerings/'+saved.id+'/snapshots/'+saved.snapshots[0].snapshotId;
  const snapshot=await a.library.read(snapshotRoute);assert.ok(snapshot.references.some(r=>r.revisionId===current.revisionId&&r.assetId===current.assetId),'snapshot must pin the adopted editable style image');
  styles[0].insets.left=.18;await a.bubbles.publish();
  const fixedImage=await a.library.remote(snapshotRoute+'/references/'+current.revisionId+'/download');assert.equal(hash(Buffer.from(await fixedImage.arrayBuffer())),hash(fs.readFileSync(file)));assert.deepEqual((await a.library.read(snapshotRoute)).references,snapshot.references);await page.reload();await page.locator('#project-label').waitFor();assert.deepEqual(studio.store.project(p.id).pages[0].bubbles[0],chosen);assert.deepEqual(errors,[]);await page.locator('[data-rail-tab=layers]').click();if(!await page.locator('#layer-list [data-layer="'+b.id+'"]').count())await page.locator('[data-toggle-group="'+frame.id+'"]').click();await page.locator('#layer-list [data-layer="'+b.id+'"]').click();await page.locator('[data-bubble="'+b.id+'"]').first().waitFor();await page.screenshot({path:path.join(dir,'editable-bubble-restored.png')});
  fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify({passed:true,ordinaryAccount:true,realHttp:true,coldClient:true,responseLossRetry:true,fixedImageHash:true,fixedSvgHash:true,versions:[original.revisionId,current.revisionId]},null,2));
 }finally{await browser?.close();studio?.close();studio?.server.closeAllConnections();clearInterval(worker);await f.close();}
});
