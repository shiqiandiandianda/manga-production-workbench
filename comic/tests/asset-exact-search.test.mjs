import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {exactAssetCandidates,assetRequirementSearch} from '../public/asset-exact-search.js';
import {quickCharacterCandidates,quickCharacterSearchFeedback} from '../public/asset-quick-view.js';
import {createMokuReferenceSearch} from '../public/moku-reference-search.js';
import {createMokuBatchSearch} from '../public/moku-batch-search.js';
import {automaticGalleryMatch} from '../public/asset-gallery-batch.js';
const cloud=randomUUID();
const remote=(name,role='scene',state='',extra={})=>({id:randomUUID(),recommendedRevisionId:randomUUID(),projectId:cloud,name:[name,state].filter(Boolean).join('__')+'.png',assetType:role,subjectName:name,canonicalName:name,canonicalVariantName:state,...extra});
const local=r=>({...r,id:'asset_'+randomUUID(),libraryRole:r.assetType,libraryName:r.subjectName,libraryState:r.canonicalVariantName,library:{assetId:r.id,revisionId:r.recommendedRevisionId,projectId:cloud}});

test('smoke-alley stance excludes study, training ground, ordinary scene and another scene image in both local and remote candidates',()=>{
 const name='扬州长街与烟花巷·烟柳巷·人物站位图',row={name,role:'scene',purpose:'blocking',blockingId:'scene-image:alley',assetIds:[]};
 const good=remote(name,'scene','正俯视·姓名标注',{referenceGeneration:{purpose:'blocking',blockingId:row.blockingId}}),room=remote('扬州千户所·书房·人物站位图'),ground=remote('扬州千户所·演武场·人物站位图'),ordinary=remote('扬州长街与烟花巷·烟柳巷'),wrongPicture={...good,id:randomUUID(),recommendedRevisionId:randomUUID(),referenceGeneration:{purpose:'blocking',blockingId:'scene-image:other'}};
 const result=quickCharacterCandidates({id:'p'},row,[good,room,ground,ordinary,wrongPicture].map(local),[good,room,ground,ordinary,wrongPicture]);
 assert.deepEqual(result.map(a=>a.revisionId),[good.recommendedRevisionId]);
 assert.equal(quickCharacterCandidates({},row,[room,ground].map(local),[room,ground]).length,0,'a miss stays empty');
});
test('canonical scene identities retain room boundaries and normalized separators without matching similar locations or tags',()=>{
 const room=remote('扬州千户所','scene','书房'),court=remote('扬州千户所','scene','院中'),other=remote('外城书房','scene','',{tags:['扬州千户所·书房'],libraryAliases:['扬州千户所·书房']});
 assert.deepEqual(exactAssetCandidates([room,court,other],'扬州千户所 · 书房',{role:'scene'}),[room]);
 assert.deepEqual(exactAssetCandidates([room,court,other],'书房',{role:'scene'}),[]);
 assert.deepEqual(exactAssetCandidates([room,court],'扬州千户所__书房',{role:'scene'}),[room]);
});
test('character row restricts the known outfit; manual full names and subject__variant remain usable',()=>{
 const a=remote('宋玄','character','百户官服'),b=remote('宋玄','character','家常长衫'),c=remote('宋玄亲兵','character','百户官服'),row={name:'宋玄',role:'character',state:'百户官服',assetIds:[]},items=[a,b,c];
 assert.deepEqual(quickCharacterSearchFeedback({},row,[],items,'宋玄').candidates.map(i=>i.id),[a.id]);
 assert.deepEqual(quickCharacterSearchFeedback({},row,[],items,'宋玄__家常长衫').candidates.map(i=>i.id),[b.id]);
 assert.deepEqual(quickCharacterSearchFeedback({},row,[],items,'宋').candidates,[]);
 assert.deepEqual(exactAssetCandidates(items,'宋玄',{role:'character'}),[a,b]);
});
test('show other types relaxes classification only; no partial name, tag or fuzzy fallback',()=>{
 const row={name:'华山派',role:'scene',assetIds:[]},scene=remote('华山派'),person=remote('华山派','character'),other=remote('令狐冲','character','华山弟子常服',{tags:['华山派']});
 assert.deepEqual(quickCharacterSearchFeedback({},row,[],[scene,person,other],row.name,{includeOtherTypes:true}).candidates.map(i=>i.id),[scene.id,person.id]);
 assert.deepEqual(quickCharacterSearchFeedback({},row,[],[scene], '华山').candidates,[]);
 assert.deepEqual(exactAssetCandidates([scene],''),[]);
});
test('same-name same-outfit versions remain manual choices, never an automatic unique match',()=>{
 const row={name:'宋玄',role:'character',state:'百户官服'},a=remote(row.name,'character',row.state),b=remote(row.name,'character',row.state),items=[a,b];
 assert.equal(exactAssetCandidates(items,row.name,assetRequirementSearch(row)).length,2);
 assert.equal(automaticGalleryMatch(row,items,{projectIds:[cloud]}),null);
});
test('interactive and batch search enforce the same precision even when the server returns broad, tagged or deep-page hits',async()=>{
 const row={name:'千户所·书房',role:'scene'},good=remote('千户所','scene','书房'),wrong=remote('千户所','scene','演武场'),tagged=remote('别的场景','scene','',{tags:[row.name]}),catalog=[wrong,tagged,...Array.from({length:200},(_,i)=>remote('无关场景'+i)),good];
 const api=async route=>{if(route==='/api/library/projects')return {items:[{id:cloud,name:'作品'}]};const u=new URL(route,'http://test'),offset=Number(u.searchParams.get('offset')),items=catalog.slice(offset,offset+200);return {items,more:offset+200<catalog.length,nextOffset:offset+items.length};};
 const interactive=createMokuReferenceSearch({api,project:{title:'作品'}}),batch=createMokuBatchSearch({api,projectIds:[cloud]});
 for(const search of [interactive,batch]){const found=await search.search(row.name,{scope:cloud,...assetRequirementSearch(row)});assert.deepEqual(found.items.map(i=>i.id),[good.id]);assert.equal((await search.search('不存在场景',{scope:cloud,role:'scene'})).items.length,0);search.clear();}
});
