import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {bubbleInspectorMarkup} from '../public/bubble-inspector-markup.js';
import {applyBubbleMaterial} from '../public/bubble-material.js';
import {addDialogueSegment} from '../public/bubble-dialogue-segments.js';
import {createProject,id} from '../public/model.js';
import {migrateLayerDocument,normalizeLayerOrder} from '../public/layers.js';
import {createStudio} from '../server.mjs';

const require=createRequire(import.meta.url),root=path.resolve(import.meta.dirname,'../..');
const escape=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
const numberField=(label,key,value,section)=>`<label>${label}<input type="number" data-section="${section}" data-field="${key}" value="${value}"></label>`;
function fixture(){
 const p=migrateLayerDocument(createProject('气泡属性交互验证',true)).project,pg=p.pages[0];p.pages=[pg];pg.width=1280;pg.height=1400;pg.panels=[];
 const base={...pg.bubbles[0],parentPanelId:undefined,shotId:'',text:'第一段原文',x:140,y:140,w:460,h:420,fontSize:32,visible:true,locked:false};
 const double=applyBubbleMaterial(base,'builtin-double');
 const single={...base,id:id('bubble'),x:720,y:220,w:190,h:260,shape:'oval',text:'大人今日可有什么安排？',textBox:{x:20,y:70,w:260,h:110},productionOriginal:{文本:'大人今日可有什么安排？'},tail:{visible:false,side:'bottom',base:.54}};
 pg.bubbles=[double,single];normalizeLayerOrder(p);return p;
}
test('属性面板提供双圆新增入口，去掉坐标区和重复形状选择',()=>{
 const p=fixture(),pg=p.pages[0],b=pg.bubbles[0],before=structuredClone(b);
 const render=b=>bubbleInspectorMarkup(b,{escape,numberField,page:pg,project:p});
 const html=render(b);assert.match(html,/data-action="bubble-add-dialogue"/);assert.deepEqual(b,before);
 for(const item of [b,{...b,locked:true},addDialogueSegment(b,'第二段'),pg.bubbles[1]]){
  const markup=render(item);assert.doesNotMatch(markup,/精确位置与尺寸|独立文字框|尾尖精确坐标|基础轮廓|data-field="shape"|data-section="bubble-textbox"|data-section="bubble-part-\d/);
  assert.equal((markup.match(/data-bubble-style-grid/g)||[]).length,1);
 }
 assert.match(render({...b,locked:true}),/data-action="bubble-add-dialogue" disabled/);
 pg.locked=true;assert.match(render(b),/data-action="bubble-add-dialogue" disabled/);pg.locked=false;
 const two=render(addDialogueSegment(b,'第二段'));assert.doesNotMatch(two,/data-action="bubble-add-dialogue"/);assert.match(two,/data-section="bubble-segment-1"/);
 assert.doesNotMatch(render(pg.bubbles[1]),/data-action="bubble-add-dialogue"/);
});

test('真实页面新增双圆台词可保存撤销重开，适配保留可见尾巴',{timeout:60000},async t=>{
 const proof=path.join(root,'verification/bubble-inspector-redesign-20261030');fs.mkdirSync(proof,{recursive:true});
 const dataDir=fs.mkdtempSync(path.join(proof,'synthetic-'));
 const fake={status:async()=>({connected:false}),close(){},generate(){throw Error('No generation in inspector verification');}};
 const studio=createStudio({dataDir,seedReference:false,bridge:fake,jimengBridge:fake});let browser;
 t.after(async()=>{await browser?.close();studio.close();studio.server.closeAllConnections();await new Promise(r=>studio.server.close(r));});
 const p=fixture(),doubleId=p.pages[0].bubbles[0].id,singleId=p.pages[0].bubbles[1].id;studio.store.db.projects.push(p);studio.store.save();
 await new Promise(r=>studio.server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+studio.server.address().port;
 const {chromium}=require(process.env.COMIC_PLAYWRIGHT_PATH||'playwright');
 browser=await chromium.launch({headless:true,...(process.env.COMIC_TEST_BROWSER_EXECUTABLE?{executablePath:process.env.COMIC_TEST_BROWSER_EXECUTABLE}:{})});
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/library/**',r=>r.fulfill({json:{connected:false,items:[]}}));
 const stored=key=>studio.store.project(p.id).pages[0].bubbles.find(b=>b.id===key);
 const until=async fn=>{for(let i=0;i<160;i++){if(fn())return;await new Promise(r=>setTimeout(r,50));}assert.fail('等待保存超时');};
 const select=async key=>{if(!await page.locator('#layer-list').isVisible())await page.locator('[data-rail-tab="layers"]').click();await page.locator('#layer-list [data-layer="'+key+'"]').click();if(!await page.locator('#inspector-panel').isVisible())await page.locator('[data-properties-shortcut="toolbar"]').click();};
 await page.goto(origin+'/?project='+p.id);await page.locator('#canvas-tool-dock').waitFor();await select(doubleId);
 await page.locator('[data-action="bubble-add-dialogue"]').click();await until(()=>stored(doubleId).dialogueSegments?.length===2);
 assert.equal(stored(doubleId).dialogueSegments[0].text,'第一段原文');
 assert.equal(await page.locator('[data-action="bubble-add-dialogue"]').count(),0);
 await page.locator('#undo').click();await until(()=>!stored(doubleId).dialogueSegments?.length);
 await page.locator('#redo').click();await until(()=>stored(doubleId).dialogueSegments?.length===2);
 const second=page.locator('textarea[data-section="bubble-segment-1"]');await second.fill('新增的第二段台词');await second.press('Tab');await until(()=>stored(doubleId).dialogueSegments[1].text==='新增的第二段台词');
 assert.equal(stored(doubleId).dialogueSegments[0].text,'第一段原文');
 assert.equal(await page.locator('[data-bubble-handle="segment-move"]').count()>0,true);
 assert.equal(await page.locator('[data-bubble-handle="part-resize"]').count()>0,true);
 await page.reload();await page.locator('#canvas-tool-dock').waitFor();await select(doubleId);
 assert.equal(await second.inputValue(),'新增的第二段台词');
 assert.equal(await page.locator('[data-inspector-section="bubble-geometry"],[data-inspector-section="bubble-textbox"],[data-inspector-section="bubble-tail"],[data-field="shape"]').count(),0);
 await page.locator('#inspector-panel').screenshot({path:path.join(proof,'double-dialogue-panel.png')});
 await select(singleId);const before=structuredClone(stored(singleId));
 const tailVisible=()=>page.evaluate(async b=>{const {bubbleLayout}=await import('/lettering.js');const l=bubbleLayout(document.createElement('canvas').getContext('2d'),b);return !!l.tail&&l.drawOutline.some(p=>Math.hypot(p.x-l.tail.tip.x,p.y-l.tail.tip.y)<1e-5);},stored(singleId));
 assert.equal(await tailVisible(),true);await page.locator('[data-action="bubble-fit-current-layout"]').click();await until(()=>stored(singleId).w!==before.w&&stored(singleId).tail.visible===true);
 assert.equal(await tailVisible(),true);assert.equal(stored(singleId).text,before.text);
 const fitted=structuredClone(stored(singleId));await page.locator('#undo').click();await until(()=>stored(singleId).w===before.w);assert.equal(await tailVisible(),true);
 await page.locator('#redo').click();await until(()=>stored(singleId).w===fitted.w);assert.equal(await tailVisible(),true);
 await page.reload();await page.locator('#canvas-tool-dock').waitFor();await select(singleId);assert.equal(await tailVisible(),true);assert.equal(stored(singleId).w,fitted.w);assert.equal(stored(singleId).h,fitted.h);
 await page.screenshot({path:path.join(proof,'tail-after-fit.png')});
 assert.equal(studio.store.db.jobs.length,0);assert.deepEqual(errors,[]);
 fs.writeFileSync(path.join(proof,'browser-verification.json'),JSON.stringify({ok:true,addDialogue:true,firstTextPreserved:true,undoRedo:true,saveReload:true,removedCoordinateInputs:true,canvasHandlesPreserved:true,tailSurvivesFitUndoRedoReload:true,realGeneration:false,errors},null,2));
});
