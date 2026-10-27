import test from 'node:test';import assert from 'node:assert/strict';
import {createProject,id} from '../public/model.js';
import {ensurePanelGeneration} from '../public/panel-generation.js';
import {prepareBreakout,applyBreakoutResult,confirmBreakout,breakoutSourceKey,breakoutCanvas,validateBreakoutMetadata} from '../lib/breakout-production.mjs';
import {breakoutControlsMarkup} from '../public/breakout-production-ui.js';
import {validateProject} from '../lib/store.mjs';
const copy=value=>structuredClone(value);
const alpha=(w,h)=>({format:'PNG',valid:true,width:w,height:h,transparentPixels:Math.floor(w*h*.6),visiblePixels:w*h-Math.floor(w*h*.6),opaquePixels:w*h-Math.floor(w*h*.6)});
function fixture(){
 const project=createProject('合成破框'),panel=project.pages[0].panels[0];project.revision=5;project.pages[0].height=4000;Object.assign(panel,{x:200,y:400,w:800,h:1000,points:[{x:.1,y:0},{x:1,y:.1},{x:.9,y:1},{x:0,y:.9}],imageTransform:{x:-30,y:-20,scale:1.1},name:'S01 · 合成举手'});project.shots[0].description='甲举起右手，乙站在旁边。';
 const background={id:id('asset'),name:'合成背景主图',filePath:'D:/synthetic/background.png',mime:'image/png',width:800,height:1000},face={id:id('asset'),name:'甲身份',filePath:'D:/synthetic/face.png',mime:'image/png',width:512,height:512,libraryRole:'character'};project.references=[{assetId:face.id,name:'甲',role:'character'}];project.shots[0].referenceIds=[face.id];panel.imageAssetId=background.id;ensurePanelGeneration(project,panel,[background,face]);panel.artDirection={breakout:'foreground',breakoutSubject:'甲举起的右手与前臂',view:'low'};project.layerOrder=[panel.id,...project.pages[0].bubbles.map(b=>b.id)];return {project,panel,assets:[background,face]};
}
function finish(f,{changed=false}={}){
 const request=prepareBreakout(f.project,f.panel.id,f.assets),width=Math.round(request.canvas.w),height=Math.round(request.canvas.h),asset={id:id('asset'),name:'合成透明前景',filePath:'D:/synthetic/foreground.png',mime:'image/png',extension:'.png',width,height,transparency:alpha(width,height)};f.assets.push(asset);if(changed)f.panel.generation.prompt+=' 当前动作已改成收手。';
 const applied=applyBreakoutResult(f.project,request,{assetId:asset.id,jobId:id('job'),alphaVerified:true,transparency:asset.transparency,assets:f.assets});return {...f,request,asset,candidate:applied.candidate};
}
test('准备请求明确引用背景+身份图，保持原格尺寸和图片取景，输出扩展透明画布而不改工程',()=>{
 const f=fixture(),before=copy(f.project),request=prepareBreakout(f.project,f.panel.id,f.assets);assert.deepEqual(f.project,before);assert.equal(request.kind,'breakout-foreground');assert.equal(request.provider,'codex');assert.equal(request.referenceAssetIds[0],f.panel.imageAssetId);assert.deepEqual(request.referenceFiles,['D:/synthetic/background.png','D:/synthetic/face.png']);assert.equal(request.bridgeInput.referenceRoles[0].role,'scene');assert.equal(request.bridgeInput.breakoutContract.transparentBackground,true);assert.deepEqual(request.bridgeInput.breakoutContract.originalImageTransform,f.panel.imageTransform);assert.deepEqual(request.bridgeInput.breakoutContract.sourcePanelSize,{w:800,h:1000});assert.deepEqual(request.canvas,{x:40,y:150,w:1120,h:1500,backgroundRect:{x:160,y:250,w:800,h:1000}});assert.equal(request.sourceRevision,5);
});
test('锁定、旧修订、无背景、无主体及即梦透明通道在排队前明确拒绝',()=>{
 const f=fixture();assert.throws(()=>prepareBreakout(f.project,f.panel.id,f.assets,{revision:4}),/工程已更新/);assert.throws(()=>prepareBreakout(f.project,f.panel.id,f.assets,{provider:'jimeng'}),/只有Codex/);f.panel.locked=true;assert.throws(()=>prepareBreakout(f.project,f.panel.id,f.assets),/已锁定/);f.panel.locked=false;const image=f.panel.imageAssetId;f.panel.imageAssetId=null;assert.throws(()=>prepareBreakout(f.project,f.panel.id,f.assets),/背景主图/);f.panel.imageAssetId=image;f.panel.artDirection.breakoutSubject='';assert.throws(()=>prepareBreakout(f.project,f.panel.id,f.assets),/明确破框/);
});
test('边缘格的扩展限制在当前页面，前景可跨原框但不会被原框形状限制',()=>{
 const f=fixture();Object.assign(f.panel,{x:0,y:10,w:1280,h:1000});const c=breakoutCanvas(f.project.pages[0],f.panel);assert.equal(c.x,0);assert.equal(c.y,0);assert.equal(c.w,1280);assert.ok(c.h>f.panel.h);assert.equal(c.backgroundRect.y,10);
});
test('源指纹覆盖本格提示词、尺寸、轮廓、图片取景、样式、身份参考，忽略无关工程修订',()=>{
 const original=fixture(),key=breakoutSourceKey(original.project,original.panel,original.assets);const variants=[f=>f.panel.generation.prompt+='新版',f=>f.panel.x++,f=>f.panel.w++,f=>f.panel.points[0].x+=.03,f=>f.panel.imageTransform.scale+=.1,f=>f.project.style+='新版',f=>f.panel.artDirection.view='worm',f=>f.panel.referenceIds=[],f=>f.panel.artDirection.breakoutSubject='更换越框主体',f=>f.panel.artDirection.breakoutExtents={unit:'ratio',left:.3,right:.2,top:.2,bottom:.2}];
 for(const [index,mutate] of variants.entries()){const f=fixture(); // Fresh UUIDs have their own baseline, so compare only within this instance.
  const baseline=breakoutSourceKey(f.project,f.panel,f.assets);mutate(f);assert.notEqual(breakoutSourceKey(f.project,f.panel,f.assets),baseline,'变更项 '+index+' 未更新来源指纹');}
 original.project.revision++;original.project.title='合成无关重命名';assert.equal(breakoutSourceKey(original.project,original.panel,original.assets),key);
});
test('结果只进候选，保留背景与全部既有图层；同一任务重复返回不会重复添加',()=>{
 const f=fixture(),before=copy(f.panel),oldCount=f.project.pages[0].panels.length,r=finish(f);assert.equal(r.candidate.status,'ready');assert.equal(r.project.pages[0].panels.length,oldCount);assert.deepEqual({...r.panel,breakoutCandidates:undefined},{...before,breakoutCandidates:undefined});const repeat=applyBreakoutResult(r.project,r.request,{assetId:r.asset.id,jobId:r.candidate.jobId,alphaVerified:true,transparency:r.asset.transparency,assets:r.assets});assert.equal(repeat.added,false);assert.equal(r.panel.breakoutCandidates.length,1);
});
test('白底、空图或未验收结果不进可确认候选',()=>{
 const f=fixture(),request=prepareBreakout(f.project,f.panel.id,f.assets);for(const result of [{alphaVerified:false,transparency:alpha(1120,1500)},{alphaVerified:true,transparency:{...alpha(1120,1500),transparentPixels:0,visiblePixels:1120*1500,opaquePixels:1120*1500}},{alphaVerified:true,transparency:{...alpha(1120,1500),transparentPixels:1120*1500,visiblePixels:0,opaquePixels:0}}])assert.throws(()=>applyBreakoutResult(f.project,request,{assetId:id('asset'),jobId:id('job'),...result}));assert.equal(f.panel.breakoutCandidates,undefined);
});
test('生成过程中当前源改变或被锁定，仍保存真实透明候选但不自动应用',()=>{
 const r=finish(fixture(),{changed:true});assert.equal(r.candidate.status,'stale');const before=copy(r.project);assert.throws(()=>confirmBreakout(r.project,r.panel.id,r.asset.id,r.assets),/旧前景保留为候选/);assert.deepEqual(r.project,before);
 const f=fixture(),request=prepareBreakout(f.project,f.panel.id,f.assets);f.panel.locked=true;const result=applyBreakoutResult(f.project,request,{assetId:id('asset'),jobId:id('job'),alphaVerified:true,transparency:alpha(1120,1500),assets:f.assets});assert.equal(result.candidate.status,'stale');assert.throws(()=>confirmBreakout(f.project,f.panel.id,result.candidate.assetId,f.assets),/已锁定/);
});
test('旧版候选来源信息不足时保留原件并明确阻止采用',()=>{
 const r=finish(fixture());delete r.candidate.sourceKeyVersion;const before=copy(r.project);
 assert.throws(()=>confirmBreakout(r.project,r.panel.id,r.asset.id,r.assets),/旧版候选未记录完整画面设计/);assert.deepEqual(r.project,before);
});
test('即使字段源指纹相同，已标记原文件变化的stale候选也不能直接确认',()=>{
 const r=finish(fixture());r.candidate.status='stale';const before=copy(r.project);assert.throws(()=>confirmBreakout(r.project,r.panel.id,r.asset.id,r.assets),error=>error.status===409&&/来源已过期/.test(error.message));assert.deepEqual(r.project,before);
});
test('任务参考文件stamp完整保留到候选，允许API再次核对文件变化',()=>{
 const f=fixture(),request=prepareBreakout(f.project,f.panel.id,f.assets);request.referenceStamp='[["D:/synthetic/background.png",123,100,100],["D:/synthetic/face.png",456,100,100]]';const result=applyBreakoutResult(f.project,request,{assetId:id('asset'),jobId:id('job'),alphaVerified:true,transparency:alpha(1120,1500),assets:f.assets});assert.equal(result.candidate.referenceStamp,request.referenceStamp);assert.doesNotThrow(()=>validateBreakoutMetadata(f.panel));result.candidate.referenceStamp={invalid:true};assert.throws(()=>validateBreakoutMetadata(f.panel),/破框候选字段无效/);
});
test('确认产生独立透明矩形层，跨框范围与来源锚点对齐，背景原图和轮廓保持',()=>{
 const r=finish(fixture()),original={assetId:r.panel.imageAssetId,points:copy(r.panel.points),transform:copy(r.panel.imageTransform)},result=confirmBreakout(r.project,r.panel.id,r.asset.id,r.assets),front=result.foreground;
 assert.equal(front.x,40);assert.equal(front.y,150);assert.equal(front.w,1120);assert.equal(front.h,1500);assert.deepEqual(front.points,[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}]);assert.equal(front.border,0);assert.equal(front.feather,0);assert.equal(front.shotId,'');assert.equal(front.generation,undefined);assert.deepEqual(front.imageTransform,{x:0,y:0,scale:1});assert.equal(front.breakoutForeground.backgroundPanelId,r.panel.id);assert.equal(r.project.layerOrder.indexOf(front.id),r.project.layerOrder.indexOf(r.panel.id)+1);assert.deepEqual({assetId:r.panel.imageAssetId,points:r.panel.points,transform:r.panel.imageTransform},original);assert.equal(r.candidate.status,'confirmed');assert.doesNotThrow(()=>validateProject(r.project));assert.doesNotThrow(()=>validateBreakoutMetadata(r.panel));assert.doesNotThrow(()=>validateBreakoutMetadata(front));
});
test('确认依赖全局资产的真实像素证据，项目候选伪造标记不足以通过',()=>{
 const r=finish(fixture());delete r.asset.transparency;const before=copy(r.project);assert.throws(()=>confirmBreakout(r.project,r.panel.id,r.asset.id,r.assets),/可信的真实PNG/);assert.deepEqual(r.project,before);r.asset.transparency=alpha(r.asset.width,r.asset.height);r.asset.transparency.width++;assert.throws(()=>confirmBreakout(r.project,r.panel.id,r.asset.id,r.assets),/图片尺寸不一致/);
});
test('输出比例不符合计划、锚点被改写时拒绝应用并保留候选',()=>{
 const r=finish(fixture());r.asset.width=1024;r.asset.height=1024;r.asset.transparency=alpha(1024,1024);assert.throws(()=>confirmBreakout(r.project,r.panel.id,r.asset.id,r.assets),/比例与计划画布不一致/);assert.equal(r.panel.breakoutCandidates.length,1);r.asset.width=1120;r.asset.height=1500;r.asset.transparency=alpha(1120,1500);r.candidate.canvas.y+=50;assert.throws(()=>confirmBreakout(r.project,r.panel.id,r.asset.id,r.assets),/画布锚点与当前来源不一致/);
});
test('确认同一候选可安全重试，换候选保留旧前景但隐藏，不覆盖锁定前景',()=>{
 const r=finish(fixture()),first=confirmBreakout(r.project,r.panel.id,r.asset.id,r.assets),count=r.project.pages[0].panels.length;assert.equal(confirmBreakout(r.project,r.panel.id,r.asset.id,r.assets).reused,true);assert.equal(r.project.pages[0].panels.length,count);
 const next=finish(r);first.foreground.locked=true;assert.throws(()=>confirmBreakout(next.project,next.panel.id,next.asset.id,next.assets),/已有破框前景已锁定/);assert.equal(first.foreground.visible,true);first.foreground.locked=false;const second=confirmBreakout(next.project,next.panel.id,next.asset.id,next.assets);assert.equal(first.foreground.visible,false);assert.equal(second.foreground.visible,true);assert.equal(next.panel.imageAssetId,next.request.backgroundAssetId);
});
test('仅当前开启破框的背景格显示折叠控件，失效候选没有可用确认按钮',()=>{
 const r=finish(fixture(),{changed:true}),escape=s=>String(s).replaceAll('<','&lt;').replaceAll('"','&quot;'),markup=breakoutControlsMarkup(r.panel,escape);assert.match(markup,/透明破框前景/);assert.match(markup,/来源已变更/);assert.match(markup,/data-action="confirm-breakout"[^>]*disabled/);assert.equal(breakoutControlsMarkup({}), '');r.panel.artDirection.breakoutSubject='<img onerror=bad>';r.candidate.subject='<img onerror=bad>';assert.doesNotMatch(breakoutControlsMarkup(r.panel,escape),/<img onerror/);
});
