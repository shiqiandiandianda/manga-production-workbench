import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createProject,id,clone,panel,rectangle} from '../public/model.js';
import {migrateLayerDocument} from '../public/layers.js';
import {ensureEpisodeBoards,resolveBoard,boardContext,boardTextLayout,boardAssetIds,remapBoardAssets,validateEpisodeBoards} from '../public/episode-boards.js';
import {episodeExportLayout} from '../public/episode-board-export.js';
import {readEpisodeOutline,createEpisodeBoardSharing} from '../lib/episode-boards.mjs';
import {renderStripSegment,exportEpisode} from '../public/render.js';
import {createStudio} from '../server.mjs';
import {writeXlsx} from '../lib/xlsx.mjs';


const require=createRequire(import.meta.url),runtime=path.resolve((process.env.CODEX_TEST_NODE_MODULES || 'node_modules')),canvas=require(path.join(runtime,'@napi-rs/canvas'));
const qaRoot=path.resolve('../verification/inline-boards-20261022'),output=path.join(qaRoot,'evidence');fs.mkdirSync(output,{recursive:true});
const outline={version:1,sourceKey:'synthetic-outline',workTitle:'合成测试漫画',episodes:[{episode:11,title:'长生会与两个月后的消息'},{episode:14,title:'第一战'},{episode:15,title:'第二战'},{episode:21,title:'终局'}]};
const fixture=(number=14)=>{const p=migrateLayerDocument(createProject('合成测试漫画')).project;p.pages[0].storyboard={episode:number};p.pages[0].height=500;p.pages[0].panels=[];p.shots=[];p.layerOrder=[];p.episodeOutline=clone(outline);ensureEpisodeBoards(p);return p;};

test('细纲优先、中文话数、自动下一话以及单话修改 / 恢复',()=>{
 const parsed=readEpisodeOutline([{name:'交付总览',table:[['《合成作品》'],['话数','话名'],[14,'旧名字']]},{name:'分话细纲',table:[['话数','话名'],['第十四话','第一战'],[15,'第二战'],[21,'终局']]}],{fileKey:'hash',sheet:'第十四话'});
 assert.equal(parsed.workTitle,'合成作品');assert.equal(parsed.currentEpisode,14);assert.equal(parsed.episodes[0].title,'第一战');
 const p=fixture();p.episodeOutline=parsed;assert.equal(resolveBoard(p,'cover',14).layers[2].text,'第一战');assert.equal(resolveBoard(p,'tail',14).layers[2].text,'第二战');
 p.episodeBoards.episodes[14]={episodeTitle:'本话改名',nextEpisodeTitle:'手填下话',episodeNumber:30};assert.equal(boardContext(p,14).episodeTitle,'本话改名');assert.equal(boardContext(p,15).episodeTitle,'第二战');assert.equal(resolveBoard(p,'tail',14).layers[0].text,'第 30 话 完');
 delete p.episodeBoards.episodes[14].episodeTitle;assert.equal(boardContext(p,14).episodeTitle,'第一战');assert.equal(boardContext(p,21).nextMissing,true);validateEpisodeBoards(p);
});

test('长话名缩小 / 换行 / 竖排共用测量，独立底图与工程资产映射',()=>{
 const p=fixture(11),ctx=canvas.createCanvas(100,100).getContext('2d'),title=resolveBoard(p,'cover',11).layers[2];const small=boardTextLayout(ctx,title);assert.ok(small.fontSize<title.fontSize);assert.ok(small.fits);
 const wrapped=boardTextLayout(ctx,{...title,fit:'wrap',h:500});assert.equal(wrapped.fontSize,title.fontSize);assert.ok(wrapped.glyphs.length>=2);
 const vertical=boardTextLayout(ctx,{...title,writingMode:'vertical',fit:'wrap',h:500,w:500});assert.ok(vertical.glyphs.length>=title.text.length);assert.ok(vertical.glyphs.every(g=>g.x>=title.x&&g.x<=title.x+500));
 const common=id('asset'),own=id('asset');p.episodeBoards.templates.cover.backgroundAssetId=common;p.episodeBoards.episodes[11]={cover:{useOwnBackground:true,backgroundAssetId:own}};
 assert.equal(resolveBoard(p,'cover',11).backgroundAssetId,own);assert.equal(resolveBoard(p,'cover',14).backgroundAssetId,common);assert.deepEqual(new Set(boardAssetIds(p)),new Set([common,own]));
 const nextCommon=id('asset'),nextOwn=id('asset');remapBoardAssets(p,new Map([[common,nextCommon],[own,nextOwn]]));assert.equal(resolveBoard(p,'cover',11).backgroundAssetId,nextOwn);validateEpisodeBoards(p);
 p.episodeBoards.templates.cover.layers[0].fontSize=NaN;assert.throws(()=>validateEpisodeBoards(p),/文字外观/);
});

