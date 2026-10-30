import test from 'node:test';
import assert from 'node:assert/strict';
import {COMIC_PAGE_WIDTH,DEFAULT_PAGE_HEIGHT,makePage,createProject,layoutShots,clone,rescalePageWidth,resizePageHeight,validatePageHeight,layoutLongStrip,pageAtStripPoint,stripSegments} from '../public/model.js';
import {calculateViewport,scrollPositionForY,MAX_VIEWPORT_CSS_HEIGHT,createViewportController,initWorkbenchChrome} from '../public/viewport.js';

const close=(actual,expected)=>assert.ok(Math.abs(actual-expected)<=Math.max(1e-8,Math.abs(expected)*1e-12),actual+' != '+expected);
test('新页面与自动分镜固定默认1280宽，已有724页布局不会原地迁移',()=>{
  assert.equal(COMIC_PAGE_WIDTH,1280);assert.equal(DEFAULT_PAGE_HEIGHT,3840);
  assert.equal(makePage().width,1280);assert.equal(createProject().pages[0].width,1280);
  assert.ok(layoutShots([{id:'shot'}]).every(page=>page.width===1280));
  const legacy=makePage(['shot'],'stack',724,2172),before=clone(legacy),layout=layoutLongStrip([legacy]);
  assert.equal(layout.width,1280);assert.equal(layout.height,3840);assert.deepEqual(legacy,before);
});
test('明确宽度迁移同步图像取景、节点几何、文字与绝对尾尖，保留所有ID',()=>{
  const page=makePage(['shot'],'slash-action',724,2172),frame=page.panels[0];
  frame.imageAssetId='asset';frame.candidates=['asset'];frame.imageTransform={x:-35,y:-48,scale:.4};
  page.bubbles=[{id:'bubble',shotId:'shot',x:31,y:81,w:320,h:150,fontSize:48,outlineWidth:3,padding:18,letterSpacing:2,lineHeight:1.4,points:[{x:0,y:0},{x:1,y:0},{x:1,y:1}],textBox:{x:12,y:13,w:250,h:100},tail:{x:55,y:260,base:.5}},{id:'normalized',x:0,y:0,w:100,h:50,fontSize:20,tail:{mode:'normalized',x:.7,y:1.3,base:.4}}];
  const original=clone(page),factor=1280/724;
  assert.equal(rescalePageWidth(page),page);assert.equal(page.width,1280);assert.equal(page.height,3840);
  assert.equal(page.id,original.id);assert.equal(frame.id,original.panels[0].id);
  assert.deepEqual(frame.points,original.panels[0].points);assert.deepEqual(frame.candidates,['asset']);assert.equal(frame.imageAssetId,'asset');
  for(const key of ['x','y','w','h','border','feather'])close(frame[key],original.panels[0][key]*factor);
  for(const key of ['x','y','scale'])close(frame.imageTransform[key],original.panels[0].imageTransform[key]*factor);
  for(const key of ['x','y','w','h','outlineWidth'])close(page.bubbles[0][key],original.bubbles[0][key]*factor);
  for(const key of ['fontSize','padding','letterSpacing'])assert.equal(page.bubbles[0][key],original.bubbles[0][key]);
  assert.equal(page.bubbles[0].textBox.w,250);assert.equal(page.bubbles[0].textBox.h,100);close(page.bubbles[0].textBox.x,(12+125)*factor-125);close(page.bubbles[0].tail.y,260*factor);
  assert.equal(page.bubbles[0].lineHeight,1.4);assert.equal(page.bubbles[0].tail.base,.5);
  assert.deepEqual(page.bubbles[0].points,original.bubbles[0].points);assert.deepEqual(page.bubbles[1].tail,original.bubbles[1].tail);
  const once=clone(page);rescalePageWidth(page);assert.deepEqual(page,once);
});
test('自定义页高超过30000仍合法，只拒绝非安全整数与非正高度，调整不移动原画',()=>{
  const page=makePage(['shot']),before=clone(page.panels);
  resizePageHeight(page,120000);assert.equal(page.height,120000);assert.deepEqual(page.panels,before);
  assert.equal(validatePageHeight(Number.MAX_SAFE_INTEGER),Number.MAX_SAFE_INTEGER);
  for(const value of [Infinity,NaN,1.5,0,-1,Number.MAX_SAFE_INTEGER+1])assert.throws(()=>resizePageHeight(page,value),/安全整数/);
  assert.equal(page.height,120000);assert.deepEqual(page.panels,before);
});
test('连续长图按页序排布，页边界点击与非当前页选择映射到原始局部坐标',()=>{
  const pages=[makePage([],'stack',724,2172),makePage([],'stack',1280,90000),makePage([],'stack',1280,600)];
  const layout=layoutLongStrip(pages);
  assert.deepEqual(layout.pages.map(page=>page.y),[0,3840,93840]);assert.equal(layout.height,94440);
  const first=pageAtStripPoint(layout,{x:640,y:1920});close(first.local.x,362);close(first.local.y,1086);assert.equal(first.pageId,pages[0].id);
  const second=pageAtStripPoint(layout,{x:42,y:3840});assert.equal(second.pageId,pages[1].id);assert.deepEqual(second.local,{x:42,y:0});
  assert.equal(pageAtStripPoint(layout,{x:0,y:layout.height}),null);assert.equal(pageAtStripPoint(layout,{x:-1,y:0}),null);
  const withGap=layoutLongStrip(pages,{gap:20});assert.equal(pageAtStripPoint(withGap,{x:20,y:3850}),null);
});
test('分段覆盖全高且每段正确包括跨越边界的页，不丢末页尾部',()=>{
  const pages=[makePage([],'stack',1280,50001),makePage([],'stack',1280,30001),makePage([],'stack',1280,600)];
  const layout=layoutLongStrip(pages),segments=[...stripSegments(layout)];
  assert.ok(segments.every(segment=>segment.height<=8192));
  assert.equal(segments.reduce((sum,segment)=>sum+segment.height,0),80602);
  assert.equal(segments.at(-1).endY,layout.height);
  assert.equal(segments.at(-1).pages.at(-1).pageId,pages.at(-1).id);
  assert.equal(segments.at(-1).pages.at(-1).sourceEndY,600);
  for(let i=1;i<segments.length;i++)assert.equal(segments[i].startY,segments[i-1].endY);
  assert.ok(segments.some(segment=>segment.pages.length===2));
  const lazy=stripSegments(layoutLongStrip([makePage([],'stack',1280,Number.MAX_SAFE_INTEGER)]));
  assert.equal(lazy.next().value.height,8192);assert.equal(lazy.next().value.startY,8192);
  assert.throws(()=>layoutLongStrip([makePage([],'stack',1280,Number.MAX_SAFE_INTEGER),makePage()]),/安全整数范围/);
});
test('极长工程使用有限物理滚动区域和可见SVG带，滚到末端仍呈现最后一页',()=>{
  const pages=[makePage([],'stack',1280,900000000),makePage([],'stack',1280,12345)];
  const layout=layoutLongStrip(pages),zoom=.8,viewportHeight=700;
  const first=calculateViewport(layout,{zoom,viewportHeight});
  assert.equal(first.physicalHeight,MAX_VIEWPORT_CSS_HEIGHT);assert.equal(first.compressed,true);assert.equal(first.startY,0);
  assert.ok(first.height*zoom<=viewportHeight+384*2);assert.equal(first.visiblePages.length,1);
  const lastScroll=scrollPositionForY(layout,layout.height,{zoom,viewportHeight});
  const last=calculateViewport(layout,{zoom,viewportHeight,scrollTop:lastScroll});
  close(last.endY,layout.height);assert.equal(last.visiblePages.at(-1).pageId,pages[1].id);
  assert.ok(last.height*zoom<=viewportHeight+384*2+1e-6);
  close(last.stageTop+last.height*zoom,last.physicalHeight);
  const middleY=456789123,scrollTop=scrollPositionForY(layout,middleY,{zoom,viewportHeight});
  close(calculateViewport(layout,{zoom,viewportHeight,scrollTop}).logicalTop,middleY);
});
test('常规长图可见区保持真实缩放，不创建整页高SVG',()=>{
  const layout=layoutLongStrip([makePage([],'stack',1280,120000)]);
  const state=calculateViewport(layout,{zoom:.5,scrollTop:12000,viewportHeight:800});
  assert.equal(state.compressed,false);assert.equal(state.logicalTop,24000);
  assert.equal(state.startY,23232);assert.equal(state.height,3136);assert.equal(state.stageTop,11616);
  assert.equal(state.physicalHeight,60000);
});

