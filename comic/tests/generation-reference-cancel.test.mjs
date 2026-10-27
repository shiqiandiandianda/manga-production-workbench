import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import http from 'node:http';import {randomUUID} from 'node:crypto';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{chromium}=require(process.env.PLAYWRIGHT_MODULE),web=path.resolve('public');
test('参考只从墨库固定版取用；取消和Escape立即退出，迟到结果不串入再次打开的窗口',async t=>{
 const projectId=randomUUID(),assetId=randomUUID(),revisionId=randomUUID(),pending=[],calls=[];
 const item={id:assetId,projectId,name:'测试人物.png',assetKind:'image',assetType:'character',recommendedRevisionId:revisionId};
 const html=`<!doctype html><meta charset="utf-8"><button id="open">选择参考</button><output id="chosen"></output><output id="adopted">0</output><script type="module">
 import {mountGenerationReferencePicker} from '/generation-reference-picker.js';const project={id:'local-project',mokuProjectId:${JSON.stringify(projectId)}},assets=[{id:'old-local',name:'旧本机图片.png'}];
 const api=async(route,method='GET',body)=>{const r=await fetch(route,{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});if(!r.ok)throw Error('接口错误');return r.json();};
 const picker=mountGenerationReferencePicker({api,getProject:()=>project,getAssets:()=>assets,onAssets:items=>{assets.push(...items);document.querySelector('#adopted').textContent=String(assets.length-1);}});
 document.querySelector('#open').onclick=async()=>{const selected=await picker.open({name:'测试人物',role:'人物身份'});document.querySelector('#chosen').textContent=selected?.id||'cancelled';};</script>`;
 const server=http.createServer(async(req,res)=>{const u=new URL(req.url,'http://local'),json=v=>{if(res.writableEnded)return;res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(v));};
  if(u.pathname==='/'){res.end(html);return;}
  if(u.pathname==='/api/library/projects'){json({items:[{id:projectId,name:'合成项目'}]});return;}
  if(u.pathname==='/api/library/assets'){json({items:u.searchParams.get('projectId')===projectId?[item]:[],more:false});return;}
  if(u.pathname==='/api/library/import'){const buffers=[];for await(const b of req)buffers.push(b);calls.push(JSON.parse(Buffer.concat(buffers)));pending.push(()=>json({asset:{id:'selected_'+pending.length,library:{assetId,revisionId}}}));return;}
  if(u.pathname.includes('/preview/')){res.writeHead(404);res.end();return;}
  const file=path.resolve(web,'.'+u.pathname);if(!file.startsWith(web+path.sep)||!fs.existsSync(file)){res.writeHead(404);res.end();return;}res.writeHead(200,{'Content-Type':'text/javascript'});res.end(fs.readFileSync(file));
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await chromium.launch({channel:'msedge',headless:true});t.after(async()=>{pending.forEach(done=>done());await browser.close();server.closeAllConnections();server.close();});
 const page=await browser.newPage({viewport:{width:1100,height:800}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:'+server.address().port);
 const open=async()=>{await page.locator('#open').click();await page.locator('[data-gen-picker-item]').waitFor();assert.equal(await page.locator('input[type=file],[data-gen-picker-source],[data-gen-picker-item="old-local"]').count(),0);};
 const select=async count=>{await page.locator('[data-gen-picker-item]').click();for(let i=0;calls.length<count&&i<100;i++)await new Promise(r=>setTimeout(r,10));assert.equal(calls.length,count);};
 await open();await select(1);await page.getByRole('button',{name:'取消',exact:true}).click();await page.locator('#generation-reference-picker').waitFor({state:'hidden'});assert.equal(await page.locator('#chosen').textContent(),'cancelled');
 await open();await select(2);pending[0]();await page.waitForTimeout(50);assert.equal(await page.locator('#adopted').textContent(),'0');assert.equal(await page.locator('#generation-reference-picker').isVisible(),true);await page.keyboard.press('Escape');await page.locator('#generation-reference-picker').waitFor({state:'hidden'});pending[1]();await page.waitForTimeout(50);assert.equal(await page.locator('#adopted').textContent(),'0');
 await open();await select(3);pending[2]();await page.locator('#generation-reference-picker').waitFor({state:'hidden'});assert.equal(await page.locator('#adopted').textContent(),'1');assert.ok((await page.locator('#chosen').textContent()).startsWith('selected_'));assert.ok(calls.every(c=>c.assetId===assetId&&c.revisionId===revisionId));assert.deepEqual(errors,[]);
});
