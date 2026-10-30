import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createProject,id,clone} from '../public/model.js';
import {migrateLayerDocument} from '../public/layers.js';
import {ensureProjectPanelGeneration} from '../public/panel-generation.js';
import {captureFrameUpscale} from '../lib/frame-upscale.mjs';
import {createFrameUpscalePreview,loadFrameUpscalePreview,frameUpscaleReferencePlan} from '../lib/frame-upscale-preview.mjs';
import {createStudio} from '../server.mjs';
import {buildImagePrompt} from '../lib/codex.mjs';
const native=createRequire(import.meta.url)(process.env.COMIC_TEST_CANVAS_MODULE),base=path.resolve('../verification/frame-view-hd-20261030');fs.mkdirSync(base,{recursive:true});
function fixture(){
 const directory=fs.mkdtempSync(path.join(base,'fixture-')),p=migrateLayerDocument(createProject('格内预览')).project,page=p.pages[0],f=page.panels[0],shot=p.shots[0];p.shots=[shot];page.panels=[f];page.bubbles=[];p.pages=[page];
 const asset=(name,role,state,color)=>{const c=native.createCanvas(300,300);c.getContext('2d').fillStyle=color;c.getContext('2d').fillRect(0,0,300,300);const a={id:id('asset'),name:name+(state?'_'+state:'')+'.png',filePath:path.join(directory,role+color.slice(1)+'.png'),libraryRole:role,libraryName:name,libraryState:state,productionStatus:'confirmed',width:300,height:300};fs.writeFileSync(a.filePath,c.toBuffer('image/png'));return a;};
 const main=asset('原画','other','','#0000ff'),character=asset('甲','character','官服','#22aa66'),wrong=asset('甲','character','便服','#ff0000'),scene=asset('院子','scene','','#bb8844'),unrelated=asset('路人乙','character','便服','#008888'),assets=[main,character,wrong,scene,unrelated];
 Object.assign(shot,{participants:'甲',location:'院子',characterStates:'甲:官服',referenceIds:[character.id,scene.id],description:'甲穿官服站在院子里',sourceFields:{'出现角色':'甲','当前场景':'院子','角色状态（服装/形态）':'甲:官服'}});
 p.references=assets.slice(1).map(a=>({assetId:a.id,name:a.libraryName,role:a.libraryRole}));p.assetLibrary={version:1,assetIds:assets.slice(1).map(a=>a.id),directories:[],recursive:true};Object.assign(f,{x:100,y:100,w:100,h:120,border:0,imageAssetId:main.id,imageTransform:{x:-100,y:-70,scale:1},referenceIds:[character.id,scene.id]});ensureProjectPanelGeneration(p,assets);
 const store={db:{assets},project:()=>p,assetPath:key=>assets.find(a=>a.id===key).filePath};return {directory,p,page,f,store,assets,main,character,wrong,scene,unrelated};
}
test('本格高清预览匹配正确人物服装和场景，截图就是提交字节，取景变化与非法参考被拒绝',async()=>{
 const {directory,p,f,store,character,scene,wrong,unrelated}=fixture(),before=JSON.stringify(p),plan=frameUpscaleReferencePlan(p,f,store.db.assets);assert.deepEqual(plan.references.map(r=>r.assetId),[character.id,scene.id]);assert.equal(plan.missing.length,0);
 const preview=await createFrameUpscalePreview(p,f,store,directory);assert.deepEqual([preview.width,preview.height,preview.targetWidth,preview.targetHeight],[100,120,200,240]);assert.equal(JSON.stringify(p),before);
 const accepted=loadFrameUpscalePreview(p,f,store,directory,preview.id,[scene.id,character.id]);assert.equal(accepted.source.snapshotSha256,preview.source.snapshotSha256);assert.deepEqual(accepted.references.map(r=>r.assetId),[scene.id,character.id]);assert.deepEqual(accepted.bytes,fs.readFileSync(path.join(directory,'frame-upscale-cache','previews',preview.id,'snapshot.png')));
 for(const asset of [wrong,unrelated])assert.throws(()=>loadFrameUpscalePreview(p,f,store,directory,preview.id,[asset.id]),/本格/);
 f.imageTransform.x-=1;assert.throws(()=>loadFrameUpscalePreview(p,f,store,directory,preview.id,[]),/取景/);f.imageTransform.x+=1;
 fs.appendFileSync(character.filePath,'changed');assert.throws(()=>loadFrameUpscalePreview(p,f,store,directory,preview.id,[character.id]),/参考图片已改变/);
});
test('多边形以外和补片溢出格子的像素透明，原图隐藏区域不出现在截图中',async()=>{
 const {directory,p,page,f,store,main,wrong}=fixture();f.points=[{x:0,y:0},{x:1,y:0},{x:0,y:1}];
 const c=native.createCanvas(300,300),ctx=c.getContext('2d');ctx.fillStyle='#ff0000';ctx.fillRect(0,0,300,300);ctx.fillStyle='#0000ff';ctx.fillRect(100,70,100,120);fs.writeFileSync(main.filePath,c.toBuffer('image/png'));
 const patch={...clone(f),id:id('panel'),x:f.x+80,y:f.y+80,w:80,h:80,points:[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}],imageAssetId:wrong.id,imageTransform:{x:0,y:0,scale:1},cutoutLayer:{kind:'repair-patch',parentPanelId:f.id}};page.panels.push(patch);p.layerOrder=[f.id,patch.id];
 const result=await captureFrameUpscale(p,f,store,path.join(directory,'cache')),image=await native.loadImage(result.bytes),out=native.createCanvas(100,120);out.getContext('2d').drawImage(image,0,0);const pixel=(x,y)=>[...out.getContext('2d').getImageData(x,y,1,1).data];
 assert.deepEqual(pixel(10,10),[0,0,255,255]);assert.equal(pixel(95,110)[3],0);assert.equal(pixel(95,95)[3],0,'补片不能把格外像素带进AI输入');
});
test('预览到Codex的完整API链路只提交裁切截图及勾选的本格资产，原画保留为独立父层',async t=>{
 const {directory,p,f,assets,main,character,scene}=fixture(),calls=[];
 process.env.COMIC_PROJECT_SYNC='0';process.env.COMIC_SLOT_DIR=path.join(directory,'slots');process.env.COMIC_LIBRARY_CONFIG=path.join(directory,'no-library.json');fs.writeFileSync(process.env.COMIC_LIBRARY_CONFIG,'{"base":"http://127.0.0.1:9"}');
 const bridge={close(){},status:async()=>({connected:true,imageFeature:true}),generate:async(dir,input,refs)=>{const bytes=fs.readFileSync(input.basePanelPath);calls.push({input:clone(input),refs,bytes});const image=await native.loadImage(bytes),output=native.createCanvas(image.width*2,image.height*2);output.getContext('2d').drawImage(image,0,0,output.width,output.height);return {bytes:output.toBuffer('image/png'),imageToolSeen:true};}};
 const studio=createStudio({dataDir:path.join(directory,'data'),seedReference:false,bridge,jimengBridge:{close(){},status:async()=>({connected:false})}});studio.store.db.assets.push(...assets);studio.store.db.projects.push(p);studio.store.save();await new Promise(resolve=>studio.server.listen(0,'127.0.0.1',resolve));t.after(()=>{studio.close();studio.server.closeAllConnections();});
 const origin='http://127.0.0.1:'+studio.server.address().port,post=async(url,body)=>{const response=await fetch(origin+url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:response.status,value:await response.json()};};
 const input={projectId:p.id,panelIds:[f.id],action:'edit',editScope:'full-image',frameUpscale:true,sourceImageAssetId:main.id,editPrompt:'格内高清',expectedRevision:p.revision,provider:'codex'};
 assert.equal((await post('/api/jobs',input)).status,409,'旧客户端不能跳过截图预览');assert.equal(calls.length,0);
 const prepared=await post('/api/projects/'+p.id+'/frame-upscale/preview',{panelId:f.id,expectedRevision:p.revision});assert.equal(prepared.status,200,JSON.stringify(prepared));const preview=prepared.value;
 assert.equal(studio.store.db.jobs.length,0);const snapshot=Buffer.from(await (await fetch(origin+preview.snapshotUrl)).arrayBuffer());
 const accepted=await post('/api/jobs',{...input,frameUpscalePreviewId:preview.id,editReferenceIds:[character.id,scene.id]});assert.equal(accepted.status,202,JSON.stringify(accepted));
 for(let n=0;n<200&&(!calls.length||!studio.idle());n++)await new Promise(r=>setTimeout(r,25));
 assert.equal(calls.length,1);assert.deepEqual(calls[0].bytes,snapshot);assert.deepEqual(calls[0].refs,[character.filePath,scene.filePath]);assert.ok(!calls[0].refs.includes(main.filePath));assert.deepEqual(calls[0].input.cropBox,[0,0,100,120]);
 const prompt=buildImagePrompt(calls[0].input);assert.match(prompt,/图1.*格内/);assert.match(prompt,/图2：character/);assert.match(prompt,/图3：scene/);assert.match(prompt,/200 × 240/);
 const job=studio.store.db.jobs.at(-1);assert.equal(job.status,'done',JSON.stringify(job));assert.equal(job.applied,true,JSON.stringify(job));const current=studio.store.project(p.id).pages[0];assert.equal(current.panels.find(x=>x.id===f.id).imageAssetId,main.id);assert.ok(current.panels.some(x=>x.cutoutLayer?.parentPanelId===f.id&&x.cutoutLayer.kind==='upscale'));
});
