import test from 'node:test';import assert from 'node:assert/strict';
import {createProject,id} from '../public/model.js';import {ensurePanelGeneration} from '../public/panel-generation.js';
import {sanitizeTrustedNativeSizing} from "../lib/native-sizing.mjs";import {codexImageCapabilities,jimengImageCapabilities} from '../lib/native-model-capabilities.mjs';
function fixture(){const project=createProject('合成素材计划'),page=project.pages[0],panel=page.panels[0];project.revision=2;page.height=5000;project.shots[0].code='E001-001';project.shots[0].description='既有人物举起右手。';Object.assign(panel,{x:100,y:400,w:800,h:1000});ensurePanelGeneration(project,panel,[]);panel.artDirection={breakout:'foreground',breakoutSubject:'现有人物的右手',breakoutExtents:{top:.3}};return {project,page,panel,assets:[]};}



test('trusted native sizing rejects forged observed pixels and strips claimed free geometry',()=>{
 const value={version:1,mode:'model-long',provider:'codex',request:{ratio:'1:3'},resolved:{state:'verified',ratio:'1:10'}};assert.equal(sanitizeTrustedNativeSizing(value,{capability:codexImageCapabilities()}).resolved,undefined);
 const asset={id:id('asset'),width:1280,height:3840,nativeGeneration:{provider:'codex',imageModelId:null,actual:{width:1280,height:3840}}};const observed={...value,observed:{width:1280,height:3840,accepted:true,assetId:asset.id}};
 assert.equal(sanitizeTrustedNativeSizing(observed,{assets:[asset],requireGenerationEvidence:true}).observed.height,3840);
 assert.throws(()=>sanitizeTrustedNativeSizing({...observed,observed:{...observed.observed,height:5000}},{assets:[asset]}),/真实宽高/);
 assert.throws(()=>sanitizeTrustedNativeSizing({...observed,provider:'jimeng'},{assets:[asset],requireGenerationEvidence:true}),/原生生成证据/);
 const c=jimengImageCapabilities({catalogue:{items:[{model:'fake-image',modes:[{name:'i2i',flags:[{flag:'--ratio',values:['1:3']}]}]}]}})[0];const resolved=sanitizeTrustedNativeSizing({version:1,mode:'model-long',provider:'jimeng',imageModelId:'fake-image',generationMode:'i2i',request:{ratio:'1:3'}},{capability:c});assert.equal(resolved.resolved.ratio,'1:3');assert.equal(resolved.generationMode,'i2i');
});
