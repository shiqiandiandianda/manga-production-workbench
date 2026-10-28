import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {createProjectSync} from '../lib/project-sync.mjs';

const base=path.resolve(import.meta.dirname,'../../audit/cache-tests');fs.mkdirSync(base,{recursive:true});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function fakeMoku({authorized=true,projects=[]}={}){
  const state={authorized,projects,documents:new Map(),requests:[],rejectReferences:false,rejectFormal:false,accountId:randomUUID()};
  const server=http.createServer(async (request,response)=>{
    let raw='';for await(const chunk of request)raw+=chunk;
    const body=raw?JSON.parse(raw):null;
    state.requests.push({method:request.method,url:request.url,body,idempotency:request.headers['idempotency-key']||''});
    const send=(status,value)=>{response.writeHead(status,{'Content-Type':'application/json'});response.end(JSON.stringify(value));};
    if(!state.authorized)return send(401,{error:{message:'未登录或会话已失效'}});
    if(request.url.startsWith('/api/documents')&&['POST','PUT'].includes(request.method)&&state.rejectReferences&&body?.references?.length)return send(422,{error:{code:'REFERENCE_REJECTED',message:'固定引用不属于此工程'}});
    if(request.url.startsWith('/api/documents/')&&request.method==='PUT'&&state.rejectFormal)return send(409,{error:{code:'FORMAL_COMMIT_REQUIRED',message:'请使用正式版本提交'}});
    if(request.method==='GET'&&request.url==='/api/auth/me')return send(200,{user:{id:state.accountId,username:'tester',displayName:'测试账号'}});
    if(request.method==='GET'&&request.url==='/api/projects')return send(200,{items:state.projects});
    if(request.method==='GET'&&/^\/api\/project-library\/[a-f0-9-]{36}\/subjects$/.test(request.url))return send(200,{items:[]});
    if(request.method==='POST'&&request.url==='/api/documents'){
      const id=randomUUID(),document={id,name:body.name,type:body.type,objectVersion:1,revision:1,schemaVersion:body.schemaVersion,content:body.content,references:body.references,projectId:body.projectId};
      state.documents.set(id,document);return send(201,document);
    }
    const match=request.url.match(/^\/api\/documents\/([a-f0-9-]{36})$/i);
    if(match&&state.documents.has(match[1])){
      const document=state.documents.get(match[1]);
      if(request.method==='GET')return send(200,document);
      if(request.method==='PUT'){
        if(body.objectVersion!==document.objectVersion)return send(409,{error:{message:'文档已被其他人修改'}});
        Object.assign(document,{name:body.name,schemaVersion:body.schemaVersion,content:body.content,references:body.references,objectVersion:document.objectVersion+1,revision:document.revision+1});
        return send(200,document);
      }
    }
    return send(404,{error:{message:'接口不存在'}});
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+server.address().port;
  const library={
    baseUrl:origin,
    defaultProjectId:projects[0]?.id||'',
    defaultProjectName:projects[0]?.name||'',
    async read(route){
      const response=await fetch(origin+route),data=await response.json().catch(()=>({}));
      if(!response.ok)throw Object.assign(new Error(data?.error?.message||'HTTP '+response.status),{status:response.status});
      return data;
    },
    async remote(route,options={}){
      const response=await fetch(origin+route,{method:options.method||'GET',headers:options.headers,body:options.body});
      if(!response.ok){const data=await response.json().catch(()=>({}));throw Object.assign(new Error(data?.error?.message||'HTTP '+response.status),{status:response.status,code:data?.error?.code});}
      return response;
    },
  };
  const close=async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));};
  return {library,state,close};
}

