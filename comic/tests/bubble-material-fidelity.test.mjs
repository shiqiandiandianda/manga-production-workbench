import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {changeBubbleStyle} from '../public/bubble-style-selector.js';
import {bubbleLayout,bubbleOutlinePoints,paintBubble,svgBubbleMarkup} from '../public/lettering.js';
import {paintTextureInk,svgTextureInk} from '../public/bubble-texture-ink.js';
import {comicStyles} from '../public/comic-styles.js';
import {renderedTextBounds,fitBubbleToCurrentLayout} from '../public/bubble-fit-layout.js';
const require=createRequire(import.meta.url),{createCanvas}=require(process.env.COMIC_TEST_CANVAS_MODULE);
const context=createCanvas(1200,1000).getContext('2d');
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} != ${b}`);
const inside=(points,x,y)=>{let hit=false;for(let i=0,j=points.length-1;i<points.length;j=i++){const a=points[i],b=points[j];if((a.y>y)!==(b.y>y)&&x<(b.x-a.x)*(y-a.y)/(b.y-a.y)+a.x)hit=!hit;}return hit;};

test('无框切换有框自动包住已移动的文字，字号、分行与页面位置不变',()=>{
 const b={id:'small-frame',shape:'none',type:'speech',text:'真的太夸张了',x:50,y:350,w:35,h:20,visible:true,fontSize:36,fontFamily:'source-han-sans',textBox:{x:400,y:-200,w:260,h:90},tail:{visible:false},fillOpacity:0,outlineWidth:0};
 const original=structuredClone(b),before=bubbleLayout(context,b);
 const style={id:'test-texture-fit',label:'测试纹理',kind:'bubble',texture:true,width:900,height:450,uses:['thought'],contour:Array.from({length:80},(_,i)=>({x:.5+.36*Math.cos(i*Math.PI/40),y:.5+.28*Math.sin(i*Math.PI/40)})),insets:{left:.2,right:.2,top:.25,bottom:.25}};
 comicStyles.push(style);
 try{for(const id of ['shape:oval','shape:rounded-rect','shape:cloud','shape:burst','builtin-oval','builtin-rounded','builtin-cloud','builtin-burst',style.id]){
  const next=changeBubbleStyle(context,b,id),after=bubbleLayout(context,next),outline=bubbleOutlinePoints(next),box=after.textBox;
  assert.ok(next.w>b.w&&next.h>b.h,id);assert.equal(after.fontSize,before.fontSize);assert.equal(next.text,b.text);assert.deepEqual(after.lines.map(l=>l.text),before.lines.map(l=>l.text));
  close(next.x+box.x,b.x+before.textBox.x);close(next.y+box.y,b.y+before.textBox.y);close(box.w,before.textBox.w);close(box.h,before.textBox.h);
  for(let i=0;i<after.lines.length;i++){close(next.x+after.lines[i].x,b.x+before.lines[i].x);close(next.y+after.lines[i].y,b.y+before.lines[i].y);}
  const ink=renderedTextBounds(context,after);
  for(const x of [ink.x+1,ink.x+ink.w/2,ink.x+ink.w-1])for(const y of [ink.y+1,ink.y+ink.h/2,ink.y+ink.h-1])assert.ok(inside(outline,x,y),id+' text outside body');
  const manual=fitBubbleToCurrentLayout(context,next);if(manual.status==='fitted')assert.deepEqual(manual.bubble,next);else if(id===style.id)close(next.w/next.h,2);
  assert.deepEqual(bubbleLayout(context,JSON.parse(JSON.stringify(next))).lines,after.lines);
 }}finally{comicStyles.splice(comicStyles.indexOf(style),1);}
 assert.deepEqual(b,original);
});

function source(){
 const c=createCanvas(160,100),ctx=c.getContext('2d');ctx.fillStyle='white';ctx.beginPath();ctx.ellipse(80,50,62,34,0,0,Math.PI*2);ctx.fill();ctx.strokeStyle='black';ctx.lineWidth=3;ctx.stroke();
 ctx.globalAlpha=.45;ctx.fillStyle='#888888';ctx.fillRect(8,8,10,10);ctx.globalAlpha=1;return c;
}
test('纹理填充沿用原图透明边缘，默认颜色及半透明像素不被多边形替代',()=>{
 const image=source(),canvas=createCanvas(160,100),ctx=canvas.getContext('2d'),bubble={id:'texture',visible:true,shape:'asset',styleTextureId:'test',textureInkVersion:1,x:0,y:0,w:160,h:100,text:'',outlineWidth:0,materialOutlineWidth:2.8,outlineColor:'#000000',fillColor:'#ffffff',fillOpacity:1,tail:{visible:false},assetContour:[{x:.3,y:.3},{x:.7,y:.3},{x:.5,y:.7}]};
 paintBubble(ctx,bubble,{textureImage:image});const original=image.getContext('2d').getImageData(0,0,160,100).data,result=ctx.getImageData(0,0,160,100).data;
 for(let i=0;i<result.length;i+=4){assert.ok(Math.abs(result[i+3]-original[i+3])<=1,'source alpha retained');if(original[i+3]>32)for(let k=0;k<3;k++)assert.ok(Math.abs(result[i+k]-original[i+k])<=5,'source grayscale retained');}
 const svg=svgBubbleMarkup(context,bubble);assert.doesNotMatch(svg,/<polygon/);assert.match(svg,/operator="arithmetic"/);assert.match(svg,/in2="SourceAlpha"/);
 ctx.clearRect(0,0,160,100);paintTextureInk(ctx,image,bubble,{w:160,h:100},{fillColor:'#00ff00',fillOpacity:.5});const center=ctx.getImageData(80,50,1,1).data;assert.deepEqual([...center],[0,255,0,128]);
 ctx.clearRect(0,0,160,100);paintTextureInk(ctx,image,bubble,{w:160,h:100},{fillColor:'#ffffff',fillOpacity:0});assert.equal(ctx.getImageData(80,50,1,1).data[3],0);assert.ok(ctx.getImageData(141,50,1,1).data[3]>0);
 ctx.clearRect(0,0,160,100);paintTextureInk(ctx,image,{...bubble,materialOutlineWidth:0},{w:160,h:100},{fillColor:'#ffffff',fillOpacity:1});assert.ok(ctx.getImageData(80,50,1,1).data[3]>0);
 assert.match(svgTextureInk({...bubble,materialOutlineWidth:0},'source.png',160,100,v=>v,{fillColor:'#fff',fillOpacity:1}),/<image/);
});
