import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createStudio} from '../server.mjs';
import {writeXlsx} from '../lib/xlsx.mjs';
import {readStoryboardData} from '../lib/storyboard-data.mjs';


import {storyboardEpisodes} from '../public/storyboard-episodes.js';


import {productionHeaders,productionRows} from './helpers/storyboard-production.mjs';
const input=()=>({name:'第11到12话合成分镜.xlsx',dataBase64:writeXlsx([11,12].map(episode=>({name:'第'+episode+'话',rows:[productionHeaders,...productionRows.map(row=>row.map((v,i)=>i===6?'自定义低位侧视':v))]}))).toString('base64')});
const plan=episode=>({episode,spreads:[{spread:'est-panorama',units:['E'+String(episode).padStart(3,'0')+'-001','E'+String(episode).padStart(3,'0')+'-002'],pace:'normal',slots:[{},{}]}]});


async function fixture(t,{failure=false,generate}={}){
 const parent=path.resolve('.runtime/temp');fs.mkdirSync(parent,{recursive:true});const dir=fs.mkdtempSync(path.join(parent,'imported-director-')),calls=[];
 const fake={close(){},status:async()=>({connected:false}),generate(){throw Error('No image calls');}},generator={close(){},generate:async args=>{calls.push(args);if(failure)throw Error('Synthetic AI transport failure');if(generate)return generate(args,calls.length);return plan(/第12话/.test(args.prompt)?12:11);}};
 const studio=createStudio({dataDir:path.join(dir,'data'),bridge:fake,jimengBridge:fake,storyboardGenerator:generator});await new Promise(r=>studio.server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+studio.server.address().port;
 t.after(async()=>{studio.close();await new Promise(r=>studio.server.close(r));assert.equal(path.dirname(dir),parent);fs.rmSync(dir,{recursive:true,force:true});});
 const api=async(route,method='GET',data)=>{const response=await fetch(origin+route,{method,headers:data?{'Content-Type':'application/json'}:undefined,body:data?JSON.stringify(data):undefined});return {status:response.status,data:await response.json()};};
 return {studio,calls,api,origin};
}

test('AI requests use actual episode and layout-plan output; a failed channel leaves zero arranged panels',async t=>{
 const {api,calls}=await fixture(t,{failure:true}),imported=await api('/api/projects/storyboard-import','POST',input()),p=imported.data;
 let r=await api('/api/projects/'+p.id+'/design-runs','POST',{expectedRevision:p.revision,episode:12,aiOnly:true,count:1});assert.equal(r.status,202,JSON.stringify(r.data));const id=r.data.run.id;
 for(let i=0;i<100;i++){r=await api('/api/projects/'+p.id+'/design-runs/'+id);if(!['queued','running'].includes(r.data.run.status))break;await new Promise(r=>setTimeout(r,10));}
 assert.equal(r.data.run.status,'failed');assert.equal(calls[0].outputKind,'layout-plan');assert.match(calls[0].prompt,/第12话/);assert.ok(r.data.project.pages.every(page=>!page.panels.length));assert.equal(r.data.project.ruleLayout,undefined);
});
test('AI validation retry records the actual reason and request number, then exits to needs_review without local fallback',async t=>{
 const {api,calls}=await fixture(t,{generate:async args=>{args.onProgress({stage:'reasoning',message:'Synthetic activity',activityAgeMs:500,reasoningEvents:3});return {spreads:[{spread:'invented-component',units:['E011-001','E011-002']}]};}}),p=(await api('/api/projects/storyboard-import','POST',input())).data;
 const launched=await api('/api/projects/'+p.id+'/design-runs','POST',{expectedRevision:p.revision,episode:11,aiOnly:true,count:1});let result;
 for(let i=0;i<100;i++){result=await api('/api/projects/'+p.id+'/design-runs/'+launched.data.run.id);if(!['queued','running'].includes(result.data.run.status))break;await new Promise(r=>setTimeout(r,10));}
 const {run,project}=result.data;assert.equal(run.status,'needs_review');assert.equal(calls.length,2);assert.ok(run.progressHistory.some(item=>item.stage==='validation/retry'&&item.problems?.length));assert.equal(run.progress.stage,'validation/failed');assert.equal(run.progress.attempt,2);assert.equal(run.progress.reasoningEvents,3);assert.ok(run.progress.lastActivityAt);assert.ok(project.pages.every(page=>!page.panels.length));
});
test('retired local checker and rule-layout APIs cannot revive the old workflow',async t=>{
 const {api}=await fixture(t);for(const route of ['/api/projects/rule-layout','/api/storyboards/check','/rule-ui.js','/storyboard-check-ui.js']){const r=await api(route);assert.equal(r.status,404);assert.equal(r.data.code,'local_layout_removed');}
 const health=(await api('/api/health')).data;assert.equal(health.layoutEngine,'ai-director-components');assert.equal(health.aiLayoutPlanRequired,true);
});



