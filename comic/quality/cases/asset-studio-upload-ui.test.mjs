import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {createRequire} from 'node:module';

test('资产工作室提示墨库保存失败，服装和手部结果归入人物分类',{timeout:60000},async t=>{
 const root=path.resolve(import.meta.dirname,'../../../asset-studio/app/web/assets'),calls=[];
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64');
 const server=http.createServer(async(req,res)=>{
  try{
   const url=new URL(req.url,'http://fixture');
   if(url.pathname.startsWith('/api/')){
    const chunks=[];for await(const chunk of req)chunks.push(chunk);const value=chunks.length?JSON.parse(Buffer.concat(chunks).toString()):null;
    calls.push({path:url.pathname,method:req.method,value});res.setHeader('Content-Type','application/json');
    if(url.pathname==='/api/production-records')return res.end('{"items":[]}');
    if(url.pathname==='/api/requests')return res.end('{"requests":[]}');
    if(url.pathname==='/api/moku/status')return res.end('{"ok":false,"projects":[]}');
    if(url.pathname==='/api/costume-design'||url.pathname==='/api/hand-card')return res.end('{"jobId":"job_fixture"}');
    if(url.pathname==='/api/jobs/job_fixture')return res.end('{"status":"completed","asset":{"name":"合成图片","width":1,"height":1,"imageUrl":"/fixture.png"}}');
    if(url.pathname==='/api/adopt')return res.end('{"file":"合成.png","moku":{"assetId":"asset_fixture"}}');
    if(url.pathname==='/api/compose-save')return res.end('{"assetId":"asset_local","warning":"合成会话已失效"}');
    return res.end('{"ok":true}');
   }
   if(url.pathname==='/fixture.png'){res.setHeader('Content-Type','image/png');return res.end(png);}
   const file=path.resolve(root,'.'+(url.pathname==='/'?'/index.html':url.pathname));
   if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.writeHead(404);return res.end();}
   res.setHeader('Content-Type',file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.css')?'text/css':'text/javascript');res.end(fs.readFileSync(file));
  }catch(error){res.writeHead(500);res.end(error.message);}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();server.close();});
 const {chromium}=createRequire(import.meta.url)(process.env.COMIC_TEST_PLAYWRIGHT_MODULE),browser=await chromium.launch({channel:'msedge',headless:true});t.after(()=>browser.close());
 const page=await browser.newPage({viewport:{width:1600,height:1000}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto('http://127.0.0.1:'+server.address().port);
 await page.locator('#production-new').click();
 await page.evaluate(async()=>{const {loadProductionConfig}=await import('/app.mjs');await loadProductionConfig({type:'character',name:'合成角色',outfit:'蓝衣',prompt:'合成测试',references:[]});});
 await page.locator('#board-save').click();
 await page.locator('#board-status').filter({hasText:'墨库未保存：合成会话已失效'}).waitFor();
 for(const [mode,input] of [['costume','#costume-reference'],['hands','#reference']]){
  await page.locator('[data-mode="'+mode+'"]').click();
  await page.locator(input).setInputFiles({name:'fixture.png',mimeType:'image/png',buffer:png});
  await page.locator('#generate').click();await page.locator('#adopt').waitFor({state:'visible',timeout:12000});
  await page.locator('#adopt').click();await page.locator('#caption').filter({hasText:'已入库'}).waitFor();
  assert.equal(calls.filter(call=>call.path==='/api/adopt').at(-1).value.type,'character');
 }
 assert.deepEqual(errors,[]);
});
