import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {productionProject} from '../lib/production-package-document.mjs';
import {createStudio} from '../server.mjs';
import {clone,id,panel} from '../public/model.js';
import {normalizeLayerOrder} from '../public/layers.js';
import {ensureLayoutHistory} from '../public/layout-history.js';
import {ensureProjectPanelGeneration,panelProductionShot} from '../public/panel-generation.js';
import {panelSourceBlocksGeneration} from '../public/panel-generation-permission.js';
import {panelGenerationAvailability,episodeGenerationPanelIds} from '../public/generation-policy.js';
import {generationPromptSelection} from '../public/prompt-source.js';

const proof=path.resolve(import.meta.dirname,'../../verification/reflow-panel-regeneration');
fs.mkdirSync(proof,{recursive:true});
const require=createRequire(import.meta.url),deps=process.env.CODEX_TEST_NODE_MODULES||'node_modules';
const {chromium}=require(path.join(deps,'playwright')),{createCanvas}=require(process.env.COMIC_TEST_CANVAS_MODULE||path.join(deps,'@napi-rs/canvas'));
const until=async check=>{for(let i=0;i<600;i++){if(await check())return;await new Promise(r=>setTimeout(r,25));}throw Error('合成裁格验收等待超时');};
function fixture(assetId=id('asset')){
 const segment={id:'E011-S001',localId:'段01',order:0,episode:11,scene:'',prompts:{'空泡':'整屏提示词，不能串到单格','无泡':'整屏无泡提示词'},mode:'empty',source:{file:'synthetic.json'},panelIds:['E011-001','E011-002'],references:[],background:{'方式':'纯色'}};
 const records=segment.panelIds.map((key,i)=>({id:key,segmentId:segment.id,number:i+1,original:{'出现角色':[],'当前场景':'','出现道具':[],'画面内容':'合成单格 '+i,'生图提示词':'单格原文 '+i,'生图提示词（后期嵌字）':'单格无泡原文 '+i},production:{},source:{file:'synthetic.json',pointer:'/格/'+i}}));
 const source={version:1,id:'a'.repeat(24),hash:'b'.repeat(64),title:'合成资料',documents:[],manifest:[],episodes:[{episode:11,title:'合成测试',segments:[segment],panelRecords:records,texts:[],typography:{},anchors:{}}]};
 const project=productionProject(source,'接回原工程的裁格验收'),page=project.pages[0],root=page.panels.find(f=>f.productionSegment);
 Object.assign(root,{visible:false,autoLayoutOriginalPageId:page.id,coordinateSource:{generation:'不生成'},imageAssetId:assetId});
 const crops=records.map((record,i)=>{const f=panel('',100,100+i*950,700,850);f.name=record.id;f.imageAssetId=assetId;f.panelSlice={version:1,segmentId:segment.id,panelId:record.id,rootPanelId:root.id,sourceAssetId:assetId,sourceHash:'d'.repeat(64),key:String(i+1).repeat(64),region:{x:0,y:0,w:1,h:1}};page.panels.push(f);return f;});
 page.bubbles=[];ensureProjectPanelGeneration(project);for(const f of crops){f.autoLayoutCrop={version:1};f.coordinateSource={generation:'不生成'};}normalizeLayerOrder(project);ensureLayoutHistory(project);
 return {project,page,root,crops};
}

test('旧重排标记只对接回原工程且绑定正确源格的可见裁格放行，不改工程数据',()=>{
 const {project,page,root,crops:[crop]}=fixture(),before=clone(project);
 assert.equal(panelSourceBlocksGeneration(crop,project),false);
 assert.equal(panelGenerationAvailability(crop,[],new Set(),project).disabled,false,'已有图允许显式重新生成');
 assert.deepEqual(episodeGenerationPanelIds(project,page),[],'生成本话缺图不得重做已有图');
 assert.equal(panelSourceBlocksGeneration(root,project),true);
 for(const change of [{visible:false},{autoLayoutOriginalPageId:page.id},{autoLayoutCrop:undefined},{panelSlice:{...crop.panelSlice,sourceBindingVersion:undefined}},{panelSlice:{...crop.panelSlice,panelId:'missing'}},{shotId:root.shotId}])assert.equal(panelSourceBlocksGeneration({...crop,...change},project),true,JSON.stringify(change));
 assert.equal(panelSourceBlocksGeneration(crop,{...project,autoLayoutSource:{mode:'screen-crop-reflow'}}),true);
 assert.equal(panelSourceBlocksGeneration(crop,null),true);
 assert.equal(panelGenerationAvailability({...crop,locked:true},[],new Set(),project).disabled,true);
 assert.equal(panelGenerationAvailability(crop,[{panelId:crop.id,status:'running'}],new Set(),project).disabled,true);
 assert.equal(panelGenerationAvailability({...crop,coordinateSource:undefined,generation:{...crop.generation,promptOverrides:{imported:''}}},[],new Set(),project).disabled,true);
 assert.deepEqual(project,before);
});

