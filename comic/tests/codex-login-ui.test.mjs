import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createStudio} from '../server.mjs';
const require=createRequire(import.meta.url),{chromium}=require(path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'codex-login-ui-')),attempts=[],probes=[];let connected=false;
 const fake={close(){},status:async options=>{probes.push(options);return {installed:true,connected,sessionReady:connected&&options?.checkSession===true,needsLogin:!connected,version:'codex-fixture',message:connected?'账号已登录':'本机 Codex app-server 尚未使用 ChatGPT 登录，请先完成官方登录'};},login(onChild,options){return new Promise((resolve,reject)=>{attempts.push({options,reject,complete(){connected=true;resolve({code:0,connected:true});},fail(){resolve({code:1,message:'官方登录未完成，请重试'});}});onChild({exitCode:0});options.onEvent({type:'login',authUrl:options.method==='device'?'https://auth.openai.com/codex/device':'https://auth.openai.com/fixture?state=synthetic',userCode:'ABCD-1234'});});},generate(){throw Error('No real generation');}};
 const studio=createStudio({dataDir:dir,bridge:fake,jimengBridge:{close(){},status:async()=>({connected:false})}});
 await new Promise(resolve=>studio.server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+studio.server.address().port;
 t.after(async()=>{await studio.close();assert.equal(path.dirname(dir),path.resolve(os.tmpdir()));fs.rmSync(dir,{recursive:true,force:true});});
 const api=async(route,method='GET',input)=>{const response=await fetch(origin+route,{method,headers:{'Content-Type':'application/json'},...(input?{body:JSON.stringify(input)}:{})});return {status:response.status,headers:response.headers,data:await response.json()};};
 return {dir,studio,origin,api,attempts,probes};
}
async function pageFor(t,f,viewport={width:1440,height:1080}){
 const browser=await chromium.launch({channel:'msedge',headless:true});t.after(()=>browser.close());
 const context=await browser.newContext({viewport});await context.route('**/*',route=>{const url=new URL(route.request().url());return url.origin===f.origin||['data:','blob:'].includes(url.protocol)?route.continue():route.abort();});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));t.after(()=>assert.deepEqual(errors,[]));
 await page.goto(f.origin);await page.waitForFunction(()=>document.querySelector('#codex-connection-status')?.textContent==='未登录');return page;
}
test('login HTTP routes are idempotent, local-only, cancellable and never change the generation queue',async t=>{
 const f=await fixture(t);const first=await f.api('/api/codex/login','POST',{method:'browser'}),again=await f.api('/api/codex/login','POST',{method:'browser'});assert.equal(first.status,202);assert.equal(first.data.attemptId,again.data.attemptId);assert.equal(f.attempts.length,1);
 const current=await f.api('/api/codex/login');assert.equal(current.data.state,'waiting');assert.equal(current.headers.get('cache-control'),'no-store');
 assert.equal((await f.api('/api/state')).data.login.authUrl,undefined);
 assert.equal((await f.api('/api/codex/login/cancel','POST',{attemptId:'old'})).status,409);
 assert.equal((await f.api('/api/codex/login/cancel','POST',{attemptId:first.data.attemptId})).data.state,'cancelled');
 const invalid=await f.api('/api/codex/login','POST',{method:'arbitrary-command'});assert.equal(invalid.status,400);
 const external=await fetch(f.origin+'/api/codex/login',{method:'POST',headers:{Origin:'https://outside.invalid','Content-Type':'application/json'},body:'{}'});assert.equal(external.status,403);
 f.attempts[0].complete();await tick();assert.equal((await f.api('/api/codex/login')).data.state,'cancelled');assert.deepEqual(f.studio.store.db.jobs,[]);
});
test('guided login supports cancellation, device fallback, refresh recovery and automatic connection check',{timeout:60000},async t=>{
 const f=await fixture(t),page=await pageFor(t,f);await page.locator('#codex-connect').click();await page.locator('[data-codex-login]:enabled').waitFor();
 assert.equal(await page.locator('[data-codex-guide] li').count(),3);await page.locator('[data-codex-login]').click();await page.locator('[data-codex-link-box]:not([hidden])').waitFor();assert.match(await page.locator('[data-codex-link]').getAttribute('href'),/^https:\/\/auth\.openai\.com\//);
 await page.locator('[data-codex-cancel]').click();await page.getByText('本次登录已取消，可以重新开始。',{exact:true}).waitFor();await page.locator('[data-codex-device]').click();await page.locator('[data-codex-code-box]:not([hidden])').waitFor();assert.equal(await page.locator('[data-codex-code]').textContent(),'ABCD-1234');
 await page.reload();await page.locator('#codex-connect').click();await page.locator('[data-codex-code-box]:not([hidden])').waitFor();assert.equal(f.attempts.length,2);
 const proof=path.resolve('quality-evidence/codex-login');fs.mkdirSync(proof,{recursive:true});await page.screenshot({path:path.join(proof,'device-waiting.png')});
 f.attempts[1].complete();await page.waitForFunction(()=>document.querySelector('#codex-connection-status').textContent==='已连接');await page.locator('[data-codex-success]:not([hidden])').waitFor();assert.equal(f.probes.at(-1).checkSession,true);assert.equal(await page.locator('[data-codex-link]').getAttribute('href'),null);assert.deepEqual(f.studio.store.db.jobs,[]);await page.screenshot({path:path.join(proof,'connected.png')});
});
test('login failure remains retryable on a narrow screen; closing the guide does not reopen over another dialog',{timeout:60000},async t=>{
 const f=await fixture(t),page=await pageFor(t,f,{width:480,height:820});await page.locator('#codex-connect').click();await page.locator('[data-codex-login]:enabled').waitFor();await page.locator('[data-codex-login]').click();await page.locator('[data-codex-link-box]:not([hidden])').waitFor();
 f.attempts[0].fail();await page.getByText('官方登录未完成，请重试',{exact:true}).waitFor();await page.getByRole('button',{name:'重新开始官方登录',exact:true}).click();await page.locator('[data-codex-link-box]:not([hidden])').waitFor();
 const width=await page.locator('#modal').evaluate(node=>({scroll:node.scrollWidth,width:node.clientWidth}));assert.ok(width.scroll<=width.width+1);
 const proof=path.resolve('quality-evidence/codex-login');fs.mkdirSync(proof,{recursive:true});await page.screenshot({path:path.join(proof,'mobile-guide.png')});
 await page.getByRole('button',{name:'关闭',exact:true}).last().click();await page.evaluate(()=>{document.querySelector('#modal-title').textContent='其他编辑窗口';document.querySelector('#modal-body').textContent='保留我的输入';document.querySelector('#modal').showModal();});
 f.attempts[1].complete();await page.waitForFunction(()=>document.querySelector('#codex-connection-status').textContent==='已连接');assert.equal(await page.locator('#modal-title').textContent(),'其他编辑窗口');assert.equal(await page.locator('#modal-body').textContent(),'保留我的输入');assert.deepEqual(f.studio.store.db.jobs,[]);
});
test('a delayed login poll cannot resurrect a cancelled attempt or replace its retry',{timeout:60000},async t=>{
 const f=await fixture(t),page=await pageFor(t,f);await page.locator('#codex-connect').click();await page.locator('[data-codex-login]:enabled').waitFor();await page.locator('[data-codex-login]').click();await page.locator('[data-codex-link-box]:not([hidden])').waitFor();
 let release,pendingResolve;const blocked=new Promise(resolve=>pendingResolve=resolve);let intercept=true;
 await page.route('**/api/codex/login',async route=>{
  if(route.request().method()!=='GET'||!intercept)return route.continue();intercept=false;
  const old=(await f.api('/api/codex/login')).data;await new Promise(resolve=>{release=resolve;pendingResolve();});await route.fulfill({json:old});
 });
 await blocked;await page.locator('[data-codex-cancel]').click();await page.getByText('本次登录已取消，可以重新开始。',{exact:true}).waitFor();await page.locator('[data-codex-device]').click();
 // The old response is from the browser login, not the new device ceremony.
 release();await page.locator('[data-codex-code-box]:not([hidden])').waitFor();assert.equal(f.attempts.length,2);assert.equal(await page.locator('[data-codex-code]').textContent(),'ABCD-1234');
 f.attempts[1].complete();await page.waitForFunction(()=>document.querySelector('#codex-connection-status').textContent==='已连接');
});
