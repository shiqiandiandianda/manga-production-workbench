import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {episodeBubbleFitPlan as planFromSelected,episodeBubbleFitMessage,applyDialogueTemplate} from '../public/episode-bubble-fit.js';
import {bubbleLayout,normalizeBubbleStyle} from '../public/lettering.js';
const episodeBubbleFitPlan=(ctx,p,pg)=>planFromSelected(ctx,p,pg,pg.bubbles[0]);
import {createProject,id} from '../public/model.js';
import {createStudio} from '../server.mjs';
import {applyBubbleMaterial} from '../public/bubble-material.js';
import {addDialogueSegment} from '../public/bubble-dialogue-segments.js';
const require=createRequire(import.meta.url),root=path.resolve(import.meta.dirname,'../..');
const {createCanvas}=require(process.env.COMIC_TEST_CANVAS_MODULE||root+'/runtime/node/node_modules/@napi-rs/canvas');
const ctx=createCanvas(1280,1000).getContext('2d'),proof=root+'/verification/episode-bubble-fit-20261029';fs.mkdirSync(proof,{recursive:true});
function fixture(){
 const p=createProject('本话气泡适配 · 合成验收',true),original=p.pages[0],base=original.bubbles[0];
 const bubble=(text,extra={})=>({...structuredClone(base),id:id('bubble'),parentPanelId:undefined,shotId:'',x:140,y:120,w:90,h:45,text,type:'speech',shape:'oval',fontSize:32,visible:true,locked:false,tail:{visible:true,side:'bottom',base:.54},textBox:{x:4,y:4,w:40,h:30},...extra});
 const page=(episode,bubbles)=>({...structuredClone(original),id:id('page'),name:'第'+episode+'话',storyboard:{episode,projection:'manual'},panels:[],bubbles,height:1500});
 p.pages=[page(41,[bubble('招供说他只是拿钱办事，不知道幕后主使。'),bubble('这是已经锁定的气泡。',{locked:true,y:400}),bubble('隐藏气泡',{visible:false,y:600}),bubble('无框文字',{shape:'none',y:700}),bubble('   ',{y:800})]),page(41,[bubble('另一屏也要按自己的字号和文字适配。',{fontSize:40}),bubble('短句。',{y:500,shape:'rounded-rect',type:'caption'})]),page(42,[bubble('第42话保持原样。')])];
 const source=p.pages[0].bubbles[0];Object.assign(source,{w:360,h:220,text:'嘿嘿，你姐我穿啥都漂亮！',fontSize:35.427283418,fontFamily:'source-han-serif',fontWeight:600,lineHeight:1.3333333333,textBox:{x:60,y:60,w:240,h:100}});
 p.pages[0].bubbles.push(bubble('茜姐，你换上这身衣服真漂亮。',{x:650,y:160}));
 p.typography={fontFamily:'source-han-sans',fontSize:36,lineHeight:1.3333333333};
 p.layerOrder=p.pages.flatMap(pg=>pg.bubbles.map(b=>b.id));return p;
}
test('仅当前话按选中样板跨屏应用，保护样板、锁定、隐藏、空白及无框文字',()=>{
 const p=fixture(),before=structuredClone(p),result=episodeBubbleFitPlan(ctx,p,p.pages[0]);
 assert.equal(result.changes.length,2);assert.equal(result.episode,41);assert.equal(result.locked,1);assert.equal(result.hidden,1);assert.equal(result.empty,1);assert.equal(result.unsupported,2);assert.equal(result.overflow,0);assert.deepEqual(p,before);
 for(const c of result.changes){const pg=p.pages.find(x=>x.id===c.pageId),b=pg.bubbles.find(x=>x.id===c.bubble.id);assert.deepEqual(c.bubble,applyDialogueTemplate(ctx,b,p.pages[0].bubbles[0],{maxWidth:pg.width*2}));for(const key of ['text','x','y','tail','speaker'])assert.deepEqual(c.bubble[key],b[key]);assert.deepEqual(normalizeBubbleStyle(c.bubble),normalizeBubbleStyle(p.pages[0].bubbles[0]));assert.equal(c.bubble.textBox.w,240);pg.bubbles[pg.bubbles.indexOf(b)]=c.bubble;}
 assert.deepEqual(p.pages[0].bubbles[0],before.pages[0].bubbles[0]);assert.equal(episodeBubbleFitPlan(ctx,p,p.pages[0]).changes.length,0);assert.deepEqual(p.pages[2],before.pages[2]);assert.match(episodeBubbleFitMessage(result),/第41话.*当前气泡和字体.*2 个对白气泡.*一次撤销/);
 p.pages[1].locked=true;assert.equal(episodeBubbleFitPlan(ctx,p,p.pages[0]).locked,3);
});
test('只允许对白气泡，旁白、心声、人名、系统、特效和未知类型保持原样',()=>{
 const p=fixture(),pg=p.pages[0],base=pg.bubbles[0];
 pg.bubbles=['speech','caption','thought','label','system','sfx','unknown',undefined].map(type=>({...structuredClone(base),id:id('bubble'),type}));p.pages=[pg];
 const before=structuredClone(p),result=episodeBubbleFitPlan(ctx,p,pg);
 assert.equal(result.changes.length,0);assert.equal(result.unchanged,1);assert.equal(result.unsupported,7);assert.deepEqual(p,before);
});
test('所属画格锁定与空话不产生修改',()=>{
 const p=fixture(),pg=p.pages[0],panel={id:id('panel'),locked:true};pg.panels=[panel];pg.bubbles=[pg.bubbles[0]];pg.bubbles[0].parentPanelId=panel.id;
 assert.equal(episodeBubbleFitPlan(ctx,p,pg).locked,1);
 pg.bubbles=[];p.pages[1].bubbles=[];assert.throws(()=>episodeBubbleFitPlan(ctx,p,pg),/选中/);
});

