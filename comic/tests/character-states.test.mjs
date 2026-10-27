import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createProject,panel,id} from '../public/model.js';
import {createStudio} from '../server.mjs';
import {parseNamedStates,inspectCharacterStates,withStatePrompt} from '../public/character-states.js';
import {characterReferenceIssues,assertCharacterReferences,stateReferenceMetadata} from '../public/character-state-references.js';
import {automaticAssetBindingChoices,planAssetBindings} from '../public/asset-auto-bind.js';
import {ensurePanelGeneration,panelContentKey,panelProductionShot} from '../public/panel-generation.js';
import {effectiveShotDescription} from '../public/shot-settings.js';


import {writeXlsx,readXlsx} from '../lib/xlsx.mjs';



const root=fileURLToPath(new URL('../',import.meta.url));

const assets=[{id:'C001',name:'阿青',type:'角色',aliases:['小青'],visual:'少年',note:'',states:['白衣','黑衣']},{id:'S001',name:'小院',type:'场景',aliases:[],visual:'',note:''}];

function fixture(){const p=createProject('合成服装参考');p.shots=['白衣','黑衣'].map((state,i)=>({id:id('shot'),code:'E001-00'+(i+1),title:'格'+(i+1),description:'阿青站在院里',dialogue:'',referenceIds:[],participants:['阿青'],characterStates:'阿青:'+state}));p.pages[0].panels=p.shots.map((s,i)=>({...panel(s.id),x:50,y:100+i*600,w:500,h:450,assetReferenceBinding:{mode:'auto',managedIds:[]}}));const images=['白衣','黑衣'].map(state=>({id:id('asset'),name:'CHAR_001_阿青_'+state+'.png',libraryRole:'character',libraryName:'阿青',libraryState:state,filePath:'D:/synthetic-tests/'+state+'.png',width:100,height:100}));return {p,images};}





