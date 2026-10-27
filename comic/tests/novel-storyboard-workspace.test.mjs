import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';


const columns=['格号','出现角色','当前场景','当前天气','当前时间','景别','机位角度','画面内容','台词','特效字','画面备注'];
const root=fileURLToPath(new URL('../',import.meta.url));
function fixture(){return {id:'novelversion_synthetic_329',created:'2026-10-14T08:00:00Z',model:{episodes:Array.from({length:10},(_,index)=>({episode:11+index,title:'合成第'+(11+index)+'话'})),rows:Array.from({length:329},(_,index)=>{
  const episode=11+Math.floor(index/33),panel=index%33+1,client={...Object.fromEntries(columns.map(field=>[field,''])),格号:String(panel),出现角色:'甲',当前场景:'山林',当前天气:'晴',当前时间:'白天',景别:'中景',机位角度:'平视',画面内容:index===0?'长画面内容完整阅读。'.repeat(500)+'末尾必须完整可见。':`合成第${episode}话第${panel}格：甲沿山路前行。`,台词:index===2?'甲：唯一搜索台词。':'甲：继续走。',画面备注:'待审核 <img src=x onerror="window.unsafe=true">'};
  return {id:'shot_'+index,episode,page:2,client,bindings:[{assetId:'asset_synthetic',referenceId:'R001',metadata:{retain:true}}],internal:{原文出处:'逐字原句必须保留',custom:{keep:'nested metadata'}},beat:'承接',intensity:3,mood:'平静',positions:'甲在左侧',atmosphere:'林间晨光',sfx:['沙沙'],sourceLocation:'第131章第2段',characterStates:'甲：旧布衣',propStates:'袋子：完整',layout:{height:1,gapBefore:.1,width:'全宽',shape:'常规',pageBreak:false},sourceRefs:['source_131'],customRow:{keep:true}};
  })}};}



