import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';
import {randomUUID,randomBytes} from 'node:crypto';
import {encodeProjectSnapshot,decodeProjectSnapshot,SNAPSHOT_FORMAT,SNAPSHOT_REQUEST_BUDGET} from '../lib/project-snapshot-codec.mjs';
import {createProjectSync} from '../lib/project-sync.mjs';
const evidence=path.resolve('../verification/package-fixes-20261021');fs.mkdirSync(evidence,{recursive:true});
const snapshot=project=>({format:SNAPSHOT_FORMAT,version:1,projectId:project.id,title:project.title,revision:1,stableHash:'a'.repeat(64),project,assets:[]});
function library({limit=SNAPSHOT_REQUEST_BUDGET,failAfterWrite=false}={}){
 const remoteProjectId=randomUUID(),documents=new Map(),uploads=new Map(),requests=[],keys=new Map();let uploadCount=0,failed=false;
 const lib={baseUrl:'http://synthetic.invalid',defaultProjectId:remoteProjectId,read:async route=>route==='/api/projects'?{items:[{id:remoteProjectId,name:'快照测试'}]}:documents.get(route.split('/').at(-1)),
  uploadAsset:async({bytes})=>{uploadCount++;const id=randomUUID(),revisionId=randomUUID();uploads.set(revisionId,bytes);return {assetId:id,revisionId};},
  remote:async(route,options={})=>{
   if(route.startsWith('/api/revisions/'))return new Response(uploads.get(route.split('/')[3]));
   const raw=options.body,body=JSON.parse(raw),key=options.headers['Idempotency-Key'];requests.push({route,raw,key});if(Buffer.byteLength(raw)>limit)throw Object.assign(Error('Request body is too large'),{status:413});
   if(keys.has(key)){assert.equal(keys.get(key).raw,raw,'重试使用同一正文和幂等键');return new Response(JSON.stringify(keys.get(key).document));}
   const id=route==='/api/documents'?randomUUID():route.split('/').at(-1),document={...body,id,objectVersion:1};documents.set(id,document);keys.set(key,{raw,document});
   if(failAfterWrite&&!failed){failed=true;throw Error('connection reset after remote commit');}return new Response(JSON.stringify(document));
  }};
 return {lib,documents,requests,uploads,get uploadCount(){return uploadCount;}};
}
test('大快照压缩传输可逐字还原，原始工程、生产字段和服装记录完整',async()=>{
 const project={id:'project_'+randomUUID(),title:'快照测试',productionPackage:{ledger:['角色及服装\n'.repeat(800000)]},shots:[{sourceFields:{'生图提示词':'原文\n保留'}}],pages:[]},original=snapshot(project),m=library(),encoded=await encodeProjectSnapshot(original,m.lib,{projectId:randomUUID()});
 assert.equal(encoded.content.version,2);assert.equal(encoded.content.payload.storage,'inline');assert.ok(Buffer.byteLength(JSON.stringify(encoded.content))<SNAPSHOT_REQUEST_BUDGET);assert.deepEqual(await decodeProjectSnapshot(encoded.content,m.lib),original);assert.equal(m.uploadCount,0);
});
test('难压缩快照走分片原件与固定版本，损坏摘要拒绝还原',async()=>{
 const m=library(),original=snapshot({id:'project_'+randomUUID(),title:'快照测试',data:randomBytes(900000).toString('base64')}),encoded=await encodeProjectSnapshot(original,m.lib,{projectId:randomUUID()});assert.equal(encoded.content.payload.storage,'asset');assert.equal(m.uploadCount,1);assert.ok(JSON.stringify(encoded.content).length<2000);assert.deepEqual(await decodeProjectSnapshot(encoded.content,m.lib),original);
 const again=await encodeProjectSnapshot(original,m.lib,{projectId:randomUUID(),uploadedAsset:encoded.uploadedAsset});assert.equal(m.uploadCount,1,'相同原件版本不重复上传');assert.equal(again.content.payload.revisionId,encoded.content.payload.revisionId);
 const broken=structuredClone(encoded.content);broken.payload.sha256='0'.repeat(64);await assert.rejects(decodeProjectSnapshot(broken,m.lib),/摘要不符/);
});
test('墨库413自动改分片快照，网络回执丢失重试不重复建文档或原件',async t=>{
 const m=library({limit:1400,failAfterWrite:true}),project={id:'project_'+randomUUID(),title:'快照测试',revision:1,updated:'2026-10-21',shots:[],pages:[],references:[],payload:randomBytes(8000).toString('base64')},dir=fs.mkdtempSync(path.join(evidence,'snapshot-'));
 const store={db:{assets:[],projects:[project]},project:id=>{assert.equal(id,project.id);return project;}};
 const sync=createProjectSync({dataDir:dir,store,library:m.lib,projectView:p=>structuredClone(p),json(){},body(){},enabled:true});t.after(()=>sync.close());
 await assert.rejects(sync.push(project.id),/connection reset/);const result=await sync.push(project.id);assert.equal(result.status,'synced');assert.equal(m.documents.size,1);assert.equal(m.uploadCount,1);const document=[...m.documents.values()][0];assert.equal(document.content.payload.storage,'asset');assert.deepEqual((await decodeProjectSnapshot(document.content,m.lib)).project,project);assert.equal(sync.status(project.id).error,'');
});