test('auto binding selects each shot costume separately, rejects wrong manual/saved variants and preserves unknowns',()=>{
 const {p,images}=fixture(),choices=automaticAssetBindingChoices(p,images).choices,result=planAssetBindings(p,images,{choices});
 assert.deepEqual(result.project.shots.map(shot=>shot.referenceIds),images.map(image=>[image.id]));assert.deepEqual(result.project.pages[0].panels.map(frame=>frame.referenceIds),images.map(image=>[image.id]));assert.deepEqual(p.shots.map(shot=>shot.referenceIds),[[],[]]);
 const black=automaticAssetBindingChoices(p,images).preview.needs.find(need=>need.state==='黑衣');assert.throws(()=>planAssetBindings(p,images,{choices:{[black.id]:images[0].id}}),/需要“黑衣”/);
 const previous=structuredClone(p);previous.assetBindings={[black.id]:{assetId:images[0].id,role:'character',names:['阿青'],state:'白衣',source:'manual'}};assert.equal(automaticAssetBindingChoices(previous,images).preview.needs.find(need=>need.state==='黑衣').assetId,images[1].id);
 const skipped=planAssetBindings(previous,images,{choices:{[black.id]:null}});assert.deepEqual(skipped.project.shots[1].referenceIds,[]);
 previous.shots[0].characterStates='阿青:未知（待确认）';assert.equal(automaticAssetBindingChoices(previous,images).preview.needs.find(need=>need.state.includes('未知')).assetId,null);
});
test('per-panel costume override binds its own reference without modifying source/other panels or locked manual choices',()=>{
 const {p,images}=fixture();ensurePanelGeneration(p,p.pages[0].panels[0],images);p.pages[0].panels[0].generation.characterStates='阿青:黑衣';const before=structuredClone(p),result=planAssetBindings(p,images,{choices:automaticAssetBindingChoices(p,images).choices});
 assert.deepEqual(result.project.pages[0].panels[0].referenceIds,[images[1].id]);assert.equal(result.project.shots[0].characterStates,'阿青:白衣');assert.deepEqual(result.project.pages[0].panels[1].referenceIds,[images[1].id]);assert.deepEqual(p,before);
 p.pages[0].panels[0].assetReferenceBinding={mode:'manual',managedIds:[]};p.pages[0].panels[0].referenceIds=[images[0].id];p.pages[0].panels[1].locked=true;const guarded=planAssetBindings(p,images,{choices:automaticAssetBindingChoices(p,images).choices});assert.deepEqual(guarded.project.pages[0].panels[0].referenceIds,[images[0].id]);assert.deepEqual(guarded.project.pages[0].panels[1],p.pages[0].panels[1]);
});
test('independent state edit changes actual provider prompt and stale-result key; conflicts are rejected before image generation',()=>{
 const {p,images}=fixture(),frame=p.pages[0].panels[0];ensurePanelGeneration(p,frame,images);const initial=panelContentKey(p,frame,images);frame.generation.characterStates='阿青:黑衣';
 assert.notEqual(panelContentKey(p,frame,images),initial);const shot=panelProductionShot(p,frame,images);assert.match(effectiveShotDescription(shot),/人物状态：阿青:黑衣/);assert.equal(p.shots[0].characterStates,'阿青:白衣');
 assert.throws(()=>assertCharacterReferences(p,shot,images,[images[0].id]),error=>error.status===409&&error.code==='character_state_reference_conflict');assert.doesNotThrow(()=>assertCharacterReferences(p,shot,images,[images[1].id]));assert.ok(characterReferenceIssues(p,shot,images,[]).some(issue=>issue.kind==='STATE_REFERENCE_MISSING'));
 assert.ok(!withStatePrompt('人物状态：阿青:白衣\n动作：站立。',shot).includes('阿青:白衣'));
});
test('confirmed named costume card exposes its label and actual outfit, not generic role-card label',()=>{
 const image={id:id('asset'),name:'generic.png'},p={references:[],productionAssets:[{id:'C001',name:'阿青',type:'character',aliases:['小青'],workflow:{outfitDescription:'灰衣'},stages:[{id:'role-card-1',label:'夜行服',outfitDescription:'黑色夜行便服',status:'confirmed',confirmedAssetId:image.id}]}]};
 const meta=stateReferenceMetadata(p,image);assert.equal(meta.state,'黑色夜行便服');assert.ok(meta.stateLabels.includes('夜行服'));assert.equal(meta.name,'阿青');
});

test('API rejects conflicting costume reference atomically without contacting AI channels',async t=>{
 const directory=fs.mkdtempSync(path.join(root,'.runtime/temp/character-state-api-')),fake={status:async()=>({connected:true,installed:true}),models:async()=>({items:[]}),close(){},generate(){throw Error('No real generation allowed');}},studio=createStudio({dataDir:path.join(directory,'data'),bridge:fake,jimengBridge:fake,storyboardGenerator:{close(){},generate(){throw Error('No real AI allowed');}}}),{p,images}=fixture();
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64');for(const image of images){image.filePath=path.join(directory,image.id+'.png');fs.writeFileSync(image.filePath,png);}const frame=p.pages[0].panels[0];ensurePanelGeneration(p,frame,images);frame.generation.characterStates='阿青:黑衣';frame.referenceIds=[images[0].id];frame.generation.referenceRoles=[{assetId:images[0].id,name:'阿青',role:'character'}];studio.store.db.projects=[p];studio.store.db.assets=images;studio.store.save();await new Promise(resolve=>studio.server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{studio.close();await new Promise(resolve=>studio.server.close(resolve));fs.rmSync(directory,{recursive:true,force:true,maxRetries:5,retryDelay:100});});
 const response=await fetch('http://127.0.0.1:'+studio.server.address().port+'/api/jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({projectId:p.id,panelIds:[frame.id],provider:'codex',expectedRevision:p.revision})});
 const result=await response.json();assert.equal(response.status,409,JSON.stringify(result));assert.match(result.error,/黑衣/);assert.equal(studio.store.db.jobs.length,0);
});
