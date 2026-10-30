import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {createMokuBatchSearch} from '../public/moku-batch-search.js';import {createMokuReferenceSearch} from '../public/moku-reference-search.js';import {automaticGalleryMatch} from '../public/asset-gallery-batch.js';
const projectId=randomUUID(),other=randomUUID(),card=(i,extra={})=>({id:randomUUID(),recommendedRevisionId:randomUUID(),name:'人物'+i+'_黑衣.png',characterName:'人物'+i,outfitName:'黑衣',category:'character',assetType:'character',projectId,...extra});
function fixture({rows=Array.from({length:450},(_,i)=>card(i)),more,fail=false,maxPages}={}){
 const calls=[],search=createMokuBatchSearch({projectIds:[projectId],maxPages,api:async route=>{calls.push(route);const p=new URL(route,'http://test').searchParams;assert.equal(p.get('projectId'),projectId);assert.equal(p.get('assetType'),'character');assert.equal(p.get('q'),'');assert.equal(p.get('pageMode'),'source');if(fail)throw Error('offline');const offset=Number(p.get('offset'));return {items:rows.slice(offset,offset+200),more:more??offset+200<rows.length,nextOffset:offset+Math.min(200,rows.length-offset)};}});return {calls,search,rows};
}
test('twelve names share three pages, type and work stay scoped, deep-page match survives',async()=>{
 const f=fixture();for(const i of [449,...Array.from({length:11},(_,i)=>i)]){const r=await f.search.search('人物'+i,{role:'character'});assert.equal(r.complete,true);assert.ok(r.items.some(x=>x.id===f.rows[i].id));}assert.equal(f.calls.length,3);
});
test('parallel names coalesce catalogue reads',async()=>{const f=fixture();await Promise.all(Array.from({length:12},(_,i)=>f.search.search('人物'+i,{role:'character'})));assert.equal(f.calls.length,3);});
test('partial catalogue and network failures cannot authorize auto-adoption',async()=>{
 for(const options of [{maxPages:1},{fail:true}]){const f=fixture(options),r=await f.search.search('人物0',{role:'character'});assert.equal(r.complete,false);assert.ok(r.notes.length);assert.equal(automaticGalleryMatch({name:'人物0',role:'character',state:'黑衣'},r.items,{projectIds:[projectId],complete:r.complete}),null);}
});
test('duplicate outfit versions stay ambiguous and role mismatches stay excluded',async()=>{
 const f=fixture({rows:[card(0),card(0),card(0,{assetType:'scene',category:'scene'})]}),r=await f.search.search('人物0',{role:'character'});assert.equal(r.items.length,2);assert.equal(automaticGalleryMatch({name:'人物0',role:'character',state:'黑衣'},r.items,{projectIds:[projectId],complete:r.complete}),null);
});
test('filtered-empty source pages still advance, stale project stops reads, close cancels reuse',async()=>{
 let stale=false,calls=0;const row=card(1),s=createMokuBatchSearch({projectIds:[projectId],verify:()=>{if(stale)throw Error('changed');},api:async()=>++calls===1?{items:[],more:true,nextOffset:200}:{items:[row],more:false,nextOffset:201}});
 assert.equal((await s.search('人物1',{role:'character'})).items.length,1);assert.equal(calls,2);stale=true;await assert.rejects(s.search('人物1',{role:'character'}),/changed/);stale=false;s.clear();await assert.rejects(s.search('人物1',{role:'character'}),/结束/);
});
test('legacy filtered offsets remain supported, memory limit stays incomplete',async()=>{
 const rows=Array.from({length:201},(_,i)=>card(i)),offsets=[];const s=createMokuBatchSearch({projectIds:[projectId],api:async route=>{const o=Number(new URL(route,'http://x').searchParams.get('offset'));offsets.push(o);return {items:rows.slice(o,o+200),more:o===0};}});assert.equal((await s.search('人物200',{role:'character'})).complete,true);assert.deepEqual(offsets,[0,200]);
 const limited=createMokuBatchSearch({projectIds:[projectId],maxBytes:1,api:async()=>({items:rows,more:false})});assert.equal((await limited.search('人物0',{role:'character'})).complete,false);
});
test('deterministic before/after request benchmark retains same selected-work matches',async()=>{
 const rows=Array.from({length:450},(_,i)=>card(i)),libraries=[{id:projectId,name:'作品'},{id:other,name:'其他作品'}];let count=0;
 const api=async route=>{count++;if(route.endsWith('/projects'))return {items:libraries};const p=new URL(route,'http://x').searchParams,o=Number(p.get('offset')),all=p.get('projectId')===projectId?rows:[],q=p.get('q'),items=q?all.filter(x=>x.name.includes(q)):all;return {items:items.slice(o,o+200),more:o+200<items.length,nextOffset:o+Math.min(200,items.length-o)};};
 const old=createMokuReferenceSearch({api,project:{title:'作品'}}),next=createMokuBatchSearch({api,projectIds:[projectId],projects:libraries}),oldMatches=[];
 for(let i=0;i<12;i++)oldMatches.push((await old.search('人物'+i,{role:'character'})).items.filter(x=>x.projectId===projectId).map(x=>x.id));const oldCount=count;count=0;
 for(let i=0;i<12;i++)assert.deepEqual((await next.search('人物'+i,{role:'character'})).items.map(x=>x.id),oldMatches[i]);assert.equal(count,3);assert.ok(oldCount>count*10);console.log(JSON.stringify({benchmark:'12 names / 450 assets / 2 libraries plus public',before:oldCount,after:count}));old.clear();next.clear();
});
