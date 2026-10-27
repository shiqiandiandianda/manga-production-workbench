import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {createStudio} from '../server.mjs';
import {writeXlsx} from '../lib/xlsx.mjs';

const root=fileURLToPath(new URL('../',import.meta.url)),require=createRequire(import.meta.url);
const deps=path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules');
const {chromium}=require(path.join(deps,'playwright'));
const fixture=JSON.parse(fs.readFileSync(new URL('./fixtures/xlsx-camera-structure.json',import.meta.url),'utf8'));

test('浏览器实际 XLSX：先检查、人工批量/选值、取消零写入、换文件清决定、确认保存重开', {timeout:120000},async t=>{
 const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'comic-browser-xlsx-')),data=path.join(temporary,'data'),calls=[];
 const blocked={status:async()=>{calls.push('account');throw Error('No account calls');},generate:async()=>{calls.push('generation');throw Error('No generation calls');},close(){}};
 const studio=createStudio({dataDir:data,bridge:blocked,jimengBridge:blocked});
 await new Promise(r=>studio.server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+studio.server.address().port;let browser;
 t.after(async()=>{await browser?.close();studio.close();await new Promise(r=>studio.server.close(r));assert.equal(path.dirname(path.resolve(temporary)),path.resolve(os.tmpdir()));fs.rmSync(temporary,{recursive:true,force:true});assert.deepEqual(calls,[]);});
 const synthetic=path.join(temporary,'真实结构 合成内容.xlsx');
 fs.writeFileSync(synthetic,writeXlsx(fixture.sheets.map(s=>({name:s.name,rows:[[s.name+' 合成测试'],fixture.headers,...s.rows.map(r=>[r.panel,'甲','合成场景','晴','日',s.name==='第17话'&&r.row===12?'大全景':'中景',r.angle,'甲与乙核对线索，中景。','甲：合成原句。','',''])]}))));
 const replacement=path.join(temporary,'换文件.csv');fs.writeFileSync(replacement,'画面内容,机位角度\n新文件合成画面,正视\n','utf8');
 const input=process.env.COMIC_REAL_XLSX||synthetic,hash=()=>createHash('sha256').update(fs.readFileSync(input)).digest('hex'),before=hash(),checks=[],errors=[],requests=[];
 browser=await chromium.launch({channel:'msedge',headless:true,args:['--disable-gpu']});
 const context=await browser.newContext({viewport:{width:1540,height:980}});
 await context.route('**/*',r=>['127.0.0.1'].includes(new URL(r.request().url()).hostname)||['data:','blob:'].includes(new URL(r.request().url()).protocol)?r.continue():r.abort());
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
 const state=async()=>(await fetch(origin+'/api/state')).json();
 const checkpoint=name=>{assert.deepEqual(errors,[]);checks.push(name);console.log('PASS '+name);};
 async function action(method,run,suffix=''){
  const pending=page.waitForResponse(r=>r.url().includes('/api/storyboards/check')&&r.request().method()===method&&(!suffix||r.url().endsWith(suffix)));
  await run();const response=await pending,result=await response.json();assert.equal(response.status(),200,JSON.stringify(result));return result;
 }
 async function open(file){await page.locator('#rule-import-empty').click();await page.locator('#rule-profile').selectOption('dazhou-xuanyiwei');const s=await action('POST',()=>page.locator('#rule-file').setInputFiles(file));await page.locator('#storyboard-check').waitFor();return s;}
 const batch=()=>action('PATCH',()=>page.locator('[data-check-batch="all"]').click());
 const confirm=async()=>{const s=await action('POST',()=>page.getByRole('button',{name:'确认摘要，开始整话试排',exact:true}).click(),'/confirm');await page.locator('.rule-stats strong').waitFor();return s;};
 const choose=async(cell,value)=>{const card=page.locator('.check-issue').filter({has:page.locator('strong',{hasText:cell})});await card.locator('select').selectOption(value);assert.match(await card.locator('[data-check-preview]').textContent(),/处理预览/);return action('PATCH',()=>card.getByRole('button',{name:'应用所选方案',exact:true}).click());};

 await page.goto(origin);const originalDB=fs.readFileSync(studio.store.file,'utf8');let s=await open(input);
 assert.equal(s.sheets.length,10);assert.equal(s.sheets.reduce((n,v)=>n+v.rows,0),292);assert.equal(s.issues.find(i=>i.cell==='G4').originalValue,'正视');
 assert.equal(s.issues.find(i=>i.cell==='G4').suggestions[0].value,'正面拍摄');assert.equal(s.rows[1].cameraAngle,'正视');
 assert.equal(await page.getByRole('button',{name:'确认摘要，开始整话试排',exact:true}).isDisabled(),true);
 for(const cell of ['第15话!G17','第15话!G31','第17话!F12','第17话!G17','第19话!G26','第19话!G34','第20话!G26'])assert.ok((await page.locator('#check-workbook-blocking').textContent()).includes(cell));
 checkpoint('actual 10-sheet preflight exposes G4 proposal and all 7 blocking locations');
 const visual=path.join(root,'test-output','preflight-issues.png');fs.mkdirSync(path.dirname(visual),{recursive:true});await page.locator('#check-workbook-blocking').screenshot({path:visual});
 const group=page.locator('.check-aliases details').filter({has:page.locator('summary',{hasText:'正视 → 正面拍摄'})});await group.locator('summary').click();
 s=await action('PATCH',()=>group.getByRole('button',{name:'确认这 14 处同类建议',exact:true}).click());assert.equal(s.decisions.length,14);assert.equal(s.rows[1].cameraAngle,'正面拍摄');assert.equal(s.rows[1].cameraAngleRaw,'正视');
 checkpoint('reviewed batch of identical aliases retains raw value and cell provenance');
 await action('DELETE',()=>page.getByRole('button',{name:'取消检查，不创建工程',exact:true}).click());await page.locator('#rule-dialog').waitFor({state:'hidden'});
 assert.equal(fs.readFileSync(studio.store.file,'utf8'),originalDB);assert.deepEqual((await state()).projects,[]);
 s=await open(replacement);assert.equal(s.decisions.length,0);assert.equal(s.issues[0].originalValue,'正视');assert.notEqual(s.fileKey,before);
 await action('DELETE',()=>page.keyboard.press('Escape'));await page.locator('#rule-dialog').waitFor({state:'hidden'});
 assert.equal(fs.readFileSync(studio.store.file,'utf8'),originalDB);checkpoint('button and Escape cancel leave database byte-identical; replacement inherits no decision');

 s=await open(input);s=await batch();assert.equal(s.summary.ready,true);const first=await confirm();assert.equal(first.shots.length,30);assert.equal(first.shots[1].cameraAngle,'正面拍摄');assert.equal(await page.locator('#rule-sheet').inputValue(),'第11话');assert.match(await page.locator('.comic-composition-stats').textContent(),/大周玄衣卫/);
 assert.deepEqual((await state()).projects,[]);checkpoint('reviewed first episode plans 30 shots with selected template before any database write');
 s=await action('POST',()=>page.locator('#rule-sheet').selectOption('第15话'));await page.locator('#check-sheet').waitFor();assert.equal(s.sheet,'第15话');assert.equal(s.decisions.length,0);assert.equal(s.summary.blocking,2);s=await batch();
 await choose('第15话!G17','仰拍');s=await choose('第15话!G31','');assert.equal(s.summary.ready,true);const fifteenth=await confirm();assert.equal(fifteenth.shots.length,29);assert.equal(fifteenth.shots.find(r=>r.sourceRow===17).cameraAngle,'仰拍');assert.equal(fifteenth.shots.find(r=>r.sourceRow===31).cameraAngle,undefined);assert.equal(fifteenth.shots.find(r=>r.sourceRow===31).cameraAngleRaw,'特写');
 checkpoint('both special-angle rows support manual angle and explicit unspecified without dropping shots');
 s=await action('POST',()=>page.locator('#rule-sheet').selectOption('第17话'));await page.locator('#check-sheet').waitFor();assert.equal(s.summary.blocking,2);s=await batch();
 await choose('第17话!F12','全景');s=await choose('第17话!G17','');const seventeenth=await confirm();assert.equal(seventeenth.shots.length,25);assert.equal(seventeenth.shots.find(r=>r.sourceRow===12).shotSize,'全景');assert.equal(await page.locator('#rule-sheet').inputValue(),'第17话');
 checkpoint('worksheet change keeps selector and requires fresh review of unsupported size and angle');
 const saving=page.waitForResponse(r=>r.url()===origin+'/api/projects/rule-layout'&&r.request().method()==='POST',{timeout:8000});await page.getByRole('button',{name:'保存并打开整话',exact:true}).click();const saveResponse=await saving.catch(async error=>{throw new Error(error.message+'; visible UI message: '+await page.locator('#toast').textContent());});assert.equal(saveResponse.status(),201,JSON.stringify(await saveResponse.json()));await page.locator('#rule-dialog').waitFor({state:'hidden',timeout:5000}).catch(async error=>{throw new Error(error.message+'; visible UI message: '+await page.locator('#toast').textContent());});
 let saved=(await state()).projects.at(-1);assert.equal(saved.shots.length,25);assert.equal(saved.pages.length,1);assert.equal(saved.ruleLayout.options.template,'dazhou-xuanyiwei');assert.deepEqual(saved.shots.map(r=>r.dialogue),seventeenth.shots.map(r=>r.dialogue));assert.equal(saved.importReview.fileKey,before);
 assert.ok(saved.importReview.decisions.some(d=>d.cell==='F12'&&d.originalValue==='大全景'&&d.value==='全景'));assert.equal(saved.shots.find(r=>r.sourceRow===17).cameraAngleRaw,'特写');
 await page.reload();await page.waitForFunction(()=>document.querySelector('#project-label')?.textContent.includes('第17话'));saved=(await state()).projects.at(-1);assert.equal(saved.shots.length,25);assert.equal(saved.shots.find(r=>r.sourceRow===17).cameraAngle,undefined);assert.equal(hash(),before);
 checkpoint('confirmed project saves and reopens with raw values, manual audit and unchanged workbook');
 assert.equal(requests.some(u=>/\/api\/(codex|jimeng)(\/|$)/.test(u)),false);assert.deepEqual(errors,[]);assert.deepEqual(calls,[]);
 fs.writeFileSync(path.join(root,'merge-audit/xlsx-browser-report.json'),JSON.stringify({ok:true,checks,originalWorkbookUnchanged:true,sourceSHA256:before,actualUserWorkbook:!!process.env.COMIC_REAL_XLSX,pageErrors:errors,accountRequests:0,generationCalls:0,externalNetwork:false,decisionsAreTestOnly:true,deployedUserProjectsUnchanged:true,sourceVerified:{codeRoot:root,dataRoot:data}},null,2)+'\n');
});
