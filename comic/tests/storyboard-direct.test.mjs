import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {createStudio} from '../server.mjs';
import {buildImagePrompt} from '../lib/codex.mjs';
import {buildJimengPrompt} from '../lib/jimeng.mjs';
import {generationPromptSelection} from '../public/prompt-source.js';
import {writeXlsx} from '../lib/xlsx.mjs';
import {imageInfo} from '../lib/store.mjs';
const comicRoot=fileURLToPath(new URL('../',import.meta.url)),evidence=path.resolve(comicRoot,'../verification/storyboard-direct'),require=createRequire(import.meta.url);
const {chromium}=require(path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const {createCanvas}=require(path.resolve(comicRoot,'../../runtime/node/node_modules/@napi-rs/canvas'));
fs.mkdirSync(evidence,{recursive:true});process.env.PROJECT_CENTER_URL='';process.env.COMIC_PYTHON_BIN=path.resolve(comicRoot,'../../runtime/python/python.exe');
const rows=[{'话数':'11','格号':'001','画面内容':'在窗边读信。','台词':'到了。','生图提示词（后期嵌字）':'窗边读信，桌面放着一封蓝色信。','直出提示词':'窗边读信，画内对白“到了。”。'},{'话数':'11','格号':'002','画面内容':'看向窗外。','台词':'','生图提示词（后期嵌字）':'人物转头看向窗外。','直出提示词':'人物看向窗外，文字“清晨”。'},{'话数':'12','格号':'001','画面内容':'空庭院。','台词':'','生图提示词（后期嵌字）':'晨光下的空庭院。','直出提示词':'空庭院，门牌“十二”。'}];
const png=()=>{const canvas=createCanvas(1280,720),context=canvas.getContext('2d');context.fillStyle='#628ca8';context.fillRect(0,0,1280,720);context.fillStyle='#f1d5a1';context.fillRect(240,120,400,420);return canvas.toBuffer('image/png');};
async function fixture(t,{pause=false}={}){
 const dataDir=fs.mkdtempSync(path.join(evidence,'fixture-'));process.env.COMIC_SLOT_DIR=path.join(dataDir,'slots');
 const calls=[];let release=()=>{};
 const bridge={close(){},ensurePoolSize(){},status:async()=>({connected:true,sessionReady:true,imageFeature:true,installed:true,message:'合成测试通道'}),generate:async(_dir,input,_references,{signal}={})=>{calls.push(structuredClone(input));if(pause)await new Promise((resolve,reject)=>{release=resolve;signal?.addEventListener('abort',()=>reject(Error('合成测试结束')),{once:true});});return {bytes:png(),imageToolSeen:true};}};
 const jimengBridge={close(){},status:async()=>({connected:false,message:'合成测试未连接'}),models:async()=>({items:[]})};
 const studio=createStudio({dataDir,bridge,jimengBridge,maxConcurrent:1});await new Promise(resolve=>studio.server.listen(0,'127.0.0.1',resolve));
 const origin='http://127.0.0.1:'+studio.server.address().port;
 t.after(async()=>{const closed=new Promise(resolve=>studio.server.once('close',resolve));studio.close();release();await closed;});
 const request=async(route,method='GET',input)=>{const response=await fetch(origin+route,{method,headers:input?{'Content-Type':'application/json'}:{},body:input?JSON.stringify(input):undefined}),body=await response.json();return {response,body};};
 const imported=async(source=rows,extra={})=>{const {response,body}=await request('/api/projects/storyboard-import','POST',{name:'合成分镜.json',dataBase64:Buffer.from(JSON.stringify(source)).toString('base64'),...extra});assert.ok(response.ok,JSON.stringify(body));return body;};
 return {studio,origin,request,imported,calls,release:()=>release()};
}
async function until(check){for(let i=0;i<100;i++){const value=await check();if(value)return value;await new Promise(resolve=>setTimeout(resolve,50));}throw Error('等待合成任务超时');}

test('导入分镜直接创建逐话画格，原始提示词逐字保留',async t=>{
 const f=await fixture(t),project=await f.imported();assert.equal(project.pages.length,2);assert.equal(project.shots.length,3);assert.deepEqual(project.pages.map(page=>page.panels.length),[2,1]);
 assert.equal(project.pages[0].storyboard.projection,'source-order');assert.equal(project.pages[0].panels[0].y,0);assert.ok(project.pages[0].panels[1].y>project.pages[0].panels[0].y);
 assert.equal(generationPromptSelection(project.pages[0].panels[0],project).text,rows[0]['生图提示词（后期嵌字）']);assert.equal(project.shots[0].sourceFields['直出提示词'],rows[0]['直出提示词']);assert.equal(f.calls.length,0);
});

test('CSV、粘贴表格与XLSX沿用同一直接导入流程',async t=>{
 const f=await fixture(t),text='话数\t格号\t画面内容\t生图提示词\n13\t001\t空走廊\t走廊尽头亮着灯';
 const result=await f.request('/api/projects/storyboard-import','POST',{text});assert.equal(result.response.status,201);assert.equal(result.body.pages[0].panels.length,1);
 const workbook=writeXlsx([{name:'第14话',rows:[['格号','画面内容','生图提示词'],['001','水池','水池里有涟漪']]}]);
 const resultX=await f.request('/api/projects/storyboard-import','POST',{name:'合成分镜.xlsx',dataBase64:Buffer.from(workbook).toString('base64')});assert.equal(resultX.response.status,201,JSON.stringify(resultX.body));assert.equal(resultX.body.pages[0].panels.length,1);
});

test('删除的功能接口和脚本实际返回404',async t=>{
 const f=await fixture(t),project=await f.imported();
 for(const route of ['/api/projects/rule-layout','/api/projects/layout-bundle','/api/storyboards/check','/api/layouts','/api/native-repair/open','/api/repair-links','/api/projects/'+project.id+'/design-runs','/api/projects/'+project.id+'/storyboard/source','/api/projects/'+project.id+'/novel-production/source']){
  const response=await fetch(f.origin+route,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(response.status,404,route);
 }
 for(const route of ['/design-ui.js','/rule-engine.js','/repair-link-ui.js','/novel-production-ui.js','/coordinate-layout.js'])assert.equal((await fetch(f.origin+route)).status,404,route);
 assert.equal((await f.request('/api/health')).body.workflow,'storyboard-import');
 assert.equal((await fetch(f.origin+'/collab.html')).status,410);const center=await f.request('/api/project-center/status?projectId='+project.id);assert.equal(center.response.status,200);assert.equal(center.body.configured,false);
});

test('更新分镜保留画格编号、已用图片与人工几何，拒绝旧版本覆盖',async t=>{
 const f=await fixture(t),project=await f.imported(),frame=project.pages[0].panels[0];frame.x=123;frame.h=800;
 const saved=await f.request('/api/projects/'+project.id,'PUT',project);assert.equal(saved.response.status,200);
 const oldRevision=project.revision,next=await f.imported([...rows,{'话数':'11','格号':'003','画面内容':'新的分镜','生图提示词':'新的一张空白桌子'}],{projectId:project.id,expectedRevision:saved.body.revision});
 assert.equal(next.pages[0].panels[0].id,frame.id);assert.equal(next.pages[0].panels[0].x,123);assert.equal(next.pages[0].panels[0].h,800);assert.equal(next.pages[0].panels.length,3);
 assert.equal((await f.request('/api/projects/'+project.id,'PUT',{...next,revision:oldRevision})).response.status,409);
});

test('生成直接使用表内提示词，完成后回填当前画格',async t=>{
 const f=await fixture(t),project=await f.imported(),frame=project.pages[0].panels[0];
 const result=await f.request('/api/jobs','POST',{projectId:project.id,panelIds:[frame.id],expectedRevision:project.revision,provider:'codex'});assert.equal(result.response.status,202,JSON.stringify(result.body));
 const job=await until(()=>f.studio.store.db.jobs.find(job=>job.status==='done'));assert.equal(f.calls.length,1);assert.equal(f.calls[0].shot.description,rows[0]['生图提示词（后期嵌字）']);assert.equal(job.applied,true);assert.ok(f.studio.store.project(project.id).pages[0].panels[0].imageAssetId);
 const prompt=buildImagePrompt(f.calls[0]);assert.ok(prompt.includes(rows[0]['生图提示词（后期嵌字）']));assert.doesNotMatch(prompt,/规则编号|导演计划|主格数量|整话排版约束/);
 const extra={...f.calls[0],shot:{...f.calls[0].shot,shotSize:'特写',characterStates:'甲:黑衣'}};assert.doesNotMatch(buildImagePrompt(extra),/人物状态：|景别：/);assert.doesNotMatch(buildJimengPrompt(extra),/人物状态：|景别：/);
 assert.ok(buildJimengPrompt(f.calls[0]).includes(rows[0]['生图提示词（后期嵌字）']));
});

test('生成期间内容改变，结果进入候选而不覆盖画格',async t=>{
 const f=await fixture(t,{pause:true}),project=await f.imported(),frame=project.pages[0].panels[0];
 assert.equal((await f.request('/api/jobs','POST',{projectId:project.id,panelIds:[frame.id],expectedRevision:project.revision,provider:'codex'})).response.status,202);await until(()=>f.calls.length);
 const current=(await f.request('/api/projects/'+project.id)).body;current.shots[0].sourceFields['生图提示词（后期嵌字）']='改成傍晚的窗边';assert.equal((await f.request('/api/projects/'+project.id,'PUT',current)).response.status,200);f.release();
 const job=await until(()=>f.studio.store.db.jobs.find(job=>job.status==='done'));assert.equal(job.applied,false);const latest=f.studio.store.project(project.id).pages[0].panels[0];assert.equal(latest.imageAssetId,null);assert.equal(latest.candidates.length,1);
});

test('浏览器导入、画格编辑、批量选词、生图、导出及窄屏入口可用',{timeout:90000},async t=>{
 const f=await fixture(t);const browser=await chromium.launch({headless:true,executablePath:process.env.COMIC_TEST_BROWSER||'C:/Program Files/Google/Chrome/Application/chrome.exe'});t.after(()=>browser.close());
 const context=await browser.newContext({viewport:{width:1864,height:949},acceptDownloads:true});await context.addInitScript(()=>localStorage.setItem('comic-generation-provider','codex'));await context.route('**/*',route=>{const url=new URL(route.request().url());return ['127.0.0.1','localhost'].includes(url.hostname)||['data:','blob:'].includes(url.protocol)?route.continue():route.abort();});
 const page=await context.newPage(),errors=[];page.on('pageerror',error=>{errors.push(error.message);console.error(error.stack);});await page.goto(f.origin);try{await page.waitForFunction(()=>document.querySelector('#save-state').textContent==='暂无项目',{},{timeout:10000});}catch(error){console.error(await page.locator('body').innerText());await page.screenshot({path:path.join(evidence,'load-error.png')});throw error;}
 for(const selector of ['#ai-design-open','#panel-prompts-open','#repair-workflow-open','#repair-workflow-results','#sidebar-toggle','#view-mode','#generation-prompt-source','#dialogue-repair','[data-rail-tab="layouts"]'])assert.equal(await page.locator(selector).count(),0,selector);
 await page.locator('#project-tools-menu>summary').click();assert.equal(await page.locator('#collab-open').count(),0);assert.equal(await page.locator('#moku-login-open').isVisible(),true);await page.locator('#project-tools-menu>summary').click();
 await page.locator('[data-rail-tab="production"]').click();await page.locator('[data-production-import]').click();await page.locator('.legacy-import>summary').click();await page.locator('#storyboard-data-file').setInputFiles({name:'合成分镜.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(rows))});await page.getByRole('button',{name:'导入分镜',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#save-state').textContent==='已保存到本机');
 await page.locator('[data-rail-tab="pages"]').click();assert.equal(await page.locator('#episode-select').inputValue(),'11');
 await page.locator('#generation-menu>summary').click();await page.locator('#prompt-source-batch').click();assert.equal(await page.getByText('当前已编辑提示词',{exact:true}).count(),0);await page.locator('[data-prompt-bulk-source]').selectOption('direct');await page.locator('[data-prompt-assign]').click();await page.getByRole('button',{name:'保存本话设置',exact:true}).click();
 await page.locator('#generation-menu>summary').click();await page.locator('#generate-current-panel').click();await until(()=>f.studio.store.db.jobs.some(job=>job.status==='done'));await page.waitForFunction(()=>document.querySelector('#job-count').textContent.includes('结束')||document.querySelector('#candidate-list img'));
 assert.equal(f.calls[0].shot.description,rows[0]['直出提示词']);
 await page.locator('[data-properties-shortcut="toolbar"]').click();await page.locator('[data-panel-inspector-tab="layout"]').click();const width=page.locator('input[data-section="panel"][data-field="w"]');await width.fill('1200');await width.blur();await until(()=>f.studio.store.db.projects[0].pages[0].panels[0].w===1200);const x=page.locator('input[data-section="panel"][data-field="x"]');await x.fill('24');await x.blur();await until(()=>f.studio.store.db.projects[0].pages[0].panels[0].x===24);
 await page.locator('#undo').click();await until(()=>f.studio.store.db.projects[0].pages[0].panels[0].x===0);await page.locator('#redo').click();await until(()=>f.studio.store.db.projects[0].pages[0].panels[0].x===24);
 await page.locator('#export-toggle').click();const imageDownload=page.waitForEvent('download');await page.locator('#export-page').click();await (await imageDownload).saveAs(path.join(evidence,'current-page.png'));const image=imageInfo(fs.readFileSync(path.join(evidence,'current-page.png')));assert.equal(image.width,1280);assert.equal(image.height,f.studio.store.db.projects[0].pages[0].height);
 await page.locator('#export-toggle').click();const download=page.waitForEvent('download');await page.locator('#export-project').click();const exported=await download;await exported.saveAs(path.join(evidence,'synthetic.comic.json'));const data=JSON.parse(fs.readFileSync(path.join(evidence,'synthetic.comic.json'),'utf8'));assert.ok(['portable','moku'].includes(data.imageStorage));assert.equal(data.portability.localPathsRequired,false);assert.equal(data.project.shots.length,3);
 await page.screenshot({path:path.join(evidence,'desktop.png'),fullPage:true});
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(evidence,'mobile.png'),fullPage:true});assert.equal(await page.locator('#storyboard-import').isVisible(),true);await page.locator('#project-tools-menu>summary').click();assert.equal(await page.locator('#collab-open').count(),0);assert.equal(await page.locator('#moku-login-open').isVisible(),true);
 assert.deepEqual(errors,[]);fs.writeFileSync(path.join(evidence,'browser-report.json'),JSON.stringify({ok:true,errors,synthetic:true,realGeneration:false},null,2));
});

