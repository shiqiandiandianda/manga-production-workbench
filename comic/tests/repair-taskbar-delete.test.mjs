import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const publicRoot=new URL('../public/',import.meta.url);
const proof=path.resolve('../verification/repair-taskbar-delete-20261029');
const statuses=['applied','failed','attention','cancelled','waiting','queued','running','compositing','ready'];
const original=statuses.map((status,i)=>({id:'task-'+i,status,label:'E055-00'+(i+1),instruction:'修正手指数量和关节，保持原有手势、漫画线条、配色和光影。',projectTitle:'示例项目 55—55话 · 导入',createdAt:'2026-10-29T08:00:00Z',completedAt:status==='applied'?'2026-10-29T08:01:53Z':undefined,message:'模拟任务状态'}));

test('修图任务删除：持久化、计数、轮询、跨窗口、键盘与处理中保护',{timeout:60000},async t=>{
 fs.mkdirSync(proof,{recursive:true});
 const server=http.createServer((req,res)=>{
  if(req.url==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(`<html><head><link rel="stylesheet" href="/repair-taskbar.css"></head><body style="background:#111e29;color:white;font-family:Arial"><footer class="job-heading" style="position:fixed;bottom:0;left:0;height:42px"><span class="footer-spacer"></span></footer><script type="module">import {mountRepairTaskbar} from '/repair-taskbar.js';window.tasks=${JSON.stringify(original)};window.located=[];window.calls=[];window.notices=[];window.bar=mountRepairTaskbar({api:async url=>{calls.push(url);return {tasks:structuredClone(tasks)}},canApply:()=>false,apply:()=>{throw Error('不得接回测试任务')},onLocate:t=>located.push(t.id),toast:(...args)=>notices.push(args)});</script></body></html>`);return;}
  if(['/repair-taskbar.js','/repair-taskbar.css'].includes(req.url)){res.setHeader('Content-Type',req.url.endsWith('.js')?'text/javascript':'text/css');res.end(fs.readFileSync(new URL(req.url.slice(1),publicRoot)));return;}res.writeHead(404);res.end();
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close();});
 const browser=await chromium.launch({headless:true,channel:'msedge'});t.after(()=>browser.close());
 const context=await browser.newContext({viewport:{width:1440,height:900}}),page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(e.message));const origin='http://127.0.0.1:'+server.address().port;
 const open=async p=>{await p.goto(origin);await p.locator('#repair-tasks-toggle').click();};await open(page);
 assert.equal(await page.locator('.repair-task-row').count(),9);
 for(let i=4;i<9;i++)assert.equal(await page.locator(`[data-repair-task-delete="task-${i}"]`).isDisabled(),true);
 await page.screenshot({path:path.join(proof,'delete-buttons.png')});
 const other=await context.newPage();await open(other);await page.bringToFront();
 await page.locator('[data-repair-task-delete="task-0"]').click();
 await other.waitForFunction(()=>!document.querySelector('[data-repair-task="task-0"]'));
 assert.deepEqual(await page.evaluate(()=>located),[]);assert.equal(await page.locator('#repair-task-drawer').isVisible(),true);
 await page.evaluate(()=>bar.refresh());assert.equal(await page.locator('.repair-task-row').count(),8);
 await open(page);assert.equal(await page.locator('[data-repair-task="task-0"]').count(),0);
 await page.locator('[data-repair-task-delete="task-1"]').focus();await page.keyboard.press('Enter');
 assert.equal(await page.locator('[data-repair-task="task-1"]').count(),0);
 // A failed job that resumes must become visible and remain eligible for automatic return.
 await page.evaluate(async()=>{tasks[1].status='running';await bar.refresh();});
 assert.equal(await page.locator('[data-repair-task-delete="task-1"]').isDisabled(),true);
 await page.evaluate(async()=>{tasks=[tasks[0],tasks[2]];await bar.refresh();});
 assert.match(await page.locator('#repair-tasks-toggle').textContent(),/1 项需核对/);
 // Storage failure must not remove the row or claim success.
 await page.evaluate(()=>{window.realSet=Storage.prototype.setItem;Storage.prototype.setItem=()=>{throw Error('storage unavailable');};});
 await page.locator('[data-repair-task-delete="task-2"]').click();
 assert.equal(await page.locator('[data-repair-task="task-2"]').count(),1);
 assert.match(await page.evaluate(()=>notices.at(-1)[0]),/未删除/);
 await page.evaluate(()=>{Storage.prototype.setItem=realSet;});
 await page.locator('[data-repair-task-delete="task-2"]').click();
 assert.equal(await page.locator('.repair-task-row').count(),0);assert.equal(await page.locator('#repair-tasks-toggle').textContent(),'修图任务 ▴');
 assert.match(await page.locator('.repair-task-empty').textContent(),/暂无/);
 await page.evaluate(async()=>{tasks=[{...tasks[0],id:'new-result'}];await bar.refresh();});
 assert.match(await page.locator('#repair-tasks-toggle').textContent(),/1 张/);
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(proof,'mobile-delete-button.png')});
 const box=await page.locator('.repair-task-delete').boundingBox();assert.ok(box.x>=0&&box.x+box.width<=390);
 await page.locator('[data-repair-task="new-result"]').click();assert.deepEqual(await page.evaluate(()=>located),['new-result']);
 assert.equal(await page.locator('#repair-task-drawer').isVisible(),false);
 assert.ok((await page.evaluate(()=>calls)).every(url=>url==='/api/integrated-repair/tasks'));assert.deepEqual(errors,[]);
 fs.writeFileSync(path.join(proof,'acceptance.json'),JSON.stringify({passed:true,syntheticTasksOnly:true,persistentDeletion:true,pollRecovery:true,crossWindow:true,activeTaskProtection:true,keyboard:true,storageFailure:true,newResultsVisible:true,navigation:true,noMutationRequests:true,browserErrors:errors},null,2));
});