test('浏览器：有原图裁格可再生成；手改保存重开后使用新词，仅提交当前格并保留旧候选',{timeout:90000},async t=>{
 const dir=fs.mkdtempSync(path.join(proof,'fixture-')),oldPath=path.join(dir,'original.png'),newPath=path.join(dir,'new.png');
 const canvas=createCanvas(700,850),ctx=canvas.getContext('2d');ctx.fillStyle='#597387';ctx.fillRect(0,0,700,850);fs.writeFileSync(oldPath,canvas.toBuffer('image/png'));ctx.fillStyle='#c6b49a';ctx.fillRect(0,0,700,850);fs.writeFileSync(newPath,canvas.toBuffer('image/png'));
 const calls=[],posts=[],errors=[],releases=[];let browser;
 const studio=createStudio({dataDir:path.join(dir,'data'),bridge:{close(){},status:async()=>({connected:true,imageFeature:true}),generate:async(_dir,input)=>{calls.push(clone(input));await new Promise(r=>releases.push(r));return {filePath:newPath,imageToolSeen:true}}},jimengBridge:{close(){},status:async()=>({connected:false,message:'合成通道'})},storyboardGenerator:{close(){}}});
 await new Promise(r=>studio.server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+studio.server.address().port;
 t.after(async()=>{releases.forEach(r=>r());await browser?.close();studio.close();studio.server.closeAllConnections();studio.server.close();});
 const asset=await(await fetch(origin+'/api/assets',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({filePath:oldPath,name:'合成原图'})})).json();
 const {project,page:board,root,crops:[first,second]}=fixture(asset.id),source=clone(project.productionPackage),originalShot=clone(project.shots.find(s=>s.id===first.shotId)),secondPrompt=panelProductionShot(project,second).productionPrompt;
 studio.store.db.projects.push(project);studio.store.save();
 browser=await chromium.launch({channel:'msedge',headless:true,env:{...process.env,TEMP:proof,TMP:proof}});
 const page=await browser.newPage({viewport:{width:1864,height:950}});await page.addInitScript(()=>localStorage.setItem('comic-generation-provider','codex'));
 await page.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());page.on('pageerror',e=>errors.push(e.message));page.on('response',async r=>{if(r.status()>=400&&new URL(r.url()).pathname==='/api/jobs')errors.push(await r.text());});page.on('request',r=>{if(r.method()==='POST'&&new URL(r.url()).pathname==='/api/jobs')posts.push(r.postDataJSON());});
 const open=async()=>{await page.goto(origin+'/?project='+project.id+'&page='+board.id);await page.waitForFunction(()=>document.querySelector('#save-state').textContent==='已保存到本机');if(!await page.locator('#layer-list').isVisible())await page.locator('[data-rail-tab="layers"]').click();await page.locator('[data-layer="'+first.id+'"]').click();await page.locator('[data-properties-shortcut="toolbar"]').click();};
 await open();const button=page.locator('#inspector-body [data-action="generate-current-panel"]'),editor=page.locator('[data-section="panel-prompt"]');
 assert.equal(await button.isEnabled(),true);assert.equal(await editor.inputValue(),originalShot.productionPrompt);
 const edited='手改提示词：浅色背景，石台在画面左侧。\n保留完整边缘。';await editor.fill(edited);await editor.press('Tab');
 const saved=()=>studio.store.project(project.id),savedFrame=()=>saved().pages.flatMap(p=>p.panels).find(f=>f.id===first.id);
 await until(()=>generationPromptSelection(savedFrame(),saved()).text===edited);
 await page.reload();await page.waitForFunction(()=>document.querySelector('#save-state').textContent==='已保存到本机');if(!await editor.isVisible()){if(!await page.locator('#layer-list').isVisible())await page.locator('[data-rail-tab="layers"]').click();await page.locator('[data-layer="'+first.id+'"]').click();await page.locator('[data-properties-shortcut="toolbar"]').click();}
 assert.equal(await editor.inputValue(),edited);assert.equal(await button.isEnabled(),true);await page.screenshot({path:path.join(proof,'edited-crop-ready.png')});
 await button.evaluate(n=>{n.click();n.click();});await until(()=>calls.length===1).catch(async error=>{await page.screenshot({path:path.join(proof,'generation-failure.png')});fs.writeFileSync(path.join(proof,'generation-failure.json'),JSON.stringify({posts,errors,body:await page.locator('body').innerText()},null,2));throw error;});
 assert.deepEqual(posts.map(p=>p.panelIds),[[first.id]]);assert.equal(calls[0].shot.productionPrompt,edited);assert.equal(calls[0].productionSource.gridId,first.panelSlice.panelId);assert.equal(await button.isDisabled(),true);assert.equal(await button.getAttribute('aria-busy'),'true');
 assert.deepEqual(saved().productionPackage,source);assert.deepEqual(saved().shots.find(s=>s.id===originalShot.id),originalShot);assert.equal(panelProductionShot(saved(),saved().pages.flatMap(p=>p.panels).find(f=>f.id===second.id)).productionPrompt,secondPrompt);assert.equal(saved().pages.flatMap(p=>p.panels).find(f=>f.id===root.id).imageAssetId,asset.id);
 releases.forEach(r=>r());await until(()=>studio.idle());await until(()=>studio.store.db.jobs.some(j=>j.status==='done'));
 assert.notEqual(savedFrame().imageAssetId,asset.id);assert.ok(savedFrame().candidates.includes(asset.id),'旧裁图仍可切回');assert.ok(savedFrame().candidates.includes(savedFrame().imageAssetId));assert.equal(fs.existsSync(oldPath),true);
 await page.waitForFunction(()=>!document.querySelector('#inspector-body [data-action="generate-current-panel"]').disabled);assert.deepEqual(errors,[]);
 fs.writeFileSync(path.join(proof,'acceptance.json'),JSON.stringify({ok:true,existingCropRegeneration:true,manualPromptSavedAndReloaded:true,submittedPromptMatches:true,currentPanelOnly:true,originalSourceUnchanged:true,otherPanelUnchanged:true,duplicatePrevented:true,originalCandidateRetained:true,realAI:false,realProjectWrites:0,errors},null,2));
});
