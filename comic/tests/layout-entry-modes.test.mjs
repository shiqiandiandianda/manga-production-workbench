import test from 'node:test';import assert from 'node:assert/strict';
import {createDirectLayoutRun} from '../public/direct-layout-run.js';
import {createBatchLayoutRun} from '../public/batch-layout-run.js';
const storage=()=>{const map=new Map();return {getItem:k=>map.get(k),setItem:(k,v)=>map.set(k,v)};};
function fixture(images,requireArtwork=false){
 const calls=[],opened=[],context={projectId:'p',revision:3,episode:41,learningProjectId:'r',ruleVersion:'v1',ruleReady:true,requireArtwork,segments:images.map((hasImage,i)=>({id:'s'+i,hasImage}))};
 const run=createDirectLayoutRun({storage:storage(),token:()=> 'token',flushSave:async()=>{},getContext:()=>context,open:r=>opened.push(r),api:async(route)=>{calls.push(route);if(route.endsWith('/status'))return {ready:true};if(route.endsWith('/prepare'))return {records:[]};if(route.endsWith('/preview-state'))return {};if(route.endsWith('/source'))return {scriptId:'s',contract:{version:'v1'}};throw Error(route);}});
 return {run,calls,opened,context};
}
test('single-panel entry supports pre-image planning and existing artwork compatibility',async()=>{
 for(const images of [[false,false],[true,true]]){const f=fixture(images);await f.run.start();assert.equal(f.opened[0].planningMode,!images[0]);assert.ok(f.calls.includes(images[0]?'/api/auto-layout/reflow/source':'/api/auto-layout/planning/source'));}
});
test('screen entry rejects missing images before any source or task request',async()=>{
 for(const images of [[],[false,false],[true,false]]){const f=fixture(images,true);await assert.rejects(f.run.start(),/所有屏段图片生成完成/);assert.deepEqual(f.calls,[]);assert.deepEqual(f.opened,[]);}
 const f=fixture([true,true],true);await f.run.start();assert.equal(f.opened[0].planningMode,false);assert.ok(f.calls.indexOf('/api/auto-layout/reflow/prepare')<f.calls.indexOf('/api/auto-layout/reflow/source'));
});
test('partial artwork never falls back to pre-image planning',async()=>{const f=fixture([true,false]);await assert.rejects(f.run.start(),/部分屏段有图/);assert.equal(f.opened.length,0);assert.ok(!f.calls.some(p=>p.endsWith('/source')));});
test('screen mode cannot resume an old planning job',async()=>{const f=fixture([false]);await f.run.start();f.context.requireArtwork=true;f.context.segments[0].hasImage=true;await assert.rejects(f.run.start(),/原单格排版任务/);assert.equal(f.opened.length,1);});
test('batch screen mode preflights all episodes before any job',async()=>{
 const calls=[],project={id:'p',revision:1,productionPackage:{episodes:[{episode:41},{episode:42}]}},batch=createBatchLayoutRun({storage:storage(),token:()=> 'batch',getProject:()=>project,getEpisode:()=>41,flushSave:async()=>{},api:async(route,_method,input)=>{calls.push(route);assert.equal(route,'/api/auto-layout/reflow/plan');return {projectId:'p',episode:input.episode,rules:[{id:'r',activeVersion:'v1'}],segments:[{id:'s',hasImage:input.episode===41}]};}});
 await assert.rejects(batch.start({episodes:[41,42],styleId:'r',requireArtwork:true}),/第42话尚有屏段图片未生成/);assert.equal(calls.length,2);assert.equal(batch.record().index,0);
});
