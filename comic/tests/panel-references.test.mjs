import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import {createStudio} from '../server.mjs';import {createProject,clone,id} from '../public/model.js';import {migrateLayerDocument} from '../public/layers.js';import {validateProject} from '../lib/store.mjs';
import {panelReferenceIds,referencesForPanel,panelReferenceKey,setPanelReferences,referenceCountError} from '../public/panel-references.js';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64');
test('panel overrides preserve inherited source, explicit empty, order, copy isolation and actual catalogue limits',()=>{
 const p=createProject('refs'),f=p.pages[0].panels[0],a={id:id('asset'),name:'scene',libraryRole:'scene'},b={id:id('asset'),name:'prop',libraryRole:'prop'};
 p.references=[{assetId:b.id,name:'道具',role:'prop'},{assetId:a.id,name:'场景',role:'scene'}];p.shots[0].referenceIds=[a.id,b.id];
 assert.deepEqual(panelReferenceIds(p,f),[a.id,b.id]);assert.deepEqual(referencesForPanel(p,f,[a,b]).map(r=>r.assetId),[a.id,b.id]);
 const copy=clone(f),key=panelReferenceKey(p,f,[a,b]);setPanelReferences(copy,[b.id]);assert.deepEqual(panelReferenceIds(p,f),[a.id,b.id]);assert.deepEqual(panelReferenceIds(p,copy),[b.id]);assert.notEqual(key,panelReferenceKey(p,copy,[a,b]));
 setPanelReferences(copy,[]);assert.deepEqual(panelReferenceIds(p,copy),[]);setPanelReferences(copy,null);assert.equal(copy.referenceIds,undefined);assert.deepEqual(panelReferenceIds(p,copy),[a.id,b.id]);
 assert.throws(()=>referencesForPanel(p,f,[a]),/不存在/);f.referenceIds=[a.id,a.id];assert.throws(()=>validateProject(p),/本格参考/);delete f.referenceIds;
 const model={modes:[{name:'i2i',references:{min:1,max:5,types:[{mediaType:'image',min:1,max:3}]}}]};assert.equal(referenceCountError(model,'i2i',3),'');assert.match(referenceCountError(model,'i2i',3,{edit:true}),/1—3.*当前 4.*底图/);assert.match(referenceCountError(model,'t2i',1),/图生图/);
});
async function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'comic-panel-refs-')),calls=[];let hold=null;
 const bridge={close(){},status:async()=>({connected:true,imageFeature:true}),generate:async(directory,input,refs)=>{calls.push({input:clone(input),refs:[...refs]});if(hold)await hold;const filePath=path.join(dir,'result-'+calls.length+'.png');fs.writeFileSync(filePath,png);return {filePath,imageToolSeen:true};}};
 const studio=createStudio({dataDir:path.join(dir,'data'),bridge,jimengBridge:{close(){},status:async()=>({connected:false,message:'synthetic'})}});await new Promise(r=>studio.server.listen(0,'127.0.0.1',r));
 const url='http://127.0.0.1:'+studio.server.address().port,request=async(route,method='GET',value)=>{const r=await fetch(url+route,{method,headers:value?{'Content-Type':'application/json'}:{},body:value?JSON.stringify(value):undefined});return {status:r.status,data:await r.json()};};
 const assets=[];for(const name of ['人物','场景','道具']){const filePath=path.join(dir,name+'.png');fs.writeFileSync(filePath,png);assets.push((await request('/api/assets','POST',{filePath,name})).data);}
 const p=migrateLayerDocument(createProject('synthetic panel refs')).project,f=p.pages[0].panels[0],copy=clone(f);copy.id=id('panel');p.pages[0].panels.push(copy);p.layerOrder.push(copy.id);p.references=[{assetId:assets[0].id,name:'人物',role:'character'}];studio.store.db.projects.push(p);studio.store.save();
 const save=async fn=>{const value=(await request('/api/projects/'+p.id)).data;fn(value);const result=await request('/api/projects/'+p.id,'PUT',value);assert.equal(result.status,200);return result.data;};
 const settle=async()=>{for(let i=0;i<150;i++){const s=(await request('/api/state')).data;if(s.jobs.every(j=>!['queued','running'].includes(j.status)))return s;await new Promise(r=>setTimeout(r,10));}throw Error('queue did not settle');};
 t.after(async()=>{studio.close();await new Promise(r=>studio.server.close(r));assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));fs.rmSync(dir,{recursive:true,force:true});});
 return {dir,p,f,copy,assets,calls,request,save,settle,studio,setHold:v=>hold=v};
}
test('request uses exact per-panel order and roles; save/export/import/reopen preserve library-only refs',async t=>{
 const x=await fixture(t),ids=[x.assets[2].id,x.assets[1].id];x.studio.store.asset(ids[0]).libraryRole='prop';x.studio.store.asset(ids[1]).libraryRole='scene';
 const saved=await x.save(p=>p.pages[0].panels[0].referenceIds=ids);
 const queued=await x.request('/api/jobs','POST',{projectId:x.p.id,panelIds:[x.f.id],provider:'codex',expectedRevision:saved.revision,referenceIdsByPanel:{[x.f.id]:ids}});assert.equal(queued.status,202);
 const state=await x.settle();assert.equal(state.jobs[0].applied,true);assert.deepEqual(x.calls[0].refs,ids.map(id=>x.studio.store.assetPath(id)));assert.deepEqual(x.calls[0].input.referenceRoles.map(r=>[r.assetId,r.role]),[[ids[0],'prop'],[ids[1],'scene']]);
 assert.equal(state.projects[0].pages[0].panels.at(-1).imageAssetId,null);assert.deepEqual(state.projects[0].pages[0].panels.at(-1).referenceIds,[x.assets[0].id]);assert.deepEqual(state.projects[0].references,x.p.references);
 const exported=(await x.request('/api/projects/'+x.p.id+'/export')).data;for(const id of ids)assert.ok(exported.assets.some(a=>a.id===id&&a.filePath&&!a.dataUrl));
 for(const id of ids)delete x.studio.store.asset(id).libraryRole;
 const imported=await x.request('/api/projects/import','POST',exported);assert.equal(imported.status,201);assert.deepEqual(imported.data.pages[0].panels[0].referenceIds,ids);assert.notEqual(imported.data.pages[0].panels[0].id,x.f.id);assert.equal(x.studio.store.asset(ids[0]).libraryRole,'prop');assert.equal(x.studio.store.asset(ids[1]).libraryRole,'scene');
});
test('reference edits during generation and rebinding prevent stale autofill while retaining candidates',async t=>{
 const x=await fixture(t);let release;x.setHold(new Promise(r=>release=r));const refs=[x.assets[1].id];await x.save(p=>p.pages[0].panels[0].referenceIds=refs);
 assert.equal((await x.request('/api/jobs','POST',{projectId:x.p.id,panelIds:[x.f.id],provider:'codex'})).status,202);
 for(let i=0;!x.calls.length&&i<100;i++)await new Promise(r=>setTimeout(r,10));assert.equal(x.calls.length,1);
 await x.save(p=>p.pages[0].panels[0].referenceIds=[x.assets[2].id]);release();const state=await x.settle(),frame=state.projects[0].pages[0].panels[0];assert.equal(state.jobs[0].applied,false);assert.equal(frame.imageAssetId,null);assert.equal(frame.candidates.length,1);
 const mismatch=await x.request('/api/jobs','POST',{projectId:x.p.id,panelIds:[x.f.id],provider:'codex',referenceIdsByPanel:{[x.f.id]:refs}});assert.equal(mismatch.status,409);assert.equal(x.calls.length,1);
});
test('explicit empty never falls back, missing original reports exact path and never invokes adapter',async t=>{
 const x=await fixture(t);await x.save(p=>p.pages[0].panels[0].referenceIds=[]);assert.equal((await x.request('/api/jobs','POST',{projectId:x.p.id,panelIds:[x.f.id],provider:'codex'})).status,202);await x.settle();assert.deepEqual(x.calls[0].refs,[]);
 const missing=x.assets[2];await x.save(p=>p.pages[0].panels[0].referenceIds=[missing.id]);fs.unlinkSync(missing.filePath);
 assert.equal((await x.request('/api/jobs','POST',{projectId:x.p.id,panelIds:[x.f.id],provider:'codex'})).status,202);const s=await x.settle();assert.equal(s.jobs.at(-1).status,'failed');assert.ok(s.jobs.at(-1).message.includes(missing.filePath));assert.equal(x.calls.length,1);
});
test('changing imported source mid-generation retains the result as a candidate',async t=>{
 const x=await fixture(t);let release;x.setHold(new Promise(r=>release=r));
 await x.save(p=>{p.pages[0].panels[0].referenceIds=[x.assets[1].id];p.shots.push({...clone(p.shots[0]),id:id('shot'),code:'NEW',description:'newly bound shot'});});
 assert.equal((await x.request('/api/jobs','POST',{projectId:x.p.id,panelIds:[x.f.id],provider:'codex'})).status,202);
 for(let i=0;!x.calls.length&&i<100;i++)await new Promise(r=>setTimeout(r,10));assert.equal(x.calls.length,1);
 const changed=await x.save(p=>p.pages[0].panels[0].shotId=p.shots.at(-1).id);release();const s=await x.settle();assert.equal(s.jobs[0].applied,false);assert.equal(s.projects[0].pages[0].panels[0].imageAssetId,null);assert.equal(s.projects[0].pages[0].panels[0].shotId,changed.shots.at(-1).id);assert.equal(s.projects[0].pages[0].panels[0].candidates.length,1);
});
