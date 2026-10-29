import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createProject,makePage,id,clone,layoutLongStrip} from '../public/model.js';
import {ensureEpisodeBoards,resolveBoard,validateEpisodeBoards,boardSvg,paintEpisodeBoard,boardImageTransform} from '../public/episode-boards.js';
import {episodeExportLayout} from '../public/episode-board-export.js';
import {canvasEpisodeBoards} from '../public/episode-board-canvas.js';
import {planEpisodeBoardTransition,imageBoardsForTransition} from '../public/episode-board-transitions.js';
import {createStudio} from '../server.mjs';
const require=createRequire(import.meta.url),modules=process.env.COMIC_TEST_NODE_MODULES;
const native=require(process.env.COMIC_TEST_CANVAS_MODULE);
const proof=path.resolve('../.runtime/verification/fixed-image-frames');fs.mkdirSync(proof,{recursive:true});
const fixture=()=>{const p=createProject('固定图片格子合成测试');p.pages[0].storyboard={episode:1};p.pages[0].height=500;ensureEpisodeBoards(p);return p;};
const picture=(w,h,color)=>{const c=native.createCanvas(w,h),x=c.getContext('2d');x.fillStyle=color;x.fillRect(0,0,w,h);x.fillStyle='#fff';x.fillRect(0,0,w/3,h/3);return c.toBuffer('image/png');};

test('旧封面尾图保留底图和可见尺寸，移除模板文字及额外渐变，不修改正文',()=>{
 const p=fixture(),asset={id:id('asset'),width:1000,height:1573};p.assets=[asset];for(const kind of ['cover','tail'])p.episodeBoards.templates[kind].backgroundAssetId=asset.id;const before=clone(p);
 for(const kind of ['cover','tail']){const b=resolveBoard(p,kind,1);assert.equal(b.height,2013);assert.deepEqual(b.layers,[]);assert.equal(b.backgroundAssetId,asset.id);assert.equal(planEpisodeBoardTransition(p,layoutLongStrip(p.pages),b),null);assert.doesNotMatch(boardSvg(b,null,{assetUrl:()=>'/asset.png',controls:false}),/<text|data-board-transition/);}
 assert.equal(imageBoardsForTransition(p).length,0);assert.equal(episodeExportLayout(p).height,4526);assert.equal(canvasEpisodeBoards(p,p.pages[0]).cover.page.height,2013);assert.deepEqual(p,before);validateEpisodeBoards(p);
});
test('取景持久化、单话隔离、清空不回退共用图，替换不同宽高比不改变格子',()=>{
 const p=fixture(),a={id:id('asset'),width:1000,height:1500},b={id:id('asset'),width:1200,height:400};p.assets=[a,b];p.episodeBoards.templates.cover.backgroundAssetId=a.id;
 const frame=p.episodeBoards.episodes[1]={cover:{useOwnBackground:true,backgroundAssetId:b.id,frameHeight:1800,imageFit:'cover',imageTransform:{...boardImageTransform(),x:100,y:-40,scale:1.5,rotation:90,flipX:true}}};
 validateEpisodeBoards(p);assert.equal(resolveBoard(p,'cover',1).height,1800);assert.equal(resolveBoard(p,'cover',2).backgroundAssetId,a.id);assert.deepEqual(resolveBoard(JSON.parse(JSON.stringify(p)),'cover',1).imageTransform,frame.cover.imageTransform);
 frame.cover.backgroundAssetId=null;assert.equal(resolveBoard(p,'cover',1).backgroundAssetId,null);assert.equal(resolveBoard(p,'cover',1).height,1800);
 frame.cover.imageTransform.scale=NaN;assert.throws(()=>validateEpisodeBoards(p),/取景/);frame.cover.imageTransform.scale=1;frame.cover.frameHeight=-1;assert.throws(()=>validateEpisodeBoards(p),/高度/);
});
test('SVG预览与PNG导出使用相同的缩放、位移、旋转、镜像和裁切',async t=>{
 const {chromium}=require(path.join(modules,'playwright')),browser=await chromium.launch({channel:'msedge',headless:true}),page=await browser.newPage();t.after(()=>browser.close());
 const png=picture(320,160,'#c93745'),image=await native.loadImage(png),p=fixture(),asset={id:id('asset'),width:320,height:160};p.assets=[asset];
 for(const fit of ['contain','cover'])for(const rotation of [0,90,-35]){
  p.episodeBoards.episodes[1]={cover:{useOwnBackground:true,backgroundAssetId:asset.id,frameHeight:400,imageFit:fit,imageTransform:{...boardImageTransform(),x:120,y:-30,rotation,scale:1.2,flipX:true,flipY:rotation===90}}};const b=resolveBoard(p,'cover',1),svg=boardSvg(b,null,{controls:false,assetUrl:()=>`data:image/png;base64,${png.toString('base64')}`});
  const rendered=await page.evaluate(async svg=>{const image=new Image();image.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);await image.decode();const c=document.createElement('canvas');c.width=1280;c.height=400;c.getContext('2d').drawImage(image,0,0,1280,400);return c.toDataURL();},svg);const preview=await native.loadImage(rendered),a=native.createCanvas(1280,400),c=native.createCanvas(1280,400);a.getContext('2d').drawImage(preview,0,0,1280,400);await paintEpisodeBoard(c.getContext('2d'),b,{imageLoader:async()=>image});
  // Compare interior pixels, allowing different antialiasing along transformed edges.
  let mismatches=0,total=0;for(let y=20;y<380;y+=19)for(let x=20;x<1260;x+=23){const l=a.getContext('2d').getImageData(x,y,1,1).data,r=c.getContext('2d').getImageData(x,y,1,1).data;if(l.some((v,i)=>Math.abs(v-r[i])>12))mismatches++;total++;}assert.ok(mismatches/total<.02,JSON.stringify({fit,rotation,mismatches,total}));
 }
});

