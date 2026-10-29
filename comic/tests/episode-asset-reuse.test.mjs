import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {syntheticFiles} from './fixtures/production-synthetic.mjs';
import {inspectProductionPackage} from '../lib/production-package.mjs';
import {productionProject} from '../lib/production-package-document.mjs';
import {ensureProjectPanelGeneration} from '../public/panel-generation.js';
import {assetWorkspaceInventory} from '../public/asset-workspace-model.js';
import {prepareWorkspaceBinding} from '../lib/asset-workspace-api.mjs';
import {exportEpisodeSelections,previewEpisodeSelections,importEpisodeSelections,validateReuseBundle} from '../lib/episode-asset-reuse.mjs';
async function fixture(){
 const p=productionProject(await inspectProductionPackage(syntheticFiles()));
 for(const segment of p.productionPackage.episodes[0].segments)segment.references=[{slot:0,'类型':'设定卡','人物':'测试人物_黑衣','服装':'','说明':'黑衣','必须':true,assetSourceId:'C001',sourceReference:{'显示名称':'测试人物'},binding:null},{slot:1,'类型':'场景','场景':'小酒馆','名称':'小酒馆','必须':true,binding:null}];
 for(const r of p.productionPackage.episodes[0].panelRecords){Object.assign(r.original,{'出现角色':['测试人物'],'当前场景':'小酒馆','当前状态':{'测试人物':{'参考资产':'C001'}}});delete r.original['服装'];}
 ensureProjectPanelGeneration(p,[]);return p;
}
const image=(role,projectId)=>({id:'asset_'+randomUUID(),name:role==='character'?'测试人物_黑衣.png':'小酒馆.png',libraryName:role==='character'?'测试人物':'小酒馆',libraryState:role==='character'?'黑衣':'',libraryRole:role,width:20,height:20,productionStatus:'confirmed',library:{assetId:randomUUID(),revisionId:randomUUID(),sha256:'a'.repeat(64),projectId,category:role}});
const inventory=(p,a)=>assetWorkspaceInventory(p,a,{scope:'episode',pageId:p.pages[0].id,includeSources:false});
function storeFor(p,assets){return {db:{assets,jobs:[]},project:id=>{assert.equal(id,p.id);return p;},asset:id=>assets.find(a=>a.id===id)};}
async function selected(){let p=await fixture();const assets=['character','scene'].map(role=>image(role,randomUUID()));for(const a of assets){const store=storeFor(p,assets),row=inventory(p,assets).find(r=>r.role===a.libraryRole);p=prepareWorkspaceBinding(store,p,{expectedRevision:p.revision,targets:row.uses,userSelected:true},a);}return {p,assets};}

test('导出当前已采用版本，跨工程导入精确匹配人物服装和场景；重复导入幂等',async()=>{
 const {p:source,assets}=await selected(),before=JSON.stringify(source),{bundle}=exportEpisodeSelections(source,assets,source.pages[0].id);assert.equal(bundle.items.length,2);assert.equal(JSON.stringify(source),before);assert.ok(!JSON.stringify(bundle).includes('filePath'));
 const target=await fixture();assert.ok(target.pages.length>1);target.pages[1].storyboard={...target.pages[1].storyboard,episode:12};const otherBefore=JSON.stringify(target.pages[1]),targetBefore=JSON.stringify(target),store=storeFor(target,[]),input={expectedRevision:target.revision,pageId:target.pages[0].id,bundle};const preview=previewEpisodeSelections(store,target,input);assert.ok(preview.items.every(i=>i.status==='reuse'));let imports=0;
 const result=await importEpisodeSelections(store,target,{...input,selected:[0,1]},{importAsset:async ref=>{imports++;const a={...structuredClone(assets.find(a=>a.library.assetId===ref.assetId)),id:'asset_'+randomUUID()};store.db.assets.push(a);return {asset:a};}});
 assert.equal(imports,2);assert.equal(JSON.stringify(target),targetBefore);assert.equal(JSON.stringify(result.project.pages[1]),otherBefore,'另一话不修改');assert.ok(inventory(result.project,store.db.assets).every(r=>r.status==='ready'));
 const restored=JSON.parse(JSON.stringify(result.project)),again=previewEpisodeSelections(storeFor(restored,store.db.assets),restored,{...input,pageId:restored.pages[0].id});assert.ok(again.items.every(i=>i.status==='same'));assert.equal(result.summary.assets,2);
});

