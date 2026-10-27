import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {clone,rectangle,validPolygon,createProject,layoutLongStrip} from '../public/model.js';
import {localPagePoint} from '../public/editor-state.js';
import {validateProject} from '../lib/store.mjs';
import {constrainedNodeX} from '../public/panel-width.js';
import {nodeDragY} from '../public/panel-size-limits.js';
import {preserveFrameArtwork,resizeFrameCorner} from '../public/frame-resize.js';
const code=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const start=code.indexOf("stage.addEventListener('pointermove',event=>{");
const end=code.indexOf('function finishDrag(event)',start);
assert.ok(start>=0&&end>start);
function gesture(frame,index,startPoint,kind='node'){
 const page={id:'page',width:1280,height:1920},item=clone(frame);
 const state={kind,pointer:3,start:startPoint,initial:clone(frame),pageId:page.id,type:'panel',id:frame.id,index};
 let handler;
 const context={stage:{addEventListener(type,fn){if(type==='pointermove')handler=fn;}},drag:state,dragItem:()=>item,nodeIndex:index,project:{pages:[page]},pagePoint:e=>e.point,documentPoint:e=>e.point,clone,rectangle,validPolygon,constrainedNodeX,nodeDragY,preserveFrameArtwork,resizeFrameCorner,clamp:(n,a,b)=>Math.max(a,Math.min(b,n)),queueBatchPreview(){},renderCanvas(){},replaceBubble(){},applyBubbleEdit(){}};
 vm.runInNewContext(code.slice(start,end),context);
 return {item,move(point){handler({pointerId:3,point});return item;}};
}
const frame=()=>({id:'panel',x:123,y:92,w:921.6,h:673.13,points:rectangle(),imageTransform:{x:-30,y:-10,scale:.972}});
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,String(a)+' != '+b);
test('实际画板节点事件：上沿可向上一页拖，不被原页0边界截住',()=>{
 const f=frame(),g=gesture(f,1,{x:f.x+f.w,y:f.y});
 g.move({x:f.x+f.w,y:-300});near(f.y+g.item.points[1].y*f.h,-300);
});
test('实际画板节点事件：整格上移后，鼠标不动不会将节点跳回页顶',()=>{
 const f=frame();f.y=-600;const anchor={x:f.x+f.w+12,y:f.y+8},g=gesture(f,1,anchor);
 g.move(anchor);assert.deepEqual(JSON.parse(JSON.stringify(g.item)),f);
 g.move({x:anchor.x+2,y:anchor.y-5});near(g.item.points[1].x,1+2/f.w);near(g.item.points[1].y,-5/f.h);
});
test('实际画板节点事件：鼠标按住大命中区边缘，顶点仍按拖动距离移动',()=>{
 const f=frame(),anchor={x:f.x+f.w+25,y:f.y+16},g=gesture(f,1,anchor);
 g.move({x:anchor.x-40,y:anchor.y-60});near(g.item.points[1].x,1-40/f.w);near(g.item.points[1].y,-60/f.h);
 assert.deepEqual(JSON.parse(JSON.stringify(g.item.imageTransform)),f.imageTransform);
});
test('实际画板节点事件：下沿可越过所属页底部，交叉轮廓保留上次有效形状',()=>{
 const f=frame(),at={x:f.x+f.w,y:f.y+f.h},g=gesture(f,2,at);
 g.move({x:at.x,y:2500});near(f.y+g.item.points[2].y*f.h,2500);
 const last=JSON.parse(JSON.stringify(g.item.points));g.move({x:f.x+f.w*.5,y:f.y-100});assert.deepEqual(JSON.parse(JSON.stringify(g.item.points)),last);
});
test('实际矩形角事件：跨页不跳变，原图取景绝对位置保持',()=>{
 const f=frame();f.y=-600;const at={x:f.x+12,y:f.y+8},g=gesture(f,0,at,'rect');
 g.move(at);assert.deepEqual(JSON.parse(JSON.stringify(g.item)),f);
 g.move({x:at.x-10,y:at.y-200});near(g.item.y,-800);near(g.item.h,f.h+200);near(g.item.x,f.x-10);
 near(g.item.y+g.item.imageTransform.y,f.y+f.imageTransform.y);
});
test('连续长图上页节点坐标及越界形状经过保存校验仍保持有效',()=>{
 const p=createProject('节点跨页');const page=p.pages[0],f=page.panels[0];f.x=123;f.y=-600;f.w=921.6;f.h=673.13;f.points=rectangle();
 const layout=layoutLongStrip(p.pages),initial=localPagePoint(layout,page.id,{x:f.x+f.w,y:-600});
 const g=gesture(f,1,initial);g.move({x:initial.x,y:-900});page.panels[0]=JSON.parse(JSON.stringify(g.item));
 assert.doesNotThrow(()=>validateProject(p));near(f.y+page.panels[0].points[1].y*f.h,-900);
});
test('节点横向拖出画板时停在左右边缘，上下仍可跨页',()=>{
 const f=frame(),left=gesture(f,0,{x:f.x,y:f.y});left.move({x:-4000,y:-300});near(f.x+left.item.points[0].x*f.w,0);near(f.y+left.item.points[0].y*f.h,-300);
 const right=gesture(f,2,{x:f.x+f.w,y:f.y+f.h});right.move({x:4000,y:2500});near(f.x+right.item.points[2].x*f.w,1280);near(f.y+right.item.points[2].y*f.h,2500);
});
test('矩形角点左右拉伸受画板宽度限制，并保持最小宽度及原图绝对取景位置',()=>{
 const f=frame(),left=gesture(f,0,{x:f.x,y:f.y},'rect');left.move({x:-4000,y:-300});near(left.item.x,0);near(left.item.x+left.item.w,f.x+f.w);near(left.item.x+left.item.imageTransform.x,f.x+f.imageTransform.x);
 const right=gesture(f,2,{x:f.x+f.w,y:f.y+f.h},'rect');right.move({x:4000,y:2500});near(right.item.x+right.item.w,1280);near(right.item.y+right.item.h,2500);right.move({x:-4000,y:2500});near(right.item.w,20);
});
