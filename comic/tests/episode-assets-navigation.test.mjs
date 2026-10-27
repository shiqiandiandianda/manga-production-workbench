import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {randomUUID,createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {createStudio} from '../server.mjs';
import {createProject,makePage} from '../public/model.js';
import {ensureProjectPanelGeneration} from '../public/panel-generation.js';
import {syntheticFiles} from './fixtures/production-synthetic.mjs';

const require=createRequire(import.meta.url);
const {createCanvas}=require(process.env.COMIC_TEST_CANVAS_MODULE);
const {chromium}=require('playwright');
const evidence=fileURLToPath(new URL('../../verification/episode-assets-navigation-20261022/',import.meta.url));
fs.mkdirSync(evidence,{recursive:true});

for(const production of [true,false])test(`本话资产总览选图后返回并继续下一张，保留位置及关闭方式（${production?'屏段直接采用':'单格保存'}）`,{timeout:60000},async t=>{
 const dir=fs.mkdtempSync(path.join(evidence,production?'production-':'panel-'));
 const studio=createStudio({dataDir:path.join(dir,'data'),seedReference:false,bridge:{close(){},status:async()=>({connected:false})},jimengBridge:{close(){}}});
 await new Promise(resolve=>studio.server.listen(0,'127.0.0.1',resolve));
 let browser;
 t.after(async()=>{await browser?.close();studio.close();studio.server.closeAllConnections();});
 const origin='http://127.0.0.1:'+studio.server.address().port;
 const api=async(route,body)=>{
  const response=await fetch(origin+route,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:undefined);
  const value=await response.json();assert.ok(response.ok,JSON.stringify(value));return value;
 };
 const names=Array.from({length:16},(_,i)=>'测试人物'+String(i+1).padStart(2,'0'));
 let project;
 if(production){
  const files=syntheticFiles(),board=JSON.parse(files[0].bytes),pkg=JSON.parse(files[1].bytes),panel=board['格'][0],segment=pkg['屏段'][0];
  board['格']=names.map(name=>({...panel,'出现角色':[name],'服装':{[name]:'黑衣'},'台词':[]}));
  pkg['文字']=[];
  pkg['屏段']=names.map((name,i)=>({...segment,'段ID':'段'+String(i+1).padStart(2,'0'),'图片':'段'+(i+1)+'.png','格':[{'格ID':'E011-'+String(i+1).padStart(3,'0'),'格号':i+1,'排':1,'排内':'整排'}],'附图':[{'类型':'设定卡','人物':name,'服装':'黑衣','必须':true}],'底图':{'方式':'本段出图','图片':'底图'+(i+1)+'.png','提示词':'合成底色','铺满':['段'+String(i+1).padStart(2,'0')]}}));
  const scan=await api('/api/production-packages/scan',{files:[board,pkg].map((data,i)=>({relativePath:files[i].relativePath,dataBase64:Buffer.from(JSON.stringify(data)).toString('base64')}))});
  project=await api('/api/production-packages/import',{scanId:scan.scanId});
 }else{
  project=createProject('资产总览导航合成工程');
  project.shots=names.map((name,i)=>({...project.shots[0],id:'shot_'+randomUUID(),code:'S'+(i+1),participants:[name],characterStates:name+':黑衣',sourceFields:{'出现角色':[name],'角色状态（服装/形态）':name+':黑衣'}}));
  project.pages=[makePage(project.shots.map(s=>s.id))];
  ensureProjectPanelGeneration(project,[]);studio.store.db.projects.push(project);studio.store.save();
 }
 const canvas=createCanvas(96,96);canvas.getContext('2d').fillRect(0,0,96,96);const bytes=canvas.toBuffer('image/png');
 const cloud=names.map(name=>({id:randomUUID(),recommendedRevisionId:randomUUID(),name:name+'_黑衣.png',category:'character'}));
 const imported=new Map(),errors=[];let failImport=false;
 browser=await chromium.launch({channel:'msedge',headless:true});
 const context=await browser.newContext({viewport:{width:1864,height:949}}),page=await context.newPage();
 page.on('pageerror',error=>errors.push(error.message));
 await context.route('**/api/library/**',async route=>{
  const request=route.request(),url=new URL(request.url());
  if(url.pathname==='/api/library/projects')return route.fulfill({json:{items:[]}});
  if(url.pathname==='/api/library/assets')return route.fulfill({json:{items:cloud.filter(item=>item.name.includes(url.searchParams.get('q')||'')),more:false}});
  if(url.pathname==='/api/library/import'){
   if(failImport)return route.fulfill({status:503,json:{error:'合成取图失败，请重试'}});
   const {assetId,revisionId}=request.postDataJSON(),item=cloud.find(item=>item.id===assetId);assert.equal(revisionId,item.recommendedRevisionId);
   let asset=imported.get(assetId);
   if(!asset){
    const filePath=path.join(dir,item.name);fs.writeFileSync(filePath,bytes);
    asset={id:'asset_'+randomUUID(),name:item.name,filePath,width:96,height:96,mime:'image/png',libraryName:item.name.split('_')[0],libraryState:'黑衣',libraryRole:'character',library:{assetId,revisionId,category:'character',sha256:createHash('sha256').update(bytes).digest('hex')}};
    imported.set(assetId,asset);studio.store.db.assets.push(asset);studio.store.save();
   }
   return route.fulfill({status:201,json:{kind:'image',asset}});
  }
  if(url.pathname.includes('/preview/')||url.pathname.endsWith('/download'))return route.fulfill({body:bytes,contentType:'image/png'});
  return route.fulfill({json:{connected:false}});
 });

 await page.goto(origin+'/?project='+project.id+'&page='+project.pages[0].id);await page.waitForSelector('#canvas-tool-dock');
 await page.locator('[data-rail-tab=references]').click();await page.locator('#asset-gallery-workspace').waitFor({state:'visible'});assert.equal(await page.locator('#asset-detail-panel').isVisible(),false);
 const card=name=>page.locator('.asset-gallery-card').filter({has:page.locator('.asset-gallery-caption>strong',{hasText:name})});
 await card(names[0]).locator('[data-gallery-settings]').click();
 // Current character details combine search and generation in one view.
 assert.equal(await page.locator('#asset-detail-panel [data-asset-view]').count(),2);
 assert.equal(await page.locator('[data-asset-view=current]').getAttribute('aria-selected'),'true');
 assert.equal(await page.locator('.asset-quick-generate').isVisible(),true);
 await page.locator('[data-asset-close]').click();await page.locator('[data-asset-category=character]').click();
 assert.equal(await page.locator('.asset-gallery-card').count(),16);assert.equal(await page.locator('[data-asset-list-next]').count(),0);
 const list=page.locator('[data-asset-list]');assert.ok(await list.evaluate(el=>{const boxes=[...el.children].map(n=>n.getBoundingClientRect());return boxes.every((a,i)=>a.height>200&&boxes.every((b,j)=>i===j||a.right<=b.left||b.right<=a.left||a.bottom<=b.top||b.bottom<=a.top));}));
 for(const index of [8,9]){
  const item=card(names[index]);await item.scrollIntoViewIfNeeded();const position=await list.evaluate(n=>n.scrollTop);await item.locator('.asset-list-item').click();
  assert.equal(await page.locator('[data-asset-view=current]').getAttribute('aria-selected'),'true');const choice=page.locator('[data-asset-use-moku="'+cloud[index].id+'"]').first();await choice.waitFor();
  if(index===8){failImport=true;await choice.click();await page.waitForFunction(()=>document.querySelector('[data-asset-status]')?.textContent.includes('合成取图失败'));assert.equal(await page.locator('#asset-detail-panel').isVisible(),true);failImport=false;}
  await choice.click();await item.locator('.asset-state.ready').waitFor();await page.locator('#asset-detail-panel').waitFor({state:'hidden'});assert.equal(await page.locator('#asset-detail-panel').isVisible(),false);assert.ok(Math.abs(await list.evaluate(n=>n.scrollTop)-position)<3);assert.equal(await page.locator('dialog[open]').count(),0);
 }
 assert.equal(await card(names[15]).count(),1);await page.screenshot({path:path.join(evidence,production?'production-after-two-choices.png':'panel-after-two-choices.png')});assert.equal(studio.store.db.jobs.length,0);assert.equal(imported.size,2);assert.deepEqual(errors,[]);
});
