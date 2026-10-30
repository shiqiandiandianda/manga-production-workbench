import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {syntheticFiles} from './fixtures/production-synthetic.mjs';
import {inspectProductionPackage} from '../lib/production-package.mjs';
import {productionProject} from '../lib/production-package-document.mjs';
import {assetWorkspaceInventory,savedAssetRequirementSettings} from '../public/asset-workspace-model.js';
import {prepareProductionPanel} from '../public/production-panel-generation.js';
import {switchProductionEpisodeUnit} from '../public/production-episode-layout.js';
import {ensureProjectPanelGeneration} from '../public/panel-generation.js';
import {auditPanelReferences} from '../public/panel-reference-audit.js';
import {productionReferencePlan} from '../public/production-package-model.js';
import {prepareWorkspaceBinding,prepareWorkspaceText} from '../lib/asset-workspace-api.mjs';
import {createProductionPackageAPI} from '../lib/production-package-api.mjs';
import {prepareGenerationReferences} from '../lib/generation-reference-order.mjs';
import {createMokuReferenceSearch} from '../public/moku-reference-search.js';
import {quickCharacterSearchFeedback} from '../public/asset-quick-view.js';
import {galleryRecordAssignments,galleryReturnDecision} from '../public/asset-gallery-batch.js';
import {taskCardMarkup} from '../public/job-cards.js';

const proof=path.resolve(import.meta.dirname,'../../verification/asset-inventory-fix-20261027-r1');
const sceneName='华山脚下小酒馆';
async function fixture(){
 const project=productionProject(await inspectProductionPackage(syntheticFiles())),episode=project.productionPackage.episodes[0];
 for(const segment of episode.segments){segment.references=[
  {slot:0,'类型':'设定卡','人物':'测试人物_黑衣','服装':'','说明':'黑衣','必须':true,assetSourceId:'C001',sourceReference:{'显示名称':'测试人物'},binding:null},
  {slot:1,'类型':'场景','场景':sceneName,'名称':sceneName,'说明':'炉火、酒坛与桌凳','必须':true,binding:null},
  {slot:2,'类型':'道具','道具':'木剑','名称':'木剑','说明':'木质练习剑','必须':true,binding:null}
 ];}
 for(const record of episode.panelRecords){Object.assign(record.original,{'出现角色':['测试人物'],'当前场景':sceneName,'出现道具':['木剑'],'当前状态':{'测试人物':{'参考资产':'C001'}}});delete record.original['服装'];}
 ensureProjectPanelGeneration(project,[]);return project;
}
const inventory=(p,assets=[])=>assetWorkspaceInventory(p,assets,{scope:'work'});
const image=(name,role)=>({id:'asset_'+randomUUID(),name,libraryName:role==='character'?'测试人物':undefined,libraryState:role==='character'?'黑衣':undefined,libraryRole:role,width:600,height:400,productionStatus:'confirmed',library:{assetId:randomUUID(),revisionId:randomUUID(),sha256:'a'.repeat(64),projectId:randomUUID(),category:role}});
function preparePanels(p){for(const e of p.productionPackage.episodes)for(const s of e.segments)for(const id of s.panelIds)prepareProductionPanel(p,s.id,id);ensureProjectPanelGeneration(p,[]);}

test('screen/grid identities stay stable across repeated switches without losing source or clothing distinctions',async()=>{
 const p=await fixture(),keys=inventory(p).map(r=>r.key).sort(),source=JSON.stringify(p.productionPackage.episodes[0].panelRecords.map(r=>r.original));
 assert.equal(keys.length,3);preparePanels(p);
 for(let i=0;i<12;i++)for(const unit of ['panel','screen']){switchProductionEpisodeUnit(p,11,unit);assert.deepEqual(inventory(p).map(r=>r.key).sort(),keys);}
 assert.equal(JSON.stringify(p.productionPackage.episodes[0].panelRecords.map(r=>r.original)),source);
 const rows=inventory(p),character=rows.find(r=>r.role==='character');assert.equal(character.name,'测试人物');assert.equal(character.state,'黑衣');assert.equal(character.uses.length,4);
 const oldKey=character.requirementKeys.find(k=>k.includes('测试人物_黑衣')===false&&k.includes('测试人物黑衣'));
 p.assetWorkspaceSettings={[oldKey]:{assetBrief:'原有补充'}};assert.equal(savedAssetRequirementSettings(p,character).assetBrief,'原有补充');
 const record=p.productionPackage.episodes[0].panelRecords[0];record.original['服装']={'测试人物':'白衣'};ensureProjectPanelGeneration(p,[]);
 assert.equal(inventory(p).filter(r=>r.role==='character').length,2,'explicit white costume must not merge with black');
});

