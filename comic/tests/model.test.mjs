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
test('53个镜头保持单一连续画板、完整阅读顺序及独立安全格子',()=>{const shots=Array.from({length:53},(_,i)=>({id:`shot-${i}`,code:String(i),description:'场景'}));const pages=layoutShots(shots,'overlay');assert.equal(pages.length,1);assert.equal(pages[0].height,53*760-40);assert.deepEqual(pages[0].panels.map(p=>p.shotId),shots.map(s=>s.id));assert.equal(new Set(pages[0].panels.map(p=>p.id)).size,53);assertSafeLayout(pages[0]);});
test('图片等比例填入多边形外接框，节点与原图比例独立',()=>{const frame=panel('',0,0,236,310),fit=fitImage(frame,{width:1024,height:1344},1);assert.ok(fit.scale>=236/1024);assert.ok(fit.scale>=310/1344);assert.ok(Math.abs(1024*fit.scale/(1344*fit.scale)-1024/1344)<1e-12);});
test('对白或排版改变不修改生图来源，画面与参考变化会失效',()=>{const p=createProject('测试',true),s=p.shots[0],key=sourceKey(p,s);s.dialogue='新对白';p.pages[0].panels[0].x=400;assert.equal(sourceKey(p,s),key);s.description+='新动作';assert.notEqual(sourceKey(p,s),key);});
test('Codex 提示明确只调用内置工具，由 Python 读取 savedPath',()=>{const p=createProject('测试',true),prompt=buildImagePrompt({shot:p.shots[0],style:p.style,panel:p.pages[0].panels[0],referenceRoles:[]});assert.match(prompt,/\$imagegen/);assert.match(prompt,/referenced_image_paths/);assert.match(prompt,/生成失败时如实报告/);assert.match(prompt,/不用旧图或绘图代码伪造结果/);});
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



test('旧scene-rhythm标识兼容当前连续画板，不恢复已退休的隐式背景格',()=>{
 const ids=['opening','scene','ending'],page=makePage(ids,'scene-rhythm');assert.deepEqual(page.panels.map(p=>p.shotId),ids);assert.ok(page.panels.every(p=>p.kind==='panel'));assertSafeLayout(page);
});

test('旧hero-opening标识不丢失镜头，也不共享轮廓节点',()=>{
 const page=makePage(['main','shoulder','side'],'hero-opening');assertSafeLayout(page);assert.deepEqual(page.panels.map(p=>p.shotId),['main','shoulder','side']);assert.equal(page.panels.length,3);assert.notEqual(page.panels[0].points,page.panels[1].points);const before=structuredClone(page.panels[1].points);page.panels[0].points[0].x=.1;assert.deepEqual(page.panels[1].points,before);
});
