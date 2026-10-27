import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {writeXlsx} from '../lib/xlsx.mjs';
import {fixture,binding,verifyOriginalRows,originalRows,root,headers,hash} from './helpers/preflight-batch-fixture.mjs';

const endpoint=s=>'/api/storyboards/check/'+s.id;
const report=(f,label,extra)=>fs.writeFileSync(path.join(f.runDirectory,label+'.json'),JSON.stringify({ok:true,codeRoot:root,dataRoot:f.dataDir,realAI:false,realLogin:false,userEndpointWrites:false,...extra},null,2));

test('规则批处理：默认全文件，支持当前话范围，原剧情/对白/枚举原值审计均保留',async t=>{
  const f=await fixture(t,'api-rules'),before=fs.readFileSync(f.studio.store.file,'utf8');
  let s=await f.start();assert.equal(s.sheets.length,3);assert.ok(s.sheets.every(sheet=>sheet.blocking>0));
  const selected=await f.request(endpoint(s)+'/batch','POST',{...binding(s),mode:'rules',scope:'selected'});
  assert.equal(selected.status,200,JSON.stringify(selected.data));s=selected.data;
  assert.equal(s.summary.ready,true);assert.equal(s.sheets[0].blocking,0);assert.ok(s.sheets.slice(1).every(sheet=>sheet.blocking>0));verifyOriginalRows(assert,s);
  const all=await f.request(endpoint(s)+'/batch','POST',{...binding(s),mode:'rules',scope:'all'});
  assert.equal(all.status,200,JSON.stringify(all.data));s=all.data;
  assert.equal(s.sheet,'第1话');assert.ok(s.sheets.every(sheet=>sheet.blocking===0&&sheet.warnings===0));
  const processed=s;
  for(const sheet of s.sheets){
    if(sheet.name!==s.sheet){const changed=await f.request(endpoint(s),'PATCH',{...binding(s),selectSheet:sheet.name});assert.equal(changed.status,200);s=changed.data;}
    verifyOriginalRows(assert,s);
    const confirmed=await f.request(endpoint(s)+'/confirm','POST',binding(s));assert.equal(confirmed.status,200,JSON.stringify(confirmed.data));
    assert.equal(confirmed.data.shots.length,8);assert.deepEqual(confirmed.data.shots.map(row=>row.description),originalRows(sheet.name).map(row=>row[1]));
    assert.deepEqual(confirmed.data.shots.map(row=>row.dialogue),originalRows(sheet.name).map(row=>row[2]));
    assert.ok(confirmed.data.audit.decisions.some(d=>d.sheet===sheet.name&&d.originalValue==='高位俯拍'));
    assert.ok(confirmed.data.audit.decisions.some(d=>d.sheet===sheet.name&&d.originalValue==='中全景'));
  }
  const stale=await f.request(endpoint(s)+'/batch','POST',{...binding(processed),mode:'rules',scope:'all'});assert.equal(stale.status,409);
  assert.equal(fs.readFileSync(f.studio.store.file,'utf8'),before);assert.deepEqual(f.generatorCalls,[]);assert.deepEqual(f.providerCalls,[]);
  report(f,'rules',{worksheets:processed.sheets,decisions:processed.decisions,sourceRows:24,originalTextPreserved:true});
});

test('Codex 批处理：一次请求多表整理，文本运输 mock 与规则补全，不创建项目',async t=>{
  const f=await fixture(t,'api-codex',{generate:async({onProgress})=>{onProgress?.({message:'合成 Codex 正在整理',type:'progress'});return [];}}),before=fs.readFileSync(f.studio.store.file,'utf8');
  const s=await f.start(),started=await f.request(endpoint(s)+'/batch','POST',{...binding(s),mode:'codex',scope:'all'});
  assert.equal(started.status,202,JSON.stringify(started.data));const job=await f.job(s,started.data.id);
  assert.equal(job.status,'completed',JSON.stringify(job));assert.ok(job.result.sheets.every(sheet=>sheet.blocking===0&&sheet.warnings===0));
  assert.equal(job.result.sheet,s.sheet);verifyOriginalRows(assert,job.result);assert.equal(f.generatorCalls.length,1);assert.equal(f.generatorCalls[0].outputKind,'preflight');
  assert.ok(f.generatorCalls[0].directory.startsWith(f.dataDir));assert.ok(f.generatorCalls[0].prompt.includes('前景遮挡'));assert.ok(!f.generatorCalls[0].prompt.includes('原剧情'));assert.deepEqual(f.providerCalls,[]);
  const confirmed=await f.request(endpoint(s)+'/confirm','POST',binding(job.result));assert.equal(confirmed.status,200);
  assert.equal(fs.readFileSync(f.studio.store.file,'utf8'),before);report(f,'codex',{job,transportCalls:f.generatorCalls.length,originalTextPreserved:true});
});

test('Codex 错误和非法决策原子失败：保留全部问题与版本，可直接改用规则批处理',async t=>{
  for(const [name,generate] of [['transport-error',async()=>{throw Error('合成 Codex 失败');}],['invalid-decision',async()=>[{issueId:'不存在的问题',action:'edit',field:'cameraAngle',value:'俯拍'}]]]){
    const f=await fixture(t,'api-'+name,{generate}),s=await f.start();
    const started=await f.request(endpoint(s)+'/batch','POST',{...binding(s),mode:'codex',scope:'all'});assert.equal(started.status,202);
    const job=await f.job(s,started.data.id);assert.equal(job.status,'failed',JSON.stringify(job));
    const untouched=await f.request(endpoint(s),'PATCH',{...binding(s),selectSheet:s.sheet});assert.equal(untouched.status,200,JSON.stringify(untouched.data));
    assert.deepEqual(untouched.data.decisions,[]);assert.deepEqual(untouched.data.rows,s.rows);assert.deepEqual(untouched.data.sheets,s.sheets);
    const recovered=await f.request(endpoint(s)+'/batch','POST',{...binding(untouched.data),mode:'rules',scope:'all'});assert.equal(recovered.status,200);assert.ok(recovered.data.sheets.every(sheet=>sheet.blocking===0));
    assert.deepEqual(f.providerCalls,[]);report(f,name,{job,recovered:recovered.data.sheets,atomicFailure:true});
  }
});

