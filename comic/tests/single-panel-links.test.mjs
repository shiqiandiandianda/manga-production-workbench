import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {syntheticFiles} from './fixtures/production-synthetic.mjs';
import {inspectProductionPackage} from '../lib/production-package.mjs';
import {productionProject} from '../lib/production-package-document.mjs';
import {prepareProductionPanel} from '../public/production-panel-generation.js';
import {ensureProjectPanelGeneration,panelProductionShot} from '../public/panel-generation.js';
import {hydrateProductionSlices,confirmedSliceReference} from '../public/production-slice-source.js';
import {auditPanelReferences} from '../public/panel-reference-audit.js';
import {generationPromptSelection} from '../public/prompt-source.js';
import {sourceLocations,isSourceParagraph,novelEpisodeContext} from '../public/production-display-context.js';
import {bubbleLayout,fitBubbleToTextFrame,bubbleTailGeometry} from '../public/lettering.js';
import {freezeBubbleTextLayout} from '../public/bubble-text-flow.js';
import {applyBubbleEdit} from '../public/bubble-editor.js';
import {applyBubbleMaterial} from '../public/bubble-material.js';
import {addDialogueSegment} from '../public/bubble-dialogue-segments.js';
import {normalizeLayerOrder} from '../public/layers.js';
import {validateProject} from '../lib/store.mjs';
import {createStudio} from '../server.mjs';

const require=createRequire(import.meta.url),{createCanvas}=require(process.env.COMIC_TEST_CANVAS_MODULE),ctx=createCanvas(900,900).getContext('2d');
const evidence=path.join(process.env.QUALITY_RUN_DIR||path.resolve('../verification/single-panel-links-20261029'),'links-evidence');
fs.mkdirSync(evidence,{recursive:true});
const clean='角色甲与卫兵、随从在源场景交谈，只画本格，保留此原文。无文字无气泡。';
const bubble=()=>({id:'bubble_'+randomUUID(),x:240,y:300,w:320,h:320,text:'记住了，是有过命交情的朋友！',shape:'oval',type:'speech',visible:true,fontFamily:'source-han-sans',fontWeight:500,fontSize:32,lineHeight:1.32,letterSpacing:0,textBox:{x:15,y:94,w:286,h:120},tail:{mode:'normalized',x:.65,y:1.15,visible:true}});
async function fixture(){
 const files=syntheticFiles(),board=JSON.parse(files[0].bytes),pkg=JSON.parse(files[1].bytes);
 for(const [i,row]of board.格.entries()){row.出现角色=['角色甲','卫兵、随从'];row.出现道具=[];row.服装={角色甲:'具体款式待绑定；沿用本话同一装束'};row.当前场景='源场景';delete row.生图提示词;row.单格提示词={无泡:clean+i};row.原著位置=[i?'第84章.txt 第103—105行（SRC-synthetic）':'第84章.txt 第101—101行（SRC-synthetic）'];}
 pkg.屏段=pkg.屏段.slice(0,1);const segment=pkg.屏段[0];segment.格=[1,2].map((n,i)=>({格ID:'E011-00'+n,格号:n,排:i+1,排内:'整排'}));segment.格数=2;segment.附图=[{类型:'设定卡',人物:'角色甲',服装:'',必须:true},{类型:'设定卡',人物:'卫兵、随从',服装:'',必须:true},{类型:'场景',名称:'源场景',场景:'源场景',必须:true}];pkg.文字=pkg.文字.filter(t=>t.渲染==='工具').map(t=>({...t,段ID:segment.段ID}));
 const p=productionProject(await inspectProductionPackage([board,pkg].map((value,i)=>({...files[i],bytes:Buffer.from(JSON.stringify(value))}))));
 const s=p.productionPackage.episodes[0].segments[0],parent=p.pages.flatMap(pg=>pg.panels).find(f=>f.productionSegment===s.id),assets=['角色甲','群像素材','已选外院'].map((name,i)=>({id:'asset_'+randomUUID(),name:name+'.png',libraryName:name,libraryRole:i===2?'scene':'character',libraryState:i===0?'实际官服':'',width:64,height:64,mime:'image/png',extension:'.png',library:{assetId:randomUUID(),revisionId:randomUUID(),sha256:String(i+1).repeat(64)}}));
 p.assetLibrary={version:1,assetIds:assets.map(a=>a.id),directories:[],recursive:true};parent.referenceIds=assets.map(a=>a.id);parent.referenceNeedBindings={};
 s.references.forEach((ref,i)=>{ref.binding={assetId:assets[i].id,revisionId:assets[i].library.revisionId,sha256:assets[i].library.sha256};ref.used_by=['E011-001','E011-002'];parent.referenceNeedBindings[s.id+'@'+ref.slot]={...ref.binding,name:i===0?'角色甲':i===1?'卫兵、随从':'源场景',role:i===2?'scene':'character',state:'',userSelection:{version:1,selectedAt:'2026-10-29T00:00:00Z'}};});
 const frames=['E011-001','E011-002'].map(id=>prepareProductionPanel(p,s.id,id).panel);ensureProjectPanelGeneration(p,assets);
 // Reproduce existing assistant-reflow crops: source populated, mode missing,
 // and only the screen has confirmed reference choices.
 for(const f of frames){delete f.generation.promptSource;delete f.referenceNeedBindings;f.referenceIds=[];f.generation.referenceRoles=[];}
 parent.visible=false;frames.forEach(f=>f.visible=true);p.pages[0].bubbles=[bubble()];normalizeLayerOrder(p);
 return {p,s,parent,frames,assets};
}
const geometry=p=>p.pages.map(pg=>({id:pg.id,width:pg.width,height:pg.height,bubbles:pg.bubbles,panels:pg.panels.map(f=>Object.fromEntries(['id','x','y','w','h','points','visible','imageAssetId','imageTransform'].map(k=>[k,f[k]])))}));

