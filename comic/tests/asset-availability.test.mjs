import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {assetUnavailable} from '../public/asset-availability.js';
import {usableMokuImage} from '../public/moku-reference-search.js';
import {productionAssetBinding} from '../lib/production-reference-files.mjs';
import {productionAssetMatch} from '../public/production-reference-audit.js';
import {productionReferencePlan} from '../public/production-package-model.js';

test('abandoned location names remain selectable without hiding explicit disabled or discarded markers',()=>{
 for(const name of ['城外废弃庭院.png','废弃庭院_雨夜.png','城外废弃庭院_战后至次日_生成_abcd.png','废弃仓库_主景.png']){
  const item={id:randomUUID(),name,recommendedRevisionId:randomUUID()};assert.equal(assetUnavailable(item),false,name);assert.equal(usableMokuImage(item),true,name);
 }
 for(const name of ['不能使用_庭院.png','场景_作废.png','场景_禁用.png','场景_废弃.png','【废弃】庭院.png','场景_已废弃_旧版.png','场景_废弃版本.png','废弃.png']){
  const item={id:randomUUID(),name,recommendedRevisionId:randomUUID()};assert.equal(assetUnavailable(item),true,name);assert.equal(usableMokuImage(item),false,name);
 }
 for(const extra of [{productionStatus:'candidate'},{productionStatus:'stale'},{deletedAt:'2026-10-26'},{trashedAt:'2026-10-26'}])assert.equal(assetUnavailable({name:'城外废弃庭院.png',...extra}),true);
});

test('an abandoned-courtyard reference survives binding, production audit and generation planning',()=>{
 const asset={id:'asset_'+randomUUID(),name:'城外废弃庭院.png',productionStatus:'confirmed',library:{assetId:randomUUID(),revisionId:randomUUID(),sha256:'a'.repeat(64),category:'scene'}},store={asset:()=>asset},binding=productionAssetBinding(store,asset.id),reference={slot:0,'类型':'场景','名称':'城外废弃庭院','说明':asset.name,'必须':true,binding},frame={id:'panel',productionSegment:'E051-S019'},project={shots:[],pages:[{panels:[frame]}],productionPackage:{episodes:[{episode:51,segments:[{id:frame.productionSegment,episode:51,references:[reference]}]}]}};
 project.productionPackage.episodes[0].panelRecords=[];
 assert.equal(productionAssetMatch(project,reference,asset).exact,true);assert.equal(productionReferencePlan(project,frame,[asset]).refs[0].assetId,asset.id);
 asset.name='城外废弃庭院_禁用.png';assert.throws(()=>productionAssetBinding(store,asset.id),/不能使用/);assert.equal(productionAssetMatch(project,reference,asset).identity,false);assert.throws(()=>productionReferencePlan(project,frame,[asset]),/不能使用/);
});
