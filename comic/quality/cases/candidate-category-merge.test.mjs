import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {candidateAssetRole,filterAssetCandidateTypes} from '../../public/asset-candidate-types.js';
import {quickCharacterSearchFeedback,quickCharacterMarkup} from '../../public/asset-quick-view.js';
import {createMokuReferenceSearch} from '../../public/moku-reference-search.js';

const image = (name, assetType, extra = {}) => ({
  id: randomUUID(), recommendedRevisionId: randomUUID(), name, assetType, ...extra,
});

test('explicit Moku classification takes precedence over names, tags and stale local roles', () => {
  const pet = image('角色甲', 'pet', {libraryRole: 'character', tags: ['人物']});
  const bubble = image('CHAR_001_气泡', 'bubble', {characterName: '角色甲'});
  const panel = image('角色甲的漫画', 'comic_panel', {characterName: '角色甲', tags:['人物']});
  const character = image('角色甲', 'character');
  const unknown = image('角色甲', undefined);
  assert.equal(candidateAssetRole(pet), 'pet');
  assert.equal(candidateAssetRole(bubble), 'bubble');
  assert.equal(candidateAssetRole(panel), 'comic_panel');
  assert.deepEqual(filterAssetCandidateTypes([pet,bubble,panel,character,unknown], 'character'), [character]);
  assert.equal(filterAssetCandidateTypes([pet,bubble,panel,character,unknown], 'character', {allTypes:true}).length, 5);
});

test('manual expansion shows other categories without changing the default selection or removing tag controls', () => {
  const character = image('小白', 'character');
  const pet = image('小白', 'pet');
  const row = {name:'小白', role:'character', state:'白衣', key:'row', assetIds:[], uses:[], sources:[]};
  const project = {id:'project', references:[], pages:[], assetLibrary:{assetIds:[]}};
  assert.deepEqual(quickCharacterSearchFeedback(project,row,[],[character,pet],'小白').candidates.map(x=>x.id), [character.id]);
  assert.equal(quickCharacterSearchFeedback(project,row,[],[character,pet],'小白',{includeOtherTypes:true}).candidates.length, 2);
  const chosen = {id:'local', name:'小白', library:{assetId:character.id, revisionId:character.recommendedRevisionId}};
  const html = quickCharacterMarkup({project,row:{...row,assetIds:[chosen.id]},variants:[row],assets:[chosen],settings:{},items:[pet],query:'小白',includeOtherTypes:true,removals:'RESTORE_MARKER'});
  assert.match(html, /data-asset-all-types/);
  assert.match(html, /data-asset-add-tag/);
  assert.match(html, /data-asset-action="remove-current"/);
  assert.match(html, /RESTORE_MARKER/);
});

test('Moku search defaults to requested classification and expands only when requested', async () => {
  const projectId = randomUUID(), character = image('小白', 'character'), pet = image('小白', 'pet');
  const search = createMokuReferenceSearch({project:{}, api:async route => route==='/api/library/projects'
    ? {items:[{id:projectId,name:'测试项目'}]}
    : {items:[character,pet],more:false}});
  assert.deepEqual((await search.search('小白',{scope:projectId,role:'character'})).items.map(x=>x.id), [character.id]);
  assert.equal((await search.search('小白',{scope:projectId,role:'character',allTypes:true})).items.length, 2);
  search.clear();
});
