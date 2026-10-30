import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import fs from 'node:fs';
import {bubbleLayout,bubbleOutlinePoints} from '../public/lettering.js';
import {fitBubbleToCurrentLayout,renderedTextBounds,CURRENT_LAYOUT_MARGINS} from '../public/bubble-fit-layout.js';
import {applyBubbleMaterial} from '../public/bubble-material.js';
import {addDialogueSegment} from '../public/bubble-dialogue-segments.js';
const {createCanvas}=createRequire(import.meta.url)(process.env.COMIC_TEST_CANVAS_MODULE);
const ctx=createCanvas(1280,1000).getContext('2d');
const base=extra=>({id:'test-fit-layout',type:'thought',shape:'oval',x:200,y:300,w:190,h:260,fontSize:32,fontFamily:'source-han-sans',fontWeight:400,textAlign:'center',lineHeight:1.35,padding:16,text:'下面人做的事，也算我管理有方。',textBox:{x:90,y:80,w:280,h:100},tail:{visible:false},...extra});
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} != ${b}`);
test('适配导入对白时保留实际可见的尾巴，显式隐藏仍保持隐藏',()=>{
 const b=base({type:'speech',productionOriginal:{文本:'原始台词'},tail:{visible:false,side:'bottom',base:.54}});
 const before=structuredClone(b),old=bubbleLayout(ctx,b);assert.ok(old.tail,'旧导入的对白实际显示尾巴');
 const result=fitBubbleToCurrentLayout(ctx,b);assert.equal(result.status,'fitted');
 const next=bubbleLayout(ctx,result.bubble);assert.ok(next.tail,'适配不能把可见尾巴隐藏');
 assert.equal(result.bubble.tail.visible,true);assert.ok(next.drawOutline.some(p=>Math.hypot(p.x-next.tail.tip.x,p.y-next.tail.tip.y)<1e-5));
 assert.ok(bubbleLayout(ctx,JSON.parse(JSON.stringify(result.bubble))).tail);
 assert.deepEqual(fitBubbleToCurrentLayout(ctx,result.bubble).bubble,result.bubble);assert.deepEqual(b,before);
 const hidden={...b,tail:{...b.tail,visibilityExplicit:true}};
 assert.equal(bubbleLayout(ctx,fitBubbleToCurrentLayout(ctx,hidden).bubble).tail,null);
});
test('新适配入口同步尾尖，旧拉长尾巴缩回且不改变文字位置',()=>{
 const b=base({type:'speech',tail:{visible:true,side:'bottom',base:.5,mode:'normalized',x:.5,y:5}}),before=structuredClone(b);
 const result=fitBubbleToCurrentLayout(ctx,b);assert.equal(result.status,'fitted');
 const old=bubbleLayout(ctx,b),next=bubbleLayout(ctx,result.bubble),a=next.tail.anchor||{x:(next.tail.anchors[0].x+next.tail.anchors[1].x)/2,y:(next.tail.anchors[0].y+next.tail.anchors[1].y)/2};
 assert(Math.hypot(next.tail.tip.x-a.x,next.tail.tip.y-a.y)<=Math.min(next.w,next.h)*2+.001);
 old.lines.forEach((line,i)=>{close(line.x+old.x,next.lines[i].x+next.x);close(line.y+old.y,next.lines[i].y+next.y);});
 assert.deepEqual(b,before);assert.notDeepEqual(result.bubble.tail,b.tail);
});
function verify(b){
 const before=structuredClone(b),old=bubbleLayout(ctx,b),result=fitBubbleToCurrentLayout(ctx,b);assert.equal(result.status,'fitted');assert.deepEqual(b,before);
 const next=result.bubble,layout=bubbleLayout(ctx,next);assert.deepEqual(layout.lines.map(l=>l.text),old.lines.map(l=>l.text));assert.equal(layout.fontSize,old.fontSize);assert.equal(next.fontSize,b.fontSize);
 close(layout.textBox.x+layout.x,old.textBox.x+old.x);close(layout.textBox.y+layout.y,old.textBox.y+old.y);assert.equal(layout.textBox.w,old.textBox.w);assert.equal(layout.textBox.h,old.textBox.h);
 for(const key of ['text','type','shape','fontFamily','fontWeight','lineHeight','letterSpacing','writingMode','textAlign','assetContour','assetInsets','assetRays','comicStyleId','productionOriginal'])assert.deepEqual(next[key],b[key],key);
 for(const key of ['visible','side','base'])assert.deepEqual(next.tail?.[key],b.tail?.[key],key);if(layout.tail)assert.ok(Number.isFinite(layout.tail.tip.x)&&Number.isFinite(layout.tail.tip.y));
 old.lines.forEach((l,i)=>{const n=layout.lines[i];close(l.x+old.x,n.x+layout.x);close(l.y+old.y,n.y+layout.y);for(let j=0;j<(l.glyphs?.length||0);j++){close(l.glyphs[j].x+old.x,n.glyphs[j].x+layout.x);close(l.glyphs[j].y+old.y,n.glyphs[j].y+layout.y);}});
 const bounds=renderedTextBounds(ctx,layout),outline=bubbleOutlinePoints(next),left=Math.min(...outline.map(p=>p.x)),right=Math.max(...outline.map(p=>p.x)),top=Math.min(...outline.map(p=>p.y)),bottom=Math.max(...outline.map(p=>p.y));
 close(bounds.x-left,48);close(right-bounds.x-bounds.w,48);close(bounds.y-top,72);close(bottom-bounds.y-bounds.h,72);assert.equal(layout.overflow,false);
 assert.deepEqual(fitBubbleToCurrentLayout(ctx,next).bubble,next);assert.deepEqual(bubbleLayout(ctx,JSON.parse(JSON.stringify(next))),layout);return layout;
}
test('按拖宽文字框形成的两行适配，字号/分行/位置不变，主体变宽且四边成对对称',()=>{
 const layout=verify(base());assert.equal(layout.lines.length,2);assert.ok(layout.w>layout.h);
});
test('以当前排版为准，不限制两行；靠左靠右、回车、字距、竖排与自定义素材保持',()=>{
 for(const width of [100,180,400])for(const textAlign of ['left','center','right'])verify(base({textBox:{x:-50,y:180,w:width,h:220},textAlign,letterSpacing:2}));
 verify(base({text:'第一行\n第二行\n第三行',lineBreakMode:'explicit'}));
 verify(base({writingMode:'vertical',textDirection:'rtl',textBox:{x:80,y:20,w:180,h:200}}));
 for(const id of ['builtin-oval','builtin-cloud','builtin-rounded'])verify(applyBubbleMaterial(base(),id));
 verify({...applyBubbleMaterial(base(),'builtin-oval'),assetRays:{count:100,length:.12},productionOriginal:{文本:'下面人做的事，也算我管理有方。'}});
});
test('锁定、空白、无框、双段和超尺寸不被强行改写',()=>{
 for(const b of [base({locked:true}),base({text:' '}),base({shape:'none'}),base({visible:false})])assert.deepEqual(fitBubbleToCurrentLayout(ctx,b).bubble,b);
 const double=addDialogueSegment(applyBubbleMaterial(base({type:'speech'}),'builtin-double'),'第二句。');assert.equal(fitBubbleToCurrentLayout(ctx,double).status,'segments');
 const b=base();const result=fitBubbleToCurrentLayout(ctx,b,{maxWidth:50});assert.equal(result.status,'too-large');assert.deepEqual(result.bubble,b);
});
test('固定留白不受字号或旧padding影响，不适合的特殊轮廓保留原样',()=>{
 assert.deepEqual(CURRENT_LAYOUT_MARGINS,{horizontal:48,vertical:72});
 verify(base({fontSize:24,padding:100}));verify(base({fontSize:40,padding:0}));
 const b=base({shape:'custom',points:[{x:0,y:0},{x:1,y:0},{x:.5,y:1}]});
 const result=fitBubbleToCurrentLayout(ctx,b);assert.equal(result.status,'contour-space');assert.deepEqual(result.bubble,b);
 const burst=applyBubbleMaterial(base(),'builtin-burst'),blocked=fitBubbleToCurrentLayout(ctx,burst);assert.equal(blocked.status,'contour-space');assert.deepEqual(blocked.bubble,burst);
});
test('放射素材的内缩且偏心主体按实际轮廓适配，透明边缘不占留白',()=>{
 const fixture=JSON.parse(fs.readFileSync(new URL('./fixtures/bubble-inset-body.json',import.meta.url)));
 const b=base({...fixture,shape:'asset',w:659.75,h:387.45,textBox:{x:215,y:148.6,w:256,h:76.27}});
 const l=verify(b);assert.equal(l.lines.length,2);
 assert.ok(l.w>256+48*2,'素材画布宽包含主体外的透明/放射区域');
 verify(base({...fixture,shape:'asset',assetContour:fixture.assetContour.map(p=>({x:.2+p.x*.5,y:.1+p.y*.7}))}));
});
