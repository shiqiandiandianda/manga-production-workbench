import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
import {createRemoteLibrary} from '../lib/remote-library.mjs';
import {inspectProductionPackage,packageDigest} from '../lib/production-package.mjs';
import {productionProject} from '../lib/production-package-document.mjs';
import {ensureProjectPanelGeneration} from '../public/panel-generation.js';
import {auditPanelReferences} from '../public/panel-reference-audit.js';
import {prepareWorkspaceBinding} from '../lib/asset-workspace-api.mjs';

const evidence=fileURLToPath(new URL('../../verification/moku-rename-cache-sync/',import.meta.url));
fs.mkdirSync(evidence,{recursive:true});
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jp1sAAAAASUVORK5CYII=','base64');
const oldName='01_王长生_预备弟子装.png',newName='01_王长生_雷云峰外门道袍.png';
function fixture(t,{cached=true}={}){
 const dataDir=fs.mkdtempSync(path.join(evidence,'fixture-')),base='http://moku-rename.invalid',assetId=randomUUID(),revisionId=randomUUID(),sha256=hash(png),cache=path.join(dataDir,'library-cache');fs.mkdirSync(cache);
 const file=path.join(cache,revisionId+'_'+sha256+'.png'),library={baseUrl:base,projectId:randomUUID(),assetId,revisionId,sha256,objectVersion:2,category:'character',tags:[]};
 const original={id:'asset_'+randomUUID(),name:oldName,filePath:file,width:1,height:1,source:'moku',library:{...library}};
 const db={assets:cached?[original]:[],jobs:[],projects:[]};if(cached){fs.writeFileSync(file,png);fs.utimesSync(file,new Date('2020-01-01'),new Date('2020-01-01'));}
 let saves=0,downloads=0;const calls=[];
 const detail={id:assetId,name:newName,projectId:library.projectId,objectVersion:3,category:'character',folder:'人物设定',tags:['已确认'],recommendedRevisionId:revisionId,revisions:[{id:revisionId,originalName:oldName,mime:'image/png',sha256,size:png.length}]};
 t.mock.method(globalThis,'fetch',async(url,options={})=>{const u=new URL(url);assert.equal(u.origin,base);calls.push({path:u.pathname,method:options.method||'GET'});if(u.pathname==='/api/project-library/taxonomy')return Response.json({error:'not found'},{status:404});if(u.pathname==='/api/assets/'+assetId)return Response.json(detail);if(u.pathname==='/api/revisions/'+revisionId+'/download'){downloads++;return new Response(png,{'headers':{'Content-Type':'image/png'}});}throw Error('Unexpected mock request: '+u.pathname);});
 const store={db,save(){saves++;},asset(id){return db.assets.find(a=>a.id===id);},assetPath(id){return this.asset(id)?.filePath;}};
 const addAsset=(filePath,name,source)=>{const same=db.assets.find(a=>a.filePath===filePath);if(same)return same;const a={id:'asset_'+randomUUID(),name,filePath,width:1,height:1,source};db.assets.push(a);return a;};
 const remote=createRemoteLibrary({dataDir,baseUrl:base,store,addAsset});
 return {dataDir,base,assetId,revisionId,sha256,file,library,original,detail,store,db,calls,import:()=>remote.importAsset({assetId,revisionId}),get saves(){return saves;},get downloads(){return downloads;}};
}
function sourceFile(relativePath,data){const bytes=Buffer.from(JSON.stringify(data));return {relativePath,bytes,sha256:packageDigest(bytes)};}
async function bindingProject(f){
 const board={'格式':'分镜 JSON 2.2','作品':'墨库改名合成验收','话':12,'格':[{'格ID':'E012-001','画面内容':'王长生在庭院','生图提示词':'原文','服装':{'王长生':'雷云峰外门道袍'}}]};
 const screen={'版本':'屏段文字层 1.1','作品':board['作品'],'话':12,'文字':[],'屏段':[{'段ID':'段01','格':[{'格ID':'E012-001','格号':1}],'附图':[{'类型':'设定卡','人物':'王长生','服装':'雷云峰外门道袍','必须':true}],'提示词':{'空泡':'空泡原文','无泡':'无泡原文'},'底图':{'方式':'纯白'}}]};
 const source=await inspectProductionPackage([sourceFile('分镜JSON/第012话_分镜.json',board),sourceFile('屏段/第012话_屏段文字层.json',screen)]),project=productionProject(source);ensureProjectPanelGeneration(project,f.db.assets);f.db.projects.push(project);f.store.project=id=>{assert.equal(id,project.id);return project;};
 const panel=project.pages[0].panels.find(p=>p.productionSegment),need=auditPanelReferences(project,panel,f.db.assets).needs[0];
 const bind=asset=>prepareWorkspaceBinding(f.store,project,{expectedRevision:project.revision,targets:[{panelId:panel.id,needId:need.id}],assetId:asset.id},asset);
 return {project,panel,need,bind};
}

