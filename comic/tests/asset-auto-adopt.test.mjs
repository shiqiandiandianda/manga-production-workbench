import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {automaticGalleryMatch,adoptedGalleryAsset} from '../public/asset-gallery-batch.js';
import {assetWorkspaceInventory} from '../public/asset-workspace-model.js';
import {ensureProjectPanelGeneration} from '../public/panel-generation.js';
import {syntheticFiles} from './fixtures/production-synthetic.mjs';
import {inspectProductionPackage} from '../lib/production-package.mjs';
import {productionProject} from '../lib/production-package-document.mjs';
import {prepareWorkspaceBinding,prepareWorkspaceText} from '../lib/asset-workspace-api.mjs';
import {reuseWorkspaceChoices} from '../lib/asset-workspace-choices.mjs';
const cloud=randomUUID(),row={name:'百户',role:'character',state:'未知（待确认）',assetIds:[]};
const remote=(name,state='',role='character',extra={})=>({id:randomUUID(),recommendedRevisionId:randomUUID(),projectId:cloud,name:[name,state].filter(Boolean).join('__'),subjectName:name,canonicalName:name,canonicalVariantName:state,assetType:role,mime:'image/png',...extra});
test('unspecified wardrobe accepts only the sole exact same-project fixed version after a complete search',()=>{
 const card=remote('百户','玄衣卫百户袍服'),other=remote('徐三山','玄衣卫百户官服');
 assert.equal(automaticGalleryMatch(row,[card,other],{projectIds:[cloud]}),card);
 for(const [items,options] of [[[card,{...card,id:randomUUID()}],{}],[[card],{complete:false}],[[card],{projectIds:[randomUUID()]}],[[{...card,deletedAt:'deleted'}],{}]]){
  assert.equal(automaticGalleryMatch(row,items,{projectIds:[cloud],...options}),null);
 }
 assert.equal(automaticGalleryMatch({...row,state:'白衣'},[card],{projectIds:[cloud]}),null);
 assert.equal(automaticGalleryMatch({...row,removedRevisionIds:[card.recommendedRevisionId]},[card],{projectIds:[cloud]}),null);
 assert.equal(automaticGalleryMatch(row,[remote('百户','少年回忆')],{projectIds:[cloud]}),null);
 assert.equal(automaticGalleryMatch(row,[remote('百户','Q版')],{projectIds:[cloud]}),null);
 assert.equal(automaticGalleryMatch(row,[remote('另一个百户','袍服')],{projectIds:[cloud]}),null);
});
test('only an already adopted immutable version can bypass a complete catalogue, duplicate caches do not create ambiguity',()=>{
 const card={id:'asset_'+randomUUID(),name:'百户__袍服',libraryName:'百户',libraryState:'袍服',libraryRole:'character',library:{assetId:randomUUID(),revisionId:randomUUID(),sha256:'a'.repeat(64),projectId:cloud}};
 assert.equal(adoptedGalleryAsset({...row,availableIds:[card.id]},[card]),null,'identity/reference cache is not adoption');
 assert.equal(adoptedGalleryAsset({...row,assetIds:[card.id]},[card]),card);
 const copy={...card,id:'asset_'+randomUUID()};
 assert.ok(adoptedGalleryAsset({...row,assetIds:[card.id,copy.id]},[card,copy]));
 assert.equal(adoptedGalleryAsset({...row,assetIds:[card.id,copy.id]},[card,{...copy,library:{...copy.library,revisionId:randomUUID()}}]),null);
 assert.equal(adoptedGalleryAsset({...row,assetIds:[card.id,copy.id]},[card,{...copy,libraryName:'他人',name:'他人__袍服'}]),null);
});
test('browser: entering assets adopts unique cards, fills every use, keeps ambiguity outside and survives reload without further adoption',{timeout:60000},async t=>{
 const files=syntheticFiles(),board=JSON.parse(files[0].bytes),screen=JSON.parse(files[1].bytes),names=['百户','待选人','文字项','锁定项','已选人','真缺图','多装人'];
 board['格'].push(structuredClone(board['格'][0]));const third=structuredClone(screen['屏段'][0]);third['段ID']='段03';third['图片']='段03.png';third['格']=[{'格ID':'E011-003','格号':3,'排':1,'排内':'整排'}];third['底图']=structuredClone(screen['屏段'][1]['底图']);screen['屏段'].push(third);
 for(const [i,p] of board['格'].entries()){p['出现角色']=names;p['服装']=Object.fromEntries(names.filter(n=>n!=='百户').map(n=>[n,n==='多装人'?(i===1?'黑衣':'白衣'):'白衣']));p['当前场景']='合成庭院';p['台词']=[];}
 for(const [i,s] of screen['屏段'].entries()){s['场景']='合成庭院';s['附图']=names.map(name=>({'类型':'设定卡','人物':name,'服装':name==='百户'?'未知（待确认）':name==='多装人'?(i===1?'黑衣':'白衣'):'白衣','必须':true}));}
 screen['文字']=[];files[0].bytes=Buffer.from(JSON.stringify(board));files[1].bytes=Buffer.from(JSON.stringify(screen));
 let project=productionProject(await inspectProductionPackage(files));const assets=[],calls=[],errors=[];ensureProjectPanelGeneration(project,assets);project.assetLibrary={version:1,mokuProjectId:cloud,assetIds:[],directories:[],recursive:true};
 const store={db:{assets,jobs:[]},asset:id=>assets.find(a=>a.id===id)},inventory=()=>assetWorkspaceInventory(project,assets,{scope:'work'}),find=name=>inventory().find(r=>r.name===name);
 const catalog=[remote('百户','袍服'),remote('徐三山','百户袍服'),remote('待选人','白衣'),remote('待选人','白衣'),remote('文字项','白衣'),remote('锁定项','白衣'),remote('已选人','白衣'),remote('已选人','白衣'),remote('多装人','白衣'),remote('多装人','黑衣'),remote('合成庭院','','scene')];
 const materialize=item=>{let a=assets.find(a=>a.library?.assetId===item.id);if(!a){a={id:'asset_'+randomUUID(),name:item.name,libraryName:item.subjectName,libraryState:item.canonicalVariantName,libraryRole:item.assetType,width:320,height:200,library:{assetId:item.id,revisionId:item.recommendedRevisionId,projectId:cloud,sha256:'a'.repeat(64)}};assets.push(a);}return a;};
 materialize(catalog[2]); // Right-hand identity discovery may have cached one of two valid cards.
 const chosen=materialize(catalog[6]);project=prepareWorkspaceBinding(store,project,{expectedRevision:project.revision,targets:[find('已选人').uses[1]],userSelected:true},chosen);
 project=prepareWorkspaceText(store,project,{expectedRevision:project.revision,targets:find('文字项').uses,mode:'text',description:'保留文字描述'});
 const lockedUse=find('锁定项').uses[0],lockedPanel=project.pages.flatMap(p=>p.panels).find(p=>p.id===lockedUse.panelId);lockedPanel.locked=true;
 const source=JSON.stringify(project.shots),png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aHHsAAAAASUVORK5CYII=','base64');
 const root=path.resolve(import.meta.dirname,'../public'),styles=fs.readFileSync(path.join(root,'index.html'),'utf8').match(/<link rel="stylesheet"[^>]+>/g).join('');
 const html=`<!doctype html><meta charset="utf-8">${styles}<style>.app-shell{position:relative;display:block;height:100vh}</style><body class="modern-workbench"><div class="app-shell"><section id="references-tab"></section><section id="inspector-body"></section></div><script type="module">import{mountAssetWorkspace}from'/asset-workspace-ui.js';const d=await(await fetch('/fixture')).json();window.d=d;const api=async(url,method='GET',body)=>{const r=await fetch(url,{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined}),v=await r.json();if(!r.ok)throw Error(v.error);return v;};window.ui=mountAssetWorkspace({api,getProject:()=>d.project,getPage:()=>d.project.pages[0],getSelected:()=>d.project.pages[0].panels.find(p=>p.productionSegment),getAssets:()=>d.assets,flushSave:async()=>{},accept:async p=>{d.project=p;window.ui.refresh(true)},onAssets:items=>{for(const a of items)if(!d.assets.some(v=>v.id===a.id))d.assets.push(a)},toast:()=>{},renderInspector:()=>{}});window.ui.open();</script>`;
 const server=http.createServer(async(req,res)=>{const url=new URL(req.url,'http://synthetic'),json=(v,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(v));};try{
  if(url.pathname==='/')return res.end(html);if(url.pathname==='/fixture')return json({project,assets});
  if(url.pathname.endsWith('/results'))return json({items:[]});
  if(url.pathname==='/api/library/projects')return json({items:[{id:cloud,name:'合成制作资料'}]});
  if(url.pathname==='/api/library/assets')return json({items:catalog.filter(i=>!url.searchParams.get('assetType')||i.assetType===url.searchParams.get('assetType')),more:false});
  if(req.method==='POST'){let body='';for await(const c of req)body+=c;const input=JSON.parse(body);calls.push({path:url.pathname,input});
   if(url.pathname==='/api/library/import')return json({asset:materialize(catalog.find(i=>i.id===input.assetId))});
   if(url.pathname.endsWith('/reuse')){assert.equal(input.expectedRevision,project.revision);const result=reuseWorkspaceChoices(store,project);if(result.changed){project=result.project;project.revision++;}return json({...result,project});}
   if(url.pathname.endsWith('/bind')){project=prepareWorkspaceBinding(store,project,input,store.asset(input.assetId));project.revision++;return json({project});}
   throw Error('Unexpected write: '+url.pathname);
  }
  if(url.pathname.startsWith('/api/assets/')||url.pathname.startsWith('/api/library/revisions/')){res.writeHead(200,{'Content-Type':'image/png'});return res.end(png);}
  const full=path.resolve(root,'.'+url.pathname);if(!full.startsWith(root+path.sep)||!fs.existsSync(full))return json({error:'missing'},404);res.writeHead(200,{'Content-Type':full.endsWith('.css')?'text/css':'text/javascript'});res.end(fs.readFileSync(full));
 }catch(e){errors.push(e.message);json({error:e.message},409);}});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close();});
 const require=createRequire(import.meta.url),{chromium}=require(process.env.COMIC_TEST_PLAYWRIGHT_MODULE||path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright')),browser=await chromium.launch({channel:'msedge',headless:true});t.after(()=>browser.close());
 const page=await browser.newPage({viewport:{width:1920,height:1080}});page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());
 await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>document.querySelector('[data-asset-search-status]')?.textContent.startsWith('匹配完成'));
 assert.doesNotMatch(await page.locator('[data-asset-search-status]').innerText(),/失败 [1-9]/);
 for(const name of ['百户','多装人','合成庭院','已选人'])for(const r of inventory().filter(r=>r.name===name&&r.uses.some(u=>!u.locked))){assert.equal(r.assetIds.length,1,name);assert.ok(r.uses.every(u=>u.locked||!u.missing),name);}
 assert.equal(find('待选人').assetIds.length,0,'a single cached identity must not conceal a second catalogue version');
 assert.equal(find('文字项').status,'text');assert.equal(find('已选人').assetIds[0],chosen.id);assert.equal(find('百户').state,'未知（待确认）');assert.equal(JSON.stringify(project.shots),source);
 assert.ok(calls.filter(c=>c.path.endsWith('/bind')).every(c=>c.input.targets.every(t=>t.panelId!==lockedUse.panelId)),'locked uses remain untouched');
 const ambiguous=page.locator('.asset-gallery-card').filter({has:page.locator('strong',{hasText:'待选人'})});assert.ok(await ambiguous.locator('[data-gallery-adopt]').count()>=2);assert.match(await ambiguous.innerText(),/待选图/);
 const proof=process.env.ASSET_AUTO_ADOPT_PROOF;if(proof){fs.mkdirSync(proof,{recursive:true});await page.screenshot({path:path.join(proof,'自动采用与候选卡片.png')});}
 const adopted=calls.filter(c=>c.path.endsWith('/bind')).length;await page.reload();await page.waitForFunction(()=>document.querySelector('[data-asset-search-status]')?.textContent.startsWith('匹配完成'));assert.equal(calls.filter(c=>c.path.endsWith('/bind')).length,adopted,'refresh never replaces adopted pictures');
 assert.equal(calls.some(c=>c.path==='/api/project-center/reference-generation'),false);assert.deepEqual(errors,[]);
});
