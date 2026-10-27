import test from 'node:test';
import assert from 'node:assert/strict';
import {bubbleBoundary,boundaryPointAt,projectPointToBoundary,tailBoundaryAnchors,unionBubbleTail} from '../public/bubble-tail-anchor.js';
import {bubbleLayout,bubbleOutlinePoints,bubbleTailGeometry,paintBubble,svgBubbleMarkup,svgBubbleSelectionMarkup} from '../public/lettering.js';
import {applyBubbleEdit,BubbleEditor} from '../public/bubble-editor.js';
import {bubbleMaterials,applyBubbleMaterial} from '../public/bubble-material.js';
import {bubbleFieldChange} from '../public/editor-state.js';
import {createProject} from '../public/model.js';
import {validateProject} from '../lib/store.mjs';

const bubble=extra=>({id:'bubble_anchor_test',type:'speech',shape:'oval',text:'原文',fontSize:20,x:100,y:200,w:240,h:120,visible:true,tail:{mode:'normalized',x:.7,y:1.6,side:'bottom',base:.54,visible:true},...extra});
function context(){const calls=[],ctx={calls,globalAlpha:1,measureText:text=>({width:[...text].length*10})};for(const method of ['save','restore','translate','beginPath','ellipse','moveTo','lineTo','closePath','fill','stroke','fillRect','strokeRect','fillText','strokeText'])ctx[method]=(...args)=>calls.push({method,args});return ctx;}
const inside=(points,p)=>{let yes=false;for(let i=0,j=points.length-1;i<points.length;j=i++){const a=points[j],b=points[i];if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)yes=!yes;}return yes;};

test('属性滑块百分比映射到真实尾根参数，切回旧定位清理参数，保存拒绝越界',()=>{
 const value=bubble(),tip=bubbleTailGeometry(value).tip,next=bubbleFieldChange(value,'bubble-tail','anchorT',67.4);
 assert.equal(next.tail.anchorT,.674);assert.deepEqual(bubbleTailGeometry(next).tip,tip);assert.equal(next.w,value.w);assert.equal(next.h,value.h);
 assert.equal(bubbleFieldChange(next,'bubble-tail','base',40).tail.anchorT,undefined);
 assert.equal(bubbleFieldChange(next,'bubble-tail','side','left').tail.anchorT,undefined);
 const project=createProject('尾根存储验收',true),original=project.pages[0].bubbles[0];
 original.tail={mode:'normalized',x:.5,y:1.5,anchorT:.674};validateProject(project);
 for(const invalid of [-.01,1.01,NaN,Infinity,'0.5']){original.tail.anchorT=invalid;assert.throws(()=>validateProject(project),/尾尖参数/);}
});

test('已编辑尾根更换手绘素材时保留尾巴描边',()=>{
 const material=bubbleMaterials.find(style=>style.texture);assert.ok(material);
 const next=applyBubbleMaterial(bubble({tail:{anchorT:.4},outlineWidth:2.8}),material.id);
 assert.equal(next.outlineWidth,2.8);assert.equal(next.tail.anchorT,.4);
 assert.equal(applyBubbleMaterial(bubble({outlineWidth:2.8}),material.id).outlineWidth,0);
});

test('0–1参数按真实闭合轮廓弧长运行，而非节点数量或矩形侧边比例',()=>{
 const path=bubbleBoundary([{x:0,y:0},{x:200,y:0},{x:200,y:100},{x:0,y:100}]);assert.equal(path.length,600);assert.deepEqual(boundaryPointAt(path,.25).point,{x:150,y:0});assert.deepEqual(boundaryPointAt(path,1).point,boundaryPointAt(path,0).point);const projected=projectPointToBoundary(path,{x:300,y:75});assert.deepEqual(projected.point,{x:200,y:75});assert.equal(projected.t,275/600);assert.equal(bubbleBoundary([{x:NaN,y:0},{x:1,y:0},{x:0,y:1}]),null);
});

test('椭圆、圆角、云朵、自定义与现有手绘素材均投影到实际外轮廓，尾尖不移动',()=>{
 const shapes=[{shape:'oval'},{shape:'rounded-rect'},{shape:'cloud'},{shape:'custom',points:[{x:.2,y:0},{x:.85,y:.1},{x:1,y:.8},{x:.4,y:1},{x:0,y:.7}]},{shape:'asset',assetContour:bubbleMaterials[0].contour}];
 for(const shape of shapes){const value=bubble(shape),before=structuredClone(value),oldTip=bubbleTailGeometry(value).tip,next=applyBubbleEdit(value,{type:'tail-anchor',x:value.x+value.w*1.2,y:value.y+value.h*.02}),geometry=bubbleTailGeometry(next),path=bubbleBoundary(bubbleOutlinePoints(next));assert.ok(next.tail.anchorT>=0&&next.tail.anchorT<=1);assert.deepEqual(geometry.tip,oldTip);assert.ok(projectPointToBoundary(path,geometry.anchor).distance<1e-7);for(const a of geometry.anchors)assert.ok(projectPointToBoundary(path,a).distance<1e-7);for(const k of ['id','text','w','h','x','y','assetContour','points'])assert.deepEqual(next[k],before[k]);assert.deepEqual(value,before);}
});

