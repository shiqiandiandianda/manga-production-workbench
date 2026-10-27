import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createStudio} from '../server.mjs';
import {writeXlsx} from '../lib/xlsx.mjs';


import {productionHeaders,productionRows} from './helpers/storyboard-production.mjs';



test('manual JSON accepts a previously rejected design, applies, exports and undoes while preserving sources and images',async t=>{
 const parent=path.resolve('.runtime/temp');fs.mkdirSync(parent,{recursive:true});const dir=fs.mkdtempSync(path.join(parent,'direct-json-')),fake={close(){},status:async()=>({connected:false}),generate(){throw Error('No AI calls');}};
 const studio=createStudio({dataDir:dir,bridge:fake,jimengBridge:fake,storyboardGenerator:fake});await new Promise(r=>studio.server.listen(0,'127.0.0.1',r));t.after(async()=>{studio.close();await new Promise(r=>studio.server.close(r));assert.equal(path.dirname(dir),parent);fs.rmSync(dir,{recursive:true,force:true});});
 const base='http://127.0.0.1:'+studio.server.address().port,api=async(route,method='GET',data)=>{const r=await fetch(base+route,{method,headers:data?{'Content-Type':'application/json'}:{},body:data?JSON.stringify(data):undefined});return {status:r.status,data:await r.json()};};
 let p=(await api('/api/projects/storyboard-import','POST',{name:'第11话合成.xlsx',dataBase64:writeXlsx([{name:'第11话',rows:[productionHeaders,...productionRows]}]).toString('base64')})).data;const shots=structuredClone(p.shots),plan={spreads:[{spread:'solo-mid',units:['E011-001']},{spread:'solo-mid',units:['E011-002']}]};
 let imported=await api('/api/projects/'+p.id+'/design-plans/import','POST',{expectedRevision:p.revision,aiOnly:true,episode:11,plan});assert.equal(imported.status,200,JSON.stringify(imported.data));assert.equal(imported.data.preview.gate.skipped,true);assert.equal(imported.data.preview.reviews.rule,'not-required');assert.deepEqual(imported.data.project.shots,shots);assert.equal(imported.data.project.pages[0].panels.length,0);p=imported.data.project;
 const planId=imported.data.planId;let applied=await api('/api/projects/'+p.id+'/design-plans/'+planId+'/apply','POST',{expectedRevision:p.revision});assert.equal(applied.status,200,JSON.stringify(applied.data));p=applied.data.project;assert.equal(p.pages[0].panels.length,2);assert.deepEqual(p.shots,shots);assert.equal(applied.data.report.gate.skipped,true);
 const exported=await api('/api/projects/'+p.id+'/design-plans/'+planId+'/export');assert.equal(exported.data.plan.layoutPlan.designRules,'disabled');
 const undone=await api('/api/projects/'+p.id+'/design-plans/'+planId+'/undo','POST',{expectedRevision:p.revision});assert.equal(undone.status,200,JSON.stringify(undone.data));p=undone.data.project;assert.equal(p.pages[0].panels.length,0);assert.deepEqual(p.shots,shots);
 const invalid=await api('/api/projects/'+p.id+'/design-plans/import','POST',{expectedRevision:p.revision,aiOnly:true,episode:11,plan:{spreads:[{spread:'bad-component',units:['E011-001']}]}});assert.equal(invalid.status,422);assert.ok(invalid.data.problems.some(p=>p.code==='spread-unknown'));assert.equal((await api('/api/projects/'+p.id)).data.revision,p.revision);
});
