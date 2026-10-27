import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createStudio} from '../server.mjs';
import {createProject,panel,id} from '../public/model.js';
import {pageGenerationPanelIds,episodeGenerationPanelIds,panelGenerationAvailability} from '../public/generation-policy.js';
import {GenerationSettings} from '../lib/generation-settings.mjs';

const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check,message){for(let i=0;i<300;i++){if(check())return;await delay(10);}throw new Error(message);}

test('本页批量生图跳过已有图、隐藏、锁定、特效图和全部活动任务，不跨页',()=>{
  const make=(name,extra={})=>({id:name,visible:true,generation:{prompt:'合成镜头'},...extra});
  const page={panels:[make('new'),make('done',{imageAssetId:'old'}),make('hidden',{visible:false}),make('locked',{locked:true}),make('sfx',{sfxImage:true}),make('empty',{generation:{prompt:' '}}),make('submitting'),...['queued','running','awaiting_confirmation','recoverable'].map(status=>make(status))]};
  assert.deepEqual(pageGenerationPanelIds(page,['queued','running','awaiting_confirmation','recoverable'].map(status=>({panelId:status,status})),new Set(['submitting'])),['new']);
});

test('本格入口说明阻止原因，本话入口隔离话数并排除独立破窗前景',()=>{
 const make=(id,extra={})=>({id,visible:true,generation:{prompt:'合成提示词'},...extra}),a=make('a'),b=make('b'),foreground=make('fg',{breakoutForeground:{backgroundPanelId:'a'}}),old=make('old',{imageAssetId:'image'}),project={shots:[],pages:[{id:'p1',storyboard:{episode:11},panels:[a,foreground,old]},{id:'p2',storyboard:{episode:11},panels:[b]},{id:'p3',storyboard:{episode:12},panels:[make('other')]}]};
 assert.deepEqual(episodeGenerationPanelIds(project,project.pages[0]),['a','b']);assert.deepEqual(episodeGenerationPanelIds(project,project.pages[2]),['other']);
 assert.match(panelGenerationAvailability(null).reason,/选中/);assert.match(panelGenerationAvailability({...a,locked:true}).reason,/解锁/);assert.equal(panelGenerationAvailability(old).disabled,false,'显式本格生成允许重新生成已有图');assert.equal(panelGenerationAvailability(foreground).disabled,true);
 for(const status of ['queued','running','awaiting_confirmation','recoverable']){const jobs=[{panelId:'a',status}];assert.equal(panelGenerationAvailability(a,jobs).pending,true);assert.deepEqual(episodeGenerationPanelIds(project,project.pages[0],jobs),['b']);}
 assert.equal(panelGenerationAvailability(a,[],new Set(['a'])).reason,'正在提交…');
});

async function fixture(t,total){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'comic-page-generation-'));
  const calls=[],releases=[];
  const fake=provider=>({close(){},status:async()=>({connected:true,imageFeature:true}),generate:async()=>{calls.push(provider);await new Promise(resolve=>releases.push(resolve));return {bytes:png,imageToolSeen:true,description:'合成测试图，无真实生成'};}});
  const studio=createStudio({dataDir:directory,maxConcurrent:20,bridge:fake('codex'),jimengBridge:fake('jimeng'),storyboardGenerator:{close(){}}});
  await new Promise(resolve=>studio.server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{studio.close();releases.forEach(resolve=>resolve());await until(()=>studio.idle(),'mock cleanup');await new Promise(resolve=>studio.server.close(resolve));assert.equal(path.dirname(path.resolve(directory)),path.resolve(os.tmpdir()));fs.rmSync(directory,{recursive:true,force:true});});
  const project=createProject('本页生图合成测试',true);
  while(project.pages[0].panels.length<total){const shot={...structuredClone(project.shots[0]),id:id('shot'),code:'TEST'+project.shots.length};project.shots.push(shot);project.pages[0].panels.push(panel(shot.id,0,0,100,100));}
  studio.store.db.projects.push(project);studio.store.save();
  const origin='http://127.0.0.1:'+studio.server.address().port;
  const request=async(route,method='GET',value)=>{const response=await fetch(origin+route,{method,headers:value?{'Content-Type':'application/json'}:{},body:value?JSON.stringify(value):undefined});return {status:response.status,data:await response.json()};};
  const submit=(provider,panels)=>request('/api/jobs','POST',{projectId:project.id,panelIds:panels.map(p=>p.id),provider,...(provider==='jimeng'?{model:'mock-official-model',mode:'t2i'}:{})});
  return {directory,studio,project,calls,releases,request,submit};
}

