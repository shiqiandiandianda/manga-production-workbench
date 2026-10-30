import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createProject,rectangle} from '../public/model.js';
import {paintSceneRegion} from '../public/render.js';
import {renderSceneSvg} from '../public/scene-svg.js';
import {prepareStoryCrossfades} from '../public/story-crossfade.js';
const native=createRequire(import.meta.url)(process.env.COMIC_CANVAS_MODULE);
function fixture(){
 const p=createProject('编辑重叠渐变');p.pages[0].height=6000;p.pages[0].panels=[];p.pages[0].bubbles=[];
 p.gradients=[{id:'lower',x:0,y:3284,w:1280,h:2600,color:'#ead8c8',top:480,bottom:0},{id:'upper',x:0,y:0,w:1280,h:4184.07470703125,color:'#6d584e',top:0,bottom:480}].map(f=>({...f,points:rectangle(),visible:true,coverage:'area',border:0,feather:0,featherEdges:{top:f.top,bottom:f.bottom,left:0,right:0},storyCrossfade:{version:1,group:'story'},gradient:{enabled:true,mode:'color',opacity:1,startColor:f.color,endColor:f.color,start:{x:.5,y:0},end:{x:.5,y:1}}}));
 p.layerOrder=p.gradients.map(f=>f.id);return p;
}
test('拖长剧情底色产生大段非互补重叠时，整段像素不加亮、不闪白且不修改工程',async()=>{
 const p=fixture(),before=JSON.stringify(p),region={x:0,y:3200,w:20,h:1200},c=native.createCanvas(region.w,region.h);c.getContext('2d').translate(0,-region.y);
 await paintSceneRegion(c.getContext('2d'),p,{region,canvasFactory:()=>native.createCanvas(1,1)});
 for(let y=3201;y<4399;y++){const actual=[...c.getContext('2d').getImageData(10,y-region.y,1,1).data];for(let i=0;i<3;i++)assert.ok(actual[i]<=[234,216,200][i]+2,`y=${y}: ${actual}`);assert.equal(actual[3],255);}
 assert.equal(JSON.stringify(p),before);
 const svg=renderSceneSvg(p,{mode:'continuous',zoom:.25,currentPageId:p.pages[0].id,window:{startY:3200,endY:4400}},{assets:new Map(),measurement:native.createCanvas(1,1).getContext('2d'),escape:String,shotFor:()=>null});
 assert.doesNotMatch(svg.content,/plus-lighter/);assert.match(svg.defs,/fx_upper_story_gradient/);
});
test('重叠归一化保持图层身份和顺序，隐藏层及普通渐变不参与其他组',()=>{
 const p=fixture(),entries=p.gradients.map(f=>({type:'gradient',frame:f})),result=prepareStoryCrossfades(entries),before=JSON.stringify(entries);
 assert.deepEqual(result.map(e=>e.frame.id),['lower','upper']);assert.ok(result.every(e=>e.frame.storyFadeStops));assert.equal(JSON.stringify(entries),before);
 const normal={type:'gradient',frame:{...p.gradients[0],storyCrossfade:undefined}};assert.equal(prepareStoryCrossfades([normal])[0],normal);
 assert.equal(prepareStoryCrossfades([entries[1]])[0],entries[1]);
});
test('跨分段裁切和不同缩放下的重叠渐变像素保持一致',async()=>{
 const p=fixture(),region={x:400,y:3400,w:40,h:900},outputs=[];
 for(const scale of [.5,1,1.5]){const c=native.createCanvas(region.w*scale,region.h*scale),ctx=c.getContext('2d');ctx.scale(scale,scale);ctx.translate(-region.x,-region.y);await paintSceneRegion(ctx,p,{region,renderScale:scale,canvasFactory:()=>native.createCanvas(1,1)});outputs.push([80,200,500,700].map(y=>[...ctx.getImageData(10*scale,y*scale,1,1).data]));}
 for(const out of outputs)for(let i=0;i<out.length;i++)assert.ok(out[i].every((v,k)=>Math.abs(v-outputs[1][i][k])<=2),JSON.stringify(outputs));
});
