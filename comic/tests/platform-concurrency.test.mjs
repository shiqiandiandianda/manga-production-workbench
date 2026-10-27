import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {GenerationSlots,GenerationSlotsClient} from '../lib/generation-slots.mjs';
import {GenerationSettings} from '../lib/generation-settings.mjs';
import {createStudio} from '../server.mjs';
import {createProject,id} from '../public/model.js';

const root=fileURLToPath(new URL('../',import.meta.url));
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check,message){for(let i=0;i<400;i++){if(await check())return;await delay(10);}throw Error(message);}
async function api(origin,route,method='GET',value){const response=await fetch(origin+route,{method,headers:value?{'Content-Type':'application/json'}:undefined,body:value?JSON.stringify(value):undefined});return {status:response.status,data:await response.json()};}
function removeTemp(directory){assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));fs.rmSync(directory,{recursive:true,force:true});}
function temp(t,cleanup=true){const directory=fs.mkdtempSync(path.join(os.tmpdir(),'comic-platforms-'));if(cleanup)t.after(()=>removeTemp(directory));return directory;}

test('平时主平台用满六槽；补图插队取得两槽；补图全部结束后自动恢复六槽',async t=>{
  const slots=new GenerationSlots({directory:temp(t),platforms:{main:6,repair:2},pollMs:5});
  const held=[];for(let i=0;i<6;i++)held.push(await slots.acquire({ownerId:'comic:'+i,requestId:'main'+i}));
  assert.equal(slots.mainLimit(),6);
  let mainStarted=false;const waiting=slots.acquire({ownerId:'comic:waiting'}).then(lease=>{mainStarted=true;return lease;});
  const server=http.createServer(async(req,res)=>slots.handle(req,res,new URL(req.url,'http://127.0.0.1')));await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
  const client=new GenerationSlotsClient({origin:'http://127.0.0.1:'+server.address().port,pollMs:5});
  await client.enqueue({ownerId:'repair:first'});await client.enqueue({ownerId:'repair:second'});
  const firstRepair=client.acquire({ownerId:'repair:first'}),secondRepair=client.acquire({ownerId:'repair:second'});
  assert.equal(slots.mainLimit(),4);assert.equal(mainStarted,false);
  held[0].release({completed:true});const one=await firstRepair;assert.equal(mainStarted,false);assert.equal(slots.snapshot().running,6);
  held[1].release({completed:true});const two=await secondRepair;assert.equal(slots.snapshot().running,6);assert.equal(mainStarted,false);
  await client.enqueue({ownerId:'repair:third'});const third=client.acquire({ownerId:'repair:third'});
  await one.release({completed:true});const three=await third;assert.equal(mainStarted,false);assert.equal(slots.snapshot().running,6);
  await two.release({completed:true});assert.equal(slots.mainLimit(),4);assert.equal(mainStarted,false);
  await three.release({completed:true});const next=await waiting;assert.equal(mainStarted,true);assert.equal(slots.mainLimit(),6);
  for(const lease of held.slice(2))lease.release({completed:true});next.release({completed:true});assert.equal(slots.snapshot().running,0);
});

test('取消和进程退出撤回补图让位；调低额度不中断已开始任务，未知云任务保留原槽',async t=>{
  const live=new Set([process.pid,123]),directory=temp(t),slots=new GenerationSlots({directory,platforms:{main:6,repair:2},isAlive:pid=>live.has(pid)});
  const held=[];for(let i=0;i<6;i++)held.push(await slots.acquire({ownerId:'comic:'+i}));held[0].keepRemote();
  slots.enqueue({ownerId:'repair:cancelled'});assert.equal(slots.mainLimit(),4);slots.cancelRequest({ownerId:'repair:cancelled'});assert.equal(slots.mainLimit(),6);
  slots.enqueue({ownerId:'repair:dead',ownerPid:123});assert.equal(slots.mainLimit(),4);live.delete(123);assert.equal(slots.mainLimit(),6);
  slots.setPlatforms({main:3,repair:2});assert.equal(slots.snapshot().running,6);
  for(const lease of held.slice(1))lease.release({completed:true});
  const repairs=[slots.tryAcquire({ownerId:'repair:one'}),slots.tryAcquire({ownerId:'repair:two'})];assert.ok(repairs.every(Boolean));assert.equal(slots.snapshot().running,3);assert.equal(slots.mainLimit(),1);
  const restarted=new GenerationSlots({directory,platforms:{main:3,repair:2},isAlive:pid=>live.has(pid)});assert.equal(restarted.listRemote().length,1);assert.equal(restarted.mainLimit(),1);
  held[0].release({completed:true});for(const lease of repairs)lease.release({completed:true});
});

