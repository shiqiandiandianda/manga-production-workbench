import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {spawn,execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {createStudio} from '../server.mjs';

const root=fileURLToPath(new URL('../',import.meta.url)),python=process.env.IMAGE_REPAIR_PYTHON||process.env.COMIC_PYTHON_BIN;
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(check,message){for(let i=0;i<600;i++){if(await check())return;await delay(10);}throw Error(message);}
async function api(origin,route,method='GET',value){const response=await fetch(origin+route,{method,headers:value?{'Content-Type':'application/json'}:undefined,body:value?JSON.stringify(value):undefined});return {status:response.status,data:await response.json()};}

test('新版补图可列出、预览并直接选用主平台资产；任务输入保留原路径且不重复复制',{timeout:60000},async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'comic-studio-assets-')),repairData=path.join(directory,'repair');let child,browser;
 const studio=createStudio({dataDir:path.join(directory,'main'),bridge:{status:async()=>({connected:false}),close(){}},jimengBridge:{close(){}},storyboardGenerator:{close(){}}});await new Promise(r=>studio.server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+studio.server.address().port;
 const probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));const repairOrigin='http://127.0.0.1:'+port;
 let output='';child=spawn(process.execPath,[path.join(root,'repair/server.mjs')],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,IMAGE_REPAIR_DATA_DIR:repairData,IMAGE_REPAIR_PORT:String(port),COMIC_STUDIO_ORIGIN:origin}});child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);
 t.after(async()=>{await browser?.close();if(child?.exitCode===null){child.kill('SIGTERM');await new Promise(r=>child.once('close',r));}studio.close();await new Promise(r=>studio.server.close(r));assert.equal(path.dirname(directory),path.resolve(os.tmpdir()));fs.rmSync(directory,{recursive:true,force:true});});
 await until(async()=>{try{return (await api(repairOrigin,'/api/health')).status===200;}catch{return false;}},'repair startup '+output);
 const health=(await api(repairOrigin,'/api/health')).data;assert.equal(health.workflowVersion,3);assert.equal(health.textReviewVersion,2);assert.equal(health.sharedAssets,true);
 const picture=path.join(directory,'主平台角色参考.png'),mask=path.join(directory,'mask.png');execFileSync(python,['-c',"from PIL import Image;import sys;Image.new('RGBA',(1024,1536),(30,80,170,255)).save(sys.argv[1]);Image.new('RGBA',(16,16),(255,255,255,0)).save(sys.argv[2])",picture,mask],{windowsHide:true});
 const asset=(await api(origin,'/api/assets','POST',{filePath:picture,name:'共享测试角色'})).data;
 const library=await api(repairOrigin,'/api/studio-assets');assert.equal(library.status,200);assert.ok(library.data.some(item=>item.id===asset.id&&item.name==='共享测试角色'));
 const thumbnail=await fetch(repairOrigin+'/api/studio-assets/'+asset.id+'/thumbnail');assert.equal(thumbnail.status,200);assert.equal(thumbnail.headers.get('content-type'),'image/png');
 const selected=await api(repairOrigin,'/api/studio-assets/'+asset.id+'/reference','POST',{});assert.equal(selected.status,201);const reference=selected.data;assert.equal(reference.storage,'path');assert.equal(reference.filePath,picture);assert.equal(reference.studioAssetId,asset.id);
 const again=await api(repairOrigin,'/api/studio-assets/'+asset.id+'/reference','POST',{});assert.equal(again.data.id,reference.id);assert.equal(fs.existsSync(path.join(repairData,'references',reference.id,'reference.png')),false);
 const preview=await fetch(repairOrigin+reference.url);assert.equal(preview.status,200);assert.deepEqual(Buffer.from(await preview.arrayBuffer()),fs.readFileSync(picture));
 const source=(await api(repairOrigin,'/api/sources','POST',{filePath:picture})).data;
 const job=await api(repairOrigin,'/api/jobs','POST',{sourceId:source.id,sourceRevision:0,mode:'chat',crop:{x:0,y:0,width:16,height:16},frame:{x:0,y:0,width:16,height:16},prompt:'合成测试，不调用生成',mask:'data:image/png;base64,'+fs.readFileSync(mask).toString('base64'),feather:0,references:[reference.id]});assert.equal(job.status,201,JSON.stringify(job.data));assert.deepEqual(job.data.referenceFiles,[picture]);
 const resolved=execFileSync(python,['-c',"import sys,json;from pathlib import Path;sys.path.insert(0,sys.argv[1]);from job_inputs import reference_image,base_image;j=Path(sys.argv[2]);q=json.loads((j/'request.json').read_text(encoding='utf-8'));print(json.dumps([str(reference_image(j,q,q['referenceFiles'][0])),str(base_image(j,q))],ensure_ascii=False))",path.join(root,'repair/python'),path.join(repairData,'jobs',job.data.id)],{encoding:'utf8',windowsHide:true});assert.equal(JSON.parse(resolved)[0],picture);
 const require=createRequire(import.meta.url),{chromium}=require(path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));browser=await chromium.launch({channel:'msedge',headless:true,args:['--disable-gpu']});const context=await browser.newContext({viewport:{width:1864,height:1040}});await context.addInitScript(id=>localStorage.setItem('patch-last-page',id),source.id);
 await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.pathname==='/api/codex/status')return route.fulfill({json:{connected:false,message:'合成测试，无账号检查'}});return ['127.0.0.1','localhost'].includes(url.hostname)||['data:','blob:'].includes(url.protocol)?route.continue():route.abort();});const page=await context.newPage(),errors=[];page.on('pageerror',e=>{errors.push(e.message);console.log('Browser error: '+e.message);});page.on('response',response=>{if(response.status()>=400)console.log('Browser HTTP '+response.status()+' '+new URL(response.url()).pathname);});await page.goto(repairOrigin);await page.waitForFunction(()=>!!globalThis.comicStudioRepair);const opened=await page.evaluate(async id=>{try{await globalThis.comicStudioRepair.open(id);return 'ok';}catch(error){return error.message;}},source.id);assert.equal(opened,'ok');await page.waitForFunction(()=>document.querySelector('#header-filename').textContent.includes('主平台角色参考'));
 await page.getByRole('button',{name:'编辑',exact:true}).click();await page.locator('[data-tool=rect]').click();const box=await page.locator('#view').boundingBox();assert.ok(box);await page.mouse.move(box.x+box.width/2-30,box.y+box.height/2-30);await page.mouse.down();await page.mouse.move(box.x+box.width/2+30,box.y+box.height/2+30,{steps:5});await page.mouse.up();await page.waitForFunction(()=>!document.querySelector('#quick-repair').hidden);const details=page.locator('details').filter({has:page.locator('#reference-main-assets')});if(await details.count()){if(!await details.getAttribute('open'))await details.locator('summary').first().click();}
 await page.locator('#reference-main-assets').click();await page.getByRole('button',{name:'选用参考图：共享测试角色',exact:true}).click();await page.locator('#reference-list img[alt="共享测试角色"]').waitFor({state:'visible'});
 const evidence=path.resolve(process.env.COMIC_PLATFORM_EVIDENCE||'.runtime/platform-allocation-evidence');fs.mkdirSync(evidence,{recursive:true});await page.screenshot({path:path.join(evidence,'main-assets-in-repair.png')});assert.deepEqual(errors,[]);
 const exported=await fetch(repairOrigin+'/api/sources/'+source.id+'/project-file');assert.equal(exported.status,200,exported.status===200?'':await exported.text());const archive=Buffer.from(await exported.arrayBuffer());
 const importedResponse=await fetch(repairOrigin+'/api/project-files',{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:archive}),imported=await importedResponse.json();assert.equal(importedResponse.status,201,JSON.stringify(imported));const importedMeta=(await api(repairOrigin,'/api/sources/'+imported.sourceId)).data;assert.notEqual(importedMeta.storage,'path');
 fs.renameSync(picture,picture+'.removed');const missing=await api(repairOrigin,'/api/studio-assets/'+asset.id+'/reference','POST',{});assert.equal(missing.status,404);assert.equal((await api(repairOrigin,'/api/references')).status,200);
});
