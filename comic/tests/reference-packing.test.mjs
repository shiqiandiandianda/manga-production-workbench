import test from 'node:test';
import assert from 'node:assert/strict';
import {referencePackingRoles} from '../lib/reference-packing.mjs';
test('packing metadata uses explicit faction/tier without changing reference selections',()=>{
 const refs=[{assetId:'a',name:'人物甲',role:'character'},{assetId:'b',name:'人物乙',role:'character'},{assetId:'c',name:'前段成图 S01',role:'scene'}],before=structuredClone(refs);
 const result=referencePackingRoles(refs,{project:{assetWorkspaceSettings:{'["character","人物甲",""]':{characterRole:'lead'}}},assets:[{id:'a',faction:'同门'},{id:'b',characterRole:'background',library:{camp:'同门'}}]});
 assert.equal(result[0].characterRole,'lead');assert.equal(result[1].characterRole,'background');assert.equal(result[0].faction,'同门');assert.equal(result[1].faction,'同门');assert.equal(result[2].keepSeparate,true);assert.deepEqual(refs,before);
 assert.equal(referencePackingRoles([{assetId:'z',name:'未知人物',role:'character'}])[0].faction,'');
});
