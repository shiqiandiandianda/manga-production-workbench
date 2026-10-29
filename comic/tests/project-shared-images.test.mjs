import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {createMokuProjectLibrary} from '../lib/moku-project-library.mjs';
import {createProjectMediaFiles} from '../lib/project-media-files.mjs';
import {decodeProjectSnapshot} from '../lib/project-snapshot-codec.mjs';
import {mockMoku} from './moku-project-library-fixture.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');

test('复制格、重复导入与跨话共用只上传一份原图，不同内容独立上传并可回读',{timeout:30000},async t=>{
 const dir=fs.mkdtempSync(path.join(import.meta.dirname,'fixture-shared-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const m=mockMoku(),receipts={},assets=[],files=new Map(),subjectId=randomUUID(),characterCloud=randomUUID(),characterRevision=randomUUID();
 const add=(bytes,name='合成图')=>{const id='asset_'+randomUUID(),file=path.join(dir,id+'.png');fs.writeFileSync(file,bytes);files.set(id,file);const a={id,name,mime:'image/png',width:1,height:1};assets.push(a);return a;};
 const character=add(Buffer.from('角色参考'),'角色'),original=add(Buffer.from('原图A')),same=add(Buffer.from('原图A')),different=add(Buffer.from('原图B'));
 character.library={assetId:characterCloud,revisionId:characterRevision,projectId:m.projectId,assetType:'character',sha256:sha(fs.readFileSync(files.get(character.id)))};
 const frame=id=>({id:'panel_'+randomUUID(),imageAssetId:id,referenceIds:[character.id],imageScale:95});
 const project={id:'project_'+randomUUID(),title:'合成共用工程',pages:[{id:'page_'+randomUUID(),storyboard:{episode:35},panels:[frame(original.id),frame(original.id),frame(same.id),frame(different.id)]},{id:'page_'+randomUUID(),storyboard:{episode:36},panels:[frame(original.id)]}]};
 const store={db:{assets,libraryFonts:[]},assetPath:id=>files.get(id),save(){}};
 const reader={...m.reader,handle:async route=>route==='/api/assets/'+characterCloud?Response.json({projectId:m.projectId,assetType:'character',objectId:subjectId,characterIds:[subjectId]}):m.reader.handle(route)};
 const classified=createMokuProjectLibrary({dataDir:dir,request:m.request,reader,getAssets:()=>assets});
 const library={baseUrl:'http://fixture',assertSession(){},projectUploadContext:classified.uploadContext,uploadAsset:classified.upload};
 const build=()=>createProjectMediaFiles({store,library,dataDir:dir,receipts,persist(){}});
 const before=structuredClone(project),packed=await build().pack(project,m.projectId);
 assert.deepEqual(project,before,'不改变格子、取景或本地引用');assert.equal(m.uploads.size,2,'A 共用一份，B 单独一份');
 const refs=new Map(packed.assets.map(a=>[a.id,a.library]));assert.equal(refs.get(original.id).revisionId,refs.get(same.id).revisionId);assert.notEqual(refs.get(original.id).revisionId,refs.get(different.id).revisionId);
 const response=await classified.handle('/api/documents',{method:'POST',body:JSON.stringify({projectId:m.projectId,name:'合成快照',type:'engineering.snapshot',content:packed,references:[]})}),saved=await response.json();
 const cloudPanels=m.engineers.flatMap(e=>e.panels),sharedRefs=[...m.snapshots.values()].flatMap(s=>s.references).filter(r=>r.revisionId===refs.get(original.id).revisionId);
 assert.equal(sharedRefs.length,4);for(const f of [...project.pages[0].panels.slice(0,3),project.pages[1].panels[0]])assert.ok(sharedRefs.some(r=>r.panelId===cloudPanels.find(p=>p.externalId===f.id).id));
 const doc=await(await classified.handle('/api/documents/'+saved.id)).json(),decoded=await decodeProjectSnapshot(doc.content,{remote:reader.handle});assert.deepEqual(decoded.project,packed.project);assert.deepEqual(decoded.assets,packed.assets);
 await build().pack(project,m.projectId);assert.equal(m.uploads.size,2,'重启和重试复用已确认回执');
 for(const a of [original,same,different])delete a.library;project.pages[0].panels.reverse();await build().pack(project,m.projectId);assert.equal(m.uploads.size,2,'元数据丢失和调层后仍按内容复用回执');
 const later=add(Buffer.from('原图A'));project.pages[0].panels.unshift(frame(later.id));await build().pack(project,m.projectId);assert.equal(m.uploads.size,2,'后续新增格同图复用');
 fs.writeFileSync(files.get(later.id),Buffer.from('新内容C'));await build().pack(project,m.projectId);assert.equal(m.uploads.size,3,'相同本地编号更换内容必须上传新图');assert.notEqual(later.library.revisionId,original.library.revisionId);
});

test('相同字节不会跨项目或跨资产类别借用上传回执',async t=>{
 const dir=fs.mkdtempSync(path.join(import.meta.dirname,'fixture-shared-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const bytes=Buffer.from('相同字节'),file=path.join(dir,'image.png');fs.writeFileSync(file,bytes);const id='asset_'+randomUUID(),projectId=randomUUID(),foreign=randomUUID(),asset={id,name:'格图'},project={id:'project_'+randomUUID(),pages:[{panels:[{id:'panel_'+randomUUID(),imageAssetId:id}]}]},uploads=[];
 const receipt=extra=>({assetId:randomUUID(),revisionId:randomUUID(),sha256:sha(bytes),projectId,assetType:'comic_panel',...extra});
 const library={projectUploadContext:async()=>({projectId,assetType:'comic_panel',assetKind:'image'}),uploadAsset:async input=>{uploads.push(input);return receipt({});}};
 await createProjectMediaFiles({store:{db:{assets:[asset]},assetPath:()=>file,save(){}},library,dataDir:dir,receipts:{foreign:receipt({projectId:foreign}),character:receipt({assetType:'character'})},persist(){}}).pack(project,projectId);
 assert.equal(uploads.length,1);
});