function fixture(){
  const projectId='project_'+randomUUID(),assetId='asset_'+randomUUID(),shotId='shot_'+randomUUID(),pageId='page_'+randomUUID(),panelId='panel_'+randomUUID();
  const remoteProjectId='project_remote_fixed';
  const asset={id:assetId,name:'叶麟标准卡.png',width:3840,height:1890,mime:'image/png',source:'moku',filePath:'D:/secret/asset.png',library:{assetId:randomUUID(),revisionId:randomUUID(),projectId:remoteProjectId,category:'character'}};
  const project={
    id:projectId,title:'开局神戒，召唤万虫 第11-21话 V005',revision:3,updated:'2026-10-21T00:00:00.000Z',style:'',
    shots:[{id:shotId,code:'S001',title:'开场',description:'合成镜头',dialogue:'',referenceIds:[assetId]}],
    references:[{assetId,role:'character',name:'叶麟标准卡'}],
    assetLibrary:{version:1,assetIds:[assetId],directories:[]},
    layoutHistory:{steps:new Array(400).fill({op:'edit',value:'x'.repeat(200)})},
    pages:[{id:pageId,width:1280,bubbles:[],panels:[{id:panelId,shotId,x:0,y:0,w:640,h:400,imageAssetId:assetId,candidates:[],referenceIds:[]}]}],
  };
  return {project,asset};
}

function stubStore(project,asset){
  return {
    db:{projects:[project],assets:[asset]},
    project(id){const found=this.db.projects.find(item=>item.id===id&&!item.deletedAt);if(!found)throw Object.assign(new Error('工程不存在'),{status:404});return found;},
  };
}

function makeSync({tmp,store,library,debounceMs=20}){
  return createProjectSync({dataDir:tmp,store,library,projectView:project=>structuredClone(project),json:()=>{},body:async request=>request.body||{},debounceMs});
}

test('工程保存后自动生成墨库工程快照：去重、更新、版本冲突自愈、会话失效不重试',async t=>{
  const tmp=fs.mkdtempSync(path.join(base,'project-sync-'));
  const remoteProject={id:randomUUID(),name:'召唤万虫'},other={id:randomUUID(),name:'别的项目'};
  const moku=await fakeMoku({projects:[remoteProject,other]});
  const {project,asset}=fixture();
  const store=stubStore(project,asset);
  const sync=makeSync({tmp,store,library:moku.library});
  t.after(async()=>{sync.close();await moku.close();fs.rmSync(tmp,{recursive:true,force:true});});

  const first=await sync.push(project.id);
  assert.equal(first.status,'synced');
  assert.equal(moku.state.documents.size,1);
  const create=moku.state.requests.filter(request=>request.method==='POST');
  assert.equal(create.length,1);
  assert.ok(create[0].idempotency,'写请求必须带 Idempotency-Key');
  const body=create[0].body;
  assert.equal(body.projectId,remoteProject.id,'按工程名匹配到墨库项目');
  assert.equal(body.type,'engineering.snapshot');
  assert.equal(body.schemaVersion,1);
  assert.ok(body.name.endsWith('工程快照'));
  assert.deepEqual(body.references,[asset.library.revisionId],'固定版本引用取自已取用的墨库素材');
  assert.equal(body.content.project.layoutHistory,undefined,'撤销步骤不进工程快照');
  assert.equal(body.content.project.pages.length,1);
  assert.equal(body.content.assets.length,1);
  assert.equal(body.content.assets[0].filePath,undefined,'快照不泄露本机图片路径');
  assert.equal(body.content.assets[0].library.revisionId,asset.library.revisionId);
  assert.ok(!JSON.stringify(body.content).includes('secret'));
  assert.equal(sync.status(project.id).status,'synced');
  assert.ok(fs.existsSync(path.join(tmp,'project-sync.local.json')));

  const settled=moku.state.requests.length;
  sync.mark(project);
  await sync.drain();
  assert.equal(moku.state.requests.length,settled,'自动同步在内容没变时不重复上传');
  assert.equal(moku.state.documents.size,1);

  project.revision=4;project.updated='2026-10-21T01:00:00.000Z';project.title=project.title+'（改）';
  sync.mark(project);
  await sync.drain();
  const updated=sync.status(project.id);
  assert.equal(updated.status,'synced');
  assert.equal(updated.objectVersion,2,'第二次上传走 PUT 并带上文档版本');
  const put=moku.state.requests.filter(request=>request.method==='PUT');
  assert.equal(put.length,1);
  assert.equal(put[0].body.objectVersion,1);
  assert.equal(moku.state.documents.size,1,'同一工程只维护一个墨库文档');

  const document=moku.state.documents.get(first.documentId);
  document.objectVersion=7;
  project.revision=5;
  const healed=await sync.push(project.id);
  assert.equal(healed.objectVersion,8,'版本冲突后先读文档再重试');
  assert.equal(moku.state.requests.filter(request=>request.url==='/api/documents/'+first.documentId&&request.method==='GET').length,1);

  moku.state.authorized=false;
  project.revision=6;
  await assert.rejects(()=>sync.push(project.id),/未登录|会话/);
  const failed=sync.status(project.id);
  assert.equal(failed.status,'error');
  assert.match(failed.error,/会话已失效/);
  assert.equal(failed.pending,false,'会话失效不进入自动重试队列');

  moku.state.authorized=true;
  const recovered=await sync.push(project.id);
  assert.equal(recovered.status,'synced');
  assert.equal(sync.status(project.id).status,'synced');
});