test('分配 API 验证输入并持久保存；默认主平台六槽，补图完成后无需等待新的主任务触发就补满',async t=>{
  const directory=temp(t,false),releases=[],png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64');let calls=0;
  const bridge={status:async()=>({connected:true,imageFeature:true}),generate:async()=>{calls++;await new Promise(r=>releases.push(r));return {bytes:png,imageToolSeen:true};},close(){releases.forEach(r=>r());}};
  const studio=createStudio({dataDir:directory,bridge,jimengBridge:{close(){}},storyboardGenerator:{close(){}}});await new Promise(r=>studio.server.listen(0,'127.0.0.1',r));
  t.after(async()=>{studio.close();releases.forEach(r=>r());await until(()=>studio.idle(),'cleanup');await new Promise(r=>studio.server.close(r));removeTemp(directory);});
  const origin='http://127.0.0.1:'+studio.server.address().port;
  assert.deepEqual((await api(origin,'/api/platform-generation-settings')).data,{main:6,repair:2,total:6,mainWhenRepair:4,mode:'borrow'});
  for(const input of [{main:-1,repair:2},{main:1.5,repair:2},{main:21,repair:2},{main:0,repair:0},{main:null,repair:2},{main:true,repair:2},{main:' ',repair:2}])assert.equal((await api(origin,'/api/platform-generation-settings','PUT',input)).status,400);
  const project=createProject('合成并发分配',true);while(project.pages[0].panels.length<10)project.pages[0].panels.push({...structuredClone(project.pages[0].panels[0]),id:id('panel')});studio.store.db.projects.push(project);studio.store.save();
  await api(origin,'/api/jobs','POST',{projectId:project.id,panelIds:project.pages[0].panels.map(p=>p.id),provider:'codex'});
  await until(()=>calls===6,'default main quota');
  const pendingRepair=studio.generationSlots.acquire({ownerId:'repair:api-test'});await until(()=>studio.generationSlots.mainLimit()===4,'repair demand');releases[0]();const repair=await pendingRepair;releases[1]();await until(()=>studio.store.db.jobs.filter(j=>j.status==='done').length===2,'two main images finish');assert.equal(calls,6);repair.release({completed:true});await until(()=>calls===8,'main automatically refills after repair');
  const changed=await api(origin,'/api/platform-generation-settings','PUT',{main:8,repair:3});assert.equal(changed.status,200);assert.equal(changed.data.total,8);
  await until(()=>calls===10,'raised main quota must start two waiting images');
  assert.deepEqual(new GenerationSettings(directory).platforms,{main:8,repair:3});
  assert.equal(studio.generationSlots.snapshot().concurrency,8);
  await api(origin,'/api/generation-settings','PUT',{provider:'codex',concurrency:8});assert.deepEqual(new GenerationSettings(directory).platforms,{main:8,repair:3});
  releases.forEach(r=>r());
});

