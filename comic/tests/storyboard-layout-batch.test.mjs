import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createStudio} from '../server.mjs';
import {writeXlsx} from '../lib/xlsx.mjs';


import {makeGradientLayer} from '../public/layers.js';
import {archiveRemovedDialogue} from '../public/dialogue-archive.js';
import {productionHeaders,productionRows} from './helpers/storyboard-production.mjs';
const plan=(episode,spread='est-panorama')=>({spreads:spread==='est-panorama'?[{spread,units:[1,2].map(i=>'E'+String(episode).padStart(3,'0')+'-'+String(i).padStart(3,'0'))}]:[1,2].map(i=>({spread,units:['E'+String(episode).padStart(3,'0')+'-'+String(i).padStart(3,'0')]}))});
const file=(episode,spread)=>({name:'第'+episode+'话_排版.json',text:JSON.stringify(plan(episode,spread))});
const input=()=>({name:'第11-13话合成.xlsx',dataBase64:writeXlsx([11,12,13].map(episode=>({name:'第'+episode+'话',rows:[productionHeaders,...productionRows]}))).toString('base64')});
async function fixture(t){const parent=path.resolve('.runtime/temp');fs.mkdirSync(parent,{recursive:true});const dir=fs.mkdtempSync(path.join(parent,'batch-layout-')),calls=[];
 const fake={close(){},status:async()=>({connected:false}),generate(){calls.push('unexpected AI');throw Error('No real AI');}},studio=createStudio({dataDir:dir,bridge:fake,jimengBridge:fake,storyboardGenerator:fake});await new Promise(r=>studio.server.listen(0,'127.0.0.1',r));
 const origin='http://127.0.0.1:'+studio.server.address().port,api=async(route,method='GET',data)=>{const response=await fetch(origin+route,{method,headers:data?{'Content-Type':'application/json'}:{},body:data?JSON.stringify(data):undefined});return {status:response.status,data:await response.json()};};
 t.after(async()=>{studio.close();await new Promise(r=>studio.server.close(r));assert.equal(path.dirname(dir),parent);fs.rmSync(dir,{recursive:true,force:true});});return {api,studio,calls,dir};
}

test('one import matches out-of-order JSON files to real episodes and compiles immediately without AI or aesthetic gates',async t=>{
 const {api,calls}=await fixture(t),result=await api('/api/projects/storyboard-import','POST',{...input(),layoutFiles:[file(13,'solo-hero'),file(11)]});assert.equal(result.status,201,JSON.stringify(result.data));const {importReport,...p}=result.data;
 assert.equal(importReport.applied,2);assert.deepEqual(importReport.pendingEpisodes,[12]);assert.equal(p.pages[0].panels.length,2);assert.equal(p.pages[1].panels.length,0);assert.equal(p.pages[2].panels.length,2);assert.ok(p.pages[2].panels.every(f=>f.w===1280));assert.deepEqual(calls,[]);assert.equal(p.designWorkflow,undefined);assert.equal(p.layoutImports.episodes.length,2);assert.ok(p.layoutImports.episodes.every(e=>e.plan.designRules==='disabled'));assert.equal(p.sourceOriginalFiles.filter(f=>f.role==='layoutPlan').length,2);
 const restored=await api('/api/projects/import','POST',(await api('/api/projects/'+p.id+'/export')).data);assert.equal(restored.status,201,JSON.stringify(restored.data));assert.equal(restored.data.layoutImports.episodes.length,2);
});
test('failed, duplicate and unmatched JSONs never block valid episodes or create local fallback layouts',async t=>{
 const {api,calls}=await fixture(t),result=await api('/api/projects/storyboard-import','POST',{...input(),layoutFiles:[file(11),file(12),file(12,'solo-mid'),file(99),{name:'broken.json',text:'{'},{name:'bad-component.json',text:JSON.stringify(plan(13,'invented-component'))}]});assert.equal(result.status,201,JSON.stringify(result.data));const p=result.data;assert.equal(p.importReport.applied,1);assert.equal(p.importReport.failed,5);assert.ok(p.pages[0].panels.length);assert.equal(p.pages[1].panels.length,0);assert.equal(p.pages[2].panels.length,0);assert.deepEqual(calls,[]);
 const before=(await api('/api/projects/'+p.id)).data,failed=await api('/api/projects/storyboard-import','POST',{projectId:p.id,expectedRevision:p.revision,layoutFiles:[{name:'bad.json',text:'{'}]});assert.equal(failed.status,200);assert.equal(failed.data.importReport.failed,1);assert.deepEqual((await api('/api/projects/'+p.id)).data,before);
});

