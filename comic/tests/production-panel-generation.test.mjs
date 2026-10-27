import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {syntheticFiles} from './fixtures/production-synthetic.mjs';
import {createStudio} from '../server.mjs';
import {productionFrame} from '../public/production-package-model.js';
import {productionPanelPrompts,productionPanelDataIssues} from '../public/production-panel-prompts.js';
import {findProductionPanel,productionPanelRegion} from '../public/production-panel-generation.js';
import {generationPromptChoices} from '../public/prompt-source.js';
import {panelProductionShot,ensureProjectPanelGeneration} from '../public/panel-generation.js';
import {auditPanelReferences} from '../public/panel-reference-audit.js';
import {validateProject} from '../lib/store.mjs';
import {buildImagePrompt} from '../lib/codex.mjs';
import {buildJimengPrompt} from '../lib/jimeng.mjs';
import {inspectProductionPackage} from '../lib/production-package.mjs';
import {mergeProductionProject} from '../lib/production-package-document.mjs';
import {remapProductionPackage} from '../lib/production-package-portable.mjs';
import {panel} from '../public/model.js';

const require=createRequire(import.meta.url),{createCanvas}=require(process.env.COMIC_TEST_CANVAS_MODULE);
const {chromium}=require('C:/Users/EDY/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const evidence=fileURLToPath(new URL('../../verification/single-panel-generation-20261022/',import.meta.url));
fs.mkdirSync(evidence,{recursive:true});
const empty='空泡单镜头原文\n甲在庭院持木剑。只画这一格；画空白对白泡，不画文字。';
const clean='无泡单镜头原文\n甲在庭院持木剑。只画这一格；不要文字、气泡与拟声字。';
function sourceFiles(){
 const originals=syntheticFiles(),board=JSON.parse(originals[0].bytes),pkg=JSON.parse(originals[1].bytes),base=board['格'][0];
 board['格']=[
  {...base,'出现角色':['甲'],'出现道具':['木剑'],'服装':{甲:'黑衣'},'提示词':{空泡:empty,无泡:clean}},
  {...base,'出现角色':['乙'],'出现道具':[],'服装':{乙:'白衣'},'当前场景':'书房','生图提示词（空泡）':'乙在书房，空泡原文','生图提示词（无泡）':'乙在书房，无泡原文'},
  {...base,'出现角色':['甲'],'出现道具':[],'服装':{甲:'黑衣'},'生图提示词':'旧无泡原文，不要出现任何文字、对白气泡和拟声字。'},
  {...base,'出现角色':['乙'],'出现道具':[],'服装':{乙:'白衣'},'生图提示词':''}
 ];
 pkg['屏段'][0]['格']=[1,2].map((n,i)=>({'格ID':'E011-00'+n,'格号':n,'排':i+1,'排内':'整排'}));
 pkg['屏段'][1]['格']=[3,4].map((n,i)=>({'格ID':'E011-00'+n,'格号':n,'排':1,'排内':i?'右':'左'}));
 pkg['屏段'][0]['格数']=pkg['屏段'][1]['格数']=2;
 for(const segment of pkg['屏段'])segment['附图']=[{类型:'设定卡',人物:'甲',服装:'黑衣',必须:true},{类型:'设定卡',人物:'乙',服装:'白衣',必须:true}];
 pkg['文字']=pkg['文字'].filter(t=>t['渲染']==='工具').map((t,i)=>({...t,'段ID':'段01','说话人':i?'乙':'甲'}));
 return [board,pkg].map((data,i)=>({relativePath:originals[i].relativePath,bytes:Buffer.from(JSON.stringify(data))}));
}
async function fixture(t){
 const dir=fs.mkdtempSync(path.join(evidence,'fixture-')),calls=[];
 const studio=createStudio({dataDir:path.join(dir,'data'),seedReference:false,bridge:{close(){},ensurePoolSize(){},status:async()=>({connected:true,sessionReady:true,imageFeature:true,installed:true}),async generate(_d,input){calls.push(structuredClone(input));const canvas=createCanvas(Math.round(input.panel.w),Math.round(input.panel.h));canvas.getContext('2d').fillRect(0,0,canvas.width,canvas.height);return {bytes:canvas.toBuffer('image/png'),imageToolSeen:true};}},jimengBridge:{close(){},status:async()=>({connected:false})}});
 await new Promise(resolve=>studio.server.listen(0,'127.0.0.1',resolve));t.after(()=>{studio.close();studio.server.closeAllConnections();});
 const origin='http://127.0.0.1:'+studio.server.address().port;
 const request=async(route,body)=>{const response=await fetch(origin+route,body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:undefined);return {status:response.status,body:await response.json()};};
 const api=async(route,body)=>{const result=await request(route,body);assert.ok(result.status<300,JSON.stringify(result.body));return result.body;};
 const scan=await api('/api/production-packages/scan',{files:sourceFiles().map(f=>({relativePath:f.relativePath,dataBase64:f.bytes.toString('base64')}))}),project=await api('/api/production-packages/import',{scanId:scan.scanId});
 const canvas=createCanvas(128,128);canvas.getContext('2d').fillRect(0,0,128,128);const bytes=canvas.toBuffer('image/png'),assets=[];
 for(const [name,role,state] of [['甲','character','黑衣'],['乙','character','白衣'],['测试庭院','scene',''],['书房','scene',''],['木剑','prop','']]){
  const file=path.join(dir,name+'.png');fs.writeFileSync(file,bytes);const imported=await api('/api/assets',{filePath:file,name:name+(state?'_'+state:'')+'.png'}),asset=studio.store.asset(imported.id);Object.assign(asset,{libraryName:name,libraryRole:role,libraryState:state});assets.push(asset);
 }
 const current=studio.store.project(project.id);current.assetLibrary={version:1,assetIds:assets.map(a=>a.id),directories:[],recursive:true};studio.store.save();
 const action=(name,input={})=>api('/api/projects/'+project.id+'/production/'+name,{expectedRevision:studio.store.project(project.id).revision,segmentId:'E011-S001',...input});
 return {dir,origin,studio,calls,assets,api,request,action,get project(){return studio.store.project(project.id);}};
}
async function until(predicate){for(let i=0;i<240;i++){if(predicate())return;await new Promise(resolve=>setTimeout(resolve,25));}throw Error('合成任务未在限时内完成');}

test('本屏全部单格一次准备与提交，逐格保留原文、参考和回填；缺项整批拒绝且不改工程',{timeout:30000},async t=>{
 const f=await fixture(t),original=structuredClone(productionFrame(f.project,'E011-S001'));
 const prepared=await f.action('panels',{mode:'clean'});assert.deepEqual(prepared.gridIds,['E011-001','E011-002']);assert.equal(prepared.panelIds.length,2);
 await f.api('/api/jobs',{projectId:f.project.id,panelIds:prepared.panelIds,provider:'codex',expectedRevision:f.project.revision});await until(()=>f.studio.store.db.jobs.length===2&&f.studio.store.db.jobs.every(j=>j.status==='done'));
 assert.deepEqual(new Set(f.calls.map(c=>c.shot.productionPrompt)),new Set([clean,'乙在书房，无泡原文']));
 for(const [i,gridId]of prepared.gridIds.entries()){const frame=findProductionPanel(f.project,'E011-S001',gridId),job=f.studio.store.db.jobs.find(j=>j.panelId===frame.id);assert.equal(frame.imageAssetId,job.assetId);assert.equal(frame.id,prepared.panelIds[i]);assert.equal(frame.generation.promptSource,'post-lettering');const refs=f.calls.find(c=>c.shot.productionPrompt===(i?'乙在书房，无泡原文':clean)).referenceRoles.map(r=>r.assetId);assert.ok(refs.includes(f.assets[i].id));assert.ok(!refs.includes(f.assets[1-i].id));}
 assert.deepEqual(productionFrame(f.project,'E011-S001'),original);assert.equal(findProductionPanel(f.project,'E011-S002','E011-003'),undefined);
 const first=findProductionPanel(f.project,'E011-S001','E011-001');first.x=57;first.w=695;f.studio.store.save();await f.action('panels',{mode:'empty'});assert.equal(findProductionPanel(f.project,'E011-S001','E011-001').x,57);assert.equal(findProductionPanel(f.project,'E011-S001','E011-001').w,695);
 const before=JSON.stringify(f.project),rejected=await f.request('/api/projects/'+f.project.id+'/production/panels',{expectedRevision:f.project.revision,segmentId:'E011-S002',mode:'empty'});assert.equal(rejected.status,400);assert.match(rejected.body.error,/E011-003：缺少空泡提示词/);assert.match(rejected.body.error,/E011-004：缺少空泡提示词/);assert.equal(JSON.stringify(f.project),before);assert.equal(f.studio.store.db.jobs.length,2);
});

test('浏览器点击一次生成本屏全部单格，两格各自显示成图，其他屏段不生成',{timeout:60000},async t=>{
 const f=await fixture(t),browser=await chromium.launch({channel:'msedge',headless:true});t.after(()=>browser.close());const context=await browser.newContext({viewport:{width:1864,height:949}});await context.addInitScript(()=>localStorage.setItem('comic-generation-provider','codex'));await context.route('**/api/library/**',route=>route.fulfill({json:{connected:false,items:[]}}));const view=await context.newPage(),errors=[];view.on('pageerror',e=>errors.push(e.message));await view.goto(f.origin+'/?project='+f.project.id);if(!await view.locator('#canvas-tool-dock').isVisible())await view.getByRole('button',{name:'常用工具',exact:true}).click();await view.waitForSelector('#canvas-tool-dock');if(!await view.locator('[data-production-unit]').isVisible())await view.locator('[data-rail-tab=production]').click();await view.locator('[data-production-unit]').selectOption('panel');await view.waitForFunction(()=>document.querySelector('[data-production-generate]')?.textContent.includes('全部单格'));assert.equal(f.calls.length,0);assert.equal(f.project.pages.flatMap(p=>p.panels).filter(f=>f.productionGrid).length,2);await view.locator('[data-production-generate]').click();await until(()=>f.studio.store.db.jobs.length===2&&f.studio.store.db.jobs.every(j=>j.status==='done'));for(const gridId of ['E011-001','E011-002']){const frame=findProductionPanel(f.project,'E011-S001',gridId);await view.locator('[data-production-grid]').selectOption(gridId);await view.waitForFunction(({id,asset})=>[...document.querySelectorAll('[data-panel="'+id+'"] image')].some(i=>(i.getAttribute('href')||'').includes(asset)),{id:frame.id,asset:frame.imageAssetId},{timeout:5000}).catch(async error=>{fs.writeFileSync(path.join(evidence,'batch-ui-debug.json'),JSON.stringify({gridId,frame,panels:await view.locator('[data-panel]').evaluateAll(nodes=>nodes.map(n=>({id:n.dataset.panel,images:[...n.querySelectorAll('image')].map(i=>i.getAttribute('href'))}))),errors},null,2));await view.screenshot({path:path.join(evidence,'batch-ui-debug.png')});throw error;});}assert.equal(f.calls.length,2);assert.ok(f.calls.every(c=>c.shot.productionPrompt.includes('无泡')));assert.equal(findProductionPanel(f.project,'E011-S002','E011-003'),undefined);assert.deepEqual(errors,[]);await view.screenshot({path:path.join(evidence,'screen-all-single-panels.png')});
});

test('单格两套原文独立读取；旧无泡原文可用，缺空泡不得借用或改写',()=>{
 const p=productionPanelPrompts({original:{提示词:{空泡:empty,无泡:clean}}});assert.equal(p.empty.text,empty);assert.equal(p.clean.text,clean);
 const legacy=productionPanelPrompts({original:{生图提示词:'不要出现任何文字、对白气泡和拟声字。'}});assert.equal(legacy.empty.text,'');assert.ok(legacy.clean.text);
 const xlsx=productionPanelPrompts({production:{'生图提示词（空泡）':empty,'生图提示词（后期嵌字）':clean}});assert.equal(xlsx.empty.text,empty);assert.equal(xlsx.clean.text,clean);
 assert.equal(productionPanelPrompts({original:{生图提示词:'未标注泡型的旧原文'}}).empty.text,'');
 assert.ok(productionPanelDataIssues({original:{出现角色:['甲'],服装:{乙:'白衣'},当前场景:'庭院',出现道具:[]}}).includes('人物服装未对应：甲'));
});

test('分镜JSON显式格ID允许行序调整，提示词和原件指针仍按同一源格对应',async()=>{
 const files=sourceFiles(),board=JSON.parse(files[0].bytes);board['格'].forEach((r,i)=>r['格ID']='E011-00'+(i+1));board['格'].reverse();files[0].bytes=Buffer.from(JSON.stringify(board));const inspected=await inspectProductionPackage(files),record=inspected.episodes[0].panelRecords.find(r=>r.id==='E011-001');assert.equal(productionPanelPrompts(record).empty.text,empty);assert.equal(record.source.pointer,'/格/3');
});

test('无整屏成图也可生成单格：人物、服装、场景、道具只取本格；两模式传参及来源校验',{timeout:30000},async t=>{
 const f=await fixture(t),original=structuredClone(productionFrame(f.project,'E011-S001'));
 await f.action('unit',{unit:'panel'});const result=await f.action('panel',{gridId:'E011-001'}),frame=findProductionPanel(f.project,'E011-S001','E011-001');
 assert.equal(result.panelId,frame.id);assert.equal(frame.imageAssetId,null);assert.equal(frame.productionGrid.panelId,'E011-001');assert.equal(f.project.shots.find(s=>s.id===frame.shotId).productionPromptVariants,1);
 assert.ok(auditPanelReferences(f.project,frame,f.assets).ready);assert.deepEqual(new Set(frame.referenceIds),new Set([f.assets[0].id,f.assets[2].id,f.assets[4].id]));assert.ok(!frame.referenceIds.includes(f.assets[1].id));
 for(const [mode,text] of [['empty',empty],['clean',clean]]){
  await f.action('mode',{gridId:'E011-001',mode});const target=findProductionPanel(f.project,'E011-S001','E011-001');assert.equal(panelProductionShot(f.project,target,f.assets).description,text);
  await f.api('/api/jobs',{projectId:f.project.id,panelIds:[frame.id],provider:'codex',action:'generate'});await until(()=>f.studio.store.db.jobs.at(-1)?.status==='done');
  assert.equal(f.calls.at(-1).shot.productionPrompt,text);for(const build of [buildImagePrompt,buildJimengPrompt])assert.ok(build(f.calls.at(-1)).includes(text));
  const job=f.studio.store.db.jobs.at(-1),provenance=JSON.parse(fs.readFileSync(path.join(f.dir,'data/jobs',job.id,'production-source.json')));assert.equal(provenance.gridId,'E011-001');assert.equal(provenance.originalPrompt,text);assert.equal(provenance.referenceOrder.length,3);assert.equal(findProductionPanel(f.project,'E011-S001','E011-001').imageAssetId,job.assetId);
 }
 for(const key of ['imageAssetId','imageTransform','x','y','w','h'])assert.deepEqual(productionFrame(f.project,'E011-S001')[key],original[key],'不得改变整屏图片和几何');
 const before=JSON.stringify(f.project),bad=await f.request('/api/projects/'+f.project.id+'/production/panel',{expectedRevision:f.project.revision,segmentId:'E011-S001',gridId:'E011-003'});assert.equal(bad.status,400);assert.equal(JSON.stringify(f.project),before);
 const altered=structuredClone(f.project);findProductionPanel(altered,'E011-S001','E011-001').productionGrid.panelId='E011-003';assert.throws(()=>validateProject(altered),/来源关联/);
 const region=productionPanelRegion(f.project,'E011-S002','E011-004');assert.ok(region.region.x>.4&&region.region.w<.5);
 f.project.productionPackage.episodes[0].panelRecords.find(r=>r.id==='E011-004').original['目标宽高比']='16:9';const sized=productionPanelRegion(f.project,'E011-S002','E011-004'),root=productionFrame(f.project,'E011-S002');assert.ok(Math.abs(sized.region.w*root.w/(sized.region.h*root.h)-16/9)<1e-8);assert.equal(sized.from,'storyboard-aspect');
});

test('本格排字仅加入对应台词：空泡仅文字、无泡可编辑框；重复加入保留人工位置',{timeout:30000},async t=>{
 const f=await fixture(t);await f.action('mode',{gridId:'E011-001',mode:'empty'});await f.action('panel',{gridId:'E011-001'});const first=findProductionPanel(f.project,'E011-S001','E011-001');first.imageAssetId=f.assets[0].id;f.studio.store.save();
 const added=await f.action('panel-lettering',{gridId:'E011-001',confirmed:true});assert.equal(added.created,1);const bubble=f.project.pages.flatMap(p=>p.bubbles).find(b=>b.productionGridId==='E011-001');assert.equal(bubble.text,'测试台词1');assert.equal(bubble.speaker,'甲');assert.equal(bubble.shape,'none');assert.equal(bubble.parentPanelId,first.id);
 bubble.x=87;bubble.y=193;bubble.locked=true;const manual=structuredClone(bubble);f.studio.store.save();const again=await f.action('panel-lettering',{gridId:'E011-001',confirmed:true});assert.equal(again.created,0);assert.equal(again.skipped,1);assert.deepEqual(f.project.pages.flatMap(p=>p.bubbles).find(b=>b.id===manual.id),manual);
 await f.action('mode',{gridId:'E011-002',mode:'clean'});await f.action('panel',{gridId:'E011-002'});findProductionPanel(f.project,'E011-S001','E011-002').imageAssetId=f.assets[1].id;f.studio.store.save();await f.action('panel-lettering',{gridId:'E011-002',confirmed:true});const second=f.project.pages.flatMap(p=>p.bubbles).find(b=>b.productionGridId==='E011-002');assert.equal(second.text,'测试台词2');assert.equal(second.shape,'oval');assert.equal(second.fillOpacity,1);
});

test('已有裁格优先复用，父整屏锁定不影响独立单格；缺服装明确拒绝而不提交任务',{timeout:30000},async t=>{
 const f=await fixture(t),root=productionFrame(f.project,'E011-S001'),owner=f.project.pages.find(p=>p.panels.includes(root)),cropped=panel('',44,88,530,672);root.locked=true;
 Object.assign(cropped,{imageAssetId:f.assets[0].id,imageTransform:{x:13,y:17,scale:3},points:[{x:.1,y:0},{x:1,y:.2},{x:.8,y:1},{x:0,y:.8}],panelSlice:{version:1,panelId:'E011-001',segmentId:'E011-S001',rootPanelId:root.id,sourceAssetId:f.assets[0].id,sourceHash:'a'.repeat(64),key:'b'.repeat(64),region:{x:0,y:0,w:1,h:1}}});owner.panels.push(cropped);f.studio.store.save();const before=structuredClone(cropped);
 const result=await f.action('panel',{gridId:'E011-001'}),reused=findProductionPanel(f.project,'E011-S001','E011-001');assert.equal(result.panelId,cropped.id);for(const key of ['x','y','w','h','points','imageAssetId','imageTransform'])assert.deepEqual(reused[key],before[key]);
 delete f.project.productionPackage.episodes[0].panelRecords[0].original['服装']['甲'];f.studio.store.save();const rejected=await f.request('/api/jobs',{projectId:f.project.id,panelIds:[reused.id],provider:'codex'});assert.equal(rejected.status,400);assert.match(rejected.body.error,/人物服装未对应：甲/);assert.equal(f.calls.length,0);
});

test('本格处理中允许准备另一格，禁止改动处理中那一格的提示词，原结果仍能回填',{timeout:30000},async t=>{
 const f=await fixture(t);await f.action('panel',{gridId:'E011-001'});const first=findProductionPanel(f.project,'E011-S001','E011-001'),generate=f.studio.bridge.generate.bind(f.studio.bridge);let release;const gate=new Promise(resolve=>release=resolve);f.studio.bridge.generate=async(...args)=>{await gate;return generate(...args);};
 await f.api('/api/jobs',{projectId:f.project.id,panelIds:[first.id],provider:'codex'});await until(()=>f.studio.store.db.jobs.at(-1)?.status==='running');
 await f.action('unit',{unit:'panel'});const second=await f.action('panel',{gridId:'E011-002'});assert.notEqual(second.panelId,first.id);
 const rejected=await f.request('/api/projects/'+f.project.id+'/production/mode',{expectedRevision:f.project.revision,segmentId:'E011-S001',gridId:'E011-001',mode:'clean'});assert.equal(rejected.status,409);release();await until(()=>f.studio.store.db.jobs.at(-1)?.status==='done');assert.equal(findProductionPanel(f.project,'E011-S001','E011-001').imageAssetId,f.studio.store.db.jobs.at(-1).assetId);
});

test('单格重复准备复用ID和人工几何；源表补双提示词后更新，切换设置及导出映射保留',{timeout:30000},async t=>{
 const f=await fixture(t);await f.action('unit',{unit:'panel'});await f.action('panel',{gridId:'E011-001'});await f.action('mode',{gridId:'E011-001',mode:'clean'});
 const frame=findProductionPanel(f.project,'E011-S001','E011-001');frame.x=30;frame.y=67;frame.w=725;frame.h=814;frame.imageAssetId=f.assets[0].id;frame.imageTransform={x:9,y:12,scale:4};const manual=structuredClone(frame);f.studio.store.save();
 await f.action('panel',{gridId:'E011-001'});assert.deepEqual(findProductionPanel(f.project,'E011-S001','E011-001'),manual);assert.equal(f.project.pages.flatMap(p=>p.panels).filter(p=>p.productionGrid).length,2);
 const updated=sourceFiles(),board=JSON.parse(updated[0].bytes);board['格'][0]['提示词']['无泡']=clean+'\n补充后的原文';updated[0].bytes=Buffer.from(JSON.stringify(board));
 const source=await inspectProductionPackage(updated.map(file=>({...file,sha256:undefined})));const merged=mergeProductionProject(f.project,source);ensureProjectPanelGeneration(merged,f.assets);
 const changed=findProductionPanel(merged,'E011-S001','E011-001');assert.equal(changed.id,manual.id);assert.equal(changed.imageAssetId,manual.imageAssetId);assert.deepEqual(changed.imageTransform,manual.imageTransform);assert.equal(merged.productionEpisodeViews[11].unit,'panel');assert.equal(panelProductionShot(merged,changed,f.assets).description,clean+'\n补充后的原文');
 const clone=structuredClone(merged),root=productionFrame(clone,'E011-S001'),mapped='panel_12345678-1234-1234-1234-123456789abc';remapProductionPackage(clone,new Map(f.assets.map(a=>[a.id,a.id])),new Map([[root.id,mapped]]),new Map());assert.equal(findProductionPanel(clone,'E011-S001','E011-001').productionGrid.rootPanelId,mapped);
});

test('浏览器可切屏段与单格，逐格选择空泡/无泡生成；缺词禁用、刷新保持',{timeout:60000},async t=>{
 const f=await fixture(t),browser=await chromium.launch({channel:'msedge',headless:true});t.after(()=>browser.close());
 const context=await browser.newContext({viewport:{width:1864,height:949}});await context.addInitScript(()=>localStorage.setItem('comic-generation-provider','codex'));
 await context.route('**/api/library/**',route=>route.fulfill({json:{connected:false,items:[]}}));const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(f.origin+'/?project='+f.project.id);await page.waitForFunction(()=>document.querySelector('#save-state')?.textContent.includes('已保存'));
 if(!await page.locator('[data-production-unit]').isVisible())await page.locator('[data-rail-tab="production"]').click();
 await page.locator('[data-production-unit]').selectOption('panel');await page.locator('[data-production-grid]').waitFor();
 await page.waitForFunction(()=>document.querySelector('.panel-active-prompt')?.value.includes('无泡单镜头原文'));const prepared=findProductionPanel(f.project,'E011-S001','E011-001');assert.ok(prepared,'切到单格时立即创建并选中独立画格，不等待点击生成');assert.ok(prepared.h<productionFrame(f.project,'E011-S001').h);assert.equal(f.calls.length,0,'切换模式不得提交生图');
 assert.equal(await page.locator('#stage [data-panel="'+productionFrame(f.project,'E011-S001').id+'"]').count(),0,'单格视图隐藏原整屏框，不修改原件');assert.equal(productionFrame(f.project,'E011-S001').visible,false);assert.equal(productionFrame(f.project,'E011-S001').productionModeVisible,true);
 assert.equal(await page.locator('[data-production-grid] option').count(),2);assert.equal(await page.locator('[data-production-mode]').inputValue(),'post-lettering');await page.waitForTimeout(200);const modeResponse=page.waitForResponse(r=>r.url().endsWith('/production/mode'));await page.locator('[data-production-mode]').selectOption('imported');const changedMode=await modeResponse;assert.ok(changedMode.ok(),await changedMode.text());await page.waitForFunction(()=>document.querySelector('.panel-active-prompt')?.value.includes('空泡单镜头原文'));
 await page.locator('[data-production-generate-one]').click();await until(()=>f.studio.store.db.jobs.at(-1)?.status==='done');assert.equal(f.calls[0].shot.description,empty);
 await page.locator('[data-production-mode]').selectOption('post-lettering');await page.waitForFunction(()=>document.querySelector('[data-production-mode]')?.value==='post-lettering');
 await page.locator('[data-production-generate-one]').click();await until(()=>f.studio.store.db.jobs.length===2&&f.studio.store.db.jobs.at(-1)?.status==='done');assert.equal(f.calls[1].shot.description,clean);
 await page.waitForFunction(({id,asset})=>[...document.querySelectorAll('[data-panel="'+id+'"] image')].some(image=>(image.getAttribute('href')||'').includes(asset)),{id:findProductionPanel(f.project,'E011-S001','E011-001').id,asset:f.studio.store.db.jobs.at(-1).assetId});
 await page.locator('.production-single-prompts>summary').click();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 await page.screenshot({path:path.join(evidence,'single-panel-dual-mode.png')});
 await page.locator('[data-production-unit]').selectOption('screen');await page.waitForFunction(()=>document.querySelector('[data-production-generate]')?.textContent==='生成本屏');assert.equal(await page.locator('[data-production-grid]').count(),0);
 await page.waitForFunction(()=>document.querySelector('.panel-active-prompt-label')?.textContent.includes('屏段'));assert.equal(findProductionPanel(f.project,'E011-S001','E011-001').imageAssetId,f.studio.store.db.jobs.at(-1).assetId,'切回屏段保留单格成图');
 await page.locator('[data-production-segment]').selectOption('E011-S002');await page.locator('[data-production-unit]').selectOption('panel');await page.locator('[data-production-grid]').waitFor();
 assert.equal(await page.locator('[data-production-mode]').inputValue(),'post-lettering');assert.equal(await page.locator('[data-production-mode] option[value="imported"]').evaluate(option=>option.disabled),true);assert.equal(await page.locator('[data-production-generate-one]').isEnabled(),true);
 await page.locator('[data-production-grid]').selectOption('E011-004');assert.equal(await page.locator('[data-production-generate-one]').isDisabled(),true);assert.match(await page.locator('#production-tab').innerText(),/本格尚缺空泡提示词/);
 await page.waitForFunction(()=>document.querySelector('.panel-active-prompt')?.value==='');assert.equal(f.calls.length,2,'缺词时不得借用整屏提示词提交任务');
 await page.screenshot({path:path.join(evidence,'single-panel-missing-prompts.png')});
 await page.reload();if(!await page.locator('#canvas-tool-dock').isVisible())await page.getByRole('button',{name:'常用工具',exact:true}).click();await page.waitForSelector('#canvas-tool-dock');if(!await page.locator('[data-production-unit]').isVisible())await page.locator('[data-rail-tab="production"]').click();
 assert.equal(await page.locator('[data-production-unit]').inputValue(),'panel');assert.deepEqual(errors,[]);
});