test('保存后防抖自动上传，且不会因为自动开关关闭而推送',async t=>{
  const tmp=fs.mkdtempSync(path.join(base,'project-sync-auto-'));
  const remoteProject={id:randomUUID(),name:'召唤万虫'};
  const moku=await fakeMoku({projects:[remoteProject]});
  const {project,asset}=fixture();
  const store=stubStore(project,asset);
  const sync=makeSync({tmp,store,library:moku.library,debounceMs:30});
  t.after(async()=>{sync.close();await moku.close();fs.rmSync(tmp,{recursive:true,force:true});});
  sync.mark(project);
  sync.mark(project);
  await sleep(250);
  assert.equal(moku.state.documents.size,1,'防抖窗口内多次保存只上传一次');
  const firstDoc=[...moku.state.documents.values()][0];
  assert.equal(firstDoc.revision,1);

  fs.writeFileSync(path.join(tmp,'project-sync.local.json'),JSON.stringify({version:1,auto:false,projects:{}}));
  const off=makeSync({tmp,store,library:moku.library,debounceMs:20});
  t.after(()=>off.close());
  const before=moku.state.requests.length;
  off.mark(project);
  await sleep(150);
  assert.equal(moku.state.requests.length,before,'自动开关关闭后保存不再上传');
  project.revision=7;
  const manual=await off.push(project.id);
  assert.equal(manual.status,'synced','手动上传不受自动开关限制');
});


test('新分类墨库首次同步先要求明确归属，不按工程名猜项目或自动重试写入',async t=>{
 const tmp=fs.mkdtempSync(path.join(base,'classified-setup-')),remote=await fakeMoku({projects:[{id:randomUUID(),name:'召唤万虫'}]}),{project,asset}=fixture();
 remote.library.supportsClassified=async()=>true;
 const sync=makeSync({tmp,store:stubStore(project,asset),library:remote.library});
 t.after(async()=>{sync.close();await remote.close();fs.rmSync(tmp,{recursive:true,force:true});});
 const before=structuredClone(project);
 await assert.rejects(sync.push(project.id),error=>error.code==='project_classification_required');
 assert.equal(sync.status(project.id).setupRequired,true);assert.equal(sync.status(project.id).status,'needs-classification');assert.equal(sync.status(project.id).pending,false);
 await sync.drain();assert.equal(remote.state.requests.length,0);assert.deepEqual(project,before);
});

