import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject,id} from '../public/model.js';
import {inspectAssetBindings,planAssetBindings,automaticAssetBindingChoices,inspectProductionAssetReferences} from '../public/asset-auto-bind.js';
import {applyAssetProductionAction} from '../lib/asset-production.mjs';

const image=(name,fields={})=>({id:id('asset'),name,filePath:'D:/synthetic-auto-match/'+name,...fields});
const identity=(id,name,fields={})=>({id,name,type:'character',aliases:[],description:'合成人物设定',episodeNumbers:[],sourceRefs:[],...fields});
const project=()=>createProject('合成自动匹配',false);

test('没有本话镜头需求时仍按98项拆解资产匹配102张上传素材，仅产生登记参考动作',()=>{
 const p=project(),types=['character','scene','prop'],prefix={character:'CHAR',scene:'SCENE',prop:'PROP'};p.productionAssets=Array.from({length:98},(_,i)=>identity('I'+String(i+1).padStart(3,'0'),'资产'+String(i+1).padStart(3,'0'),{type:types[i%3]}));const assets=[...p.productionAssets.map((a,i)=>image(prefix[a.type]+'_'+String(i+1).padStart(3,'0')+'_'+a.name+'_设定.png')),...Array.from({length:4},(_,i)=>image('未关联素材'+i+'.png'))],before=structuredClone(p);
 assert.equal(inspectAssetBindings(p,assets).needs.length,0);const plan=inspectProductionAssetReferences(p,assets);assert.equal(assets.length,102);assert.equal(plan.matched,98);assert.equal(plan.review,0);assert.equal(plan.actions.length,98);assert.deepEqual(p,before);
 let saved=p;for(const action of plan.actions){saved=applyAssetProductionAction(saved,{revision:saved.revision,type:'configure',...action},assets);saved.revision++;}assert.equal(saved.references.length,0);assert.deepEqual(saved.pages,before.pages);for(const a of saved.productionAssets){assert.equal(a.workflow.extraReferenceIds.length,1);assert.ok(a.stages.every(s=>!s.confirmedAssetId&&!s.candidates.length));}assert.equal(inspectProductionAssetReferences(saved,assets).preserved,98);assert.equal(inspectProductionAssetReferences(saved,assets).actions.length,0);
});

test('唯一完整角色卡只登记上传素材参考，不会误确认脸图、身体图或手部步骤',()=>{
 const p=project();p.productionAssets=[identity('C001','小白',{roleClass:'major'})];const card=image('CHAR_001_小白_完整角色卡.png'),planned=inspectProductionAssetReferences(p,[card]),saved=applyAssetProductionAction(p,{revision:0,type:'configure',...planned.actions[0]},[card]);assert.deepEqual(saved.productionAssets[0].workflow.extraReferenceIds,[card.id]);assert.deepEqual(saved.productionAssets[0].stages.map(s=>s.id),['face','body','hands','role-card']);assert.ok(saved.productionAssets[0].stages.every(s=>s.status==='pending'&&!s.confirmedAssetId&&!s.candidates.length));
});

test('名称或别名唯一可匹配，类型不同和不同场景区域不自动串用',()=>{
 const p=project();p.productionAssets=[identity('C001','宋玄',{aliases:['宋大人']}),identity('S001','县衙门口',{type:'scene'})];const actor=image('CHAR_001_宋大人_设定.png'),wrong=image('PROP_001_宋玄_设定.png'),near=image('SCENE_001_县衙大厅_主景.png'),plan=inspectProductionAssetReferences(p,[actor,wrong,near]);assert.equal(plan.rows[0].assetId,actor.id);assert.equal(plan.rows[1].assetId,null);assert.equal(plan.actions.length,1);assert.equal(plan.rows[0].candidates.includes(wrong),false);
});

test('同名多图、多服装状态与两个身份共享别名都留待人工确认',()=>{
 const p=project();p.productionAssets=[identity('C001','宋玄'),identity('C002','王甲',{aliases:['老王']}),identity('C003','王乙',{aliases:['老王']})];const assets=[image('CHAR_001_宋玄_官服.png'),image('CHAR_002_宋玄_便服.png'),image('CHAR_003_老王_设定.png')],plan=inspectProductionAssetReferences(p,assets);assert.equal(plan.review,3);assert.equal(plan.actions.length,0);assert.ok(plan.rows.every(r=>r.status==='review'));assert.equal(plan.rows[0].candidates.length,2);
});

