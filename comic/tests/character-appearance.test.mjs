import test from 'node:test';import assert from 'node:assert/strict';
import {characterRole,characterAppearancePrompt,characterAppearanceSettings,characterGenerationMode} from '../lib/character-appearance.mjs';
import {assetStagePrompt,initializeProductionAsset,prepareAssetGeneration,applyAssetProductionAction,applyAssetResult} from '../lib/asset-production.mjs';
test('角色默认一次生成整张角色卡，只有显式选择分组件才拆图',()=>{
 assert.equal(characterGenerationMode({type:'character',characterRole:'lead'}),'card');
 assert.equal(characterGenerationMode({type:'character',characterRole:'background'}),'card');
 assert.equal(characterGenerationMode({type:'character',characterOutputMode:'components'}),'components');
 assert.equal(characterAppearanceSettings({characterOutputMode:'card'}).characterOutputMode,'card');
 assert.throws(()=>characterAppearanceSettings({characterOutputMode:'many'}),/生成方式/);
 const project={revision:1,productionAssets:[]},base={revision:1,type:'create-editable-card',assetId:'C-card',name:'林玄',role:'character',description:'黑衣青年',referenceIds:[]};
 const card=applyAssetProductionAction(project,base,[]).productionAssets[0];
 assert.equal(card.characterOutputMode,'card');
 assert.deepEqual(card.stages.map(stage=>stage.id),['role-card']);
});
test('普通路人与主要人物分开判断，职业与简单流程不会使有名主角降级',()=>{
 for(const name of ['预备杂役弟子','围观弟子甲','围观弟子乙','路人甲','守卫乙'])assert.equal(characterRole({name,type:'character'}),'background',name);
 for(const name of ['叶麟','宋凌天','杂役弟子叶麟'])assert.equal(characterRole({name,type:'character',workflow:{kind:'simple'}}),'auto',name);
 assert.equal(characterRole({name:'预备杂役弟子',characterRole:'lead'}),'lead');assert.equal(characterRole({name:'围观弟子甲',roleClass:'major'}),'lead');
 assert.throws(()=>characterAppearanceSettings({characterRole:'handsome'}),/无效/);assert.throws(()=>characterAppearanceSettings({appearanceNotes:{}}),/格式/);
});
test('路人的脸部和全身组件都收到普通外观规则，保留自身瘦高设定而不串用圆脸乙',()=>{
 const actor={name:'围观弟子甲',type:'character',description:'瘦高的弟子甲站在左侧，圆脸弟子乙站在右侧。',prompt:'灰色杂役道袍',workflow:{kind:'simple'}},p={style:'二维漫画'};
 for(const component of ['face','views','hands','prop']){const prompt=assetStagePrompt(p,actor,{component});assert.match(prompt,/普通路人角色/);assert.match(prompt,/脸型偏长/);assert.match(prompt,/不能只换衣服/);assert.doesNotMatch(prompt,/保留来源明确的圆脸/);assert.match(prompt,/普通不等于丑化/);}
 assert.equal(characterAppearancePrompt({...actor,name:'叶麟'}),'');assert.doesNotMatch(assetStagePrompt(p,{...actor,name:'叶麟',characterRole:'lead'},{component:'face'}),/普通路人角色/);
});
test('修改人物定位进入生成快照，旧候选过期但图片及其他人物不被改写',()=>{
 const a=initializeProductionAsset({id:'C1',name:'围观弟子甲',type:'character',description:'普通青年',workflow:{kind:'simple'}}),p={id:'p',title:'合成定位',revision:1,style:'二维漫画',references:[],productionAssets:[a]},request=prepareAssetGeneration(p,{revision:1,assetId:a.id,stageId:'role-card',provider:'codex'}),changed=applyAssetProductionAction(p,{revision:1,type:'configure',assetId:a.id,characterRole:'background',appearanceNotes:'眉毛较平，发髻朴素'});
 const fresh=prepareAssetGeneration(changed,{revision:1,assetId:a.id,stageId:'role-card',provider:'codex'});assert.notEqual(request.requestKey,fresh.requestKey);assert.match(fresh.prompt,/眉毛较平/);const returned=applyAssetResult(changed,request,{assetId:'asset_00000000-0000-4000-8000-000000000001'});assert.equal(returned.stale,true);assert.equal(p.productionAssets[0].characterRole,undefined);
});
