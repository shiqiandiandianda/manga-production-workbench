import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {createStudio} from '../server.mjs';
import {createProject,id} from '../public/model.js';
import {applyBubbleMaterial} from '../public/bubble-material.js';
import {applyProductionStyle} from '../public/production-lettering-style.js';

const require=createRequire(import.meta.url),{chromium}=require(path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const evidence=path.resolve('../verification/asset-generation-repair-20261026');fs.mkdirSync(evidence,{recursive:true});
async function until(fn){for(let n=0;n<100;n++){const value=await fn();if(value)return value;await new Promise(resolve=>setTimeout(resolve,60));}throw Error('等待隔离测试状态超时');}

test('资产整张角色卡生成时直接显示取消按钮，取消实际调用原任务且不影响其他任务',{timeout:40000},async t=>{
 const directory=fs.mkdtempSync(path.join(evidence,'cancel-')),project=createProject('隔离取消资产'),recordId='production_'+randomUUID(),assetId='card_'+recordId,jobId=id('job'),otherId=id('job');
 const jobs=[{id:jobId,projectId:project.id,status:'running',assetProductionRequest:{stageSnapshot:{assetId,stageId:'role-card'}}},{id:otherId,projectId:project.id,status:'running',assetProductionRequest:{stageSnapshot:{assetId:'other',stageId:'role-card'}}}];
 const record={id:recordId,projectId:project.id,assetId,name:'取消按钮合成人物',type:'character',outfit:'测试服装',prompt:'合成提示词',status:'running',characterOutputMode:'card',characterRole:'background',referenceIds:[],components:['role-card'],jobs:{'role-card':jobId},phases:{'role-card':{jobId,status:'running',message:'合成任务运行中'}},finished:[],slots:{},width:3840,height:1890,createdAt:new Date().toISOString(),source:{projectId:project.id}};
 fs.mkdirSync(path.join(directory,'production-records'));fs.writeFileSync(path.join(directory,'production-records/index.json'),JSON.stringify([record]));fs.writeFileSync(path.join(directory,'asset-studio.json'),JSON.stringify({projectId:project.id,title:project.title}));
 const cancellations=[];
 const editor=http.createServer(async(req,res)=>{res.setHeader('Content-Type','application/json');let value={};
  if(req.url==='/api/state')value={projects:[project],assets:[],jobs};
  else if(req.url==='/api/projects/'+project.id)value=project;
  else if(req.url==='/api/health')value={generation:{running:2}};
  else if(req.url==='/api/library/status')value={connected:false};
  else if(req.url.startsWith('/api/jobs/')&&req.url.endsWith('/cancel')){const target=req.url.split('/')[3];cancellations.push(target);await new Promise(resolve=>setTimeout(resolve,150));jobs.find(job=>job.id===target).status='cancelled';value={id:target,status:'cancelled'};}
  else if(req.method==='POST'){res.statusCode=500;value={error:'合成测试禁止新增生成'};}
  res.end(JSON.stringify(value));
 });await new Promise(resolve=>editor.listen(0,'127.0.0.1',resolve));
 const reserve=http.createServer();await new Promise(resolve=>reserve.listen(0,'127.0.0.1',resolve));const port=reserve.address().port;await new Promise(resolve=>reserve.close(resolve));
 const child=spawn(process.execPath,[path.resolve('../asset-studio/app/roles/assets.mjs'),'--port',String(port)],{cwd:path.resolve('..'),windowsHide:true,env:{...process.env,ASSET_EDITOR:'http://127.0.0.1:'+editor.address().port,ASSET_STUDIO_DATA_DIR:directory,ASSET_CANVAS_MODULE:path.resolve('../runtime/node/node_modules/@napi-rs/canvas')},stdio:['ignore','pipe','pipe']});let logs='',browser;child.stdout.on('data',b=>logs+=b);child.stderr.on('data',b=>logs+=b);
 t.after(async()=>{await browser?.close();child.kill();editor.closeAllConnections();editor.close();fs.writeFileSync(path.join(directory,'service.log'),logs);});
 const origin='http://127.0.0.1:'+port;await until(async()=>{try{return (await fetch(origin+'/api/health')).ok;}catch{return false;}});
 browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:1864,height:949}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto(origin+'/?record='+recordId);const cancel=page.locator('#cancel-production-generation');await cancel.waitFor({state:'visible'});
 assert.equal(await page.locator('#progress').isVisible(),true);assert.equal(await page.locator('#result').isVisible(),false);
 await page.screenshot({path:path.join(evidence,'asset-cancel-button.png')});
 await page.setViewportSize({width:900,height:1000});await cancel.scrollIntoViewIfNeeded();assert.equal(await cancel.isVisible(),true);
 await cancel.click();await until(async()=>cancellations.length===1);assert.equal(await cancel.isDisabled(),true);
 await cancel.waitFor({state:'hidden'});assert.deepEqual(cancellations,[jobId]);assert.equal(jobs[0].status,'cancelled');assert.equal(jobs[1].status,'running');assert.match(await page.locator('[data-production-status]').innerText(),/已取消/);
 await page.reload();await page.locator('#preview-chip').waitFor();assert.equal(await cancel.isVisible(),false);assert.deepEqual(errors,[]);
 fs.writeFileSync(path.join(evidence,'cancel-report.json'),JSON.stringify({ok:true,cancellations,otherTaskPreserved:jobs[1].status==='running',noNewGeneration:true,errors},null,2));
});