test('切换墨库账号后旧同步队列暂停，重新确认归属前不写入',async t=>{
 const tmp=fs.mkdtempSync(path.join(base,'account-switch-')),remoteProject={id:randomUUID(),name:'合成项目'},remote=await fakeMoku({projects:[remoteProject]}),{project,asset}=fixture();remote.library.supportsClassified=async()=>true;
 const sync=makeSync({tmp,store:stubStore(project,asset),library:remote.library});t.after(async()=>{sync.close();await remote.close();fs.rmSync(tmp,{recursive:true,force:true});});
 const link=()=>sync.handle({body:{projectId:project.id,remoteProjectId:remoteProject.id,classification:{characterIds:[],sceneIds:[]}}},{},{pathname:'/api/project-sync/link',method:'POST',url:new URL('http://fixture/api/project-sync/link')});
 await link();await sync.push(project.id);const writes=()=>remote.state.requests.filter(r=>r.url.startsWith('/api/documents')&&['POST','PUT'].includes(r.method)).length,before=writes();
 remote.state.accountId=randomUUID();project.revision++;sync.mark(project);await sync.drain();assert.equal(writes(),before);assert.equal(sync.status(project.id).setupRequired,true);assert.equal(sync.status(project.id).pending,false);
 await assert.rejects(sync.push(project.id),error=>error.code==='project_account_confirmation_required');await assert.rejects(sync.exportTarget(project.id),/账号已变化/);assert.equal(writes(),before);
 await link();await sync.push(project.id);assert.equal(writes(),before+1);
});

test('只选择墨库项目即可上传，人物场景接口不可用也不阻塞归属保存',async t=>{
 const tmp=fs.mkdtempSync(path.join(base,'project-only-')),remoteProject={id:randomUUID(),name:'合成项目'},remote=await fakeMoku({projects:[remoteProject]}),{project,asset}=fixture();
 remote.library.supportsClassified=async()=>true;
 const read=remote.library.read;remote.library.read=route=>{assert.ok(!route.endsWith('/subjects'),'不能读取已移除的角色场景列表');return read(route);};
 const sync=makeSync({tmp,store:stubStore(project,asset),library:remote.library});t.after(async()=>{sync.close();await remote.close();assert.equal(path.dirname(path.resolve(tmp)),base);fs.rmSync(tmp,{recursive:true,force:true});});
 const before=structuredClone(project);
 await sync.handle({body:{projectId:project.id,remoteProjectId:remoteProject.id,classification:{characterIds:[],sceneIds:[]}}},{},{pathname:'/api/project-sync/link',method:'POST',url:new URL('http://fixture/api/project-sync/link')});
 await sync.push(project.id);
 assert.equal(remote.state.documents.size,1);assert.deepEqual(project,before);
 const created=remote.state.requests.find(r=>r.method==='POST'&&r.url==='/api/documents');
 assert.equal(created.body.projectId,remoteProject.id);assert.deepEqual(created.body.classification,{characterIds:[],sceneIds:[]});
});

test('墨库拒绝含固定引用的快照时不删引用重试；本机保存继续保留，处理后可手动重试',async t=>{
 const tmp=fs.mkdtempSync(path.join(base,'reference-rejected-')),remote=await fakeMoku({projects:[{id:randomUUID(),name:'召唤万虫'}]}),{project,asset}=fixture(),sync=makeSync({tmp,store:stubStore(project,asset),library:remote.library});
 t.after(async()=>{sync.close();await remote.close();fs.rmSync(tmp,{recursive:true,force:true});});
 const before=structuredClone(project);remote.state.rejectReferences=true;
 await assert.rejects(sync.push(project.id),error=>error.code==='project_snapshot_rejected');
 const writes=()=>remote.state.requests.filter(r=>r.url.startsWith('/api/documents')&&['POST','PUT'].includes(r.method));
 assert.equal(writes().length,1);assert.deepEqual(writes()[0].body.references,[asset.library.revisionId]);assert.equal(remote.state.documents.size,0);assert.deepEqual(project,before);
 assert.match(sync.status(project.id).error,/未移除引用/);assert.equal(sync.status(project.id).blockedReason,'project_snapshot_rejected');assert.equal(sync.status(project.id).pending,false);
 project.revision++;sync.mark(project);await sync.drain();assert.equal(writes().length,1,'后续本机保存不得自动重试');
 sync.close();const reopened=makeSync({tmp,store:stubStore(project,asset),library:remote.library});t.after(()=>reopened.close());
 reopened.mark(project);await reopened.drain();assert.equal(writes().length,1,'重启后仍须等待明确重试');assert.equal(reopened.status(project.id).blockedReason,'project_snapshot_rejected');
 remote.state.rejectReferences=false;await reopened.push(project.id);assert.equal(reopened.status(project.id).status,'synced');assert.deepEqual([...remote.state.documents.values()][0].references,[asset.library.revisionId]);
});

