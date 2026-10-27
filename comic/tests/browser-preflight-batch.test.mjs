import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fixture,bytes,hash,verifyOriginalRows,originalRows,evidence,root} from './helpers/preflight-batch-fixture.mjs';

const require=createRequire(import.meta.url),dependencies=path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules');
const {chromium}=require(path.join(dependencies,'playwright'));

test('浏览器批量导入：一键处理三话、Codex 一次点击、失败/取消恢复按钮，无逐行点击', {timeout:120000},async t=>{
  let transportMode='success',entered,release;
  const f=await fixture(t,'browser',{generate:async({onProgress})=>{
    onProgress?.({type:'progress',message:'合成 Codex 正在批量整理全部三话'});
    if(transportMode==='fail')throw Error('合成 Codex 暂时失败，请改用规则批处理');
    if(transportMode==='held'){entered?.();await new Promise(resolve=>release=resolve);}
    return [];
  }});
  const workbook=path.join(f.runDirectory,'批量预检合成三话.xlsx');fs.writeFileSync(workbook,bytes);const sourceHash=hash(fs.readFileSync(workbook));
  const checks=[],pageErrors=[],blockedRequests=[],requests=[],geometry=[];let browser,page;
  const checkpoint=name=>{assert.deepEqual(pageErrors,[]);checks.push(name);console.log('PASS '+name);};
  t.after(async()=>{release?.();await browser?.close();});
  const output=extra=>({checks,pageErrors,blockedRequests,requests,geometry,sourceHash,originalWorkbookUnchanged:hash(fs.readFileSync(workbook))===sourceHash,
    providerBackendCalls:f.providerCalls,transportCalls:f.generatorCalls.length,realAI:false,realLogin:false,userEndpointWrites:false,
    isolatedOrigin:f.origin,codeRoot:root,dataRoot:f.dataDir,...extra});
  const bulkRules=()=>page.locator('[data-check-bulk="rules"]'),bulkCodex=()=>page.locator('[data-check-bulk="codex"]');
  const confirmButton=()=>page.getByRole('button',{name:'确认摘要，开始整话试排',exact:true});
  async function response(method,run,suffix='',expected=200){
    const pending=page.waitForResponse(r=>r.url().startsWith(f.origin+'/api/storyboards/check')&&r.request().method()===method&&(!suffix||r.url().endsWith(suffix)));
    await run();const result=await pending,payload=await result.json();assert.equal(result.status(),expected,JSON.stringify(payload));return payload;
  }
  async function open(){
    await page.locator('#rule-import-empty').click();await page.locator('#rule-profile').selectOption('dazhou-xuanyiwei');
    const s=await response('POST',()=>page.locator('#rule-file').setInputFiles(workbook));await page.locator('#storyboard-check').waitFor();
    assert.equal(await page.locator('#check-batch-scope').inputValue(),'all');assert.equal(await confirmButton().isDisabled(),true);return s;
  }
  async function closeCheck(){await response('DELETE',()=>page.getByRole('button',{name:'取消检查，不创建工程',exact:true}).click());await page.locator('#rule-dialog').waitFor({state:'hidden'});}
  async function waitAvailable(){await page.waitForFunction(()=>{const button=document.querySelector('[data-check-bulk="rules"]');return button&&!button.disabled;});}
  async function inspectControls(width){
    await page.setViewportSize({width,height:980});
    for(const selector of ['#check-batch-scope','[data-check-bulk="rules"]','[data-check-bulk="codex"]']){
      await page.locator(selector).scrollIntoViewIfNeeded();
      const result=await page.locator(selector).evaluate(element=>{const r=element.getBoundingClientRect(),hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,viewportWidth:innerWidth,viewportHeight:innerHeight,hit:hit===element||element.contains(hit),disabled:element.disabled};});
      geometry.push({width,selector,...result});assert.ok(result.left>=-1&&result.right<=width+1,selector+' exceeds viewport at '+width);
      assert.ok(result.top>=-1&&result.bottom<=981,selector+' obscured vertically at '+width);assert.equal(result.hit,true,selector+' is obstructed');
    }
  }
  try{
    browser=await chromium.launch({channel:'msedge',headless:true,args:['--disable-gpu']});
    const context=await browser.newContext({viewport:{width:1540,height:980}});
    await context.addInitScript(()=>localStorage.setItem('comic-generation-provider','codex'));
    await context.route('**/*',async route=>{
      const request=route.request(),url=new URL(request.url());
      if(url.origin!==f.origin&&!['data:','blob:'].includes(url.protocol)){blockedRequests.push(url.href);return route.abort();}
      if(url.pathname==='/api/codex/status'||url.pathname.startsWith('/api/jimeng/')){
        assert.equal(request.method(),'GET','No provider login or mutation is authorized in this test');
        return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(url.pathname.endsWith('/models')?{items:[]}:{connected:true,installed:true,imageFeature:true,needsLogin:false,message:'合成测试连接',version:'synthetic',login:{running:false}})});
      }
      if(request.method()==='POST'&&(url.pathname==='/api/jobs'||url.pathname.startsWith('/api/storyboard/generate'))){blockedRequests.push(url.href);return route.abort();}
      return route.continue();
    });
    page=await context.newPage();page.on('pageerror',error=>pageErrors.push(error.message));page.on('request',request=>requests.push({url:request.url(),method:request.method()}));
    await page.goto(f.origin);const initialDB=fs.readFileSync(f.studio.store.file,'utf8');let s=await open();
    assert.equal(await bulkRules().textContent(),'一键批量处理');assert.equal(await bulkCodex().textContent(),'让 Codex 批量整理');
    for(const width of [1540,800,375])await inspectControls(width);
    await page.setViewportSize({width:1540,height:980});await page.locator('#rule-dialog .rule-body').evaluate(element=>element.scrollTop=0);
    await page.screenshot({path:path.join(f.runDirectory,'before-batch.png')});checkpoint('bulk choices are visible and clickable at desktop/tablet/phone widths');

    await page.locator('#check-batch-scope').selectOption('selected');
    s=await response('POST',()=>bulkRules().click(),'/batch');assert.equal(s.summary.ready,true);assert.ok(s.sheets.slice(1).every(sheet=>sheet.blocking>0));
    verifyOriginalRows(assert,s);assert.equal(await page.locator('#check-batch-scope').inputValue(),'selected');
    await page.locator('#check-batch-scope').selectOption('all');const beforeAll=requests.length;
    s=await response('POST',()=>bulkRules().click(),'/batch');assert.ok(s.sheets.every(sheet=>sheet.blocking===0&&sheet.warnings===0));
    assert.equal(requests.slice(beforeAll).filter(r=>r.method==='PATCH'&&r.url.includes('/api/storyboards/check')).length,0);
    assert.equal(await confirmButton().isDisabled(),false);verifyOriginalRows(assert,s);
    await page.screenshot({path:path.join(f.runDirectory,'rules-all-completed.png')});checkpoint('one rules click resolves all worksheet enumerations without per-row PATCH or dialogue edits');
    const confirmed=await response('POST',()=>confirmButton().click(),'/confirm');await page.locator('.rule-stats strong').waitFor();
    assert.equal(confirmed.sheet,'第1话');assert.equal(confirmed.shots.length,8);
    assert.deepEqual(confirmed.shots.map(row=>row.description),originalRows('第1话').map(row=>row[1]));assert.deepEqual(confirmed.shots.map(row=>row.dialogue),originalRows('第1话').map(row=>row[2]));
    assert.equal(fs.readFileSync(f.studio.store.file,'utf8'),initialDB);assert.deepEqual(f.studio.store.db.projects,[]);
    await page.locator('[data-rule-close]').click();await page.locator('#rule-dialog').waitFor({state:'hidden'});checkpoint('current episode confirms straight into trial layout while source workbook and project database stay unchanged');

    s=await open();const beforeCodex=f.generatorCalls.length,jobResponse=await response('POST',()=>bulkCodex().click(),'/batch',202),completed=await f.job(s,jobResponse.id);
    assert.equal(completed.status,'completed',JSON.stringify(completed));await waitAvailable();assert.equal(f.generatorCalls.length-beforeCodex,1);
    assert.equal(await bulkCodex().isDisabled(),false);assert.equal(await confirmButton().isDisabled(),false);assert.equal(await page.locator('#check-sheet').inputValue(),'第1话');
    assert.ok(completed.result.sheets.every(sheet=>sheet.blocking===0&&sheet.warnings===0));verifyOriginalRows(assert,completed.result);
    await page.screenshot({path:path.join(f.runDirectory,'codex-all-completed.png')});checkpoint('one Codex click uses one synthetic text job, resolves three sheets and restores actions');await closeCheck();

    transportMode='fail';s=await open();const failedStart=await response('POST',()=>bulkCodex().click(),'/batch',202),failed=await f.job(s,failedStart.id);
    assert.equal(failed.status,'failed');await waitAvailable();assert.equal(await bulkCodex().isDisabled(),false);assert.equal(await confirmButton().isDisabled(),true);
    const failureRecovery=await response('POST',()=>bulkRules().click(),'/batch');assert.ok(failureRecovery.sheets.every(sheet=>sheet.blocking===0));
    checkpoint('Codex failure leaves blockers intact, restores buttons and allows one-click rules recovery');await closeCheck();

    transportMode='held';s=await open();const invoked=new Promise(resolve=>entered=resolve);
    const cancelStart=await response('POST',()=>bulkCodex().click(),'/batch',202);await invoked;
    assert.equal(await bulkRules().isDisabled(),true);assert.equal(await bulkCodex().isDisabled(),true);
    await page.screenshot({path:path.join(f.runDirectory,'codex-running-cancel.png')});
    await response('DELETE',()=>page.locator('[data-check-cancel-bulk]').click(),'/batch/'+cancelStart.id);release();
    const cancelled=await f.job(s,cancelStart.id);assert.equal(cancelled.status,'cancelled');await waitAvailable();assert.equal(await confirmButton().isDisabled(),true);
    const recovered=await response('POST',()=>bulkRules().click(),'/batch');assert.ok(recovered.sheets.every(sheet=>sheet.blocking===0));verifyOriginalRows(assert,recovered);
    checkpoint('cancelled Codex late result cannot overwrite the session; actions recover and source text survives');await closeCheck();

    transportMode='held';s=await open();const localInvoked=new Promise(resolve=>entered=resolve);
    const waitingStart=await response('POST',()=>bulkCodex().click(),'/batch',202);await localInvoked;await page.locator('[data-check-use-local]').waitFor();
    const stableBody=await page.locator('#storyboard-check').elementHandle();await page.waitForFunction(()=>/已等待 [1-9]/.test(document.querySelector('#check-bulk-status')?.textContent||''));
    assert.equal(await stableBody.evaluate(element=>element.isConnected),true,'polling must not replace the full check form');
    const local=await response('POST',()=>page.locator('[data-check-use-local]').click(),'/batch');release();assert.equal(local.summary.ready,true);verifyOriginalRows(assert,local);
    const switched=await f.job(s,waitingStart.id);assert.equal(switched.status,'cancelled');await waitAvailable();assert.equal(await confirmButton().isDisabled(),false);
    await page.screenshot({path:path.join(f.runDirectory,'switched-local-completed.png')});checkpoint('one local fallback click cancels the wait, preserves the form during polling and resolves original rows');await closeCheck();
    assert.equal(hash(fs.readFileSync(workbook)),sourceHash);assert.equal(fs.readFileSync(f.studio.store.file,'utf8'),initialDB);
    assert.deepEqual(f.providerCalls,[]);assert.deepEqual(blockedRequests,[]);assert.deepEqual(pageErrors,[]);assert.deepEqual(f.studio.store.db.projects,[]);
    const report=output({ok:true,worksheets:3,sourceRows:24,noPerRowClicks:true});fs.writeFileSync(path.join(f.runDirectory,'report.json'),JSON.stringify(report,null,2));fs.writeFileSync(path.join(evidence,'browser-report.json'),JSON.stringify(report,null,2));
  }catch(error){
    await page?.screenshot({path:path.join(f.runDirectory,'failure.png')}).catch(()=>{});
    const report=output({ok:false,error:error.stack});fs.writeFileSync(path.join(f.runDirectory,'failure.json'),JSON.stringify(report,null,2));fs.writeFileSync(path.join(evidence,'browser-report.json'),JSON.stringify(report,null,2));throw error;
  }
});
