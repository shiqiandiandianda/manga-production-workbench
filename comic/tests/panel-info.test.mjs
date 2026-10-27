import test from 'node:test';
import assert from 'node:assert/strict';
import {panelProductionShot} from '../public/panel-generation.js';
import {createProject,clone,layoutLongStrip} from '../public/model.js';
import {normalizeLayerOrder} from '../public/layers.js';
import {renderSceneSvg} from '../public/scene-svg.js';
import {PANEL_INFO_WIDTH,placePanelInfo,panelInfoMarkup} from "../public/panel-info-ui.js";
import {buildImagePrompt,sourceKey} from '../lib/codex.mjs';
import {panelNoteBox} from '../public/panel-note-layout.js';
const escape=text=>String(text??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const state=(p,zoom=1,mode='continuous',pageId=p.pages[0].id)=>({mode,zoom,currentPageId:pageId,layout:layoutLongStrip(p.pages),window:{startY:0,endY:5000}});
const options=p=>({assets:new Map(),measurement:{measureText:()=>({width:10})},selection:null,tool:'move',brush:{size:120},escape,shotFor:f=>p.shots.find(s=>s.id===f.shotId),showPanelInfo:true});

test('斜边格的信息位于独立HTML层，SVG图像及导出不含提示词信息',()=>{
 const p=createProject(),f=p.pages[0].panels[0];f.points=[{x:0,y:.3},{x:1,y:0},{x:1,y:1},{x:0,y:1}];p.shots[0].description='这句话只出现在生产信息卡';normalizeLayerOrder(p);const before=clone(p),result=renderSceneSvg(p,state(p),options(p));
 assert.equal(result.panelInfos.length,1);assert.equal(result.panelInfos[0].panelId,f.id);assert.ok(result.content.includes('shape_'+f.id));assert.ok(!result.content.includes('生产信息卡'));assert.ok(!result.content.includes('panel-shot-info'));assert.deepEqual(p,before);
 assert.equal(renderSceneSvg(p,state(p),{...options(p),showPanelInfo:false}).panelInfos.length,0);
});

test('empty frames show centered prompt and original plot by default while generated artwork stays clear',()=>{
 const p=createProject(),f=p.pages[0].panels[0];f.generation={version:1,prompt:'当前修改的提示词',shotSize:'近景',cameraAngle:'仰拍',sourceSnapshot:{original:{description:'旧快照'}}};p.shots[0].description='原剧情不可被提示词覆盖';normalizeLayerOrder(p);const before=clone(p);
 const result=renderSceneSvg(p,state(p),{...options(p),showPanelInfo:false,panelInfoLayer:true});assert.equal(result.panelInfos.length,1);assert.equal(result.panelInfos[0].placeholder,true);assert.ok(!result.content.includes('data-panel-ratio='));assert.ok(!result.content.includes('当前修改'));
 const html=panelInfoMarkup(f,p.shots[0],escape,{placeholder:true});assert.match(html,/data-info-prompt>当前修改的提示词/);assert.match(html,/data-info-source>原剧情不可被提示词覆盖/);assert.deepEqual(p,before);
 f.imageAssetId='synthetic-asset';const assets=new Map([[f.imageAssetId,{id:f.imageAssetId,width:300,height:300}]]);assert.equal(renderSceneSvg(p,state(p),{...options(p),assets,showPanelInfo:false,panelInfoLayer:true}).panelInfos.length,0);
});

test('centered reading blocks stay within their frame at desktop and mobile scales without shrinking text',()=>{
 const anchor={panelId:'f',placeholder:true,box:{x:100,y:120,w:1000,h:1100}},input={origin:{left:0,top:0},width:1200,height:1000};
 for(const z of [.18,.25,.65,1]){const block=placePanelInfo([anchor],{...input,matrix:{a:z,b:0,c:0,d:z,e:0,f:0}})[0],x=anchor.box.x*z,y=anchor.box.y*z,w=anchor.box.w*z,h=anchor.box.h*z;assert.ok(block);assert.ok(block.left>=x&&block.top>=y);assert.ok(block.left+block.width<=x+w&&block.top+block.height<=y+h);assert.ok(Math.abs(block.left+block.width/2-(x+w/2))<.01);assert.ok(Math.abs(block.top+block.height/2-(y+h/2))<.01);}
});

test('centered notes use free panel space without covering dialogue or its tail',()=>{
 const frame={x:100,y:100,w:1000,h:1000},obstacles=[{x:350,y:80,w:300,h:300},{x:150,y:900,w:150,h:100}],box=panelNoteBox(frame,obstacles);assert.ok(box);assert.ok(box.x>=frame.x&&box.y>=frame.y&&box.x+box.w<=frame.x+frame.w&&box.y+box.h<=frame.y+frame.h);
 for(const o of obstacles)assert.ok(!(box.x<o.x+o.w&&box.x+box.w>o.x&&box.y<o.y+o.h&&box.y+box.h>o.y));
 assert.equal(panelNoteBox(frame,[frame]),null);assert.deepEqual(panelNoteBox(frame),frame);
});

test('信息卡使用固定屏幕宽度，缩放仅改变锚点，移到窄视窗时仍完整显示',()=>{
 const anchor={panelId:'f',box:{x:100,y:120,w:800,h:600}},input={origin:{left:20,top:80},width:1000,height:800},place=z=>placePanelInfo([anchor],{...input,matrix:{a:z,b:0,c:0,d:z,e:50,f:100}})[0];
 const small=place(.1776),large=place(.5074);assert.equal(small.width,PANEL_INFO_WIDTH);assert.equal(large.width,PANEL_INFO_WIDTH);assert.notEqual(small.top,large.top);
 const narrow=placePanelInfo([anchor],{...input,width:230,matrix:{a:1,b:0,c:0,d:1,e:50,f:100}})[0];assert.equal(narrow.width,214);assert.ok(narrow.left+narrow.width<=230-8);
});

test('信息锚点能转换逐页偏移，连续长图保持所属格子并过滤隐藏格',()=>{
 const p=createProject('双页',true);p.pages.push(clone(p.pages[0]));p.pages[1].id='second';p.pages[1].panels.forEach((f,i)=>f.id='second_'+i);p.pages[1].panels[0].visible=false;normalizeLayerOrder(p);
 const result=renderSceneSvg(p,state(p,1,'page','second'),options(p));const first=result.panelInfos.find(i=>i.panelId==='second_1');assert.ok(first);assert.ok(first.box.y<p.pages[1].height);assert.ok(!result.panelInfos.some(i=>i.panelId==='second_0'));
});







test('信息文字转义并提供直接编辑入口',()=>{
 const html=panelInfoMarkup({id:'f'}, {code:'S01',description:'<script>alert(1)</script>',shotSize:'近景',cameraAngle:'仰拍'},escape);assert.ok(!html.includes('<script>'));assert.match(html,/data-info-edit="f"/);assert.match(html,/双击文字编辑/);assert.match(html,/S01 · 近景 · 仰拍/);
});
