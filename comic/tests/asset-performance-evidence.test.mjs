import test from 'node:test';import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {syntheticFiles} from './fixtures/production-synthetic.mjs';
import {inspectProductionPackage} from '../lib/production-package.mjs';
import {productionProject} from '../lib/production-package-document.mjs';
import {assetWorkspaceInventory} from '../public/asset-workspace-model.js';
import {createWorkspaceInventoryCache,groupWorkspaceRows} from '../public/asset-workspace-cache.js';
import {originalClothingPassages,assetNovelDocuments} from '../public/asset-source-evidence.js';
import {createMokuReferenceSearch} from '../public/moku-reference-search.js';

async function project(){return productionProject(await inspectProductionPackage(syntheticFiles()));}
test('inventory cache refreshes changed image metadata at the same array length and preserves explicit invalidation',async()=>{
 const p=await project(),a={id:'asset_'+randomUUID(),name:'测试人物_白衣.png',libraryRole:'character',libraryName:'测试人物',libraryState:'白衣'},assets=[a],cache=createWorkspaceInventoryCache();
 const first=cache.read(p,assets,{scope:'work'});assert.equal(cache.read(p,assets,{scope:'work'}),first);assert.equal(first.find(r=>r.role==='character').availableIds.length,0);
 a.libraryState='黑衣';const second=cache.read(p,assets,{scope:'work'});assert.notEqual(second,first);assert.deepEqual(second.find(r=>r.role==='character').availableIds,[a.id]);
 a.productionStatus='stale';assert.equal(cache.read(p,assets,{scope:'work'}).find(r=>r.role==='character').availableIds.length,0);
 cache.reset();assert.notEqual(cache.read(p,assets,{scope:'work'}),second);
});
test('same character appears once while states and scene identities remain separate',()=>{
 const rows=['百户官服','镇抚使官服','青色家常长衫','黑色长衫'].map((state,i)=>({key:'state'+i,name:'角色甲',role:'character',state}));rows.push({key:'scene',role:'scene',name:'角色甲',state:''});
 const groups=groupWorkspaceRows(rows);assert.equal(groups.length,2);assert.deepEqual(groups[0].rows.map(r=>r.state),rows.slice(0,4).map(r=>r.state));assert.equal(groups[1].role,'scene');
});
test('costume provenance does not mix other states in the same screen, and adaptation events are never novel quotes',async()=>{
 const p=await project(),ep=p.productionPackage.episodes[0],segment=ep.segments[0];segment.references=[{slot:0,'类型':'设定卡','人物':'测试人物','服装':'黑衣','必须':true,assetSourceId:'C001',assetSourceVersion:'v1'},{slot:1,'类型':'设定卡','人物':'测试人物','服装':'白衣','必须':true,assetSourceId:'C001',assetSourceVersion:'v2'}];
 ep.panelRecords=Array.from({length:2},(_,i)=>({id:'E011-X'+i,segmentId:segment.id,original:{'出现角色':['测试人物'],'当前状态':{'测试人物':{'本次文字方案':'C001/v'+(i+1),'造型':i?'白衣':'黑衣'}},'原著位置':['第102章',i?'事件：画面设计的白衣，需核对':'非空段2：他穿着黑色长衫。'],'服装':{'测试人物':i?'白衣':'黑衣'}},source:{file:'定稿.json',pointer:'/格/'+i}}));
 const rows=assetWorkspaceInventory(p,[],{scope:'work'}),black=rows.find(r=>r.role==='character'&&r.state==='黑衣'),white=rows.find(r=>r.role==='character'&&r.state==='白衣');
 assert.equal(black.sources[0].code,'E011-X0');assert.equal(black.sources[0].novelQuote,'他穿着黑色长衫。');assert.equal(white.sources[0].code,'E011-X1');assert.equal(white.sources[0].novelQuote,'');assert.match(white.sources[0].adaptationNote,/画面设计/);
 p.productionPackage.manifest.push({relativePath:'原文核对/第102章.txt'},{relativePath:'原文核对/第103章.txt'});assert.deepEqual(assetNovelDocuments(p,black).map(f=>f.relativePath),['原文核对/第102章.txt']);
 assert.deepEqual(originalClothingPassages('第102章\n\n他穿着黑色长衫。\n\n他走出门。'),[{line:3,paragraph:2,quote:'他穿着黑色长衫。'}]);
});
test('searching one character for several costumes shares catalogue pages and retains cancellation checks',async()=>{
 const p=await project(),id=randomUUID(),queries=[];let current=true;
 const search=createMokuReferenceSearch({project:p,api:async route=>{queries.push(route);return route==='/api/library/projects'?{items:[{id,name:p.title}]}:{items:[],more:false};},verify:()=>{if(!current)throw Error('switched');}});
 await search.search('角色甲');const first=queries.filter(q=>q.includes('/api/library/assets?'));assert.equal(first.length,4);assert.equal(first.filter(q=>new URL(q,'http://local').searchParams.get('q')).length,2); // Each scope has a server search and a bounded broad catalogue.
 await search.search('角色甲');assert.equal(queries.filter(q=>q.includes('/api/library/assets?')).length,4,'重复搜索应复用两个范围内的查询与目录页');
 current=false;await assert.rejects(search.search('角色甲'),/switched/);
});