test('两个平台可设置共享总额度和补图优先额度，重开和定时同步保持一致',{timeout:60000},async t=>{
  const directory=temp(t,false),data=path.join(directory,'main');let browser,child;
  const studio=createStudio({dataDir:data,bridge:{status:async()=>({connected:false,message:'合成测试'}),close(){}},jimengBridge:{status:async()=>({connected:false,message:'合成测试'}),close(){}},storyboardGenerator:{close(){}}});await new Promise(r=>studio.server.listen(0,'127.0.0.1',r));
  const origin='http://127.0.0.1:'+studio.server.address().port;
  const probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));const repairOrigin='http://127.0.0.1:'+port;
  let output='';child=spawn(process.execPath,[path.join(root,'repair/server.mjs')],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,IMAGE_REPAIR_DATA_DIR:path.join(directory,'repair'),IMAGE_REPAIR_PORT:String(port),COMIC_STUDIO_ORIGIN:origin}});child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);
  t.after(async()=>{await browser?.close();if(child?.exitCode===null){child.kill('SIGTERM');await new Promise(r=>child.once('close',r));}studio.close();await new Promise(r=>studio.server.close(r));removeTemp(directory);});
  await until(async()=>{try{return (await api(repairOrigin,'/api/health')).status===200;}catch{return false;}},'repair startup '+output);
  assert.equal((await api(repairOrigin,'/api/health')).data.queue.concurrency,2);
  const require=createRequire(import.meta.url),{chromium}=require(path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
  browser=await chromium.launch({channel:'msedge',headless:true,args:['--disable-gpu']});const context=await browser.newContext({viewport:{width:1864,height:1040}});
  await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.pathname==='/api/codex/status')return route.fulfill({json:{connected:false,message:'合成测试，无账号检查'}});return ['127.0.0.1','localhost'].includes(url.hostname)||['data:','blob:'].includes(url.protocol)?route.continue():route.abort();});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>{errors.push(e.message);console.log('Browser error: '+e.message);});await page.goto(origin);await page.locator('[data-open-generation-settings]').first().click();
  await page.getByLabel('主平台并发数量',{exact:true}).fill('5');await page.getByLabel('补图平台并发数量',{exact:true}).fill('3');await page.getByRole('button',{name:'保存并发分配',exact:true}).click();await page.waitForFunction(()=>document.querySelector('[data-platform-status]').textContent.includes('已保存：'));
  const evidence=path.resolve(process.env.COMIC_PLATFORM_EVIDENCE||'.runtime/platform-allocation-evidence');fs.mkdirSync(evidence,{recursive:true});await page.screenshot({path:path.join(evidence,'main-settings.png')});
  assert.equal((await api(origin,'/api/platform-generation-settings')).data.total,5);
  await page.goto(repairOrigin);assert.deepEqual(errors,[]);await page.getByRole('button',{name:'并发分配',exact:true}).click();await page.waitForFunction(()=>document.querySelector('[data-platform-main]')?.disabled===false);
  assert.equal(await page.getByLabel('主平台并发数量',{exact:true}).inputValue(),'5');assert.equal(await page.getByLabel('补图平台并发数量',{exact:true}).inputValue(),'3');
  await page.getByLabel('主平台并发数量',{exact:true}).fill('6');await page.getByLabel('补图平台并发数量',{exact:true}).fill('2');await page.getByRole('button',{name:'保存并发分配',exact:true}).click();await page.waitForFunction(()=>document.querySelector('[data-platform-status]').textContent.includes('已保存：'));
  await page.screenshot({path:path.join(evidence,'repair-settings.png')});assert.equal((await api(origin,'/api/platform-generation-settings')).data.main,6);assert.equal((await api(repairOrigin,'/api/health')).data.queue.concurrency,2);
  await api(origin,'/api/platform-generation-settings','PUT',{main:4,repair:4});await until(async()=>(await api(repairOrigin,'/api/health')).data.queue.concurrency===4,'repair live sync');
  await page.reload();await page.getByRole('button',{name:'并发分配',exact:true}).click();await page.waitForFunction(()=>document.querySelector('[data-platform-repair]')?.value==='4');assert.deepEqual(errors,[]);
});
