import {createProject as fixtureProject} from '../public/model.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createStudio} from '../server.mjs';
import {Store,uid} from '../lib/store.mjs';
import {projectManagerMarkup} from '../public/project-manager.js';
const root=fileURLToPath(new URL('../',import.meta.url));
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64');
async function fixture(t){
  const parent=path.join(root,'.runtime','temp');fs.mkdirSync(parent,{recursive:true});
  const directory=fs.mkdtempSync(path.join(parent,'project-delete-tests-'));
  let generations=0;
  const bridge={status:async()=>({connected:false}),close(){}};
  const jimengBridge={status:async()=>({connected:false}),close(){},generate:async()=>{generations++;throw Error('No generation expected');}};
  const studio=createStudio({dataDir:directory,bridge,jimengBridge,seedReference:false});studio.store.db.projects.push(fixtureProject('隔离回归样本',true));studio.store.save();
  await new Promise(resolve=>studio.server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{studio.close();await new Promise(resolve=>studio.server.close(resolve));const resolved=path.resolve(directory);assert.equal(path.dirname(resolved),path.resolve(parent));assert.ok(path.basename(resolved).startsWith('project-delete-tests-'));fs.rmSync(resolved,{recursive:true,force:true});});
  const base='http://127.0.0.1:'+studio.server.address().port;
  const request=async(route,method='GET',data,headers={})=>{
    const response=await fetch(base+route,{method,headers:{...(data?{'Content-Type':'application/json'}:{}),...headers},body:data?JSON.stringify(data):undefined});
    return {status:response.status,data:await response.json()};
  };
  return {studio,directory,request,get generations(){return generations;}};
}
test('删除从项目列表移除，恢复保留ID、图层、取景、气泡和共享原图',async t=>{
  const f=await fixture(t),first=f.studio.store.db.projects[0];
  const sharedFile=path.join(f.directory,'shared.png');fs.writeFileSync(sharedFile,png);const asset=(await f.request('/api/assets','POST',{name:'shared',filePath:sharedFile})).data;
  await f.request('/api/projects/'+first.id+'/panels/'+first.pages[0].panels[0].id+'/image','POST',{assetId:asset.id});
  const second=(await f.request('/api/projects','POST',{title:'另一个项目'})).data;
  await f.request('/api/projects/'+second.id+'/panels/'+second.pages[0].panels[0].id+'/image','POST',{assetId:asset.id});
  const original=(await f.request('/api/projects/'+first.id)).data;
  const before=fs.readFileSync(f.studio.store.assetPath(asset.id));
  assert.equal((await f.request('/api/projects/'+first.id,'DELETE',{expectedRevision:original.revision})).status,200);
  const state=(await f.request('/api/state')).data;
  assert.deepEqual(state.projects.map(p=>p.id),[second.id]);assert.equal(state.deletedProjects[0].id,first.id);
  assert.equal((await f.request('/api/projects/'+first.id)).status,404);
  assert.deepEqual(fs.readFileSync(f.studio.store.assetPath(asset.id)),before);
  assert.equal(state.projects[0].pages[0].panels[0].imageAssetId,asset.id);
  const restored=(await f.request('/api/projects/'+first.id+'/restore','POST',{})).data;
  assert.equal(restored.id,original.id);assert.deepEqual(restored.pages,original.pages);assert.deepEqual(restored.shots,original.shots);
  assert.equal(restored.revision,original.revision+2);assert.equal(restored.deletedAt,undefined);
  assert.equal((await f.request('/api/state')).data.deletedProjects.length,0);assert.equal(f.generations,0);
});
test('允许删除最后一个项目，重启不会偷偷新增示例且仍可恢复或新建',async t=>{
  const f=await fixture(t),project=f.studio.store.db.projects[0];
  await f.request('/api/projects/'+project.id,'DELETE',{expectedRevision:project.revision});
  assert.equal((await f.request('/api/state')).data.projects.length,0);
  const reloaded=new Store(f.directory);assert.equal(reloaded.db.projects.length,1);assert.ok(reloaded.db.projects[0].deletedAt);
  const next=(await f.request('/api/projects','POST',{title:'新建'})).data;
  assert.deepEqual((await f.request('/api/state')).data.projects.map(p=>p.id),[next.id]);
  assert.equal((await f.request('/api/projects/'+project.id+'/restore','POST',{})).status,200);
  assert.equal((await f.request('/api/state')).data.projects.length,2);
});
test('拒绝旧版本、跨站和正在处理任务的删除，项目不改变',async t=>{
  const f=await fixture(t),project=f.studio.store.db.projects[0],id=project.id,revision=project.revision;
  const edited=structuredClone(project);edited.title='已编辑';await f.request('/api/projects/'+id,'PUT',edited);
  assert.equal((await f.request('/api/projects/'+id,'DELETE',{expectedRevision:revision})).status,409);
  assert.equal((await f.request('/api/projects/'+id,'DELETE',{expectedRevision:project.revision},{Origin:'https://example.invalid'})).status,403);
  for(const status of ['queued','running']){
    const active=f.studio.store.project(id);
    f.studio.store.db.jobs.push({id:uid('job'),projectId:id,status});
    assert.equal((await f.request('/api/projects/'+id,'DELETE',{expectedRevision:active.revision})).status,409);
    assert.equal(active.deletedAt,undefined);f.studio.store.db.jobs.pop();
  }
  assert.equal((await f.request('/api/projects/'+id)).status,200);
});
test('已删除项目的待批准/可恢复任务不会运行，恢复不自动扣费或重提交',async t=>{
  const f=await fixture(t),project=f.studio.store.db.projects[0];
  const approval={id:uid('job'),provider:'jimeng',projectId:project.id,status:'awaiting_confirmation',quote:{totalMaxCredits:5,confirmable:true}};
  const recovery={id:uid('job'),provider:'jimeng',projectId:project.id,status:'recoverable',recovery:{submitId:'11111111-1111-4111-8111-111111111111'}};
  f.studio.store.db.jobs.push(approval,recovery);f.studio.store.save();
  assert.equal((await f.request('/api/projects/'+project.id,'DELETE',{expectedRevision:project.revision})).status,409);assert.equal(project.deletedAt,undefined);assert.equal(f.generations,0);
  recovery.status='done';
  assert.equal((await f.request('/api/projects/'+project.id,'DELETE',{expectedRevision:project.revision})).status,200);
  assert.equal((await f.request('/api/state')).data.jobs.length,0);
  assert.equal((await f.request('/api/jobs/'+approval.id+'/approve','POST',{approved:true,creditCeiling:5})).status,404);
  assert.equal((await f.request('/api/jobs/'+recovery.id+'/resume','POST',{})).status,409);
  assert.equal(f.generations,0);assert.equal(approval.status,'awaiting_confirmation');
  await f.request('/api/projects/'+project.id+'/restore','POST',{});
  assert.equal((await f.request('/api/state')).data.jobs.length,2);assert.equal(f.generations,0);
});
test('编辑和导入不会绕过删除流程或继承已删除标记',async t=>{
  const f=await fixture(t),project=structuredClone(f.studio.store.db.projects[0]);project.deletedAt='injected';
  const saved=await f.request('/api/projects/'+project.id,'PUT',project);assert.equal(saved.status,200);assert.equal(saved.data.deletedAt,undefined);
  const exported=(await f.request('/api/projects/'+project.id+'/export')).data;exported.project.deletedAt='injected';
  const imported=await f.request('/api/projects/import','POST',exported);assert.equal(imported.status,201);assert.equal(imported.data.deletedAt,undefined);
  assert.equal((await f.request('/api/state')).data.projects.length,2);
});
test('管理面板明确删除与恢复入口，忙碌项目禁用删除且标题经过转义',()=>{
  const project={id:'project_a',title:'<img src=x onerror=1>',pages:[{}],shots:[{}]};
  const html=projectManagerMarkup({projects:[project],currentProjectId:project.id,jobs:[{projectId:project.id,status:'running'}],deletedProjects:[{id:'project_b',title:'旧项目',pageCount:2,shotCount:3}]});
  assert.ok(html.includes('&lt;img'));assert.ok(!html.includes('<img'));assert.match(html,/data-delete-project="project_a"[^>]*disabled/);
  assert.ok(html.includes('data-restore-project="project_b"'));assert.ok(html.includes('当前项目'));
  const empty=projectManagerMarkup({deletedProjects:[{id:'project_b',title:'旧项目',pageCount:2,shotCount:3}]});
  assert.ok(empty.includes('暂无项目'));assert.match(empty,/project-trash" open/);
});
