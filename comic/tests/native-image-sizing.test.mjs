import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeNativeSizing,nativeDisplayHeight,assessNativeResult,nativeSizingInstructions} from '../public/native-image-sizing.js';
import {codexImageCapabilities,jimengImageCapabilities,resolveMainHeight} from "../lib/native-model-capabilities.mjs";
import {normalizeArtDirection} from '../public/comic-art-direction.js';
import {createProject,id} from '../public/model.js';
import {ensurePanelGeneration} from '../public/panel-generation.js';
import {prepareBreakout,breakoutCanvas,breakoutSourceKey,applyBreakoutResult,confirmBreakout} from '../lib/breakout-production.mjs';
const preference={version:1,mode:'model-long',provider:'codex',request:{ratio:'1:3'}};
test('Codex native model and pixel maximum remain unknown; text dispatcher is never image identity',()=>{
 const c=codexImageCapabilities({status:{connected:true,version:'synthetic',model:'text-model'},assets:[{id:'asset1',width:1280,height:3840,nativeGeneration:{provider:'codex',imageModelId:null}}]});
 assert.equal(c.imageModelId,null);assert.equal(c.dispatcherModelId,null);assert.equal(c.limits,null);assert.equal(c.sizeControl,'prompt');assert.equal(c.state,'unknown');assert.equal(c.observations[0].height,3840);assert.match(c.message,/最大高度仍未知/);
 const resolved=resolveMainHeight({panelWidth:1280,nativeSizing:preference,capability:c});assert.equal(resolved.displayHeight,null);assert.equal(resolved.selectionStatus,'preference');assert.match(nativeSizingInstructions(preference),/仅把尺寸作为提示偏好/);
});
test('actual dimensions use exact uniform scale and do not use rounded screen counts',()=>{
 assert.equal(nativeDisplayHeight(1280,{...preference,observed:{width:1280,height:3840,accepted:true}}),3840);
 assert.equal(nativeDisplayHeight(1280,{...preference,observed:{width:2160,height:3840,accepted:true}}),1280*3840/2160);
 assert.equal(nativeDisplayHeight(1280,{...preference,observed:{width:1280,height:3840,accepted:false}}),null);
 assert.throws(()=>normalizeNativeSizing({...preference,request:{width:1280}}),/原生像素/);assert.throws(()=>normalizeNativeSizing({...preference,request:{ratio:'0:3'}}),/比例无效/);
});
test('live Jimeng ratio/resolution flags are discrete and never invented pixel mappings',()=>{
 const catalogue={items:[{model:'synthetic-jimeng',modes:[{name:'t2i',flags:[{flag:'--ratio',values:['1:1','1:3','unsupported']},{flag:'--resolution',values:['1K','2K']}]}]}]},c=jimengImageCapabilities({catalogue,channelVersion:'test'})[0];
 assert.deepEqual(c.ratios,['1:1','1:3']);assert.deepEqual(c.resolutions,['1K','2K']);assert.equal(c.limits,null);assert.deepEqual(c.nativeSizes,[]);assert.equal(c.transparency.supported,false);
 const value={...preference,provider:'jimeng',imageModelId:'synthetic-jimeng',request:{ratio:'1:3',resolution:'2K'}};
 const r=resolveMainHeight({panelWidth:1200,nativeSizing:value,capability:c});assert.equal(r.displayHeight,3600);assert.equal(r.nativeSizing.control,'discrete');assert.equal(r.nativeSizing.resolved.width,undefined);
 assert.throws(()=>resolveMainHeight({panelWidth:1200,nativeSizing:{...value,request:{width:1280,height:3840}},capability:c}),/未公开/);
 assert.throws(()=>resolveMainHeight({panelWidth:1200,nativeSizing:{...value,request:{ratio:'1:4'}},capability:c}),/允许选项/);
});
test('free size is legal only with complete trusted channel limits, not API assumptions',()=>{
 const c={id:'fake-only',provider:'codex',imageModelId:'fake-image',state:'contract',sizeControl:'free-size',limits:{maxEdge:3840,maxPixels:8294400,minPixels:655360,step:16,maxAspect:3}};
 const value={...preference,imageModelId:'fake-image',request:{width:1280,height:3840}};
 assert.equal(resolveMainHeight({panelWidth:1000,nativeSizing:value,capability:c}).displayHeight,3000);
 assert.throws(()=>resolveMainHeight({panelWidth:1000,nativeSizing:{...value,request:{width:1280,height:4000}},capability:c}),/超出/);
 assert.throws(()=>resolveMainHeight({panelWidth:1000,nativeSizing:value,capability:{...c,limits:null}}),/缺少/);
 const forged={...preference,resolved:{state:'verified',ratio:'1:3',capabilitySnapshotId:'forged'}};
 assert.equal(resolveMainHeight({panelWidth:1000,nativeSizing:forged,capability:codexImageCapabilities()}).displayHeight,null);
});
test('unknown prompt native result needs acceptance, mismatched dimensions stay candidates',()=>{
 const equal=assessNativeResult(preference,{width:1280,height:3840},{provider:'codex'});assert.equal(equal.mismatch,false);assert.equal(equal.requiresAcceptance,true);assert.deepEqual(equal.actual,{width:1280,height:3840});
 const wrong=assessNativeResult({...preference,request:{width:1280,height:3840}},{width:1024,height:3072},{provider:'codex'});assert.equal(wrong.mismatch,true);assert.match(wrong.notice,/候选/);
 const resolved=assessNativeResult({...preference,provider:'jimeng',resolved:{state:'contract',ratio:'1:3'}},{width:1024,height:3072},{provider:'jimeng',imageModelId:'actual-image'});assert.equal(resolved.requiresAcceptance,false);
 const unrelated=assessNativeResult(undefined,{width:1024,height:1024},{provider:'codex'});assert.equal(unrelated.requiresAcceptance,false);
});

