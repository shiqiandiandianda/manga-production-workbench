import test from 'node:test';
import assert from 'node:assert/strict';
import {rectangle,validPolygon,parseTable,layoutShots,panel,fitImage,createProject,makePage,shapePresets,polygonFor} from "../public/model.js";
import {sourceKey,buildImagePrompt} from '../lib/codex.mjs';
import {zipStore} from '../public/render.js';
test('多边形允许凹口，拒绝交叉、重复点和零面积',()=>{
  assert.ok(validPolygon(rectangle()));assert.ok(validPolygon([{x:0,y:0},{x:1,y:0},{x:.6,y:.5},{x:1,y:1},{x:0,y:1}]));
  assert.equal(validPolygon([{x:0,y:0},{x:1,y:1},{x:1,y:0},{x:0,y:1}]),false);assert.equal(validPolygon([{x:0,y:0},{x:1,y:0},{x:1,y:0},{x:0,y:1}]),false);assert.equal(validPolygon([{x:0,y:0},{x:.5,y:0},{x:1,y:0}]),false);
});
test('分镜导入支持 Excel 换行、带引号逗号和重复编号检测',()=>{
  const rows=parseTable('镜头编号,镜头名称,画面描述,对白\r\nS01,特写,"信封,短刀","第一句\n第二句"');assert.equal(rows[0].description,'信封,短刀');assert.equal(rows[0].dialogue,'第一句\n第二句');
  assert.equal(parseTable('编号\t画面\n1\t门外日落')[0].code,'1');assert.throws(()=>parseTable('编号,画面\n1,甲\n1,乙'),/重复/);
});
test('十多个镜头生成多张独立长图，保持镜头 ID 与阅读顺序',()=>{const shots=Array.from({length:53},(_,i)=>({id:`shot-${i}`,code:String(i),description:'场景'}));const pages=layoutShots(shots,'overlay');assert.equal(pages.length,14);assert.deepEqual(pages.flatMap(p=>p.panels).map(p=>p.shotId).sort(),shots.map(s=>s.id).sort());assert.equal(new Set(pages.flatMap(p=>p.panels).map(p=>p.id)).size,53);});
test('图片等比例填入多边形外接框，节点与原图比例独立',()=>{const frame=panel('',0,0,236,310),fit=fitImage(frame,{width:1024,height:1344},1);assert.ok(fit.scale>=236/1024);assert.ok(fit.scale>=310/1344);assert.ok(Math.abs(1024*fit.scale/(1344*fit.scale)-1024/1344)<1e-12);});
test('对白或排版改变不修改生图来源，画面与参考变化会失效',()=>{const p=createProject('测试',true),s=p.shots[0],key=sourceKey(p,s);s.dialogue='新对白';p.pages[0].panels[0].x=400;assert.equal(sourceKey(p,s),key);s.description+='新动作';assert.notEqual(sourceKey(p,s),key);});
test('Codex 提示明确只调用内置工具，由 Python 读取 savedPath',()=>{const p=createProject('测试',true),prompt=buildImagePrompt({shot:p.shots[0],style:p.style,panel:p.pages[0].panels[0],referenceRoles:[]});assert.match(prompt,/\$imagegen/);assert.match(prompt,/imageGeneration.savedPath/);assert.match(prompt,/不改用 API/);});
test('多段长图 ZIP 使用有效的本地文件头和中央目录',async()=>{const bytes=new Uint8Array(await zipStore([{name:'整话_01.png',bytes:new Uint8Array([1,2,3])}]).arrayBuffer());const view=new DataView(bytes.buffer);assert.equal(view.getUint32(0,true),0x04034b50);assert.equal(view.getUint32(bytes.length-22,true),0x06054b50);assert.equal(view.getUint16(bytes.length-14,true),1);});

function assertSafeLayout(page) {
  for(const frame of page.panels) {
    assert.ok(validPolygon(frame.points),'模板需要输出简单多边形');
    assert.ok(frame.points.every(p=>p.x>=0&&p.x<=1&&p.y>=0&&p.y<=1));
    assert.ok(frame.x>=0&&frame.y>=0&&frame.w>=20&&frame.h>=20);
    assert.ok(frame.x+frame.w<=page.width+1e-8&&frame.y+frame.h<=page.height+1e-8,'格子不越界');
  }
  for(let i=0;i<page.panels.length;i++)for(let j=i+1;j<page.panels.length;j++) {
    const a=page.panels[i],b=page.panels[j];
    assert.ok(a.x+a.w<=b.x+1e-8||b.x+b.w<=a.x+1e-8||a.y+a.h<=b.y+1e-8||b.y+b.h<=a.y+1e-8,'默认模板格子不互相遮挡');
  }
}

test('六种形状输出有效且独立的可编辑节点，不共享预设节点',()=>{
  assert.deepEqual(shapePresets.map(s=>s.id),['rectangle','slanted','trapezoid','cut-corner','hexagon','free-polygon']);
  for(const preset of shapePresets) {
    const first=polygonFor(preset.id),original=structuredClone(first);
    assert.ok(validPolygon(first));first[0].x=.5;
    assert.deepEqual(polygonFor(preset.id),original);
  }
  assert.throws(()=>polygonFor('未知形状'),/未知/);
});



test('三格主场景版式有全幅无框主场景与错落边格，避免大图加等宽矩形',()=>{
  const page=makePage(['opening','scene','ending'],'scene-rhythm'),[opening,scene,ending]=page.panels;
  assert.equal(scene.kind,'background');assert.equal(scene.x,0);assert.equal(scene.w,page.width);assert.equal(scene.border,0);
  assert.ok(scene.h>opening.h*2&&scene.h>ending.h*2);
  assert.notEqual(opening.w,ending.w);
  assert.deepEqual(opening.points,rectangle());assert.notDeepEqual(ending.points,rectangle());
  assertSafeLayout(page);
});











test('主景开场三格版式首格占52%全幅无框，后续斜切与切角错落支持',()=>{
  const page=makePage(['main','shoulder','side'],'hero-opening'),[main,shoulder,side]=page.panels;
  assert.equal(main.kind,'background');assert.equal(main.x,0);assert.equal(main.w,page.width);assert.equal(main.border,0);assert.equal(main.h,page.height*.52);
  assert.deepEqual(main.points,rectangle());assert.deepEqual(shoulder.points,polygonFor('slanted'));assert.deepEqual(side.points,polygonFor('cut-corner'));
  assert.ok(Math.abs(shoulder.w/page.width-.80)<1e-12);assert.ok(Math.abs(side.w/page.width-.88)<1e-12);assert.ok(shoulder.x<side.x);
  assert.equal(shoulder.border,6);assert.equal(side.border,6);assert.ok(main.y+main.h<shoulder.y);assert.ok(shoulder.y+shoulder.h<side.y);
  assertSafeLayout(page);
});
