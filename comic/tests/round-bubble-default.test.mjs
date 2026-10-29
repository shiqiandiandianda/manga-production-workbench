import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createRequire} from 'node:module';
import {fitDialogueBubble,bubbleLayout,paintBubble} from '../public/lettering.js';
import {applyProductionFrameLettering} from '../public/production-panel-generation.js';
import {createProject} from '../public/model.js';
const {createCanvas}=createRequire(import.meta.url)(process.env.COMIC_TEST_CANVAS_MODULE);
const samples=['你好。','青衣楼出钱，他负责杀人！','已经成了我的执念，就这么放下，我这心里突然间感觉被抽空了……','第一行\n第二行保持原文'];
test('手动默认与按文字适配保持正圆、原文、字体参数，长短文字均无溢出',()=>{
 const canvas=createCanvas(1100,1100),ctx=canvas.getContext('2d');ctx.fillStyle='#dfe6ed';ctx.fillRect(0,0,1100,1100);
 for(const [index,text]of samples.entries()){
  const source={x:30+(index%2)*540,y:30+Math.floor(index/2)*540,w:350,h:110,type:'speech',shape:'oval',text,fontSize:36,fontWeight:500,fontFamily:'source-han-sans',lineHeight:4/3,letterSpacing:0,padding:18,tail:{visible:true,side:'bottom',base:.54}};
  const next=fitDialogueBubble(ctx,source,{maxWidth:500}),layout=bubbleLayout(ctx,next);assert.equal(next.w,next.h);assert.equal(layout.fontSize,36);assert.equal(layout.overflow,false,text);for(const key of ['text','fontSize','fontWeight','fontFamily','lineHeight','letterSpacing'])assert.equal(next[key],source[key]);assert.equal(source.w,350);paintBubble(ctx,{...next,visible:true});
 }
 const proof=path.resolve('../evidence');fs.mkdirSync(proof,{recursive:true});fs.writeFileSync(path.join(proof,'round-default-bubbles.png'),canvas.toBuffer('image/png'));
});
test('自动单格排字默认圆形；旁白、自选样式、空泡文字框、已排文字保持原规则',()=>{
 const ctx=createCanvas(1200,1600).getContext('2d');
 for(const type of ['对白','心声','旁白']){
  const p=createProject('合成排字'),frame=p.pages[0].panels[0];p.pages[0].bubbles=[];Object.assign(frame,{x:0,y:0,w:1000,h:1500,generation:{promptSource:'post-lettering'}});
  const episode={anchors:{},typography:{字号:36}},texts=[{'文字ID':'T1','格ID':'G1','文本':samples[2],'类型':type,'渲染':'工具'}];
  applyProductionFrameLettering(p,frame,episode,'S1',texts,{automatic:true});const b=p.pages[0].bubbles[0];assert.equal(b.fontSize,36);assert.equal(b.text,samples[2]);if(type!=='旁白'){assert.equal(b.w,b.h);assert.equal(bubbleLayout(ctx,b).overflow,false);}else assert.equal(b.shape,'rounded-rect');
  b.w=500;b.h=120;const before=structuredClone(b);applyProductionFrameLettering(p,frame,episode,'S1',texts,{automatic:true});assert.deepEqual(b,before,'已有人工排版不可改写');
 }
 const p=createProject('合成空泡'),frame=p.pages[0].panels[0];p.pages[0].bubbles=[];frame.generation={promptSource:'imported'};applyProductionFrameLettering(p,frame,{anchors:{}},'S',[{'文字ID':'T','文本':samples[2],'类型':'对白'}]);assert.equal(p.pages[0].bubbles[0].shape,'none');
});
