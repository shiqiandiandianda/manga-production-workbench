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
import {ensureProjectPanelGeneration} from '../public/panel-generation.js';
import {assetWorkspaceInventory} from '../public/asset-workspace-model.js';
import {auditPanelReferences} from '../public/panel-reference-audit.js';
import {prepareWorkspaceBinding,prepareWorkspaceText} from '../lib/asset-workspace-api.mjs';
import {referenceAssetGenerationRequest} from '../lib/reference-asset-generation.mjs';
import {generationReferencePlan} from '../public/asset-generation-references.js';
import {fuzzyAssetCandidates} from '../public/asset-fuzzy-search.js';
import {createMokuReferenceSearch} from '../public/moku-reference-search.js';
import {quickCharacterSearchFeedback} from '../public/asset-quick-view.js';
import {manualStateReferenceConfirmed,stateReferenceMetadata} from '../public/character-state-references.js';
const proof=path.resolve(import.meta.dirname,'../../verification/asset-simple-pick-20261027');
fs.mkdirSync(proof,{recursive:true});
function image(name,role='character',state='白衣') {return {id:'asset_'+randomUUID(),name:name+'.png',libraryName:name,libraryRole:role,libraryState:state,productionStatus:'confirmed',width:600,height:400,library:{assetId:randomUUID(),revisionId:randomUUID(),sha256:'a'.repeat(64),projectId:randomUUID()}};}
async function fixture(){
 const project=productionProject(await inspectProductionPackage(syntheticFiles()));ensureProjectPanelGeneration(project,[]);
 return {project,assets:[],store:{db:{assets:[],jobs:[]}}};
}
const rowFor=(project,assets,role)=>assetWorkspaceInventory(project,assets,{scope:'work'}).find(r=>r.role===role);
const targets=row=>row.uses.map(({panelId,needId})=>({panelId,needId}));

