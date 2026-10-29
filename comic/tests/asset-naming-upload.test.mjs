import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createMokuProjectLibrary} from '../lib/moku-project-library.mjs';
import {mockMoku} from './moku-project-library-fixture.mjs';
const root=path.resolve('../quality-runs/asset-naming-20261030/upload-tests');
function fixture(t){fs.mkdirSync(root,{recursive:true});const dataDir=fs.mkdtempSync(path.join(root,'fixture-')),m=mockMoku(),create=()=>createMokuProjectLibrary({dataDir,request:m.request,reader:m.reader,accountKey:async()=>m.projectId}),subjects=async()=>(await(await m.request('/api/project-library/'+m.projectId+'/subjects')).json()).items,addSubject=async name=>(await(await m.request('/api/project-library/'+m.projectId+'/project/image/scene/objects',{method:'POST',headers:{'Idempotency-Key':randomUUID()},body:JSON.stringify({name})})).json());return {...m,dataDir,create,upload:create().upload,subjects,addSubject};}
test('every classified character upload stores only the subject and costume once, even after a repeated display label is submitted',async t=>{
 const f=fixture(t),input={projectId:f.projectId,scopeId:'project',assetKind:'image',assetType:'character',objectName:'合成作品-陆小凤',variantName:'合成作品-陆小凤-合成作品-陆小凤-黑衣',name:'合成作品-陆小凤-合成作品-陆小凤-黑衣.png',mime:'image/png',bytes:Buffer.from('synthetic image fixture'),operationId:'repeat-prefix'};
 const first=await f.upload(input),stored=f.assets.get(first.assetId);assert.equal(stored.name,'陆小凤__黑衣.png');assert.equal(stored.variantName,'黑衣');assert.equal((await f.subjects())[0].name,'陆小凤');assert.equal((await f.upload(input)).revisionId,first.revisionId);assert.equal(f.uploads.size,1);
});
test('a uniquely normalized existing subject is reused; ambiguous subjects are never merged',async t=>{
 const f=fixture(t),{id}=await f.addSubject('合成作品-县衙·书房');
 const input={projectId:f.projectId,assetKind:'image',assetType:'scene',objectName:'县衙·书房',variantName:'正视·日景',name:'old.png',bytes:Buffer.from('fixture'),operationId:'unique-subject'};
 const result=await f.upload(input);assert.equal(f.assets.get(result.assetId).objectId,id);assert.equal((await f.subjects()).length,1);
 await f.addSubject('县衙·书房');
 await assert.rejects(f.upload({...input,operationId:'ambiguous-subject'}),/同名资产对象不唯一/);assert.equal(f.uploads.size,1);
});
test('pending costume text is omitted from uploaded variant metadata',async t=>{
 const f=fixture(t),result=await f.upload({projectId:f.projectId,assetKind:'image',assetType:'character',objectName:'薛冰',variantName:'未知（待确认）',name:'薛冰_未知.png',bytes:Buffer.from('fixture'),operationId:'unknown-state'});
 assert.equal(f.assets.get(result.assetId).variantName,undefined);assert.equal(f.assets.get(result.assetId).name,'薛冰.png');
});
test('an upload receipt created before naming versioning can still resume without a new upload',async t=>{
 const f=fixture(t),input={projectId:f.projectId,assetKind:'image',assetType:'character',objectName:'陆小凤',variantName:'黑衣',name:'陆小凤__黑衣.png',bytes:Buffer.from('fixture'),operationId:'legacy-receipt'},first=await f.upload(input);
 const file=path.join(f.dataDir,'moku-project-library.local.json'),state=JSON.parse(fs.readFileSync(file,'utf8'));for(const item of Object.values(state.uploads))delete item.namingVersion;fs.writeFileSync(file,JSON.stringify(state));
 const second=await f.create().upload(input);assert.equal(second.assetId,first.assetId);assert.equal(f.uploads.size,1);
});
