import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {createRequire} from 'node:module';
import {createStudio} from '../server.mjs';import {createProject,id,panel,clone} from '../public/model.js';import {migrateLayerDocument} from '../public/layers.js';import {validateProject} from '../lib/store.mjs';
import {ensureProjectPanelGeneration} from '../public/panel-generation.js';
const require=createRequire(import.meta.url),{chromium}=require(path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
function fixture(){
 const p=createProject('合成三话长条性能验收'),samplePage=p.pages[0],sampleShot=p.shots[0];p.pages=[];p.shots=[];
 for(let episode=11;episode<=13;episode++){
  const page={...clone(samplePage),id:id('page'),name:'第'+episode+'话',episode,height:52000,panels:[],bubbles:[]};p.pages.push(page);
  for(let i=0;i<40;i++){
   const shot={...clone(sampleShot),id:id('shot'),episode,code:String(i+1).padStart(3,'0'),title:'合成画格',description:'合成场景与合成人物。'.repeat(100),dialogue:'甲：保留对白和手工修改。'};p.shots.push(shot);
   const frame=panel(shot.id,i%2?300:50,200+i*1250,900,900);frame.referenceIds=[];page.panels.push(frame);
   for(let j=0;j<(i%2?2:1);j++)page.bubbles.push({id:id('bubble'),parentPanelId:frame.id,shotId:shot.id,x:frame.x+30,y:frame.y+40+j*180,w:260,h:130,text:'对白排版性能验证，保留原文本与尾尖。',type:'speech',shape:'oval',fontSize:40,visible:true,tail:{mode:'normalized',x:.6,y:1.15}});
  }
 }
 const migrated=migrateLayerDocument(p).project;ensureProjectPanelGeneration(migrated);return migrated;
}
test('three episode slider burst, long gap, scrolling, cancel, undo and save remain responsive and isolated',{timeout:120000},async t=>{
 const parent=path.resolve('.runtime/temp');fs.mkdirSync(parent,{recursive:true});const dir=fs.mkdtempSync(path.join(parent,'editor-performance-')),proof=path.resolve('merge-audit/performance');fs.mkdirSync(proof,{recursive:true});let browser;
 const calls=[],fake={close(){},status:async()=>({connected:false}),generate(){calls.push('forbidden');throw Error('No AI');}},studio=createStudio({dataDir:dir,bridge:fake,jimengBridge:fake,storyboardGenerator:fake}),initial=fixture();validateProject(initial);studio.store.db.projects.push(clone(initial));studio.store.save();await new Promise(resolve=>studio.server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{await browser?.close();studio.close();await new Promise(resolve=>studio.server.close(resolve));assert.equal(path.dirname(dir),parent);fs.rmSync(dir,{recursive:true,force:true});});
 const origin='http://127.0.0.1:'+studio.server.address().port;browser=await chromium.launch({channel:'msedge',headless:true,args:['--disable-gpu','--renderer-process-limit=2']});
 const reports=[];const backup='../verification/optional-performance-baseline';
 for(const baseline of process.env.COMIC_PERFORMANCE_BASELINE==='1'?[true,false]:[false]){
  if(baseline&&!fs.existsSync(path.join(backup,'public/app.js')))continue;
  studio.store.db.projects=[clone(initial)];studio.store.save();const context=await browser.newContext({viewport:{width:1600,height:1000}}),page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await context.route('**/*',route=>{const u=new URL(route.request().url());if(u.origin!==origin&&!['data:','blob:'].includes(u.protocol))return route.abort();if(baseline&&['/app.js','/frame-shortcuts.js','/gap-background.js'].includes(u.pathname))return route.fulfill({contentType:'text/javascript',body:fs.readFileSync(path.join(backup,'public',u.pathname.slice(1)),'utf8')});return route.continue();});
  await page.goto(origin+'/?project='+initial.id);await page.waitForFunction(()=>document.querySelector('#project-label').textContent.includes('性能验收'));await page.locator('#zoom').evaluate(el=>{el.add(new Option('32.35%','0.3235'));el.value='0.3235';el.dispatchEvent(new Event('change',{bubbles:true}));});
  const target=initial.pages[0].panels[19];await page.locator('#canvas-scroll').evaluate((el,y)=>el.scrollTop=y,(target.y+200)*.3235);const frame=page.locator('#stage [data-panel="'+target.id+'"][data-layer-type="panel"]').first();await frame.waitFor();await frame.click({position:{x:50,y:60}});await page.locator('.frame-adjustments').evaluate(el=>el.open=true);const slider=page.locator('[data-quick-field="gap-below"]');await slider.waitFor({state:'visible'});
  const metric=await slider.evaluate(async el=>{el.focus();const start=performance.now();for(let i=0;i<20;i++){el.value=String(350+i*5);el.dispatchEvent(new Event('input',{bubbles:true}));}el.dispatchEvent(new Event('change',{bubbles:true}));return {burstMs:performance.now()-start,finalValue:Number(el.value),stageNodes:document.querySelector('#stage').querySelectorAll('*').length};});
  await page.waitForFunction(()=>document.querySelector('#save-state').textContent==='已保存到本机');assert.deepEqual(errors,[]);reports.push({baseline,...metric});console.log(JSON.stringify(reports.at(-1)));fs.writeFileSync(path.join(proof,'performance-partial.json'),JSON.stringify(reports));
  if(!baseline){
   const saved=studio.store.db.projects[0];assert.equal(saved.layoutHistory.records.filter(r=>r.operation==='strip.gap-below').length,1);assert.deepEqual(saved.pages.slice(1),initial.pages.slice(1));assert.deepEqual(saved.shots,initial.shots);assert.deepEqual(saved.pages[0].panels[19].imageTransform,initial.pages[0].panels[19].imageTransform);assert.ok(saved.pages[0].bubbles.every((b,i)=>b.text===initial.pages[0].bubbles[i].text));
   const baselineGap=350+19*5;const scrollResult=await page.evaluate(async()=>{const start=performance.now(),el=document.querySelector('#canvas-scroll');for(let i=0;i<8;i++){el.scrollTop+=45;await new Promise(requestAnimationFrame);}return {ms:performance.now()-start,nodes:document.querySelector('#stage').querySelectorAll('*').length,height:Number(document.querySelector('#stage').getAttribute('height'))};});assert.ok(scrollResult.height<2200);assert.ok(scrollResult.nodes<1500);reports.at(-1).scroll=scrollResult;
   await slider.evaluate(el=>{el.focus();el.value='800';el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));});assert.equal((await slider.inputValue()),String(baselineGap));
   await slider.evaluate(el=>{el.max='10000';el.value='6080';el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));});await page.waitForFunction(()=>document.querySelector('#save-state').textContent==='已保存到本机');assert.equal(Number(await slider.inputValue()),6080);
   await page.screenshot({path:path.join(proof,'01-long-gap-responsive.png')});await slider.evaluate(el=>el.blur());await page.locator('#undo').click();await page.waitForFunction(()=>document.querySelector('#save-state').textContent==='已保存到本机');assert.equal(Number(await slider.inputValue()),baselineGap);await page.locator('#undo').click();await page.waitForFunction(()=>document.querySelector('#save-state').textContent==='已保存到本机');assert.deepEqual(studio.store.db.projects[0].pages,initial.pages);
   assert.deepEqual(calls,[]);assert.deepEqual(errors,[]);
  }
  await context.close();
 }
 const before=reports.find(r=>r.baseline),after=reports.find(r=>!r.baseline);if(before)assert.ok(after.burstMs<before.burstMs*.6,JSON.stringify(reports));fs.writeFileSync(path.join(proof,'performance-report.json'),JSON.stringify({synthetic:true,realAI:false,reports,checks:['same episode only','dialogue unchanged','one history entry per burst','pending preview Escape','6080px gap','finite viewport','undo restores geometry']},null,2));console.log(JSON.stringify(reports));
});
