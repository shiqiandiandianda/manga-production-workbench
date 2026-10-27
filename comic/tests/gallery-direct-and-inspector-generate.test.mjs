import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {syntheticFiles} from './fixtures/production-synthetic.mjs';
import {inspectProductionPackage} from '../lib/production-package.mjs';
import {productionProject} from '../lib/production-package-document.mjs';
import {prepareWorkspaceBinding} from '../lib/asset-workspace-api.mjs';
import {ensureProjectPanelGeneration} from '../public/panel-generation.js';
import {assetWorkspaceInventory} from '../public/asset-workspace-model.js';
import {createStudio} from '../server.mjs';
import {createProject,panel,clone,id} from '../public/model.js';
import {migrateLayerDocument} from '../public/layers.js';
import {ensureLayoutHistory} from '../public/layout-history.js';
const require=createRequire(import.meta.url),deps=(process.env.CODEX_TEST_NODE_MODULES || 'node_modules');
const {chromium}=require(path.join(deps,'playwright')),{createCanvas}=require(path.join(deps,'@napi-rs/canvas'));
const proof=path.resolve(import.meta.dirname,'../../verification/asset-gallery-direct-pick-20261027');fs.mkdirSync(proof,{recursive:true});
const png=createCanvas(600,400).toBuffer('image/png'),until=async check=>{for(let i=0;i<400;i++){if(await check())return;await new Promise(r=>setTimeout(r,20));}throw Error('测试状态未按预期完成');};
const launch=()=>chromium.launch({channel:'msedge',headless:true,env:{...process.env,TEMP:proof,TMP:proof}});