test('模糊检索覆盖人物简称、场景异名、多个关键词；精确匹配优先',()=>{
 const items=['青城派弟子_全员修改版.png','林家马车车厢','赴扬州官道·后段','福州城外茶摊_生成.png','角色甲_蓝衣.png','角色甲_黑衣.png','宋菡_蓝衣.png'].map(name=>({name}));
 for(const [query,name]of [['青城派留守弟子',items[0].name],['林家马车内',items[1].name],['官道后段',items[2].name],['福州街道茶馆',items[3].name],['黑衣 角色甲',items[5].name]])assert.equal(fuzzyAssetCandidates(items,query)[0].name,name);
 assert.equal(fuzzyAssetCandidates(items,'不存在火星').length,0);assert.equal(fuzzyAssetCandidates(items,'').length,items.length);
});
test('墨库浏览全量分页并展示各服装图片，不在服务器做完整名称过滤',async()=>{
 const cloud=randomUUID(),remote={id:randomUUID(),name:'青城派弟子_全员修改版.png',recommendedRevisionId:randomUUID()},calls=[];
 const search=createMokuReferenceSearch({project:{},assets:[],api:async route=>{calls.push(route);if(route==='/api/library/projects')return {items:[{id:cloud,name:'测试'}]};const u=new URL(route,'http://local');assert.equal(u.searchParams.get('q'),'');assert.equal(u.searchParams.get('groupCharacters'),'false');return {items:u.searchParams.get('offset')==='0'?Array.from({length:200},(_,i)=>({...remote,id:randomUUID(),name:'无关图片'+i})): [remote],more:u.searchParams.get('offset')==='0'};}});
 const result=await search.search('青城派留守弟子',{scope:cloud});assert.equal(result.items.length,1);assert.equal(result.items[0].id,remote.id);assert.equal(result.complete,true);const count=calls.length;await search.search('青城',{scope:cloud});assert.equal(calls.length,count);search.clear();
});
test('候选图不被原需求的人名或服装过滤；手动选图绑定固定版本且仅更新选定范围',async()=>{
 const {project}=await fixture(),a=image('别名人物','character','白衣'),assets=[a],store={db:{assets,jobs:[]},asset:()=>a},row=rowFor(project,assets,'character'),before=JSON.stringify(project);
 assert.equal(quickCharacterSearchFeedback(project,row,assets,[],'别名').candidates[0].id,a.id);
 const chosenTargets=targets(row).slice(0,1),next=prepareWorkspaceBinding(store,project,{expectedRevision:project.revision,targets:chosenTargets,userSelected:true},a);
 const panel=next.pages.flatMap(p=>p.panels).find(p=>p.id===chosenTargets[0].panelId),need=auditPanelReferences(next,panel,assets).needs.find(n=>n.id===chosenTargets[0].needId);
 assert.equal(need.status,'ready');assert.deepEqual(need.selectedIds,[a.id]);assert.equal(panel.referenceNeedBindings[need.id].userSelection.version,1);
 const reload=JSON.parse(JSON.stringify(next)),p=reload.pages.flatMap(p=>p.panels).find(p=>p.id===panel.id);assert.equal(auditPanelReferences(reload,p,assets).needs.find(n=>n.id===need.id).status,'ready');
 const other=targets(row)[1],otherPanel=next.pages.flatMap(p=>p.panels).find(p=>p.id===other.panelId);assert.equal(auditPanelReferences(next,otherPanel,assets).needs.find(n=>n.id===other.needId).selectedIds.length,0);
 assert.equal(manualStateReferenceConfirmed(panel,need,{...a,library:{...a.library,sha256:'b'.repeat(64)}},stateReferenceMetadata(next,a)),false);
 assert.equal(JSON.stringify(project),before);assert.throws(()=>prepareWorkspaceBinding(store,project,{expectedRevision:999,targets:chosenTargets,userSelected:true},a),/工程已改变/);
 store.db.jobs.push({projectId:project.id,panelId:chosenTargets[0].panelId,status:'running'});assert.throws(()=>prepareWorkspaceBinding(store,project,{expectedRevision:project.revision,targets:chosenTargets,userSelected:true},a),/正在生成/);
});
test('人物、场景均只使用手选的一张生成参考；文生明确使用零张，不误带旧图',async()=>{
 const {project}=await fixture(),a=image('任意用户参考'),b=image('旧图'),assets=[a,b];
 for(const role of ['character','scene','prop']){const need={name:'本次需求',role};const selected=generationReferencePlan(project,assets,need,{generationReferenceMode:'selected',generationReferenceAssetId:a.id,identityAssetId:b.id,costumeAssetId:b.id},[b.id]);assert.deepEqual(selected.referenceIds,[a.id]);assert.deepEqual(generationReferencePlan(project,assets,need,{generationReferenceMode:'none',generationReferenceAssetId:a.id},[b.id]).referenceIds,[]);}
 const row=rowFor(project,assets,'character'),input={projectId:project.id,...targets(row)[0],expectedRevision:project.revision,requestId:randomUUID(),settings:{generationReferenceMode:'selected',generationReferenceAssetId:a.id,assetBrief:'穿蓝色长衫',characterOutputMode:'card'}};
 const request=referenceAssetGenerationRequest(project,input,assets);assert.deepEqual(request.referenceIds,[a.id]);assert.match(request.payload.prompt,/以已选人物形象图为身份锚点/);assert.match(request.payload.prompt,/穿蓝色长衫/);assert.equal(request.payload.settings.characterOutputMode,'card');
});