test('Codex 取消及版本变化：晚到结果不能覆盖检查会话',async t=>{
  for(const kind of ['cancelled','stale']){
    let entered,release;const invoked=new Promise(resolve=>entered=resolve),waiting=new Promise(resolve=>release=resolve);
    const f=await fixture(t,'api-'+kind,{generate:async()=>{entered();await waiting;return [];}}),s=await f.start();
    const started=await f.request(endpoint(s)+'/batch','POST',{...binding(s),mode:'codex',scope:'all'});assert.equal(started.status,202);await invoked;
    let bound=s;
    if(kind==='cancelled'){const cancelled=await f.request(endpoint(s)+'/batch/'+started.data.id,'DELETE');assert.equal(cancelled.status,200);}
    else{const changed=await f.request(endpoint(s),'PATCH',{...binding(s),selectSheet:'第2话'});assert.equal(changed.status,200);bound=changed.data;}
    release();const job=await f.job(s,started.data.id);
    assert.notEqual(job.status,'completed',JSON.stringify(job));if(kind==='cancelled')assert.equal(job.status,'cancelled');
    const unchanged=await f.request(endpoint(s),'PATCH',{...binding(bound),selectSheet:bound.sheet});assert.equal(unchanged.status,200,JSON.stringify(unchanged.data));
    assert.deepEqual(unchanged.data.decisions,[]);assert.deepEqual(unchanged.data.sheets,s.sheets);verifyOriginalRows(assert,unchanged.data);
    assert.deepEqual(f.providerCalls,[]);report(f,kind,{job,lateResultIgnored:true});
  }
});

test('十话重复字段仅调用一次Codex；独特用语的最后一批失败时全部回滚',async t=>{
  const workbook=writeXlsx(Array.from({length:10},(_,index)=>({name:'第'+(index+1)+'话',rows:[headers,...Array.from({length:32},(_,row)=>{
    const original=originalRows('第1话')[row%8];
    return ['S'+String(row+1).padStart(2,'0'),'第'+(index+1)+'话第'+(row+1)+'格合成原剧情。','甲：第'+(index+1)+'话原对白 '+(row+1)+'！',original[3],original[4]];
  })]}))),sourceHash=hash(workbook);
  for(const kind of ['completed','last-chunk-failed']){
    const fileBytes=kind==='completed'?workbook:writeXlsx(Array.from({length:10},(_,index)=>({name:'第'+(index+1)+'话',rows:[headers,...Array.from({length:32},(_,row)=>['S'+row,'合成原剧情 '+index+'-'+row,'甲：原对白 '+row,'中景','未知机位-'+index+'-'+row])]})));
    let calls=0;const f=await fixture(t,'api-large-'+kind,{generate:async()=>{calls++;if(kind==='last-chunk-failed'&&calls===8)throw Error('合成最后一批失败');return [];}});
    const file=path.join(f.runDirectory,'十话320格合成文件.xlsx');fs.writeFileSync(file,fileBytes);
    const first=await f.request('/api/storyboards/check','POST',{name:path.basename(file),dataBase64:fileBytes.toString('base64')});assert.equal(first.status,200);const s=first.data;
    assert.equal(s.sheets.length,10);assert.equal(s.sheets.reduce((n,sheet)=>n+sheet.rows,0),320);
    const started=await f.request(endpoint(s)+'/batch','POST',{...binding(s),mode:'codex',scope:'all'});assert.equal(started.status,202);
    const job=await f.job(s,started.data.id);assert.equal(calls,job.totalChunks);
    if(kind==='completed'){
      assert.equal(job.status,'completed',JSON.stringify(job));assert.equal(job.totalChunks,1);assert.ok(job.uniqueIssues<=4);assert.ok(job.localIssues>200);assert.equal(job.completedChunks,1);assert.ok(job.result.sheets.every(sheet=>sheet.blocking===0&&sheet.warnings===0));
      assert.equal(job.result.version,s.version+1,'all chunks commit as one version');assert.equal(job.result.sheet,'第1话');
      assert.deepEqual(job.result.rows.map(row=>[row.description,row.dialogue]),s.rows.map(row=>[row.description,row.dialogue]));
    }else{
      assert.equal(job.status,'failed');assert.equal(job.totalChunks,8);assert.equal(job.completedChunks,7);
      const current=await f.request(endpoint(s),'PATCH',{...binding(s),selectSheet:s.sheet});assert.equal(current.status,200,'same initial version remains valid after a later chunk fails');
      assert.deepEqual(current.data.rows,s.rows);assert.deepEqual(current.data.decisions,[]);assert.deepEqual(current.data.sheets,s.sheets);
    }
    assert.equal(hash(fs.readFileSync(file)),hash(fileBytes));assert.deepEqual(f.providerCalls,[]);assert.deepEqual(f.studio.store.db.projects,[]);
    report(f,'large',{job,worksheets:10,rows:320,initialIssues:s.workbookIssues.length,transportCalls:calls,originalWorkbookUnchanged:true,atomicAcrossAllChunks:true});
  }
});