test('共用模板跨同一作品生效，单话覆盖保留',()=>{
 const a=fixture(14),b=fixture(11);b.episodeBoards.episodes[11]={episodeTitle:'这话单独改'};const store={db:{projects:[a,b]}},sharing=createEpisodeBoardSharing(store);const next=sharing.view(a);next.episodeBoards.templates.cover.background='#334455';sharing.accept(a,next);
 assert.equal(sharing.view(b).episodeBoards.templates.cover.background,'#334455');assert.equal(boardContext(sharing.view(b),11).episodeTitle,'这话单独改');assert.equal(b.revision,1);
});



test('多话与分散的同话画板只各加一组封面 / 尾图，按指定话数完整导出',()=>{
 const p=fixture(14),second=clone(p.pages[0]);second.id=id('page');second.storyboard.episode=15;const third=clone(p.pages[0]);third.id=id('page');p.pages.push(second,third);
 const all=episodeExportLayout(p);assert.deepEqual(all.episodeBoardParts.map(p=>p.kind),['cover','comic','comic','tail','cover','comic','tail']);const only=episodeExportLayout(p,{episode:14});assert.equal(only.height,4600);assert.deepEqual(only.episodeBoardParts.filter(p=>p.kind==='comic').map(p=>p.sourceY),[0,1000]);assert.equal(episodeExportLayout(p,{episode:21}).height,0);
});

test('封面、漫画、尾图按序合成，跨分段不移动漫画坐标，整话 PNG 包含模板',async()=>{
 const p=fixture();p.pages[0].background='#0055ff';p.episodeBoards.templates.cover.background='#ff3300';p.episodeBoards.templates.tail.background='#00cc55';for(const kind of ['cover','tail'])p.episodeBoards.templates[kind].layers.forEach(l=>l.visible=false);
 const before=clone(p),plan=episodeExportLayout(p);assert.equal(plan.height,4100);assert.deepEqual(plan.episodeBoardParts.map(p=>p.kind),['cover','comic','tail']);
 const factory=()=>{const c=canvas.createCanvas(1,1);c.toBlob=callback=>callback(new Blob([c.toBuffer('image/png')],{type:'image/png'}));return c;};
 const segment=await renderStripSegment(plan,{y:1750,height:700},{project:p,canvasFactory:factory});const ctx=segment.getContext('2d');assert.deepEqual([...ctx.getImageData(10,10,1,1).data],[255,51,0,255]);assert.deepEqual([...ctx.getImageData(10,300,1,1).data],[0,85,255,255]);assert.deepEqual([...ctx.getImageData(10,650,1,1).data],[0,204,85,255]);
 let downloaded;const result=await exportEpisode(p,()=>{},{canvasFactory:factory,download:(blob,name)=>downloaded={blob,name}});assert.equal(result.height,4100);assert.equal(result.parts,1);assert.match(downloaded.name,/整话\.png$/);fs.writeFileSync(path.join(output,'export-full-episode.png'),Buffer.from(await downloaded.blob.arrayBuffer()));assert.deepEqual(p,before);
});