test('椭圆角落拖动不能贴到矩形包围盒角落，手绘控点准确落在素材曲线上',()=>{
 const value=bubble(),next=applyBubbleEdit(value,{type:'tail-anchor',x:340,y:200}),point=bubbleTailGeometry(next).anchor,q=((point.x-120)/120)**2+((point.y-60)/60)**2;assert.ok(Math.abs(q-1)<.003);assert.ok(point.y>0||point.x<240);const asset=bubble({shape:'asset',assetContour:bubbleMaterials[2].contour}),target=asset.assetContour[17],on=applyBubbleEdit(asset,{type:'tail-anchor',x:asset.x+target.x*asset.w,y:asset.y+target.y*asset.h});assert.ok(Math.hypot(bubbleTailGeometry(on).anchor.x-target.x*asset.w,bubbleTailGeometry(on).anchor.y-target.y*asset.h)<1e-7);
});

test('尾根两端跨0/100%接缝时仍连续且位于边界，数字限定0–1',()=>{
 const value=bubble(),outline=bubbleOutlinePoints(value),zero=tailBoundaryAnchors(outline,0,14),one=tailBoundaryAnchors(outline,1,14);assert.deepEqual(zero.anchor,one.anchor);for(let i=0;i<2;i++)assert.ok(Math.hypot(zero.anchors[i].x-one.anchors[i].x,zero.anchors[i].y-one.anchors[i].y)<1e-7);assert.equal(applyBubbleEdit(value,{type:'tail-anchor',anchorT:8}).tail.anchorT,1);assert.deepEqual(applyBubbleEdit(value,{type:'tail-anchor',anchorT:NaN}),value);assert.deepEqual(applyBubbleEdit({...value,locked:true},{type:'tail-anchor',anchorT:.1}),{...value,locked:true});
});

test('没有anchorT的旧泡保留原来的底座与描画分支，首次改根也保留默认尾尖',()=>{
 const old=bubble({shape:undefined,tail:undefined}),before=structuredClone(old),markup=svgBubbleMarkup(context(),old);assert.match(markup,/<ellipse/);assert.equal(old.tail,undefined);const originalTip=bubbleTailGeometry(old).tip,next=applyBubbleEdit(old,{type:'tail-anchor',anchorT:.6});assert.deepEqual(bubbleTailGeometry(next).tip,originalTip);assert.equal(next.tail.mode,'absolute');assert.deepEqual(old,before);assert.equal(svgBubbleMarkup(context(),old),markup);
});

test('固定尾尖跨到框另一边时，轮廓并集合成保留框体，不挖掉文本背景',()=>{
 const value=bubble({tail:{mode:'normalized',x:.5,y:1.8,anchorT:0}}),body=bubbleOutlinePoints(value),geometry=bubbleTailGeometry(value),combined=unionBubbleTail(body,geometry.anchors,geometry.tip);for(let y=12;y<120;y+=12)for(let x=12;x<240;x+=12)if(inside(body,{x,y}))assert.ok(inside(combined,{x,y}),'正文框体应保留');assert.ok(combined.some(p=>Math.hypot(p.x-geometry.tip.x,p.y-geometry.tip.y)<1e-7));
});

test('Canvas与SVG采用完全相同的尾根和外轮廓坐标，导出不含编辑控点',()=>{
 const value=applyBubbleEdit(bubble({shape:'cloud'}),{type:'tail-anchor',anchorT:.57}),paint=context();paintBubble(paint,value);const svg=svgBubbleMarkup(context(),value),polygon=/<polygon points="([^"]+)"/.exec(svg);assert.ok(polygon);const points=polygon[1].split(' ').map(pair=>pair.split(',').map(Number)),canvas=paint.calls.filter(c=>['moveTo','lineTo'].includes(c.method)).map(c=>c.args);assert.deepEqual(points,canvas);assert.doesNotMatch(svg,/data-bubble-handle/);const overlay=svgBubbleSelectionMarkup(context(),value,{zoom:.5});assert.match(overlay,/data-bubble-handle="tail-anchor"/);assert.match(overlay,/data-bubble-anchor-t="/);assert.match(overlay,/r="24" fill="transparent" pointer-events="all"/);assert.equal(svgBubbleSelectionMarkup(context(),{...value,locked:true}),'');
});