class FakeClassList {
  constructor(){this.values=new Set();}
  add(value){this.values.add(value);}
  toggle(value,enabled){if(enabled??!this.values.has(value))this.values.add(value);else this.values.delete(value);}
  contains(value){return this.values.has(value);}
}
class FakeElement {
  constructor(){this.style={};this.dataset={};this.attrs={};this.listeners={};this.children=[];this.classList=new FakeClassList();this.scrollTop=0;this.scrollLeft=0;this.clientWidth=1000;this.clientHeight=800;}
  getBoundingClientRect(){return {left:80,top:100,width:this.clientWidth,height:this.clientHeight};}
  append(element){this.children.push(element);}
  setAttribute(key,value){this.attrs[key]=value;}
  addEventListener(key,listener){(this.listeners[key]??=[]).push(listener);}
  removeEventListener(key,listener){this.listeners[key]=(this.listeners[key]||[]).filter(item=>item!==listener);}
  emit(key,event={}){for(const listener of this.listeners[key]||[])listener(event);}
}
function fakeDocument() {
  const doc=new FakeElement(),elements=new Map(),callbacks=[];
  doc.querySelector=selector=>elements.get(selector)||null;
  doc.createElement=()=>{const element=new FakeElement();element.ownerDocument=doc;return element;};
  doc.defaultView={requestAnimationFrame:callback=>{callbacks.push(callback);return callbacks.length;},cancelAnimationFrame:()=>{}};
  for(const selector of ['#view-mode','#sidebar-toggle','#sidebar-close','#inspector-toggle','#inspector-close','#jobs-toggle','.app-shell','.sidebar','.inspector','.job-tray'])elements.set(selector,doc.createElement());
  return {doc,elements,flush(){while(callbacks.length)callbacks.shift()();}};
}
test('虚拟画布控制器保留单一stage并提供跨页局部选中映射',()=>{
  const {doc,elements,flush}=fakeDocument(),scroll=doc.createElement(),stage=doc.createElement(),pages=[makePage(),makePage()];
  pages[1].bubbles.push({id:'pick'});
  let renders=0;
  const controller=createViewportController({scroll,stage,onRender:()=>renders++});
  controller.set({pages,currentPageId:pages[0].id,zoom:.5});
  assert.ok(Number(stage.attrs.height)<pages[0].height*.5);
  controller.panBy(20,-10);flush();assert.equal(controller.getMode(),'continuous');assert.equal(stage.dataset.viewMode,'continuous');
  assert.equal(controller.selectionPage({type:'bubble',id:'pick'}),pages[1]);
  controller.scrollToPage(pages[1].id);flush();
  assert.equal(controller.hitTest({x:10,y:pages[0].height+5}).pageId,pages[1].id);
  assert.ok(controller.snapshot().window.visiblePages.some(entry=>entry.pageId===pages[1].id));assert.ok(renders>=2);
  assert.equal(scroll.children.length,1);assert.equal(scroll.children[0].children[0],stage);
  controller.destroy();const count=renders;scroll.emit('scroll');flush();assert.equal(renders,count);
});
test('左右栏与任务栏默认收起，窄屏属性按钮和关闭按钮均可立刻操作',()=>{
  const {doc,elements}=fakeDocument(),chrome=initWorkbenchChrome({root:doc});
  assert.deepEqual(chrome.snapshot(),{sidebar:false,inspector:false,jobs:false});
  assert.ok(elements.get('.app-shell').classList.contains('inspector-collapsed'));
  elements.get('#inspector-toggle').emit('click');assert.equal(chrome.snapshot().inspector,true);
  assert.equal(elements.get('#inspector-toggle').attrs['aria-expanded'],'true');
  elements.get('#inspector-close').emit('click');assert.equal(chrome.snapshot().inspector,false);
  chrome.openSidebar();assert.equal(chrome.snapshot().sidebar,true);
  elements.get('#jobs-toggle').emit('click');assert.equal(chrome.snapshot().jobs,true);
  chrome.openInspector();doc.emit('keydown',{key:'Escape'});assert.equal(chrome.snapshot().inspector,false);
  chrome.destroy();elements.get('#sidebar-toggle').emit('click');assert.equal(chrome.snapshot().sidebar,false);
});
test('1px空白短页保持1280宽，连续排布和分段仍完整覆盖',()=>{
  const pages=[makePage([],'stack',1280,1),makePage([],'stack',1280,3)],layout=layoutLongStrip(pages);
  assert.equal(layout.height,4);assert.deepEqual(layout.pages.map(entry=>entry.y),[0,1]);
  assert.equal(pageAtStripPoint(layout,{x:10,y:1}).pageId,pages[1].id);
  const segments=[...stripSegments(layout,{segmentHeight:2})];assert.deepEqual(segments.map(segment=>segment.height),[2,2]);
  assert.equal(segments.at(-1).endY,4);
});
test('1px旧宽页按1280显示或显式迁移时保留至少一个输出像素',()=>{
  const legacy=makePage([],'stack',4096,1),before=clone(legacy);
  const layout=layoutLongStrip([legacy]);assert.equal(layout.height,1);assert.deepEqual(legacy,before);
  rescalePageWidth(legacy);assert.equal(legacy.width,1280);assert.equal(legacy.height,1);assert.equal(legacy.id,before.id);
});

