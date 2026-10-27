import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {bubbleLayout,svgBubbleMarkup,paintBubble,fitDialogueBubble,bubbleTailGeometry} from '../public/lettering.js';
import {bubbleFieldChange} from '../public/editor-state.js';
import {productionTailVisible} from '../public/bubble-tail-compat.js';
import {bubbleMaterials,applyBubbleMaterial} from '../public/bubble-material.js';
const {createCanvas}=createRequire(import.meta.url)(process.env.COMIC_TEST_CANVAS_MODULE);
const ctx=createCanvas(1000,1000).getContext('2d');
const base=(extra={})=>({id:'bubble_fit',type:'speech',shape:'oval',text:'抱歉，我这人向来欺软怕硬。',x:20,y:30,w:326.506,h:157.594,fontSize:36,visible:true,lineHeight:1.333,productionOriginal:{文本:'抱歉，我这人向来欺软怕硬。'},tail:{visible:false,side:'bottom',base:.5},...extra});
function contained(b){
 const before=structuredClone(b),layout=bubbleLayout(ctx,b);
 assert.deepEqual(b,before,'rendering must not modify saved source');
 assert.equal(layout.overflow,false,JSON.stringify({shape:b.shape,text:b.text,font:layout.fontSize}));
 assert.equal(layout.lines.map(l=>l.text).join(''),b.text.replaceAll('\n',''),'no dropped characters');
 assert.ok(layout.fontSize<=b.fontSize);
 assert.equal(layout.w,b.w);assert.equal(layout.h,b.h);
 for(const line of layout.lines){
  if(!line.glyphs){assert.ok(line.width<=line.availableWidth+.01);const left=line.x-(layout.textAlign==='left'?0:layout.textAlign==='right'?line.width:line.width/2);assert.ok(left>=line.left-.01&&left+line.width<=line.right+.01);}
  if(b.shape==='oval')for(const g of line.glyphs||[{...line}]){
   const width=line.glyphs?ctx.measureText(g.text).width:line.width,left=g.x-(layout.textAlign==='left'&&!line.glyphs?0:layout.textAlign==='right'&&!line.glyphs?width:width/2);
   for(const x of [left,left+width])for(const y of [g.y-layout.fontSize*.525,g.y+layout.fontSize*.525])assert.ok(((x-b.w/2)/(b.w/2))**2+((y-b.h/2)/(b.h/2))**2<=1.0001,'glyph corners stay in ellipse');
  }
 }
 assert.match(svgBubbleMarkup(ctx,b),/data-overflow="false"/);
 return layout;
}
test('截图中的对白和长台词按椭圆轮廓适配，原始字号和几何保留',()=>{
 for(const text of ['抱歉，我这人向来欺软怕硬。','我们祖孙二人就是贫苦人家，哪有什么钱财？','前面是福州林家车队，少侠可去借点银两。','还是你们这种老的老小的小，最容易欺负！','长台词需要换行并完整留在气泡里面。'.repeat(8)])contained(base({text}));
 assert.equal(contained(base({text:'前面是福州林家车队，少侠可去借点银两。'})).autoFitted,true);
});
test('横排、竖排、手工换行、字距和各种常用轮廓均自动适配',()=>{
 for(const shape of ['oval','rounded-rect','cloud','burst','custom'])for(const writingMode of ['horizontal','vertical'])for(const textDirection of ['ltr','rtl'])contained(base({shape,writingMode,textDirection,w:180,h:110,fontSize:48,letterSpacing:4,text:'甲乙丙丁戊己庚辛壬癸。再说一句！'}));
 contained(base({lineBreakMode:'explicit',text:'这行台词很长但不能超出气泡框\n下一行',w:160,h:100}));
 contained(base({w:30,h:20,padding:100,text:'小气泡也不能漏字。'}));
});
test('独立文字框越界后在气泡内适配，保存刷新一致',()=>{
 const b=base({textBox:{x:350,y:-80,w:300,h:220},textFrameLayout:true});contained(b);assert.deepEqual(bubbleLayout(ctx,JSON.parse(JSON.stringify(b))),bubbleLayout(ctx,b));
});
test('可编辑气泡素材的内边距和复合轮廓参与自动适配',()=>{
 for(const material of bubbleMaterials)contained(applyBubbleMaterial(base({w:280,h:140,text:'素材气泡的台词也应完整留在框内，不越过边缘。'}),material.id));
});
test('画布 SVG 与导出 Canvas 使用相同字号、文字和坐标',()=>{
 const b=base({w:180,h:80}),layout=bubbleLayout(ctx,b),svg=svgBubbleMarkup(ctx,b),calls=[],native=ctx.fillText.bind(ctx);
 ctx.fillText=(...args)=>{calls.push({args,font:ctx.font});native(...args);};
 try{paintBubble(ctx,b);}finally{ctx.fillText=native;}
 assert.match(svg,new RegExp('font-size="'+layout.fontSize+'"'));
 assert.deepEqual(calls.map(c=>c.args),layout.lines.map(l=>[l.text,l.x,l.y]));
 assert.ok(calls.every(c=>c.font===layout.font));
});
test('默认对白尾巴显示，用户手动关闭后保存刷新保持关闭',()=>{
 const b=base();assert.ok(bubbleTailGeometry(b));
 const off=bubbleFieldChange(b,'bubble-tail','visible',false);assert.equal(off.tail.visibilityExplicit,true);assert.equal(bubbleTailGeometry(JSON.parse(JSON.stringify(off))),null);
 assert.ok(bubbleTailGeometry(bubbleFieldChange(off,'bubble-tail','visible',true)));
 for(const type of ['thought','caption','sfx'])assert.equal(bubbleTailGeometry(base({type})),null);
 assert.equal(bubbleTailGeometry(base({productionOriginal:{泡尾:null}})),null);
 assert.equal(bubbleTailGeometry(base({comicStyleId:'chosen-no-tail'})),null);
 assert.equal(productionTailVisible({},'speech'),true);assert.equal(productionTailVisible({},'thought'),false);assert.equal(productionTailVisible({泡尾:null},'speech'),false);
});
test('无框文字仍保留独立文字框，按文字扩大气泡保持指定字号',()=>{
 const b=base({shape:'none',w:130,h:45,textBox:{x:300,y:250,w:350,h:160}}),l=bubbleLayout(ctx,b);assert.equal(l.fontSize,b.fontSize);assert.deepEqual(l.textBox,b.textBox);
 const sized=fitDialogueBubble(ctx,base({w:60,h:25,text:'这是一句需要气泡随文字扩大后才能保持原字号的台词。'})),fit=bubbleLayout(ctx,sized);assert.equal(fit.fontSize,36);assert.equal(fit.overflow,false);
});