test('已有裁格恢复正确原文模式、固定版本人物/群像/场景，保留全部图层和源资料',async()=>{
 const f=await fixture(),source=JSON.stringify(f.p.productionPackage),before=structuredClone(geometry(f.p));ensureProjectPanelGeneration(f.p,f.assets);validateProject(f.p);
 for(const frame of f.frames){assert.equal(generationPromptSelection(frame,f.p).source,'post-lettering');assert.ok(panelProductionShot(f.p,frame,f.assets).description.startsWith(clean));const audit=auditPanelReferences(f.p,frame,f.assets);assert.equal(audit.ready,true,JSON.stringify(audit));assert.deepEqual(audit.needs.map(n=>n.name),['角色甲','卫兵、随从','源场景']);for(const n of audit.needs)assert.ok(frame.referenceNeedBindings[n.id].userSelection);}
 assert.equal(JSON.stringify(f.p.productionPackage),source);assert.deepEqual(geometry(f.p),before);const saved=JSON.stringify(f.p);assert.equal(hydrateProductionSlices(f.p,f.assets),false);assert.equal(JSON.stringify(f.p),saved);
});
test('初始化模式保留各模式手改、主动清空及明确空泡选择',async()=>{
 for(const mode of ['post-lettering','imported',undefined]){const f=await fixture(),frame=f.frames[0];frame.generation.promptSource=mode;frame.generation.promptOverrides={imported:'手改空泡', 'post-lettering':''};ensureProjectPanelGeneration(f.p,f.assets);assert.equal(generationPromptSelection(frame,f.p).text,mode==='post-lettering'?'':'手改空泡');assert.deepEqual(frame.generation.promptOverrides,{imported:'手改空泡','post-lettering':''});}
 const f=await fixture();f.s.panelPromptSources={'E011-001':'imported'};ensureProjectPanelGeneration(f.p,f.assets);assert.equal(f.frames[0].generation.promptSource,'imported');
});
test('跨版本、其他格专用场景、已跳过槽位和不同明确服装不继承',async()=>{
 for(const change of [f=>f.assets[2].library.sha256='f'.repeat(64),f=>f.assets[2].library.revisionId=randomUUID(),f=>f.s.references[2].used_by=['another-grid'],f=>f.s.references[2].skipped=true]){const f=await fixture();change(f);const need={id:'name:scene:源场景',role:'scene',name:'源场景',state:''};assert.equal(confirmedSliceReference(f.p,f.frames[0],need,f.assets[2]),false);}
 const f=await fixture();assert.equal(confirmedSliceReference(f.p,f.frames[0],{id:'name:character:角色甲@白衣',role:'character',name:'角色甲',state:'白衣'},f.assets[0]),false);
});
test('本格已经换图、文字代替或取消引用，修复不会重新强塞父屏图片',async()=>{
 for(const mode of ['binding','text','removed']){const f=await fixture(),frame=f.frames[0],key='name:scene:源场景';frame.assetReferenceBinding={mode:'manual',managedIds:[]};
  if(mode==='binding')frame.referenceNeedBindings={[key]:{assetId:'asset_'+randomUUID(),name:'源场景',role:'scene',state:''}};
  if(mode==='text')frame.referenceTextBindings={[key]:{version:1,mode:'text',role:'scene',name:'源场景',state:'',description:'本格只用文字',imageIds:[f.assets[2].id]}};
  if(mode==='removed')f.p.assetWorkspaceTrash=[{activeTargets:[{panelId:frame.id,needId:key,assetIds:[f.assets[2].id]}]}];
  hydrateProductionSlices(f.p,f.assets);assert.ok(!frame.referenceIds.includes(f.assets[2].id),mode);
 }
 const f=await fixture();hydrateProductionSlices(f.p,f.assets);const frame=f.frames[0];frame.referenceIds=frame.referenceIds.filter(id=>id!==f.assets[2].id);hydrateProductionSlices(f.p,f.assets);assert.ok(!frame.referenceIds.includes(f.assets[2].id));
});
test('原文行号区间、单行、非空段兼容；只标选中格，不猜未注明行号',async()=>{
 const f=await fixture(),records=f.p.productionPackage.episodes[0].panelRecords;
 const one=sourceLocations(records[0]);assert.deepEqual(one,[{chapter:84,line:101,paragraph:null}]);const range=sourceLocations(records[1]);assert.deepEqual(range,[{chapter:84,line:103,endLine:105,paragraph:null}]);
 assert.equal(novelEpisodeContext(f.p,f.p.pages[0],f.frames[0]).gridId,'E011-001');
 for(let n=100;n<=106;n++)assert.equal(isSourceParagraph({line:n,text:'原文'},0,84,range),n>=103&&n<=105);
 for(const dash of ['-','—','–','～','~','至'])assert.equal(sourceLocations({original:{原文位置:'第84章 第103'+dash+'105行'}})[0].endLine,105);
 assert.equal(isSourceParagraph({line:101,text:'其他原文'},0,84,[{chapter:84,line:101,quote:'必须匹配'}]),false);
 assert.equal(isSourceParagraph({line:1,text:'原文'},0,84,[{chapter:84}]),false);
 assert.equal(isSourceParagraph({line:1,text:'原文'},2,84,[{chapter:84,paragraph:3}]),true);
 assert.deepEqual(sourceLocations({original:{原著位置:'第84章 第105—103行'}}),[]);
});
const absoluteText=(b,l)=>({font:l.fontSize,lines:l.lines.map(row=>({text:row.text,x:row.x+b.x,y:row.y+b.y,glyphs:row.glyphs?.map(g=>({...g,x:g.x+b.x,y:g.y+b.y}))})),box:{x:b.x+l.textBox.x,y:b.y+l.textBox.y,w:l.textBox.w,h:l.textBox.h}});
const close=(actual,expected)=>{if(typeof actual==='number'&&typeof expected==='number')assert.ok(Math.abs(actual-expected)<1e-7,actual+' != '+expected);else if(actual&&typeof actual==='object')for(const k of new Set([...Object.keys(actual),...Object.keys(expected)]))close(actual[k],expected[k]);else assert.deepEqual(actual,expected);};
const tailVector=b=>{const g=bubbleTailGeometry(b),a=g.anchor||{x:(g.anchors[0].x+g.anchors[1].x)/2,y:(g.anchors[0].y+g.anchors[1].y)/2};return {x:g.tip.x-a.x,y:g.tip.y-a.y};};
const tailLength=b=>{const v=tailVector(b);return Math.hypot(v.x,v.y);};
const fittedTail=(before,after)=>{
 const a=tailVector(before),b=tailVector(after);assert.equal(after.tail.mode,'normalized');
 close(a.x*b.y-a.y*b.x,0);assert.ok(a.x*b.x+a.y*b.y>=0,'保留尾巴指向');
 const scale=Math.min(after.w/before.w,after.h/before.h),shortSide=Math.min(after.w,after.h),limit=Math.min(Math.max(after.fontSize*1.5,shortSide*.35),shortSide*2);
 close(tailLength(after),Math.min(tailLength(before)*scale,limit));
};
for(const shape of ['oval','rounded-rect','cloud','burst','custom','asset'])test('气泡外框适配独立文字框，文字不变且尾尖跟随外框：'+shape,()=>{
 let b=bubble();if(shape==='asset')b=applyBubbleMaterial(b,'builtin-oval');else b.shape=shape;
 const before=bubbleLayout(ctx,b);freezeBubbleTextLayout(b,before);const next=fitBubbleToTextFrame(ctx,b),after=bubbleLayout(ctx,next);close(absoluteText(next,after),absoluteText(b,before));assert.notDeepEqual([next.w,next.h],[b.w,b.h]);fittedTail(b,next);assert.equal(next.text,b.text);assert.equal(next.fontSize,b.fontSize);close(absoluteText(next,bubbleLayout(ctx,JSON.parse(JSON.stringify(next)))),absoluteText(b,before));close(fitBubbleToTextFrame(ctx,next),next);
});
test('适配后移动、缩放及重复适配不会留下尾尖或累积拉长，旧绝对长尾可再次适配修复',()=>{
 for(const side of ['bottom','top','left','right'])for(const absolute of [false,true]){
  const b=bubble(),tips={bottom:[.58,1.8],top:[.58,-.8],left:[-.8,.58],right:[1.8,.58]},[tx,ty]=tips[side];
  b.tail={side,base:.5,width:.12,mode:absolute?'absolute':'normalized',x:absolute?b.x+tx*b.w:tx,y:absolute?b.y+ty*b.h:ty,visible:true};
  if(absolute){b.textFrameLayout=true;freezeBubbleTextLayout(b,bubbleLayout(ctx,b));}
  const original=structuredClone(b),fit=fitBubbleToTextFrame(ctx,b);fittedTail(b,fit);assert.deepEqual(b,original);
  assert.ok(tailLength(fit)<tailLength(b)*.7,'收回异常长尾');close(absoluteText(fit,bubbleLayout(ctx,fit)),absoluteText(b,bubbleLayout(ctx,b)));
  let stable=fit;for(let i=0;i<10;i++)stable=fitBubbleToTextFrame(ctx,stable);close(stable,fit);
  const moved=applyBubbleEdit(fit,{type:'move',dx:230,dy:-75}),a=bubbleTailGeometry(fit),m=bubbleTailGeometry(moved);
  close({x:m.tip.x+moved.x,y:m.tip.y+moved.y},{x:a.tip.x+fit.x+230,y:a.tip.y+fit.y-75});close(tailLength(moved),tailLength(fit));
  const resized=applyBubbleEdit(moved,{type:'resize',dx:moved.w*.4,dy:moved.h*.4}),r=bubbleTailGeometry(resized);
  close(r.tip.x,m.tip.x*1.4);close(r.tip.y,m.tip.y*1.4);
  const saved=JSON.parse(JSON.stringify(resized));close(bubbleTailGeometry(saved),r);close(fitBubbleToTextFrame(ctx,saved),moved);
 }
});
test('无尾、锁定和无框气泡不新增尾巴，手动尾根及宽度在适配时保留',()=>{
 for(const extra of [{tail:{visible:false}},{locked:true},{shape:'none'}]){const b={...bubble(),...extra},fit=fitBubbleToTextFrame(ctx,b);if(b.locked||b.shape==='none')assert.deepEqual(fit,b);else{assert.deepEqual(fit.tail,b.tail);assert.equal(bubbleTailGeometry(fit),null);}}
 const b=bubble();b.tail={...b.tail,anchorT:.3,width:.2};const next=fitBubbleToTextFrame(ctx,b);assert.equal(next.tail.anchorT,.3);assert.equal(next.tail.width,.2);fittedTail(b,next);
});
test('极小文字框与超大字号、远距离绝对尾尖适配后仍可保存',()=>{
 const b={...bubble(),fontSize:2048,padding:0,textBox:{x:0,y:0,w:1,h:1},tail:{mode:'absolute',x:100000,y:-100000,visible:true}},next=fitBubbleToTextFrame(ctx,b);
 assert.equal(next.tail.mode,'normalized');for(const axis of ['x','y'])assert.ok(next.tail[axis]>=-2&&next.tail[axis]<=3,'尾尖在可保存的坐标范围内');
});
test('竖排、显式换行和双圆两段台词保留各自文字框',()=>{
 for(const mode of ['vertical','explicit','double']){let b=bubble();if(mode==='vertical'){b.writingMode='vertical';b.textBox={x:20,y:40,w:260,h:240};}if(mode==='explicit'){b.text='第一行\n第二行';b.lineBreakMode='explicit';}if(mode==='double')b=addDialogueSegment(applyBubbleMaterial(b,'builtin-double'),'第二段保持文字');
  const before=bubbleLayout(ctx,b),next=fitBubbleToTextFrame(ctx,b),after=bubbleLayout(ctx,next);
  if(mode==='double')before.dialogueLayouts.forEach((l,i)=>close(absoluteText(next,after.dialogueLayouts[i]),absoluteText(b,l)));else close(absoluteText(next,after),absoluteText(b,before));
 }
});

