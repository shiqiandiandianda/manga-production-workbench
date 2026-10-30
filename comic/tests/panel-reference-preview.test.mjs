import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {createProject,clone} from '../public/model.js';import {migrateLayerDocument} from '../public/layers.js';
import {panelReferencePreview} from '../public/panel-reference-preview-model.js';import {auditPanelReferences} from '../public/panel-reference-audit.js';
import {syntheticFiles} from './fixtures/production-synthetic.mjs';import {inspectProductionPackage} from '../lib/production-package.mjs';import {productionProject} from '../lib/production-package-document.mjs';
import {prepareProductionPanel} from '../public/production-panel-generation.js';import {ensureProjectPanelGeneration} from '../public/panel-generation.js';
const image=(name,role,state='')=>({id:'asset_'+randomUUID(),name:[name,state].filter(Boolean).join('__')+'.png',libraryName:name,libraryRole:role,libraryState:state,productionStatus:'confirmed',library:{assetId:randomUUID(),revisionId:randomUUID(),sha256:'a'.repeat(64)}});
function ordinary(){const p=migrateLayerDocument(createProject('只读参考图')).project,f=p.pages[0].panels[0];p.references=[];p.shots=[p.shots[0]];p.pages=[p.pages[0]];p.pages[0].panels=[f];Object.assign(p.shots[0],{participants:'宋玄',characterStates:'宋玄:黑衣',location:'书房'});f.referenceIds=[];delete f.generation;return {p,f};}
test('preview uses only the selected frame fixed references, retains outfit and skips unrelated project assets, props and styles',()=>{
 const {p,f}=ordinary(),a=image('宋玄','character','黑衣'),white=image('宋玄','character','白衣'),scene=image('书房','scene'),prop=image('折子','prop'),style=image('画风','style'),assets=[a,white,scene,prop,style];p.references=assets.map(x=>({assetId:x.id,name:x.libraryName,role:x.libraryRole}));p.assetLibrary={assetIds:assets.map(a=>a.id)};f.referenceIds=[a.id,scene.id,prop.id,style.id];
 const before=JSON.stringify({p,assets}),result=panelReferencePreview(p,f,assets);assert.deepEqual(result.map(i=>i.assetId),[a.id,scene.id]);assert.equal(result[0].state,'黑衣');assert.equal(result[0].revisionId,a.library.revisionId);assert.equal(JSON.stringify({p,assets}),before);
});
test('unadopted recommendations and text-only references do not appear as adopted image previews',()=>{
 const {p,f}=ordinary(),a=image('宋玄','character','黑衣');p.assetLibrary={assetIds:[a.id]};assert.equal(panelReferencePreview(p,f,[a]).length,0);
 f.referenceIds=[a.id];const need=auditPanelReferences(p,f,[a]).needs.find(n=>n.role==='character');assert.ok(need);f.referenceTextBindings={[need.id]:{version:1,mode:'text',role:'character',name:need.name,state:need.state,description:'按文字绘制',imageIds:[a.id]}};
 assert.equal(panelReferencePreview(p,f,[a]).length,0);assert.deepEqual(panelReferencePreview(p,null,[a]),[]);
});
test('screen preview follows its source bindings even with a stale frame list and other missing required references',async()=>{
 const p=productionProject(await inspectProductionPackage(syntheticFiles())),s=p.productionPackage.episodes[0].segments[0],f=p.pages.flatMap(p=>p.panels).find(f=>f.productionSegment===s.id),a=image('测试人物','character','黑衣'),wrong=image('其他人物','character','白衣'),scene=image('测试庭院','scene');
 s.references[0].binding={...a.library,assetId:a.id};s.references.push({slot:'scene','类型':'场景图','名称':'测试庭院','必须':true,binding:{...scene.library,assetId:scene.id}},{slot:'missing','类型':'设定卡','人物':'尚未采用的人物','必须':true});f.referenceIds=[wrong.id];
 const before=JSON.stringify(p),items=panelReferencePreview(p,f,[a,wrong,scene]);assert.deepEqual(items.map(i=>i.assetId),[a.id,scene.id]);assert.equal(JSON.stringify(p),before);s.references[0].skipped=true;assert.ok(!panelReferencePreview(p,f,[a,wrong,scene]).some(i=>i.assetId===a.id),'skipped source slots stay excluded even with a preserved binding');
});
test('single production grid previews its own adopted outfit rather than its parent screen outfit',async()=>{
 const p=productionProject(await inspectProductionPackage(syntheticFiles())),s=p.productionPackage.episodes[0].segments[0],black=image('测试人物','character','黑衣'),white=image('测试人物','character','白衣');s.references[0].binding={...black.library,assetId:black.id};
 ensureProjectPanelGeneration(p,[black,white]);const record=p.productionPackage.episodes[0].panelRecords.find(r=>r.segmentId===s.id);record.original['服装']={'测试人物':'白衣'};const {panel:f}=prepareProductionPanel(p,s.id,record.id);f.referenceIds=[white.id];f.generation.referenceRoles=[{assetId:white.id,role:'character',name:'测试人物'}];
 const result=panelReferencePreview(p,f,[black,white]);assert.deepEqual(result.map(r=>r.assetId),[white.id]);assert.equal(result[0].state,'白衣');
});
