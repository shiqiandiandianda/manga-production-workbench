import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {syntheticFiles} from './fixtures/production-synthetic.mjs';
import {inspectProductionPackage} from '../lib/production-package.mjs';
import {productionProject} from '../lib/production-package-document.mjs';
import {ensureProjectPanelGeneration} from '../public/panel-generation.js';
import {assetWorkspaceInventory} from '../public/asset-workspace-model.js';
import {auditPanelReferences} from '../public/panel-reference-audit.js';
import {prepareWorkspaceBinding} from '../lib/asset-workspace-api.mjs';

for(const mode of ['local','remote','remote-stale'])test('浏览器候选直接选用：'+mode,{timeout:60000},async t=>{
 const files=syntheticFiles(),screen=JSON.parse(files[1].bytes);
 for(const s of screen['屏段'])s['附图']=[{'类型':'设定卡','人物':'宋茜','服装':'淡黄色长裙','必须':true}];
 files[1]={...files[1],bytes:Buffer.from(JSON.stringify(screen))};
 let project=productionProject(await inspectProductionPackage(files));
 const cloud=randomUUID(),local={id:'asset_'+randomUUID(),name:'宋茜_鹅黄衣裙.png',libraryName:'宋茜',libraryState:'鹅黄衣裙',libraryRole:'character',productionStatus:'confirmed',width:600,height:360,library:{assetId:randomUUID(),revisionId:randomUUID(),sha256:'a'.repeat(64),projectId:cloud}},
 remote={id:randomUUID(),name:'宋茜_天青衣裙.png',category:'character',projectId:cloud,characterName:'宋茜',outfitName:'天青衣裙',displayRevisionId:randomUUID(),recommendedRevisionId:randomUUID()},
 imported={...local,id:'asset_'+randomUUID(),name:remote.name,libraryState:'天青衣裙',library:{assetId:remote.id,revisionId:mode==='remote-stale'?randomUUID():remote.displayRevisionId,sha256:'b'.repeat(64),projectId:cloud}},assets=[local],requests=[],errors=[];
 project.assetLibrary={version:1,assetIds:[local.id],directories:[],recursive:true};ensureProjectPanelGeneration(project,assets);
 const sourceSnapshot=p=>{const copy=structuredClone(p.productionPackage);for(const e of copy.episodes)for(const s of e.segments)for(const ref of s.references){delete ref.binding;delete ref.skipped;}return JSON.stringify(copy);};
 const row=assetWorkspaceInventory(project,assets,{scope:'work'}).find(r=>r.name==='宋茜'),expectedTargets=row.uses.map(u=>({panelId:u.panelId,needId:u.needId})),originalAsset=JSON.stringify(local),source=sourceSnapshot(project),store={db:{assets,jobs:[]},asset:id=>assets.find(a=>a.id===id)};
 const require=createRequire(import.meta.url),deps=path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules'),{chromium}=require(path.join(deps,'playwright')),{createCanvas}=require(path.join(deps,'@napi-rs/canvas')),canvas=createCanvas(600,360),ctx=canvas.getContext('2d');ctx.fillStyle='#f9f4dc';ctx.fillRect(0,0,600,360);ctx.fillStyle='#e5c65a';ctx.fillRect(220,70,160,270);const png=canvas.toBuffer('image/png');
 const publicRoot=path.resolve(import.meta.dirname,'../public'),styles=fs.readFileSync(path.join(publicRoot,'index.html'),'utf8').match(/<link rel="stylesheet"[^>]+>/g).join(''),proof=path.resolve(import.meta.dirname,'../../verification/quick-asset-use');fs.mkdirSync(proof,{recursive:true});
 const html=`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${styles}<style>body{margin:0}.app-shell{position:relative;display:block;height:100vh;min-height:0}</style><body class="modern-workbench"><div class="app-shell"><section id="references-tab"></section><section id="inspector-body"><span id="inspector-kind"></span><span id="inspector-title"></span></section></div><script type="module">import{mountAssetWorkspace}from'/asset-workspace-ui.js';let data=await(await fetch('/fixture')).json();window.ui=mountAssetWorkspace({api:async(url,method='GET',body)=>{const r=await fetch(url,{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined}),v=await r.json();if(!r.ok)throw Error(v.error);return v;},getProject:()=>data.project,getPage:()=>data.project.pages[0],getSelected:()=>data.project.pages[0].panels.find(p=>p.productionSegment),getAssets:()=>data.assets,flushSave:async()=>{},accept:async p=>{data.project=p;window.ui.refresh(true);},onAssets:items=>{for(const a of items){const i=data.assets.findIndex(x=>x.id===a.id);if(i<0)data.assets.push(a);else data.assets[i]=a;}},toast:()=>{},renderInspector:()=>{}});window.ui.open();</script>`;
 const server=http.createServer(async(req,res)=>{const json=(v,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(v));};try{
  const url=new URL(req.url,'http://local');if(url.pathname==='/')return res.end(html);if(url.pathname==='/fixture')return json({project,assets});
  if(url.pathname.endsWith('/novel-evidence'))return json({available:false,excerpts:[]});if(url.pathname.endsWith('/results'))return json({items:[]});if(url.pathname==='/api/library/projects')return json({items:[{id:cloud,name:'合成图库'}]});if(url.pathname==='/api/library/assets')return json({items:[remote],more:false});
  if(req.method==='POST'){let text='';for await(const chunk of req)text+=chunk;const input=JSON.parse(text);requests.push({path:url.pathname,input});await new Promise(r=>setTimeout(r,50));
   if(url.pathname==='/api/library/import'){assets.push(imported);return json({asset:imported});}
   if(url.pathname.endsWith('/asset-workspace/bind')){const chosen=store.asset(input.assetId);project=prepareWorkspaceBinding(store,project,input,chosen);project.revision++;return json({project});}
   throw Error('禁止真实生成或其他写入');
  }
  if(url.pathname.startsWith('/assets/')||url.pathname.startsWith('/api/assets/')||url.pathname.includes('/preview/')||url.pathname.endsWith('/download')){res.setHeader('Content-Type','image/png');return res.end(png);}
  const file=path.resolve(publicRoot,'.'+url.pathname);assert.ok(file.startsWith(publicRoot+path.sep));if(!fs.existsSync(file)){res.writeHead(404);return res.end();}res.setHeader('Content-Type',file.endsWith('.css')?'text/css':'text/javascript');res.end(fs.readFileSync(file));
 }catch(e){json({error:e.message},e.status||500);}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close();});
 const browser=await chromium.launch({channel:'msedge',headless:true,env:{...process.env,TEMP:proof,TMP:proof}});t.after(()=>browser.close());
 const page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());await page.goto('http://127.0.0.1:'+server.address().port);
 await page.locator('[data-gallery-choose]').filter({visible:true}).first().click();
 // Image clicks still open a full-size review; cancelling never binds or imports.
 await page.locator('[data-asset-review-local]').first().click();await page.locator('[data-asset-name-confirmation][open]').waitFor();assert.equal(requests.length,0);await page.locator('[data-asset-action="cancel-state-adoption"]').last().click();
 const selector=mode==='local'?'[data-asset-use-local]':'[data-asset-use-moku]',use=page.locator(selector).first();await use.waitFor();
 const bounds=await use.evaluate(e=>{const b=e.getBoundingClientRect(),c=e.closest('.asset-choice-card').getBoundingClientRect();return {x:b.x,y:b.y,right:b.right,cardRight:c.right,top:c.top};});assert.ok(bounds.y-bounds.top<12&&bounds.cardRight-bounds.right<12,'use button is at card top right');
 if(mode==='local')await page.screenshot({path:path.join(proof,'candidate-buttons-desktop.png')});
 await page.setViewportSize({width:480,height:900});await use.scrollIntoViewIfNeeded();const box=await use.boundingBox();assert.ok(box.y>=0&&box.y+box.height<=900,'no lower confirmation scroll is needed');
 await page.screenshot({path:path.join(proof,mode+'-before.png')});
 // Two rapid activations must send one adoption only; no second confirmation dialog.
 await use.evaluate(e=>{e.click();e.click();});
 if(mode==='remote-stale'){
  await page.waitForFunction(()=>document.querySelector('[data-asset-status]')?.textContent.includes('图片版本已改变'));
  assert.equal(requests.filter(r=>r.path.endsWith('/bind')).length,0);assert.equal(await page.locator('[data-asset-review-current]').count(),0);
 }else{
  await page.waitForFunction(()=>document.querySelector('[data-asset-status]')?.textContent.includes('已记住人工确认'));
  const writes=requests.filter(r=>r.path.endsWith('/bind'));assert.equal(writes.length,1);const chosen=mode==='local'?local:imported;
  assert.equal(writes[0].input.assetId,chosen.id);assert.equal(writes[0].input.stateConfirmation.revisionId,chosen.library.revisionId);assert.equal(writes[0].input.stateConfirmation.sha256,chosen.library.sha256);assert.deepEqual(writes[0].input.targets,expectedTargets);
  for(const target of expectedTargets){const panel=project.pages.flatMap(p=>p.panels).find(p=>p.id===target.panelId),need=auditPanelReferences(project,panel,assets).needs.find(n=>n.id===target.needId);assert.equal(need.status,'ready');assert.deepEqual(need.selectedIds,[chosen.id]);}
  assert.equal(await page.locator('[data-asset-review-current]').getAttribute('data-asset-review-current'),chosen.id);assert.equal(await page.locator('#asset-detail-panel').isVisible(),true);
 }
 assert.equal(await page.locator('[data-asset-name-confirmation]').count(),0);assert.equal(JSON.stringify(local),originalAsset);assert.equal(sourceSnapshot(project),source);assert.deepEqual(errors,[]);
 const imports=requests.filter(r=>r.path==='/api/library/import');assert.equal(imports.length,mode==='local'?0:1);if(imports.length){assert.equal(imports[0].input.assetId,remote.id);assert.equal(imports[0].input.revisionId,remote.displayRevisionId);}
 fs.writeFileSync(path.join(proof,mode+'-report.json'),JSON.stringify({ok:true,mode,realAI:false,binds:requests.filter(r=>r.path.endsWith('/bind')).length,imports:imports.length,noMandatoryDialog:true,rapidClickGuard:true,browserErrors:errors},null,2));
});
