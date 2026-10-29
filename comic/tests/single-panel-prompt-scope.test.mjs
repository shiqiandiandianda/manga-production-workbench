import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {syntheticFiles} from './fixtures/production-synthetic.mjs';
import {inspectProductionPackage} from '../lib/production-package.mjs';
import {productionProject} from '../lib/production-package-document.mjs';
import {prepareProductionPanel} from '../public/production-panel-generation.js';
import {ensureProjectPanelGeneration,panelProductionShot} from '../public/panel-generation.js';
import {generationPromptSelection,setPanelPromptText,restorePanelPromptText} from '../public/prompt-source.js';
import {singlePanelPromptScope} from '../public/single-panel-prompt-scope.js';
import {auditPanelReferences} from '../public/panel-reference-audit.js';
import {createStudio} from '../server.mjs';
import {buildImagePrompt} from '../lib/codex.mjs';
import {buildJimengPrompt} from '../lib/jimeng.mjs';

const require=createRequire(import.meta.url),{createCanvas}=require(process.env.COMIC_TEST_CANVAS_MODULE);
const evidence=path.join(process.env.QUALITY_RUN_DIR||path.resolve('../verification/single-panel-prompt-scope-20261029'),'scope-evidence');fs.mkdirSync(evidence,{recursive:true});
function wrapped(id='E011-001',mode='无泡'){
 return [
  '【一、屏段规格与分格布局】\n话数／屏段编号：第011话／E011-S001\n设计画布：1280×3840，宽高比1:3。\n画格数量：1。\n独立单格：'+id+'；保留父屏原始坐标，父屏共3格。\n阅读顺序：自上而下，依次E011-001、E011-002、E011-003\n各格位置与尺寸（像素，左上为原点）：\n'+id+'：左上角（x=32，y=1308）；宽=1216，高=1210 像素',
  '【二、实际参考图对应】\n人物外观以实际绑定参考为准。\n测试人物（设定卡；使用格号：'+id+'）。',
  '【三、共用画风】\n二维动漫漫画，清晰线稿与平涂阴影；每格表现一个动作瞬间。\n共用要求只写一次，各格不重复堆叠。\n时间、天气和光源服从各格剧情。',
  '【四、前情与空间连续性】\n必要前情：人物来到庭院。\n空间锚点：门在左、树在右。\n进入本屏时的状态：另一格进门。\n进入本格的前接状态〔E011-000〕：人物已停步。\n空间锚点用于保持连续性，不要求每格展示全部人物和完整场景。',
  '【五、文字处理规则】\n本版本：'+mode+'。\n'+(mode==='无泡'?'不绘制对白气泡、心声框和旁白框。':'画空白对白泡，不画对白文字。')+'\n按各格要求预留排字空间。\n画内文字、拟声字严格按各格清单绘制。',
  '【六、逐格画面提示词】\n第1格〔'+id+'〕：\n画格位置与尺寸：左上角（x=32，y=1308）；宽=1216，高=1210 像素\n本格叙事作用：本格专属动作'+id+'\n实际出镜人物：测试人物\n本格画面：测试人物在庭院停步，左手保持张开，右手持信，不握手。\n景别：中景；机位类别：侧面平视\n本格画内文字清单：\n信上写“测试”\n本格拟声字清单：\n无\n本格后期排字空间：上方留空。\n格末状态：人物站定。',
  '【七、跨格与跨屏核对】\n后接格〔E011-002〕本格作用：下一格奔跑。\n本屏连续性核对记录：下屏首格为E011-003。'
 ].join('\n\n');
}
const frame=(extra={})=>({x:120,y:200,w:832,h:1065,points:[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}],productionGrid:{panelId:'E011-001',segmentId:'E011-S001'},...extra});
const singleOnly=text=>{
 assert.match(text,/单格编号：E011-001/);assert.match(text,/本格画面：测试人物在庭院停步，左手保持张开，右手持信，不握手。/);
 assert.doesNotMatch(text,/屏段规格|阅读顺序|设计画布：1280×3840|保留父屏原始坐标|x=32|y=1308|E011-002|E011-003|下一格奔跑|下屏首格/);
};
test('残留屏段模板按唯一源格提取，画面与画风/前情/文字要求保留，尺寸只取当前格',()=>{
 const source=wrapped(),f=frame(),before=structuredClone(f),scoped=singlePanelPromptScope(source,f);
 assert.equal(scoped.scopeAdapted,true);singleOnly(scoped.text);assert.match(scoped.text,/画布：832×1065，宽高比832:1065/);assert.match(scoped.text,/信上写“测试”/);assert.match(scoped.text,/门在左、树在右/);assert.match(scoped.text,/人物已停步/);assert.deepEqual(f,before);
 assert.equal(singlePanelPromptScope(scoped.text,f).text,scoped.text);
 assert.match(singlePanelPromptScope(source,frame({w:910,h:1470})).text,/画布：910×1470，宽高比910:1470/);
 assert.match(singlePanelPromptScope(source,frame({points:[{x:.1,y:.2},{x:.9,y:.2},{x:.9,y:.8},{x:.1,y:.8}]})).text,/画布：666×639/);
 assert.match(singlePanelPromptScope(wrapped('E011-001','空泡'),f).text,/画空白对白泡，不画对白文字。/);
});
test('整屏、普通原文和普通手工画格保持原样，旧裁格也按源格处理',()=>{
 const source=wrapped();assert.deepEqual(singlePanelPromptScope(source,frame({productionSegment:'E011-S001'})),{text:source});assert.deepEqual(singlePanelPromptScope(source,frame({productionGrid:undefined})),{text:source});
 for(const text of ['真实单格原文\n保持一格。','特写：只画手部。', ''])assert.deepEqual(singlePanelPromptScope(text,frame()),{text});
 assert.equal(singlePanelPromptScope(source,frame({productionGrid:undefined,panelSlice:{panelId:'E011-001'}})).scopeAdapted,true);
});
test('编号不符、重复画面、无唯一单格和混用参考须明确拦截，不从屏段猜本格',()=>{
 for(const source of [
  wrapped('E011-002'),wrapped().replace('第1格〔E011-001〕','第1格〔E011-002〕'),
  wrapped().replace('【七、跨格与跨屏核对】','第2格〔E011-002〕：\n本格画面：另一格。\n\n【七、跨格与跨屏核对】'),
  wrapped().replace('独立单格：E011-001；','原始多格屏段：'),
  wrapped().replace('使用格号：E011-001','使用格号：E011-002'),
  wrapped().replace('【六、逐格画面提示词】','【六、其他格式】'),
  wrapped().replace('本格画面：','画面缺失：')
 ]){const result=singlePanelPromptScope(source,frame());assert.equal(result.text,'');assert.match(result.scopeError,/本格提示词来源需核对/);}
});
async function fixture(){
 const files=syntheticFiles(),board=JSON.parse(files[0].bytes);board.格.forEach((row,i)=>{const id='E011-00'+(i+1);delete row.生图提示词;row.出现角色=['测试人物'];row.出现道具=[];row.单格提示词={无泡:wrapped(id),空泡:wrapped(id,'空泡')};});
 files[0].bytes=Buffer.from(JSON.stringify(board));files[0].sha256=createHash('sha256').update(files[0].bytes).digest('hex');
 const p=productionProject(await inspectProductionPackage(files)),ep=p.productionPackage.episodes[0],frames=ep.panelRecords.map(r=>prepareProductionPanel(p,r.segmentId,r.id).panel);
 for(const f of frames){Object.assign(f,{x:200,y:100,w:832,h:1065});}
 ensureProjectPanelGeneration(p);
 p.pages[0].bubbles.push({id:'bubble_'+randomUUID(),parentPanelId:frames[0].id,type:'speech',shape:'oval',text:'保留手工台词',x:420,y:600,w:280,h:180,fontSize:32,visible:true,tail:{mode:'normalized',x:.5,y:1.2}});
 for(const f of frames){f.referenceTextBindings={};for(const n of auditPanelReferences(p,f,[]).needs.filter(n=>['character','scene','prop'].includes(n.role)))f.referenceTextBindings[n.id]={version:1,mode:'text',role:n.role,name:n.name,state:n.state||'',description:'合成测试设定',imageIds:[]};}
 return {p,frames};
}
test('显示与实际提交共用提取结果，保留导入原件和各模式人工修改',async()=>{
 const {p,frames:[f]}=await fixture(),before=structuredClone(p),raw=p.productionPackage.episodes[0].panelRecords[0].original.单格提示词.无泡,choice=generationPromptSelection(f,p),shot=panelProductionShot(p,f);
 singleOnly(choice.text);assert.equal(choice.edited,false);assert.equal(choice.originalText,raw);assert.equal(shot.productionPrompt,choice.text);assert.equal(shot.promptScope.sourcePrompt,raw);assert.deepEqual(p,before);
 f.generation.promptSource='imported';assert.match(generationPromptSelection(f,p).text,/画空白对白泡/);
 setPanelPromptText(f,'人工空泡，仅此模式');f.generation.promptSource='post-lettering';setPanelPromptText(f,'人工无泡，保持指定画面');
 assert.equal(generationPromptSelection(f,p).text,'人工无泡，保持指定画面');assert.equal(panelProductionShot(p,f).productionPrompt,'人工无泡，保持指定画面');
 restorePanelPromptText(f);singleOnly(generationPromptSelection(f,p).text);f.generation.promptSource='imported';assert.equal(generationPromptSelection(f,p).text,'人工空泡，仅此模式');
 setPanelPromptText(f,'');assert.equal(generationPromptSelection(f,p).text,'');assert.deepEqual(p.productionPackage,before.productionPackage);
});
test('无法定位的屏段模板阻止实际提交，保留原件可供修复',async()=>{
 const {p,frames:[f]}=await fixture(),shot=p.shots.find(s=>s.id===f.shotId);shot.sourceFields.单格提示词.无泡=wrapped('E011-009');shot.sourceFields['生图提示词（无泡）']=wrapped('E011-009');
 const before=structuredClone(p);assert.match(generationPromptSelection(f,p).scopeError,/编号不对应/);assert.throws(()=>panelProductionShot(p,f),/编号不对应/);assert.deepEqual(p,before);
});
test('真实页面保存重开、单位切换与假通道提交均使用本格提示词',{timeout:60000},async t=>{
 const {p,frames}=await fixture(),dir=fs.mkdtempSync(path.join(evidence,'browser-')),dataDir=path.join(dir,'data'),calls=[];fs.mkdirSync(dataDir);fs.writeFileSync(path.join(dataDir,'studio.json'),JSON.stringify({version:1,projects:[p],assets:[],jobs:[],layouts:[]}));
 const studio=createStudio({dataDir,seedReference:false,bridge:{close(){},ensurePoolSize(){},status:async()=>({connected:true,sessionReady:true,imageFeature:true,installed:true}),generate:async(_dir,input)=>{calls.push(structuredClone(input));return {bytes:createCanvas(Math.round(input.panel.w),Math.round(input.panel.h)).toBuffer('image/png'),imageToolSeen:true};}},jimengBridge:{close(){},status:async()=>({connected:false})}});
 await new Promise(r=>studio.server.listen(0,'127.0.0.1',r));t.after(()=>{studio.close();studio.server.closeAllConnections();});
 const {chromium}=require('playwright'),browser=await chromium.launch({channel:'msedge',headless:true});t.after(()=>browser.close());const view=await browser.newPage({viewport:{width:1864,height:949}}),origin='http://127.0.0.1:'+studio.server.address().port,errors=[];
 view.on('pageerror',e=>errors.push(e.message));await view.route('**/api/library/**',r=>r.fulfill({json:{connected:false,items:[]}}));await view.goto(origin+'/?project='+p.id);await view.waitForSelector('#canvas-tool-dock');
 const current=()=>studio.store.project(p.id),selected=()=>current().pages.flatMap(p=>p.panels).find(f=>f.id===frames[0].id),select=async()=>{const row=view.locator('#layer-list [data-layer="'+frames[0].id+'"]');if(!await row.isVisible())await view.locator('[data-rail-tab=layers]').click();await row.click();};
 await select();await view.locator('[data-properties-shortcut=toolbar]').click();const input=view.locator('textarea[data-section=panel-prompt]');await input.waitFor();const expected=await input.inputValue();singleOnly(expected);assert.equal(await view.locator('[data-prompt-edit-status]').innerText(),'已按本格提取');
 await view.screenshot({path:path.join(dir,'single-grid-prompt.png')});
 const save=async()=>{await view.keyboard.press('Control+s');await view.waitForFunction(()=>document.querySelector('#save-state')?.textContent==='已保存到本机');};
 await input.fill('人工修改当前单格');await input.blur();await save();await view.reload();await view.waitForSelector('#canvas-tool-dock');await select();assert.equal(await input.inputValue(),'人工修改当前单格');
 await view.locator('[data-action=restore-panel-prompt]').click();await save();assert.equal(await input.inputValue(),expected);
 const source=structuredClone(current().productionPackage),geometry=current().pages.map(p=>({id:p.id,panels:p.panels.map(f=>({id:f.id,x:f.x,y:f.y,w:f.w,h:f.h,points:f.points})),bubbles:p.bubbles}));
 for(const unit of ['screen','panel']){const r=await fetch(origin+'/api/projects/'+p.id+'/production/episode-unit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({expectedRevision:current().revision,episode:11,unit})});assert.equal(r.status,200,await r.text());}
 await view.reload();await view.waitForSelector('#canvas-tool-dock');await select();assert.equal(await input.inputValue(),expected);
 const r=await fetch(origin+'/api/jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({projectId:p.id,panelIds:[frames[0].id],provider:'codex',expectedRevision:current().revision})});assert.equal(r.status,202,await r.text());
 for(let i=0;i<160&&!studio.store.db.jobs.every(j=>j.status==='done');i++)await new Promise(r=>setTimeout(r,25));
 assert.equal(studio.store.db.jobs[0].status,'done');assert.equal(calls.length,1);assert.equal(calls[0].shot.productionPrompt,expected);singleOnly(buildImagePrompt(calls[0]));singleOnly(buildJimengPrompt(calls[0]));assert.equal(calls[0].shot.promptScope.sourcePrompt,source.episodes[0].panelRecords[0].original.单格提示词.无泡);
 assert.deepEqual(current().productionPackage.episodes[0].panelRecords,source.episodes[0].panelRecords);assert.deepEqual(current().pages.map(p=>({id:p.id,panels:p.panels.map(f=>({id:f.id,x:f.x,y:f.y,w:f.w,h:f.h,points:f.points})),bubbles:p.bubbles.filter(b=>geometry.find(g=>g.id===p.id).bubbles.some(old=>old.id===b.id))})),geometry);assert.deepEqual(errors,[]);
});