test('JSON-only batch fills pending episodes in the current project without reimporting the table',async t=>{
 const {api,calls}=await fixture(t),p=(await api('/api/projects/storyboard-import','POST',input())).data,result=await api('/api/projects/storyboard-import','POST',{projectId:p.id,expectedRevision:p.revision,layoutFiles:[file(12),file(11)]});assert.equal(result.status,200,JSON.stringify(result.data));assert.equal(result.data.id,p.id);assert.deepEqual(result.data.shots,p.shots);assert.ok(result.data.pages[0].panels.length&&result.data.pages[1].panels.length);assert.equal(result.data.pages[2].panels.length,0);assert.deepEqual(calls,[]);
});
test('multi-episode table import supports more than 800 source rows without changing legacy project limits',async t=>{
 const {api}=await fixture(t),rows=Array.from({length:30},(_,i)=>productionRows[i%2].map((v,k)=>k===0?String(i+1):v)),dataBase64=writeXlsx(Array.from({length:30},(_,i)=>({name:'第'+(i+1)+'话',rows:[productionHeaders,...rows]}))).toString('base64'),result=await api('/api/projects/storyboard-import','POST',{name:'900格合成.xlsx',dataBase64});assert.equal(result.status,201,JSON.stringify(result.data));assert.equal(result.data.shots.length,900);assert.equal(result.data.pages.length,30);
});
test('batch reimport preserves intentionally removed frames and archived dialogue rather than regenerating them',async t=>{
 const {api,studio}=await fixture(t),p=(await api('/api/projects/storyboard-import','POST',{...input(),layoutFiles:[file(11)]})).data,live=studio.store.project(p.id),before=structuredClone(live),page=live.pages[0];page.bubbles=[];page.panels.splice(1,1);archiveRemovedDialogue(live,before);studio.store.save();const result=await api('/api/projects/storyboard-import','POST',{projectId:p.id,expectedRevision:live.revision,layoutFiles:[file(11,'solo-mid')]});assert.equal(result.status,200,JSON.stringify(result.data));assert.equal(result.data.importReport.applied,1,JSON.stringify(result.data.importReport));assert.equal(result.data.pages[0].panels.length,1);assert.equal(result.data.pages[0].bubbles.length,0);assert.deepEqual(result.data.archivedBubbles,live.archivedBubbles);
});
test('batch imports never dispatch operations or asset requests embedded in a full design plan',async t=>{
 const {api,calls,studio}=await fixture(t),p=(await api('/api/projects/storyboard-import','POST',input())).data,raw={format:'comic-design-plan-v2',scope:{episode:11},layoutPlan:plan(11),operations:[{id:'generate-image',tool:'panel.generate',target:{kind:'unit',unitId:'E011-001'},args:{}}],assetRequests:[{kind:'panel-main',unitId:'E011-001',provider:'codex'}]},r=await api('/api/projects/storyboard-import','POST',{projectId:p.id,expectedRevision:p.revision,layoutFiles:[{name:'full.json',text:JSON.stringify(raw)}]});assert.equal(r.status,200,JSON.stringify(r.data));assert.equal(r.data.importReport.applied,1,JSON.stringify(r.data.importReport));assert.deepEqual(calls,[]);assert.equal(studio.store.db.jobs.length,0);
});
