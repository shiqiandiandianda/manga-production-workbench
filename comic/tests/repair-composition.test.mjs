import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {randomUUID,createHash} from 'node:crypto';
import {createStudio} from '../server.mjs';
import {createProject} from '../public/model.js';
import {localRegionLayer,replacementBubble} from '../public/local-region-layers.js';
import {applyBubbleEdit} from '../public/bubble-editor.js';
import {captureRepairComposition,compositionDifference} from '../lib/repair-composition.mjs';
import {listenForFetch} from './helpers/listen-for-fetch.mjs';
const require=createRequire(import.meta.url),root=fileURLToPath(new URL('../../',import.meta.url)),runtime=path.join(root,'runtime'),canvasModule=process.env.COMIC_TEST_CANVAS_MODULE||path.join(runtime,'node/node_modules/@napi-rs/canvas'),{createCanvas,loadImage}=require(canvasModule);
const proof=path.join(root,'verification/repair-composition');fs.mkdirSync(proof,{recursive:true});const hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function image(w,h,draw){const c=createCanvas(w,h);draw(c.getContext('2d'));return c.toBuffer('image/png');}
const fill=color=>ctx=>{ctx.fillStyle=color;ctx.fillRect(0,0,1000,1000);};
async function pixels(file){const im=await loadImage(file),c=createCanvas(im.width,im.height),ctx=c.getContext('2d');ctx.drawImage(im,0,0);return {im,c,ctx,get:(x,y)=>[...ctx.getImageData(Math.round(x),Math.round(y),1,1).data]};}
async function fixture(t){
 const dir=fs.mkdtempSync(path.join(proof,'case-'));Object.assign(process.env,{COMIC_PROJECT_SYNC:'0',COMIC_SLOT_DIR:path.join(dir,'slots'),COMIC_LIBRARY_CONFIG:path.join(dir,'moku.json'),COMIC_CANVAS_MODULE:canvasModule,COMIC_TEST_CANVAS_MODULE:canvasModule,COMIC_PYTHON_BIN:path.join(runtime,'python/python.exe'),IMAGE_REPAIR_PYTHON:path.join(root,'.runtime/image-tools/python/python.exe')});fs.writeFileSync(process.env.COMIC_LIBRARY_CONFIG,JSON.stringify({base:'http://127.0.0.1:9'}));
 const studio=createStudio({dataDir:dir,bridge:{close(){},status:async()=>({connected:false})},jimengBridge:{close(){},status:async()=>({connected:false})}});const origin=await listenForFetch(studio.server);t.after(()=>{studio.close();studio.server.closeAllConnections();});const api=async(route,input,method=input?'POST':'GET')=>{const r=await fetch(origin+route,{method,...(input?{headers:{'Content-Type':'application/json'},body:JSON.stringify(input)}:{})});return {status:r.status,body:await r.json()};};
 const source=path.join(dir,'base.png'),patchFile=path.join(dir,'patch.png');fs.writeFileSync(source,image(160,120,ctx=>{fill('#24648b')(ctx);ctx.fillStyle='white';ctx.strokeStyle='black';ctx.lineWidth=2;ctx.beginPath();ctx.ellipse(35,35,15,15,0,0,Math.PI*2);ctx.fill();ctx.stroke();}));fs.writeFileSync(patchFile,image(50,50,fill('#24648b')));
 const asset=(await api('/api/assets',{filePath:source})).body,patchAsset=(await api('/api/assets',{filePath:patchFile})).body,p=createProject('移动气泡修图同步合成验收');p.pages[0].panels=[p.pages[0].panels[0]];p.pages[0].bubbles=[];const frame=p.pages[0].panels[0];Object.assign(frame,{name:'原画面',x:100,y:100,w:320,h:240,imageAssetId:asset.id,imageTransform:{x:0,y:0,scale:2},border:0});
 const sessionId=randomUUID(),taskId=randomUUID(),patch=localRegionLayer(p,frame,patchAsset,{width:160,height:120},{x:10,y:10,w:50,h:50},{sessionId,taskId,operation:'inpaint',sourceAssetId:asset.id}).layer,bubble=replacementBubble(p,frame,patch,{width:160,height:120},{x:.1,y:.1,w:.25,h:.3},{styleKind:'speech'});Object.assign(bubble,{...applyBubbleEdit(bubble,{type:'move',dx:285-bubble.x,dy:130-bubble.y}),w:70,h:50,tail:{visible:false,side:'bottom',base:.5},fillColor:'#ffffff',fillOpacity:1,outlineColor:'#111111',outlineWidth:2,text:''});
 const hidden={...structuredClone(patch),id:'panel_'+randomUUID(),visible:false,name:'隐藏补图'};p.pages[0].panels.push(hidden);studio.store.db.projects.push(p);studio.store.save();
 const current=()=>studio.store.project(p.id),session=()=>api('/api/integrated-repair/sessions',{projectId:p.id,panelId:frame.id,expectedRevision:current().revision}),fileFor=meta=>path.join(dir,'repair/sources',meta.id,'original.png'),exportFile=(name,bytes)=>{const out=path.join(dir,'repair/exports',name);fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,bytes);return '/repair/exports/'+name;};
 const apply=(s,url,mode='replace')=>api('/api/integrated-repair/sessions/'+s.id+'/apply',{expectedRevision:current().revision,resultUrl:url,mode});return {dir,studio,origin,api,p,frame,asset,patch,patchFile,bubble,source,current,session,fileFor,exportFile,apply};
}