test('已有手工extra引用、已确认阶段与本话手工参考默认保留，不被唯一新图替换',()=>{
 const p=project(),manual=image('人工参考.png'),replacement=image('CHAR_001_宋玄_设定.png');p.productionAssets=[identity('C001','宋玄',{workflow:{extraReferenceIds:[manual.id]}})];let plan=inspectProductionAssetReferences(p,[manual,replacement]);assert.equal(plan.preserved,1);assert.equal(plan.actions.length,0);assert.deepEqual(p.productionAssets[0].workflow.extraReferenceIds,[manual.id]);p.productionAssets[0].workflow.extraReferenceIds=[];p.references=[{assetId:manual.id,name:'宋玄',role:'character'}];plan=inspectProductionAssetReferences(p,[manual,replacement]);assert.equal(plan.preserved,1);p.references=[];p.productionAssets[0].stages=[{id:'face',status:'confirmed',confirmedAssetId:manual.id}];assert.equal(inspectProductionAssetReferences(p,[manual,replacement]).preserved,1);
});

test('未确认生图、过期生图和正式工作流自有角色卡不会当作上传素材自动匹配',()=>{
 const p=project();p.productionAssets=[identity('C001','宋玄')];const assets=[image('宋玄.png',{productionStatus:'candidate'}),image('宋玄.png',{productionStatus:'stale'}),image('宋玄.png',{productionStatus:'confirmed',productionAssetId:'C001',productionStageId:'role-card',libraryRole:'character',libraryName:'宋玄'})],plan=inspectProductionAssetReferences(p,assets);assert.equal(plan.matched,0);assert.equal(plan.actions.length,0);assert.equal(plan.missing,1);
});

test('现有本话需求的一键匹配补唯一名称项，尊重人工选择和跳过，不盲选多状态',()=>{
 const p=project();p.shots[0].participants='宋玄、宋茜、老王';p.shots[0].characterStates='宋玄:官服;宋茜:白衣;老王:设定';const actor=image('CHAR_001_宋玄_官服.png'),a=image('CHAR_002_宋茜_白衣.png'),b=image('CHAR_003_宋茜_白衣.png'),old=image('CHAR_004_老王_设定.png');const assets=[actor,a,b,old],base=inspectAssetBindings(p,assets),skipped=base.needs.find(n=>n.name==='老王').id,choice=automaticAssetBindingChoices(p,assets,{choices:{[skipped]:null}});assert.equal(choice.preview.needs.find(n=>n.name==='宋玄').assetId,actor.id);assert.equal(choice.preview.needs.find(n=>n.name==='宋茜').assetId,null);assert.equal(choice.choices[skipped],null);assert.equal(choice.preview.needs.find(n=>n.name==='老王').status,'skipped');
});

test('本话自动应用保持手动参考与锁定画格、对白、提示词和轮廓',()=>{
 const p=createProject('合成本话自动匹配',true),actor=image('CHAR_001_宋玄_设定.png'),custom=image('人工画风.png',{libraryRole:'style'});p.shots[0].participants='宋玄';p.references=[{assetId:custom.id,name:'人工画风',role:'style'}];p.pages[0].panels[0].referenceIds=[custom.id];p.pages[0].panels[0].assetReferenceBinding={mode:'manual',managedIds:[]};p.pages[0].panels[1].locked=true;const before=structuredClone(p),choices=automaticAssetBindingChoices(p,[actor,custom]).choices,result=planAssetBindings(p,[actor,custom],{choices,replaceManual:false});assert.ok(result.manualPanelsPreserved>=1);assert.ok(result.lockedPanels>=1);assert.deepEqual(result.project.pages[0].panels[0].referenceIds,[custom.id]);assert.deepEqual(result.project.pages[0].panels[1],before.pages[0].panels[1]);assert.deepEqual(result.project.pages.map(page=>page.panels.map(f=>f.points)),before.pages.map(page=>page.panels.map(f=>f.points)));assert.deepEqual(result.project.pages.map(page=>page.bubbles),before.pages.map(page=>page.bubbles));assert.deepEqual(p,before);
});
