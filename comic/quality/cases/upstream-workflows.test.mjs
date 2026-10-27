import test from 'node:test';
import assert from 'node:assert/strict';
import {createEpisodeGenerationBatches} from '../../lib/episode-generation-batches.mjs';
import {projectFileName,saveProjectFile} from '../../public/project-file-save.js';

test('batch submits each eligible panel once, skips ineligible panels and waits between waves', async () => {
  const db={jobs:[]}; let now=1000, calls=[];
  const queue=createEpisodeGenerationBatches({db,save:()=>{},clock:()=>now,random:()=>0,capacity:()=>2,
    select:(_plan,id)=>id==='skip'?'已完成':'',
    submit:async (input,hooks)=>{hooks.beforeCommit(); calls.push([...input.panelIds]); const jobs=input.panelIds.map(id=>({id,status:'queued'}));db.jobs.push(...jobs);hooks.onCommitted(jobs);}});
  const plan=queue.start({projectId:'p',episode:1,pageId:'pg',panelIds:['a','skip','b','c'],request:{provider:'codex'}});
  assert.equal(queue.start({projectId:'p',episode:1,pageId:'pg',panelIds:['x'],request:{provider:'codex'}}),plan);
  await queue.tick(); assert.deepEqual(calls,[['a','b']]); assert.equal(queue.snapshot()[0].skipped,1);
  for(const job of db.jobs)job.status='done'; await queue.tick();
  assert.equal(plan.state,'waiting'); assert.equal(plan.nextAt,61000); await queue.tick(); assert.equal(calls.length,1);
  now=61000; await queue.tick(); assert.deepEqual(calls,[['a','b'],['c']]);
  db.jobs.at(-1).status='done'; await queue.tick();
  assert.equal(plan.state,'done'); assert.equal(queue.snapshot()[0].finished,3); assert.equal(queue.active().length,0); queue.close();
});

test('stopping an in-flight batch prevents a delayed commit and any later wave', async () => {
  const db={jobs:[]};let release;const gate=new Promise(resolve=>release=resolve);let committed=false;
  const queue=createEpisodeGenerationBatches({db,save:()=>{},capacity:()=>1,select:()=>'',
    submit:async (_input,hooks)=>{await gate;hooks.beforeCommit();committed=true;}});
  const plan=queue.start({projectId:'p',episode:1,pageId:'pg',panelIds:['a','b'],request:{provider:'codex'}});
  const run=queue.tick();queue.stop(plan.id);release();await run;await queue.tick();
  assert.equal(plan.state,'stopped');assert.equal(committed,false);assert.equal(db.jobs.length,0);queue.close();
});

function mockHandle() {
  let bytes='',stamp={lastModified:42,size:3},writes=0;
  return {name:'工程.json',requestPermission:async()=> 'granted',getFile:async()=>stamp,
    createWritable:async()=>({write:async value=>{writes++;bytes=value;},close:async()=>{stamp={lastModified:43,size:bytes.length};},abort:async()=>{}}),
    content:()=>bytes,writes:()=>writes,change:()=>{stamp={lastModified:99,size:3};}};
}
test('local project save writes the selected project and protects externally modified files', async () => {
  const handle=mockHandle();let flushes=0;
  const options={projectId:'p',title:'测试/工程',chooseFile:async()=>handle,flushSave:async()=>{flushes++;},exportProject:async id=>({id}),currentProjectId:()=> 'p'};
  assert.equal(projectFileName('测试/工程'),'测试_工程.json');
  const first=await saveProjectFile(options);assert.equal(first.cancelled,false);assert.deepEqual(JSON.parse(handle.content()),{id:'p'});assert.equal(flushes,1);
  handle.change();await assert.rejects(saveProjectFile({...options,binding:first.binding}),/其他窗口或程序修改/);assert.equal(handle.writes(),1);
});

test('cancelled or switched project save never writes a file', async () => {
  const handle=mockHandle();let flushes=0;
  const options={projectId:'p',title:'工程',chooseFile:async()=>{const e=Error('cancel');e.name='AbortError';throw e;},flushSave:async()=>{flushes++;},exportProject:async()=>({}),currentProjectId:()=> 'p'};
  assert.equal((await saveProjectFile(options)).cancelled,true);assert.equal(flushes,0);
  await assert.rejects(saveProjectFile({...options,chooseFile:async()=>handle,currentProjectId:()=> 'other'}),/工程已切换/);assert.equal(handle.writes(),0);
});