test('再次取用已改名的同一固定版本，同步名称且复用本地ID与缓存图片',async t=>{
 const f=fixture(t),mtime=fs.statSync(f.file).mtimeMs,result=await f.import();
 assert.equal(result.asset.name,newName);assert.equal(result.asset.id,f.original.id);assert.equal(result.asset.filePath,f.file);assert.equal(f.db.assets.length,1);
 assert.equal(result.asset.library.revisionId,f.revisionId);assert.equal(result.asset.library.sha256,f.sha256);assert.equal(result.asset.library.objectVersion,3);
 assert.equal(hash(fs.readFileSync(f.file)),f.sha256);assert.equal(fs.statSync(f.file).mtimeMs,mtime);assert.equal(f.downloads,0);assert.equal(f.saves,1);assert.ok(f.calls.every(c=>c.method==='GET'));
});
test('同一资产同一版本的多份本机缓存同步改名，引用与本地ID不变',async t=>{
 const f=fixture(t),copy={...structuredClone(f.original),id:'asset_'+randomUUID(),filePath:path.join(f.dataDir,'project-center-copy.png')};fs.writeFileSync(copy.filePath,png);f.db.assets.push(copy);
 const project={references:[{assetId:copy.id,name:oldName}],sourceSnapshot:{name:oldName,revisionId:f.revisionId}};f.db.projects.push(project);const before=structuredClone(project),ids=f.db.assets.map(a=>a.id);
 await f.import();assert.ok(f.db.assets.every(a=>a.name===newName));assert.deepEqual(f.db.assets.map(a=>a.id),ids);assert.deepEqual(project,before);assert.equal(hash(fs.readFileSync(copy.filePath)),f.sha256);assert.ok(f.db.assets.every(a=>a.library.revisionId===f.revisionId&&a.library.sha256===f.sha256));
});
test('不串改其他资产、其他固定版本或其他墨库来源的缓存',async t=>{
 const f=fixture(t),unrelated=[{assetId:randomUUID()},{revisionId:randomUUID()},{sha256:'b'.repeat(64)},{baseUrl:'http://another-moku.invalid'}].map(change=>({...structuredClone(f.original),id:'asset_'+randomUUID(),filePath:path.join(f.dataDir,randomUUID()+'.png'),library:{...f.library,...change}}));f.db.assets.push(...unrelated);const before=structuredClone(unrelated);
 await f.import();assert.equal(f.original.name,newName);assert.deepEqual(unrelated,before);
});
test('墨库推荐版本变化不会替换用户选定的旧版本或原始文件名',async t=>{
 const f=fixture(t),latest=randomUUID();f.detail.recommendedRevisionId=latest;f.detail.revisions.push({id:latest,originalName:'new-image.png',sha256:'c'.repeat(64),size:123,mime:'image/png'});const source=structuredClone(f.detail);
 const result=await f.import();assert.equal(result.asset.name,newName);assert.equal(result.asset.library.revisionId,f.revisionId);assert.equal(result.asset.library.sha256,f.sha256);assert.deepEqual(f.detail,source);assert.equal(f.detail.revisions[0].originalName,oldName);assert.equal(f.downloads,0);
});
test('新图片首次取用仍正常下载校验，之后重命名不重复下载',async t=>{
 const f=fixture(t,{cached:false});f.detail.name=oldName;const first=await f.import();assert.equal(first.asset.name,oldName);assert.equal(f.downloads,1);
 f.detail.name=newName;f.detail.objectVersion=4;const second=await f.import();assert.equal(second.asset.id,first.asset.id);assert.equal(second.asset.name,newName);assert.equal(f.downloads,1);assert.equal(f.db.assets.length,1);
});
test('改名后的缓存可通过真实采用逻辑，不同服装仍以409拒绝',async t=>{
 const f=fixture(t),b=await bindingProject(f),before=structuredClone(b.project);assert.throws(()=>b.bind(f.original),e=>e.status===409&&/预备弟子装/.test(e.message));
 const result=await f.import(),adopted=b.bind(result.asset),panel=adopted.pages[0].panels.find(p=>p.id===b.panel.id),need=auditPanelReferences(adopted,panel,f.db.assets).needs.find(n=>n.id===b.need.id);assert.equal(need.blocking,false);assert.ok(need.selectedIds.includes(f.original.id));
 const wrong={...structuredClone(result.asset),id:'asset_'+randomUUID(),name:'02_王长生_长生会经营装.png'};f.db.assets.push(wrong);assert.throws(()=>b.bind(wrong),e=>e.status===409&&/人物服装冲突/.test(e.message));assert.deepEqual(b.project,before);
});
test('删除或不属于资产的版本拒绝采用，失败时不提前修改缓存元数据',async t=>{
 const f=fixture(t),before=structuredClone(f.original);f.detail.deletedAt='2026-10-24';await assert.rejects(f.import(),/素材已删除/);assert.deepEqual(f.original,before);delete f.detail.deletedAt;f.detail.revisions=[];await assert.rejects(f.import(),/此版本不属于/);assert.deepEqual(f.original,before);assert.equal(f.saves,0);
});
test('图片摘要校验失败仍拦截，名称不会在失败时被提前同步',async t=>{
 const f=fixture(t),before=structuredClone(f.original);fs.writeFileSync(f.file,'corrupted test cache');f.detail.revisions[0].sha256='d'.repeat(64);await assert.rejects(f.import(),/完整性校验失败/);assert.deepEqual(f.original,before);assert.equal(f.saves,0);
});
