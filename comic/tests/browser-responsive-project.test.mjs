import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {createRequire} from 'node:module';
import {createStudio} from '../server.mjs';import {createProject} from '../public/model.js';import {migrateLayerDocument} from '../public/layers.js';import {ensureLayoutHistory} from '../public/layout-history.js';
const require=createRequire(import.meta.url),{chromium}=require(path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
test('侧栏窄窗口不重叠、更多菜单保留原功能，关闭项目后不自动重开且可重新选择',{timeout:60000},async t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'comic-responsive-project-'));const evidence=path.resolve('merge-audit/project-import');fs.mkdirSync(evidence,{recursive:true});let browser;
  const fake={status:async()=>({connected:false,message:'合成测试'}),close(){}};
  const studio=createStudio({dataDir:directory,bridge:fake,jimengBridge:fake,storyboardGenerator:{close(){}}});
  await new Promise(resolve=>studio.server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await browser?.close();studio.close();await new Promise(resolve=>studio.server.close(resolve));assert.equal(path.dirname(path.resolve(directory)),path.resolve(os.tmpdir()));fs.rmSync(directory,{recursive:true,force:true});});
  const project=migrateLayerDocument(createProject('响应布局 · 已保存工程',true)).project;ensureLayoutHistory(project);project.references=[];project.shots.forEach(shot=>shot.referenceIds=[]);studio.store.db.projects.push(project);studio.store.save();
  const origin='http://127.0.0.1:'+studio.server.address().port;
  browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});const context=await browser.newContext({viewport:{width:1864,height:949}});const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await context.route('**/*',route=>{const u=new URL(route.request().url());return ['localhost','127.0.0.1'].includes(u.hostname)||['data:','blob:'].includes(u.protocol)?route.continue():route.abort();});
  await page.goto(origin);await page.waitForFunction(()=>document.querySelector('#save-state').textContent==='已保存到本机');
  // Show the same summary row as a rule-imported project, without changing user data.
  const sizes=[[1864,949],[1024,768],[614,875],[375,667],[245,353]];const results=[];
  for(const [width,height] of sizes){
    await page.setViewportSize({width,height});await page.waitForTimeout(70);
    const layout=await page.evaluate(()=>{const nodes=['.topbar','.canvas-toolbar','.app-shell','.job-tray'].map(selector=>{const el=document.querySelector(selector),r=el.getBoundingClientRect();return {selector,top:r.top,bottom:r.bottom,height:r.height,scrollHeight:el.scrollHeight};});return {nodes,width:innerWidth,scrollWidth:document.documentElement.scrollWidth,controls:[...document.querySelectorAll('.topbar>button,.topbar>.project-switcher,.topbar>.responsive-more-wrap')].filter(el=>getComputedStyle(el).display!=='none').map(el=>{const r=el.getBoundingClientRect();return {id:el.id,left:r.left,right:r.right,bottom:r.bottom};})};});
    for(let i=0;i<layout.nodes.length-1;i++)assert.ok(layout.nodes[i].bottom<=layout.nodes[i+1].top+1,JSON.stringify(layout));
    assert.ok(layout.nodes[2].height>=70,JSON.stringify(layout));assert.ok(layout.scrollWidth<=width+1,JSON.stringify(layout));
    assert.ok(layout.controls.every(control=>control.left>=0&&control.right<=width+1&&control.bottom<=layout.nodes[0].bottom+1),JSON.stringify(layout));
    if(width<=1000){await page.getByRole('button',{name:'更多工具',exact:true}).click();assert.equal(await page.locator('#storyboard-workflow-open').isVisible(),true);assert.equal(await page.locator('#export-toggle').isVisible(),true);await page.keyboard.press('Escape');}
    await page.screenshot({path:path.join(evidence,'responsive-'+width+'.png')});results.push(layout);
  }
  await page.setViewportSize({width:245,height:353});await page.locator('#panel-tool-toggle').click();
  const visibleShape=page.getByRole('button',{name:'编辑轮廓 / 自由节点',exact:true});assert.equal(await visibleShape.isVisible(),true);const menuBox=await page.locator('#panel-tool-menu').boundingBox();assert.ok(menuBox.x>=0&&menuBox.x+menuBox.width<=245&&menuBox.y+menuBox.height<=353);await visibleShape.click();assert.equal(await page.locator('#panel-tool-menu').isVisible(),false);
  await page.setViewportSize({width:614,height:875});await page.locator('#project-trigger').click();await page.getByRole('button',{name:'关闭当前项目',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#project-label').textContent==='选择 / 新建漫画');assert.equal(studio.store.db.projects.length,1);await page.reload();await page.waitForFunction(()=>document.querySelector('#project-label').textContent==='选择 / 新建漫画');
  await page.locator('#project-trigger').click();await page.locator('[data-choose-project="'+project.id+'"]').click();await page.waitForFunction(()=>document.querySelector('#project-label').textContent.includes('已保存工程'));await page.reload();await page.waitForFunction(()=>document.querySelector('#project-label').textContent.includes('已保存工程'));
  await page.locator('#project-trigger').click();await page.screenshot({path:path.join(evidence,'close-project-menu.png')});await page.keyboard.press('Escape');
  if(process.env.COMIC_USER_IMPORT_FIXTURE){
    await page.setViewportSize({width:1864,height:949});await page.locator('#project-trigger').click();await page.locator('#new-project').click();await page.locator('#new-title').fill('独立新项目 · 分镜导入验证');await page.getByRole('button',{name:'创建',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#project-label').textContent.includes('独立新项目'));
    await page.locator('#rule-import').click();await page.locator('#rule-file').setInputFiles(process.env.COMIC_USER_IMPORT_FIXTURE);await page.getByRole('button',{name:'确认摘要，开始整话试排',exact:true}).waitFor({state:'visible'});
    assert.equal(await page.locator('#check-sheet option').count(),10);assert.ok((await page.locator('.rule-body').textContent()).includes('292 格'));
    await page.getByRole('button',{name:'确认摘要，开始整话试排',exact:true}).click();await page.getByRole('button',{name:'保存并打开整话',exact:true}).waitFor({state:'visible'});assert.equal(await page.getByRole('button',{name:'保存并打开整话',exact:true}).isEnabled(),true);
    await page.screenshot({path:path.join(evidence,'real-file-trial.png')});await page.getByRole('button',{name:'保存并打开整话',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('#rule-dialog').open);
    const imported=studio.store.db.projects.at(-1);assert.equal(imported.shots.length,30);assert.ok(imported.shots.every(shot=>shot.sourceSheet==='分镜'));assert.equal(studio.store.db.projects[0].id,project.id);assert.equal(studio.store.db.projects[0].shots.length,project.shots.length);
  }
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(evidence,'responsive-report.json'),JSON.stringify({ok:true,results,errors,synthetic:true,realGeneration:false},null,2));
});
