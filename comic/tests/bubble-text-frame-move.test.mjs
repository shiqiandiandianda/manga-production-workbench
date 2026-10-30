import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
import {setBubbleEditMode} from '../public/bubble-edit-mode.js';
import {bubbleLayout,svgBubbleMarkup} from '../public/lettering.js';import {freezeBubbleTextLayout} from '../public/bubble-text-flow.js';import {applyBubbleEdit} from '../public/bubble-editor.js';
const require=createRequire(import.meta.url),{createCanvas}=require(process.env.COMIC_TEST_CANVAS_MODULE),ctx=createCanvas(900,900).getContext('2d');
const original=()=>({id:'bubble_frame_test',type:'speech',text:'昨日巡逻队遭魔刹宗余孽、地魔联手伏击。',x:120,y:180,w:400,h:220,shape:'oval',fontSize:28,fontFamily:'source-han-sans',fontWeight:600,lineHeight:1.333,textBox:{x:30,y:40,w:330,h:124},visible:true,productionTextId:'E012-T01'});
for(const shape of ['oval','rounded-rect','cloud','none'])test('移动文字框保存几何，有框台词不越过轮廓、无框台词自由移动：'+shape,()=>{
 const b={...original(),shape};setBubbleEditMode(b.id,'text');const before=bubbleLayout(ctx,b);freezeBubbleTextLayout(b,before);const next=applyBubbleEdit(b,{type:'text-move',dx:100,dy:65}),after=bubbleLayout(ctx,next);
 if(shape==='none'){assert.deepEqual(after.lines.map(l=>l.text),before.lines.map(l=>l.text));assert.equal(after.fontSize,before.fontSize);for(let i=0;i<after.lines.length;i++){assert.ok(Math.abs(after.lines[i].x-before.lines[i].x-100)<1e-8);assert.ok(Math.abs(after.lines[i].y-before.lines[i].y-65)<1e-8);}}else{assert.equal(after.overflow,false);assert.equal(after.lines.map(l=>l.text).join(''),b.text);assert.ok(after.fontSize<=b.fontSize);assert.equal(next.textBox.x,b.textBox.x+100);assert.equal(next.textBox.y,b.textBox.y+65);}for(const key of ['x','y','w','h','text'])assert.equal(next[key],b[key]);
 const reload=JSON.parse(JSON.stringify(next));assert.deepEqual(bubbleLayout(ctx,reload).lines,after.lines);assert.match(svgBubbleMarkup(ctx,next,{selected:true}),/data-bubble-handle="text-move"/);
 const resized=applyBubbleEdit(next,{type:'text-resize',dx:-180,dy:100}),reflow=bubbleLayout(ctx,resized);assert.equal(resized.textLayout,undefined);assert.equal(resized.textFrameLayout,true);assert.notDeepEqual(reflow.lines.map(l=>l.text),before.lines.map(l=>l.text));if(shape==='none')assert.equal(reflow.fontSize,before.fontSize);else{assert.equal(reflow.overflow,false);assert.ok(reflow.fontSize<=b.fontSize);}assert.equal(resized.text,b.text);
});
test('缩放气泡边框保留文字框与排版，只有文字框缩放重排；修改台词不会复用旧行',()=>{
 const b=original(),before=bubbleLayout(ctx,b);freezeBubbleTextLayout(b,before);const resized=applyBubbleEdit(b,{type:'resize',dx:130,dy:70});assert.deepEqual(resized.textBox,b.textBox);assert.deepEqual(bubbleLayout(ctx,resized).lines,before.lines);resized.text='更新后的台词';assert.equal(bubbleLayout(ctx,resized).lines.map(l=>l.text).join(''),'更新后的台词');
});
