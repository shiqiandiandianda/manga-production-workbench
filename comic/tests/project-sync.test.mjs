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
  const state={authorized,projects,documents:new Map(),requests:[]};
  const server=http.createServer(async (request,response)=>{
    let raw='';for await(const chunk of request)raw+=chunk;
    const body=raw?JSON.parse(raw):null;
    state.requests.push({method:request.method,url:request.url,body,idempotency:request.headers['idempotency-key']||''});
    const send=(status,value)=>{response.writeHead(status,{'Content-Type':'application/json'});response.end(JSON.stringify(value));};
    if(!state.authorized)return send(401,{error:{message:'未登录或会话已失效'}});
    if(request.method==='GET'&&request.url==='/api/auth/me')return send(200,{user:{username:'tester',displayName:'测试账号'}});
    if(request.method==='GET'&&request.url==='/api/projects')return send(200,{items:state.projects});
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
      if(!response.ok){const data=await response.json().catch(()=>({}));throw Object.assign(new Error(data?.error?.message||'HTTP '+response.status),{status:response.status});}
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
