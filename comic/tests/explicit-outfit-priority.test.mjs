import test from 'node:test';
import assert from 'node:assert/strict';
import {stateReferenceMetadata,stateReferenceMatches} from '../public/character-state-references.js';
test('explicit outfit identity takes precedence over old filename and stale reference labels',()=>{
 const a={id:'a',name:'叶麟_白衣.png',libraryRole:'character',libraryName:'叶麟',libraryState:'黑衣'};
 const m=stateReferenceMetadata({references:[{assetId:'a',characterState:'白衣'}]},a);
 assert.equal(stateReferenceMatches('白衣',m),false);assert.equal(stateReferenceMatches('黑衣',m),true);
 const alias=stateReferenceMetadata({references:[]},{...a,libraryStateAliases:['夜行衣']});assert.equal(stateReferenceMatches('夜行衣',alias),true);
 const old=stateReferenceMetadata({references:[]},{...a,libraryState:undefined});assert.equal(stateReferenceMatches('白衣',old),true);
});
