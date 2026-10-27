import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url)),require=createRequire(import.meta.url);
const {chromium}=require(path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const harness=`<!doctype html><meta charset="utf-8"><title>合成全部资料导出测试</title><script type="module">
import {mountNovelProductionUI} from '/novel-production-ui.js';
window.project={id:'synthetic-project',revision:7};window.requests=[];window.flushes=0;window.toasts=[];window.rejectPreserve=false;
window.fixture={project:window.project,workflow:{inputs:{},issues:[],decisions:[],versions:[],jobs:[]},originalFilesSummary:{files:[{role:'novel',name:'合成小说.txt',hash:'synthetic-hash-a',size:8,status:'missing',current:true},{role:'client',name:'合成甲方.xlsx',hash:'synthetic-hash-b',size:8,status:'corrupt',current:false}],totalCount:2,preservedCount:0,missingCount:2}};
window.ui=mountNovelProductionUI({getProject:()=>window.project,flushSave:async()=>{window.flushes++;},toast:message=>window.toasts.push(message),onProject:next=>{window.project=next;},api:async(url,method,payload)=>{
window.requests.push({url,method:method||'GET',payload});
if(url.includes('export=all')){await new Promise(resolve=>{window.releaseExport=resolve;});return {archive:{filename:'合成全部资料.zip',mime:'application/zip',downloadUrl:'/synthetic-download.zip'},fileCount:13,missingCount:3,originalMissingCount:2,warnings:['合成提示：部分图片缺失']};}
if(url.includes('export=bundle'))return {archive:{filename:'同版资料.zip',mime:'application/zip',base64:btoa('synthetic bundle')},files:[{},{},{},{}]};
if(method==='POST'&&payload.operation==='preserve-originals'){
if(window.rejectPreserve)throw Error('合成测试：原文件校验码不匹配');
window.fixture.originalFilesSummary={files:window.fixture.originalFilesSummary.files.map(file=>({...file,status:'preserved'})),totalCount:2,preservedCount:2,missingCount:0};
return structuredClone(window.fixture);
}
return structuredClone(window.fixture);
}});
await window.ui.open({tab:'export'});window.ready=true;
</script>`;

test('browser: all-materials export without draft, missing-original recovery, version and narrow-screen UI',{timeout:60000},async t=>{
 const directory=fs.mkdtempSync(path.join(root,'.runtime/temp/all-materials-ui-'));
 const browser=await chromium.launch({channel:'msedge',headless:true,env:{...process.env,TEMP:directory,TMP:directory}});
 t.after(async()=>{await browser.close();});
 const context=await browser.newContext({viewport:{width:1366,height:1000},acceptDownloads:true});
 await context.route('**/*',route=>{
  const url=new URL(route.request().url());
  if(url.origin!=='http://all-materials.synthetic'&&!['data:','blob:'].includes(url.protocol))return route.abort();
  if(['data:','blob:'].includes(url.protocol))return route.continue();
  if(url.pathname==='/')return route.fulfill({contentType:'text/html',body:harness});
  if(url.pathname==='/synthetic-download.zip')return route.fulfill({headers:{'content-type':'application/zip','content-disposition':'attachment; filename="synthetic-all.zip"'},body:Buffer.from('synthetic zip')});
  const name=url.pathname.slice(1);if(!/^[a-z0-9-]+\.js$/u.test(name))return route.abort();
  return route.fulfill({contentType:'text/javascript',body:fs.readFileSync(path.join(root,'public',name))});
 });
 const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto('http://all-materials.synthetic/');await page.waitForFunction(()=>window.ready);
 const dialog=page.locator('.np-dialog'),all=dialog.locator('[data-action="export-all"]'),sameVersion=dialog.locator('[data-action="export"]');
 assert.equal(await dialog.locator('[data-tab="export"]').getAttribute('aria-current'),'true');
 assert.equal(await all.isEnabled(),true);assert.equal(await sameVersion.isDisabled(),true);
 assert.match(await dialog.innerText(),/原件缺失/);assert.match(await dialog.innerText(),/原件损坏/);assert.match(await dialog.innerText(),/历史来源/);
 const flushBefore=await page.evaluate(()=>window.flushes);await all.click();
 await page.waitForFunction(()=>typeof window.releaseExport==='function');assert.equal(await all.isDisabled(),true);
 assert.match(await dialog.locator('.np-status').innerText(),/保存工程并打包/);
 assert.equal(await page.evaluate(()=>window.flushes),flushBefore+1);
 assert.equal(await page.evaluate(()=>window.requests.at(-1).url),'/api/projects/synthetic-project/novel-production?export=all');
 const downloaded=page.waitForEvent('download');await page.evaluate(()=>window.releaseExport());await downloaded;
 await page.waitForFunction(()=>document.querySelector('.np-status').textContent.includes('已导出全部资料包'));
 assert.match(await dialog.locator('.np-status').innerText(),/3 项缺失/);assert.match(await dialog.locator('.np-status').innerText(),/2 份上传原文件需要补存/);assert.equal(await all.isEnabled(),true);

 await dialog.locator('[data-original-file]').setInputFiles([{name:'合成小说.txt',mimeType:'text/plain',buffer:Buffer.from('合成原著')},{name:'合成甲方.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from('合成甲方')},{name:'误选.txt',mimeType:'text/plain',buffer:Buffer.from('误选')}]);
 await page.waitForFunction(()=>document.querySelectorAll('[data-original-pending]').length===3&&document.querySelector('[data-action="preserve-originals"]').disabled===false);
 await dialog.locator('[data-action="remove-original:2"]').click();assert.equal(await dialog.locator('[data-original-pending]').count(),2);assert.equal(await all.isEnabled(),true);
 await page.evaluate(()=>window.rejectPreserve=true);await dialog.locator('[data-action="preserve-originals"]').click();
 await page.waitForFunction(()=>document.querySelector('.np-status').textContent.includes('校验码不匹配'));
 assert.equal(await dialog.locator('[data-original-pending]').count(),2);assert.equal(await dialog.locator('[data-action="preserve-originals"]').isEnabled(),true);
 await page.evaluate(()=>window.rejectPreserve=false);await dialog.locator('[data-action="preserve-originals"]').click();
 await page.waitForFunction(()=>document.querySelector('.np-status').textContent.includes('补存已完成'));
 const preserved=await page.evaluate(()=>window.requests.findLast(request=>request.payload?.operation==='preserve-originals'));
 assert.equal(preserved.payload.expectedRevision,7);assert.deepEqual(preserved.payload.files.map(file=>file.name),['合成小说.txt','合成甲方.xlsx']);
 assert.equal(preserved.payload.files[0].base64,Buffer.from('合成原著').toString('base64'));
 assert.equal(await dialog.locator('[data-original-file]').count(),0);assert.match(await dialog.innerText(),/已保存 2 \/ 2/);

 await page.evaluate(async()=>{window.fixture.workflow.versions=[{id:'synthetic-v1',created:'2026-10-14T08:00:00',contentHash:'synthetic-hash',model:{rows:[{}]},audit:{coverage:{suppliedChapters:[1]}}}];window.fixture.workflow.activeVersionId='synthetic-v1';window.ui.close();await window.ui.open({tab:'export'});});
 assert.equal(await sameVersion.isEnabled(),true);await all.click();
 await page.waitForFunction(()=>window.requests.at(-1).url.includes('export=all&versionId=synthetic-v1'));
 const secondDownload=page.waitForEvent('download');await page.evaluate(()=>window.releaseExport());await secondDownload;
 await page.waitForFunction(()=>document.querySelector('[data-action="export-all"]').disabled===false);
 const oldDownload=page.waitForEvent('download');await sameVersion.click();await oldDownload;
 await page.waitForFunction(()=>document.querySelector('.np-status').textContent.includes('已导出同版 4 份资料'));
 for(const width of [800,390]){await page.setViewportSize({width,height:900});const box=await dialog.boundingBox(),button=await all.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=width+1);assert.ok(button.x>=box.x&&button.x+button.width<=box.x+box.width+1);}
 const evidence=path.join(root,'merge-audit','all-materials-export');fs.mkdirSync(evidence,{recursive:true});await dialog.screenshot({path:path.join(evidence,'export-narrow.png')});
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(evidence,'ui-report.json'),JSON.stringify({ok:true,syntheticOnly:true,serverStarted:false,realAI:false,checks:['no-version export','save before export','packaging state','same-origin streamed download','missing/corrupt sources','hash-mismatch retry','multi-file preservation','selected version','legacy bundle','narrow screens'],errors},null,2)+'\n');
});
