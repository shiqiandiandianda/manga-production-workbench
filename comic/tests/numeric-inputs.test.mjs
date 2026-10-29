import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {formatInputNumber} from '../public/numeric-inputs.js';
import {typographyMarkup,TYPOGRAPHY_DEFAULT} from '../public/unified-typography.js';

test('数值最多两位小数，空值、整数、负值和原始设置保持正确',()=>{
 for(const [value,expected]of [[1.3333333333,'1.33'],[35.427283418,'35.43'],[-12.3456,'-12.35'],[-0.001,'0'],[1.2,'1.2'],[12,'12'],['',''],[null,''],[9007199254740991,'9007199254740991']])assert.equal(formatInputNumber(value),expected);
 const settings={...TYPOGRAPHY_DEFAULT,lineHeight:1.3333333333},before=structuredClone(settings),markup=typographyMarkup(settings,'test');
 assert.match(markup,/id="test-lineHeight"[^>]*value="1.33"/);assert.doesNotMatch(markup,/typography-note/);assert.deepEqual(settings,before);
});

test('动态数值、正在输入、提交、同源修图框、无副作用及错误状态保留',{timeout:45000},async t=>{
 const source=fs.readFileSync(new URL('../public/numeric-inputs.js',import.meta.url)),require=createRequire(import.meta.url);
 const {chromium}=require(process.env.COMIC_TEST_PLAYWRIGHT_MODULE||path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
 const server=http.createServer((req,res)=>{if(req.url==='/numeric-inputs.js'){res.setHeader('Content-Type','text/javascript');res.end(source);return;}
 res.setHeader('Content-Type','text/html; charset=utf-8');
 if(req.url==='/frame'){res.end('<input id="frame-number" type="number" value="22.7654321"><p role="alert">修图失败，请重试</p>');return;}
 res.end('<input id="number" type="number" value="1.333333333333"><input id="text" value="12.345678"><input id="empty" type="number"><p role="status">正在修图</p><button id="update" onclick="document.querySelector(\'#number\').value=\'7.987654\'">更新</button><iframe src="/frame"></iframe><script>window.model={value:1.333333333333};window.changes=[];document.addEventListener("change",e=>changes.push(e.target.value));</script><script type="module" src="/numeric-inputs.js"></script>');});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close();});
 const browser=await chromium.launch({headless:true,channel:'msedge'});t.after(()=>browser.close());const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>document.querySelector('#number').value==='1.33');
 assert.equal(await page.locator('#text').inputValue(),'12.345678');assert.equal(await page.locator('#empty').inputValue(),'');assert.equal(await page.evaluate(()=>model.value),1.333333333333);assert.deepEqual(await page.evaluate(()=>changes),[]);
 assert.equal(await page.frameLocator('iframe').locator('#frame-number').inputValue(),'22.77');assert.equal(await page.frameLocator('iframe').getByRole('alert').isVisible(),true);assert.equal(await page.getByRole('status').isVisible(),true);
 await page.locator('#number').fill('2.123456');assert.equal(await page.locator('#number').inputValue(),'2.123456');await page.locator('#text').focus();assert.equal(await page.locator('#number').inputValue(),'2.12');assert.deepEqual(await page.evaluate(()=>changes),['2.12']);
 await page.locator('#update').click();await page.waitForFunction(()=>document.querySelector('#number').value==='7.99');
 await page.evaluate(()=>document.body.insertAdjacentHTML('beforeend','<input id="dynamic" type="number" value="-3.456789">'));
 await page.waitForFunction(()=>document.querySelector('#dynamic').value==='-3.46');
 assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>model.value),1.333333333333);
});
