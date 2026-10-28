import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {syntheticFiles} from './fixtures/production-synthetic.mjs';
import {inspectProductionPackage} from '../lib/production-package.mjs';
import {productionProject} from '../lib/production-package-document.mjs';
import {prepareProductionPanel} from '../public/production-panel-generation.js';
import {hydrateProductionSlices,inheritedSliceReferenceBinding,confirmedSliceReference} from '../public/production-slice-source.js';
import {auditPanelReferences,assertPanelReferenceCoverage} from '../public/panel-reference-audit.js';
import {ensureProjectPanelGeneration,panelProductionShot} from '../public/panel-generation.js';
import {assertCharacterReferences} from '../public/character-state-references.js';
import {createStudio} from '../server.mjs';
import {validateProject} from '../lib/store.mjs';

const key='name:character:角色甲@黑衣';
async function fixture(){
 const files=syntheticFiles().map(file=>{const data=JSON.parse(file.bytes.toString().replaceAll('测试人物','角色甲'));if(data['格'])for(const record of data['格']){record['出现角色']=['角色甲'];record['出现道具']=[];record['提示词']={空泡:'角色甲穿黑衣站在测试庭院，空白气泡。',无泡:'角色甲穿黑衣站在测试庭院，无文字无气泡。'};}
  const bytes=Buffer.from(JSON.stringify(data));return {...file,bytes,sha256:createHash('sha256').update(bytes).digest('hex')};});
 const project=productionProject(await inspectProductionPackage(files),'裁格参考继承合成验收'),segment=project.productionPackage.episodes[0].segments[0],parent=project.pages.flatMap(p=>p.panels).find(f=>f.productionSegment===segment.id);
 const character={id:'asset_'+randomUUID(),name:'角色甲_黑色旅行长衣_生成_test.png',libraryName:'角色甲',libraryRole:'character',libraryState:'黑色旅行长衣 · 生成 · test',library:{assetId:randomUUID(),revisionId:randomUUID(),sha256:'a'.repeat(64)},width:64,height:64,mime:'image/png'},scene={id:'asset_'+randomUUID(),name:'测试庭院.png',libraryName:'测试庭院',libraryRole:'scene',width:64,height:64,mime:'image/png'},assets=[character,scene];
 project.assetLibrary={version:1,assetIds:assets.map(a=>a.id),directories:[],recursive:true};
 segment.references[0].binding={assetId:character.id,revisionId:character.library.revisionId,sha256:character.library.sha256};parent.referenceIds=[character.id];
 parent.referenceNeedBindings={[segment.id+'@0']:{assetId:character.id,name:'角色甲',role:'character',state:'黑衣',revisionId:character.library.revisionId,sha256:character.library.sha256,userSelection:{version:1,selectedAt:'2026-01-01T00:00:00Z'}}};
 const frame=prepareProductionPanel(project,segment.id,'E011-001').panel;
 const need={id:key,name:'角色甲',role:'character',state:'黑衣',hasState:true};
 return {project,segment,parent,frame,character,scene,assets,need};
}
test('切换单格及裁格都继承同人物同服装的人工选图，名称差异不要求重选',async()=>{
 for(const kind of ['productionGrid','panelSlice']){const f=await fixture(),snapshot=JSON.stringify(f.project.productionPackage);
  if(kind==='panelSlice'){f.frame.panelSlice={...f.frame.productionGrid};delete f.frame.productionGrid;}
  assert.equal(hydrateProductionSlices(f.project,f.assets),true);
  const row=auditPanelReferences(f.project,f.frame,f.assets).needs.find(n=>n.role==='character');assert.equal(row.status,'ready');assert.deepEqual(row.selectedIds,[f.character.id]);
  const binding=f.frame.referenceNeedBindings[row.id];assert.deepEqual(binding.userSelection,f.parent.referenceNeedBindings[f.segment.id+'@0'].userSelection);assert.equal(binding.revisionId,f.character.library.revisionId);assert.equal(binding.sha256,f.character.library.sha256);
  assert.equal(JSON.stringify(f.project.productionPackage),snapshot,'源资料与原始服装不能改写');assert.equal(f.character.libraryState,'黑色旅行长衣 · 生成 · test','不能扩大成全局名称别名');
  const saved=JSON.stringify(f.frame);assert.equal(hydrateProductionSlices(f.project,f.assets),false);assert.equal(JSON.stringify(f.frame),saved);
 }
});
test('旧单格已手动选场景时补回人物，并保存可独立复用的固定版本确认',async()=>{
 const f=await fixture();f.frame.referenceIds=[f.scene.id];f.frame.assetReferenceBinding={mode:'manual',managedIds:[]};
 hydrateProductionSlices(f.project,f.assets);assert.deepEqual(f.frame.referenceIds,[f.scene.id,f.character.id]);ensureProjectPanelGeneration(f.project,f.assets);validateProject(f.project);
 assert.equal(assertPanelReferenceCoverage(f.project,f.frame,f.assets).ready,true);assert.doesNotThrow(()=>assertCharacterReferences(f.project,panelProductionShot(f.project,f.frame,f.assets),f.assets,f.frame.referenceIds,f.frame));
 const reopened=JSON.parse(JSON.stringify(f.project)),frame=reopened.pages.flatMap(p=>p.panels).find(p=>p.id===f.frame.id);assert.equal(hydrateProductionSlices(reopened,f.assets),false);assert.equal(auditPanelReferences(reopened,frame,f.assets).needs.find(n=>n.role==='character').status,'ready');
 frame.referenceIds=frame.referenceIds.filter(id=>id!==f.character.id);hydrateProductionSlices(reopened,f.assets);assert.ok(!frame.referenceIds.includes(f.character.id),'之后主动取消选择不会又被迁移补回');
});
test('已有图片但确认记录尚未迁移时，审计仍识别整屏对同一固定版本的确认',async()=>{
 const f=await fixture();hydrateProductionSlices(f.project,f.assets);delete f.frame.referenceNeedBindings;
 assert.equal(auditPanelReferences(f.project,f.frame,f.assets).needs.find(n=>n.role==='character').status,'ready');
});
test('不同人物、衣装或固定版本，以及未确认/过期图片都不能借用父屏确认',async()=>{
 for(const alter of [f=>f.need.name='角色乙',f=>f.need.state='白衣',f=>f.character.library.revisionId=randomUUID(),f=>f.character.library.sha256='b'.repeat(64),f=>f.character.productionStatus='candidate',f=>f.character.productionStatus='stale',f=>delete f.parent.referenceNeedBindings,f=>f.parent.referenceIds=[],f=>f.segment.references[0].skipped=true,f=>f.segment.references[0].binding.revisionId=randomUUID()]){
  const f=await fixture();alter(f);assert.equal(inheritedSliceReferenceBinding(f.project,f.frame,f.need,f.character),null);assert.equal(confirmedSliceReference(f.project,f.frame,f.need,f.character),false);
 }
});
test('单格自行选图、删除记录和文字资产描述保持优先，不覆盖用户选择',async()=>{
 for(const mode of ['binding','selected','removed','text']){const f=await fixture(),alternate={...structuredClone(f.character),id:'asset_'+randomUUID()};f.assets.push(alternate);f.frame.assetReferenceBinding={mode:'manual',managedIds:[]};
  if(mode==='binding')f.frame.referenceNeedBindings={[key]:{assetId:alternate.id,name:'角色甲',role:'character',state:'黑衣'}};
  if(mode==='selected')f.frame.referenceIds=[alternate.id];
  if(mode==='removed')f.project.assetWorkspaceTrash=[{activeTargets:[{panelId:f.frame.id,needId:key,assetIds:[f.character.id]}]}];
  if(mode==='text')f.frame.referenceTextBindings={[key]:{version:1,mode:'text',role:'character',name:'角色甲',state:'黑衣',description:'手动文字设定',imageIds:[f.character.id]}};
  const choice=JSON.stringify({ids:f.frame.referenceIds,bindings:f.frame.referenceNeedBindings,text:f.frame.referenceTextBindings});hydrateProductionSlices(f.project,f.assets);
  assert.equal(JSON.stringify({ids:f.frame.referenceIds,bindings:f.frame.referenceNeedBindings,text:f.frame.referenceTextBindings}),choice,mode);
 }
});
test('旧版手动服装确认同样可以继承，确认仅适用于原图片状态',async()=>{
 const f=await fixture(),b=f.parent.referenceNeedBindings[f.segment.id+'@0'];delete b.userSelection;b.manualStateConfirmation={version:1,selectedState:f.character.libraryState};
 assert.ok(inheritedSliceReferenceBinding(f.project,f.frame,f.need,f.character));f.character.libraryState='百户官服';assert.equal(inheritedSliceReferenceBinding(f.project,f.frame,f.need,f.character),null);
});
test('实际服务保存重开后参考完整，浏览器核对无缺图，假通道收到同一图片版本',{timeout:60000},async t=>{
 const f=await fixture(),dir=fs.mkdtempSync(path.join(process.env.QUALITY_RUN_DIR,'inheritance-')),require=createRequire(import.meta.url),{createCanvas}=require(process.env.COMIC_TEST_CANVAS_MODULE),{chromium}=require('playwright'),canvas=createCanvas(64,64);canvas.getContext('2d').fillRect(0,0,64,64);const bytes=canvas.toBuffer('image/png');
 for(const asset of f.assets){asset.filePath=path.join(dir,asset.id+'.png');fs.writeFileSync(asset.filePath,bytes);asset.extension='.png';asset.library&&(asset.library.sha256=createHash('sha256').update(bytes).digest('hex'));}
 f.segment.references[0].binding.sha256=f.character.library.sha256;f.parent.referenceNeedBindings[f.segment.id+'@0'].sha256=f.character.library.sha256;
 f.frame.referenceIds=[f.scene.id];f.frame.assetReferenceBinding={mode:'manual',managedIds:[]};
 const dataDir=path.join(dir,'data');fs.mkdirSync(dataDir);fs.writeFileSync(path.join(dataDir,'studio.json'),JSON.stringify({version:1,projects:[f.project],assets:f.assets,jobs:[],layouts:[]}));
 process.env.COMIC_PROJECT_SYNC='0';process.env.PROJECT_CENTER_URL='';process.env.COMIC_SLOT_DIR=path.join(dir,'slots');process.env.COMIC_LIBRARY_CONFIG=path.join(dir,'missing-moku.json');const calls=[];
 const studio=createStudio({dataDir,seedReference:false,bridge:{close(){},ensurePoolSize(){},status:async()=>({connected:true,sessionReady:true,installed:true,imageFeature:true}),generate:async(_dir,input)=>{calls.push(input);return {bytes,imageToolSeen:true};}},jimengBridge:{close(){},status:async()=>({connected:false})}});await new Promise(r=>studio.server.listen(0,'127.0.0.1',r));t.after(()=>{studio.close();studio.server.closeAllConnections();});
 const origin='http://127.0.0.1:'+studio.server.address().port,current=()=>studio.store.project(f.project.id),frame=()=>current().pages.flatMap(p=>p.panels).find(p=>p.id===f.frame.id);
 assert.equal(auditPanelReferences(current(),frame(),f.assets).ready,true);assert.ok(fs.readdirSync(path.join(dataDir,'backups/screen-boards')).length,'迁移前保留原工程备份');
 const browser=await chromium.launch({channel:'msedge',headless:true});t.after(()=>browser.close());const view=await browser.newPage({viewport:{width:1600,height:1000}});await view.route('**/api/library/**',route=>route.fulfill({json:{connected:false,items:[]}}));
 await view.goto(origin+'/?project='+f.project.id);await view.waitForSelector('#canvas-tool-dock');await view.locator('[data-rail-tab=layers]').click();await view.locator('[data-layer="'+f.frame.id+'"]').click();await view.locator('[data-properties-shortcut="toolbar"]').click();await view.locator('[data-panel-inspector-tab="references"]').click();
 const row=view.locator('[data-panel-reference="'+f.character.id+'"]');await row.waitFor();assert.match(await row.innerText(),/角色甲/);assert.equal(auditPanelReferences(current(),frame(),f.assets).ready,true);await view.screenshot({path:path.join(dir,'inherited-character-reference.png')});
 const response=await fetch(origin+'/api/jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({projectId:f.project.id,panelIds:[f.frame.id],provider:'codex',expectedRevision:current().revision})}),result=await response.json();assert.equal(response.status,202,JSON.stringify(result));
 for(let i=0;i<200&&!calls.length;i++)await new Promise(r=>setTimeout(r,25));assert.equal(calls.length,1);assert.ok(calls[0].referenceRoles.some(r=>r.assetId===f.character.id));
 for(let i=0;i<240&&!['done','failed'].includes(studio.store.db.jobs.at(-1)?.status);i++)await new Promise(r=>setTimeout(r,25));assert.equal(studio.store.db.jobs.at(-1)?.status,'done',studio.store.db.jobs.at(-1)?.message);assert.equal(frame().imageAssetId,studio.store.db.jobs.at(-1).assetId);
 assert.equal(frame().referenceNeedBindings[key].revisionId,f.character.library.revisionId);assert.equal(frame().referenceNeedBindings[key].sha256,f.character.library.sha256);
});
