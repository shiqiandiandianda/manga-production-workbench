import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {BUILTIN_BUBBLE_STYLES,builtinBubblePreview} from '../public/builtin-bubble-data.js';
import {bubbleMaterials,refreshBubbleMaterials,applyBubbleMaterial} from '../public/bubble-material.js';
import {applyRemoteBubbleStyles,comicStyles} from '../public/comic-styles.js';
import {editBubblePart} from '../public/bubble-parts.js';
import {productionPanelPromptSource} from '../public/production-panel-prompts.js';
import {productionProject} from '../lib/production-package-document.mjs';
import {inspectProductionPackage} from '../lib/production-package.mjs';
import {syntheticFiles} from './fixtures/production-synthetic.mjs';
import {ensureProjectPanelGeneration} from '../public/panel-generation.js';
import {createProject,clone} from '../public/model.js';
import {createStudio} from '../server.mjs';

test('系统默认气泡独立于墨库清单，双圆上框可独立编辑且保留文字和下框',()=>{
 const remote=clone(comicStyles.filter(s=>s.kind==='bubble'));
 applyRemoteBubbleStyles(remote.slice(0,1));refreshBubbleMaterials();
 for(const style of BUILTIN_BUBBLE_STYLES){assert.ok(bubbleMaterials.some(s=>s.id===style.id));assert.match(builtinBubblePreview(style.id),/^data:image\/svg\+xml/);}
 const before={id:'test',text:'原文\n第二行',x:20,y:40,w:400,h:300,fontSize:28,textBox:{x:25,y:140,w:350,h:110},tail:{visible:true,mode:'normalized',x:.6,y:1.2}};
 const double=applyBubbleMaterial(before,'builtin-double'),moved=editBubblePart(double,0,{dx:32,dy:-16}),resized=editBubblePart(moved,0,{dx:20,dy:30,resize:true});
 assert.ok(moved.assetParts[0].x>double.assetParts[0].x);assert.ok(resized.assetParts[0].w>moved.assetParts[0].w);
 for(const key of ['text','x','y','w','h','textBox','tail','assetContour'])assert.deepEqual(resized[key],double[key]);
 assert.equal(applyBubbleMaterial(resized,'builtin-oval').assetParts,undefined);
 applyRemoteBubbleStyles(remote);refreshBubbleMaterials();
});

test('新单格默认无泡，缺少无泡时用已有空泡；已保存的手动选择保持',()=>{
 const record={original:{提示词:{空泡:'空泡原文',无泡:'无泡原文'}}};
 assert.equal(productionPanelPromptSource(record),'post-lettering');
 assert.equal(productionPanelPromptSource(record,'imported'),'imported');
 assert.equal(productionPanelPromptSource({original:{提示词:{空泡:'空泡原文'}}}),'imported');
});

