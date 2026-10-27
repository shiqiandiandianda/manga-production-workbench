import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createStudio} from '../server.mjs';
import {writeXlsx} from '../lib/xlsx.mjs';
import {normalizeRows} from '../public/model.js';

import {ensureProjectPanelGeneration} from '../public/panel-generation.js';

import {setPanelReferences} from '../public/panel-references.js';
import {assetNeeds} from '../public/asset-auto-bind.js';

import {productionHeaders,productionRows,productionObjects} from './helpers/storyboard-production.mjs';

const require=createRequire(import.meta.url),{createCanvas}=require(process.env.COMIC_TEST_CANVAS_MODULE);
const ctx=()=>createCanvas(8,8).getContext('2d');


test('explicit main/sub column wins over note markers; no role guessing from free prose',()=>{
 const row=productionObjects()[0];row['主副格']='副格';row['画面备注']='【主格】旁边的细节';assert.equal(normalizeRows([row])[0].declaredPanelRole,'sub');
 row['主副格']='';row['画面备注']='【副格】手部细节';assert.equal(normalizeRows([row])[0].declaredPanelRole,'sub');
 row['画面备注']='不要改变其他主格的内容';assert.equal(normalizeRows([row])[0].declaredPanelRole,undefined);
});

async function fixture(t){
 const parent=path.resolve('.runtime/temp');fs.mkdirSync(parent,{recursive:true});const dir=fs.mkdtempSync(path.join(parent,'storyboard-production-')),calls=[];
 const canvas=createCanvas(64,64),context=canvas.getContext('2d');context.fillStyle='#61b49d';context.fillRect(0,0,64,64);const png=canvas.toBuffer('image/png');
 const bridge={close(){},status:async()=>({connected:true,imageFeature:true}),generate:async(_dir,input,refs)=>{calls.push({input:structuredClone(input),refs:[...refs]});const filePath=path.join(dir,'fake-result.png');fs.writeFileSync(filePath,png);return {filePath,imageToolSeen:true};}};
 const studio=createStudio({dataDir:path.join(dir,'data'),bridge,jimengBridge:bridge,storyboardGenerator:{close(){},generate(){throw Error('No source generation');}}});
 await new Promise(r=>studio.server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+studio.server.address().port;
 t.after(async()=>{studio.close();await new Promise(r=>studio.server.close(r));assert.equal(path.dirname(path.resolve(dir)),parent);fs.rmSync(dir,{recursive:true,force:true});});
 const api=async(route,method='GET',value)=>{const res=await fetch(origin+route,{method,headers:value?{'Content-Type':'application/json'}:undefined,body:value?JSON.stringify(value):undefined});return {status:res.status,value:await res.json()};};
 return {dir,studio,calls,api,png};
}
test('retired novel, client, feedback and outline routes cannot create data or serve their UI',async t=>{
 const {api,studio,calls}=await fixture(t),before=JSON.stringify(studio.store.db);
 for(const route of ['/api/projects/project_synthetic/storyboard','/api/projects/project_synthetic/storyboard/generate','/api/projects/project_synthetic/novel-production','/api/projects/project_synthetic/novel-production/jobs','/api/projects/project_synthetic/episode-outline','/novel-production-ui.js','/novel-storyboard-workspace.js','/novel-job-progress-ui.js','/storyboard-workflow.js']){
  const r=await api(route);assert.equal(r.status,404,route);assert.equal(r.value.code,'content_workflow_removed');
 }
 assert.equal((await api('/api/projects/project_synthetic/novel-production','POST',{operation:'generate'})).status,404);
 assert.equal(JSON.stringify(studio.store.db),before);assert.deepEqual(calls,[]);
 const health=(await api('/api/health')).value;assert.equal(health.workflow,'storyboard-production');assert.deepEqual(health.contentInputs,['storyboard-table','layout-plan-json']);assert.equal(health.novelProduction,undefined);
});
test('XLSX import goes straight to layout, references, fake generation, manual edit and project reopen',async t=>{
 const {api,dir,png,calls}=await fixture(t),workbook=writeXlsx([{name:'第1话',rows:[productionHeaders,...productionRows]}]);
 // The current importer consumes the workbook and explicit JSON layout in one request.
 const retired=await api('/api/storyboards/check','POST',{});assert.equal(retired.status,404);assert.equal(retired.value.code,'local_layout_removed');
 const saved=await api('/api/projects/storyboard-import','POST',{name:'合成分镜.xlsx',dataBase64:workbook.toString('base64'),layoutFiles:[{name:'第1话.json',text:JSON.stringify({episode:1,spreads:[{spread:'half-pair',units:['E001-001','E001-002']}]})}]});assert.equal(saved.status,201,JSON.stringify(saved.value));
 let p=saved.value;assert.equal(p.storyboardWorkflow,undefined);assert.equal(p.novelProductionWorkflow,undefined);assert.equal(p.shots[0].weather,'小雨');
 const reference=path.join(dir,'石桥.png');fs.writeFileSync(reference,png);const registered=await api('/api/assets','POST',{filePath:reference,libraryRole:'scene'});assert.equal(registered.status,201);
 ensureProjectPanelGeneration(p,[registered.value]);const frame=p.pages[0].panels[0];setPanelReferences(frame,[registered.value.id],{project:p,assets:[registered.value]});
 p=(await api('/api/projects/'+p.id,'PUT',p)).value;
 const job=await api('/api/jobs','POST',{projectId:p.id,panelIds:[frame.id],provider:'codex'});assert.equal(job.status,202,JSON.stringify(job.value));
 let state;for(let i=0;i<150;i++){state=(await api('/api/state')).value;if(state.jobs.every(j=>!['queued','running'].includes(j.status)))break;await new Promise(r=>setTimeout(r,20));}
 assert.equal(state.jobs[0].applied,true);assert.equal(calls.length,1);assert.match(calls[0].input.shot.productionPrompt,/小雨/);assert.deepEqual(calls[0].refs,[reference]);
 p=state.projects.find(v=>v.id===p.id);const generated=p.pages[0].panels.find(v=>v.id===frame.id);assert.ok(generated.imageAssetId);const image=generated.imageAssetId;
 generated.generation.prompt='人工检查后：甲右手握伞，保留石桥和白衣';const edited=await api('/api/projects/'+p.id,'PUT',p);assert.equal(edited.status,200,JSON.stringify(edited.value));
 const exported=await api('/api/projects/'+p.id+'/export'),restored=await api('/api/projects/import','POST',exported.value);assert.equal(restored.status,201,JSON.stringify(restored.value));
 const reopened=restored.value.pages[0].panels[0];assert.equal(reopened.generation.prompt,generated.generation.prompt);assert.ok(reopened.imageAssetId);assert.ok(image);assert.equal(reopened.generation.referenceRoles.length,1);assert.equal(restored.value.shots[1].declaredPanelRole,'sub');
});
