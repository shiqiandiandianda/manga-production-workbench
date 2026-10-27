import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
import {panel,createProject,clone,fitImage,id} from '../public/model.js';import {paintArtworkImage,artworkMirrorSvg,artworkDelta,fitArtwork,scaleArtwork,artworkZoomPercent} from '../public/artwork-transform.js';
import {frameGaps} from '../public/frame-shortcuts.js';import {resizeEmptyGap} from '../public/strip-space.js';import {validateProject} from '../lib/store.mjs';import {recordLayoutAdjustment,ensureLayoutHistory,preserveLayoutHistory,layoutEditSnapshot} from '../public/layout-history.js';import {pageCanvas} from '../public/render.js';
const require=createRequire(import.meta.url),canvas=require(process.env.COMIC_TEST_CANVAS_MODULE);
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} / ${b}`);
function artwork(){const c=canvas.createCanvas(100,100),ctx=c.getContext('2d');for(const [x,y,color] of [[0,0,'#ff0000'],[50,0,'#00ff00'],[0,50,'#0000ff'],[50,50,'#ffff00']]){ctx.fillStyle=color;ctx.fillRect(x,y,50,50);}c.naturalWidth=c.width;c.naturalHeight=c.height;return c;}
const pixel=(ctx,x,y)=>Array.from(ctx.getImageData(x,y,1,1).data).slice(0,3);
test('图片水平、垂直镜像与旋转同时作用于像素；画格和文字不变',async()=>{
 const image=artwork(),p=createProject('合成图像旋转',true),page=p.pages[0],f=page.panels[0];page.height=300;page.bubbles=[];Object.assign(f,{x:20,y:20,w:100,h:100,imageAssetId:'asset_synthetic',imageTransform:{x:0,y:0,scale:1},border:0,feather:0});
 const draw=async t=>{f.imageTransform={x:0,y:0,scale:1,...t};return (await pageCanvas(page,{canvasFactory:()=>canvas.createCanvas(1,1),imageLoader:async()=>image})).getContext('2d');};
 assert.deepEqual(pixel(await draw({}),30,30),[255,0,0]);assert.deepEqual(pixel(await draw({flipY:true}),30,30),[0,0,255]);assert.deepEqual(pixel(await draw({rotation:90}),30,30),[0,0,255]);assert.deepEqual(pixel(await draw({flipX:true,flipY:true,rotation:90}),30,30),[0,255,0]);
 assert.match(artworkMirrorSvg(f),/scale\(-1 -1\) rotate\(90\)/);assert.deepEqual(f.points,[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}]);
});
test('镜像加旋转后，鼠标与方向键的取景增量仍朝屏幕同一方向',()=>{
 for(const rotation of [-180,-45,0,30,90,180])for(const flipX of [false,true])for(const flipY of [false,true]){const angle=rotation*Math.PI/180,delta=artworkDelta({rotation,flipX,flipY},14,-8);near((delta.x*Math.cos(angle)-delta.y*Math.sin(angle))*(flipX?-1:1),14);near((delta.x*Math.sin(angle)+delta.y*Math.cos(angle))*(flipY?-1:1),-8);}
});
test('旋转和镜像不会改变缩放百分比或图片实际尺寸',()=>{
 const f=panel('',0,0,500,300),a={width:1200,height:600};f.imageTransform={...fitImage(f,a),scale:.88};const percent=artworkZoomPercent(f,a),scale=f.imageTransform.scale,x=f.imageTransform.x,y=f.imageTransform.y;for(const rotation of [-180,-90,-50,0,35,90,180])for(const flipX of [false,true]){Object.assign(f.imageTransform,{rotation,flipX,flipY:!flipX});near(artworkZoomPercent(f,a),percent);assert.deepEqual([f.imageTransform.scale,f.imageTransform.x,f.imageTransform.y],[scale,x,y]);}
});
test('缩放滑块以画格中心缩放，填满保留方向，重置恢复默认方向',()=>{
 const f=panel('',0,0,500,300),a={width:1000,height:600};f.imageTransform={...fitImage(f,a),x:-50,y:12,flipX:true,flipY:true,rotation:45};const before=clone(f);scaleArtwork(f,a,175);near(artworkZoomPercent(f,a),175);assert.equal(f.imageTransform.rotation,45);assert.equal(f.imageTransform.flipY,true);near((f.imageTransform.x-250)/f.imageTransform.scale,(before.imageTransform.x-250)/before.imageTransform.scale);
 const fit=fitArtwork(f,a);assert.equal(fit.flipX,true);assert.equal(fit.rotation,45);assert.ok(fit.scale*a.width>=Math.SQRT1_2*(500+300));assert.equal(fitArtwork(f,a,{reset:true}).flipX,undefined);assert.equal(fitArtwork(f,a,{reset:true}).rotation,undefined);
});
function gapFixture(){const p=createProject('合成间距',true),pg=p.pages[0],a=pg.panels[0],b=panel(p.shots[0].id,50,600,500,300);Object.assign(a,{x:50,y:100,w:500,h:300});pg.panels=[a,b];pg.bubbles[0].parentPanelId=a.id;Object.assign(pg.bubbles[0],{x:60,y:120,w:150,h:80});pg.bubbles.push({...clone(pg.bubbles[0]),id:id('bubble'),parentPanelId:b.id,x:60,y:620});return {p,pg,a,b};}
test('快捷间距沿整条漫画平移后续画格和对白；图片取景保持，输入工程不变',()=>{
 const {p,pg,a,b}=gapFixture();b.imageTransform={x:-30,y:12,scale:1.3,flipY:true,rotation:30};const before=clone(p),gaps=frameGaps(p,a.id);assert.equal(gaps.below.height,200);const result=resizeEmptyGap(p,{...gaps.below,height:280}).project;validateProject(result);assert.deepEqual(p,before);assert.equal(result.pages[0].panels[1].y,680);assert.equal(result.pages[0].bubbles[1].y,700);assert.deepEqual(result.pages[0].panels[1].imageTransform,b.imageTransform);assert.equal(result.pages[0].height,pg.height+80);assert.equal(result.pages[0].bubbles[1].text,pg.bubbles[1].text);
 const again=frameGaps(result,a.id),smaller=resizeEmptyGap(result,{...again.below,height:0}).project;validateProject(smaller);assert.equal(smaller.pages[0].panels[1].y,400);assert.equal(smaller.pages[0].bubbles[1].y,420);
});
test('间距包含所属对白尾尖；交叠画格和锁定后续图层不能被留白滑块截断',()=>{
 const {p,a,b}=gapFixture(),bubble=p.pages[0].bubbles[0];bubble.y=420;bubble.h=50;const gaps=frameGaps(p,a.id,{bubbleSizes:{[bubble.id]:{h:50,tail:{tip:{y:80}}}}});assert.equal(gaps.below.from,500);assert.equal(gaps.below.height,100);b.locked=true;assert.throws(()=>resizeEmptyGap(p,{...gaps.below,height:200}),/锁定/);b.locked=false;b.y=350;assert.equal(frameGaps(p,a.id).above.blocked,false);assert.throws(()=>resizeEmptyGap(p,{from:400,to:600,height:200}),/画格/);
});
test('工程拒绝非法旋转和镜像字段；审计同时记录镜像两个方向和角度',()=>{
 const p=createProject('合成取景校验',true),f=p.pages[0].panels[0];f.imageTransform={x:0,y:0,scale:1};ensureLayoutHistory(p);const before=clone(p);Object.assign(f.imageTransform,{flipY:true,flipX:true,rotation:75});validateProject(p);const record=recordLayoutAdjustment(before,p,{source:'manual',operation:'image.rotation'}).record;assert.ok(record.changes[0].fields.some(v=>v.field==='imageTransform.flipY'));f.imageTransform.rotation=181;assert.throws(()=>validateProject(p),/取景/);f.imageTransform.rotation=30;f.imageTransform.flipY='yes';assert.throws(()=>validateProject(p),/取景/);
});
test('间距滑块从快照多次预览，只新增一条记录并保留已有修改历史',()=>{
 const {p,a}=gapFixture();ensureLayoutHistory(p);const beforeMove=layoutEditSnapshot(p);a.x+=10;recordLayoutAdjustment(beforeMove,p,{source:'manual',operation:'panel.move'});const original=p.layoutHistory.records[0],before=layoutEditSnapshot(p),gap=frameGaps(p,a.id).below;let current=p;for(const height of [230,240,260])current=preserveLayoutHistory(current,resizeEmptyGap(before,{...gap,height}).project);assert.equal(current.layoutHistory.records.length,1);recordLayoutAdjustment(before,current,{source:'manual',operation:'strip.gap-below'});assert.equal(current.layoutHistory.records.length,2);assert.deepEqual(current.layoutHistory.records[0],original);
});
