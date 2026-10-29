import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createStudio} from '../server.mjs';
import {createProject,id} from '../public/model.js';
import {migrateLayerDocument} from '../public/layers.js';
import {taskCardMarkup} from '../public/job-cards.js';

test('失败任务删除：状态增量同步、重复删除、保留原文件和工程、浏览器刷新后不再显示',{timeout:60000},async t=>{
 const evidence=path.resolve('../evidence');fs.mkdirSync(evidence,{recursive:true});const dir=fs.mkdtempSync(path.join(evidence,'failed-jobs-'));
 process.env.COMIC_PROJECT_SYNC='0';process.env.COMIC_SLOT_DIR=path.join(dir,'slots');process.env.COMIC_LIBRARY_CONFIG=path.join(dir,'library.json');fs.writeFileSync(process.env.COMIC_LIBRARY_CONFIG,'{"base":"http://127.0.0.1:9"}');
 let generated=0;const fake={close(){},status:async()=>({connected:false}),generate(){generated++;throw Error('禁止生成');}};
 const studio=createStudio({dataDir:path.join(dir,'data'),seedReference:false,bridge:fake,jimengBridge:fake});await new Promise(r=>studio.server.listen(0,'127.0.0.1',r));t.after(()=>{studio.close();studio.server.closeAllConnections();});const origin='http://127.0.0.1:'+studio.server.address().port;
 const p=migrateLayerDocument(createProject('删除失败记录隔离测试')).project;studio.store.db.projects.push(p);
 const makeJob=status=>({id:id('job'),projectId:p.id,panelId:p.pages[0].panels[0].id,shotId:p.shots[0].id,shotCode:'S001',provider:'codex',status,message:'合成任务',created:new Date().toISOString(),updated:new Date().toISOString()}),failed=makeJob('failed'),browserJob=makeJob('failed'),others=['done','cancelled','running','awaiting_confirmation','recoverable'].map(makeJob);studio.store.db.jobs.push(failed,browserJob,...others);studio.store.save();
 const jobDir=path.join(dir,'data','jobs',failed.id);fs.mkdirSync(jobDir,{recursive:true});const original=path.join(jobDir,'original.png');fs.writeFileSync(original,'原始图片占位，删除记录不得动此文件');const before=JSON.stringify(p),bytes=fs.readFileSync(original);
 const initial=await(await fetch(origin+'/api/state')).json();assert.ok(initial.jobs.some(j=>j.id===failed.id));
 const deleted=await fetch(origin+'/api/jobs/'+failed.id,{method:'DELETE'});assert.equal(deleted.status,200);assert.equal((await deleted.json()).deleted,true);assert.ok(failed.dismissedAt);
 const delta=await(await fetch(origin+'/api/state?known='+encodeURIComponent(JSON.stringify(initial.stamps)))).json();assert.equal(delta.incremental,true);assert.ok(!delta.jobIds.includes(failed.id));assert.ok(delta.jobIds.includes(browserJob.id));assert.equal((await fetch(origin+'/api/jobs/'+failed.id,{method:'DELETE'})).status,200);
 for(const job of others){assert.equal((await fetch(origin+'/api/jobs/'+job.id,{method:'DELETE'})).status,409);assert.equal(job.dismissedAt,undefined);assert.doesNotMatch(taskCardMarkup(job,{project:p,escape:String}),/data-delete-job/);}
 assert.equal((await fetch(origin+'/api/jobs/'+id('job'),{method:'DELETE'})).status,404);assert.deepEqual(fs.readFileSync(original),bytes);assert.equal(JSON.stringify(p),before);assert.ok(studio.store.db.jobs.includes(failed));
 studio.store.db.jobs=studio.store.db.jobs.filter(j=>!others.includes(j));studio.store.save();
 const {chromium}=createRequire(import.meta.url)('playwright');const browser=await chromium.launch({channel:'msedge',headless:true});t.after(()=>browser.close());const page=await browser.newPage({viewport:{width:1600,height:950}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'/?project='+p.id,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>document.querySelector('#project-label')?.textContent.includes('删除失败记录隔离测试'));await page.locator('#jobs-toggle').click();await page.locator('[data-delete-job="'+browserJob.id+'"]').waitFor();assert.match(await page.locator('#job-count').textContent(),/失败 1/);
 await page.screenshot({path:path.join(evidence,'failed-task-delete-button.png')});await page.locator('[data-delete-job="'+browserJob.id+'"]').click();await page.waitForFunction(id=>!document.querySelector('[data-task-card="'+id+'"]'),browserJob.id);assert.doesNotMatch(await page.locator('#job-count').textContent(),/失败/);
 await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>document.querySelector('#project-label')?.textContent.includes('删除失败记录隔离测试'));assert.equal(await page.locator('[data-task-card]').count(),0);assert.ok(browserJob.dismissedAt);assert.deepEqual(fs.readFileSync(original),bytes);assert.equal(JSON.stringify(studio.store.project(p.id)),before);assert.equal(generated,0);assert.deepEqual(errors,[]);
 const stored=JSON.parse(fs.readFileSync(path.join(dir,'data','studio.json'),'utf8'));assert.ok(stored.jobs.find(j=>j.id===browserJob.id).dismissedAt);
});