test('实际界面离线选择系统双圆，上框移动缩放、数值修改、撤销重做与刷新；屏段单格默认无泡',{timeout:90000},async t=>{
 const root=fileURLToPath(new URL('../../',import.meta.url)),evidence=path.join(root,'verification/default-bubbles-clean-20261024');fs.mkdirSync(evidence,{recursive:true});
 const dir=fs.mkdtempSync(path.join(evidence,'fixture-'));process.env.COMIC_PROJECT_SYNC='0';process.env.COMIC_SLOT_DIR=path.join(dir,'slots');process.env.COMIC_LIBRARY_CONFIG=path.join(dir,'library.json');fs.writeFileSync(process.env.COMIC_LIBRARY_CONFIG,'{"base":"http://127.0.0.1:9"}');
 const files=syntheticFiles(),board=JSON.parse(files[0].bytes),pkg=JSON.parse(files[1].bytes);
 for(const row of board['格'])row['提示词']={空泡:'单格空泡原文',无泡:'单格无泡原文'};
 for(const segment of pkg['屏段'])segment['附图']=[];
 files[0].bytes=Buffer.from(JSON.stringify(board));files[1].bytes=Buffer.from(JSON.stringify(pkg));for(const file of files)file.sha256=createHash('sha256').update(file.bytes).digest('hex');
 const p=productionProject(await inspectProductionPackage(files),'系统默认气泡验收 · 合成工程'),owner=p.pages[0],frame=owner.panels.find(f=>f.productionSegment),b=clone(createProject('合成',true).pages[0].bubbles[0]);
 Object.assign(b,{parentPanelId:frame.id,shotId:frame.shotId,productionSegment:frame.productionSegment,productionBoxKind:'speech',productionOriginal:{类型:'对白',文本:'可编辑系统默认气泡'},text:'系统默认双圆气泡\n上方圆框可以独立调整',x:160,y:260,w:800,h:540,fontSize:30,textBox:{x:160,y:260,w:480,h:180},shape:'oval',visible:true,locked:false,tail:{visible:true}});owner.bubbles.push(b);
 const locked=clone(b);locked.id='bubble_00000000-0000-0000-0000-000000000001';locked.locked=true;locked.y=1100;owner.bubbles.push(locked);
 const fake={close(){},status:async()=>({connected:false}),generate(){assert.fail('禁止真实生图');}};
 const studio=createStudio({dataDir:path.join(dir,'data'),seedReference:false,bridge:fake,jimengBridge:fake});ensureProjectPanelGeneration(p);studio.store.db.projects.push(p);studio.store.save();await new Promise(r=>studio.server.listen(0,'127.0.0.1',r));
 const origin='http://127.0.0.1:'+studio.server.address().port,require=createRequire(import.meta.url),{chromium}=require('C:/Users/EDY/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
 const browser=await chromium.launch({channel:'msedge',headless:true}),page=await browser.newPage({viewport:{width:1864,height:1050}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(10000);
 t.after(async()=>{await browser.close();studio.close();studio.server.closeAllConnections();});
 await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.pathname.startsWith('/api/library/'))return route.fulfill({json:{connected:false,items:[],error:'隔离验收：墨库离线'}});if(url.pathname.startsWith('/api/comic-style-library/items/'))return route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="100" height="70"><text x="12" y="40" font-size="12">墨库离线</text></svg>'});return url.origin===origin||['data:','blob:'].includes(url.protocol)?route.continue():route.abort();});
 const current=()=>studio.store.project(p.id),value=()=>current().pages.flatMap(p=>p.bubbles).find(v=>v.id===b.id),saved=async()=>{try{await page.waitForFunction(()=>document.querySelector('#save-state')?.textContent==='已保存到本机');}catch(error){fs.writeFileSync(path.join(evidence,'debug.json'),JSON.stringify({errors,body:await page.locator('body').innerText(),state:await page.locator('#save-state').textContent()},null,2));await page.screenshot({path:path.join(evidence,'debug.png')});throw error;}};
 const select=async()=>{await page.locator('[data-rail-tab="layers"]').click();const row=page.locator('#layer-list [data-layer="'+b.id+'"]');if(!await row.count())await page.locator('[data-toggle-group="'+frame.id+'"]').click();await row.click();};
 const action=async(suffix,run)=>{const waiting=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().endsWith(suffix));await run();const r=await waiting;assert.ok(r.ok(),await r.text());await saved();return r.json();};
 const state=await fetch(origin+'/api/state');assert.ok(state.ok,await state.text());
 await page.goto(origin+'/?project='+p.id);await saved();await page.locator('[data-rail-tab="production"]').click();
 assert.equal(await page.locator('[data-production-mode]').inputValue(),'post-lettering');assert.match(await page.locator('.panel-active-prompt').inputValue(),/无泡整段原文/);
 await page.locator('[data-production-styles]').click();await page.locator('[data-production-style-scope]').selectOption('episode');
 for(const style of BUILTIN_BUBBLE_STYLES){const image=page.locator('[data-production-style-box="'+style.id+'"] img');assert.equal(await image.evaluate(async img=>{await img.decode();return img.naturalWidth>0;}),true);}
 await page.screenshot({path:path.join(evidence,'01_系统默认气泡与无泡模式.png')});
 await action('/production/styles',()=>page.locator('[data-production-style-box="builtin-double"]').click());assert.equal(value().comicStyleId,'builtin-double');assert.equal(value().assetParts[0].id,'upper-bubble');assert.equal(current().pages[0].bubbles.find(v=>v.id===locked.id).shape,'oval');
 for(const key of ['text','x','y','w','h','textBox'])assert.deepEqual(value()[key],b[key]);
 await page.getByRole('button',{name:'完成',exact:true}).click();await select();
 const drag=async(kind,dx,dy)=>{const handle=page.locator('#stage [data-bubble-handle="'+kind+'"]'),box=await handle.boundingBox();assert.ok(box);await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+dx,box.y+box.height/2+dy,{steps:8});await page.mouse.up();await saved();};
 const before=clone(value());await drag('part-move',22,-12);const moved=clone(value());assert.ok(moved.assetParts[0].x>before.assetParts[0].x);await drag('part-resize',18,14);const resized=clone(value());assert.ok(resized.assetParts[0].w>moved.assetParts[0].w);
 for(const key of ['text','assetContour','tail','textBox','x','y','w','h'])assert.deepEqual(resized[key],before[key]);
 await page.locator('#undo').click();await saved();assert.deepEqual(value().assetParts,moved.assetParts);await page.locator('#redo').click();await saved();assert.deepEqual(value().assetParts,resized.assetParts);
 await page.locator('[data-bubble-inspector-tab="frame"]').click();await page.locator('[data-inspector-section="bubble-part-0"]>summary').click();const field=page.locator('[data-section="bubble-part-0"][data-field="w"]');await field.fill('68');await field.press('Tab');await saved();assert.equal(value().assetParts[0].w,.68);
 await page.screenshot({path:path.join(evidence,'02_双圆上框独立编辑.png')});const final=clone(value());await page.reload();await saved();await select();assert.deepEqual(value().assetParts,final.assetParts);
 await page.locator('[data-action="bubble-choose-material"]').click();assert.equal(await page.locator('[data-bubble-material^="builtin-"]').count(),5);await page.locator('[data-bubble-material="builtin-oval"]').click();await page.locator('#modal').waitFor({state:'hidden'});await saved();assert.equal(value().comicStyleId,'builtin-oval');assert.equal(value().assetParts,undefined);
 await page.locator('[data-rail-tab="production"]').click();await action('/production/unit',()=>page.locator('[data-production-unit]').selectOption('panel'));
 await page.waitForFunction(()=>document.querySelector('.panel-active-prompt')?.value==='单格无泡原文');assert.equal(await page.locator('[data-production-mode]').inputValue(),'post-lettering');
 await action('/production/mode',()=>page.locator('[data-production-mode]').selectOption('imported'));await page.waitForFunction(()=>document.querySelector('.panel-active-prompt')?.value==='单格空泡原文');
 await page.reload();await saved();assert.equal(await page.locator('[data-production-mode]').inputValue(),'imported');assert.equal(studio.store.db.jobs.length,0);assert.deepEqual(errors,[]);
 fs.writeFileSync(path.join(evidence,'browser-report.json'),JSON.stringify({ok:true,builtinCount:5,offlineSelection:true,previewsDecoded:true,independentUpperMove:true,independentUpperResize:true,numericWidth:true,undoRedo:true,saveReload:true,lockedSkipped:true,screenDefaultClean:true,panelDefaultClean:true,manualModePreserved:true,realProjectsModified:false,realGeneration:false,errors},null,2));
});
