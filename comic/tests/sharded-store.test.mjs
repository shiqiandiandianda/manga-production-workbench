// 分片存储：旧单文件自动迁移；保存只写有变化的工程；写盘被占用时不崩溃并自动重试。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../lib/store.mjs';
import {createProject} from '../public/model.js';
import {createStudio} from '../server.mjs';

function folder(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sharded-store-'));/* Retain isolated fixture until every store and team shutdown hook has flushed. */return dir;}
function legacyDatabase(count=3){
 const projects=Array.from({length:count},(_,i)=>{const p=createProject('合成工程 '+(i+1));p.shots[0].description='第'+(i+1)+'个工程的画面';return p;});
 return {version:1,projects,assets:[],jobs:[],layouts:[{id:'layout_x',name:'合成版式'}]};
}
const projectFile=(dir,id)=>path.join(dir,'projects',id+'.json');
const age=(file,ms=60_000)=>{const old=new Date(Date.now()-ms);fs.utimesSync(file,old,old);return fs.statSync(file).mtimeMs;};

test('旧版单文件 studio.json 首次启动自动拆分，原文件完整备份，重新打开内容与顺序不变',t=>{
 const dir=folder(t),legacy=legacyDatabase(3),text=JSON.stringify(legacy,null,2);fs.writeFileSync(path.join(dir,'studio.json'),text);
 const store=new Store(dir);t.after(()=>store.close());
 assert.equal(fs.readFileSync(path.join(dir,'studio.json.v1-backup'),'utf8'),text);
 const index=JSON.parse(fs.readFileSync(path.join(dir,'studio.json'),'utf8'));
 assert.equal(index.storage,2);assert.equal(index.projects,undefined);assert.deepEqual(index.projectOrder,legacy.projects.map(p=>p.id));assert.deepEqual(index.layouts,legacy.layouts);
 for(const p of legacy.projects)assert.deepEqual(JSON.parse(fs.readFileSync(projectFile(dir,p.id),'utf8')),p);
 const reopened=new Store(dir);t.after(()=>reopened.close());
 assert.deepEqual(reopened.db.projects,legacy.projects);assert.deepEqual(reopened.db.layouts,legacy.layouts);
});

test('保存只重写有变化的工程文件；未变化的工程文件不被触碰',t=>{
 const dir=folder(t);fs.writeFileSync(path.join(dir,'studio.json'),JSON.stringify(legacyDatabase(3)));
 const store=new Store(dir);t.after(()=>store.close());
 const [a,b,c]=store.db.projects,before=Object.fromEntries([a,b,c].map(p=>[p.id,age(projectFile(dir,p.id))]));
 // 1) 整体替换（PUT 保存）2) 只改 updated 3) 不动
 const index=store.db.projects.indexOf(a);store.db.projects[index]={...structuredClone(a),title:'改名后的工程'};
 b.shots[0].description='直接改了内容';b.updated=new Date().toISOString();
 store.save();
 assert.notEqual(fs.statSync(projectFile(dir,a.id)).mtimeMs,before[a.id]);
 assert.notEqual(fs.statSync(projectFile(dir,b.id)).mtimeMs,before[b.id]);
 assert.equal(fs.statSync(projectFile(dir,c.id)).mtimeMs,before[c.id]);
 assert.equal(JSON.parse(fs.readFileSync(projectFile(dir,a.id),'utf8')).title,'改名后的工程');
 assert.equal(JSON.parse(fs.readFileSync(projectFile(dir,b.id),'utf8')).shots[0].description,'直接改了内容');
});

test('只改工程对象却没更新版本号的代码：markProject 立即写盘，漏标的由兜底核对补写',t=>{
 const dir=folder(t);fs.writeFileSync(path.join(dir,'studio.json'),JSON.stringify(legacyDatabase(2)));
 const store=new Store(dir);t.after(()=>store.close());const [a,b]=store.db.projects;
 a.shots[0].description='标记过的原地修改';store.markProject(a);store.save();
 assert.equal(JSON.parse(fs.readFileSync(projectFile(dir,a.id),'utf8')).shots[0].description,'标记过的原地修改');
 b.shots[0].description='漏标的原地修改';store.save();
 assert.notEqual(JSON.parse(fs.readFileSync(projectFile(dir,b.id),'utf8')).shots[0].description,'漏标的原地修改');
 assert.equal(store.scrub(Infinity),1);
 assert.equal(JSON.parse(fs.readFileSync(projectFile(dir,b.id),'utf8')).shots[0].description,'漏标的原地修改');
 b.shots[0].description='关闭前的修改';store.flush();
 assert.equal(JSON.parse(fs.readFileSync(projectFile(dir,b.id),'utf8')).shots[0].description,'关闭前的修改');
});

test('写完工程文件、索引未更新时断电：多出的工程文件在下次启动时读回',t=>{
 const dir=folder(t);fs.writeFileSync(path.join(dir,'studio.json'),JSON.stringify(legacyDatabase(1)));
 const store=new Store(dir);store.close();
 const extra=createProject('断电前新建');fs.writeFileSync(projectFile(dir,extra.id),JSON.stringify(extra));
 const reopened=new Store(dir);t.after(()=>reopened.close());
 assert.deepEqual(reopened.db.projects.map(p=>p.id),[store.db.projects[0].id,extra.id]);
 assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir,'studio.json'),'utf8')).projectOrder,[store.db.projects[0].id,extra.id]);
});