test('浏览器：切换单位、选格高亮、手改保存重开、适配气泡和撤销',{timeout:60000},async t=>{
 const f=await fixture(),dir=fs.mkdtempSync(path.join(evidence,'browser-')),dataDir=path.join(dir,'data');fs.mkdirSync(dataDir);
 const png=createCanvas(64,64).toBuffer('image/png');for(const a of f.assets){a.filePath=path.join(dir,a.id+'.png');fs.writeFileSync(a.filePath,png);}
 fs.writeFileSync(path.join(dataDir,'studio.json'),JSON.stringify({version:1,projects:[f.p],assets:f.assets,jobs:[],layouts:[]}));
 const studio=createStudio({dataDir,bridge:{close(){},status:async()=>({connected:false}),generate(){throw Error('禁止调用生成');}},jimengBridge:{close(){},status:async()=>({connected:false})}});await new Promise(r=>studio.server.listen(0,'127.0.0.1',r));t.after(()=>{studio.close();studio.server.closeAllConnections();});
 const {chromium}=require('playwright'),browser=await chromium.launch({channel:'msedge',headless:true});t.after(()=>browser.close());const page=await browser.newPage({viewport:{width:1770,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/api/library/**',route=>route.fulfill({json:{connected:false,items:[]}}));const novel=Array.from({length:110},(_,i)=>[101,103,105].includes(i+1)?'对应原文第'+(i+1)+'行':'').join('\n');await page.route('**/novel-source?*',route=>route.fulfill({body:novel,contentType:'text/plain'}));
 const origin='http://127.0.0.1:'+studio.server.address().port,current=()=>studio.store.project(f.p.id),frame=()=>current().pages.flatMap(p=>p.panels).find(p=>p.id===f.frames[0].id);
 await page.goto(origin+'/?project='+f.p.id);await page.waitForSelector('#canvas-tool-dock');
 const select=async id=>{const row=page.locator('#layer-list [data-layer="'+id+'"]');if(!await row.isVisible())await page.locator('[data-rail-tab=layers]').click();await row.click();};
 await select(f.frames[0].id);await page.locator('[data-properties-shortcut="toolbar"]').click();const prompt=page.locator('textarea[data-section="panel-prompt"]');await prompt.waitFor();assert.equal(await prompt.inputValue(),clean+'0');
 await page.locator('#novel-source-toggle').click();await page.waitForFunction(()=>document.querySelectorAll('[data-novel-highlight]').length===1);assert.equal(await page.locator('[data-novel-highlight]').getAttribute('data-novel-line'),'101');
 await page.locator('[data-panel-inspector-tab=references]').click();assert.doesNotMatch(await page.locator('#inspector-body').innerText(),/待选图/);await page.screenshot({path:path.join(dir,'panel-references-and-novel.png')});
 await select(f.frames[1].id);await page.waitForFunction(()=>document.querySelectorAll('[data-novel-highlight]').length===2);
 await select(f.frames[0].id);await page.locator('[data-panel-inspector-tab=generation]').click();await prompt.fill('手改只属于当前单格');await prompt.blur();await page.keyboard.press('Control+s');await page.waitForFunction(()=>document.querySelector('#save-state')?.textContent==='已保存到本机');assert.equal(frame().generation.promptOverrides['post-lettering'],'手改只属于当前单格');
 for(const unit of ['screen','panel']){const r=await fetch(origin+'/api/projects/'+f.p.id+'/production/episode-unit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({expectedRevision:current().revision,episode:11,unit})});assert.equal(r.status,200,await r.text());}
 await page.reload();await page.waitForSelector('#canvas-tool-dock');await select(f.frames[0].id);await page.locator('[data-panel-inspector-tab=generation]').click();assert.equal(await prompt.inputValue(),'手改只属于当前单格');assert.equal(auditPanelReferences(current(),frame(),f.assets).ready,true);
 const save=async()=>{await page.keyboard.press('Control+s');await page.waitForFunction(()=>document.querySelector('#save-state')?.textContent==='已保存到本机');};
 const bid=f.p.pages[0].bubbles[0].id,getBubble=()=>current().pages.flatMap(p=>p.bubbles).find(b=>b.id===bid);await select(bid);const before=structuredClone(getBubble());await page.locator('[data-action=bubble-fit-text]').click();await save();const next=structuredClone(getBubble());assert.notDeepEqual([next.w,next.h],[before.w,before.h]);close(absoluteText(next,bubbleLayout(ctx,next)),absoluteText(before,bubbleLayout(ctx,before)));fittedTail(before,next);await page.screenshot({path:path.join(dir,'bubble-fits-text-frame.png')});
 await page.locator('#undo').click();await save();assert.deepEqual(getBubble(),before);
 await page.locator('[data-action=bubble-fit-text]').click();await save();close(getBubble(),next);
 await page.reload();await page.waitForSelector('#canvas-tool-dock');await select(bid);close(getBubble(),next);
 const drag=async(selector,dx,dy)=>{const box=await page.locator(selector).first().boundingBox();assert.ok(box);const x=box.x+box.width/2,y=box.y+box.height/2;await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+dx,y+dy,{steps:8});await page.mouse.up();await save();};
 await drag('#stage [data-bubble="'+bid+'"]:has(text) > polygon',45,25);const moved=structuredClone(getBubble()),delta={x:moved.x-next.x,y:moved.y-next.y};assert.ok(Math.hypot(delta.x,delta.y)>20);
 const tail=b=>{const g=bubbleTailGeometry(b);return {x:b.x+g.tip.x,y:b.y+g.tip.y};};close(tail(moved),{x:tail(next).x+delta.x,y:tail(next).y+delta.y});close(tailLength(moved),tailLength(next));
 await drag('[data-bubble="'+bid+'"] [data-bubble-handle="resize"]',50,25);const resized=structuredClone(getBubble());assert.ok(resized.w>moved.w);assert.ok(resized.h>moved.h);close(bubbleTailGeometry(resized).tip.x,bubbleTailGeometry(moved).tip.x*resized.w/moved.w);close(bubbleTailGeometry(resized).tip.y,bubbleTailGeometry(moved).tip.y*resized.h/moved.h);
 await page.locator('[data-action=bubble-fit-text]').click();await save();const refit=structuredClone(getBubble());close(absoluteText(refit,bubbleLayout(ctx,refit)),absoluteText(resized,bubbleLayout(ctx,resized)));fittedTail(resized,refit);
 await page.locator('[data-action=bubble-fit-text]').click();await save();close(getBubble(),refit);await page.screenshot({path:path.join(dir,'bubble-tail-after-drag-and-refit.png')});
 await page.reload();await page.waitForSelector('#canvas-tool-dock');close(getBubble(),refit);assert.deepEqual(errors,[]);assert.equal(studio.store.db.jobs.length,0);
});