test('模板真实界面：固定位置、底图、自动标题、单话改名恢复、拖动、字体与导出回读',{timeout:90000},async t=>{
 const {chromium}=require(path.join(runtime,'playwright'));const data=fs.mkdtempSync(path.join(qaRoot,'browser-data-'));
 const fake={status:async()=>({connected:false,message:'合成测试'}),close(){}};const studio=createStudio({dataDir:data,bridge:fake,jimengBridge:fake,storyboardGenerator:{close(){}}});let browser;
 await new Promise(resolve=>studio.server.listen(0,'127.0.0.1',resolve));t.after(async()=>{await browser?.close();studio.close();await new Promise(resolve=>studio.server.close(resolve));});
 const p=fixture(14),sibling=fixture(11);p.pages[0].panels=[panel('',0,0,1280,500)];p.layerOrder=p.pages[0].panels.map(f=>f.id);const lastPage=clone(p.pages[0]);Object.assign(lastPage,{id:id('page'),storyboard:{episode:21},panels:[],bubbles:[]});p.pages.push(lastPage);studio.store.db.projects.push(p,sibling);studio.store.save();
 const origin='http://127.0.0.1:'+studio.server.address().port;browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});const context=await browser.newContext({viewport:{width:1864,height:949}}),page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.stack));
 await context.route('**/*',route=>['127.0.0.1','localhost'].includes(new URL(route.request().url()).hostname)||['data:','blob:'].includes(new URL(route.request().url()).protocol)?route.continue():route.abort());
 await page.goto(origin+'/?project='+p.id);await page.waitForFunction(()=>document.querySelector('#save-state').textContent==='已保存到本机');await page.locator('[data-rail-tab="pages"]') .click();
 const order=await page.locator('#page-list>button').evaluateAll(nodes=>nodes.map(n=>n.dataset.episodeBoard||'comic'));assert.deepEqual(order,['cover','comic','tail']);
 await page.locator('[data-episode-board="cover"]').click();await page.locator('#zoom').selectOption('page');await page.locator('[data-board-meta="episodeTitle"]').fill('合成修改标题');await page.locator('[data-board-meta="episodeTitle"]').blur();await page.waitForFunction(()=>document.querySelector('#stage [data-fixed-board="cover"]')?.textContent.includes('合成修改标题'));assert.ok((await page.locator('.board-field-status.modified').count())>=1);
 await page.locator('[data-board-restore="episodeTitle"]').click();assert.equal(await page.locator('[data-board-meta="episodeTitle"]').inputValue(),'第一战');
 const background=canvas.createCanvas(1280,1800);const bg=background.getContext('2d');bg.fillStyle='#324b64';bg.fillRect(0,0,1280,1800);const backgroundPath=path.join(output,'synthetic-background.png');fs.writeFileSync(backgroundPath,background.toBuffer('image/png'));
 const registeredResponse=await fetch(origin+'/api/assets',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({filePath:backgroundPath})}),registered=await registeredResponse.json();
 await page.route('**/api/library/assets?*',route=>route.fulfill({json:{items:[{id:'moku-test',name:'封面底图.png',category:'header',mime:'image/png',recommendedRevisionId:'synthetic-version',tags:[]}]}}));
 await page.route('**/api/library/import',route=>route.fulfill({json:{kind:'image',asset:registered}}));await page.route('**/api/library/revisions/**',route=>route.fulfill({contentType:'image/png',body:background.toBuffer('image/png')}));
 await page.locator('[data-board-background]').click();await page.locator('#library-refresh').click();await page.locator('[data-library-use="image"]').click();await page.waitForFunction(()=>!!document.querySelector('#stage [data-fixed-board="cover"] image'));
 await page.locator('#stage [data-fixed-board="cover"] [data-board-layer="workTitle"]').scrollIntoViewIfNeeded();await page.waitForTimeout(150);assert.equal(await page.locator('#episode-board-editor').count(),0);const initialX=Number(await page.locator('[data-board-style="x"]').inputValue()),svgBox=await page.locator('#stage').boundingBox(),target=await page.locator('#stage [data-fixed-board="cover"] [data-board-layer="workTitle"]').boundingBox();
 await page.mouse.move(target.x+target.width/2,target.y+target.height/2);await page.mouse.down();await page.mouse.move(target.x+target.width/2+25,target.y+target.height/2+20,{steps:8});await page.mouse.up();assert.ok(Number(await page.locator('[data-board-style="x"]').inputValue())>initialX);
 await page.locator('[data-board-style="fontFamily"]').selectOption('source-han-serif');await page.locator('[data-board-style="writingMode"]').selectOption('vertical');await page.screenshot({path:path.join(output,'cover-template.png')});
 await page.locator('[data-episode-board="tail"]').click();assert.equal(await page.locator('[data-board-meta="nextEpisodeTitle"]').inputValue(),'第二战');await page.locator('[data-board-episode]').selectOption('21');await page.waitForFunction(()=>document.querySelector('#inspector-title').textContent.includes('第 21 话'));assert.equal(await page.locator('[data-board-meta="nextEpisodeTitle"]').inputValue(),'');assert.ok(await page.locator('.board-field-status.pending').count()>0);
 await page.locator('[data-board-meta="nextEpisodeTitle"]').fill('新篇章');await page.locator('[data-board-meta="nextEpisodeTitle"]').blur();await page.screenshot({path:path.join(output,'tail-template.png')});await page.waitForFunction(()=>document.querySelector('#save-state').textContent==='已保存到本机');
 const saved=studio.store.project(p.id);assert.equal(saved.episodeBoards.episodes[21].nextEpisodeTitle,'新篇章');assert.equal(boardContext(saved,14).nextEpisodeTitle,'第二战');assert.equal(saved.episodeBoards.templates.cover.layers[0].writingMode,'vertical');assert.equal(boardAssetIds(saved).length,1);
 await page.reload();await page.waitForFunction(()=>document.querySelector('#save-state').textContent==='已保存到本机');await page.locator('[data-rail-tab="pages"]') .click();await page.locator('[data-episode-board="cover"]').click();assert.equal(await page.locator('[data-board-style="writingMode"]').inputValue(),'vertical');
 await page.locator('#export-toggle').click();const filePromise=page.waitForEvent('download');await page.locator('#export-page').click();const file=await filePromise;await file.saveAs(path.join(output,'cover-export.png'));
 await page.locator('#project-trigger').click();await page.locator('[data-choose-project="'+sibling.id+'"]').click();await page.waitForFunction(key=>document.querySelector('#project-select').value===key,sibling.id);await page.waitForFunction(()=>document.querySelector('#episode-select').value==='11');await page.locator('[data-episode-board="cover"]').click();assert.equal(await page.locator('[data-board-style="writingMode"]').inputValue(),'vertical');assert.equal(await page.locator('[data-board-meta="episodeTitle"]').inputValue(),'长生会与两个月后的消息');
 for(const [width,height] of [[1024,768],[614,875],[375,667]]){await page.setViewportSize({width,height});await page.waitForTimeout(80);const size=await page.evaluate(()=>({width:innerWidth,scrollWidth:document.documentElement.scrollWidth}));assert.ok(size.scrollWidth<=size.width+1,JSON.stringify(size));}
 assert.deepEqual(errors,[]);assert.ok(fs.statSync(path.join(output,'cover-export.png')).size>10000);
});
