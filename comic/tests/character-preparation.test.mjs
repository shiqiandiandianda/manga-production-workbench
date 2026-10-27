import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {syntheticFiles} from './fixtures/production-synthetic.mjs';
import {inspectProductionPackage} from '../lib/production-package.mjs';
import {productionProject} from '../lib/production-package-document.mjs';
import {assetWorkspaceInventory,assetRequirementKey,savedAssetRequirementSettings} from '../public/asset-workspace-model.js';
import {auditPanelReferences} from '../public/panel-reference-audit.js';
import {prepareWorkspaceBinding,prepareWorkspaceText} from '../lib/asset-workspace-api.mjs';
import {characterPreparationNote,importedCharacterState} from '../public/character-preparation.js';
import {unknownState} from '../public/character-states.js';
import {assetNameKey} from '../public/asset-metadata.js';
import {shortAssetState} from '../public/asset-quick-view.js';
import {exactGalleryAsset,galleryRecordAssignments} from '../public/asset-gallery-batch.js';
import {ensureProjectPanelGeneration} from '../public/panel-generation.js';

export const preparation='文字设计存在，实际人物母版、衣装组合与图像版本尚未提供；剧情状态另按格记录。';
export async function preparationFixture(){
 const project=productionProject(await inspectProductionPackage(syntheticFiles()));
 const episode=project.productionPackage.episodes[0];for(const segment of episode.segments)segment.references=segment.references.filter(r=>r['类型']==='设定卡').map(r=>({...r,'服装':preparation}));
 const parent=project.pages.flatMap(p=>p.panels).find(p=>p.productionSegment),single=structuredClone(parent),shot={...structuredClone(project.shots[0]),id:'shot_'+randomUUID(),episode:11,code:'E011-001',participants:'测试人物',characterStates:'测试人物:未知（待确认）',location:'',props:[],sourceFields:{}};
 single.id='panel_'+randomUUID();single.name='E011-001 · 单格';single.shotId=shot.id;delete single.productionSegment;delete single.productionBackground;delete single.referenceRequirements;single.referenceIds=[];single.generation={...single.generation,characterStates:shot.characterStates,sourceSnapshot:{original:shot},referenceRoles:[]};project.shots.push(shot);project.pages[0].panels.push(single);delete project.layerOrder;
 ensureProjectPanelGeneration(project,[]);return {project,episode,parent,single};
}
const image=()=>({id:'asset_'+randomUUID(),name:'测试人物_黑衣.png',width:600,height:400,libraryRole:'character',libraryName:'测试人物',libraryState:'黑衣',productionStatus:'confirmed',library:{assetId:randomUUID(),revisionId:randomUUID(),sha256:'a'.repeat(64),projectId:randomUUID()}});

test('准备说明不作为服装；明确服装、形态和混合说明继续区分',()=>{
 for(const note of [preparation,'文字设计存在','已有文字设定，待提供图片','待提供实际图片','实际母版待绑定']){assert.equal(characterPreparationNote(note),note);assert.equal(unknownState(note),true);assert.equal(shortAssetState(note),'服装未指定');assert.equal(importedCharacterState(note),'');}
 for(const state of ['黑衣','白衣','受伤包扎','死亡状态','文字设计存在，黑色长衫']){assert.equal(characterPreparationNote(state),'');assert.equal(importedCharacterState(state),state);}
 assert.equal(importedCharacterState('黑色长衫',preparation),'黑色长衫');assert.notEqual(assetRequirementKey({role:'character',name:'甲',state:'黑衣'}),assetRequirementKey({role:'character',name:'甲',state:'白衣'}));
});
test('旧屏段与单格合并展示，需求ID、来源、工程原文和生成记录保持可用',async()=>{
 const {project,parent}=await preparationFixture(),before=JSON.stringify(project),oldNeed=auditPanelReferences(project,parent,[]).needs[0],rows=assetWorkspaceInventory(project,[],{scope:'work'}),row=rows.find(r=>r.name==='测试人物');
 assert.equal(rows.filter(r=>r.name==='测试人物').length,1);assert.equal(row.uses.length,3);assert.equal(row.state,'未知（待确认）');assert.deepEqual(row.preparationNotes,[preparation]);assert.equal(JSON.stringify(project),before);assert.equal(auditPanelReferences(project,parent,[]).needs[0].id,oldNeed.id);
 const record={id:'legacy-result',role:'character',name:row.name,context:{projectId:project.id,panelId:parent.id,needId:oldNeed.id}};assert.equal(galleryRecordAssignments(rows,record,{projectId:project.id})[0].row.key,row.key);
 assert.equal(exactGalleryAsset(row,image()),false,'服装未知时仍需看图确认');
 const oldKey=JSON.stringify(['character',assetNameKey(row.name),assetNameKey(preparation)]);project.assetWorkspaceSettings={[oldKey]:{assetBrief:'保留用户补充要求'}};assert.equal(savedAssetRequirementSettings(project,row).assetBrief,'保留用户补充要求');
});
test('合并后显式选图可同时绑定屏段和单格，旧绑定与文生记录不失效',async()=>{
 const {project,parent}=await preparationFixture(),asset=image(),store={db:{assets:[asset],jobs:[]},asset:()=>asset},row=assetWorkspaceInventory(project,[],{scope:'work'}).find(r=>r.name==='测试人物'),targets=row.uses.map(({panelId,needId})=>({panelId,needId}));
 const next=prepareWorkspaceBinding(store,project,{expectedRevision:project.revision,targets},asset);for(const target of targets){const panel=next.pages.flatMap(p=>p.panels).find(p=>p.id===target.panelId),need=auditPanelReferences(next,panel,[asset]).needs.find(n=>n.id===target.needId);assert.equal(need.status,'ready');assert.deepEqual(need.selectedIds,[asset.id]);}
 assert.equal(project.productionPackage.episodes[0].segments[0].references[0].binding,null);assert.equal(next.productionPackage.episodes[0].segments[0].references[0]['服装'],preparation);
 const text=prepareWorkspaceText(store,next,{expectedRevision:next.revision,targets:[targets.find(t=>t.panelId===parent.id)],mode:'text',description:'已确认文字外观'}),textPanel=text.pages.flatMap(p=>p.panels).find(p=>p.id===parent.id);assert.equal(auditPanelReferences(text,textPanel,[asset]).needs[0].status,'text');assert.equal(assetWorkspaceInventory(text,[asset],{scope:'work'}).find(r=>r.name==='测试人物').status,'mixed');
});
test('原来真实的黑衣白衣仍分开，既有服装冲突检查继续生效',async()=>{
 const {project,episode}=await preparationFixture();episode.segments[0].references[0]['服装']='黑衣';episode.segments[1].references[0]['服装']='白衣';const rows=assetWorkspaceInventory(project,[],{scope:'work'}).filter(r=>r.name==='测试人物');assert.equal(rows.length,3);
 const asset=image(),store={db:{assets:[asset],jobs:[]},asset:()=>asset},white=rows.find(r=>r.state==='白衣');assert.throws(()=>prepareWorkspaceBinding(store,project,{expectedRevision:project.revision,targets:white.uses},asset),/服装冲突/);
});
