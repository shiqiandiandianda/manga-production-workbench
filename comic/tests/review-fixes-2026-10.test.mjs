import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createStudio} from '../server.mjs';
import {createProject} from '../public/model.js';
import {comparableProject,revisionDecision} from '../public/revision-sync.js';
import {buildImagePrompt,referenceMode} from '../lib/codex.mjs';
import {Store} from '../lib/store.mjs';
import {DEFAULT_CONCURRENCY} from '../lib/concurrency.mjs';

const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64');
const offline={status:async()=>({connected:false,installed:true,imageFeature:true,message:'测试未登录'})};
async function boot(t,options={}){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'comic-review-fixes-'));
  const studio=createStudio({dataDir:directory,bridge:offline,seedReference:false,...options});
  await new Promise(resolve=>studio.server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{studio.close();await new Promise(resolve=>studio.server.close(resolve));fs.rmSync(directory,{recursive:true,force:true});});
  return {studio,directory,url:`http://127.0.0.1:${studio.server.address().port}`};
}
async function request(url,route,method='GET',data){const response=await fetch(url+route,{method,headers:data?{'Content-Type':'application/json'}:{},body:data?JSON.stringify(data):undefined});const text=await response.text();let value;try{value=JSON.parse(text);}catch{value=text;}return {status:response.status,data:value};}

test('修复页文件缺失时返回 404，主服务继续运行',async t=>{
  const {studio,url}=await boot(t),id='job_00000000-0000-4000-8000-000000000001';
  studio.store.db.jobs.push({id,provider:'codex',projectId:'project_00000000-0000-4000-8000-000000000001',status:'done',repairedPage:true});studio.store.save();
  const missing=await request(url,'/api/jobs/'+id+'/repaired-page');
  assert.equal(missing.status,404);assert.match(missing.data.error,/修复页文件已不存在/);
  assert.equal((await request(url,'/api/health')).status,200);
});

test('导出再导入到另一数据目录后，气泡素材引用指向新目录里的资产',async t=>{
  const a=await boot(t),b=await boot(t);
  a.studio.store.db.projects.push(createProject('气泡素材',true));a.studio.store.save();
  const texture=path.join(a.directory,'texture.png');fs.writeFileSync(texture,png);
  const asset=(await request(a.url,'/api/assets','POST',{filePath:texture,name:'纹理'})).data;
  const project=(await request(a.url,'/api/state')).data.projects[0];
  Object.assign(project.pages[0].bubbles[0],{styleTextureId:'not-in-library',styleTextureAssetId:asset.id});
  assert.equal((await request(a.url,'/api/projects/'+project.id,'PUT',project)).status,200);
  const exported=(await request(a.url,'/api/projects/'+project.id+'/export')).data;
  const imported=await request(b.url,'/api/projects/import','POST',exported);assert.equal(imported.status,201);
  const bubble=imported.data.pages[0].bubbles[0],ids=(await request(b.url,'/api/state')).data.assets.map(item=>item.id);
  assert.notEqual(bubble.styleTextureAssetId,asset.id);assert.ok(ids.includes(bubble.styleTextureAssetId));
});

test('导入时无法解析的气泡素材引用被移除，不留下失效编号',async t=>{
  const a=await boot(t),b=await boot(t);
  a.studio.store.db.projects.push(createProject('失效引用',true));a.studio.store.save();
  const project=(await request(a.url,'/api/state')).data.projects[0];
  Object.assign(project.pages[0].bubbles[0],{visualAssetId:'asset_00000000-0000-4000-8000-0000000000ff'});
  a.studio.store.db.projects[0].pages[0].bubbles[0].visualAssetId='asset_00000000-0000-4000-8000-0000000000ff';a.studio.store.save();
  const exported=await request(a.url,'/api/projects/'+project.id+'/export');assert.equal(exported.status,200,'旧的失效气泡引用不再让整个导出失败');
  const imported=await request(b.url,'/api/projects/import','POST',exported.data);assert.equal(imported.status,201);
  assert.equal(imported.data.pages[0].bubbles[0].visualAssetId,undefined);
});