test('329格真实浏览器：分话阅读搜索、单格编辑、失败保留、保存和关闭确认',{timeout:60000},async t=>{
  const require=createRequire(import.meta.url),modules=path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'),{chromium}=require(path.join(modules,'playwright'));
  const qaRoot='../verification/synthetic-browser';fs.mkdirSync(qaRoot,{recursive:true});const directory=fs.mkdtempSync(path.join(qaRoot,'run-')),evidence=path.join(directory,'evidence');fs.mkdirSync(evidence);
  const server=createServer((req,res)=>{if(req.url==='/novel-storyboard-workspace.js'){res.writeHead(200,{'content-type':'text/javascript; charset=utf-8'});res.end(fs.readFileSync(path.join(root,'public','novel-storyboard-workspace.js')));}else {res.writeHead(200,{'content-type':'text/html; charset=utf-8'});res.end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>合成分镜工作区测试</title><body></body></html>');}});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let context;t.after(async()=>{await context?.close();await new Promise(resolve=>server.close(resolve));});
  context=await chromium.launchPersistentContext(path.join(directory,'browser-profile'),{channel:'msedge',headless:true,args:['--disable-gpu'],viewport:{width:1500,height:1000},env:{...process.env,TEMP:directory,TMP:directory}});
  const origin='http://127.0.0.1:'+server.address().port;await context.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  const page=context.pages()[0]||await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto(origin);
  const original=fixture();await page.evaluate(async version=>{
    const {mountNovelStoryboardWorkspace}=await import('/novel-storyboard-workspace.js');window.originalVersion=version;window.saveCalls=[];window.saveAttempts=0;window.messages=[];
    window.workspace=mountNovelStoryboardWorkspace({toast:message=>window.messages.push(message),onSave:async payload=>{window.saveCalls.push(structuredClone(payload));if(++window.saveAttempts===1)throw Error('合成保存失败，稍后重试');const fresh=structuredClone(window.originalVersion);fresh.id='novelversion_saved';fresh.model.rows=payload.rows.map(row=>({...row,client:Object.fromEntries(['格号','出现角色','当前场景','当前天气','当前时间','景别','机位角度','画面内容','台词','特效字','画面备注'].map(field=>[field,row[field]]))}));return {workflow:{versions:[fresh],activeVersionId:fresh.id}};}});window.workspace.open(version,{episode:11});
  },original);
  const dialog=page.locator('.nsw-dialog'),save=dialog.locator('[data-nsw-action="save"]');
  try{
    assert.equal(await dialog.locator('[data-nsw-episode]').count(),10);assert.equal(await dialog.locator('[data-nsw-shot]').count(),33);assert.equal(await dialog.locator('textarea').count(),0);assert.equal(await save.isDisabled(),true);assert.match(await dialog.locator('[data-read-field="画面内容"]').textContent(),/末尾必须完整可见。$/);assert.equal(await page.evaluate(()=>window.unsafe),undefined);
    await dialog.locator('[data-nsw-search]').fill('唯一搜索台词');assert.equal(await dialog.locator('[data-nsw-shot]').count(),1);assert.match(await dialog.locator('[data-read-field="台词"]').textContent(),/唯一搜索台词/);await dialog.locator('[data-nsw-search]').fill('');await dialog.locator('[data-nsw-shot="0"]').click();
    await dialog.locator('[data-nsw-action="edit"]').click();const picture=dialog.locator('[data-edit-client="画面内容"]');assert.ok((await picture.boundingBox()).width>500);await picture.fill('合成人工修改：完整保留元数据。');await dialog.locator('[data-edit-internal="角色状态"]').fill('甲：衣袖破损');assert.equal(await save.isEnabled(),true);
    await dialog.locator('[data-nsw-action="next"]').click();assert.equal(await dialog.locator('textarea').count(),0);await dialog.locator('[data-nsw-action="previous"]').click();assert.equal(await dialog.locator('[data-read-field="画面内容"]').textContent(),'合成人工修改：完整保留元数据。');
    await save.click();await dialog.locator('.nsw-feedback[data-error="true"]').waitFor();assert.match(await dialog.locator('.nsw-feedback').textContent(),/合成保存失败/);assert.equal(await save.isEnabled(),true);assert.equal(await dialog.locator('[data-read-field="画面内容"]').textContent(),'合成人工修改：完整保留元数据。');
    let confirms=0;page.once('dialog',async confirmation=>{confirms++;assert.match(confirmation.message(),/尚未保存/);await confirmation.dismiss();});await dialog.locator('[data-nsw-action="close"]').click();assert.equal(confirms,1);assert.equal(await dialog.isVisible(),true);
    await save.click();await page.waitForFunction(()=>document.querySelector('.nsw-feedback')?.textContent.includes('已保存为新版本'));assert.equal(await save.isDisabled(),true);
    const sent=await page.evaluate(()=>window.saveCalls.at(-1));assert.equal(sent.versionId,original.id);assert.equal(sent.rows.length,329);assert.equal(sent.rows[0].page,2);assert.deepEqual(sent.rows[0].bindings,original.model.rows[0].bindings);assert.deepEqual(sent.rows[0].internal.custom,{keep:'nested metadata'});assert.equal(sent.rows[0].internal.原文出处,'逐字原句必须保留');assert.equal(sent.rows[0].internal.角色状态,'甲：衣袖破损');assert.deepEqual(sent.rows[0].customRow,{keep:true});assert.deepEqual(await page.evaluate(()=>window.originalVersion),original);
    await dialog.screenshot({path:path.join(evidence,'01-desktop-329-shot-workspace.png')});
    for(const width of [800,390]){await page.setViewportSize({width,height:900});const bounds=await dialog.boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=width+1);assert.equal(await page.evaluate(()=>document.querySelector('.nsw-dialog').scrollWidth<=window.innerWidth),true);assert.equal(await save.isVisible(),true);assert.equal(await dialog.locator('[data-nsw-action="next"]').isVisible(),true);}
    await dialog.screenshot({path:path.join(evidence,'02-narrow-workspace.png')});await dialog.locator('[data-nsw-episode="20"]').click();assert.equal(await dialog.locator('[data-nsw-shot]').count(),32);
    await dialog.locator('[data-nsw-action="edit"]').click();const originalPicture=await dialog.locator('[data-edit-client="画面内容"]').inputValue();await dialog.locator('[data-edit-client="画面内容"]').fill('暂时修改');await dialog.locator('[data-edit-client="画面内容"]').fill(originalPicture);assert.equal(await save.isDisabled(),true);
    await dialog.locator('[data-nsw-action="close"]').click();assert.equal(await dialog.isVisible(),false);assert.equal(confirms,1);assert.deepEqual(errors,[]);
    fs.writeFileSync(path.join(evidence,'report.json'),JSON.stringify({ok:true,shots:329,episodes:10,checks:['全字段完整阅读','按话搜索','单格编辑','保存失败保留修改','未保存关闭确认','新版本保存元数据保留','原版本不可变','390/800响应布局','恢复原文后无误报修改'],errors},null,2)+'\n');
  }catch(error){await page.screenshot({path:path.join(evidence,'failure.png')}).catch(()=>{});throw error;}
});
