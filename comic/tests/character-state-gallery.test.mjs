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
import {prepareWorkspaceBinding} from '../lib/asset-workspace-api.mjs';

test('本话资产候选、预览、说明和操作分区，窄屏不重叠，采用后留在资产总览',{timeout:90000},async t=>{
 const names=['角色甲','宋茜','岳灵珊','林平之','令狐冲','已采用人物','生成中人物','已完成结果','缺少设定图','人物名称很长也不能把按钮和服装信息挤出卡片'],files=syntheticFiles(),board=JSON.parse(files[0].bytes),screen=JSON.parse(files[1].bytes);
 for(const p of board['格']){p['当前场景']='';p['出现角色']=names;p['服装']=Object.fromEntries(names.map(n=>[n,'青色儒衫']));p['台词']=[];}
 for(const s of screen['屏段'])s['附图']=names.map(n=>({'类型':'设定卡','人物':n,'服装':'青色儒衫','必须':true}));screen['文字']=[];
 screen['屏段'][1]['附图'].find(r=>r['人物']==='角色甲')['服装']='黑蓝战袍'; files[0].bytes=Buffer.from(JSON.stringify(board));files[1].bytes=Buffer.from(JSON.stringify(screen));
 let project=productionProject(await inspectProductionPackage(files));const assets=[],requests=[],adoptions=[],cloud=randomUUID();ensureProjectPanelGeneration(project,assets);
 const store={db:{assets,jobs:[]},asset:id=>assets.find(a=>a.id===id)},rows=()=>assetWorkspaceInventory(project,assets,{scope:'work'}),row=name=>rows().find(r=>r.name===name);
 const catalogue=names.slice(0,5).flatMap((name,n)=>Array.from({length:[13,3,2,1,3][n]},(_,i)=>({id:randomUUID(),recommendedRevisionId:randomUUID(),projectId:cloud,name:name+'_另一套服装_候选'+(i+1)+'.png',category:'character'})));
 function makeAsset(name){const a={id:'asset_'+randomUUID(),name:name+'_青色儒衫.png',width:600,height:400,libraryRole:'character',libraryName:name,libraryState:'青色儒衫',productionStatus:'confirmed',library:{assetId:randomUUID(),revisionId:randomUUID(),sha256:'a'.repeat(64),projectId:cloud}};assets.push(a);return a;}
 const ready=makeAsset('已采用人物');project=prepareWorkspaceBinding(store,project,{expectedRevision:project.revision,targets:[row('已采用人物').uses[0]]},ready);
 const stateRow=rows().find(r=>r.name==='角色甲'&&r.state==='青色儒衫'); const chosen=makeAsset('角色甲'); project=prepareWorkspaceBinding(store,project,{expectedRevision:project.revision,targets:[stateRow.uses[0]]},chosen);
 const records=['生成中人物','已完成结果'].map((name,i)=>({id:'production_'+randomUUID(),name,role:'character',state:'青色儒衫',status:i?'completed':'running',available:!!i,imageUrl:'/picture.png',context:{projectId:project.id,...row(name).uses[0]}}));
 const require=createRequire(import.meta.url),deps=(process.env.CODEX_TEST_NODE_MODULES || 'node_modules/'),{chromium}=require(deps+'playwright'),{createCanvas}=require(deps+'@napi-rs/canvas');
 const canvas=createCanvas(600,400),ctx=canvas.getContext('2d');ctx.fillStyle='#e5e9e5';ctx.fillRect(0,0,600,400);ctx.fillStyle='#497e82';for(const x of [90,240,390]){ctx.fillRect(x,140,90,180);ctx.beginPath();ctx.arc(x+45,100,28,0,Math.PI*2);ctx.fill();}ctx.fillStyle='#263e4d';ctx.font='24px sans-serif';ctx.fillText('SYNTHETIC CHARACTER CARD',65,365);const png=canvas.toBuffer('image/png');
 const publicRoot=path.resolve('public'),styles=fs.readFileSync(path.join(publicRoot,'index.html'),'utf8').match(/<link rel="stylesheet"[^>]+>/g).join('');
 const html=`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${styles}<style>body{margin:0}.app-shell{position:relative;display:block;height:100vh;min-height:0}</style><body class="modern-workbench"><div class="app-shell"><section id="references-tab"></section><section id="inspector-body"><span id="inspector-kind"></span><span id="inspector-title"></span></section></div><script type="module">import{mountAssetWorkspace}from'/asset-workspace-ui.js';let data=await(await fetch('/fixture')).json();window.ui=mountAssetWorkspace({api:async(url,method='GET',body)=>{const r=await fetch(url,{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined}),v=await r.json();if(!r.ok)throw Error(v.error);return v;},getProject:()=>data.project,getPage:()=>data.project.pages[0],getSelected:()=>data.project.pages[0].panels.find(p=>p.productionSegment),getAssets:()=>data.assets,flushSave:async()=>{},accept:async p=>{data.project=p;window.ui.refresh(true);},onAssets:items=>data.assets.push(...items.filter(a=>!data.assets.some(v=>v.id===a.id))),toast:()=>{},renderInspector:()=>{},onChooseEpisode:()=>{}});window.ui.open();</script>`;
 const server=http.createServer(async(req,res)=>{try{const url=new URL(req.url,'http://local'),json=v=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(v));};
  if(url.pathname==='/')return res.end(html);if(url.pathname==='/fixture')return json({project,assets});
  if(url.pathname.endsWith('/results'))return json({items:records});
  if(url.pathname==='/api/library/projects')return json({items:[{id:cloud,name:'候选图库'}]});
  if(url.pathname==='/api/library/assets')return json({items:url.searchParams.get('projectId')===cloud?catalogue.filter(a=>a.name.includes(url.searchParams.get('q'))):[],more:false});
  if(req.method==='POST'){const chunks=[];for await(const c of req)chunks.push(c);const input=JSON.parse(Buffer.concat(chunks));requests.push({url:url.pathname,input});
   if(url.pathname.endsWith('/asset-workspace/reuse'))return json({changed:false,summary:{reused:0}});
   if(url.pathname==='/api/library/import'){adoptions.push(input);const imported=makeAsset('角色甲');imported.library.revisionId=input.revisionId;imported.libraryState='黑蓝战袍';return json({asset:imported});}
   if(url.pathname.endsWith('/asset-workspace/bind')){project=prepareWorkspaceBinding(store,project,input,store.asset(input.assetId));project.revision++;return json({project});}
   throw Error('禁止真实生成或其他写入');}
  if(url.pathname==='/picture.png'||url.pathname.startsWith('/api/assets/')||url.pathname.includes('/preview/')||url.pathname.endsWith('/download')){res.setHeader('Content-Type','image/png');return res.end(png);}
  const full=path.resolve(publicRoot,'.'+url.pathname);assert.ok(full.startsWith(publicRoot+path.sep));if(!fs.existsSync(full)){res.writeHead(404);return res.end();}res.setHeader('Content-Type',full.endsWith('.css')?'text/css':full.endsWith('.js')?'text/javascript':'application/octet-stream');res.end(fs.readFileSync(full));
 }catch(e){res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:e.message}));}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close();});const browser=await chromium.launch({channel:'msedge',headless:true});t.after(()=>browser.close());const page=await browser.newPage({viewport:{width:1864,height:1000}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>new URL(r.request().url()).hostname==='127.0.0.1'?r.continue():r.abort());await page.goto('http://127.0.0.1:'+server.address().port);await page.locator('[data-asset-auto-match]').click();await page.waitForFunction(()=>document.querySelector('[data-asset-search-status]').textContent.startsWith('匹配完成'));

 const group=page.locator('[data-character-group]').filter({has:page.locator('.asset-gallery-caption>strong',{hasText:'角色甲'})});
 const states=group.locator('[data-identity-state]'); assert.equal(await states.count(),2);
 const keys=await states.evaluateAll(nodes=>nodes.map(n=>n.dataset.identityState));
 const selected=states.filter({has:page.locator('.is-current')}); const missing=states.filter({hasNot:page.locator('.is-current')});
 assert.equal(await selected.count(),1);assert.equal(await missing.count(),1);assert.equal(await selected.locator('.is-current img').count(),1);
 assert.equal(await selected.locator('[data-gallery-adopt]').count(),2);assert.equal(await missing.locator('[data-gallery-adopt]').count(),3);
 assert.equal(await selected.locator('.is-current img').evaluate(i=>i.naturalWidth>0),true);
 for(const width of [1864,1280,760,480]){await page.setViewportSize({width,height:1000});const overflow=await group.evaluate(el=>el.scrollWidth>el.clientWidth+1);assert.equal(overflow,false,'overflow '+width);}
 await page.setViewportSize({width:1864,height:1000});const proof=path.resolve('../verification/character-state-gallery');fs.mkdirSync(proof,{recursive:true});await page.screenshot({path:path.join(proof,'states-before.png')});
 const missingKey=await missing.getAttribute('data-identity-state');const chosenKey=await selected.getAttribute('data-identity-state');
 await missing.locator('[data-gallery-adopt]').first().click();try{await page.waitForFunction(key=>[...document.querySelectorAll('[data-identity-state]')].find(n=>n.dataset.identityState===key)?.querySelector('.is-current'),missingKey,{timeout:4000});}catch(e){console.log('DEBUG',JSON.stringify({requests,adoptions,errors,status:await page.locator('[data-asset-search-status]').innerText(),cards:await states.allInnerTexts()}));throw e;}
 assert.equal(await page.locator('[data-identity-state]').filter({has:page.locator('.is-current')}).count(),2);
 const bind=requests.filter(r=>r.url.endsWith('/asset-workspace/bind')).at(-1);assert.ok(bind);const expected=rows().find(r=>r.key===missingKey);assert.ok(bind.input.targets.every(t=>expected.uses.some(u=>u.panelId===t.panelId&&u.needId===t.needId)));
 assert.equal((await page.locator('[data-identity-state]').evaluateAll((nodes,key)=>nodes.find(n=>n.dataset.identityState===key)?.querySelector('.is-current img')?.getAttribute('src'),chosenKey)).includes(chosen.id),true);
 assert.equal(await page.locator('#asset-gallery-workspace').isVisible(),true);assert.equal(requests.some(r=>r.url.includes('reference-generation')),false);assert.deepEqual(errors,[]);
 fs.writeFileSync(path.join(proof,'report.json'),JSON.stringify({ok:true,synthetic:true,stateCount:keys.length,selectedPreserved:true,correctStateTargets:true,noRealGeneration:true,errors},null,2));
});