test('工程文件损坏时拒绝启动，不覆盖任何文件',t=>{
 const dir=folder(t);fs.writeFileSync(path.join(dir,'studio.json'),JSON.stringify(legacyDatabase(2)));
 const store=new Store(dir);store.close();const id=store.db.projects[1].id;
 fs.writeFileSync(projectFile(dir,id),'{坏掉的');const index=fs.readFileSync(path.join(dir,'studio.json'),'utf8');
 assert.throws(()=>new Store(dir),/工程文件无法读取/);
 assert.equal(fs.readFileSync(projectFile(dir,id),'utf8'),'{坏掉的');assert.equal(fs.readFileSync(path.join(dir,'studio.json'),'utf8'),index);
});

test('写盘被短暂占用（EPERM）时自动重试；持续失败也不抛出，记录原因并在之后补写',t=>{
 const dir=folder(t);fs.writeFileSync(path.join(dir,'studio.json'),JSON.stringify(legacyDatabase(1)));
 const store=new Store(dir);t.after(()=>store.close());const real=fs.renameSync;t.after(()=>{fs.renameSync=real;});
 let failures=2;fs.renameSync=(from,to)=>{if(failures-->0)throw Object.assign(new Error('EPERM: operation not permitted, rename'),{code:'EPERM'});return real(from,to);};
 store.db.projects[0].title='短暂占用';store.db.projects[0].updated='x1';store.save();
 assert.equal(store.lastSaveError,null);assert.equal(JSON.parse(fs.readFileSync(projectFile(dir,store.db.projects[0].id),'utf8')).title,'短暂占用');
 failures=1000;store.db.projects[0].title='持续占用';store.db.projects[0].updated='x2';
 assert.doesNotThrow(()=>store.save());assert.match(store.lastSaveError,/EPERM/);
 failures=0;store.save();assert.equal(store.lastSaveError,null);
 assert.equal(JSON.parse(fs.readFileSync(projectFile(dir,store.db.projects[0].id),'utf8')).title,'持续占用');
 assert.deepEqual(fs.readdirSync(path.join(dir,'projects')).filter(n=>n.endsWith('.tmp')),[]);
});

test('生图失败时写盘恰好被占用，主服务不会退出，任务状态随后写入',async t=>{
 const dir=folder(t),real=fs.renameSync;t.after(()=>{fs.renameSync=real;});let failNext=false;
 const studio=createStudio({dataDir:dir,seedReference:false,bridge:{status:async()=>({connected:true,imageFeature:true}),generate:async()=>{failNext=true;throw new Error('合成的生图失败');}}});
 fs.renameSync=(from,to)=>{if(failNext&&String(to).endsWith('studio.json')){failNext=false;throw Object.assign(new Error('EPERM: operation not permitted, rename'),{code:'EPERM'});}return real(from,to);};
 let crashed=null;const onRejection=error=>{crashed=error;};process.on('unhandledRejection',onRejection);t.after(()=>process.off('unhandledRejection',onRejection));
 await new Promise(r=>studio.server.listen(0,'127.0.0.1',r));t.after(async()=>{studio.close();await new Promise(r=>studio.server.close(r));});
 const url=`http://127.0.0.1:${studio.server.address().port}`,call=async(route,method='GET',value)=>{const r=await fetch(url+route,{method,headers:value?{'Content-Type':'application/json'}:undefined,body:value?JSON.stringify(value):undefined});return {status:r.status,data:await r.json()};};
 const project=(await call('/api/projects','POST',{title:'写盘占用'})).data,panel=project.pages[0].panels[0];
 project.shots.find(s=>s.id===panel.shotId).description='一个人站在门口';project.pages[0].panels[0].generation.prompt='一个人站在门口';
 assert.equal((await call('/api/projects/'+project.id,'PUT',project)).status,200);
 assert.equal((await call('/api/jobs','POST',{projectId:project.id,panelIds:[panel.id]})).status,202);
 for(let i=0;i<100&&studio.store.db.jobs[0]?.status!=='failed';i++)await new Promise(r=>setTimeout(r,20));
 assert.equal(studio.store.db.jobs[0].status,'failed');assert.equal(crashed,null);
 studio.store.save();const index=JSON.parse(fs.readFileSync(path.join(dir,'studio.json'),'utf8'));assert.equal(index.jobs[0].status,'failed');
});