test('浏览器实点：模糊搜索→整图直接采用→列表；场景与人物同流程；文生和单参考生成',{timeout:60000},async t=>{
 const f=await fixture();let project=f.project;
 const cloud=randomUUID(),remote={id:randomUUID(),name:'别名人物_白衣.png',category:'character',characterName:'别名人物',outfitName:'白衣',projectId:cloud,recommendedRevisionId:randomUUID()},scene={id:randomUUID(),name:'庭院内景.png',category:'scene',projectId:cloud,recommendedRevisionId:randomUUID()};
 const a={...image('别名人物','character','白衣'),library:{assetId:remote.id,revisionId:remote.recommendedRevisionId,sha256:'a'.repeat(64),projectId:cloud}},b={...image('庭院内景','scene',''),library:{assetId:scene.id,revisionId:scene.recommendedRevisionId,sha256:'b'.repeat(64),projectId:cloud}},assets=[],calls=[],errors=[],generation=[];
 let failImport=false,staleImport=false;
 const store={db:{assets,jobs:[]},asset:id=>assets.find(a=>a.id===id)},publicRoot=path.resolve(import.meta.dirname,'../public'),styles=fs.readFileSync(path.join(publicRoot,'index.html'),'utf8').match(/<link rel="stylesheet"[^>]+>/g).join('');
 const require=createRequire(import.meta.url),deps=(process.env.CODEX_TEST_NODE_MODULES || 'node_modules'), {chromium}=require(path.join(deps,'playwright')),{createCanvas}=require(path.join(deps,'@napi-rs/canvas'));const canvas=createCanvas(600,400),ctx=canvas.getContext('2d');ctx.fillStyle='#dde8df';ctx.fillRect(0,0,600,400);ctx.fillStyle='#223e4b';ctx.fillRect(80,80,440,240);const png=canvas.toBuffer('image/png');
 const html=`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${styles}<style>body{margin:0}.app-shell{position:relative;display:block;height:100vh;min-height:0}</style><body class="modern-workbench"><div class="app-shell"><section id="references-tab"></section><section id="inspector-body"><span id="inspector-kind"></span><span id="inspector-title"></span></section></div><script type="module">import{mountAssetWorkspace}from'/asset-workspace-ui.js';let data=await(await fetch('/fixture')).json();window.ui=mountAssetWorkspace({api:async(url,method='GET',body)=>{const r=await fetch(url,{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined}),v=await r.json();if(!r.ok)throw Error(v.error);return v;},getProject:()=>data.project,getPage:()=>data.project.pages[0],getSelected:()=>data.project.pages[0].panels.find(p=>p.productionSegment),getAssets:()=>data.assets,flushSave:async()=>{},accept:async p=>{data.project=p;window.ui.refresh(true)},onAssets:items=>{for(const a of items){const i=data.assets.findIndex(x=>x.id===a.id);if(i<0)data.assets.push(a);else data.assets[i]=a}},toast:()=>{},renderInspector:()=>{}});window.ui.open();</script>`;
 const server=http.createServer(async(req,res)=>{const json=(v,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(v));};try{const u=new URL(req.url,'http://local');
  if(u.pathname==='/')return res.end(html);if(u.pathname==='/fixture')return json({project,assets});if(u.pathname.endsWith('/novel-evidence'))return json({available:false,excerpts:[]});if(u.pathname.endsWith('/results'))return json({items:[]});
  if(u.pathname==='/api/library/projects')return json({items:[{id:cloud,name:'合成图库'}]});if(u.pathname==='/api/library/assets')return json({items:u.searchParams.get('projectId')===cloud?[remote,scene]:[],more:false});
  if(req.method==='POST'){let text='';for await(const chunk of req)text+=chunk;const input=JSON.parse(text);calls.push({path:u.pathname,input});await new Promise(r=>setTimeout(r,40));
   if(u.pathname.endsWith('/reuse'))return json({changed:false,summary:{reused:0}});
   if(u.pathname==='/api/library/import'){if(failImport){failImport=false;return json({error:'合成网络故障，请重试'},503);}const item=input.assetId===remote.id?a:b;if(!assets.some(i=>i.id===item.id))assets.push(item);return json({asset:staleImport?{...item,library:{...item.library,revisionId:randomUUID()}}:item});}
   if(u.pathname.endsWith('/asset-workspace/bind')){project=prepareWorkspaceBinding(store,project,input,store.asset(input.assetId));project.revision++;return json({project});}
   if(u.pathname.endsWith('/asset-workspace/text')){project=prepareWorkspaceText(store,project,input);project.revision++;return json({project});}
   if(u.pathname==='/api/project-center/reference-generation'||u.pathname.endsWith('/reference-generation/preview')){const request=referenceAssetGenerationRequest(project,{...input,requestId:input.requestId||'preview-only'},assets);generation.push(request);return json(u.pathname.endsWith('/preview')?{prompt:request.payload.prompt,referenceIds:request.referenceIds}:{task:{id:'synthetic-task',status:'queued'}});}
   throw Error('意外的写请求 '+u.pathname);
  }
  if(u.pathname.startsWith('/api/assets/')||u.pathname.startsWith('/assets/')||u.pathname.includes('/preview/')||u.pathname.endsWith('/download')){res.setHeader('Content-Type','image/png');return res.end(png);}
  const file=path.resolve(publicRoot,'.'+u.pathname);assert.ok(file.startsWith(publicRoot+path.sep));if(!fs.existsSync(file))return json({},404);res.setHeader('Content-Type',file.endsWith('.css')?'text/css':'text/javascript');res.end(fs.readFileSync(file));
 }catch(e){json({error:e.message},e.status||500);}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close();});const browser=await chromium.launch({channel:'msedge',headless:true,env:{...process.env,TEMP:proof,TMP:proof}});t.after(()=>browser.close());
 const page=await browser.newPage({viewport:{width:1600,height:1000}}),origin='http://127.0.0.1:'+server.address().port;page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());await page.goto(origin);
 const card=name=>page.locator('.asset-gallery-card').filter({has:page.locator('.asset-gallery-caption>strong',{hasText:new RegExp('^'+name+'$')})}),choose=async name=>{await card(name).locator('[data-gallery-choose]').first().click();await page.locator('.asset-quick-view').waitFor();};
 await choose('测试人物');await page.locator('[data-asset-moku-query]').fill('别名');await page.locator('[data-asset-moku-query]').press('Enter');const imageButton=page.locator('[data-asset-use-moku="'+remote.id+'"]');await imageButton.waitFor();
 assert.equal(await page.locator('.asset-quick-original').getAttribute('open'),null);assert.equal(await page.locator('[data-asset-name-confirmation]').count(),0);await page.screenshot({path:path.join(proof,'synthetic-picker.png')});
 failImport=true;await imageButton.click();await page.waitForFunction(()=>document.querySelector('[data-asset-status]')?.textContent.includes('合成网络故障'));assert.equal(calls.filter(c=>c.path.endsWith('/bind')).length,0);
 staleImport=true;await imageButton.click();await page.waitForFunction(()=>document.querySelector('[data-asset-status]')?.textContent.includes('图片版本已改变'));assert.equal(calls.filter(c=>c.path.endsWith('/bind')).length,0);staleImport=false;
 // A failure can leave a safely imported local copy visible. Both paths still click directly.
 const button=page.locator('[data-asset-use-local="'+a.id+'"], [data-asset-use-moku="'+remote.id+'"]');await button.first().evaluate(e=>{e.click();e.click();});await page.locator('#asset-detail-panel').waitFor({state:'hidden'});assert.equal(calls.filter(c=>c.path.endsWith('/bind')).length,1);assert.equal(calls.find(c=>c.path.endsWith('/bind')).input.userSelected,true);assert.equal(await page.locator('#asset-gallery-workspace').isVisible(),true);assert.match(await card('测试人物').innerText(),/已采用/);
 await choose('测试庭院');await page.locator('[data-asset-use-moku="'+scene.id+'"] img').click();await page.locator('#asset-detail-panel').waitFor({state:'hidden'});assert.equal(calls.filter(c=>c.path.endsWith('/bind')).length,2);
 await page.reload();await choose('测试人物');assert.equal(await page.locator('.asset-choice-card.is-current').count(),1);await page.locator('[data-asset-action="save-text"]').click();await page.locator('#asset-detail-panel').waitFor({state:'hidden'});assert.match(await card('测试人物').innerText(),/文生/);assert.equal(calls.filter(c=>c.path.endsWith('/text')).length,1);
 await choose('测试人物');await page.locator('[data-asset-moku-query]').fill('庭院');await page.locator('[data-asset-moku-query]').press('Enter');await page.locator('[data-asset-all-types]').check();await page.locator('[data-asset-reference-candidate="'+b.id+'"], [data-asset-reference-candidate="'+scene.id+'"]').first().click({timeout:5000}).catch(async e=>{throw Error(e.message+' UI '+await page.locator('#asset-detail-panel').innerText()+' QUERY '+await page.locator('[data-asset-moku-query]').inputValue())});assert.equal(calls.filter(c=>c.path.endsWith('/bind')).length,2);await page.locator('[data-setting="assetBrief"]').fill('参考这个场景配色，穿蓝衣');await page.locator('[data-asset-action="submit-generation"]').click();await page.waitForFunction(()=>document.querySelector('[data-asset-status]')?.textContent.includes('已提交'));assert.equal(generation.length,1);assert.deepEqual(generation[0].referenceIds,[b.id]);assert.match(generation[0].payload.prompt,/穿蓝衣/);
 await page.locator('[data-asset-close]').click();await choose('测试庭院');await page.setViewportSize({width:480,height:900});assert.equal(await page.locator('[data-asset-content]').evaluate(n=>n.scrollWidth>n.clientWidth+1),false);await page.screenshot({path:path.join(proof,'synthetic-mobile.png')});await page.locator('[data-asset-action="submit-generation"]').scrollIntoViewIfNeeded();await page.locator('[data-asset-action="submit-generation"]').click();await page.waitForFunction(()=>document.querySelector('[data-asset-status]')?.textContent.includes('已提交'));assert.deepEqual(generation[1].referenceIds,[]);
 assert.deepEqual(errors,[]);assert.equal(await page.locator('[data-asset-name-confirmation]').count(),0);fs.writeFileSync(path.join(proof,'browser-test.json'),JSON.stringify({ok:true,realAI:false,realProjectWrites:0,binds:2,textSelections:1,generations:2,refreshPreserved:true,rapidClickGuard:true,failedImportRetry:true,staleRevisionRejected:true,errors},null,2));
});
