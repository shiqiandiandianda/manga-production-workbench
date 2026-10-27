import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {unknownState} from '../public/character-states.js';
import {shortAssetState,quickCharacterMarkup} from '../public/asset-quick-view.js';
import {syntheticFiles} from './fixtures/production-synthetic.mjs';
import {inspectProductionPackage} from '../lib/production-package.mjs';
import {productionProject} from '../lib/production-package-document.mjs';
import {assetWorkspaceInventory} from '../public/asset-workspace-model.js';
import {prepareWorkspaceBinding} from '../lib/asset-workspace-api.mjs';
import {auditPanelReferences} from '../public/panel-reference-audit.js';
import {ensureProjectPanelGeneration} from '../public/panel-generation.js';
const pending='待与项目主库对应，未绑定实际图片或固定版本；本批没有生成资产图。';

test('an unbound-library placeholder is not a clothing requirement',()=>{
 assert.equal(unknownState(pending),true);assert.equal(shortAssetState(pending),'服装未指定');assert.equal(unknownState('青灰官服'),false);
});

test('scene-only search results explain why no character candidates are shown',()=>{
 const cloud=randomUUID(),items=Array.from({length:11},(_,i)=>({id:randomUUID(),name:'林家场景'+i+'.png',category:'scene',projectId:cloud,recommendedRevisionId:randomUUID()})),row={name:'林家仆人',role:'character',state:pending,key:'row',assetIds:[],uses:[],sources:[]},project={id:'project',references:[],pages:[],assetLibrary:{assetIds:[]}},markup=quickCharacterMarkup({project,row,variants:[row],assets:[],settings:{},items,query:'林家'});
 assert.match(markup,/11 张场景图/);assert.match(markup,/没有.*林家仆人.*人物图/);assert.doesNotMatch(markup,/data-asset-use-moku/);
 const expanded=quickCharacterMarkup({project,row,variants:[row],assets:[],settings:{},items,query:'林家',includeOtherTypes:true});assert.match(expanded,/显示其他分类/);assert.match(expanded,/data-asset-use-moku/);
});

test('manual character selection with unspecified clothing stays ready without inventing a costume confirmation',async()=>{
 const files=syntheticFiles(),screen=JSON.parse(files[1].bytes);for(const segment of screen['屏段'])segment['附图']=[{'类型':'设定卡','人物':'青城派弟子','服装':pending,'必须':true}];files[1]={...files[1],bytes:Buffer.from(JSON.stringify(screen))};
 const project=productionProject(await inspectProductionPackage(files)),asset={id:'asset_'+randomUUID(),name:'青城派弟子_全员修改版.png',libraryName:'青城派弟子',libraryState:'全员修改版',libraryRole:'character',productionStatus:'confirmed',width:600,height:800,library:{assetId:randomUUID(),revisionId:randomUUID(),sha256:'a'.repeat(64),projectId:randomUUID()}},assets=[asset];project.assetLibrary={version:1,assetIds:[asset.id],directories:[],recursive:true};
 ensureProjectPanelGeneration(project,assets);
 const row=assetWorkspaceInventory(project,assets,{scope:'work'}).find(r=>r.name==='青城派弟子'),targets=row.uses.map(({panelId,needId})=>({panelId,needId})),store={db:{assets,jobs:[]},asset:id=>assets.find(a=>a.id===id)},source=JSON.stringify(project.productionPackage),next=prepareWorkspaceBinding(store,project,{targets,expectedRevision:project.revision},asset);
 for(const target of targets){const panel=next.pages.flatMap(page=>page.panels).find(p=>p.id===target.panelId),need=auditPanelReferences(next,panel,assets).needs.find(n=>n.id===target.needId);assert.equal(need.status,'ready');assert.equal(panel.referenceNeedBindings?.[target.needId]?.manualStateConfirmation,undefined);}
 assert.equal(JSON.stringify(project.productionPackage),source);assert.equal(next.productionPackage.episodes[0].segments[0].references[0]['服装'],pending);
});
