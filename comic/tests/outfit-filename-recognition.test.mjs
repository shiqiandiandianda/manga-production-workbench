import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {inspectProductionPackage,packageDigest} from '../lib/production-package.mjs';
import {productionProject} from '../lib/production-package-document.mjs';
import {ensureProjectPanelGeneration} from '../public/panel-generation.js';
import {auditPanelReferences} from '../public/panel-reference-audit.js';
import {stateReferenceMetadata,stateReferenceMatches} from '../public/character-state-references.js';
import {prepareWorkspaceBinding} from '../lib/asset-workspace-api.mjs';

// Synthetic references only: no account, real project, image file or generator.
const sourceFile=(relativePath,data)=>{const bytes=Buffer.from(JSON.stringify(data));return {relativePath,bytes,sha256:packageDigest(bytes)};};
async function fixture(required='世家少年常服'){
 const board={'格式':'分镜 JSON 2.2','作品':'服装识别合成验收','话':11,'格':[{'格ID':'E011-001','画面内容':'宋凌天站在庭院','生图提示词':'保持原文','服装':{'宋凌天':required}}]};
 const screen={'版本':'屏段文字层 1.1','作品':board['作品'],'话':11,'文字':[],'屏段':[{'段ID':'段01','格':[{'格ID':'E011-001','格号':1}],'附图':[{'类型':'设定卡','人物':'宋凌天','服装':required,'必须':true}],'提示词':{'空泡':'空泡原文','无泡':'无泡原文'},'底图':{'方式':'纯白'}}]};
 const source=await inspectProductionPackage([sourceFile('分镜JSON/第011话_分镜.json',board),sourceFile('屏段/第011话_屏段文字层.json',screen)]),project=productionProject(source),assets=[];
 const asset=name=>{const value={id:'asset_'+randomUUID(),name,source:'moku',library:{category:'character',assetId:randomUUID(),revisionId:randomUUID(),sha256:'a'.repeat(64)}};assets.push(value);return value;};
 ensureProjectPanelGeneration(project,assets);const panel=project.pages[0].panels.find(p=>p.productionSegment==='E011-S001'),need=auditPanelReferences(project,panel,assets).needs[0];
 const store={db:{projects:[project],assets,jobs:[]},project:id=>{assert.equal(id,project.id);return project;},asset:id=>assets.find(a=>a.id===id)};
 const bind=value=>prepareWorkspaceBinding(store,project,{expectedRevision:project.revision,targets:[{panelId:panel.id,needId:need.id}],assetId:value.id},value);
 return {project,panel,need,asset,bind,store,assets};
}

test('宋凌天标准卡的服装编号、正常状态和卡片类型不再导致正确常服被拒绝',async()=>{
 const f=await fixture(),a=f.asset('CHAR_003_宋凌天_CO001_世家少年常服_正常_标准卡_v1.png');
 assert.equal(stateReferenceMatches('世家少年常服',stateReferenceMetadata(f.project,a)),true);
 const next=f.bind(a),panel=next.pages.flatMap(p=>p.panels).find(p=>p.id===f.panel.id),need=auditPanelReferences(next,panel,f.assets).needs.find(n=>n.id===f.need.id);
 assert.equal(need.status,'ready');assert.equal(need.blocking,false);assert.deepEqual(need.selectedIds,[a.id]);
});
test('C0001编号和无编号标准卡均按完整服装名称匹配',async()=>{
 for(const name of ['CHAR_003_宋凌天_C0001_世家少年常服_正面_标准卡_v1.png','宋凌天_世家少年常服_正常_标准卡_v1']){
  const f=await fixture(),a=f.asset(name);assert.doesNotThrow(()=>f.bind(a));
 }
});
test('灵剑峰内门道袍不能替代世家少年常服，保留409服装冲突拦截',async()=>{
 const f=await fixture(),a=f.asset('CHAR_003_宋凌天_CO002_灵剑峰内门道袍_正常_标准卡_v1');
 assert.equal(stateReferenceMatches('世家少年常服',stateReferenceMetadata(f.project,a)),false);
 assert.throws(()=>f.bind(a),error=>error.status===409&&/人物服装冲突/.test(error.message));
});
test('相近服装名称不能依靠子串或模糊匹配通过',async()=>{
 for(const outfit of ['世家少年常服改款','世家少年礼服']){
  const f=await fixture(),a=f.asset('CHAR_003_宋凌天_CO002_'+outfit+'_正常_标准卡_v1');
  assert.throws(()=>f.bind(a),error=>error.status===409&&/人物服装冲突/.test(error.message));
 }
});
test('反向服装检查有效，常服不能冒充内门道袍',async()=>{
 const f=await fixture('灵剑峰内门道袍'),a=f.asset('CHAR_003_宋凌天_CO001_世家少年常服_正常_标准卡_v1');
 assert.throws(()=>f.bind(a),error=>error.status===409&&/人物服装冲突/.test(error.message));
});
test('采用只产生工程副本，不修改原资产元数据及原工程绑定',async()=>{
 const f=await fixture(),a=f.asset('CHAR_003_宋凌天_CO001_世家少年常服_正常_标准卡_v1'),beforeAsset=structuredClone(a),beforeProject=structuredClone(f.project);
 f.bind(a);assert.deepEqual(a,beforeAsset);assert.deepEqual(f.project,beforeProject);
});