test('相同名称不同服装不匹配；已有新图片需显式选中；锁定和生成中的位置保留',async()=>{
 const {p:source,assets}=await selected(),{bundle}=exportEpisodeSelections(source,assets,source.pages[0].id),other=structuredClone(bundle);other.items.find(i=>i.role==='character').state='白衣';
 const missing=await fixture();assert.equal(previewEpisodeSelections(storeFor(missing,assets),missing,{bundle:other,pageId:missing.pages[0].id}).items.find(i=>i.role==='character').status,'unused');
 const {p:target,assets:current}=await selected(),store=storeFor(target,[...current,...assets]),input={expectedRevision:target.revision,pageId:target.pages[0].id,bundle};const preview=previewEpisodeSelections(store,target,input);assert.ok(preview.items.every(i=>i.status==='conflict'));
 const index=bundle.items.findIndex(i=>i.role==='scene'),result=await importEpisodeSelections(store,target,{...input,selected:[index]},{});assert.deepEqual(inventory(result.project,store.db.assets).find(r=>r.role==='character').assetIds,inventory(target,current).find(r=>r.role==='character').assetIds);
 const locked=await fixture();locked.pages[0].locked=true;const blocked=previewEpisodeSelections(storeFor(locked,assets),locked,{bundle,pageId:locked.pages[0].id});assert.ok(blocked.items.every(i=>i.blocked>0));
 const busy=await fixture(),bs=storeFor(busy,assets);bs.db.jobs=busy.pages.flatMap(p=>p.panels.map(f=>({projectId:busy.id,panelId:f.id,status:'running'})));assert.ok(previewEpisodeSelections(bs,busy,{bundle,pageId:busy.pages[0].id}).items.every(i=>i.status==='blocked'));
});

test('错误版本摘要、重复文件项和导入期间并发编辑均不覆盖工程',async()=>{
 const {p:source,assets}=await selected(),{bundle}=exportEpisodeSelections(source,assets,source.pages[0].id),duplicate=structuredClone(bundle);duplicate.items.push(duplicate.items[0]);assert.throws(()=>validateReuseBundle(duplicate),/重复项/);
 const target=await fixture(),store=storeFor(target,[]),input={expectedRevision:target.revision,pageId:target.pages[0].id,bundle,selected:[0]},before=JSON.stringify(target);
 await assert.rejects(importEpisodeSelections(store,target,input,{importAsset:async()=>({asset:{...assets[0],library:{...assets[0].library,sha256:'b'.repeat(64)}}})}),/固定版本或归属/);assert.equal(JSON.stringify(target),before);
 await assert.rejects(importEpisodeSelections(store,target,input,{importAsset:async()=>{target.revision++;return {asset:assets[0]};}}),/导入期间工程已改变/);
});
import fs from 'node:fs';import path from 'node:path';import http from 'node:http';import {createRequire} from 'node:module';
import {createAssetWorkspaceAPI} from '../lib/asset-workspace-api.mjs';

