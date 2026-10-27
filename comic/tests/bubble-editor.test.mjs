import test from 'node:test';
import assert from 'node:assert/strict';
import {applyBubbleEdit,bubbleEditGeometry,BubbleEditor} from '../public/bubble-editor.js';
import {validBubblePoints,bubbleShapePoints} from '../public/lettering.js';
const bubble=extra=>({id:'bubble_keep_id',type:'speech',text:'文字与表情不改写😄',x:100,y:200,w:240,h:120,fontSize:28,visible:true,assetId:'asset_keep_id',...extra});

test('独立移动与缩放文字框保留气泡几何、ID、内容和素材，整体移动同步历史绝对尾尖',()=>{
  const value=bubble({tail:{x:280,y:400}}),snapshot=structuredClone(value);
  const moved=applyBubbleEdit(value,{type:'text-move',dx:12,dy:-7});
  assert.deepEqual(moved.textBox,{x:28,y:9,w:208,h:88});
  for(const key of ['x','y','w','h','id','text','assetId'])assert.equal(moved[key],value[key]);
  const resized=applyBubbleEdit(moved,{type:'text-resize',dx:25,dy:40});
  assert.deepEqual(resized.textBox,{x:28,y:9,w:233,h:128});
  const whole=applyBubbleEdit(value,{type:'move',dx:40,dy:60});
  assert.deepEqual(whole.tail,{x:320,y:460});assert.equal(whole.x,140);assert.equal(whole.y,260);
  const normalized=applyBubbleEdit({...value,tail:{mode:'normalized',x:.5,y:1.2}},{type:'move',dx:40,dy:60});
  assert.deepEqual(normalized.tail,{mode:'normalized',x:.5,y:1.2});assert.deepEqual(value,snapshot);
});

test('尾尖拖动写入normalized位置，气泡缩放保留独立文字框和形状节点',()=>{
  const value=bubble({shape:'custom',points:bubbleShapePoints('custom'),textBox:{x:20,y:15,w:180,h:90}}),snapshot=structuredClone(value);
  const next=applyBubbleEdit(value,{type:'tail',x:232,y:380});
  assert.deepEqual(next.tail,{mode:'normalized',x:.55,y:1.5,visible:true,directionOnly:false});
  assert.deepEqual(bubbleEditGeometry(next).tail,{x:232,y:380});
  const resized=applyBubbleEdit(next,{type:'resize',dx:120,dy:60});
  assert.equal(resized.w,360);assert.equal(resized.h,180);assert.deepEqual(resized.points,value.points);assert.deepEqual(resized.textBox,value.textBox);assert.deepEqual(value,snapshot);
});

test('轮廓节点可插入删除，拖动自交或退化轮廓不会写回',()=>{
  const value=bubble({shape:'custom',points:[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}]}),snapshot=structuredClone(value);
  const changed=applyBubbleEdit(value,{type:'point',index:0,x:124,y:212});
  assert.deepEqual(changed.points[0],{x:.1,y:.1});assert.ok(validBubblePoints(changed.points));
  const invalid=applyBubbleEdit(value,{type:'point',index:0,x:340,y:320});assert.deepEqual(invalid,value);
  const inserted=applyBubbleEdit(value,{type:'insert-point',index:0});assert.equal(inserted.points.length,5);assert.deepEqual(inserted.points[1],{x:.5,y:0});
  const removed=applyBubbleEdit(inserted,{type:'remove-point',index:1});assert.deepEqual(removed.points,value.points);
  const triangle=applyBubbleEdit({...value,points:[{x:0,y:0},{x:1,y:0},{x:.5,y:1}]},{type:'remove-point',index:0});assert.equal(triangle.points.length,3);
  assert.deepEqual(value,snapshot);
});

function eventTarget(){const listeners=new Map();return {listeners,addEventListener(type,fn){listeners.set(type,fn);},removeEventListener(type,fn){if(listeners.get(type)===fn)listeners.delete(type);}};}
function pointer(target,x,y,extra={}){return {target,clientX:x,clientY:y,pointerId:1,button:0,preventDefault(){},stopImmediatePropagation(){},...extra};}
test('SVG重绘期间拖动仍连续，提交仅记录一次且保留原数据用于撤销',()=>{
  const document=eventTarget(),root={...eventTarget(),ownerDocument:document,contains:()=>true},group={dataset:{bubble:'bubble_keep_id',renderW:'240',renderH:'120'}},handle={dataset:{bubbleHandle:'text-move'},closest:()=>group},target={closest:()=>handle};
  const original=bubble(),changes=[],commits=[],editor=new BubbleEditor({root,getBubble:()=>original,toPagePoint:event=>({x:event.clientX,y:event.clientY}),onChange:(next,meta)=>changes.push({next,meta}),onCommit:(next,meta)=>commits.push({next,meta})});
  root.listeners.get('pointerdown')(pointer(target,10,20));
  document.listeners.get('pointermove')(pointer({},30,50));
  document.listeners.get('pointermove')(pointer({},40,70));
  document.listeners.get('pointerup')(pointer({},40,70));
  assert.equal(changes.length,2);assert.equal(commits.length,1);assert.deepEqual(commits[0].next.textBox,{x:46,y:66,w:208,h:88});assert.deepEqual(commits[0].meta.before,original);
  assert.equal(original.textBox,undefined);editor.destroy();assert.equal(root.listeners.size,0);assert.equal(document.listeners.size,0);
});

test('拖动自动扩大的视觉气泡使用当前渲染尺寸，取消恢复原工程且不提交',()=>{
  const document=eventTarget(),root={...eventTarget(),ownerDocument:document,contains:()=>true},group={dataset:{bubble:'bubble_keep_id',renderW:'360',renderH:'180'}},handle={dataset:{bubbleHandle:'resize'},closest:()=>group},target={closest:()=>handle};
  const original=bubble({overflow:'expand'}),changes=[],commits=[],editor=new BubbleEditor({root,getBubble:()=>original,toPagePoint:event=>({x:event.clientX,y:event.clientY}),onChange:next=>changes.push(next),onCommit:next=>commits.push(next)});
  root.listeners.get('pointerdown')(pointer(target,0,0));document.listeners.get('pointermove')(pointer({},20,30));
  assert.equal(changes[0].w,380);assert.equal(changes[0].h,210);
  document.listeners.get('pointercancel')(pointer({},20,30));assert.deepEqual(changes.at(-1),original);assert.equal(commits.length,0);editor.destroy();
});

test('尾尖远距离拖动限制在可保存的normalized范围内',()=>{
  const next=applyBubbleEdit(bubble(),{type:'tail',x:100000,y:-100000});
  assert.equal(next.tail.x,3);assert.equal(next.tail.y,-2);
});