test('正式工程拒绝旧快照时不做冲突自愈或自动重试，保留原远端版本',async t=>{
 const tmp=fs.mkdtempSync(path.join(base,'formal-required-')),remote=await fakeMoku({projects:[{id:randomUUID(),name:'召唤万虫'}]}),{project,asset}=fixture(),sync=makeSync({tmp,store:stubStore(project,asset),library:remote.library});
 t.after(async()=>{sync.close();await remote.close();fs.rmSync(tmp,{recursive:true,force:true});});
 const first=await sync.push(project.id),prior=structuredClone(remote.state.documents.get(first.documentId));remote.state.rejectFormal=true;project.revision++;project.title+=' 修改';
 const start=remote.state.requests.length;await assert.rejects(sync.push(project.id),error=>error.code==='FORMAL_COMMIT_REQUIRED');
 assert.equal(remote.state.requests.slice(start).filter(r=>r.method==='PUT').length,1);assert.equal(remote.state.requests.slice(start).filter(r=>r.method==='GET'&&r.url.startsWith('/api/documents/')).length,0);
 assert.deepEqual(remote.state.documents.get(first.documentId),prior);assert.match(sync.status(project.id).error,/本话版本/);assert.equal(sync.status(project.id).blockedReason,'FORMAL_COMMIT_REQUIRED');
 const count=remote.state.requests.length;project.revision++;sync.mark(project);await sync.drain();assert.equal(remote.state.requests.length,count);
 sync.close();const reopened=makeSync({tmp,store:stubStore(project,asset),library:remote.library});t.after(()=>reopened.close());
 reopened.mark(project);await reopened.drain();assert.equal(remote.state.requests.length,count,'重启后不得自动走旧快照写入');
 remote.state.rejectFormal=false;await reopened.push(project.id);assert.equal(reopened.status(project.id).status,'synced');assert.equal(reopened.status(project.id).blockedReason,'');
});

test('固定引用超过接口上限时明确拒绝，不能截断后报告同步成功',async t=>{
 const tmp=fs.mkdtempSync(path.join(base,'too-many-references-')),remote=await fakeMoku({projects:[{id:randomUUID(),name:'召唤万虫'}]}),{project,asset}=fixture();
 const assets=Array.from({length:2001},(_,i)=>({...asset,id:'asset_'+randomUUID(),name:'合成素材'+i,library:{...asset.library,assetId:randomUUID(),revisionId:randomUUID()}}));
 project.references=assets.map(a=>({assetId:a.id,role:'character',name:a.name}));const store=stubStore(project,assets[0]);store.db.assets=assets;
 const sync=makeSync({tmp,store,library:remote.library});t.after(async()=>{sync.close();await remote.close();fs.rmSync(tmp,{recursive:true,force:true});});
 await assert.rejects(sync.push(project.id),error=>error.code==='project_snapshot_too_many_refs');
 assert.equal(remote.state.requests.filter(r=>r.url.startsWith('/api/documents')&&['POST','PUT'].includes(r.method)).length,0);
 assert.equal(sync.status(project.id).blockedReason,'project_snapshot_too_many_refs');assert.match(sync.status(project.id).error,/未截断引用/);
 sync.mark(project);await sync.drain();assert.equal(remote.state.requests.length,0);assert.equal(project.references.length,2001);
});
