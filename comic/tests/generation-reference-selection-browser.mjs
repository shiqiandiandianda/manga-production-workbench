import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {createProject, id} from '../public/model.js';
import {migrateLayerDocument} from '../public/layers.js';
import {ensureProjectPanelGeneration} from '../public/panel-generation.js';
import {setPanelReferences} from '../public/panel-references.js';
import {referenceAssetGenerationRequest} from '../lib/reference-asset-generation.mjs';

test('浏览器分别选用墨库身份、服装和道具固定版本，取消与账号切换不接收迟到结果', {timeout:90000}, async t => {
 const project=migrateLayerDocument(createProject('合成换装项目')).project;
 project.shots=[project.shots[0]];
 Object.assign(project.shots[0],{participants:'林玄',description:'林玄站在院中。',characterStates:'林玄:白衣常服'});
 project.pages[0].panels=[project.pages[0].panels[0]];
 project.pages[0].bubbles=[];
 project.references=[];
 const wrong={id:id('asset'),name:'林玄_白衣常服.png',libraryName:'林玄',libraryRole:'character',libraryState:'白衣常服',width:100,height:100,productionStatus:'confirmed',filePath:'synthetic.png'};
 const assets=[wrong],cloud=randomUUID();
 project.assetLibrary={version:1,assetIds:[wrong.id],directories:[],recursive:true,mokuProjectId:cloud};
 ensureProjectPanelGeneration(project,assets);
 setPanelReferences(project.pages[0].panels[0],[wrong.id],{project,assets});
 const before=JSON.stringify(project.pages);
 const records=[
  {id:randomUUID(),name:'林玄_黑衣原状态.png',category:'character'},
  {id:randomUUID(),name:'青衣服装.png',category:'character'},
  {id:randomUUID(),name:'纯阳剑.png',category:'prop'},
  {id:randomUUID(),name:'备选人物.png',category:'character'}
 ].map(item=>({...item,projectId:cloud,recommendedRevisionId:randomUUID()}));
 const [identity,costume,prop,late]=records;
 const calls=[],imported=new Map(),web=path.resolve(import.meta.dirname,'../public');
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aHHsAAAAASUVORK5CYII=','base64');
 let delayed=null,releaseDelay;
 t.after(()=>releaseDelay?.());
 const html=`<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/asset-workspace.css">
 <style>body{margin:0;font:14px sans-serif;background:#111c27}.app-shell{position:relative;height:100vh}button,input,select,textarea{font:inherit;padding:8px}</style>
 <div class="app-shell"><section id="references-tab"></section><span id="inspector-kind"></span><span id="inspector-title"></span><section id="inspector-body"></section></div>
 <script type="module">
 import {mountAssetWorkspace} from '/asset-workspace-ui.js';
 const data=await(await fetch('/fixture')).json(); window.fixture=data; window.errors=[];
 const api=async(url,method='GET',body)=>{const r=await fetch(url,{method,headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});const value=await r.json();if(!r.ok)throw Error(value.error);return value;};
 window.ui=mountAssetWorkspace({api,getProject:()=>data.project,getPage:()=>data.project.pages[0],getSelected:()=>data.project.pages[0].panels[0],getAssets:()=>data.assets,flushSave:async()=>{},accept:async p=>{data.project=p},onAssets:items=>{for(const a of items)if(!data.assets.some(v=>v.id===a.id))data.assets.push(a)},toast:(m,e)=>{if(e)window.errors.push(m)},renderInspector:()=>{}});
 window.ui.open();
 </script>`;
 const server=http.createServer(async (req,res)=>{
  const json=(value,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
  try {
   const url=new URL(req.url,'http://local');
   if(url.pathname==='/')return res.end(html);
   if(url.pathname==='/fixture')return json({project,assets});
   if(url.pathname.endsWith('/results'))return json({items:[]});
   if(url.pathname==='/api/library/projects')return json({items:[{id:cloud,name:project.title}]});
   if(url.pathname==='/api/library/assets')return json({items:url.searchParams.get('projectId')===cloud?records:[],more:false});
   if(url.pathname==='/api/library/import'){
    let body='';for await(const chunk of req)body+=chunk;
    const input=JSON.parse(body),record=records.find(item=>item.id===input.assetId);
    assert.ok(record);assert.equal(input.revisionId,record.recommendedRevisionId);
    calls.push({path:url.pathname,input});
    if(delayed===record.id)await new Promise(resolve=>{releaseDelay=resolve;});
    let asset=imported.get(record.id);
    if(!asset){asset={id:id('asset'),name:record.name,libraryName:record.name,libraryRole:record.category,width:100,height:100,productionStatus:'confirmed',filePath:'synthetic.png',library:{assetId:record.id,revisionId:record.recommendedRevisionId,projectId:cloud,sha256:'a'.repeat(64)}};imported.set(record.id,asset);assets.push(asset);}
    return json({kind:'image',asset});
   }
   if(url.pathname.includes('/reference-generation')&&req.method==='POST'){
    let body='';for await(const chunk of req)body+=chunk;
    const input=JSON.parse(body);calls.push({path:url.pathname,input});
    if(url.pathname.endsWith('/identity'))return json({status:'resolved',asset:wrong,reason:'已自动识别本项目人物参考'});
    const result=referenceAssetGenerationRequest(project,{...input,requestId:input.requestId||'preview-only'},assets);
    return json(url.pathname.endsWith('/preview')?{prompt:result.payload.prompt,referenceIds:result.referenceIds}:{task:{id:randomUUID(),status:'queued'}});
   }
   if(url.pathname.startsWith('/api/assets/')||url.pathname.startsWith('/assets/')||url.pathname.includes('/preview/')){res.writeHead(200,{'Content-Type':'image/png'});return res.end(png);}
   const file=path.resolve(web,'.'+url.pathname);assert.ok(file.startsWith(web+path.sep));
   res.writeHead(200,{'Content-Type':file.endsWith('.css')?'text/css':'text/javascript'});res.end(fs.readFileSync(file));
  }catch(error){if(!res.headersSent)return json({error:error.message},500);res.end();}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(()=>{server.closeAllConnections();server.close();});
 const require=createRequire(import.meta.url);
 const {chromium}=require(path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
 const browser=await chromium.launch({channel:'msedge',headless:true});
 t.after(()=>browser.close());
 const page=await browser.newPage({viewport:{width:1600,height:1000}}),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 await page.goto('http://127.0.0.1:'+server.address().port);
 await page.locator('[data-gallery-generate]').first().click();
 await page.locator('[data-generation-ref=identityAssetId]').waitFor();
 const open=async key=>{await page.locator('[data-generation-ref="'+key+'"]').click();await page.locator('#generation-reference-picker[open]').waitFor();};
 const pick=async item=>{await page.locator('[data-gen-picker-item="'+item.id+'"]').click();await page.locator('#generation-reference-picker').waitFor({state:'hidden'});};
 const more=async()=>{const details=page.locator('.asset-quick-generate details').first();if(!await details.evaluate(node=>node.open))await details.locator('summary').click();};
 await open('generationReferenceAssetId');await pick(identity);
 const first=await page.locator('[data-setting=generationReferenceAssetId]').count();
 assert.equal(first,0,'单图选择通过缩略图展示，不伪造隐藏字段');
 assert.match(await page.locator('.asset-simple-reference').innerText(),/林玄_黑衣原状态/);
 await open('identityAssetId');await pick(identity);
 assert.equal(await page.locator('[data-setting=identityReferenceMode]').inputValue(),'selected');
 assert.equal(await page.locator('[data-setting=identityAssetId]').inputValue(),imported.get(identity.id).id);
 assert.match(await page.locator('.asset-simple-reference').innerText(),/可手选/,'选择分项参考时退出单图优先模式');
 await more();await open('costumeAssetId');await pick(costume);
 await more();await open('propAssetId');await pick(prop);
 await page.locator('[data-setting=propPlacement]').fill('连鞘佩于人物自身左腰，剑柄向前');
 await page.locator('[data-asset-action=preview-prompt]').click();
 await page.waitForFunction(()=>document.querySelector('[data-asset-prompt-preview]')?.value.includes('人物自身左腰'));
 const preview=calls.find(call=>call.path.endsWith('/preview'));
 const expected=[identity,costume,prop].map(item=>imported.get(item.id).id);
 assert.deepEqual(referenceAssetGenerationRequest(project,{...preview.input,requestId:'preview-only'},assets).referenceIds,expected);
 assert.match(await page.locator('[data-asset-prompt-preview]').inputValue(),/第3张参考【道具】/);

 // Simulate an import finishing after the dialog was cancelled.
 delayed=late.id;await open('identityAssetId');
 await page.locator('[data-gen-picker-query]').fill('备选人物');
 await page.locator('[data-gen-picker-search]').click();
 await page.locator('[data-gen-picker-item="'+late.id+'"]').click();
 for(let i=0;i<100&&!releaseDelay;i++)await new Promise(resolve=>setTimeout(resolve,20));
 assert.ok(releaseDelay,'取消前导入请求已发出');
 await page.locator('[data-gen-picker-close]').click();
 releaseDelay();releaseDelay=null;delayed=null;
 await page.waitForTimeout(200);
 assert.equal(await page.locator('[data-setting=identityAssetId]').inputValue(),expected[0]);
 assert.equal(await page.evaluate(assetId=>window.fixture.assets.some(a=>a.library?.assetId===assetId),late.id),false);

 // A response from the previous account must not become a current selection.
 delayed=late.id;await open('identityAssetId');
 await page.locator('[data-gen-picker-query]').fill('备选人物');
 await page.locator('[data-gen-picker-search]').click();
 await page.locator('[data-gen-picker-item="'+late.id+'"]').click();
 for(let i=0;i<100&&!releaseDelay;i++)await new Promise(resolve=>setTimeout(resolve,20));
 assert.ok(releaseDelay,'切账号前导入请求已发出');
 await page.evaluate(()=>window.dispatchEvent(new CustomEvent('moku-auth-changed')));
 releaseDelay();releaseDelay=null;delayed=null;
 await page.waitForTimeout(200);
 assert.match(await page.locator('[data-gen-picker-status]').innerText(),/账号已切换/);
 await page.locator('[data-gen-picker-close]').click();
 assert.equal(await page.locator('[data-setting=identityAssetId]').inputValue(),expected[0]);
 assert.equal(await page.evaluate(assetId=>window.fixture.assets.some(a=>a.library?.assetId===assetId),late.id),false);

 await page.locator('[data-asset-action=submit-generation]').click();
 await page.waitForFunction(()=>document.querySelector('[data-asset-status]')?.textContent.includes('已提交'));
 const submitted=calls.find(call=>call.path==='/api/project-center/reference-generation');
 assert.deepEqual([submitted.input.settings.identityAssetId,submitted.input.settings.costumeAssetId,submitted.input.settings.propAssetId],expected);
 assert.deepEqual(referenceAssetGenerationRequest(project,submitted.input,assets).referenceIds,expected);
 assert.equal(JSON.stringify(project.pages),before);
 assert.ok(!calls.some(call=>call.path.includes('/bind')));
 assert.deepEqual(errors,[]);assert.deepEqual(await page.evaluate(()=>window.errors),[]);
});
