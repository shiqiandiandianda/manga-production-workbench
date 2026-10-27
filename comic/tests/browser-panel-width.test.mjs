import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {createRequire} from 'node:module';import {fileURLToPath} from 'node:url';
import {createStudio} from '../server.mjs';import {createProject,panel,id,bounds} from '../public/model.js';import {normalizeLayerOrder} from '../public/layers.js';import {attachBubbleGroups} from '../public/layer-groups.js';
const root=fileURLToPath(new URL('../',import.meta.url)),require=createRequire(import.meta.url),{chromium}=require(path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));

test('真实鼠标：格子移动与角点不会越过画板左右边缘，可撤销、保存和重开',{timeout:60000},async t=>{
 const directory=path.join(root,'merge-audit','panel-width',String(Date.now())+'-'+process.pid);fs.mkdirSync(directory,{recursive:true});
 const calls=[],fake={status:async()=>{calls.push('account');throw Error('禁止真实连接');},close(){}};
 const studio=createStudio({dataDir:path.join(directory,'data'),bridge:fake,jimengBridge:fake,storyboardGenerator:{generate(){throw Error('禁止生成');},close(){}}});
 const project=createProject('水平边界合成验收'),owner=project.pages[0],frame=panel(project.shots[0].id,100,200,400,450);owner.height=2000;owner.panels=[frame];owner.bubbles=[{id:id('bubble'),parentPanelId:frame.id,shotId:frame.shotId,type:'speech',shape:'oval',visible:true,x:140,y:150,w:180,h:80,fontSize:24,text:'合成对白',tail:{mode:'absolute',x:250,y:240,visible:true}}];project.editorLayoutVersion=2;project.layerSchema=1;attachBubbleGroups(project);normalizeLayerOrder(project);studio.store.db.projects.push(project);studio.store.save();
 await new Promise(resolve=>studio.server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+studio.server.address().port;
 let browser;const errors=[],checks=[];t.after(async()=>{await browser?.close();studio.close();});
 browser=await chromium.launch({channel:'msedge',headless:true,args:['--disable-gpu']});const context=await browser.newContext({viewport:{width:1864,height:980}});
 await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin!==origin||/^\/api\/(codex|jimeng|jobs)(\/|$)/.test(url.pathname))return route.abort();return route.continue();});
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(origin);await page.waitForFunction(()=>document.querySelector('#project-label')?.textContent==='水平边界合成验收');await page.locator('#zoom').selectOption('0.65');
 const saved=async()=>{await page.waitForFunction(()=>document.querySelector('#save-state')?.textContent==='已保存到本机');return (await (await fetch(origin+'/api/state')).json()).projects[0];};
 const point=async(x,y)=>page.evaluate(({x,y,pageId})=>{const matrix=document.querySelector('#stage [data-page-id="'+pageId+'"]').getScreenCTM(),p=new DOMPoint(x,y).matrixTransform(matrix);return {x:p.x,y:p.y};},{x,y,pageId:owner.id});
 async function drag(from,to){const a=await point(...from),b=await point(...to);fs.writeFileSync(path.join(directory,'drag-hit.json'),JSON.stringify({from:a,to:b,hit:await page.evaluate(({x,y})=>document.elementFromPoint(x,y)?.outerHTML,a)},null,2));await page.screenshot({path:path.join(directory,'before-drag.png')});await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:12});await page.mouse.up();return saved();}
 const box=p=>{const f=p.pages[0].panels[0],b=bounds(f);assert.ok(f.x+b.x>=-1e-6);assert.ok(f.x+b.x+b.w<=1280+1e-6);return f;};
 const check=label=>{assert.deepEqual(errors,[]);checks.push(label);};
 try{
  await saved();await page.locator('#stage [data-panel="'+frame.id+'"]').first().scrollIntoViewIfNeeded();await page.locator('.dock-primary-tools [data-tool="move"]').click();let p=await drag([300,400],[1900,400]);assert.equal(box(p).x,880);assert.equal(p.pages[0].bubbles[0].x,920);check('right boundary and linked dialogue');
  p=await drag([1080,400],[-250,400]);assert.equal(box(p).x,0);assert.equal(p.pages[0].bubbles[0].x,40);check('left boundary and linked dialogue');
  await page.locator('#undo').click();p=await saved();assert.equal(box(p).x,880);await page.locator('#undo').click();p=await saved();assert.equal(box(p).x,100);check('undo restores each complete gesture');
  await page.locator('.dock-primary-tools [data-tool="rect"]').click();p=await drag([500,650],[1900,650]);assert.equal(box(p).x+box(p).w,1280);check('rectangle corner stops at canvas edge');
  await page.locator('#undo').click();p=await saved();assert.equal(box(p).w,400);
  await page.locator('.dock-primary-tools [data-tool="rect"]').click();if(!await page.locator('#canvas-tool-dock').isVisible())await page.locator('#canvas-tools-toggle').click();await page.locator('[data-tool="nodes"]').click();p=await drag([500,200],[1900,200]);const node=box(p);assert.equal(node.x+node.points[1].x*node.w,1280);check('polygon node stops at canvas edge');
  await page.screenshot({path:path.join(directory,'node-at-right-edge.png')});await page.reload();await page.waitForFunction(()=>document.querySelector('#project-label')?.textContent==='水平边界合成验收');p=await saved();box(p);check('save and reopen preserve constrained polygon');
  assert.deepEqual(calls,[]);fs.writeFileSync(path.join(directory,'report.json'),JSON.stringify({ok:true,checks,pageErrors:errors,realAI:false,userDataModified:false,directory},null,2));
 }catch(error){await page.screenshot({path:path.join(directory,'failure.png')});throw error;}
});
