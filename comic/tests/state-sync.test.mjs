// 状态接口增量返回：没变化的工程只回占位；前端合并后的结果与完整接口逐项一致。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createStudio} from '../server.mjs';
import {createStateSync} from '../public/state-sync.js';

async function fixture(t){
 const temporaryRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../.test-temp');fs.mkdirSync(temporaryRoot,{recursive:true});
 const dir=fs.mkdtempSync(path.join(temporaryRoot,'state-sync-'));
 const studio=createStudio({dataDir:dir,seedReference:false,bridge:{status:async()=>({connected:true,imageFeature:true}),generate:async()=>new Promise(()=>{})}});
 await new Promise(r=>studio.server.listen(0,'127.0.0.1',r));
 t.after(async()=>{studio.close();await new Promise(r=>studio.server.close(r));fs.rmSync(dir,{recursive:true,force:true});});
 const url=`http://127.0.0.1:${studio.server.address().port}`;
 const raw=async(route,method='GET',value)=>{const r=await fetch(url+route,{method,headers:value?{'Content-Type':'application/json'}:undefined,body:value?JSON.stringify(value):undefined});const text=await r.text();return {status:r.status,data:JSON.parse(text),bytes:Buffer.byteLength(text)};};
 const api=async(route,method,value)=>{const r=await raw(route,method,value);if(r.status>=400)throw new Error(r.data.error);return r.data;};
 return {studio,raw,api};
}
const comparable=({stamps,...data})=>data;

test('没带内容戳时返回完整数据，与以前的格式相同',async t=>{
 const f=await fixture(t);await f.api('/api/projects','POST',{title:'甲'});
 const data=await f.api('/api/state');
 for(const key of ['projects','deletedProjects','assets','jobs','login','scheduler','layouts'])assert.ok(key in data,key);
 assert.equal(data.incremental,undefined);assert.equal(data.projects[0].title,'甲');assert.ok(data.stamps?.s);
});

test('带内容戳时没变化的工程只回占位；改过的工程完整返回',async t=>{
 const f=await fixture(t);for(const title of ['甲','乙','丙'])await f.api('/api/projects','POST',{title});
 const first=await f.api('/api/state'),known=encodeURIComponent(JSON.stringify(first.stamps));
 const quiet=await f.raw('/api/state?known='+known);
 assert.equal(quiet.data.incremental,true);assert.ok(quiet.data.projects.every(p=>p.unchanged));assert.equal(quiet.data.assetsUnchanged,true);assert.deepEqual(quiet.data.jobs,[]);
 const edited=structuredClone(first.projects[1]);edited.title='乙（改名）';await f.api('/api/projects/'+edited.id,'PUT',edited);
 const after=await f.api('/api/state?known='+known);
 assert.deepEqual(after.projects.map(p=>p.unchanged?'占位':p.title),['占位','乙（改名）','占位']);
});

test('前端合并后的结果与完整接口逐项一致（建工程、改工程、提交任务、删除工程）',async t=>{
 const f=await fixture(t),sync=createStateSync(f.api);
 for(const title of ['甲','乙'])await f.api('/api/projects','POST',{title});
 const check=async()=>{const merged=await sync.fetch(),full=await f.api('/api/state');assert.deepEqual(comparable(merged),comparable(full));};
 await check();await check();
 await f.api('/api/projects','POST',{title:'丙'});await check();
 const [first]=(await f.api('/api/state')).projects,panel=first.pages[0].panels[0];
 first.shots.find(s=>s.id===panel.shotId).description='门口站着一个人';panel.generation.prompt='门口站着一个人';
 const saved=await f.api('/api/projects/'+first.id,'PUT',first);await check();
 await f.api('/api/jobs','POST',{projectId:first.id,panelIds:[panel.id],expectedRevision:saved.revision});await check();
 await f.api('/api/jobs/cancel-all','POST',{projectId:first.id});await check();
 await f.api('/api/projects/'+first.id,'DELETE',{expectedRevision:(await f.api('/api/state')).projects[0].revision});await check();
});

test('服务重启后内容戳失效，前端自动改取完整数据',async t=>{
 const f=await fixture(t);await f.api('/api/projects','POST',{title:'甲'});
 const stamps={...(await f.api('/api/state')).stamps,s:'另一个进程'};
 const data=await f.api('/api/state?known='+encodeURIComponent(JSON.stringify(stamps)));
 assert.equal(data.incremental,undefined);assert.equal(data.projects[0].title,'甲');
});

test('工程较多时，轮询返回的数据量随变化量而不是工程总数增长',async t=>{
 const f=await fixture(t);for(let i=0;i<12;i++)await f.api('/api/projects','POST',{title:'工程'+i});
 const full=await f.raw('/api/state'),incremental=await f.raw('/api/state?known='+encodeURIComponent(JSON.stringify(full.data.stamps)));
 assert.ok(incremental.bytes*5<full.bytes,`${incremental.bytes} vs ${full.bytes}`);
});
