import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {randomUUID,createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {createStudio} from '../server.mjs';
import {createProject} from '../public/model.js';
import {createProjectPortability} from '../lib/project-portability.mjs';
import {createProjectMediaFiles} from '../lib/project-media-files.mjs';
import {encodeProjectSnapshot} from '../lib/project-snapshot-codec.mjs';
import {preserveOriginalUploads,sourceOriginalPath} from '../lib/source-originals.mjs';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64');
const hash=b=>createHash('sha256').update(b).digest('hex');
test('大型制作资料归档为项目固定版本，跨机还原并校验原件',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'portable-package-')),project=createProject('合成大型资料'),projectId=randomUUID(),assetId=randomUUID(),revisionId=randomUUID();
 const source=Buffer.alloc(7*1024*1024,123),sources=[{relativePath:'source.bin',sha256:hash(source),dataBase64:source.toString('base64')}];let uploaded;
 const library={baseUrl:'http://isolated.invalid',assertSession(){},async uploadAsset(input){uploaded=input;return {assetId,revisionId,projectId,scopeId:'project',assetKind:'file',assetType:'project_archive'};},async read(route){return route==='/api/project-library/taxonomy'?{items:[{kind:'file',type:'project_archive'}]}:{assetId,id:revisionId,sha256:hash(uploaded.bytes)};},async remote(){return new Response(uploaded.bytes);}};
 const store={db:{assets:[],libraryFonts:[]},save(){}},packer=createProjectMediaFiles({store,library,dataDir:dir,receipts:{},persist(){},exportSources:()=>sources});
 const packed=await packer.pack(project,projectId);assert.equal(uploaded.assetType,'project_archive');assert.equal(uploaded.scopeId,'project');assert.ok(packed.packageSourcesArchive);assert.equal(packed.packageSources,undefined);
 const portable=createProjectPortability({store,library,dataDir:dir,productionPackages:{}}),input={...packed,format:'comic-strip-studio',version:3};
 const restored=await portable.prepareImport(input);assert.equal(restored.input.packageSources.length,1);assert.equal(hash(Buffer.from(restored.input.packageSources[0].dataBase64,'base64')),hash(source));
 const bad=structuredClone(input);bad.packageSourcesArchive.sha256='0'.repeat(64);await assert.rejects(portable.prepareImport(bad),/摘要/);
 const wrongProject=structuredClone(input);wrongProject.moku={projectId:randomUUID()};await assert.rejects(portable.prepareImport(wrongProject),/项目/);
 const oldLibrary={...library,async read(){return {items:[]};},async uploadAsset(){throw Error('旧墨库不应收到不支持的分类');}};
 const legacy=await createProjectMediaFiles({store,library:oldLibrary,dataDir:dir,receipts:{},persist(){},exportSources:()=>sources}).pack(project,projectId);
 assert.equal(legacy.packageSources.length,1);assert.equal(legacy.packageSourcesArchive,undefined);
});
async function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'portable-test-')),studio=createStudio({dataDir:dir,seedReference:false,bridge:{status:async()=>({connected:false}),close(){}},jimengBridge:{close(){}}});
 await new Promise(r=>studio.server.listen(0,'127.0.0.1',r));t.after(()=>studio.close());
 const api=async(route,method='GET',value)=>{const r=await fetch('http://127.0.0.1:'+studio.server.address().port+route,{method,headers:value?{'Content-Type':'application/json'}:{},body:value?JSON.stringify(value):undefined});return {status:r.status,body:await r.json()};};
 return {dir,studio,api};
}
test('跨机器离线工程携带原件，无 A 端路径仍能恢复取景、台词、参考与原文',async t=>{
 const a=await fixture(t),b=await fixture(t),file=path.join(a.dir,'source.png');fs.writeFileSync(file,png);
 const asset=(await a.api('/api/assets','POST',{name:'没有后缀的图片',filePath:file})).body,p=createProject('跨机器合成工程');p.pages[0].panels[0].imageAssetId=asset.id;p.pages[0].panels[0].imageTransform={x:37,y:12,scale:1,rotation:0};p.references=[{assetId:asset.id,name:'参考',role:'character'}];
 const duplicatePath=path.join(a.dir,'separate-outfit.png');fs.writeFileSync(duplicatePath,png);const independent=(await a.api('/api/assets','POST',{name:'同内容独立服装',filePath:duplicatePath})).body;p.references.push({assetId:independent.id,name:'同内容独立服装',role:'character'});
 const original=Buffer.from('合成原文，不得改写');p.sourceOriginalFiles=preserveOriginalUploads({dataDir:a.dir,projectId:p.id,files:[{role:'novel',name:'原文.txt',bytes:original}]});a.studio.store.db.projects.push(p);a.studio.store.save();
 const packed=await a.api('/api/projects/'+p.id+'/export');assert.equal(packed.status,200,JSON.stringify(packed.body));assert.equal(packed.body.version,3);assert.equal(packed.body.portability.localPathsRequired,false);assert.equal(packed.body.assets[0].filePath,undefined);assert.equal(hash(Buffer.from(packed.body.assets[0].dataBase64,'base64')),hash(png));
 fs.renameSync(file,path.join(a.dir,'source.unavailable'));const loaded=await b.api('/api/projects/import','POST',packed.body);assert.equal(loaded.status,201,JSON.stringify(loaded.body));const restored=loaded.body;
 assert.equal(restored.pages[0].panels[0].imageTransform.x,37);assert.deepEqual(restored.pages[0].bubbles.map(x=>x.text),p.pages[0].bubbles.map(x=>x.text));assert.equal(restored.references[0].assetId,restored.pages[0].panels[0].imageAssetId);
 assert.notEqual(restored.references[0].assetId,restored.references[1].assetId,'同内容的独立图片不能合并身份');const local=b.studio.store.assetPath(restored.references[0].assetId);assert.ok(local.startsWith(b.dir));assert.equal(hash(fs.readFileSync(local)),hash(png));assert.equal(hash(fs.readFileSync(sourceOriginalPath(b.dir,restored.id,p.sourceOriginalFiles[0].hash))),hash(original));
 const again=await b.api('/api/projects/'+restored.id+'/export');assert.equal(again.status,200);assert.equal((await a.api('/api/projects/import','POST',again.body)).status,201);
 const invalid=structuredClone(packed.body);invalid.assets[0].dataBase64=Buffer.from('bad').toString('base64');const count=b.studio.store.db.projects.length;assert.equal((await b.api('/api/projects/import','POST',invalid)).status,422);assert.equal(b.studio.store.db.projects.length,count);
 const legacy={...packed.body,version:2,assets:packed.body.assets.map((item,index)=>index===0?{...item,dataBase64:undefined,filePath:file}:item)};const missing=await b.api('/api/projects/import','POST',legacy);assert.equal(missing.status,409);assert.match(missing.body.error,/原电脑/);assert.equal(b.studio.store.db.projects.length,count);
});
test('墨库快照 v1/v2/v3 及下载封装均按固定版本恢复，拒绝错摘要及账号切换',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'portable-codec-')),assetId=randomUUID(),revisionId=randomUUID(),remoteProject=randomUUID(),id='asset_'+randomUUID(),p=createProject('墨库固定原件');p.pages[0].panels[0].imageAssetId=id;
 const libraryRef={assetId,revisionId,sha256:hash(png),projectId:remoteProject,scopeId:'project',assetKind:'image',assetType:'prop'},assets=[{id,name:'无后缀',width:1,height:1,sha256:hash(png),library:libraryRef}],snapshot={format:'comic-strip-project-snapshot',version:1,projectId:p.id,stableHash:'test',project:p,assets};
 let switched=false,corrupt=false,requests=[],fileBytes;
 const library={baseUrl:'http://isolated.invalid',assertSession(){if(switched)throw Object.assign(Error('账号已切换'),{code:'SESSION_ACCOUNT_CHANGED'});},rememberClassifiedAsset(){},async read(route){requests.push(route);return {id:revisionId,assetId,sha256:hash(png)};},async remote(route){requests.push(route);return new Response(route.includes('/'+revisionId+'/')?(corrupt?Buffer.from('bad'):png):fileBytes);}};
 const portable=createProjectPortability({store:{db:{assets:[]}},library,dataDir:dir,productionPackages:{}});
 const compressed=(await encodeProjectSnapshot({...snapshot,padding:'x'.repeat(600000)},null,{inlineOnly:true})).content;fileBytes=Buffer.from(JSON.stringify(compressed));
 const v3={format:snapshot.format,version:3,projectId:p.id,stableHash:'test',payload:{encoding:'json',storage:'asset',assetId:randomUUID(),revisionId:randomUUID(),size:fileBytes.length,sha256:hash(fileBytes)}};
 for(const value of [snapshot,compressed,v3,{schemaVersion:1,content:snapshot,references:[]}]){const prepared=await portable.prepareImport(value);assert.equal(hash(fs.readFileSync(prepared.input.assets[0].filePath)),hash(png));assert.equal(prepared.input.assets[0].library.revisionId,revisionId);}
 assert.ok(requests.every(x=>x.startsWith('/api/')));corrupt=true;await assert.rejects(portable.prepareImport(snapshot),/SHA-256/);corrupt=false;switched=true;await assert.rejects(portable.prepareImport(snapshot),e=>e.code==='SESSION_ACCOUNT_CHANGED');
 const duplicate=structuredClone(snapshot);duplicate.assets.push(duplicate.assets[0]);await assert.rejects(portable.prepareImport(duplicate),/重复/);
});
test('历史路径工程有墨库引用时忽略原机器路径；只有路径时明确报缺失',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'portable-legacy-')),p=createProject('旧路径工程'),id='asset_'+randomUUID(),aid=randomUUID(),rid=randomUUID();p.pages[0].panels[0].imageAssetId=id;
 const library={async read(){return {assetId:aid,sha256:hash(png)};},async remote(){return new Response(png);}};
 const portable=createProjectPortability({store:{db:{assets:[]}},library,dataDir:dir,productionPackages:{}}),input={format:'comic-strip-studio',version:2,project:p,assets:[{id,name:'旧图',filePath:'Z:/not-on-this-machine.png',library:{assetId:aid,revisionId:rid,sha256:hash(png)}}]};
 const result=await portable.prepareImport(input);assert.ok(result.input.assets[0].filePath.startsWith(dir));delete input.assets[0].library;await assert.rejects(portable.prepareImport(input),/原电脑/);
});
test('多份墨库固定原件逐项落盘，不受离线内嵌总量限制；内嵌内容仍有限制',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'portable-many-')),p=createProject('合成大工程'),local=['asset_'+randomUUID(),'asset_'+randomUUID()],remote=[randomUUID(),randomUUID()],revisions=[randomUUID(),randomUUID()];
 p.references=local.map((assetId,index)=>({assetId,name:'参考'+index,role:'character'}));
 const assets=local.map((id,index)=>({id,name:'参考'+index,width:1,height:1,sha256:hash(png),library:{assetId:remote[index],revisionId:revisions[index],sha256:hash(png)}}));
 const library={async read(route){const match=/\/assets\/([^/]+)\/revisions\/([^/]+)$/.exec(route);assert.ok(match);return {assetId:match[1],id:match[2],sha256:hash(png)};},async remote(){return new Response(png);}};
 const portable=createProjectPortability({store:{db:{assets:[]}},library,dataDir:dir,productionPackages:{},maxEmbeddedBytes:png.length});
 const project={format:'comic-strip-studio',version:3,project:p,assets};const result=await portable.prepareImport(project);assert.equal(result.input.assets.length,2);assert.ok(result.input.assets.every(a=>hash(fs.readFileSync(a.filePath))===hash(png)));
 const embedded={...project,assets:assets.map(({library,...a})=>({...a,dataBase64:png.toString('base64')}))};await assert.rejects(portable.prepareImport(embedded),/内嵌原件超过大小限制/);
});
test('导入等待期间切换工程，恢复结果加入列表但不切走当前画布',{timeout:60000},async t=>{
 const f=await fixture(t),first=createProject('导入前工程',true),second=createProject('用户切换的工程',true);
 f.studio.store.db.projects.push(first,second);f.studio.store.save();
 const packed=await f.api('/api/projects/'+first.id+'/export');assert.equal(packed.status,200);
 const {chromium}=createRequire(import.meta.url)(process.env.COMIC_TEST_PLAYWRIGHT_MODULE),browser=await chromium.launch({headless:true});t.after(()=>browser.close());
 const page=await browser.newPage(),base='http://127.0.0.1:'+f.studio.server.address().port;
 await page.goto(base+'/?project='+first.id);await page.waitForFunction(id=>document.querySelector('#project-select')?.value===id,first.id);
 let entered,release;const intercepted=new Promise(r=>entered=r),pending=new Promise(r=>release=r);
 await page.route('**/api/projects/import',async route=>{entered();await pending;await route.continue();});
 await page.locator('#project-input').setInputFiles({name:'墨库下载的工程.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(packed.body))});await intercepted;
 await page.locator('#project-trigger').click();await page.locator('[data-choose-project="'+second.id+'"]').click();await page.waitForFunction(id=>document.querySelector('#project-select')?.value===id,second.id);
 const response=page.waitForResponse(r=>r.url().endsWith('/api/projects/import')&&r.request().method()==='POST');release();assert.equal((await response).status(),201);
 await page.getByText('工程已恢复到本机列表；当前正在编辑的工程保留').waitFor();assert.equal(await page.locator('#project-select').inputValue(),second.id);assert.equal(f.studio.store.db.projects.length,3);
 await page.unroute('**/api/projects/import');let secondEntered,secondRelease;const secondIntercepted=new Promise(r=>secondEntered=r),secondPending=new Promise(r=>secondRelease=r);
 await page.route('**/api/projects/import',async route=>{secondEntered();await secondPending;await route.continue();});
 await page.locator('#project-input').setInputFiles({name:'再次导入.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(packed.body))});await secondIntercepted;
 await page.locator('#page-settings').evaluate(el=>el.click());const field=page.locator('#inspector-body input[data-section="page"][data-field="name"]');await field.fill('正在输入但还未提交的画布名');
 await page.locator('#toast').evaluate(el=>{el.textContent='';el.hidden=true;});const secondResponse=page.waitForResponse(r=>r.url().endsWith('/api/projects/import')&&r.request().method()==='POST');secondRelease();assert.equal((await secondResponse).status(),201);
 await page.getByText('工程已恢复到本机列表；当前正在编辑的工程保留').waitFor();assert.equal(await page.locator('#project-select').inputValue(),second.id);assert.equal(await field.inputValue(),'正在输入但还未提交的画布名');assert.equal(f.studio.store.db.projects.length,4);
});
