import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {syntheticFiles} from './fixtures/production-synthetic.mjs';
import {inspectProductionPackage} from '../lib/production-package.mjs';
import {productionProject} from '../lib/production-package-document.mjs';
import {applyProductionLettering,productionFrame} from '../public/production-package-model.js';
import {applyProductionPanelLettering,prepareProductionPanel} from '../public/production-panel-generation.js';
import {productionTextContent,joinDialogueLines} from '../public/production-text.js';
import {bubbleFieldChange} from '../public/editor-state.js';
import {bubbleLayout} from '../public/lettering.js';
import {replacementBubble} from '../public/local-region-layers.js';
import {createProject,id} from '../public/model.js';
import {normalizeLayerOrder,migrateLayerDocument} from '../public/layers.js';
import {createStudio} from '../server.mjs';
const evidence=path.resolve(import.meta.dirname,'../../verification/dialogue-toolbar-20261024');
fs.mkdirSync(evidence,{recursive:true});
process.env.COMIC_PROJECT_SYNC='0';process.env.PROJECT_CENTER_URL='';
process.env.COMIC_TEAM_CHANNEL_FILE=path.join(evidence,'absent-isolated-channel.json');
const content='之前逃命时我曾说过，若能逃出来就来大人这里求救，告诉大人，您之前的提议，我答应了！';
const rows=['之前逃命时我曾说过，','若能逃出来就来','大人这里求救，','告诉大人，','您之前的提议，','我答应了！'];
async function imported(){
 const files=syntheticFiles(),raw=JSON.parse(files[1].bytes);
 Object.assign(raw['文字'][0],{'文本':content,'分行':rows,'说话人':'岳不群'});
 raw['文字'].splice(1,0,{...raw['文字'][0],'文字ID':'E011-T004','文本':'另一位人物的台词，不能合并。','分行':['另一位人物的台词，','不能合并。'],'说话人':'宋玄'});
 files[1].bytes=Buffer.from(JSON.stringify(raw));delete files[1].sha256;
 return productionProject(await inspectProductionPackage(files));
}
test('完整原文优先于分行提示，兼容只有行的来源和不同换行符，英文词间保持空格',()=>{
 assert.equal(productionTextContent({'文本':content,'分行':['错误的分行文本']}),content);
 assert.equal(productionTextContent({'分行':rows}),content);
 assert.equal(productionTextContent({'文本':rows.join('\r\n')}),content);
 assert.equal(joinDialogueLines('Hello\nworld,\r\nplease wait.'),'Hello world, please wait.');
 assert.equal(productionTextContent({'类型':'特效字','文本':'轰\n隆'}),'轰\n隆');
});
test('整屏和裁格共用排字使用连贯原文，不合并说话人，来源记录和手工回车不变',async()=>{
 const p=await imported(),f=productionFrame(p,'E011-S001'),original=structuredClone(p.productionPackage.episodes[0].texts);
 f.imageAssetId=id('asset');f.generation.promptSource='imported';
 const options={regions:{'E011-001':{x:0,y:0,w:1,h:1}},positions:{'E011-T001':{x:.1,y:.1,w:.5,h:.2},'E011-T004':{x:.1,y:.4,w:.5,h:.2}},confirmed:true};
 assert.equal(applyProductionLettering(p,'E011-S001',options),2);
 const b=p.pages.flatMap(p=>p.bubbles).find(b=>b.productionTextId==='E011-T001');
 assert.equal(b.text,content);assert.equal(b.lineBreakMode,'auto');assert.equal(b.speaker,'岳不群');
 assert.deepEqual(b.productionOriginal['分行'],rows);
 assert.equal(p.pages.flatMap(p=>p.bubbles).find(b=>b.productionTextId==='E011-T004').speaker,'宋玄');
 const edited=bubbleFieldChange(b,'bubble','text','手工第一行，\n手工第二行。');Object.assign(b,edited);
 applyProductionLettering(p,'E011-S001',options);assert.equal(b.text,'手工第一行，\n手工第二行。');
 assert.deepEqual(p.productionPackage.episodes[0].texts,original);
});
test('单格排字同样忽略预设分行，重复排字保留人工修改且不新增重复对白',async()=>{
 const p=await imported(),{panel:f}=prepareProductionPanel(p,'E011-S001','E011-001');f.imageAssetId=id('asset');
 assert.equal(applyProductionPanelLettering(p,'E011-S001','E011-001').created,2);
 const b=p.pages.flatMap(p=>p.bubbles).find(b=>b.productionTextId==='E011-T001');assert.equal(b.text,content);
 const ctx={measureText:text=>({width:[...text].length*36})},wide=bubbleLayout(ctx,{...b,shape:'none',w:650,h:600}),narrow=bubbleLayout(ctx,{...b,shape:'none',w:260,h:600});
 assert.ok(narrow.lines.length>wide.lines.length);assert.equal(narrow.lines.map(l=>l.text).join(''),content);
 b.text='手工\n保留';assert.equal(applyProductionPanelLettering(p,'E011-S001','E011-001').skipped,2);assert.equal(b.text,'手工\n保留');
});
test('去框替换的新气泡使用完整对白；重新定位已有手工气泡不改文字',()=>{
 const p=createProject('替换气泡',true),pg=p.pages[0],f=pg.panels[0];pg.bubbles=[];
 const patch={id:id('panel'),cutoutLayer:{taskId:'isolated-local-task'}},record={'文字ID':'E011-T001','类型':'对白','文本':content,'分行':rows};
 const b=replacementBubble(p,f,patch,{width:1280,height:3840},{x:.1,y:.1,w:.5,h:.2},{textRecord:record});assert.equal(b.text,content);assert.deepEqual(b.productionOriginal,record);
 b.text='人工\n分段';replacementBubble(p,f,patch,{width:1280,height:3840},{x:.2,y:.2,w:.4,h:.2},{existingBubbleId:b.id});assert.equal(b.text,'人工\n分段');
});
test('浏览器旧对白合并可撤销、保存重开，顶部状态变化不移动工具按钮',{timeout:90000},async t=>{
 const dir=fs.mkdtempSync(path.join(evidence,'fixture-'));process.env.COMIC_SLOT_DIR=path.join(dir,'slots');process.env.COMIC_LIBRARY_CONFIG=path.join(dir,'moku.json');fs.writeFileSync(process.env.COMIC_LIBRARY_CONFIG,'{"base":"http://127.0.0.1:9"}');
 const studio=createStudio({dataDir:dir,bridge:{close(){},status:async()=>({connected:false}),generate(){assert.fail('不允许真实生图');}},jimengBridge:{close(){},status:async()=>({connected:false})}});
 const p=createProject('对白连贯导入与固定工具栏验收',true),pg=p.pages[0],frame=pg.panels[0],b=pg.bubbles[0];p.pages=[pg];pg.panels=[frame];pg.bubbles=[b];
 Object.assign(pg,{width:1280,height:1600});Object.assign(frame,{x:60,y:100,w:1100,h:1100});Object.assign(b,{text:rows.join('\n'),speaker:'岳不群',productionTextId:'E011-T001',productionOriginal:{'文本':content,'分行':rows},parentPanelId:frame.id,shotId:frame.shotId,x:120,y:160,w:600,h:400,fontSize:36,shape:'oval',lineBreakMode:'auto',textFlowVersion:1,visible:true,locked:false});normalizeLayerOrder(p);studio.store.db.projects.push(migrateLayerDocument(p).project);studio.store.save();
 await new Promise(r=>studio.server.listen(0,'127.0.0.1',r));
 const {chromium}=createRequire(import.meta.url)('C:/Users/EDY/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'),browser=await chromium.launch({channel:'msedge',headless:true}),page=await browser.newPage({viewport:{width:1864,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 t.after(async()=>{await browser.close();studio.close();studio.server.closeAllConnections();});
 await page.route('**/api/team-release/status',r=>r.fulfill({json:{role:'publisher',current:'2026-10-24 V124',latest:'2026-10-24 V124',controlUrl:'http://127.0.0.1:18913/',available:false}}));
 await page.goto('http://127.0.0.1:'+studio.server.address().port+'/?project='+p.id);await page.waitForFunction(()=>document.querySelector('#save-state').textContent==='已保存到本机');await page.locator('#workbench-primary-nav').waitFor();await page.waitForTimeout(700);
 await page.locator('[data-rail-tab="layers"]').click();if(!await page.locator('#layer-list [data-layer="'+b.id+'"]').count())await page.locator('[data-toggle-group="'+frame.id+'"]').click();await page.locator('#layer-list [data-layer="'+b.id+'"]').click();
 await page.locator('[data-action="bubble-join-lines"]').click();await page.waitForFunction(()=>document.querySelector('textarea[data-field="text"]')?.value&&!document.querySelector('textarea[data-field="text"]').value.includes('\n'));
 const value=()=>studio.store.project(p.id).pages[0].bubbles[0];await page.waitForTimeout(600);assert.equal(value().text,content);assert.deepEqual(value().productionOriginal['分行'],rows);
 await page.locator('#undo').click();await page.waitForTimeout(600);assert.equal(value().text,rows.join('\n'));await page.locator('#redo').click();await page.waitForTimeout(600);assert.equal(value().text,content);
 await page.locator('textarea[data-field="text"]').fill('手工回车，\n需要保留。');await page.locator('textarea[data-field="text"]').blur();await page.waitForTimeout(600);
 await page.reload();await page.waitForFunction(()=>document.querySelector('#save-state').textContent==='已保存到本机');assert.equal(value().text,'手工回车，\n需要保留。');
 const controls=['#project-trigger','#workspace-modes','#storyboard-import','#asset-studio-open','#team-shortcut','#team-comms-open','#moku-sync','#codex-connect','#generation-menu>summary','#export-toggle','#team-update-notice','#project-tools-menu>summary','.canvas-toolbar'];
 const bounds=()=>page.evaluate(selectors=>Object.fromEntries(selectors.map(s=>{const b=document.querySelector(s).getBoundingClientRect();return [s,[b.x,b.y,b.width,b.height]];})),controls);
 const measurements=[];
 for(const width of [1920,1864,1740,1739,1440,1280,1100,900,760,650]){
  await page.setViewportSize({width,height:1000});await page.waitForTimeout(100);
  await page.evaluate(()=>{document.querySelector('#save-state').textContent='已保存到本机';document.querySelector('[data-moku-sync-text]').textContent='墨库 22:04';document.querySelector('#team-shortcut').textContent='团队 · 2 在线';document.querySelector('#team-comms-open').textContent='会话';document.querySelector('#codex-connection-status').textContent='已连接';});
  const before=await bounds();
  await page.evaluate(()=>{document.querySelector('#save-state').textContent='保存失败 · 可导出工程备份';document.querySelector('[data-moku-sync-text]').textContent='生成中 · 暂停上传';document.querySelector('#team-shortcut').textContent='团队 · 100 在线';document.querySelector('#team-comms-open').textContent='会话 · 999';document.querySelector('#codex-connection-status').textContent='账号已登录 · 待检查会话';document.querySelector('#team-update-notice').textContent='收到新版 · 升级';});
  const after=await bounds();assert.deepEqual(after,before,'状态变化导致工具位置变化：'+width);
  for(const [i,a] of controls.entries())for(const c of controls.slice(i+1)){if(a==='.canvas-toolbar'||c==='.canvas-toolbar')continue;const [x,y,w,h]=after[a],[cx,cy,cw,ch]=after[c];assert.ok(Math.min(x+w,cx+cw)-Math.max(x,cx)<1||Math.min(y+h,cy+ch)-Math.max(y,cy)<1,'控件重叠：'+width+' '+a+' '+c);}
  const metrics=await page.evaluate(()=>{const h=document.querySelector('.topbar').getBoundingClientRect();return {headerHeight:h.height,headerRight:h.right,bodyWidth:document.body.scrollWidth};});assert.ok(metrics.headerRight<=width+1,JSON.stringify({width,...metrics}));assert.ok(metrics.bodyWidth<=width+1,JSON.stringify({width,...metrics}));
  measurements.push({width,...metrics,stable:true});if([1864,1440,650].includes(width))await page.screenshot({path:path.join(evidence,'fixed-toolbar-'+width+'.png')});
 }
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(evidence,'browser-acceptance.json'),JSON.stringify({dialogueMerge:true,undoRedo:true,reopen:true,sourcePreserved:true,measurements,errors},null,2));
});
