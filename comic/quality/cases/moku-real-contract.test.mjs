import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {createRemoteLibrary} from '../../lib/remote-library.mjs';
import {createProjectSync} from '../../lib/project-sync.mjs';
import {decodeProjectSnapshot} from '../../lib/project-snapshot-codec.mjs';
import {createFormalEngineeringVersions} from '../../lib/formal-engineering-versions.mjs';
import {createEpisodeVersionStore} from '../../lib/episode-versions.mjs';
import {createMokuRecycle} from '../../lib/moku-recycle.mjs';
import {createProject} from '../../public/model.js';
import {Store} from '../../lib/store.mjs';
import {createStudio} from '../../server.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const listen=server=>new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve('http://127.0.0.1:'+server.address().port)));
const body=async req=>{const chunks=[];for await(const chunk of req)chunks.push(chunk);return JSON.parse(Buffer.concat(chunks).toString()||'{}');};
const json=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};

test('工作台与隔离的墨库实际接口闭环',{timeout:120000},async t=>{
  const root=process.env.QUALITY_MOKU_TEST_SOURCE;
  assert.ok(root,'QUALITY_MOKU_TEST_SOURCE_REQUIRED: 设置 QUALITY_MOKU_SOURCE 为带测试依赖的受支持墨库源码');
  const schemaVersion=Number(process.env.QUALITY_MOKU_SCHEMA_VERSION);
  assert.ok([23,24].includes(schemaVersion),'QUALITY_MOKU_SCHEMA_VERSION_REQUIRED: 请通过质量测试运行器选择已验证的墨库构建');
  const {projectFixture}=await import(pathToFileURL(path.join(root,'tests/project-assets-fixture.mjs')).href);
  const {runOne}=await import(pathToFileURL(path.join(root,'server/tasks.mjs')).href);
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'moku-real-'));
  const allocator=http.createServer(),unused=await listen(allocator),port=Number(new URL(unused).port);
  await new Promise(resolve=>allocator.close(resolve));
  const f=await projectFixture({schemaVersion,port,fixtureRoot:path.join(dir,'library')});
  let active=true,worker,editor;
  t.after(async()=>{active=false;await worker;if(editor){editor.closeAllConnections();await new Promise(resolve=>editor.close(resolve));}await f.close();});
  await f.app.listen({host:'127.0.0.1',port});
  let workerError;
  worker=(async()=>{while(active){try{await runOne(f.db,f.c,()=>{throw Error('Backup forbidden in synthetic test');});}catch(error){workerError=error;return;}await delay(50);}})();
  const call=async(method,url,payload,status=200)=>{const r=await f.request(method,url,payload);assert.equal(r.statusCode,status,r.body);return r.json();};
  const project=await call('POST','/api/projects',{name:'隔离测试项目'}),other=await call('POST','/api/projects',{name:'另一个隔离项目'});
  const episode=await call('POST','/api/projects/'+project.id+'/episodes',{number:'1'}),foreign=await call('POST','/api/projects/'+other.id+'/episodes',{number:'1'});
  const subject=await call('POST','/api/project-library/'+project.id+'/subjects',{name:'合成角色',kind:'character'});
  const config=path.join(dir,'moku-config.json');fs.writeFileSync(config,JSON.stringify({base:'http://127.0.0.1:'+port}));
  const store={db:{assets:[],projects:[],libraryFonts:[]},save(){}};
  const library=createRemoteLibrary({dataDir:dir,configPath:config,store,addAsset(file,name){const a={id:'asset_'+randomUUID(),name,filePath:file};store.db.assets.push(a);return a;},body,json});
  editor=http.createServer(async(req,res)=>{try{const url=new URL(req.url,'http://fixture');if(!await library.handle(req,res,{pathname:url.pathname,method:req.method,url}))json(res,404,{});}catch(error){json(res,error.status||500,{error:error.message});}});
  const editorUrl=await listen(editor);
  const editorCall=async(route,method='GET',input)=>{const r=await fetch(editorUrl+route,{method,headers:input?{'Content-Type':'application/json'}:{},...(input?{body:JSON.stringify(input)}:{})});return {status:r.status,value:await r.json()};};
  const {createCanvas}=createRequire(import.meta.url)(process.env.COMIC_TEST_CANVAS_MODULE),canvas=createCanvas(32,48);canvas.getContext('2d').fillRect(0,0,32,48);const png=canvas.toBuffer('image/png');

  await t.test('普通账号登录、真实分类接口与跨项目归属校验',async()=>{
    assert.equal((await editorCall('/api/library/status')).value.connected,false);
    assert.equal((await editorCall('/api/library/login','POST',{username:'test-maker',password:'moku-test-only-2026'})).status,200);
    const me=(await editorCall('/api/library/status')).value;assert.equal(me.connected,true);assert.equal(me.user.isAdmin,false);
    const spec=await library.read('/api/openapi.json');assert.ok(spec.paths['/api/auth/login']);assert.ok(spec.paths['/api/project-library/{projectId}/{scopeId}/{assetKind}/{assetType}/uploads']);
    const taxonomy=await library.read('/api/project-library/taxonomy');assert.equal(taxonomy.items.find(item=>item.type==='comic_project').subjectRule,'optional');
    await assert.rejects(library.uploadAsset({projectId:project.id,name:'未分类.png',bytes:png}),/明确分类/);
    await assert.rejects(library.uploadAsset({projectId:project.id,scopeId:foreign.id,assetKind:'image',assetType:'character',objectId:subject.id,name:'跨项目.png',mime:'image/png',bytes:png}),error=>Number(error.status)===400);
  });
  let character,bubble,font,formalEvidence;
  await t.test('真实分类上传、无后缀图片、幂等重试和固定版本下载',async()=>{
    const charInput={projectId:project.id,scopeId:'project',assetKind:'image',assetType:'character',objectId:subject.id,name:'合成角色.png',mime:'image/png',bytes:png,operationId:'synthetic-character-upload'};
    const bubbleInput={projectId:project.id,assetKind:'image',assetType:'bubble',name:'无后缀气泡',mime:'image/png',bytes:png,operationId:'synthetic-bubble-upload'};
    [character,bubble]=await Promise.all([library.uploadAsset(charInput),library.uploadAsset(bubbleInput)]);
    const retry=await library.uploadAsset(charInput);assert.equal(retry.assetId,character.assetId);assert.equal(retry.revisionId,character.revisionId);
    const outfitInput={...charInput,name:'同名服装.png',variantName:'同名服装',variantKind:'outfit'};
    const independentA=await library.uploadAsset({...outfitInput,operationId:'independent-a'}),independentB=await library.uploadAsset({...outfitInput,operationId:'independent-b'});assert.notEqual(independentA.assetId,independentB.assetId);assert.notEqual(independentA.revisionId,independentB.revisionId);
    const globalA=await library.uploadAsset({...bubbleInput,operationId:'global-independent-a'}),globalB=await library.uploadAsset({...bubbleInput,operationId:'global-independent-b'});assert.notEqual(globalA.assetId,globalB.assetId);assert.notEqual(globalA.revisionId,globalB.revisionId);
    const [concurrentA,concurrentB]=await Promise.all([library.uploadAsset({...bubbleInput,operationId:'same-concurrent-operation'}),library.uploadAsset({...bubbleInput,operationId:'same-concurrent-operation'})]);assert.equal(concurrentA.assetId,concurrentB.assetId);assert.equal(concurrentA.revisionId,concurrentB.revisionId);
    await assert.rejects(library.uploadAsset({...outfitInput,name:'不同名称.png',operationId:'independent-a'}),/上传操作编号对应的分类或内容已变化/);
    assert.equal(bubble.projectId,null);assert.equal(bubble.scopeId,'global');assert.match(bubble.name,/\.png$/i);assert.equal(bubble.sha256,hash(png));
    const listed=await editorCall('/api/library/assets?projectId=public&kind=bubble');assert.ok(listed.value.items.some(item=>item.id===bubble.assetId));
    const imported=await editorCall('/api/library/import','POST',{assetId:bubble.assetId,revisionId:bubble.revisionId});assert.equal(imported.status,201);assert.equal(imported.value.asset.library.revisionId,bubble.revisionId);assert.equal(hash(fs.readFileSync(store.db.assets.at(-1).filePath)),hash(png));
    const versions=await library.read('/api/assets/'+bubble.assetId+'/revisions?limit=1');assert.equal(versions.items[0].id,bubble.revisionId);
    assert.equal(workerError,undefined);
  });
  await t.test('全局人物铭牌、特效字和字体分别上传检索，字体按固定版本取用',async()=>{
    const fontPath=process.env.QUALITY_TEST_FONT;assert.ok(fontPath&&fs.existsSync(fontPath),'QUALITY_TEST_FONT_REQUIRED: 请提供本地测试字体');
    const fontBytes=fs.readFileSync(fontPath),common={projectId:project.id,mime:'image/png',bytes:png};
    const [plate,sfx,uploadedFont]=await Promise.all([
      library.uploadAsset({...common,assetKind:'image',assetType:'nameplate',name:'合成人物铭牌.png'}),
      library.uploadAsset({...common,assetKind:'image',assetType:'sfx_text',name:'合成特效字.png'}),
      library.uploadAsset({projectId:project.id,assetKind:'file',assetType:'font',name:'测试字体.ttf',mime:'font/ttf',bytes:fontBytes})
    ]);
    font=uploadedFont;
    for(const item of [plate,sfx,font]){assert.equal(item.projectId,null);assert.equal(item.scopeId,'global');}
    assert.equal(new Set([bubble.assetId,plate.assetId,sfx.assetId,font.assetId]).size,4);
    const plates=await editorCall('/api/library/assets?projectId=public&assetType=nameplate');assert.ok(plates.value.items.some(x=>x.id===plate.assetId));
    const effects=await editorCall('/api/library/assets?projectId=public&kind=sfx');assert.ok(effects.value.items.some(x=>x.id===sfx.assetId));
    const fonts=await editorCall('/api/library/assets?projectId=public&kind=font');assert.ok(fonts.value.items.some(x=>x.id===font.assetId));
    const imported=await editorCall('/api/library/import','POST',{assetId:font.assetId,revisionId:font.revisionId});assert.equal(imported.status,201);assert.equal(imported.value.font.provenance.sha256,hash(fontBytes));assert.equal(imported.value.font.revisionId,font.revisionId);
  });
  await t.test('相同原件的不同格保持独立，同格明确追加版本',async()=>{
    const engineering=await call('POST','/api/project-library/'+project.id+'/engineerings',{episodeId:episode.id,name:'格图身份合成工程',externalSystem:'quality-test',externalId:'identity-engineering'});
    const root='/api/project-library/'+project.id+'/engineerings/'+engineering.id;
    const firstPanel=await call('POST',root+'/panels',{name:'合成格一',externalId:'identity-panel-one'}),secondPanel=await call('POST',root+'/panels',{name:'合成格二',externalId:'identity-panel-two'});
    const input={projectId:project.id,scopeId:episode.id,assetKind:'image',assetType:'comic_panel',engineeringId:engineering.id,characterIds:[subject.id],name:'相同格图.png',mime:'image/png',bytes:png};
    const first=await library.uploadAsset({...input,panelId:firstPanel.id,operationId:'panel-one-v1'}),second=await library.uploadAsset({...input,panelId:secondPanel.id,operationId:'panel-two-v1'});
    assert.notEqual(first.assetId,second.assetId);assert.notEqual(first.revisionId,second.revisionId);
    const repeated=await library.uploadAsset({...input,panelId:firstPanel.id,operationId:'panel-one-v1'});assert.equal(repeated.revisionId,first.revisionId);
    const next=await library.uploadAsset({...input,panelId:firstPanel.id,assetId:first.assetId,objectVersion:first.detail.objectVersion,operationId:'panel-one-v2'});assert.equal(next.assetId,first.assetId);assert.notEqual(next.revisionId,first.revisionId);
    assert.equal((await library.read('/api/assets/'+second.assetId+'/revisions/'+second.revisionId)).id,second.revisionId);
  });
  await t.test('工作台为项目和全局图片追加别名，搜索可找回且固定版本不变',async()=>{
    for(const [reference,label,projectId] of [[character,'工作台角色别名',project.id],[bubble,'工作台气泡别名','public']]){
      const route='/api/library/assets/'+reference.assetId+'/tags';
      const first=await editorCall(route,'POST',{tags:[label]});assert.equal(first.status,200,JSON.stringify(first.value));assert.ok(first.value.asset.tags.includes(label));
      const version=first.value.asset.objectVersion,second=await editorCall(route,'POST',{tags:[label]});assert.equal(second.status,200);assert.equal(second.value.asset.objectVersion,version);
      const search=await editorCall('/api/library/assets?'+new URLSearchParams({projectId,q:label}));assert.equal(search.status,200);assert.ok(search.value.items.some(item=>item.id===reference.assetId));
      const revision=await library.read('/api/assets/'+reference.assetId+'/revisions/'+reference.revisionId);assert.equal(revision.id,reference.revisionId);assert.equal(revision.sha256,hash(png));
    }
  });
  await t.test('同一全局资产追加版本、分页查看历史并下载两个固定版本',async()=>{
    const c=createCanvas(32,48),ctx=c.getContext('2d');ctx.fillStyle='#ac3874';ctx.fillRect(0,0,32,48);const revisedPng=c.toBuffer('image/png');
    const detail=await library.read('/api/assets/'+bubble.assetId),input={projectId:null,scopeId:'global',assetKind:'image',assetType:'bubble',assetId:bubble.assetId,objectVersion:detail.objectVersion,name:'无后缀气泡第二版.png',mime:'image/png',bytes:revisedPng,operationId:'synthetic-bubble-revision'};
    const second=await library.uploadAsset(input),retry=await library.uploadAsset(input);
    assert.equal(second.assetId,bubble.assetId);assert.notEqual(second.revisionId,bubble.revisionId);assert.equal(retry.revisionId,second.revisionId);
    const firstPage=await library.read('/api/assets/'+bubble.assetId+'/revisions?limit=1');assert.equal(firstPage.items.length,1);assert.equal(firstPage.items[0].id,second.revisionId);assert.ok(firstPage.nextCursor);
    const nextPage=await library.read('/api/assets/'+bubble.assetId+'/revisions?limit=1&cursor='+encodeURIComponent(firstPage.nextCursor));assert.equal(nextPage.items[0].id,bubble.revisionId);
    for(const [revisionId,expected]of [[bubble.revisionId,png],[second.revisionId,revisedPng]]){
      const original=await library.remote('/api/revisions/'+revisionId+'/download');assert.equal(hash(Buffer.from(await original.arrayBuffer())),hash(expected));
    }
    await assert.rejects(library.read('/api/assets/'+character.assetId+'/revisions/'+second.revisionId),error=>[400,404].includes(error.status));
  });
  function content(){const p={id:'project_'+randomUUID(),title:'合成工程',revision:1,pages:[{id:'page_'+randomUUID(),name:'第1话',storyboard:{episode:1},panels:[{id:'panel_'+randomUUID(),name:'合成格'}]}]};return {format:'comic-strip-project-snapshot',version:1,projectId:p.id,title:p.title,project:p,assets:[],stableHash:hash(JSON.stringify(p))};}
  async function save(snapshot){const r=await library.remote('/api/documents',{method:'POST',body:JSON.stringify({projectId:project.id,name:'合成工程',type:'engineering.snapshot',content:snapshot,references:[]})});return r.json();}
  await t.test('按项目和话保存工程，读取固定快照',async()=>{
    const original=content(),saved=await save(original),read=await library.read('/api/documents/'+saved.id);
    const restored=await decodeProjectSnapshot(read.content,{remote:library.remote});assert.equal(restored.project.id,original.project.id);assert.equal(restored.project.pages[0].storyboard.episode,1);assert.ok(saved.snapshots[0].snapshotId);
  });
  await t.test('大型工程无需角色或场景也可保存，遵守墨库的可选关联规则',async()=>{
    const large=content();large.project.large=randomBytes(700000).toString('base64');large.stableHash=hash(JSON.stringify(large.project));
    const saved=await save(large);assert.ok(saved.snapshots[0].snapshotId);
    const read=await library.read('/api/documents/'+saved.id),restored=await decodeProjectSnapshot(read.content,{remote:library.remote});
    assert.equal(hash(restored.project.large),hash(large.project.large));
    const retry=await save(large);assert.equal(retry.snapshots[0].snapshotId,saved.snapshots[0].snapshotId);
  });
  await t.test('已登记正式工程后，旧工作台保存被安全拒绝且正式版本不变',async()=>{
    const original=content(),panel=original.project.pages[0].panels[0];Object.assign(panel,{x:0,y:0,w:100,h:100});original.project.pages[0].bubbles=[];original.project.shots=[];original.project.layerOrder=[panel.id];original.stableHash=hash(JSON.stringify(original.project));
    const saved=await save(original),formalRoot='/api/project-library/'+project.id+'/episodes/'+episode.id;
    const inventory=await call('GET',formalRoot+'/engineering-inventory'),source=inventory.items.find(item=>item.id===saved.engineeringId)?.snapshots.find(item=>item.id===saved.snapshots[0].snapshotId);assert.ok(source?.contentSha256);
    const formal=await call('POST',formalRoot+'/formal-engineering',{submitId:randomUUID(),engineeringId:saved.engineeringId,sourceSnapshotId:source.id,sourceDigest:source.contentSha256,content:{scope:{projectId:project.id,episodeId:episode.id,episodeNumber:'1'},project:original.project,resources:[]},references:[],tagDecision:'none'});
    assert.equal(formal.versionNumber,1);
    const next=structuredClone(original);next.project.pages[0].panels[0].x=20;next.stableHash=hash(JSON.stringify(next.project));
    const headBefore=(await call('GET',formalRoot+'/formal-engineering')).formal;
    await assert.rejects(
      library.remote('/api/documents/'+saved.id,{method:'PUT',body:JSON.stringify({projectId:project.id,name:'合成工程',type:'engineering.snapshot',objectVersion:saved.objectVersion,content:next,references:[]})}),
      error=>error.status===409&&error.code==='FORMAL_COMMIT_REQUIRED'
    );
    const headAfter=(await call('GET',formalRoot+'/formal-engineering')).formal;
    assert.equal(headAfter.headVersionId,headBefore.headVersionId);
    assert.equal(headAfter.headVersionId,formal.versionId);
    // Exercise the workbench's actual automatic-sync state machine as well as
    // the adapter: a formal rejection must not become a retrying old snapshot.
    const syncDir=path.join(dir,'formal-sync');fs.mkdirSync(syncDir,{recursive:true});store.db.projects.push(next.project);store.project=id=>{const result=store.db.projects.find(p=>p.id===id);assert.ok(result);return result;};
    const ownerAccountId=(await editorCall('/api/library/status')).value.user.id;fs.writeFileSync(path.join(syncDir,'project-sync.local.json'),JSON.stringify({version:1,auto:true,projects:{[next.project.id]:{documentId:saved.id,objectVersion:saved.objectVersion,remoteProjectId:project.id,remoteProjectName:project.name,hash:original.stableHash,ownerAccountId}}}));
    const sync=createProjectSync({dataDir:syncDir,store,library,projectView:p=>structuredClone(p),json,body,enabled:true,debounceMs:20});t.after(()=>sync.close());
    await assert.rejects(sync.push(next.project.id),error=>error.code==='FORMAL_COMMIT_REQUIRED');
    assert.equal(sync.status(next.project.id).blockedReason,'FORMAL_COMMIT_REQUIRED');assert.equal(sync.status(next.project.id).pending,false);
    sync.mark(next.project);await sync.drain();assert.equal(sync.status(next.project.id).pending,false);
    assert.equal((await call('GET',formalRoot+'/formal-engineering')).formal.headVersionId,formal.versionId);
  });
  await t.test('正式工程以明确基准提交、冲突比较合并并取回固定原件',async()=>{
    const ep=await call('POST','/api/projects/'+project.id+'/episodes',{number:'2'});
    const imported=(await editorCall('/api/library/import','POST',{assetId:character.assetId,revisionId:character.revisionId})).value.asset;
    const fontKey='moku_'+font.revisionId.replaceAll('-','');
    const p=createProject('正式版本合成工程');p.pages[0].storyboard={episode:2};p.shots[0].episode=2;p.pages[0].panels[0].imageAssetId=imported.id;p.pages[0].panels.push({...structuredClone(p.pages[0].panels[0]),id:'panel_'+randomUUID()});p.assetLibrary={version:1,assetIds:[imported.id],directories:[],recursive:true};p.extraProductionSetting={review:'保留完整单话配置',fontFamily:fontKey,styleLibrary:{assetId:bubble.assetId,revisionId:bubble.revisionId}};
    function client(folder,projectData,assets,fonts=[],remoteLibrary=library){const root=path.join(dir,folder);fs.mkdirSync(root,{recursive:true});const s={db:{projects:[projectData],assets,libraryFonts:fonts},project:id=>s.db.projects.find(v=>v.id===id),save(){}};const drafts=createEpisodeVersionStore({dataDir:root,store:s});const formal=createFormalEngineeringVersions({dataDir:root,store:s,library:remoteLibrary,episodeVersions:drafts,getRemoteProjectId:()=>project.id,materializeImage:async(file,r)=>{const a={id:'asset_'+randomUUID(),name:r.revisionId,filePath:file,mime:r.mime};s.db.assets.push(a);return a;},materializeFont:async(file,r)=>{s.db.libraryFonts.push({key:r.localId,filePath:file,provenance:{assetId:r.assetId,revisionId:r.revisionId,sha256:r.sha256}});}});return {s,drafts,formal,root};}
    const a=client('formal-a',p,[imported],structuredClone(store.db.libraryFonts));
    await assert.rejects(a.formal.publish(p,2,{expectedRevision:0,tagDecision:'none'}),/盘点候选/);
    const first=await a.formal.publish(p,2,{expectedRevision:0,register:true,useLocalAsNewBaseline:true,tagDecision:'none'});assert.equal(first.saved,true);assert.equal(first.receipt.versionNumber,1);
    const empty=structuredClone(p);delete empty.formalVersionBindings;for(const panel of empty.pages[0].panels)panel.imageAssetId=null;empty.assetLibrary.assetIds=[];empty.extraProductionSetting={review:'本地未覆盖前的草稿'};
    const b=client('formal-b',empty,[]),before=await b.formal.status(empty,2);assert.equal(before.needsCheckout,true);
    await assert.rejects(b.formal.publish(empty,2,{expectedRevision:empty.revision,tagDecision:'none'}),error=>error.code==='BASE_VERSION_UNKNOWN');
    const loaded=await b.formal.checkout(empty,2,{versionId:first.receipt.versionId,expectedRevision:empty.revision});assert.equal(loaded.project.extraProductionSetting.review,'保留完整单话配置');const restoredImage=b.s.db.assets.find(item=>item.library?.assetId===character.assetId);assert.equal(hash(fs.readFileSync(restoredImage.filePath)),hash(png));assert.equal(restoredImage.library.revisionId,character.revisionId);assert.ok(b.s.db.assets.find(item=>item.library?.revisionId===bubble.revisionId));const restoredFont=b.s.db.libraryFonts.find(item=>item.key===fontKey);assert.equal(hash(fs.readFileSync(restoredFont.filePath)),font.sha256);
    assert.equal(fs.readdirSync(path.join(b.root,'formal-restore-backups')).length,1);
    p.pages[0].panels[0].x=11;p.revision++;const second=await a.formal.publish(p,2,{expectedRevision:p.revision,tagDecision:'none'});assert.equal(second.receipt.versionNumber,2);
    empty.pages[0].panels[1].y=13;empty.revision++;
    await assert.rejects(b.formal.publish(empty,2,{expectedRevision:empty.revision,tagDecision:'none'}),error=>error.status===409);
    const comparison=await b.formal.compare(empty,2,{expectedRevision:empty.revision});assert.equal(comparison.unresolved,0);assert.equal(comparison.canCommit,true);
    const merged=await b.formal.commitMerge(empty,2,{expectedRevision:empty.revision,planId:comparison.id,tagDecision:'none'});assert.equal(merged.saved,true);assert.equal(merged.localApplied,true,merged.message);assert.equal(merged.receipt.versionNumber,3);assert.equal(empty.pages[0].panels[0].x,11);assert.equal(empty.pages[0].panels[1].y,13);
    const head=await call('GET','/api/project-library/'+project.id+'/episodes/'+ep.id+'/formal-engineering');assert.equal(head.formal.headVersionId,merged.receipt.versionId);
    const versions=await b.formal.history(empty,2);assert.equal(versions.items.length,3);
    const conflicting=structuredClone(empty);delete conflicting.formalVersionBindings;conflicting.assetLibrary.assetIds=[];for(const panel of conflicting.pages[0].panels)panel.imageAssetId=null;const c=client('formal-c',conflicting,[]);await c.formal.checkout(conflicting,2,{versionId:merged.receipt.versionId,expectedRevision:conflicting.revision});
    empty.pages[0].panels[0].x=25;empty.revision++;const fourth=await b.formal.publish(empty,2,{expectedRevision:empty.revision,tagDecision:'none'});assert.equal(fourth.receipt.versionNumber,4);
    conflicting.pages[0].panels[0].x=35;conflicting.revision++;const clash=await c.formal.compare(conflicting,2,{expectedRevision:conflicting.revision});assert.ok(clash.unresolved>0);assert.equal(clash.canCommit,false);
    await assert.rejects(c.formal.commitMerge(conflicting,2,{expectedRevision:conflicting.revision,planId:clash.id,tagDecision:'none'}),/解决全部冲突/);
    const chosen=await c.formal.compare(conflicting,2,{expectedRevision:conflicting.revision,expectedRemoteVersionId:clash.remoteVersionId,resolutions:Object.fromEntries(clash.conflicts.map(item=>[item.path,'local']))});assert.equal(chosen.canCommit,true);
    const fifth=await c.formal.commitMerge(conflicting,2,{expectedRevision:conflicting.revision,planId:chosen.id,tagDecision:'none'});assert.equal(fifth.receipt.versionNumber,5);assert.equal(conflicting.pages[0].panels[0].x,35);
    let loseResponse=true;const unreliable={...library,remote:async(route,options)=>{const response=await library.remote(route,options);if(loseResponse&&route.endsWith('/content-commits')){loseResponse=false;throw Error('合成网络中断：回执丢失');}return response;}};
    const retryProject=structuredClone(conflicting);delete retryProject.formalVersionBindings;retryProject.assetLibrary.assetIds=[];for(const panel of retryProject.pages[0].panels)panel.imageAssetId=null;const d=client('formal-d',retryProject,[],[],unreliable);await d.formal.checkout(retryProject,2,{versionId:fifth.receipt.versionId,expectedRevision:retryProject.revision});retryProject.pages[0].panels[1].y=27;retryProject.revision++;
    const unknown=await d.formal.publish(retryProject,2,{expectedRevision:retryProject.revision,tagDecision:'none'});assert.equal(unknown.resultUnknown,true);const recovered=await d.formal.query(retryProject,2);assert.equal(recovered.found,true);assert.equal(recovered.receipt.submitId,unknown.submitId);assert.equal(recovered.receipt.versionNumber,6);assert.equal((await d.formal.history(retryProject,2)).items.length,6);
    formalEvidence={engineeringId:recovered.receipt.engineeringId,versionId:recovered.receipt.versionId};
  });
  await t.test('项目和全局资产批量回收与恢复：版本冲突整批拒绝，固定工程原件保留',async()=>{
    const userId=(await editorCall('/api/library/status')).value.user.id,propSubject=await call('POST','/api/project-library/'+project.id+'/subjects',{name:'合成场景',kind:'scene'});
    const prop=await library.uploadAsset({projectId:project.id,scopeId:'project',assetKind:'image',assetType:'scene',objectId:propSubject.id,name:'合成场景.png',mime:'image/png',bytes:png});
    const selection=async(ids,projectId,trash=false)=>{const r=await editorCall('/api/library/assets?'+new URLSearchParams({projectId,...(trash?{trash:'true'}:{})}));assert.equal(r.status,200);return ids.map(id=>{const i=r.value.items.find(x=>x.id===id);assert.ok(i,'缺少资产 '+id);return {id:i.id,objectVersion:i.objectVersion,scopeId:i.scopeId,assetKind:i.assetKind,assetType:i.assetType};});};
    const preview=async(projectId,action,items,expectedUserId=userId)=>editorCall('/api/library/recycle/preview','POST',{projectId,action,items,expectedUserId});
    let items=await selection([character.assetId,prop.assetId],project.id);
    assert.equal((await preview(project.id,'recycle',items,randomUUID())).status,409);
    const plan=await preview(project.id,'recycle',items);assert.equal(plan.status,200);assert.equal(plan.value.total,2);
    assert.equal((await editorCall('/api/library/assets/'+prop.assetId+'/tags','POST',{tags:['并发改动']})).status,200);
    assert.equal((await editorCall('/api/library/recycle/commit','POST',{planId:plan.value.id,expectedUserId:userId})).status,409);
    assert.equal((await selection([character.assetId,prop.assetId],project.id)).length,2);
    items=await selection([character.assetId,prop.assetId],project.id);const current=await preview(project.id,'recycle',items),committed=await editorCall('/api/library/recycle/commit','POST',{planId:current.value.id,expectedUserId:userId});assert.equal(committed.status,200);assert.equal(committed.value.changedCount,2);
    assert.deepEqual((await editorCall('/api/library/recycle/commit','POST',{planId:current.value.id,expectedUserId:userId})).value,committed.value);
    const fixed=await library.remote('/api/project-library/'+project.id+'/engineerings/'+formalEvidence.engineeringId+'/content-versions/'+formalEvidence.versionId+'/references/'+character.revisionId+'/download');assert.equal(hash(Buffer.from(await fixed.arrayBuffer())),hash(png));
    items=await selection([character.assetId,prop.assetId],project.id,true);const restore=await preview(project.id,'restore',items);assert.equal((await editorCall('/api/library/recycle/commit','POST',{planId:restore.value.id,expectedUserId:userId})).value.changedCount,2);
    const extraCanvas=createCanvas(32,48);extraCanvas.getContext('2d').fillStyle='#9366ad';extraCanvas.getContext('2d').fillRect(0,0,32,48);const extra=await library.uploadAsset({projectId:null,assetKind:'image',assetType:'bubble',name:'批量测试气泡.png',mime:'image/png',bytes:extraCanvas.toBuffer('image/png')});items=await selection([bubble.assetId,extra.assetId],'public');const globalPlan=await preview('public','recycle',items);assert.equal(globalPlan.status,200,JSON.stringify({globalPlan,items}));assert.equal((await editorCall('/api/library/recycle/commit','POST',{planId:globalPlan.value.id,expectedUserId:userId})).value.changedCount,2);
    items=await selection([bubble.assetId,extra.assetId],'public',true);const globalRestore=await preview('public','restore',items);assert.equal((await editorCall('/api/library/recycle/commit','POST',{planId:globalRestore.value.id,expectedUserId:userId})).value.changedCount,2);
  });
  await t.test('批量回收回执丢失后按账号和项目恢复，沿用原计划且不重复写入',async()=>{
    const userId=(await editorCall('/api/library/status')).value.user.id,subject=await call('POST','/api/project-library/'+project.id+'/subjects',{name:'回执测试场景',kind:'scene'});
    const asset=await library.uploadAsset({projectId:project.id,scopeId:'project',assetKind:'image',assetType:'scene',objectId:subject.id,name:'回执测试.png',mime:'image/png',bytes:png});
    const listed=await editorCall('/api/library/assets?'+new URLSearchParams({projectId:project.id})),item=listed.value.items.find(x=>x.id===asset.assetId);assert.ok(item);
    const preview=await editorCall('/api/library/recycle/preview','POST',{projectId:project.id,action:'recycle',expectedUserId:userId,items:[{id:item.id,objectVersion:item.objectVersion,scopeId:item.scopeId,assetKind:item.assetKind,assetType:item.assetType}]});assert.equal(preview.status,200);
    const realFetch=globalThis.fetch;let loseResponse=true;
    try{globalThis.fetch=async(...args)=>{const response=await realFetch(...args);if(loseResponse&&String(args[0]).includes('/batch/')&&String(args[0]).endsWith('/commit')){loseResponse=false;throw Error('模拟提交成功后回执丢失');}return response;};
      const unknown=await editorCall('/api/library/recycle/commit','POST',{planId:preview.value.id,expectedUserId:userId});assert.equal(unknown.status,500);assert.equal(loseResponse,false);
    }finally{globalThis.fetch=realFetch;}
    const pending=await editorCall('/api/library/recycle/pending?'+new URLSearchParams({projectId:project.id}));assert.equal(pending.status,200);assert.equal(pending.value.items.length,1);assert.equal(pending.value.items[0].id,preview.value.id);
    assert.equal((await editorCall('/api/library/recycle/pending?'+new URLSearchParams({projectId:other.id}))).value.items.length,0);
    const fresh=createMokuRecycle({dataDir:dir,baseUrl:library.baseUrl,request:library.remote,read:library.read});assert.equal((await fresh.pending(project.id)).items[0].id,preview.value.id);
    const another=createMokuRecycle({dataDir:dir,baseUrl:library.baseUrl,request:library.remote,read:async()=>({user:{id:randomUUID()}})});assert.equal((await another.pending(project.id)).items.length,0);
    const retry=await editorCall('/api/library/recycle/commit','POST',{planId:preview.value.id,expectedUserId:userId});assert.equal(retry.status,200,JSON.stringify(retry));assert.equal(retry.value.changedCount,1);
    assert.equal((await editorCall('/api/library/recycle/pending?'+new URLSearchParams({projectId:project.id}))).value.items.length,0);
    assert.deepEqual((await editorCall('/api/library/recycle/commit','POST',{planId:preview.value.id,expectedUserId:userId})).value,retry.value);
  });
  await t.test('多话工程分别登记版本，载入一话不覆盖另一话与共享资料',async()=>{
    const ep3=await call('POST','/api/projects/'+project.id+'/episodes',{number:'3'}),ep4=await call('POST','/api/projects/'+project.id+'/episodes',{number:'4'}),p=createProject('多话合成工程');p.pages[0].storyboard={episode:3};p.shots[0].episode=3;
    const page2=structuredClone(p.pages[0]),shot2=structuredClone(p.shots[0]);page2.id='page_'+randomUUID();page2.storyboard.episode=4;page2.panels[0].id='panel_'+randomUUID();shot2.id='shot_'+randomUUID();shot2.episode=4;page2.panels[0].shotId=shot2.id;p.pages.push(page2);p.shots.push(shot2);p.productionScreenBoards=1;p.assetWorkspaceSettings={common:{example:'共同设定'}};p.storyboardImport={version:2,episodes:[{episode:3,shotIds:[p.shots[0].id]},{episode:4,shotIds:[shot2.id]}]};
    const root=path.join(dir,'formal-multi');fs.mkdirSync(root,{recursive:true});const s={db:{projects:[p],assets:[],libraryFonts:[]},project:()=>p,save(){}},drafts=createEpisodeVersionStore({dataDir:root,store:s}),formal=createFormalEngineeringVersions({dataDir:root,store:s,library,episodeVersions:drafts,getRemoteProjectId:()=>project.id});
    const first=await formal.publish(p,3,{expectedRevision:p.revision,register:true,useLocalAsNewBaseline:true,tagDecision:'none'}),other=await formal.publish(p,4,{expectedRevision:p.revision,register:true,useLocalAsNewBaseline:true,tagDecision:'none'});assert.equal(first.receipt.versionNumber,1);assert.equal(other.receipt.versionNumber,1);
    p.pages[0].panels[0].x=9;p.pages[1].panels[0].x=41;p.revision++;const second=await formal.publish(p,3,{expectedRevision:p.revision,tagDecision:'none'});assert.equal(second.receipt.versionNumber,2);assert.equal((await call('GET','/api/project-library/'+project.id+'/episodes/'+ep4.id+'/formal-engineering')).formal.headVersionId,other.receipt.versionId);
    await formal.checkout(p,3,{versionId:first.receipt.versionId,expectedRevision:p.revision});assert.equal(p.pages[0].panels[0].x,0);assert.equal(p.pages[1].panels[0].x,41);assert.deepEqual(p.storyboardImport.episodes.map(e=>e.episode).sort(),[3,4]);assert.equal(p.pages[0].storyboard.episode,3);assert.equal(p.pages[1].storyboard.episode,4);
    p.assetWorkspaceSettings.common.example='更新的共享设定';p.revision++;const before=structuredClone(p);await assert.rejects(formal.checkout(p,3,{versionId:second.receipt.versionId,expectedRevision:p.revision}),error=>error.code==='SHARED_SETTINGS_CONFLICT');assert.deepEqual(p,before);assert.equal((await call('GET','/api/project-library/'+project.id+'/episodes/'+ep3.id+'/formal-engineering')).formal.headVersionId,second.receipt.versionId);
  });
  await t.test('正式版本基准写入本机工程文件，重启后仍可识别',async()=>{
    await call('POST','/api/projects/'+project.id+'/episodes',{number:'5'});const root=path.join(dir,'formal-store-persist'),s=new Store(root),p=createProject('正式基准持久化');p.pages[0].storyboard={episode:5};p.shots[0].episode=5;s.db.projects.push(p);s.save();
    const drafts=createEpisodeVersionStore({dataDir:root,store:s}),formal=createFormalEngineeringVersions({dataDir:root,store:s,library,episodeVersions:drafts,getRemoteProjectId:()=>project.id});const saved=await formal.publish(p,5,{expectedRevision:p.revision,register:true,useLocalAsNewBaseline:true,tagDecision:'none'});s.close();
    const restored=new Store(root);try{assert.equal(restored.project(p.id).formalVersionBindings[5].baseVersionId,saved.receipt.versionId);}finally{restored.close();}
  });
  await t.test('真实工作台 HTTP 路由连接隔离墨库，提交、读取和恢复正式版本',async()=>{
    await call('POST','/api/projects/'+project.id+'/episodes',{number:'6'});
    const studio=createStudio({dataDir:path.join(dir,'actual-editor'),bridge:{status:async()=>({connected:false}),close(){}},jimengBridge:{close(){}},seedReference:false,formalVersionLibrary:library});
    t.after(()=>{studio.close();studio.server.closeAllConnections();studio.server.close();});
    const origin=await listen(studio.server),p=createProject('实际路由合成工程'),imagePath=path.join(dir,'actual-editor-source.png'),localId='asset_'+randomUUID();fs.writeFileSync(imagePath,png);
    studio.store.db.assets.push({id:localId,name:'合成角色.png',filePath:imagePath,mime:'image/png',width:32,height:48,library:{assetId:character.assetId,revisionId:character.revisionId,sha256:hash(png)}});
    p.pages[0].storyboard={episode:6};p.pages[0].panels[0].imageAssetId=localId;p.shots[0].episode=6;p.assetLibrary={version:1,assetIds:[localId],directories:[],recursive:true,mokuProjectId:project.id};studio.store.db.projects.push(p);studio.store.save();
    const request=async(route,method='GET',value)=>{const response=await fetch(origin+route,{method,headers:value?{'Content-Type':'application/json'}:{},body:value?JSON.stringify(value):undefined});return {status:response.status,value:await response.json()};};
    const prefix='/api/formal-engineering-versions/',input={projectId:p.id,episode:6},status=await request(prefix+'status?'+new URLSearchParams(input));assert.equal(status.status,200,JSON.stringify(status));assert.equal(status.value.official.registered,false);
    const first=await request(prefix+'publish','POST',{...input,expectedRevision:p.revision,register:true,useLocalAsNewBaseline:true,tagDecision:'none'});assert.equal(first.status,200,JSON.stringify(first));assert.equal(first.value.receipt.versionNumber,1);
    const loaded=await request('/api/projects/'+p.id);assert.equal(loaded.status,200);const updated=loaded.value,originalX=updated.pages[0].panels[0].x;updated.pages[0].panels[0].x+=27;
    const saved=await request('/api/projects/'+p.id,'PUT',updated);assert.equal(saved.status,200,JSON.stringify(saved));
    const second=await request(prefix+'publish','POST',{...input,expectedRevision:saved.value.revision,tagDecision:'none'});assert.equal(second.status,200,JSON.stringify(second));assert.equal(second.value.receipt.versionNumber,2);
    const history=await request(prefix+'history?'+new URLSearchParams(input));assert.equal(history.status,200);assert.equal(history.value.items.length,2);
    fs.unlinkSync(imagePath);
    const old=await request(prefix+'checkout','POST',{...input,versionId:first.value.receipt.versionId,expectedRevision:saved.value.revision});assert.equal(old.status,200,JSON.stringify(old));assert.equal(old.value.project.pages[0].panels[0].x,originalX);
    const restoredId=old.value.project.pages[0].panels[0].imageAssetId;assert.notEqual(restoredId,localId);assert.equal(hash(fs.readFileSync(studio.store.assetPath(restoredId))),hash(png));assert.equal(studio.store.asset(restoredId).library.revisionId,character.revisionId);
    assert.equal(fs.readdirSync(path.join(dir,'actual-editor','formal-restore-backups')).length,1);
  });
  await t.test('工作台退出撤销真实墨库会话，并可重新登录读取固定版本',async()=>{
    const oldCookie=JSON.parse(fs.readFileSync(path.join(dir,'library-session.local.json'),'utf8')).cookie;
    const logout=await editorCall('/api/library/logout','POST',{});assert.equal(logout.status,200);assert.equal(logout.value.remoteRevoked,true);
    assert.equal((await f.app.inject({method:'GET',url:'/api/auth/me',headers:{origin:f.c.origin,cookie:oldCookie}})).statusCode,401);
    assert.equal((await editorCall('/api/library/status')).value.connected,false);
    await assert.rejects(library.read('/api/projects'),error=>error.status===401);
    assert.equal((await editorCall('/api/library/login','POST',{username:'test-maker',password:'错误的合成密码'})).status,401);
    assert.equal((await editorCall('/api/library/status')).value.connected,false);
    assert.equal((await editorCall('/api/library/login','POST',{username:'test-maker',password:'moku-test-only-2026'})).status,200);
    assert.equal((await editorCall('/api/library/status')).value.connected,true);
    const fixed=await library.read('/api/assets/'+bubble.assetId+'/revisions/'+bubble.revisionId);assert.equal(fixed.sha256,hash(png));
  });
});
