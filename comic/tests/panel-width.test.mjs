import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject,panel,id,makePage,bounds} from '../public/model.js';
import {movePanelGroup,attachBubbleGroups} from '../public/layer-groups.js';
import {translateSelection} from '../public/multi-selection.js';
import {normalizeLayerOrder} from '../public/layers.js';

function fixture(){const project=createProject(),page=project.pages[0],frame=panel(project.shots[0].id,100,200,400,500),bubble={id:id('bubble'),parentPanelId:frame.id,shotId:frame.shotId,type:'speech',visible:true,x:120,y:140,w:200,h:100,fontSize:24,text:'测试对白',tail:{mode:'absolute',x:240,y:270,visible:true}};page.panels=[frame];page.bubbles=[bubble];frame.imageTransform={x:-30,y:-20,scale:1};frame.mask={enabled:true,strokes:[]};attachBubbleGroups(project);normalizeLayerOrder(project);return {project,page,frame,bubble};}
const contained=(page,frame)=>{const b=bounds(frame);assert.ok(frame.x+b.x>=-1e-9);assert.ok(frame.x+b.x+b.w<=page.width+1e-9);};

test('左右大幅拖动在边缘停止，关联对白与绝对尾尖使用实际位移，取景与蒙版保持',()=>{
 const {project,page,frame,bubble}=fixture(),before=structuredClone(project);
 assert.equal(movePanelGroup(project,frame.id,{x:2000,y:-100},before),true);assert.equal(frame.x,880);contained(page,frame);assert.deepEqual([bubble.x,bubble.y,bubble.tail.x,bubble.tail.y],[900,-160,1020,-30]);
 movePanelGroup(project,frame.id,{x:-900,y:-100},before);assert.equal(frame.x,0);contained(page,frame);assert.deepEqual([bubble.x,bubble.tail.x],[20,140]);assert.deepEqual(frame.imageTransform,before.pages[0].panels[0].imageTransform);assert.deepEqual(frame.mask,before.pages[0].panels[0].mask);
});
test('自由轮廓按实际顶点边界限制，不仅使用格子名义宽度',()=>{
 const {project,page,frame}=fixture();frame.points=[{x:-.2,y:0},{x:1.1,y:0},{x:1.1,y:1},{x:-.2,y:1}];const before=structuredClone(project);
 movePanelGroup(project,frame.id,{x:-900,y:200},before);assert.equal(frame.x,80);contained(page,frame);
 movePanelGroup(project,frame.id,{x:9000,y:200},before);assert.equal(frame.x,840);contained(page,frame);
});
test('多选整体到边缘停止，保持格间距离及对白绑定，快照重算不会累积位移',()=>{
 const {project,page,frame,bubble}=fixture(),second=panel(frame.shotId,650,200,400,500);page.panels.push(second);normalizeLayerOrder(project);const before=structuredClone(project),keys=[frame.id,second.id,bubble.id];
 translateSelection(project,keys,{dx:5000,dy:30},before);assert.deepEqual([frame.x,second.x,bubble.x],[330,880,350]);contained(page,frame);contained(page,second);
 translateSelection(project,keys,{dx:-5000,dy:-300},before);assert.deepEqual([frame.x,second.x,bubble.x],[0,550,20]);assert.equal(second.x-frame.x,550);assert.equal(frame.y,-100);contained(page,frame);contained(page,second);
});
test('跨页多选在长图坐标计算共同边界，并换算各页宽度比例',()=>{
 const {project,page,frame}=fixture();page.width=640;const next=makePage([],'stack',1280,1200),second=panel(frame.shotId,1000,0,250,400);next.panels=[second];project.pages.push(next);normalizeLayerOrder(project);const before=structuredClone(project);
 translateSelection(project,[frame.id,second.id],{dx:900,dy:40},before);assert.deepEqual([frame.x,second.x,frame.y,second.y],[115,1030,220,40]);contained(page,frame);contained(next,second);
});
test('旧超宽格子不通过平移进一步越界，也不自动缩放图片；冲刺线保留独立操作规则',()=>{
 const {project,frame}=fixture();frame.w=1400;movePanelGroup(project,frame.id,{x:-300,y:500});assert.equal(frame.x,100);assert.equal(frame.y,500);assert.equal(frame.w,1400);
 frame.sfxImage=true;movePanelGroup(project,frame.id,{x:-300,y:500});assert.equal(frame.x,-300);
});