test('凹凸云朵或手绘边在根部形成复合路径时保留尾尖，各子轮廓在SVG与Canvas相同',()=>{
 const value=bubble({shape:'cloud',w:360,h:180,tail:{mode:'normalized',x:.6,y:1.5,anchorT:.35}}),layout=bubbleLayout(context(),value),loops=layout.drawOutline.components;assert.ok(loops?.length>1);assert.ok(loops.flat().some(p=>Math.hypot(p.x-layout.tail.tip.x,p.y-layout.tail.tip.y)<1e-7));const canvas=context();paintBubble(canvas,value);const expected=loops.flatMap(p=>p.map(v=>[v.x,v.y])),actual=canvas.calls.filter(c=>['moveTo','lineTo'].includes(c.method)).map(c=>c.args);assert.deepEqual(actual,expected);const svg=svgBubbleMarkup(context(),value),path=/<path d="([^"]+)"/.exec(svg);assert.ok(path);const svgPoints=path[1].replaceAll('M','').replaceAll('L','').replaceAll('Z','').trim().split(/\s+/).map(Number);assert.deepEqual(svgPoints,expected.flat());
 for(const material of bubbleMaterials)for(const t of [0,.2,.35,.5,.625,.8,1]){const b=bubble({shape:'asset',assetContour:material.contour,w:360,h:180,tail:{mode:'normalized',x:.6,y:1.5,anchorT:t}}),g=bubbleTailGeometry(b),outline=unionBubbleTail(bubbleOutlinePoints(b),g.anchors,g.tip);assert.ok((outline.components||[outline]).flat().some(p=>Math.hypot(p.x-g.tip.x,p.y-g.tip.y)<1e-6),material.id+' 不应丢尾尖');}
});

function events(){const listeners=new Map();return {listeners,addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:(name,fn)=>{if(listeners.get(name)===fn)listeners.delete(name);}};}
function event(target,x,y){return {target,clientX:x,clientY:y,pointerId:4,button:0,preventDefault(){},stopImmediatePropagation(){}};}
test('现有蓝点及新尾根控点在孩子SVG重绘/失捕获后仍拖动，提交一次且保存完整撤销原件',()=>{
 for(const kind of ['resize','text-move','text-resize','tail','tail-anchor']){const document=events(),root={...events(),ownerDocument:document,contains:()=>true,setPointerCapture(){},hasPointerCapture:()=>true,releasePointerCapture(){}},group={dataset:{bubble:'bubble_anchor_test',renderW:'240',renderH:'120'}},handle={dataset:{bubbleHandle:kind},closest:()=>group},target={closest:()=>handle},original=bubble(),previews=[],commits=[];const editor=new BubbleEditor({root,getBubble:()=>original,toPagePoint:e=>({x:e.clientX,y:e.clientY}),onChange:(next,meta)=>previews.push({next,meta}),onCommit:(next,meta)=>commits.push({next,meta})});root.listeners.get('pointerdown')(event(target,240,320));root.listeners.get('lostpointercapture')(event(handle,240,320));assert.ok(editor.active,'删除孩子控点的失捕获不能中止稳定root拖动');document.listeners.get('pointermove')(event({},260,340));document.listeners.get('pointermove')(event({},280,345));document.listeners.get('pointerup')(event({},280,345));assert.equal(previews.length,2);assert.equal(commits.length,1);assert.deepEqual(commits[0].meta.before,original);assert.notDeepEqual(commits[0].next,original);editor.destroy();assert.equal(root.listeners.size,0);assert.equal(document.listeners.size,0);}
});

test('pointercancel和root真正失捕获恢复原件不提交，锁定蓝点不会开始拖动',()=>{
 for(const cancel of ['pointercancel','lostpointercapture']){const document=events(),root={...events(),ownerDocument:document,contains:()=>true},group={dataset:{bubble:'bubble_anchor_test',renderW:'240',renderH:'120'}},handle={dataset:{bubbleHandle:'tail-anchor'},closest:()=>group},target={closest:()=>handle},original=bubble(),previews=[],commits=[];const editor=new BubbleEditor({root,getBubble:()=>original,toPagePoint:e=>({x:e.clientX,y:e.clientY}),onChange:next=>previews.push(next),onCommit:next=>commits.push(next)});root.listeners.get('pointerdown')(event(target,240,320));document.listeners.get('pointermove')(event({},300,260));if(cancel==='pointercancel')document.listeners.get(cancel)(event({},300,260));else root.listeners.get(cancel)(event(root,300,260));assert.deepEqual(previews.at(-1),original);assert.equal(commits.length,0);editor.destroy();}
 const document=events(),root={...events(),ownerDocument:document,contains:()=>true},handle={dataset:{bubbleHandle:'resize'},closest:()=>({dataset:{bubble:'bubble_anchor_test'}})},editor=new BubbleEditor({root,getBubble:()=>bubble({locked:true}),onChange:()=>assert.fail('锁定对象不得改动')});root.listeners.get('pointerdown')(event({closest:()=>handle},240,320));assert.equal(editor.active,null);editor.destroy();
});