test('已结束任务的生成输入被移除，可恢复的即梦任务保留，历史条数有上限',async t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'comic-review-jobs-')); // Retain isolated evidence until shutdown flush has finished.
  const store=new Store(directory),job=(id,extra)=>({id:'job_00000000-0000-4000-8000-'+String(id).padStart(12,'0'),projectId:'project_x',created:new Date(Date.UTC(2026,0,1,0,0,id)).toISOString(),updated:new Date(Date.UTC(2026,0,1,0,0,id)).toISOString(),input:{prompt:'x'},panelContentKey:'k',...extra});
  store.db.jobs.push(job(1,{provider:'codex',status:'done'}),job(2,{provider:'jimeng',status:'failed',recovery:{submitId:'s'}}),job(3,{provider:'jimeng',status:'awaiting_confirmation'}));
  for(let i=10;i<2015;i++)store.db.jobs.push(job(i,{provider:'codex',status:'failed'}));
  store.save();
  const studio=createStudio({dataDir:directory,bridge:offline,seedReference:false});t.after(()=>{studio.close();});
  const jobs=studio.store.db.jobs,byId=id=>jobs.find(j=>j.id.endsWith(String(id).padStart(12,'0')));
  assert.equal(byId(2).input.prompt,'x','可查询原任务的即梦记录保留输入');assert.equal(byId(3).input.prompt,'x');
  assert.equal(jobs.filter(j=>['done','failed','cancelled'].includes(j.status)&&!(j.provider==='jimeng'&&j.recovery?.submitId)).length,2000);
  assert.equal(byId(1),undefined,'最旧的已结束任务被移出历史');
  assert.ok(jobs.filter(j=>j.provider==='codex').every(j=>j.input===undefined&&j.panelContentKey===undefined));
});

test('进度写盘合并为一次，状态变化与关闭时立即落盘',async t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'comic-review-store-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const store=new Store(directory),file=path.join(directory,'studio.json');let writes=0;const save=store.save.bind(store);store.save=()=>{writes++;save();};
  for(let i=0;i<20;i++){store.db.layouts.push({i});store.saveSoon(30);}
  assert.equal(writes,0);await new Promise(resolve=>setTimeout(resolve,80));assert.equal(writes,1);
  assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).layouts.length,20);
  store.db.layouts.push({last:true});store.saveSoon(10000);store.flush();assert.equal(writes,2);assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).layouts.length,21);
});

test('多窗口：只有服务端自有字段变化时沿用版本号，内容变化时载入或提示冲突',()=>{
  const base=createProject('窗口',true);base.revision=3;const baseComparable=comparableProject(base);
  const imageOnly=structuredClone(base);imageOnly.revision=4;imageOnly.pages[0].panels[0].imageAssetId='asset_00000000-0000-4000-8000-000000000001';imageOnly.pages[0].panels[0].candidates=['asset_00000000-0000-4000-8000-000000000001'];imageOnly.updated='later';
  const moved=structuredClone(base);moved.revision=4;moved.pages[0].panels[0].x+=40;
  for(const dirty of [false,true])assert.equal(revisionDecision({localRevision:3,server:imageOnly,baseComparable,dirty,saving:false}),'adopt-revision');
  assert.equal(revisionDecision({localRevision:3,server:moved,baseComparable,dirty:false,saving:false}),'adopt-content');
  assert.equal(revisionDecision({localRevision:3,server:moved,baseComparable,dirty:true,saving:false}),'conflict');
  assert.equal(revisionDecision({localRevision:3,server:moved,baseComparable,dirty:false,saving:true}),'ignore','保存进行中先等待结果');
  assert.equal(revisionDecision({localRevision:4,server:moved,baseComparable,dirty:false,saving:false}),'ignore','较旧或相同版本不处理');
  assert.equal(revisionDecision({localRevision:3,server:moved,baseComparable:'',dirty:true,saving:false}),'conflict','没有基准时按保守方式处理');
});

test('Codex 参考图模式：默认逐张查看，direct 直接交给生图；无效配置明确报错',()=>{
  const p=createProject('提示',true),input={shot:p.shots[0],style:p.style,panel:p.pages[0].panels[0],referenceRoles:[{role:'character',name:'宋玄'}]};
  assert.equal(referenceMode({}),'view');assert.equal(referenceMode({COMIC_CODEX_REFERENCE_MODE:'Direct'}),'direct');
  assert.throws(()=>referenceMode({COMIC_CODEX_REFERENCE_MODE:'fast'}),/view 或 direct/);
  const view=buildImagePrompt(input),direct=buildImagePrompt({...input,referenceMode:'direct'});
  assert.match(view,/先读取清单中的参考图/);assert.doesNotMatch(direct,/先读取清单中的参考图/);
  assert.match(direct,/直接使用清单中的参考图路径/);assert.match(direct,/referenced_image_paths/);assert.match(direct,/\$imagegen/);
});

test('未配置并发时与启动入口一致，默认同时生成 6 张',()=>{assert.equal(DEFAULT_CONCURRENCY,6);});