test('对白气泡默认带尾巴，真实鼠标按 Shift 等比缩放，文字框、保存和撤销重做保持',{timeout:40000},async t=>{
 const directory=fs.mkdtempSync(path.join(evidence,'bubble-'));process.env.COMIC_PROJECT_SYNC='0';process.env.COMIC_LIBRARY_CONFIG=path.join(directory,'no-library.json');
 const fake={close(){},status:async()=>({connected:false})},studio=createStudio({dataDir:directory,seedReference:false,bridge:fake,jimengBridge:fake});let browser;t.after(async()=>{await browser?.close();studio.close();studio.server.closeAllConnections();});
 const project=createProject('Shift 气泡缩放合成测试'),board=project.pages[0];board.height=1000;board.panels=[];const original={id:id('bubble'),type:'speech',shape:'none',text:'测试对白不改写。',x:180,y:180,w:440,h:220,textBox:{x:40,y:40,w:320,h:120},fontSize:28,visible:true,tail:{visible:false}};
 const bubble=applyBubbleMaterial(original,'builtin-oval');assert.equal(bubble.tail.visible,true);const styled=applyProductionStyle(structuredClone(original),{boxes:{speech:{styleId:'default'}}});assert.equal(styled.tail.visible,true);
 board.bubbles=[bubble];project.layerOrder=[bubble.id];studio.store.db.projects.push(project);studio.store.save();await new Promise(resolve=>studio.server.listen(0,'127.0.0.1',resolve));
 browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:1864,height:949}}),errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto('http://127.0.0.1:'+studio.server.address().port+'/?project='+project.id);await page.locator('#canvas-tool-dock').waitFor();await page.locator('#zoom').selectOption('0.65');await page.locator('[data-rail-tab="layers"]').click();await page.locator('#layer-list [data-layer="'+bubble.id+'"]').click();await page.locator('[data-bubble-inspector-tab="frame"]').click();assert.equal(await page.locator('[data-section="bubble-tail"][data-field="visible"]').isChecked(),true);
 const group=page.locator('#stage [data-bubble="'+bubble.id+'"]:has(text)');await group.evaluate(el=>el.scrollIntoView({block:'center'}));await page.waitForTimeout(100);
 const handle=page.locator('[data-bubble="'+bubble.id+'"] [data-bubble-handle="resize"]').first(),box=await handle.boundingBox();assert.ok(box);const before=structuredClone(studio.store.project(project.id).pages[0].bubbles[0]);
 await page.keyboard.down('Shift');await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+85,box.y+box.height/2+20,{steps:8});await page.mouse.up();await page.keyboard.up('Shift');await page.keyboard.press('Control+s');await page.waitForFunction(()=>document.querySelector('#save-state').textContent==='已保存到本机');
 const current=()=>studio.store.project(project.id).pages[0].bubbles[0],after=structuredClone(current());assert.ok(after.w>before.w);assert.ok(Math.abs(after.w/after.h-before.w/before.h)<1e-8);assert.deepEqual(after.textBox,before.textBox);assert.equal(after.text,before.text);assert.equal(after.tail.visible,true);
 await page.screenshot({path:path.join(evidence,'bubble-shift-resize.png')});await page.locator('#undo').click();await page.keyboard.press('Control+s');await until(()=>current().w===before.w);await page.locator('#redo').click();await page.keyboard.press('Control+s');await until(()=>current().w===after.w);await page.reload();await page.locator('#canvas-tool-dock').waitFor();assert.equal(current().w,after.w);assert.deepEqual(errors,[]);
 fs.writeFileSync(path.join(evidence,'bubble-report.json'),JSON.stringify({ok:true,ratioBefore:before.w/before.h,ratioAfter:after.w/after.h,textPreserved:true,textBoxPreserved:true,undoRedo:true,errors},null,2));
});