test('merged scene and character cards bind all original targets and survive serialization; old records still return',async()=>{
 const p=await fixture();preparePanels(p);const source=JSON.stringify(p),assets=[image('测试人物_黑衣.png','character'),image('原始文件名_场景_生成.png','scene')],store={db:{assets,jobs:[]},asset:id=>assets.find(a=>a.id===id)};
 let next=p;for(const role of ['character','scene']){const row=inventory(next,assets).find(r=>r.role===role);next=prepareWorkspaceBinding(store,next,{expectedRevision:next.revision,targets:row.uses,userSelected:true},assets.find(a=>a.libraryRole===role));}
 next=JSON.parse(JSON.stringify(next));for(const role of ['character','scene'])for(const use of inventory(next,assets).find(r=>r.role===role).uses){const panel=next.pages.flatMap(p=>p.panels).find(f=>f.id===use.panelId);assert.equal(auditPanelReferences(next,panel,assets).needs.find(n=>n.id===use.needId).status,'ready');}
 assert.equal(JSON.stringify(p),source);
 const row=inventory(p).find(r=>r.role==='scene'),text=prepareWorkspaceText(store,p,{expectedRevision:p.revision,targets:row.uses,mode:'text',description:'小酒馆，炉火位于左侧'});assert.equal(inventory(text).find(r=>r.role==='scene').status,'text');
 const c=inventory(p).find(r=>r.role==='character'),use=c.uses[0],result={id:'old-record',role:'character',name:'测试人物_黑衣',state:'黑衣',context:{projectId:p.id,panelId:use.panelId,needId:use.needId},status:'completed',available:true,partial:false,imageUrl:'/synthetic.png'};
 const assigned=galleryRecordAssignments([c],result,{projectId:p.id});assert.equal(galleryReturnDecision(c,[assigned[0].record],{projectId:p.id}).status,'ready');
});

test('scene search and local detail candidates reject Huashan character cards; explicit all-types remains available',async()=>{
 const cloud=randomUUID(),remote=(name,assetType)=>({id:randomUUID(),recommendedRevisionId:randomUUID(),name,assetType,projectId:cloud});
 const character=remote('令狐冲_华山弟子常服.png','character'),scene=remote(sceneName+'.png','scene'),catalog=[character,scene];
 const search=createMokuReferenceSearch({project:{},api:async route=>route==='/api/library/projects'?{items:[{id:cloud,name:'合成'}]}:{items:catalog,more:false}});
 assert.deepEqual((await search.search(sceneName,{scope:cloud,role:'scene'})).items.map(i=>i.id),[scene.id]);search.clear();
 const row={role:'scene',name:sceneName,assetIds:[],uses:[],sources:[]},local=image('岳灵珊_华山派弟子装.png','character');
 const normal=quickCharacterSearchFeedback({},row,[local],catalog,sceneName);assert.deepEqual(normal.candidates.map(i=>i.id),[scene.id]);
  assert.equal(quickCharacterSearchFeedback({},row,[local],catalog,sceneName,{includeOtherTypes:true}).candidates.length,1);
});

test('numbered scene/prop references use declared logical names while preserving actual immutable assets',async()=>{
 const p=await fixture(),assets=[image('测试人物_黑衣.png','character'),image('枣林外小径_生成_abcd.png','scene'),image('旧道具文件名.png','prop')],segment=p.productionPackage.episodes[0].segments[0],frame=p.pages[0].panels.find(f=>f.productionSegment===segment.id);
 for(let i=0;i<3;i++)segment.references[i].binding={assetId:assets[i].id,revisionId:assets[i].library.revisionId,sha256:assets[i].library.sha256};
 const before=JSON.stringify(p),refs=productionReferencePlan(p,frame,assets).refs,files=refs.map(r=>'synthetic:'+r.assetId),input={action:'generate',shot:{productionPrompt:'图1是测试人物，图2是'+sceneName+'，图3是木剑。'},referenceRoles:refs};
 const result=prepareGenerationReferences(input,files);assert.deepEqual(result.referenceFiles,files);assert.deepEqual(refs.map(r=>r.name),['测试人物_黑衣',sceneName,'木剑']);assert.equal(JSON.stringify(p),before);
 assert.throws(()=>prepareGenerationReferences({...input,referenceRoles:refs.filter(r=>r.role!=='scene')},files.filter((_,i)=>i!==1)),/没有对应/,'genuinely missing references must still fail');
});

