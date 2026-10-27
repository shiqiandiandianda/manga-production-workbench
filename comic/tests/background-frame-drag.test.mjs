import test from 'node:test';
import assert from 'node:assert/strict';
import {panel,rectangle} from '../public/model.js';
import {resizeFrameCorner} from '../public/frame-resize.js';
import {MAX_PANEL_DRAG_HEIGHT} from '../public/panel-size-limits.js';
import {proportionalFrameDrag} from '../public/panel-proportional-resize.js';

test('5481px背景四个角轻微拖动均保持原高度附近，不能突然缩为3840px',()=>{
 const frame={...panel('',0,0,1280,5481,'background'),imageTransform:{x:0,y:0,scale:1},productionBackgroundInstance:{sourcePanelId:'source'}};
 for(let index=0;index<4;index++)for(const dy of [-5,5]){
  const next=resizeFrameCorner(frame,index,{dx:index===0||index===3?4:-4,dy});
  assert.equal(next.h,5481+(index<2?-dy:dy));assert.equal(next.y,index<2?dy:0);
  assert.equal(next.y+next.imageTransform.y,frame.y+frame.imageTransform.y);
  assert.deepEqual(next.points,rectangle());assert.deepEqual(frame.imageTransform,{x:0,y:0,scale:1});
 }
});
test('超高背景开启等比也不跳动，普通新画格仍有3840px限制',()=>{
 const frame={...panel('',40,100,1000,5481),proportionalResize:true,imageTransform:{x:3,y:4,scale:2}};
 for(let index=0;index<4;index++){
  const next=resizeFrameCorner(frame,index,{dx:2,dy:3});assert.ok(Math.abs(next.h-frame.h)<10);assert.ok(Math.abs(next.y-frame.y)<10);assert.ok(Math.abs(next.w/next.h-frame.w/frame.h)<1e-12);
  const nodes=proportionalFrameDrag(frame,index,{dx:2,dy:3});assert.ok(Math.abs(nodes.h-frame.h)<10);assert.ok(Math.abs(nodes.y-frame.y)<10);
 }
 const normal=panel('',0,0,1000,700);assert.equal(resizeFrameCorner(normal,2,{dx:0,dy:9000}).h,MAX_PANEL_DRAG_HEIGHT);
});
