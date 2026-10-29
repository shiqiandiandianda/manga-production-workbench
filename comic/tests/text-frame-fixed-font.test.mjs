import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
import {bubbleLayout,svgBubbleMarkup,paintBubble} from '../public/lettering.js';import {applyBubbleEdit,freezeBubbleForGeometry} from '../public/bubble-editor.js';import {bubbleFieldChange} from '../public/editor-state.js';import {addDialogueSegment} from '../public/bubble-dialogue-segments.js';import {applyBubbleMaterial} from '../public/bubble-material.js';import {boardTextLayout,boardSvg,paintEpisodeBoard} from '../public/episode-boards.js';import {scaleSfx} from '../public/sfx-library.js';import {typographyMarkup,validateTypography,applyProjectTypography} from '../public/unified-typography.js';
const {createCanvas}=createRequire(import.meta.url)(process.env.COMIC_TEST_CANVAS_MODULE),ctx=createCanvas(900,900).getContext('2d');
const bubble=()=>({id:'fixed',type:'speech',shape:'oval',visible:true,text:'都给老子闭嘴！这是需要换行的很长一段对白。',x:100,y:100,w:320,h:160,fontFamily:'source-han-sans',fontWeight:600,fontSize:36,letterSpacing:3,lineHeight:1.4,textBox:{x:25,y:40,w:240,h:70}});
const fonts=l=>[l.fontSize,l.fontFamily,l.fontWeight,l.fontStyle,l.letterSpacing,l.lineHeight,l.textAlign,l.writingMode];
for(const shape of ['oval','rounded-rect','none'])test('移动与缩放文字框不改变实际字号和字体样式：'+shape,()=>{
 const b={...bubble(),shape},before=bubbleLayout(ctx,b);assert.equal(before.fontSize,36);assert.equal(before.letterSpacing,3);const working=freezeBubbleForGeometry(structuredClone(b),before);
 const moved=applyBubbleEdit(working,{type:'text-move',dx:160,dy:-70}),m=bubbleLayout(ctx,moved);assert.deepEqual(fonts(m),fonts(before));assert.deepEqual(m.lines.map(l=>l.text),before.lines.map(l=>l.text));
 const resized=applyBubbleEdit(moved,{type:'text-resize',dx:-150,dy:-40}),r=bubbleLayout(ctx,resized);assert.deepEqual(fonts(r),fonts(before));assert.notDeepEqual(r.lines.map(l=>l.text),before.lines.map(l=>l.text));assert.equal(r.lines.map(l=>l.text).join(''),b.text);assert.match(svgBubbleMarkup(ctx,resized),/font-size="36"/);assert.deepEqual(fonts(bubbleLayout(ctx,JSON.parse(JSON.stringify(resized)))),fonts(before));
 const changed=bubbleFieldChange(resized,'bubble','fontSize',52);assert.equal(bubbleLayout(ctx,changed).fontSize,52);
});
test('旧自动缩小缓存不再覆盖属性栏字号，超出时不丢字',()=>{
 const b=bubble(),legacy={...b,textLayout:{version:1,key:'old',requestKey:'old',effectiveFontSize:8,effectiveLetterSpacing:.2,w:240,h:70,lines:[]}};const l=bubbleLayout(ctx,legacy);assert.equal(l.fontSize,36);assert.equal(l.letterSpacing,3);assert.equal(l.lines.map(v=>v.text).join(''),b.text);
});
test('双段文字独立缩放和移动也保持字号、样式及文字',()=>{
 const b=addDialogueSegment(applyBubbleMaterial({...bubble(),text:'第一段对白比较长'},'builtin-double'),'第二段也保持自己的换行。');let initial=bubbleLayout(ctx,b);assert.deepEqual(initial.dialogueLayouts.map(l=>l.fontSize),[36,36]);let w=freezeBubbleForGeometry(structuredClone(b),initial);w=applyBubbleEdit(w,{type:'segment-move',index:0,dx:80,dy:20});let moved=bubbleLayout(ctx,w);assert.deepEqual(moved.dialogueLayouts[0].lines.map(l=>l.text),initial.dialogueLayouts[0].lines.map(l=>l.text));w=applyBubbleEdit(w,{type:'segment-resize',index:0,dx:-100,dy:-50});let resized=bubbleLayout(ctx,w);assert.deepEqual(resized.dialogueLayouts.map(l=>l.fontSize),[36,36]);assert.deepEqual(resized.dialogueLayouts.map(l=>l.letterSpacing),[3,3]);assert.equal(resized.dialogueLayouts[0].lines.map(l=>l.text).join(''),'第一段对白比较长');
});
test('统一字体无预览块，所见字号、画布 SVG 和导出画布一致',()=>{
 assert.doesNotMatch(typographyMarkup({fontSize:36},'test'),/data-typography-preview|月色如水/);assert.throws(()=>validateTypography({fontFamily:'source-han-sans',fontSize:9}),/字号/);
 const b=bubble(),p={pages:[{bubbles:[b]}]},style=validateTypography({fontFamily:'source-han-serif',fontSize:52,fontWeight:700,letterSpacing:3});applyProjectTypography(p,style);const l=bubbleLayout(ctx,b);assert.equal(l.fontSize,52);assert.match(svgBubbleMarkup(ctx,b),/font-size="52"/);
 const original=ctx.fillText.bind(ctx),fonts=[];ctx.fillText=(...a)=>{fonts.push(ctx.font);original(...a)};try{paintBubble(ctx,b)}finally{ctx.fillText=original};assert.ok(fonts.length);assert.ok(fonts.every(f=>/52px/.test(f)));
});
test('封面尾图文字和特效文字框使用设置字号，不因尺寸而自动缩字',()=>{
 const layer={text:'很长很长的标题内容',fontFamily:'source-han-sans',fontWeight:700,fontSize:48,minFontSize:10,writingMode:'horizontal',fit:'shrink',x:0,y:0,w:55,h:60,lineHeight:1.2,align:'center'};const l=boardTextLayout(ctx,layer);assert.equal(l.fontSize,48);assert.ok(l.glyphs.length>1);assert.equal(l.glyphs.map(g=>g.text).join(''),layer.text);
 const s={...bubble(),type:'sfx',sfxLibrary:true,padding:10,outlineWidth:3},scaled=scaleSfx(s,.5);assert.equal(scaled.fontSize,36);assert.equal(scaled.letterSpacing,3);assert.equal(scaled.outlineWidth,3);assert.equal(bubbleLayout(ctx,scaled).fontSize,36);
});

test('封面尾图 SVG 和导出画布使用同一指定字号',async()=>{
 const layer={key:'workTitle',visible:true,text:'很长的标题',fontFamily:'source-han-sans',fontWeight:700,fontSize:48,writingMode:'horizontal',x:10,y:10,w:55,h:60,lineHeight:1.2,align:'center',color:'#ffffff',strokeColor:'#000000',strokeWidth:0};
 const board={height:900,background:'#ffffff',kind:'cover',context:{displayNumber:1},layers:[layer]};assert.match(boardSvg(board,ctx),/font-size="48"/);
 const original=ctx.fillText.bind(ctx),fonts=[];ctx.fillText=(...args)=>{fonts.push(ctx.font);original(...args)};try{await paintEpisodeBoard(ctx,board)}finally{ctx.fillText=original};assert.ok(fonts.length);assert.ok(fonts.every(font=>/48px/.test(font)));
});