for(const [provider,limit] of [['codex',8],['jimeng',20]])test(provider+' 可达到 '+limit+' 张并发，额外一张排队后补位',async t=>{
  const f=await fixture(t,limit+1);
  assert.equal((await f.request('/api/generation-settings','PUT',{provider,concurrency:limit})).status,200);
  assert.equal((await f.submit(provider,f.project.pages[0].panels.slice(0,limit+1))).status,202);
  await until(()=>f.calls.length===limit,'目标并发未达到');
  assert.equal(f.studio.generationSlots.snapshot().running,limit);
  await delay(40);assert.equal(f.calls.length,limit);
  f.releases[0]();await until(()=>f.calls.length===limit+1,'等待任务未补位');
  assert.equal(f.studio.generationSlots.snapshot().running,limit);
  f.releases.forEach(resolve=>resolve());await until(()=>f.studio.idle(),'tasks not complete');
});

test('调低并发不中断已运行任务，后续补位遵守新上限；设置持久化且非法范围被拒绝',async t=>{
  const f=await fixture(t,9);
  assert.equal((await f.request('/api/generation-settings','PUT',{provider:'codex',concurrency:8})).status,200);
  await f.submit('codex',f.project.pages[0].panels.slice(0,9));await until(()=>f.calls.length===8,'start eight');
  assert.equal((await f.request('/api/generation-settings','PUT',{provider:'codex',concurrency:3})).status,200);
  for(const concurrency of [2,9,3.5])assert.equal((await f.request('/api/generation-settings','PUT',{provider:'codex',concurrency})).status,400);
  for(const concurrency of [9,21])assert.equal((await f.request('/api/generation-settings','PUT',{provider:'jimeng',concurrency})).status,400);
  for(let i=0;i<5;i++){f.releases[i]();await until(()=>f.studio.store.db.jobs.filter(j=>j.status==='done').length===i+1,'finish image');}
  await delay(40);assert.equal(f.calls.length,8,'调低上限后不能提前补位');
  f.releases[5]();await until(()=>f.calls.length===9,'new lower limit not pumping');
  assert.equal(new GenerationSettings(f.directory,2).limits.codex,3);
  f.releases.forEach(resolve=>resolve());await until(()=>f.studio.idle(),'tasks not complete');
});

test('切换渠道后 Codex 仍受独立上限控制，即梦可绕过已满的 Codex 队列',async t=>{
  const f=await fixture(t,15);
  await f.request('/api/generation-settings','PUT',{provider:'codex',concurrency:3});
  await f.request('/api/generation-settings','PUT',{provider:'jimeng',concurrency:10});
  await f.submit('codex',f.project.pages[0].panels.slice(0,4));await until(()=>f.calls.length===3,'codex limit');
  await f.submit('jimeng',f.project.pages[0].panels.slice(4,15));await until(()=>f.calls.length===13,'jimeng blocked behind codex');
  assert.equal(f.calls.filter(p=>p==='codex').length,3);assert.equal(f.calls.filter(p=>p==='jimeng').length,10);
  assert.equal(f.studio.generationSlots.snapshot().concurrency,20);
  await f.request('/api/jobs/cancel-all','POST',{projectId:f.project.id});f.releases.forEach(resolve=>resolve());await until(()=>f.studio.idle(),'tasks not cancelled');
});