function breakoutFixture(){
 const project=createProject('directional synthetic'),page=project.pages[0],panel=page.panels[0];project.revision=1;page.height=5000;Object.assign(panel,{x:200,y:400,w:800,h:1000,imageAssetId:id('asset')});const background={id:panel.imageAssetId,filePath:'D:/synthetic/background.png',mime:'image/png',width:800,height:1000};ensurePanelGeneration(project,panel,[background]);panel.artDirection={breakout:'foreground',breakoutSubject:'已有手部',breakoutExtents:{unit:'ratio',left:0,right:.1,top:.5,bottom:0}};return {project,page,panel,assets:[background]};
}
test('directional breakout extents are saved through request and alpha-confirmed independent layer',()=>{
 const f=breakoutFixture(),c=breakoutCanvas(f.page,f.panel);assert.deepEqual(c,{x:200,y:0,w:880,h:1400,backgroundRect:{x:0,y:400,w:800,h:1000}});
 const request=prepareBreakout(f.project,f.panel.id,f.assets);assert.deepEqual(request.extents,f.panel.artDirection.breakoutExtents);assert.deepEqual(request.bridgeInput.breakoutContract.extents,request.extents);
 const width=c.w,height=c.h,total=width*height,transparency={format:'PNG',valid:true,width,height,transparentPixels:total/2,visiblePixels:total/2,opaquePixels:total/2},asset={id:id('asset'),mime:'image/png',width,height,transparency};f.assets.push(asset);
 const {candidate}=applyBreakoutResult(f.project,request,{assetId:asset.id,jobId:id('job'),alphaVerified:true,transparency,assets:f.assets});assert.deepEqual(candidate.extents,request.extents);
 const {foreground}=confirmBreakout(f.project,f.panel.id,asset.id,f.assets);assert.deepEqual(foreground.breakoutForeground.extents,request.extents);assert.equal(foreground.imageTransform.scale,1);assert.equal(f.panel.imageAssetId,request.backgroundAssetId);
});
test('changing breakout extents invalidates late result fingerprint and bounds invalid extents',()=>{
 const f=breakoutFixture(),key=breakoutSourceKey(f.project,f.panel,f.assets),request=prepareBreakout(f.project,f.panel.id,f.assets);f.panel.artDirection.breakoutExtents.top=.4;assert.notEqual(breakoutSourceKey(f.project,f.panel,f.assets),key);
 assert.throws(()=>normalizeArtDirection({breakoutExtents:{top:1.1}}),/0–1/);assert.throws(()=>normalizeArtDirection({breakoutExtents:{unit:'pixels',top:300}}),/比例/);
 const width=request.canvas.w,height=request.canvas.h,total=width*height,transparency={format:'PNG',valid:true,width,height,transparentPixels:total/2,visiblePixels:total/2,opaquePixels:total/2};const {candidate}=applyBreakoutResult(f.project,request,{assetId:id('asset'),jobId:id('job'),alphaVerified:true,transparency,assets:f.assets});assert.equal(candidate.status,'stale');
});