test('真实编辑页：上传封面、粘贴尾图、墨库换图、拖动与撤销重做、保存刷新、导出',{timeout:120000},async t=>{
 const data=fs.mkdtempSync(path.join(proof,'data-')),fake={status:async()=>({connected:false}),models:async()=>({items:[]}),close(){},ensurePoolSize(){}};
 Object.assign(process.env,{COMIC_TEAM_CHANNEL_FILE:path.join(data,'no-team.json'),COMIC_TEAM_IDENTITY_ROOT:data,COMIC_LIBRARY_CONFIG:path.join(data,'no-moku.json')});
 const studio=createStudio({dataDir:data,bridge:fake,jimengBridge:fake,seedReference:false});await new Promise(r=>studio.server.listen(0,'127.0.0.1',r));let browser;
 t.after(async()=>{await browser?.close();studio.close();studio.server.closeAllConnections();await new Promise(r=>studio.server.close(r));});
 const project=fixture();project.pages.push({...makePage([], 'overlay',1280,500),storyboard:{episode:2}});let originalPages;studio.store.db.projects.push(project);studio.store.save();
 const origin='http://127.0.0.1:'+studio.server.address().port,read=async()=>{const r=await fetch(origin+'/api/projects/'+project.id);assert.equal(r.status,200);return r.json();};
 const cover=picture(600,900,'#c93745'),tail=picture(600,400,'#2466c6'),replacement=picture(400,800,'#25aa58'),coverFile=path.join(proof,'synthetic-cover.png');fs.writeFileSync(coverFile,cover);
 const {chromium}=require(path.join(modules,'playwright'));browser=await chromium.launch({channel:'msedge',headless:true});const context=await browser.newContext({viewport:{width:1864,height:949}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await context.route('**/*',route=>['127.0.0.1','localhost'].includes(new URL(route.request().url()).hostname)||['data:','blob:'].includes(new URL(route.request().url()).protocol)?route.continue():route.abort());
 await page.addInitScript(encoded=>Object.defineProperty(navigator,'clipboard',{value:{read:async()=>[{types:['image/png'],getType:async()=>new Blob([Uint8Array.from(atob(encoded),c=>c.charCodeAt(0))],{type:'image/png'})}]},configurable:true}),tail.toString('base64'));
 await page.goto(origin+'/?project='+project.id);const saved=async()=>{await page.waitForTimeout(450);await page.waitForFunction(()=>document.querySelector('#save-state').textContent==='已保存到本机');};await saved();originalPages??=clone((await read()).pages);await page.locator('[data-rail-tab="pages"]').click();await page.locator('#zoom').selectOption('0.25');await page.locator('[data-episode-board="cover"]').click();
 assert.match(await page.locator('#inspector-kind').textContent(),/封面.*固定格子/);assert.equal(await page.locator('[data-board-meta],[data-board-style],[data-board-episode],[data-board-text],[data-board-own-background]').count(),0);
 const chooser=page.waitForEvent('filechooser');await page.locator('[data-board-upload]').click();await(await chooser).setFiles(coverFile);await page.locator('[data-board-image="scale"]').waitFor();await saved();let p=await read(),b=resolveBoard(p,'cover',1,studio.store.db.assets),coverId=b.backgroundAssetId;assert.ok(coverId);assert.equal(b.height,1800);assert.equal(resolveBoard(p,'cover',2).backgroundAssetId,null);assert.deepEqual(fs.readFileSync(studio.store.assetPath(coverId)),cover);
 const saveChange=async(action)=>{const response=page.waitForResponse(r=>r.url()===origin+'/api/projects/'+project.id&&r.request().method()==='PUT');await action();assert.equal((await response).status(),200);await saved();};
 await saveChange(async()=>{await page.locator('[data-board-image="scale"]').fill('150');await page.locator('[data-board-image="scale"]').blur();});
 await saveChange(()=>page.locator('[data-board-action="flipX"]').click());await saveChange(()=>page.locator('[data-board-action="right"]').click());
 await page.locator('[data-episode-board="cover"]').click();const hit=page.locator('#stage [data-fixed-board="cover"] [data-board-layer="image"]');await hit.evaluate(el=>el.scrollIntoView({block:'center'}));await page.waitForTimeout(150);const box=await hit.boundingBox(),x=box.x+box.width*.55,y=Math.max(210,box.y+box.height*.4);const beforeMove=resolveBoard(await read(),'cover',1).imageTransform;
 await saveChange(async()=>{await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+24,y+16,{steps:6});await page.mouse.up();});
 const moved=resolveBoard(await read(),'cover',1).imageTransform;assert.ok(Math.abs(moved.x-beforeMove.x-96)<1);assert.ok(Math.abs(moved.y-beforeMove.y-64)<1);
 await page.evaluate(()=>document.activeElement?.blur());await saveChange(()=>page.keyboard.press('Control+z'));assert.deepEqual(resolveBoard(await read(),'cover',1).imageTransform,beforeMove);await saveChange(()=>page.keyboard.press('Control+Shift+z'));assert.deepEqual(resolveBoard(await read(),'cover',1).imageTransform,moved);
 await page.locator('[data-episode-board="tail"]').click();await page.locator('[data-board-paste]').click();await page.locator('[data-board-image="scale"]').waitFor();await saved();let tailId=resolveBoard(await read(),'tail',1).backgroundAssetId;assert.ok(tailId);assert.deepEqual(fs.readFileSync(studio.store.assetPath(tailId)),tail);assert.equal(resolveBoard(await read(),'tail',1,studio.store.db.assets).height,1800);
 const imported=await(await fetch(origin+'/api/episode-board-images',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({projectId:project.id,name:'moku-test.png',dataBase64:replacement.toString('base64')})})).json();const asset=imported.asset||imported;
 await page.route('**/api/library/assets?*',route=>route.fulfill({json:{items:[{id:'moku-test',name:'测试尾图.png',category:'header',mime:'image/png',recommendedRevisionId:'test-version',tags:[]}]}}));await page.route('**/api/library/import',route=>route.fulfill({json:{kind:'image',asset}}));await page.route('**/api/library/revisions/**',route=>route.fulfill({contentType:'image/png',body:replacement}));
 await page.locator('[data-board-background]').click();await page.locator('#library-refresh').click();await saveChange(()=>page.locator('[data-library-use="image"]').click());p=await read();assert.equal(resolveBoard(p,'tail',1).backgroundAssetId,asset.id);assert.equal(resolveBoard(p,'tail',1,studio.store.db.assets).height,1800);assert.equal(resolveBoard(p,'tail',2).backgroundAssetId,null);
 await saveChange(()=>page.locator('[data-board-action="clear"]').click());assert.equal(resolveBoard(await read(),'tail',1).backgroundAssetId,null);assert.equal(resolveBoard(await read(),'tail',1).height,1800);await page.evaluate(()=>document.activeElement?.blur());await saveChange(()=>page.keyboard.press('Control+z'));
 await saveChange(async()=>{await page.locator('[data-board-height]').fill('1200');await page.locator('[data-board-height]').blur();});assert.equal(resolveBoard(await read(),'tail',1).height,1200);assert.equal(resolveBoard(await read(),'cover',1,studio.store.db.assets).height,1800);
 await page.locator('[data-episode-board="cover"]').click();await saveChange(async()=>{await page.locator('[data-board-height]').fill('2400');await page.locator('[data-board-height]').blur();});assert.equal(resolveBoard(await read(),'cover',1).height,2400);assert.deepEqual(resolveBoard(await read(),'cover',1).imageTransform,moved);assert.equal(resolveBoard(await read(),'cover',2).height,1800);
 await page.evaluate(()=>document.activeElement?.blur());await saveChange(()=>page.keyboard.press('Control+z'));assert.equal(resolveBoard(await read(),'cover',1).height,1800);await saveChange(()=>page.keyboard.press('Control+Shift+z'));assert.equal(resolveBoard(await read(),'cover',1).height,2400);
 await page.locator('[data-board-height]').fill('0');await page.locator('[data-board-height]').blur();assert.equal(await page.locator('[data-board-height]').inputValue(),'2400');assert.equal(resolveBoard(await read(),'cover',1).height,2400);
 await page.reload();await saved();originalPages??=clone((await read()).pages);await page.locator('[data-rail-tab="pages"]').click();await page.locator('[data-episode-board="cover"]').click();assert.equal(await page.locator('[data-board-height]').inputValue(),'2400');assert.equal(await page.locator('[data-board-image="scale"]').inputValue(),'150');assert.equal(await page.locator('[data-board-image="rotation"]').inputValue(),'90');await page.screenshot({path:path.join(proof,'cover-fixed-frame.png')});
 await page.locator('#export-toggle').click();const download=page.waitForEvent('download');await page.locator('#export-page').click();await(await download).saveAs(path.join(proof,'cover-export.png'));const png=await native.loadImage(path.join(proof,'cover-export.png'));assert.equal(png.width,1280);assert.equal(png.height,2400);
 await page.locator('[data-episode-board="tail"]').click();assert.equal(await page.locator('[data-board-height]').inputValue(),'1200');await page.screenshot({path:path.join(proof,'tail-fixed-frame.png')});p=await read();assert.deepEqual(p.pages,originalPages);assert.deepEqual(errors,[]);assert.equal(studio.store.db.jobs.length,0);validateEpisodeBoards(p);
 fs.writeFileSync(path.join(proof,'acceptance.json'),JSON.stringify({ok:true,upload:true,paste:true,mokuSelection:true,fixedSize:true,episodeIsolation:true,drag:true,undoRedo:true,refresh:true,exportPNG:true,bodyUnchanged:true,realAI:false,errors},null,2));
});