test('回退工具把分片数据合并成旧版单文件，内容与迁移前一致',async t=>{
 const {exportLegacyDatabase}=await import('../tools/store-export-v1.mjs');
 const dir=folder(t),legacy=legacyDatabase(3);fs.writeFileSync(path.join(dir,'studio.json'),JSON.stringify(legacy));
 const store=new Store(dir);store.close();
 const result=exportLegacyDatabase(dir),exported=JSON.parse(fs.readFileSync(result.output,'utf8'));
 assert.equal(result.projects,3);assert.deepEqual(exported.projects,legacy.projects);assert.deepEqual(exported.layouts,legacy.layouts);assert.equal(exported.storage,undefined);
});


test('首次迁移遇到工程写盘失败时，保留旧索引和完整备份，不发布缺失文件引用',t=>{
 const dir=folder(t),legacy=legacyDatabase(2),text=JSON.stringify(legacy);fs.writeFileSync(path.join(dir,'studio.json'),text);
 const real=fs.renameSync;t.after(()=>{fs.renameSync=real;});
 fs.renameSync=(from,to)=>{if(String(to).endsWith(legacy.projects[1].id+'.json'))throw Object.assign(new Error('迁移文件被占用'),{code:'EPERM'});return real(from,to);};
 assert.throws(()=>new Store(dir),/工程数据无法写入/);
 assert.equal(fs.readFileSync(path.join(dir,'studio.json'),'utf8'),text);
 assert.equal(fs.readFileSync(path.join(dir,'studio.json.v1-backup'),'utf8'),text);
 fs.renameSync=real;const store=new Store(dir);t.after(()=>store.close());
 assert.deepEqual(store.db.projects,legacy.projects);
 assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'studio.json'),'utf8')).storage,2);
});

test('增量状态沿用共用封面尾图投影，写盘失败时仍返回最新的内存工程',async t=>{
 const {createStateSnapshot}=await import('../lib/state-snapshot.mjs');
 const {createEpisodeBoardSharing}=await import('../lib/episode-boards.mjs');
 const dir=folder(t),store=new Store(dir);t.after(()=>store.close());
 const project=createProject('共用封面增量');project.episodeOutline={version:1,sourceKey:'合成',episodes:[{episode:1,title:'第一话'}]};
 store.db.projects.push(project);store.save();
 const sharing=createEpisodeBoardSharing(store),snapshot=createStateSnapshot({store,publicJob:job=>job,projectView:sharing.view});
 const initial=snapshot(new URLSearchParams(),{});
 assert.equal(initial.projects[0].episodeBoards.templates.cover.width,1280);
 assert.equal(project.episodeBoards,undefined);
 const next=sharing.view(project);next.episodeBoards.templates.cover.background='#334455';sharing.accept(project,next);
 store.db.projects[0]=next;store.save();
 const changed=snapshot(new URLSearchParams({known:JSON.stringify(initial.stamps)}),{});
 assert.equal(changed.projects[0].episodeBoards.templates.cover.background,'#334455');
 assert.equal(snapshot(new URLSearchParams({known:JSON.stringify(changed.stamps)}),{}).projects[0].unchanged,true);
 const real=fs.renameSync;t.after(()=>{fs.renameSync=real;});
 fs.renameSync=()=>{throw Object.assign(new Error('EPERM: simulated lock'),{code:'EPERM'});};
 next.title='尚未写盘的最新修改';store.markProject(next);
 const pending=snapshot(new URLSearchParams({known:JSON.stringify(changed.stamps)}),{});
 assert.equal(pending.projects[0].title,'尚未写盘的最新修改');
 assert.notEqual(pending.stamps.p[next.id],changed.stamps.p[next.id]);
 fs.renameSync=real;store.save();
});


test('兜底核对遇到占用时，原地修改也安排自动重试并补写',async t=>{
 const dir=folder(t),store=new Store(dir);t.after(()=>store.close());
 const project=createProject('后台原地修改');store.db.projects.push(project);store.save();
 const real=fs.renameSync;t.after(()=>{fs.renameSync=real;});
 fs.renameSync=()=>{throw Object.assign(new Error('EPERM: scrub lock'),{code:'EPERM'});};
 project.title='兜底核对自动补写';assert.equal(store.scrub(Infinity),1);assert.ok(store.retryTimer);
 fs.renameSync=real;
 for(let i=0;i<80&&store.lastSaveError;i++)await new Promise(resolve=>setTimeout(resolve,20));
 assert.equal(store.lastSaveError,null);
 assert.equal(JSON.parse(fs.readFileSync(projectFile(dir,project.id),'utf8')).title,'兜底核对自动补写');
});
