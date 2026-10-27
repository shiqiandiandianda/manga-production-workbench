import {randomUUID} from 'node:crypto';import assert from 'node:assert/strict';import {quickCharacterCandidates} from '../../public/asset-quick-view.js';
import test from 'node:test';
test('different character name can be found through Moku tag',()=>{const a={id:randomUUID(),projectId:randomUUID(),assetType:'character',category:'character',name:'另一名字_黑衣.png',tags:['工作台人物名'],recommendedRevisionId:randomUUID(),outfitName:'黑衣'};const c=quickCharacterCandidates({references:[],assetLibrary:{assetIds:[]}}, {name:'工作台人物名',role:'character',state:'黑衣',assetIds:[]},[],[a]);assert.equal(c.length,1);assert.equal(c[0].tags[0],'工作台人物名');console.log('PASS renamed character found through Moku alias tag');

});
