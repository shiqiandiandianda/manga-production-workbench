import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {createStudio} from '../server.mjs';
import {syntheticFiles} from './fixtures/production-synthetic.mjs';
import {productionReferencePlan,productionFrame} from '../public/production-package-model.js';
import {productionExtraNeeds,bindProductionExtraReference} from '../public/production-extra-references.js';
import {episodeAssetOverview} from '../public/episode-assets.js';
import {planProductionReferences} from '../public/production-reference-audit.js';
const require=createRequire(import.meta.url),{createCanvas}=require(process.env.COMIC_TEST_CANVAS_MODULE),{chromium}=require('playwright');
const evidence=path.resolve('../verification/scene-reference-picker-20261022');fs.mkdirSync(evidence,{recursive:true});
process.env.COMIC_PROJECT_SYNC='0';
async function fixture(t){
 const dir=fs.mkdtempSync(path.join(evidence,'fixture-'));process.env.COMIC_SLOT_DIR=path.join(dir,'slots');process.env.COMIC_LIBRARY_CONFIG=path.join(dir,'moku.json');fs.writeFileSync(process.env.COMIC_LIBRARY_CONFIG,'{"base":"http://127.0.0.1:9"}');
 const studio=createStudio({dataDir:path.join(dir,'data'),seedReference:false,bridge:{close(){},status:async()=>({connected:false})},jimengBridge:{close(){}}});await new Promise(r=>studio.server.listen(0,'127.0.0.1',r));t.after(()=>{studio.close();studio.server.closeAllConnections();});
 const origin='http://127.0.0.1:'+studio.server.address().port,api=async(url,body,method=body?'POST':'GET')=>{const r=await fetch(origin+url,{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});const data=await r.json();assert.ok(r.ok,JSON.stringify(data));return data;};
 const files=syntheticFiles(),board=JSON.parse(files[0].bytes),pkg=JSON.parse(files[1].bytes);
 board['格'].forEach((r,i)=>{r['当前场景']=['预备杂役食堂外','杂役堂'][i];r['出现角色']=['测试人物'];r['出现道具']=['茶杯'];});
 const scan=await api('/api/production-packages/scan',{files:[board,pkg].map((data,i)=>({relativePath:files[i].relativePath,dataBase64:Buffer.from(JSON.stringify(data)).toString('base64')}))}),p=await api('/api/production-packages/import',{scanId:scan.scanId});
 const canvas=createCanvas(96,96),c=canvas.getContext('2d');c.fillStyle='#526b42';c.fillRect(0,0,96,96);const bytes=canvas.toBuffer('image/png'),sha256=createHash('sha256').update(bytes).digest('hex');
 function asset(name,role){const file=path.join(dir,randomUUID()+'.png');fs.writeFileSync(file,bytes);const a={id:'asset_'+randomUUID(),name,filePath:file,width:96,height:96,mime:'image/png',libraryName:name.replace(/\.png$/,''),libraryRole:role,library:{assetId:randomUUID(),revisionId:randomUUID(),sha256,category:role,objectVersion:1}};studio.store.db.assets.push(a);return a;}
 const character=asset('测试人物_黑衣.png','character');for(const segmentId of ['E011-S001','E011-S002'])await api('/api/projects/'+p.id+'/production/references',{segmentId,bindings:[{slot:0,assetId:character.id}],expectedRevision:studio.store.project(p.id).revision});
 return {dir,studio,origin,api,p,asset,bytes,current:()=>studio.store.project(p.id),character,files:[board,pkg],paths:files.map(f=>f.relativePath)};
}
test('本话场景与道具卡直接定位正确需求，搜索与绑定不占人物槽，选完返回总览，刷新与生成计划保留',{timeout:60000},async t=>{
 const f=await fixture(t),before=structuredClone(f.current().productionPackage.episodes[0].segments.map(s=>s.references)),characterBefore=f.character.id;
 const browser=await chromium.launch({channel:'msedge',headless:true});t.after(()=>browser.close());const context=await browser.newContext({viewport:{width:1864,height:949}}),page=await context.newPage(),errors=[],queries=[];
 page.on('pageerror',e=>errors.push(e.message));const names=['预备杂役食堂外','杂役堂','茶杯'],cloud=names.map((name,i)=>({id:randomUUID(),recommendedRevisionId:randomUUID(),name:name+'.png',category:i<2?'scene':'prop'})),imported=new Map();
 await context.route('**/api/library/**',async route=>{const url=new URL(route.request().url());if(url.pathname==='/api/library/projects')return route.fulfill({json:{items:[]}});if(url.pathname==='/api/library/assets'){const q=url.searchParams.get('q')||'';queries.push(q);return route.fulfill({json:{items:cloud.filter(a=>a.name.includes(q)),more:false}});}if(url.pathname==='/api/library/import'){const {assetId,revisionId}=route.request().postDataJSON(),remote=cloud.find(a=>a.id===assetId);assert.equal(revisionId,remote.recommendedRevisionId);if(!imported.has(assetId)){const a=f.asset(remote.name,remote.category);Object.assign(a.library,{assetId,revisionId});imported.set(assetId,a);f.studio.store.save();}return route.fulfill({status:201,json:{kind:'image',asset:imported.get(assetId)}});}if(url.pathname.includes('/preview/')||url.pathname.endsWith('/download'))return route.fulfill({body:f.bytes,contentType:'image/png'});return route.fulfill({json:{connected:false}});});
 await page.goto(f.origin+'/?project='+f.p.id);await page.waitForSelector('#canvas-tool-dock');await page.locator('[data-rail-tab=references]').click();
 for(const [index,name]of names.entries()){
  const card=page.locator('.asset-gallery-card').filter({has:page.locator('.asset-gallery-caption>strong',{hasText:name})});if(await page.locator('#asset-detail-panel').isVisible())await page.locator('[data-asset-close]').click();await card.locator('[data-gallery-choose]').click();
  assert.equal(await page.locator('[data-asset-moku-query]').inputValue(),name);assert.equal(await page.locator('[data-reference-slot-select]').count(),0);assert.ok((await page.locator('.asset-detail-heading').textContent()).includes(name));
  assert.ok(!(await page.locator('.asset-detail-heading').textContent()).includes('测试人物'));await page.locator('[data-asset-moku-use="'+cloud[index].id+'"]').first().waitFor();
  if(index===0)await page.screenshot({path:path.join(evidence,'scene-search-direct.png')});await page.locator('[data-asset-moku-use="'+cloud[index].id+'"]').first().click();await card.locator('.asset-state.ready').waitFor();assert.match(await card.innerText(),/已采用/);
 }
 const current=f.current();assert.deepEqual(current.productionPackage.episodes[0].segments.map(s=>s.references),before);assert.ok(productionFrame(current,'E011-S001').referenceIds.includes(characterBefore));assert.ok(planProductionReferences(current,productionFrame(current,'E011-S001'),f.studio.store.db.assets).ids.includes(imported.get(cloud[0].id).id));
 for(const [sid,name]of [['E011-S001',names[0]],['E011-S002',names[1]]]){const frame=productionFrame(current,sid),plan=productionReferencePlan(current,frame,f.studio.store.db.assets);assert.ok(plan.refs.some(r=>r.role==='scene'&&r.name===name));assert.ok(!plan.refs.some(r=>r.role==='character'&&r.name===name));}
 // A later native character-slot update must keep the separately selected scene and prop.
 await f.api('/api/projects/'+current.id+'/production/references',{segmentId:'E011-S001',bindings:[{slot:0,assetId:characterBefore}],expectedRevision:current.revision});assert.ok(productionFrame(f.current(),'E011-S001').referenceIds.includes(imported.get(cloud[0].id).id));
 await page.reload();await page.waitForSelector('#canvas-tool-dock');await page.locator('[data-rail-tab=references]').click();const overview=episodeAssetOverview(f.current(),f.current().pages.find(p=>p.screenBoard?.segmentId==='E011-S001'),f.studio.store.db.assets);assert.ok(overview.items.find(i=>i.name===names[0]&&i.role==='scene').assetIds.includes(imported.get(cloud[0].id).id));
 const pack=await f.api('/api/projects/'+current.id+'/export');for(const a of pack.assets){const copy=path.join(f.dir,'restore-'+randomUUID()+'.png');fs.copyFileSync(a.filePath,copy);a.filePath=copy;}const restored=await f.api('/api/projects/import',pack);const restoredFrame=productionFrame(restored,'E011-S001'),binding=Object.values(restoredFrame.referenceNeedBindings).find(b=>b.role==='scene');assert.ok(binding.assetId!==imported.get(cloud[0].id).id);assert.ok(restoredFrame.referenceIds.includes(binding.assetId));assert.ok(productionReferencePlan(restored,restoredFrame,f.studio.store.db.assets).refs.some(r=>r.assetId===binding.assetId&&r.role==='scene'));
 assert.ok(queries.includes(names[0])&&queries.includes(names[1])&&queries.includes(names[2]));assert.deepEqual(errors,[]);assert.equal(f.studio.store.db.jobs.length,0);fs.writeFileSync(path.join(evidence,'browser-result.json'),JSON.stringify({queries,checkedSceneAndProp:3,characterBindingsPreserved:true,exportImport:true,errors},null,2));
});
test('只有分镜声明的场景/道具可补充，固定版本和人物槽保护有效',{timeout:10000},async t=>{
 const f=await fixture(t),p=f.current(),frame=productionFrame(p,'E011-S001'),scene=f.asset('场景固定版本.png','scene'),need=productionExtraNeeds(p,frame).find(n=>n.role==='scene');
 assert.throws(()=>bindProductionExtraReference(p,frame,{...need,id:'name:scene:别处',assetId:scene.id},f.studio.store.db.assets),/需求已改变/);assert.throws(()=>bindProductionExtraReference(p,frame,{...need,assetId:f.character.id},f.studio.store.db.assets),/另一参考/);
 bindProductionExtraReference(p,frame,{...need,assetId:scene.id},f.studio.store.db.assets);assert.ok(productionReferencePlan(p,frame,f.studio.store.db.assets).refs.some(r=>r.role==='scene'&&r.assetId===scene.id));scene.library.revisionId=randomUUID();assert.throws(()=>productionReferencePlan(p,frame,f.studio.store.db.assets),/固定版本发生变化/);
});