test('真实资产工作区按钮完成文件导出、导入预览和采用',{timeout:45000},async t=>{
 const {p:source,assets}=await selected(),target=await fixture(),db={projects:[source,target],assets,jobs:[]},store={db,project:id=>db.projects.find(p=>p.id===id),asset:id=>assets.find(a=>a.id===id)},root=path.resolve(import.meta.dirname,'../public'),evidence=process.env.COMIC_REUSE_EVIDENCE_DIR;
 const handler=createAssetWorkspaceAPI({store,body:async req=>{let raw='';for await(const chunk of req)raw+=chunk;return JSON.parse(raw)},json:(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));},saveProject:p=>{p.revision++;return p;}});
 const html=`<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/asset-workspace.css"><div class="app-shell"><div id="references-tab"></div><div id="inspector-body"></div></div><script type="module">
 import {mountAssetWorkspace} from '/asset-workspace-ui.js';let project=${JSON.stringify(source)},assets=${JSON.stringify(assets)};
 const api=async(route,method='GET',body)=>{const r=await fetch(route,{method,headers:{'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const value=await r.json();if(!r.ok)throw Error(value.error);return value;};
 const ui=mountAssetWorkspace({api,getProject:()=>project,getPage:()=>project.pages[0],getSelected:()=>project.pages[0].panels[0],getAssets:()=>assets,flushSave:async()=>{},accept:async value=>{project=value;window.current=project},onAssets:values=>{for(const a of values)if(!assets.some(x=>x.id===a.id))assets.push(a)},toast:message=>window.notice=message,locate(){},showSidebar(){},showInspector(){},renderInspector(){}});
 window.switchTarget=()=>{ui.close();project=${JSON.stringify(target)};ui.open()};ui.open();window.ready=true;
 </script>`;
 const server=http.createServer(async(req,res)=>{try{const u=new URL(req.url,'http://fixture');if(u.pathname==='/')return res.end(html);if(await handler(req,res,{pathname:u.pathname,method:req.method}))return;if(u.pathname.startsWith('/api/')){if(u.pathname.endsWith('/download')||u.pathname.includes('/image')){res.setHeader('Content-Type','image/png');return res.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64'));}res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({items:[],changed:false}));}const file=path.resolve(root,'.'+u.pathname);if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.writeHead(404);return res.end();}res.setHeader('Content-Type',file.endsWith('.css')?'text/css':file.endsWith('.svg')?'image/svg+xml':'text/javascript');res.end(fs.readFileSync(file));}catch(e){res.writeHead(e.status||400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:e.message}));}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;t.after(async()=>{await browser?.close();server.closeAllConnections();await new Promise(r=>server.close(r));});
 const {chromium}=createRequire(import.meta.url)(process.env.COMIC_TEST_PLAYWRIGHT_MODULE);browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:1600,height:950}}),origin='http://127.0.0.1:'+server.address().port,errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
 await page.goto(origin);await page.waitForFunction(()=>window.ready);await page.waitForFunction(()=>!document.querySelector('[data-asset-reuse-export]').disabled);
 const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'导出复用文件',exact:true}).click();const download=await downloadPromise,downloaded=JSON.parse(await new Promise(async(resolve,reject)=>{try{const stream=await download.createReadStream(),chunks=[];for await(const chunk of stream)chunks.push(chunk);resolve(Buffer.concat(chunks).toString())}catch(e){reject(e)}}));assert.equal(downloaded.items.length,2);
 await page.evaluate(()=>window.switchTarget());await page.waitForFunction(()=>!document.querySelector('[data-asset-reuse-import]').disabled);
 const chooserPromise=page.waitForEvent('filechooser');await page.getByRole('button',{name:'导入复用文件',exact:true}).click();await(await chooserPromise).setFiles({name:'上话复用.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(downloaded))});
 await page.getByRole('dialog',{name:'导入人物场景复用文件'}).waitFor();assert.equal(await page.locator('[data-reuse-index]:checked').count(),2);
 if(evidence){fs.mkdirSync(evidence,{recursive:true});await page.screenshot({path:path.join(evidence,'reuse-preview.png')});}
 await page.getByRole('button',{name:'导入选中资产',exact:true}).click();await page.waitForFunction(()=>document.querySelector('[data-asset-search-status]')?.textContent.includes('已复用 2 项资产'));
 assert.ok(inventory(db.projects.find(p=>p.id===target.id),assets).every(r=>r.status==='ready'));assert.deepEqual(errors,[]);
 if(evidence)await page.screenshot({path:path.join(evidence,'reuse-applied.png')});
});