const editableBubbles=value=>structuredClone(Array.isArray(value)?value:[value]).map(b=>{if(b.localReplacement)delete b.localReplacement.patchLayerId;return b;});

test('修图只载入原画与补底，独立气泡及文字不进入图片',async t=>{
 const f=await fixture(t),before=structuredClone(f.current()),baseHash=hash(f.source),patchHash=hash(f.patchFile),r=await f.session();assert.equal(r.status,201,JSON.stringify(r.body));assert.equal(r.body.session.targetKind,'composition');assert.equal(r.body.session.composition.version,2);const comp=r.body.session.composition,p=await pixels(f.fileFor(r.body.metadata)),at=(x,y)=>p.get((x-comp.region.x)*comp.scale,(y-comp.region.y)*comp.scale);
 assert.deepEqual(at(170,170),[36,100,139,255]);assert.deepEqual(at(320,155),[36,100,139,255]);assert.deepEqual(comp.bubbles,[]);assert.deepEqual(f.current(),before);assert.equal(hash(f.source),baseHash);assert.equal(hash(f.patchFile),patchHash);
});
test('移动独立气泡不改变修图原件，也不阻止当前修图结果回填',async t=>{
 const f=await fixture(t),first=(await f.session()).body;Object.assign(f.bubble,applyBubbleEdit(f.bubble,{type:'move',dx:45,dy:0}));const second=(await f.session()).body;assert.equal(first.metadata.id,second.metadata.id);assert.equal(first.session.composition.stamp,second.session.composition.stamp);
 const p=await pixels(f.fileFor(first.metadata));p.ctx.fillStyle='red';p.ctx.fillRect(220,170,12,10);const r=await f.apply(first.session,f.exportFile('bubble-moved.png',p.c.toBuffer('image/png')));assert.equal(r.status,200,JSON.stringify(r.body));assert.deepEqual(editableBubbles(f.current().pages[0].bubbles[0]),editableBubbles(f.bubble));
});
test('无改动直接应用不新增图层，也不修改原图',async t=>{
 const f=await fixture(t),before=structuredClone(f.current()),s=(await f.session()).body,r=await f.apply(s.session,f.exportFile('noop.png',fs.readFileSync(f.fileFor(s.metadata))));assert.equal(r.status,200,JSON.stringify(r.body));assert.match(r.body.message,/没有变化/);assert.deepEqual(f.current(),before);
});
test('返修自动合并到原画格，保留独立气泡和隐藏层，重新载入为完整图且重复回填去重',async t=>{
 const f=await fixture(t),before=structuredClone(f.current()),sourceHash=hash(f.source),s=(await f.session()).body,p=await pixels(f.fileFor(s.metadata));p.ctx.fillStyle='#ed3545';p.ctx.fillRect(220,170,12,10);const url=f.exportFile('edit.png',p.c.toBuffer('image/png')),r=await f.apply(s.session,url);assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.createdLayer,false);assert.equal(r.body.updatedLayer,true);assert.equal(r.body.layerId,f.frame.id);assert.equal(f.current().pages[0].panels.length,before.pages[0].panels.length-1);assert.deepEqual(editableBubbles(f.current().pages[0].bubbles),editableBubbles(before.pages[0].bubbles));assert.equal(hash(f.source),sourceHash);
 const layer=f.current().pages[0].panels.find(p=>p.id===f.frame.id),out=await pixels(f.studio.store.assetPath(layer.imageAssetId));assert.deepEqual(out.get(225,175),[237,53,69,255]);assert.deepEqual(out.get(30,30),[36,100,139,255]);assert.equal(layer.cutoutLayer,undefined);assert.equal(layer.x,f.frame.x);assert.equal(layer.y,f.frame.y);assert.equal(layer.w,f.frame.w);assert.equal(layer.h,f.frame.h);
 const duplicate=await f.apply(r.body.session,url);assert.equal(duplicate.status,200,JSON.stringify(duplicate.body));assert.equal(duplicate.body.layerId,layer.id);assert.equal(f.current().pages[0].panels.length,before.pages[0].panels.length-1);
 const reopen=(await f.session()).body;assert.equal(reopen.session.targetKind,'frame');const visible=await pixels(f.fileFor(reopen.metadata));assert.deepEqual(visible.get(225,175),[237,53,69,255]);assert.equal(visible.get(30,30)[3],255);
});
test('补图内容变化、画板锁定、生成中或预览损坏均拦截旧会话',async t=>{
 for(const type of ['asset','lock','generation','snapshot','patch-lock']){const f=await fixture(t),s=(await f.session()).body,p=await pixels(f.fileFor(s.metadata));p.ctx.fillStyle='red';p.ctx.fillRect(220,170,8,8);const url=f.exportFile(type+'.png',p.c.toBuffer('image/png'));if(type==='asset')fs.writeFileSync(f.patchFile,image(50,50,fill('#002244')));if(type==='lock')f.current().pages[0].locked=true;if(type==='patch-lock')f.patch.locked=true;if(type==='generation')f.studio.store.db.jobs.push({id:'job_'+randomUUID(),projectId:f.p.id,panelId:f.frame.id,status:'running'});if(type==='snapshot')fs.writeFileSync(s.session.composition.file,image(p.im.width,p.im.height,fill('white')));const before=structuredClone(f.current()),r=await f.apply(s.session,url);assert.equal(r.status,409,JSON.stringify(r.body));assert.deepEqual(f.current(),before);}
});
test('只有可编辑气泡时仍直接修原图；选中旧补片时自动载入完整原画',async t=>{
 const f=await fixture(t),selected=await f.api('/api/integrated-repair/sessions',{projectId:f.p.id,panelId:f.patch.id,expectedRevision:f.current().revision});assert.equal(selected.status,201);assert.equal(selected.body.session.panelId,f.frame.id);assert.equal(selected.body.metadata.width,320);
 for(const p of f.p.pages[0].panels)if(p.cutoutLayer)p.visible=false;const r=await f.session();assert.equal(r.status,201);assert.equal(r.body.session.targetKind,'frame');assert.equal(r.body.metadata.width,160);assert.equal(r.body.metadata.height,120);assert.equal(f.bubble.visible,true);
});
test('自动合并保留透明擦除结果',async t=>{
 const f=await fixture(t),s=(await f.session()).body,p=await pixels(f.fileFor(s.metadata));p.ctx.clearRect(220,170,10,10);const r=await f.apply(s.session,f.exportFile('transparent.png',p.c.toBuffer('image/png')));assert.equal(r.status,200,JSON.stringify(r.body));const out=await pixels(f.studio.store.assetPath(r.body.asset.id));assert.equal(out.get(225,175)[3],0);assert.equal(out.get(30,30)[3],255);
});
test('显式独立补片只保存修改小块；再次选中补片仍加载完整画面',async t=>{
 const f=await fixture(t),before=structuredClone(f.current()),s=(await f.session()).body,p=await pixels(f.fileFor(s.metadata));p.ctx.fillStyle='#ed3545';p.ctx.fillRect(220,170,12,10);const r=await f.apply(s.session,f.exportFile('patch.png',p.c.toBuffer('image/png')),'layer');assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.createdLayer,true);assert.equal(r.body.asset.width,12);assert.equal(r.body.asset.height,10);assert.deepEqual(editableBubbles(f.current().pages[0].bubbles),editableBubbles(before.pages[0].bubbles));
 const patch=f.current().pages[0].panels.find(x=>x.id===r.body.layerId);assert.equal(patch.x,320);assert.equal(patch.y,270);assert.equal(patch.w,20);assert.equal(patch.h,20);assert.equal(patch.imageTransform.scale,1);
 const reopen=await f.api('/api/integrated-repair/sessions',{projectId:f.p.id,panelId:patch.id,expectedRevision:f.current().revision});assert.equal(reopen.status,201);assert.equal(reopen.body.session.panelId,f.frame.id);assert.equal(reopen.body.metadata.width,320);assert.equal(reopen.body.metadata.height,240);
});
test('修图合并可以保存撤回和重做，且拒绝未登记图片替换',async t=>{
 const f=await fixture(t),before=structuredClone(f.current()),s=(await f.session()).body,p=await pixels(f.fileFor(s.metadata));p.ctx.fillStyle='#ed3545';p.ctx.fillRect(220,170,12,10);const applied=await f.apply(s.session,f.exportFile('history.png',p.c.toBuffer('image/png'))),after=structuredClone(applied.body.project);
 const undo=await f.api('/api/projects/'+f.p.id,{...before,revision:f.current().revision},'PUT');assert.equal(undo.status,200,JSON.stringify(undo.body));assert.equal(undo.body.pages[0].panels.find(x=>x.id===f.frame.id).imageAssetId,f.asset.id);assert.equal(undo.body.pages[0].panels.length,before.pages[0].panels.length);
 const redo=await f.api('/api/projects/'+f.p.id,{...after,revision:f.current().revision},'PUT');assert.equal(redo.status,200);assert.equal(redo.body.pages[0].panels.find(x=>x.id===f.frame.id).imageAssetId,applied.body.asset.id);
 const bad=structuredClone(redo.body);bad.pages[0].panels.find(x=>x.id===f.frame.id).imageAssetId=f.patch.imageAssetId;const saved=await f.api('/api/projects/'+f.p.id,bad,'PUT');assert.equal(saved.body.pages[0].panels.find(x=>x.id===f.frame.id).imageAssetId,applied.body.asset.id);
});
test('排版同页合并补图，撤回重做完整恢复图层和独立文字',{timeout:60000},async t=>{
 const f=await fixture(t),{chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright'),browser=await chromium.launch({channel:'msedge',headless:true});t.after(()=>browser.close());const page=await browser.newPage({viewport:{width:1864,height:1040}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(f.origin+'/?project='+f.p.id);await page.waitForFunction(()=>document.querySelector('#save-state')?.textContent.includes('已保存'));await page.locator('[data-rail-tab="layers"]').click();await page.locator('[data-layer="'+f.frame.id+'"]').click();await page.locator('#repair-current-panel').click();const before=structuredClone(f.current());await page.locator('[data-repair-action=merge]').click();await page.locator('#toast').filter({hasText:'已合并'}).waitFor();assert.equal(f.current().pages[0].panels.length,before.pages[0].panels.length-1);assert.deepEqual(editableBubbles(f.current().pages[0].bubbles),editableBubbles(before.pages[0].bubbles));
 const undoSaved=page.waitForResponse(r=>r.url().endsWith('/api/projects/'+f.p.id)&&r.request().method()==='PUT');await page.locator('#undo').click();assert.equal((await undoSaved).status(),200);assert.equal(f.current().pages[0].panels.length,before.pages[0].panels.length);assert.equal(f.current().pages[0].panels.find(x=>x.id===f.frame.id).imageAssetId,f.asset.id);
 const redoSaved=page.waitForResponse(r=>r.url().endsWith('/api/projects/'+f.p.id)&&r.request().method()==='PUT');await page.locator('#redo').click();assert.equal((await redoSaved).status(),200);assert.equal(f.current().pages[0].panels.length,before.pages[0].panels.length-1);assert.deepEqual(errors,[]);
});

test('手动合并原画与补片允许保留夹在中间的独立气泡',async t=>{
 const f=await fixture(t),before=structuredClone(f.current().pages[0].bubbles);f.current().layerOrder=[f.frame.id,f.bubble.id,f.patch.id,...f.current().pages[0].panels.filter(p=>p.visible===false).map(p=>p.id)];
 const r=await f.api('/api/projects/'+f.p.id+'/merge-layers',{layerIds:[f.frame.id,f.patch.id],expectedRevision:f.current().revision});assert.equal(r.status,200,JSON.stringify(r.body));assert.deepEqual(editableBubbles(r.body.project.pages[0].bubbles),editableBubbles(before));assert.ok(r.body.project.layerOrder.indexOf(f.frame.id)<r.body.project.layerOrder.indexOf(f.bubble.id));
});
