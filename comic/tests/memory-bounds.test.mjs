import test from 'node:test';import assert from 'node:assert/strict';
import {BoundedCache,createAsyncCache,memoryCacheStats} from '../public/bounded-cache.js';
import {createUndoMemoryBudget} from '../public/undo-memory.js';
import {createMokuReferenceSearch} from '../public/moku-reference-search.js';
import {createAssetSourceReader} from '../public/asset-source-evidence.js';
import {loadImage,clearImageCache} from '../public/render.js';
import {assetUrl,refreshAssetUrl} from '../public/asset-url.js';

test('weighted rolling cache stays bounded across 5000 unique values; expiry sweeps untouched keys',()=>{
 let now=0;const c=new BoundedCache({name:'stress',maxEntries:20,maxBytes:100000,ttl:1000,now:()=>now});
 for(let i=0;i<5000;i++){c.set(i,{text:'测'.repeat(3000)});assert.ok(c.bytes<=100000);assert.ok(c.size<=20);assert.ok(c.get(i));}
 assert.ok(c.evicted>4900);now=1001;c.sweep();assert.equal(c.size,0);assert.equal(c.bytes,0);
 c.set('big','data',90000);c.set('new','data',90000);assert.equal(c.size,1);assert.equal(c.get('new'),'data');c.set('oversize','data',100001);assert.equal(c.has('oversize'),false);
});
test('async cache coalesces pending reads, limits concurrency, retries errors, and does not resurrect cleared results',async()=>{
 const c=createAsyncCache({name:'async-stress',maxEntries:3,maxBytes:10000,maxPending:2});let calls=0,active=0,peak=0;
 const read=()=>{calls++;active++;peak=Math.max(peak,active);return new Promise(resolve=>setTimeout(()=>{active--;resolve({text:'data'});},2));};
 await Promise.all(Array.from({length:30},(_,i)=>c.load(String(i%10),read)));assert.ok(peak<=2);assert.ok(c.stats().entries<=3);
 c.clear();calls=0;await Promise.all([c.load('same',read),c.load('same',read)]);assert.equal(calls,1);
 await assert.rejects(c.load('error',()=>Promise.reject(Error('offline'))),/offline/);assert.equal(await c.load('error',()=>42),42);
 let resolve;const old=c.load('stale',()=>new Promise(r=>{resolve=r;}));await Promise.resolve();c.clear();resolve('old');await old;assert.equal(c.stats().entries,0);assert.equal(c.stats().pending,0);
});
test('hundreds of distinct Moku searches do not retain every query result',async()=>{
 let reads=0;const search=createMokuReferenceSearch({project:{id:'p',references:[],pages:[]},api:async url=>{if(url==='/api/library/projects')return {items:[]};reads++;return {items:[{id:'11111111-1111-1111-1111-111111111111',recommendedRevisionId:'22222222-2222-2222-2222-222222222222',name:'角色'.repeat(2000)}],more:false};}});
 for(let i=0;i<400;i++){const result=await search.search('人物'+i,{scope:'public'});assert.equal(result.items.length,1);assert.ok(search.stats().estimatedBytes<=8*1024*1024);assert.ok(search.stats().entries<=24);}
 const at=reads;await search.search('人物399',{scope:'public'});assert.equal(reads,at);assert.ok(search.stats().evicted>350);search.clear();assert.equal(search.stats().entries,0);
});
test('source chapters rotate, clear on project change, and reject oversized streams before buffering the whole file',async t=>{
 const prior=globalThis.fetch;t.after(()=>{globalThis.fetch=prior;});let calls=0,cancelled=false;
 globalThis.fetch=async()=>{calls++;return new Response('他穿着黑色长衫。'.repeat(1000));};
 const reader=createAssetSourceReader(),p={id:'p',productionPackage:{hash:'immutable'}},node={dataset:{assetNovelDocument:''},isConnected:false,querySelector:()=>({})},root={querySelectorAll:()=>[node]};
 for(let i=0;i<150;i++){node.dataset.assetNovelDocument='原文/'+i+'.txt';await reader.load(p,root);assert.ok(reader.stats().entries<=12);assert.ok(reader.stats().estimatedBytes<=8*1024*1024);}
 assert.ok(reader.stats().evicted>130);await reader.load({...p,id:'other'},root);assert.equal(reader.stats().entries,1);assert.equal(calls,151);reader.clear();
 const host={textContent:''};node.isConnected=true;node.querySelector=()=>host;
 globalThis.fetch=async()=>new Response(new ReadableStream({pull(controller){controller.enqueue(new Uint8Array(1024*1024));},cancel(){cancelled=true;}}));
 await reader.load(p,root);assert.equal(cancelled,true);assert.match(host.textContent,/原件较大/);assert.equal(reader.stats().entries,0);
});
test('decoded image cache uses pixel weight, releases references, and does not damage a retained drawing image',async t=>{
 const prior=globalThis.Image;t.after(()=>{globalThis.Image=prior;clearImageCache();});let created=0;
 globalThis.Image=class{constructor(){created++;this.naturalWidth=2048;this.naturalHeight=2048;}set src(value){this.url=value;queueMicrotask(()=>this.onload?.());}get src(){return this.url;}};
 clearImageCache();const retained=await loadImage('first');
 for(let i=0;i<120;i++){await loadImage('asset_'+i);const s=memoryCacheStats().find(s=>s.name==='decoded-original-images');assert.ok(s.estimatedBytes<=96*1024*1024);assert.ok(s.entries<=6);}
 assert.ok(retained.src.includes('/assets/first'));assert.equal(retained.naturalWidth,2048);const count=created;await loadImage('asset_119');assert.equal(created,count);
 clearImageCache('asset_119');await loadImage('asset_119');assert.equal(created,count+1);clearImageCache();assert.equal(memoryCacheStats().find(s=>s.name==='decoded-original-images').entries,0);
});
test('bounded asset refresh tokens never revert to a previously cached URL after rollover',()=>{
 const before=assetUrl('same');refreshAssetUrl('same');const changed=assetUrl('same');assert.notEqual(changed,before);for(let i=0;i<5000;i++)refreshAssetUrl('different_'+i);assert.notEqual(assetUrl('same'),before);assert.notEqual(assetUrl('same'),changed);
});
test('undo/redo shares one byte budget, retains nearest usable states and never changes the live document',()=>{
 const budget=createUndoMemoryBudget({steps:50,bytes:1000000,lowWater:.75}),history=[],future=[],current={text:'current unsaved'};
 for(let i=0;i<100;i++){history.push({id:i,payload:'文'.repeat(90000)});const s=budget.trim(history,future);assert.ok(s.estimatedBytes<=1000000);assert.equal(history.at(-1).id,i);assert.ok(s.steps<=50);}
 const target=history.pop();future.push({...current});budget.trim(history,future);assert.ok(future.length);assert.deepEqual(current,{text:'current unsaved'});assert.equal(target.id,99);
 const large={payload:'x'.repeat(400000)};history.length=0;future.length=0;history.push(large,structuredClone(large));budget.trim(history,future);assert.equal(history.length,1);
 history.push({payload:'x'.repeat(600000)});const s=budget.trim(history,future);assert.ok(s.estimatedBytes<=1000000);assert.deepEqual(current,{text:'current unsaved'});
});
