import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {createRequire} from 'node:module';

test('墨库账号页面支持离线退出、重新登录与切换账号',{timeout:60000},async t=>{
 const require=createRequire(import.meta.url),{chromium}=require(path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules','playwright'));
 const source=fs.readFileSync(path.resolve(import.meta.dirname,'../../public/moku-login-ui.js'));
 const html=`<!doctype html><meta charset="utf-8"><div class="integration-actions"></div><script type="module">
 import {mountMokuLoginUI} from '/login.js';
 let current={connected:false,hasSession:true,error:'模拟墨库离线'},calls=[];window.calls=calls;
 const api=async(path,method='GET',input)=>{calls.push({path,method,username:input?.username});if(path==='/api/library/status')return current;if(path==='/api/library/logout'){current={connected:false,hasSession:false};return {ok:true,remoteRevoked:false,warning:'本机已退出，墨库服务暂未确认会话注销。'};}if(path==='/api/library/login'){current={connected:true,hasSession:true,user:{username:input.username}};return {ok:true};}throw Error('意外请求');};
 window.ui=mountMokuLoginUI({api,toast:()=>{}});</script>`;
 const server=http.createServer((req,res)=>{if(req.url==='/login.js'){res.writeHead(200,{'Content-Type':'text/javascript'});res.end(source);}else{res.writeHead(200,{'Content-Type':'text/html'});res.end(html);}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();server.close();});
 const browser=await chromium.launch({channel:'msedge',headless:true});t.after(()=>browser.close());const page=await browser.newPage({viewport:{width:480,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:'+server.address().port);await page.locator('#moku-login-open').click();await page.getByText('模拟墨库离线').waitFor();await page.locator('[data-moku-logout]').click();await page.getByText('本机已退出，墨库服务暂未确认会话注销。').waitFor();assert.equal(await page.locator('[data-moku-logout]').isHidden(),true);
 await page.locator('#moku-login-user').fill('maker-a');await page.locator('#moku-login-password').fill('synthetic-password');await page.locator('#moku-login-dialog [type=submit]').click();await page.waitForFunction(()=>!document.querySelector('#moku-login-dialog').open);assert.equal(await page.locator('#moku-login-password').inputValue(),'');
 await page.locator('#moku-login-open').click();await page.getByText(/已连接墨库 · maker-a/).waitFor();await page.locator('#moku-login-user').fill('maker-b');await page.locator('#moku-login-password').fill('synthetic-password');await page.locator('#moku-login-dialog [type=submit]').click();await page.waitForFunction(()=>!document.querySelector('#moku-login-dialog').open);
 await page.locator('#moku-login-open').click();await page.getByText(/已连接墨库 · maker-b/).waitFor();assert.equal(await page.locator('#moku-login-password').inputValue(),'');assert.deepEqual(await page.evaluate(()=>window.calls.filter(x=>x.path==='/api/library/login').map(x=>x.username)),['maker-a','maker-b']);assert.deepEqual(errors,[]);
});
