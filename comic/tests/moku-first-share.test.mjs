import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {createMokuClassifiedReader} from '../lib/moku-classified-reader.mjs';import {createMokuProjectLibrary} from '../lib/moku-project-library.mjs';import {decodeProjectSnapshot} from '../lib/project-snapshot-codec.mjs';
const source='file:///C:/Users/EDY/Documents/Codex/2026-10-23/new-chat/outputs/moku-extensionless-images/';
const {projectFixture}=await import(source+'tests/project-assets-fixture.mjs'),{runOne}=await import(source+'server/tasks.mjs');
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
test('first share without images uses explicit subject; large updates keep one engineering asset and fixed history',async()=>{
 const dir=fs.mkdtempSync(path.resolve('../audit-data/first-share-')),f=await projectFixture({fixtureRoot:path.join(dir,'db')});
 async function request(route,options={}){let payload=options.body;if(typeof payload==='string')payload=JSON.parse(payload);const r=await f.request(options.method||'GET',route,payload,options.headers);if(r.statusCode>=400)throw Object.assign(Error(r.body),{status:r.statusCode});if(route.endsWith('/complete'))for(let n=0;n<100&&await runOne(f.db,f.c,()=>{throw Error('backup prohibited');});n++);return new Response(r.rawPayload,{status:r.statusCode,headers:r.headers});}
 const post=async(route,payload)=>(await request(route,{method:'POST',body:JSON.stringify(payload)})).json();
 const reader=createMokuClassifiedReader({request}),library=createMokuProjectLibrary({dataDir:dir,request,reader});
 try{
  const project=await post('/api/projects',{name:'空白工程首次共享'}),subject=await post('/api/project-library/'+project.id+'/subjects',{kind:'character',name:'合成主角'});
  const local={id:'project_'+randomUUID(),title:'合成工作台工程',revision:1,pages:[{id:'page_'+randomUUID(),name:'第11话',storyboard:{episode:11},panels:[{id:'panel_'+randomUUID(),name:'合成格'}]}]};
  let content={format:'comic-strip-project-snapshot',version:1,projectId:local.id,title:local.title,project:local,assets:[],stableHash:hash(local)};
  const write=async(previous,classification)=>{const response=await library.handle(previous?'/api/documents/'+previous.id:'/api/documents',{method:previous?'PUT':'POST',body:JSON.stringify({projectId:project.id,name:'工程',type:'engineering.snapshot',content,classification,objectVersion:previous?.objectVersion})});return response.json();};
  let saved=await write(null,{characterIds:[subject.id],sceneIds:[]}),first=saved;
  const original=await(await library.handle('/api/documents/'+saved.id)).json();assert.deepEqual(await decodeProjectSnapshot(original.content,{remote:reader.handle}),content);
  const engineers=(await(await request('/api/project-library/'+project.id+'/engineerings')).json()).items,engineering=engineers.find(e=>e.id===saved.id),assetId=engineering.assetId;assert.ok(assetId);
  for(let n=0;n<2;n++){content={...content,project:{...local,revision:n+2},auditPadding:randomBytes(650000).toString('base64')};content.stableHash=hash(content);saved=await write(saved);const read=await(await library.handle('/api/documents/'+saved.id)).json();assert.equal(read.content.version,3);assert.deepEqual(await decodeProjectSnapshot(read.content,{remote:reader.handle}),content);}
  const route='/api/project-library/'+project.id+'/'+engineering.episodeId+'/file/comic_project/assets/'+assetId;
  const asset=await(await request(route)).json();assert.equal(asset.versionCount,3);assert.deepEqual(asset.characterIds,[subject.id]);
  const retained=await(await request('/api/project-library/'+project.id+'/engineerings/'+engineering.id+'/snapshots/'+first.snapshots[0].snapshotId)).json();assert.equal(retained.id,first.snapshots[0].snapshotId);
  const invalid={...content,project:{...local,id:'project_'+randomUUID()}};invalid.projectId=invalid.project.id;content=invalid;
  await assert.rejects(write(null,{characterIds:[randomUUID()],sceneIds:[]}),/SUBJECT|角色/);
 }finally{await f.close();}
});