test('素材样板完整复制，清掉目标旧素材和排字缓存，长台词与竖排可撑开，多段跳过',()=>{
 const p=fixture(),pg=p.pages[0],original=pg.bubbles.at(-1);pg.bubbles[0]=applyBubbleMaterial(pg.bubbles[0],'builtin-oval');
 const source=pg.bubbles[0];source.outlineWidth=4;source.fillColor='#ffeeee';original.textLayout={version:1,lines:[]};original.textFrameLayout=true;original.productionTextId='T-target';original.speaker='目标人物';
 const fitted=applyDialogueTemplate(ctx,original,source);
 for(const key of ['assetContour','assetInsets','comicStyleId','comicStyleLabel','outlineWidth','fillColor'])assert.deepEqual(fitted[key],source[key]);
 assert.equal(fitted.textLayout,undefined);assert.equal(fitted.textFrameLayout,undefined);assert.equal(fitted.productionTextId,'T-target');assert.equal(fitted.speaker,'目标人物');assert.equal(fitted.text,original.text);
 const plain={...source,shape:'oval'};for(const key of ['assetContour','assetInsets','comicStyleId','comicStyleLabel'])delete plain[key];const clean=applyDialogueTemplate(ctx,fitted,plain);assert.equal(clean.assetContour,undefined);assert.equal(clean.comicStyleId,undefined);
 const long={...original,text:'这是一段很长的对白，按照当前样板的字体和框宽排字，自动增高，保留每一句台词和原始出处。'.repeat(3)},grown=applyDialogueTemplate(ctx,long,source);assert.ok(grown.h>source.h);assert.equal(grown.w,source.w);assert.equal(bubbleLayout(ctx,grown).overflow,false);
 const vertical={...plain,writingMode:'vertical',w:240,h:360,textBox:{x:60,y:60,w:100,h:240}},columns=applyDialogueTemplate(ctx,long,vertical);assert.equal(columns.h,360);assert.ok(columns.w>240);assert.equal(bubbleLayout(ctx,columns).overflow,false);
 const double=addDialogueSegment(applyBubbleMaterial({...original,id:id('bubble')},'builtin-double'),'第二段');pg.bubbles.push(double);assert.equal(episodeBubbleFitPlan(ctx,p,pg).unsupported,3);assert.throws(()=>planFromSelected(ctx,p,pg,double),/单段/);
});
test('浏览器一键跨屏适配、一次撤销重做、保存刷新、重复点击不增加历史',{timeout:90000},async t=>{
 const dir=fs.mkdtempSync(proof+'/browser-');Object.assign(process.env,{COMIC_PROJECT_SYNC:'0',COMIC_TEAM_AUTO_SYNC:'0',COMIC_LIBRARY_CONFIG:dir+'/offline.json',COMIC_SLOT_DIR:dir+'/slots'});fs.writeFileSync(process.env.COMIC_LIBRARY_CONFIG,'{"base":"http://127.0.0.1:9"}');
 const fake={close(){},status:async()=>({connected:false}),generate(){assert.fail('不得生图');}},studio=createStudio({dataDir:dir,seedReference:false,bridge:fake,jimengBridge:fake});await new Promise(r=>studio.server.listen(0,'127.0.0.1',r));let browser;t.after(async()=>{await browser?.close();studio.close();studio.server.closeAllConnections();});
 const p=fixture();studio.store.db.projects.push(p);studio.store.save();const current=()=>studio.store.project(p.id),first=()=>current().pages[0].bubbles.at(-1);
 const {chromium}=require(process.env.COMIC_TEST_PLAYWRIGHT_MODULE||path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
 browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:1864,height:949}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/api/library/**',r=>r.fulfill({json:{connected:false,items:[]}}));
 await page.goto('http://127.0.0.1:'+studio.server.address().port+'/?project='+p.id);await page.locator('#canvas-tool-dock').waitFor();await page.locator('[data-rail-tab="layers"]').click();
 await page.locator('#layer-list [data-layer="'+p.pages[0].bubbles[0].id+'"]').evaluate(n=>n.click());
 const button=page.locator('[data-action="episode-bubble-fit-text"]');await button.waitFor();await page.waitForFunction(()=>document.querySelector('#save-state')?.textContent==='已保存到本机');
 const before=structuredClone(current().pages),until=async fn=>{for(let n=0;n<160;n++){if(fn())return;await new Promise(r=>setTimeout(r,50));}assert.fail('保存结果等待超时');};
 await button.click();await until(()=>first().w!==before[0].bubbles.at(-1).w);const after=structuredClone(current().pages);
 assert.notEqual(after[1].bubbles[0].w,before[1].bubbles[0].w);assert.deepEqual(after[1].bubbles[1],before[1].bubbles[1],'旁白完整保留');assert.deepEqual(after[0].bubbles.slice(0,-1),before[0].bubbles.slice(0,-1));assert.deepEqual(after[2],before[2]);
 await page.locator('#undo').click();await until(()=>first().w===before[0].bubbles.at(-1).w);assert.deepEqual(current().pages,before);
 await page.locator('#redo').click();await until(()=>first().w===after[0].bubbles.at(-1).w);assert.deepEqual(current().pages,after);
 await button.click();await page.waitForTimeout(650);await page.locator('#undo').click();await until(()=>first().w===before[0].bubbles.at(-1).w);assert.deepEqual(current().pages,before,'重复适配不增加无效撤销步骤');
 await page.locator('#redo').click();await until(()=>first().w===after[0].bubbles.at(-1).w);await page.reload();await page.locator('#canvas-tool-dock').waitFor();assert.deepEqual(current().pages,after);
 await page.locator('[data-rail-tab="layers"]').click();await page.locator('#layer-list [data-layer="'+p.pages[0].bubbles[0].id+'"]').evaluate(n=>n.click());await button.waitFor();
 assert.equal(await page.locator('[data-section="bubble"][data-field="fontSize"]').inputValue(),'35.43');
 await page.screenshot({path:proof+'/episode-bubble-fit.png'});assert.equal(studio.store.db.jobs.length,0);assert.deepEqual(errors,[]);
 await page.locator('#page-marker').click();await page.locator('#page-type-lineHeight').waitFor();
 assert.equal(await page.locator('#page-type-lineHeight').inputValue(),'1.33');assert.equal(await page.locator('.typography-note').count(),0);assert.equal(await page.locator('.frame-selection-note').count(),0);
 assert.equal(current().typography.lineHeight,1.3333333333);assert.deepEqual(current().pages,after);
 for(const viewport of [{width:1920,height:1000},{width:1280,height:760}]){await page.setViewportSize(viewport);await page.screenshot({path:proof+'/page-settings-'+viewport.width+'.png'});}
 fs.writeFileSync(proof+'/browser-result.json',JSON.stringify({ok:true,episode:41,otherEpisodePreserved:true,captionPreserved:true,oneUndo:true,redo:true,reload:true,idempotent:true,realGeneration:false,errors},null,2));
});