test('列表缩略图采用全程不打开详情：延迟、连点、失败重试、固定版本、当前范围与滚动位置',{timeout:60000},async t=>{
 const names=Array.from({length:16},(_,i)=>'测试人物'+String(i+1).padStart(2,'0')),files=syntheticFiles(),board=JSON.parse(files[0].bytes),screens=JSON.parse(files[1].bytes);
 for(const p of board['格']){p['出现角色']=names;p['服装']=Object.fromEntries(names.map(n=>[n,'黑衣']));p['台词']=[];}
 for(const s of screens['屏段'])s['附图']=names.map(n=>({'类型':'设定卡','人物':n,'服装':'黑衣','必须':true}));screens['文字']=[];
 files[0].bytes=Buffer.from(JSON.stringify(board));files[1].bytes=Buffer.from(JSON.stringify(screens));
 let project=productionProject(await inspectProductionPackage(files));ensureProjectPanelGeneration(project,[]);
 const cloud=randomUUID(),assets=[],calls=[],errors=[],catalogue=[...names,'测试庭院'].flatMap(name=>[1,2].map(i=>({id:randomUUID(),name:name+'_候选'+i+'.png',category:name==='测试庭院'?'scene':'character',recommendedRevisionId:randomUUID(),projectId:cloud})));
 const store={db:{assets,jobs:[]},asset:id=>assets.find(a=>a.id===id)},publicRoot=path.resolve('public'),styles=fs.readFileSync(path.join(publicRoot,'index.html'),'utf8').match(/<link rel="stylesheet"[^>]+>/g).join('');
 let importRelease,bindRelease,holdImport=false,holdBind=false,failImport=false,staleImport=false,failBind=false;
 const html=`<!doctype html><meta charset="utf-8">${styles}<style>body{margin:0}.app-shell{position:relative;display:block;height:100vh;min-height:0}</style><body class="modern-workbench"><div class="app-shell"><section id="references-tab"></section><section id="inspector-body"></section></div><script type="module">import{mountAssetWorkspace}from'/asset-workspace-ui.js';let data=await(await fetch('/fixture')).json();window.ui=mountAssetWorkspace({api:async(url,method='GET',body)=>{const r=await fetch(url,{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined}),v=await r.json();if(!r.ok)throw Error(v.error);return v},getProject:()=>data.project,getPage:()=>data.project.pages[0],getSelected:()=>data.project.pages[0].panels.find(p=>p.productionSegment),getAssets:()=>data.assets,flushSave:async()=>{},accept:async p=>{data.project=p;window.ui.refresh(true)},onAssets:items=>{for(const a of items)if(!data.assets.some(x=>x.id===a.id))data.assets.push(a)},toast:()=>{},renderInspector:()=>{}});window.ui.open();window.detailOpenings=0;const detail=document.querySelector('#asset-detail-panel');new MutationObserver(records=>{if(!detail.hidden||records.some(r=>r.attributeName==='hidden'&&r.oldValue===null))window.detailOpenings++}).observe(detail,{attributes:true,attributeOldValue:true,attributeFilter:['hidden']});</script>`;
 const server=http.createServer(async(req,res)=>{const json=(v,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(v))};try{const u=new URL(req.url,'http://local');
  if(u.pathname==='/')return res.end(html);if(u.pathname==='/fixture')return json({project,assets});if(u.pathname.endsWith('/results'))return json({items:[]});
  if(u.pathname==='/api/library/projects')return json({items:[{id:cloud,name:'合成图库'}]});if(u.pathname==='/api/library/assets')return json({items:u.searchParams.get('projectId')===cloud?catalogue:[],more:false});
  if(req.method==='POST'){let text='';for await(const c of req)text+=c;const input=JSON.parse(text);calls.push({path:u.pathname,input});
   if(u.pathname.endsWith('/reuse'))return json({changed:false,summary:{reused:0}});
   if(u.pathname==='/api/library/import'){if(holdImport)await new Promise(r=>importRelease=r);if(failImport){failImport=false;return json({error:'合成断网'},503)}const remote=catalogue.find(a=>a.id===input.assetId);let a=assets.find(a=>a.library.assetId===remote.id);if(!a){a={id:'asset_'+randomUUID(),name:remote.name,width:600,height:400,libraryRole:remote.category,libraryName:remote.name.split('_')[0],libraryState:'白衣',productionStatus:'confirmed',library:{assetId:remote.id,revisionId:remote.recommendedRevisionId,sha256:'a'.repeat(64),projectId:cloud}};assets.push(a)}return json({asset:staleImport?{...a,library:{...a.library,revisionId:randomUUID()}}:a});}
   if(u.pathname.endsWith('/bind')){if(holdBind)await new Promise(r=>bindRelease=r);if(failBind){failBind=false;return json({error:'合成版本冲突'},409)}project=prepareWorkspaceBinding(store,project,input,store.asset(input.assetId));project.revision++;return json({project});}
   throw Error('禁止其他写入 '+u.pathname);
  }
  if(u.pathname.startsWith('/api/assets/')||u.pathname.startsWith('/assets/')||u.pathname.includes('/preview/')||u.pathname.endsWith('/download')){res.setHeader('Content-Type','image/png');return res.end(png)}
  const file=path.resolve(publicRoot,'.'+u.pathname);assert.ok(file.startsWith(publicRoot+path.sep));if(!fs.existsSync(file))return json({},404);res.setHeader('Content-Type',file.endsWith('.css')?'text/css':'text/javascript');res.end(fs.readFileSync(file));
 }catch(e){json({error:e.message},500)}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await launch();t.after(async()=>{importRelease?.();bindRelease?.();await browser.close();server.closeAllConnections();server.close()});
 const page=await browser.newPage({viewport:{width:1280,height:950}}),origin='http://127.0.0.1:'+server.address().port;page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());await page.goto(origin);
 await page.locator('[data-gallery-scope]').selectOption('panel');await page.locator('[data-asset-auto-match]').click();await page.waitForFunction(()=>document.querySelector('[data-asset-search-status]').textContent.startsWith('匹配完成'));
 const card=name=>page.locator('.asset-gallery-card').filter({has:page.locator('.asset-gallery-caption>strong',{hasText:new RegExp('^'+name+'$')})});
 const target=names.at(-1),candidate=card(target).locator('[data-gallery-adopt]').first(),chosen=await candidate.getAttribute('data-gallery-adopt');await candidate.scrollIntoViewIfNeeded();const scroll=await page.locator('[data-asset-list]').evaluate(n=>n.scrollTop);assert.ok(scroll>0);
 holdImport=true;holdBind=true;await candidate.evaluate(n=>{n.click();n.click()});await until(()=>!!importRelease);
 const inOverview=async()=>{assert.equal(await page.locator('#asset-detail-panel').isVisible(),false);assert.equal(await page.evaluate(()=>window.detailOpenings),0);assert.equal(await page.locator('#asset-gallery-workspace').isVisible(),true)};
 await inOverview();assert.equal(calls.filter(c=>c.path.endsWith('/import')).length,1);assert.equal(calls.filter(c=>c.path.endsWith('/bind')).length,0);await page.screenshot({path:path.join(proof,'gallery-adopting.png')});
 holdImport=false;importRelease();await until(()=>!!bindRelease);await inOverview();holdBind=false;bindRelease();await page.waitForFunction(()=>document.querySelector('[data-asset-search-status]').textContent.startsWith('已采用'));
 await inOverview();assert.match(await card(target).innerText(),/已采用/);assert.ok(Math.abs(await page.locator('[data-asset-list]').evaluate(n=>n.scrollTop)-scroll)<=1);assert.equal(await page.locator('[data-gallery-scope]').inputValue(),'panel');
 const firstBind=calls.find(c=>c.path.endsWith('/bind'));assert.equal(firstBind.input.userSelected,true);assert.equal(firstBind.input.targets.length,1);assert.equal(calls.find(c=>c.path.endsWith('/import')).input.revisionId,catalogue.find(c=>c.id===chosen).recommendedRevisionId);
 const globalRow=assetWorkspaceInventory(project,assets,{scope:'work'}).find(r=>r.name===target);assert.equal(globalRow.uses.filter(u=>u.missing).length,globalRow.uses.length-1);
 // Failures leave the same list and candidate available for retry.
 const retry=card(names[0]).locator('[data-gallery-adopt]').first();failImport=true;await retry.click();await page.waitForFunction(()=>document.querySelector('[data-asset-search-status]').textContent.includes('合成断网'));await inOverview();assert.equal(calls.filter(c=>c.path.endsWith('/bind')).length,1);
 staleImport=true;await retry.click();await page.waitForFunction(()=>document.querySelector('[data-asset-search-status]').textContent.includes('图片版本已改变'));staleImport=false;await inOverview();assert.equal(calls.filter(c=>c.path.endsWith('/bind')).length,1);
 failBind=true;await retry.click();await page.waitForFunction(()=>document.querySelector('[data-asset-search-status]').textContent.includes('合成版本冲突'));await inOverview();
 await retry.click();await page.waitForFunction(()=>document.querySelector('[data-asset-search-status]').textContent.startsWith('已采用'));await inOverview();
 await card('测试庭院').locator('[data-gallery-adopt]').first().click();await page.waitForFunction(()=>document.querySelector('[data-asset-search-status]').textContent.startsWith('已采用'));await inOverview();assert.match(await card('测试庭院').innerText(),/已采用/);assert.deepEqual(errors,[]);
 await page.screenshot({path:path.join(proof,'gallery-selected.png')});fs.writeFileSync(path.join(proof,'gallery-browser.json'),JSON.stringify({ok:true,detailOpenings:0,scopePreserved:true,scrollPreserved:true,doubleClickProtected:true,importFailureRetry:true,staleRevisionRejected:true,bindFailureRetry:true,characterAndScene:true,realProjectWrites:0,errors},null,2));
});