test('browser: actual bulk-switch API, typed picks, persistence and task rail/footer/header layout',{timeout:60000},async t=>{
 fs.mkdirSync(proof,{recursive:true});const dir=fs.mkdtempSync(path.join(proof,'synthetic-')),p=await fixture(),cloud=randomUUID();p.assetLibrary={version:1,mokuProjectId:cloud,assetIds:[],directories:[],recursive:true};
 const assets=[],store={db:{projects:[p],assets,jobs:[]},project:id=>store.db.projects.find(p=>p.id===id),asset:id=>assets.find(a=>a.id===id)},current=()=>store.db.projects[0],writes=[],errors=[];
 const readBody=async req=>{let text='';for await(const chunk of req)text+=chunk;return JSON.parse(text||'{}');},json=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));},save=next=>{next.revision++;fs.writeFileSync(path.join(dir,'project.json'),JSON.stringify(next));return next;};
 const production=createProductionPackageAPI({store,dataDir:dir,body:readBody,json,saveProject:save,projectView:p=>p,library:{}});
 const remote=(name,type)=>({id:randomUUID(),recommendedRevisionId:randomUUID(),name,assetType:type,category:type,projectId:cloud,...(type==='scene'?{canonicalName:sceneName}: {})}),catalog=[remote('令狐冲_华山弟子常服.png','character'),remote(sceneName+'_正视.png','scene'),remote(sceneName+'_反视.png','scene')];
 const root=path.resolve(import.meta.dirname,'../public'),index=fs.readFileSync(path.join(root,'index.html'),'utf8'),styles=index.match(/<link rel="stylesheet"[^>]+>/g).join(''),tray=index.match(/<section class="job-tray[\s\S]*?<\/section>/)[0];
 const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const jobs=Array.from({length:9},(_,i)=>({id:'job_'+randomUUID(),projectId:p.id,panelId:p.pages[0].panels[0].id,shotCode:'E071-S00'+(i+1),provider:'codex',status:'failed',message:'图3“枣林空地”没有对应的已选参考图或文字资产，请先绑定',created:new Date().toISOString()}));
 const cards='<div class="task-card-filters">全部 9<span class="task-card-navigation"><button data-task-scroll="-1" aria-label="向左查看任务">←</button><button data-task-scroll="1" aria-label="向右查看任务">→</button></span></div><div class="task-card-rail" tabindex="0">'+jobs.map(j=>taskCardMarkup(j,{project:p,escape})).join('')+'</div>';
 const html=`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${styles}<style>.app-shell{grid-template-columns:60px 280px minmax(0,1fr)!important}.sidebar{grid-column:2!important}.fixture-center{grid-column:3}.topbar{padding:12px}.canvas-toolbar{padding:12px}</style><body class="modern-workbench unified-workbench"><header class="topbar">隔离回归验证</header><div class="canvas-toolbar">屏段 / 单格与资产</div><div class="app-shell"><aside class="sidebar"><section id="production-tab"></section><section id="references-tab"></section></aside><main class="fixture-center" id="inspector-body"><span id="inspector-kind"></span><span id="inspector-title"></span><button id="fixture-open-assets">本话资产</button></main></div>${tray}<script type="module">
 import {mountAssetWorkspace} from '/asset-workspace-ui.js';import {mountProductionWorkspace} from '/production-workspace.js';import {mountTaskRailNavigation,updateTaskRailNavigation} from '/task-rail-navigation.js';
 let data=await(await fetch('/fixture')).json(),selected=data.project.pages[0].panels.find(f=>f.productionSegment);const api=async(url,method='GET',body)=>{let r=await fetch(url,{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined}),v=await r.json();if(!r.ok)throw Error(v.error);return v;};
 const shared={api,getProject:()=>data.project,getSelected:()=>selected,getAssets:()=>data.assets,flushSave:async()=>{},accept:async p=>{data.project=p;selected=p.pages[0].panels.find(f=>f.productionSegment);window.production.refresh(true);window.assetUI.refresh(true);},toast:()=>{}};
 window.assetUI=mountAssetWorkspace({...shared,getPage:()=>data.project.pages[0],onAssets:items=>data.assets.push(...items),renderInspector:()=>{}});window.production=mountProductionWorkspace({...shared,getEpisode:()=>11,selectFrame:f=>selected=f});window.production.refresh(true);document.querySelector('#fixture-open-assets').onclick=()=>window.assetUI.open();
 document.querySelector('#episode-batch-status').hidden=false;document.querySelector('#episode-batch-status').innerHTML='<span>第71话 · 已提交 8/14 · 已结束 8 · 失败 8 · 已停止后续提交</span>';document.querySelector('#job-list').innerHTML=${JSON.stringify(cards)};document.querySelector('.job-tray').classList.remove('collapsed');mountTaskRailNavigation(document.querySelector('#job-list'));updateTaskRailNavigation(document.querySelector('#job-list'));window.fixtureReady=true;
 </script>`;
 const server=http.createServer(async(req,res)=>{try{const url=new URL(req.url,'http://local');if(url.pathname==='/')return res.end(html);if(url.pathname==='/fixture')return json(res,200,{project:current(),assets});
  if(await production.handle(req,res,{pathname:url.pathname,method:req.method,url}))return;
  if(url.pathname==='/api/library/projects')return json(res,200,{items:[{id:cloud,name:'合成制作资料'}]});if(url.pathname==='/api/library/assets')return json(res,200,{items:url.searchParams.get('projectId')===cloud?catalog:[],more:false});if(url.pathname.endsWith('/results'))return json(res,200,{items:[]});if(url.pathname.endsWith('/novel-evidence'))return json(res,200,{available:false,excerpts:[]});
   if(req.method==='POST'){const input=await readBody(req);writes.push(url.pathname);if(url.pathname.endsWith('/reuse'))return json(res,200,{changed:false,summary:{reused:0}});if(/^\/api\/library\/assets\/[a-f0-9-]+\/tags$/i.test(url.pathname))return json(res,200,{asset:{id:url.pathname.split('/')[4],tags:input.tags}});if(url.pathname==='/api/library/import'){const remote=catalog.find(a=>a.id===input.assetId),asset={...image(remote.name,'scene'),library:{assetId:remote.id,revisionId:remote.recommendedRevisionId,sha256:'a'.repeat(64),projectId:cloud,category:'scene'}};assets.push(asset);return json(res,201,{asset});}if(url.pathname.endsWith('/asset-workspace/bind')){const next=prepareWorkspaceBinding(store,current(),input,store.asset(input.assetId));store.db.projects[0]=next;return json(res,200,{project:save(next)});}throw Error('Unexpected write '+url.pathname);}
  if(url.pathname.includes('/preview/')||url.pathname.endsWith('/download')||url.pathname.startsWith('/api/assets/')){res.setHeader('Content-Type','image/svg+xml');return res.end('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="600" height="400" fill="#527575"/></svg>');}
   const font=/^\/repair\/fonts\/(SourceHanSansSC-[A-Za-z]+\.otf)$/.exec(url.pathname);if(font){res.setHeader('Content-Type','font/otf');return res.end(fs.readFileSync(path.resolve(root,'../repair-engine/public/fonts',font[1])));}
   const file=path.resolve(root,'.'+url.pathname);if(!file.startsWith(root+path.sep)||!fs.existsSync(file))return json(res,404,{});res.setHeader('Content-Type',file.endsWith('.css')?'text/css':/\.m?js$/i.test(file)?'text/javascript':'application/octet-stream');res.end(fs.readFileSync(file));
 }catch(error){json(res,error.status||500,{error:error.message});}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close();});const origin='http://127.0.0.1:'+server.address().port,require=createRequire(import.meta.url),{chromium}=require('playwright');
 const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true,env:{...process.env,TEMP:dir,TMP:dir}});t.after(()=>browser.close());const page=await browser.newPage({viewport:{width:1864,height:949}});await page.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());page.on('pageerror',e=>errors.push(e.message));page.on('console',e=>{if(e.type()==='error')errors.push(e.text());});page.on('requestfailed',r=>errors.push('request failed '+r.url()+' '+r.failure()?.errorText));await page.goto(origin);await page.waitForFunction(()=>window.fixtureReady===true,{},{timeout:5000}).catch(async error=>{await page.screenshot({path:path.join(proof,'fixture-error.png')});throw Error(error.message+' '+JSON.stringify(errors)+' '+(await page.locator('body').innerText()).slice(-1500));});
 for(let i=0;i<4;i++){await page.locator('[data-production-episode-unit]').click();await page.waitForFunction(()=>!document.querySelector('[data-production-episode-unit]')?.disabled);await page.evaluate(()=>window.assetUI.open());assert.equal(await page.locator('.asset-gallery-card').count(),3);await page.locator('[data-gallery-close]').click();}
 await page.evaluate(()=>window.assetUI.open());assert.equal(await page.locator('[data-team-corrections]').count(),0);assert.ok(!(await page.locator('#asset-gallery-workspace').innerText()).includes('团队修正'));await page.locator('[data-asset-auto-match]').click();await page.waitForFunction(()=>document.querySelector('[data-asset-search-status]')?.textContent.startsWith('匹配完成'));
 await page.locator('[data-asset-query]').fill(sceneName);assert.equal(await page.locator('.asset-gallery-card').count(),1);await page.locator('[data-asset-query]').fill('华山');assert.equal(await page.locator('.asset-gallery-card').count(),0);await page.locator('[data-asset-query]').fill('');
 const sceneCard=page.locator('.asset-gallery-card').filter({has:page.locator('.asset-gallery-caption>strong',{hasText:sceneName})});assert.equal(await sceneCard.locator('[data-gallery-adopt]').count(),2);await sceneCard.locator('[data-gallery-choose]').first().click();await page.locator('.asset-quick-view').waitFor();assert.equal(await page.locator('[data-asset-use-moku]').count(),2);assert.doesNotMatch(await page.locator('.asset-choice-strip').innerText(),/令狐冲/);
 await page.locator('[data-asset-all-types]').check();await page.waitForFunction(()=>document.querySelectorAll('[data-asset-use-moku]').length===2);await page.locator('[data-asset-all-types]').uncheck();await page.waitForFunction(()=>document.querySelectorAll('[data-asset-use-moku]').length===2);await page.locator('[data-asset-use-moku]').first().click();await page.locator('#asset-detail-panel').waitFor({state:'hidden'});
 await page.reload();await page.waitForFunction(()=>window.fixtureReady===true,{},{timeout:5000}).catch(async error=>{await page.screenshot({path:path.join(proof,'fixture-error.png')});throw Error(error.message+' '+JSON.stringify(errors)+' '+(await page.locator('body').innerText()).slice(-1500));});assert.ok(inventory(current(),assets).find(r=>r.role==='scene').assetIds.length);
 const rail=page.locator('.task-card-rail');await rail.hover();await page.mouse.wheel(0,600);await page.waitForFunction(()=>document.querySelector('.task-card-rail').scrollLeft>0);await rail.focus();await page.keyboard.press('Home');await page.waitForFunction(()=>document.querySelector('.task-card-rail').scrollLeft===0);await page.locator('[data-task-scroll="1"]').click();await page.waitForFunction(()=>document.querySelector('.task-card-rail').scrollLeft>200);await rail.focus();await page.keyboard.press('End');await page.keyboard.press('ArrowLeft');
 const layout=[];for(const viewport of [{width:1864,height:949},{width:1180,height:720},{width:760,height:640}]){await page.setViewportSize(viewport);const metrics=await page.evaluate(()=>{const tray=document.querySelector('.job-tray').getBoundingClientRect(),heading=document.querySelector('.job-heading').getBoundingClientRect(),status=document.querySelector('#episode-batch-status').getBoundingClientRect(),rail=document.querySelector('.task-card-rail');return {viewport:innerWidth,document:document.documentElement.scrollWidth,trayBottom:tray.bottom,height:innerHeight,statusInHeading:status.top>=heading.top&&status.bottom<=heading.bottom+1,scrollable:rail.scrollWidth>rail.clientWidth};});assert.ok(metrics.document<=viewport.width,JSON.stringify(metrics));assert.ok(metrics.trayBottom<=viewport.height+1,JSON.stringify(metrics));assert.equal(metrics.statusInHeading,true);assert.equal(metrics.scrollable,true);layout.push(metrics);await page.screenshot({path:path.join(proof,'task-tray-'+viewport.width+'.png')});}
 await page.setViewportSize({width:1864,height:949});const footer=await page.locator('.task-card').last().locator('footer').boundingBox();assert.ok(footer.y+footer.height<949);await page.locator('.job-tray').evaluate(e=>e.classList.add('collapsed'));assert.ok((await page.locator('.job-tray').boundingBox()).height<=53);
 assert.deepEqual(errors,[]);assert.equal(store.db.jobs.length,0);assert.ok(!writes.some(url=>/team-members\/asset-corrections/.test(url)));assert.ok(!writes.some(url=>/\/api\/jobs|reference-generation$/.test(url)));fs.writeFileSync(path.join(proof,'browser-acceptance.json'),JSON.stringify({ok:true,realGeneration:false,isolated:true,modeSwitches:4,typedSearch:true,allTypesExplicit:true,selectionPersisted:true,teamCorrectionsRemoved:true,wheel:true,arrows:true,keyboard:true,layout,errors},null,2));
});
