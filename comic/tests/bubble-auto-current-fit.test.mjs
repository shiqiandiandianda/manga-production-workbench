import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {changeBubbleStyle} from '../public/bubble-style-selector.js';
import {preparePlacement} from '../public/manual-dialogue-placement.js';
import {fitBubbleToCurrentLayout,renderedTextBounds} from '../public/bubble-fit-layout.js';
import {bubbleLayout} from '../public/lettering.js';
const {createCanvas}=createRequire(import.meta.url)(process.env.COMIC_TEST_CANVAS_MODULE),ctx=createCanvas(1,1).getContext('2d');
const settings={fontFamily:'source-han-sans',fontSize:32,fontWeight:400,lineHeight:1.25,letterSpacing:0,textColor:'#171b20',textAlign:'center',writingMode:'horizontal',padding:18,fillColor:'#ffffff',fillOpacity:1,outlineColor:'#171b20',outlineWidth:2.8,tailVisible:true,columns:8};
const text='申请文书我已经写好，今日便会寄往帝都，帝都那边不日便会派人来暗中查验情况。';
const stable=b=>{const r=fitBubbleToCurrentLayout(ctx,b);assert.equal(r.status,'fitted');assert.deepEqual(r.bubble,b,'Clicking the fit button must not change the automatic result');};
test('无框切有框直接采用实际文字范围，重复适配无变化且不改文字位置',()=>{
 const b={id:'test',visible:true,type:'speech',shape:'none',text,x:100,y:100,w:500,h:600,fontSize:32,textBox:{x:150,y:200,w:360,h:500},tail:{visible:true,side:'bottom'}};
 const before=bubbleLayout(ctx,b),original=structuredClone(b);
 const next=changeBubbleStyle(ctx,b,'shape:oval'),layout=bubbleLayout(ctx,next),ink=renderedTextBounds(ctx,layout);
 stable(next);assert.ok(next.h<500);assert.ok(Math.abs(next.w-ink.w-96)<1e-6);assert.ok(Math.abs(next.h-ink.h-144)<1e-6);
 before.lines.forEach((l,i)=>{assert.equal(layout.lines[i].text,l.text);assert.ok(Math.abs(layout.lines[i].x+next.x-l.x-b.x)<1e-6);assert.ok(Math.abs(layout.lines[i].y+next.y-l.y-b.y)<1e-6);});
 assert.equal(layout.fontSize,before.fontSize);assert.ok(layout.tail);assert.deepEqual(b,original);
});
test('新建有框台词预览已经完成同样适配，无框和重摆保留现有排版',()=>{
 for(const styleId of ['builtin-oval','builtin-rounded','builtin-cloud']){
  const result=preparePlacement(ctx,{text,kind:'speech'},{...settings,styleId});assert.equal(result.status,'fitted');if(styleId==='builtin-cloud'){const fallback=fitBubbleToCurrentLayout(ctx,result.bubble);assert.equal(fallback.status,'contour-space');assert.deepEqual(fallback.bubble,result.bubble);}else stable(result.bubble);assert.equal(result.bubble.fontSize,32);assert.ok(bubbleLayout(ctx,result.bubble).tail);
  const reposition=preparePlacement(ctx,{text,kind:'speech',sourceBubble:result.bubble},{...settings,styleId},{preserveExisting:true});assert.equal(reposition.bubble.w,result.bubble.w);assert.equal(reposition.bubble.h,result.bubble.h);
 }
 const noFrame=preparePlacement(ctx,{text,kind:'speech'},{...settings,styleId:'none'});assert.equal(noFrame.bubble.shape,'none');assert.equal(bubbleLayout(ctx,noFrame.bubble).tail,null);
});