test('右侧大按钮实际提交当前格：新提示词、参考、锁定、进行中防连点和切换格子',{timeout:60000},async t=>{
 const dir=fs.mkdtempSync(path.join(proof,'generation-fixture-')),filePath=path.join(dir,'synthetic.png');fs.writeFileSync(filePath,png);
 const calls=[],posts=[],errors=[],releases=[];let browser;
 const studio=createStudio({dataDir:path.join(dir,'data'),bridge:{close(){},status:async()=>({connected:true,imageFeature:true}),generate:async(_dir,input,refs)=>{calls.push({input:clone(input),refs:[...refs]});await new Promise(r=>releases.push(r));return {filePath,imageToolSeen:true}}},jimengBridge:{close(){},status:async()=>({connected:false,message:'合成通道'})},storyboardGenerator:{close(){}}});
 await new Promise(r=>studio.server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+studio.server.address().port;t.after(async()=>{releases.forEach(r=>r());await browser?.close();studio.close();studio.server.closeAllConnections();studio.server.close()});
 const asset=await(await fetch(origin+'/api/assets',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({filePath,name:'合成参考'})})).json();
 const project=migrateLayerDocument(createProject('本格大按钮验收')).project,first=project.pages[0].panels[0],originalShot=project.shots[0];originalShot.description='导入原文：庭院里的人物。';first.referenceIds=[asset.id];
 const secondShot={...clone(originalShot),id:id('shot'),code:'002',description:'第二格自己的原文'},lockedShot={...clone(originalShot),id:id('shot'),code:'003'};project.shots.push(secondShot,lockedShot);
 const second=panel(secondShot.id,60,1000,800,600),locked={...panel(lockedShot.id,60,1800,800,600),locked:true};project.pages[0].panels.push(second,locked);project.pages[0].height=2600;project.pages[0].bubbles=[];ensureProjectPanelGeneration(project,[asset]);ensureLayoutHistory(project);studio.store.db.projects.push(project);studio.store.save();
 browser=await launch();const page=await browser.newPage({viewport:{width:1864,height:950}});await page.addInitScript(()=>localStorage.setItem('comic-generation-provider','codex'));await page.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.method()==='POST'&&new URL(r.url()).pathname==='/api/jobs')posts.push(r.postDataJSON())});await page.goto(origin+'/?project='+project.id);await page.waitForFunction(()=>document.querySelector('#save-state').textContent==='已保存到本机');
 const select=async frame=>{if(!await page.locator('#layer-list').isVisible())await page.locator('[data-rail-tab="layers"]').click();await page.locator('[data-layer="'+frame.id+'"]').click();await page.locator('[data-properties-shortcut="toolbar"]').click()};
 await select(first);const button=page.locator('#inspector-body [data-action="generate-current-panel"]');await button.waitFor({state:'visible'});
 assert.equal(await button.innerText(),'生成本格图片');assert.equal(await button.isEnabled(),true);const geometry=await button.evaluate(n=>{const b=n.getBoundingClientRect(),p=n.closest('#inspector-body').getBoundingClientRect(),hit=document.elementFromPoint(b.x+b.width/2,b.y+b.height/2);return {width:b.width,height:b.height,font:parseFloat(getComputedStyle(n).fontSize),inside:b.left>=p.left&&b.right<=p.right&&b.bottom<=innerHeight,hit:hit===n}});await page.screenshot({path:path.join(proof,"inspector-size-check.png")});assert.ok(geometry.width>240&&geometry.height>=56&&geometry.font>=16,JSON.stringify(geometry));assert.equal(geometry.inside,true);assert.equal(geometry.hit,true);
 await page.locator('[data-section="panel-prompt"]').fill('手动新提示词：人物站在庭院正中。');await page.screenshot({path:path.join(proof,'inspector-large-generate.png')});
 await button.evaluate(n=>{n.click();n.click()});await until(()=>calls.length===1);assert.deepEqual(posts.map(p=>p.panelIds),[[first.id]]);assert.equal(calls[0].input.shot.productionPrompt,'手动新提示词：人物站在庭院正中。');assert.deepEqual(calls[0].refs,[asset.filePath]);assert.equal(await button.isDisabled(),true);assert.equal(await button.getAttribute('aria-busy'),'true');await button.evaluate(n=>n.click());assert.equal(posts.length,1);
 await select(locked);assert.equal(await button.isDisabled(),true);assert.match(await button.getAttribute('title'),/解锁画格/);await button.evaluate(n=>n.click());assert.equal(posts.length,1);
 await select(second);assert.equal(await button.isEnabled(),true);await button.click();await until(()=>calls.length===2);assert.deepEqual(posts[1].panelIds,[second.id]);assert.equal(calls[1].input.shot.productionPrompt,'第二格自己的原文');
 releases.forEach(r=>r());await until(()=>studio.idle());await page.waitForFunction(()=>!document.querySelector('#inspector-body [data-action="generate-current-panel"]').disabled);assert.equal(await button.innerText(),'生成本格图片');assert.equal(await button.getAttribute('aria-busy'),'false');assert.deepEqual(errors,[]);
 fs.writeFileSync(path.join(proof,'generation-button-browser.json'),JSON.stringify({ok:true,geometry,currentPanelOnly:true,latestPrompt:true,referencesPreserved:true,lockedDisabled:true,duplicatePrevented:true,restoredAfterCompletion:true,realAI:false,realProjectWrites:0,errors},null,2));
});