function wheelFixture({height=90000,zoom=1,mode='page',maxPhysicalHeight=MAX_VIEWPORT_CSS_HEIGHT}={}) {
  const {doc,flush}=fakeDocument(),scroll=doc.createElement(),stage=doc.createElement(),pages=[makePage([],'stack',1280,height)],changes=[];
  const controller=createViewportController({scroll,stage,mode,maxPhysicalHeight,onZoomChange:value=>changes.push(value)});
  controller.set({pages,currentPageId:pages[0].id,zoom});
  const wheel=(deltaY,options={})=>{
    let prevented=false;
    scroll.emit('wheel',{deltaY,deltaX:0,deltaMode:0,clientX:500,clientY:420,ctrlKey:true,preventDefault(){prevented=true;},...options});
    flush();return prevented;
  };
  const point=()=>{
    const state=controller.snapshot(),width=state.layout.width*state.zoom,left=(Math.max(scroll.clientWidth,width+48)-width)/2;
    return {x:(scroll.scrollLeft+420-left)/state.zoom,y:state.window.logicalTop+(320-24)/state.zoom};
  };
  return {scroll,stage,pages,changes,controller,wheel,point,flush};
}
test('Ctrl滚轮上放大下缩小，只拦截画板浏览器缩放且保持鼠标下的内容位置',()=>{
  const f=wheelFixture();f.scroll.scrollTop=1200;f.scroll.scrollLeft=180;
  const original=clone(f.pages),before=f.point();
  assert.equal(f.wheel(-100),true);assert.ok(f.controller.snapshot().zoom>1);
  close(f.point().x,before.x);close(f.point().y,before.y);
  f.scroll.emit('scroll');f.flush();close(f.point().y,before.y);
  assert.equal(f.wheel(100),true);close(f.controller.snapshot().zoom,1);
  close(f.point().x,before.x);close(f.point().y,before.y);
  assert.equal(f.changes.length,2);assert.deepEqual(f.pages,original);
  const current=f.controller.snapshot();f.controller.set({zoom:f.changes.at(-1)});close(f.controller.snapshot().zoom,current.zoom);
  f.controller.destroy();assert.equal(f.wheel(-100),false);assert.equal(f.changes.length,2);
});
test('普通滚轮保持原生滚动，压缩长页仍按编辑比例上下移动',()=>{
  const ordinary=wheelFixture({height:90000,zoom:.5});
  assert.equal(ordinary.wheel(120,{ctrlKey:false}),false);assert.equal(ordinary.changes.length,0);close(ordinary.controller.snapshot().zoom,.5);
  const compressed=wheelFixture({height:900000000,zoom:.5,maxPhysicalHeight:2000});
  assert.equal(compressed.wheel(120,{ctrlKey:false}),true);close(compressed.controller.snapshot().window.logicalTop,240);
  close(compressed.controller.snapshot().zoom,.5);assert.equal(compressed.changes.length,0);
});
test('连续模式与压缩滚动的Ctrl缩放保留原页位置，SVG仍为有限视窗',()=>{
  const f=wheelFixture({height:900000000,zoom:.75,mode:'continuous',maxPhysicalHeight:2000});
  f.pages.push(makePage([],'stack',724,2172));f.controller.set({pages:f.pages});
  f.controller.scrollToPage(f.pages[0].id,{localY:400000000});f.flush();
  const before=f.point(),pageId=f.controller.hitTest(before).pageId;
  assert.equal(f.wheel(-100),true);close(f.point().x,before.x);close(f.point().y,before.y);
  f.scroll.emit('scroll');f.flush();close(f.point().y,before.y);
  assert.equal(f.controller.hitTest(f.point()).pageId,pageId);
  assert.ok(Number(f.stage.attrs.height)<1600);assert.equal(f.controller.snapshot().window.physicalHeight,2000);
});
test('滚轮像素和行单位一致，缩放边界与无效输入不产生无限值',()=>{
  const pixel=wheelFixture(),line=wheelFixture();
  pixel.wheel(-48);line.wheel(-3,{deltaMode:1});close(pixel.controller.snapshot().zoom,line.controller.snapshot().zoom);
  const bounded=wheelFixture({zoom:7.9});bounded.wheel(-500);close(bounded.controller.snapshot().zoom,8);
  const count=bounded.changes.length;assert.equal(bounded.wheel(-500),true);assert.equal(bounded.changes.length,count);
  const min=wheelFixture({height:3840,zoom:.01});min.wheel(500);close(min.controller.snapshot().zoom,.01);
  assert.equal(min.wheel(NaN),true);close(min.controller.snapshot().zoom,.01);
  const aboveLimit=wheelFixture({zoom:10});aboveLimit.wheel(-100);close(aboveLimit.controller.snapshot().zoom,10);
  aboveLimit.wheel(100);assert.ok(aboveLimit.controller.snapshot().zoom<10);
  const belowLimit=wheelFixture({height:90000,zoom:1e-8});belowLimit.wheel(100);close(belowLimit.controller.snapshot().zoom,1e-8);
  belowLimit.wheel(-100);assert.ok(belowLimit.controller.snapshot().zoom>1e-8);
  const tiny=wheelFixture({height:900000000,zoom:1e-6});tiny.wheel(-100);
  assert.ok(tiny.controller.snapshot().zoom>1e-6&&tiny.controller.snapshot().zoom<.01);
});
