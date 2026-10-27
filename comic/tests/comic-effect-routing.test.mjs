import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
import {createProject,id,clone} from '../public/model.js';
import {createComicEffectRouting} from '../public/comic-effect-routing.js';
import {allLayers,orderedLayers,sceneLayers} from '../public/layers.js';
import {applyEffectVisual,normalizeSfxWord} from '../public/comic-styles.js';
import {paintSceneRegion,pageCanvas} from '../public/render.js';
import {renderSceneSvg} from '../public/scene-svg.js';
const require=createRequire(import.meta.url),canvas=require(process.env.COMIC_TEST_CANVAS_MODULE);
const bubble=(parentPanelId,{text='踏',name='踏 · 字效',auto='impact',type='sfx'}={})=>({id:id('bubble'),parentPanelId,text,name,type,sfxAuto:auto,visible:true});
function basic(){const panel={id:id('panel'),imageAssetId:id('asset')};return {panel,word:bubble(panel.id),atmosphere:bubble(panel.id,{auto:'atmosphere',text:'',name:'集中线 · 氛围'})};}
const snapshot=(panel,effectsMode,effectsWords=[])=>panel.imageEffects={imageAssetId:panel.imageAssetId,artDirection:{effectsMode,effectsWords}};

test('仅与当前回填图片匹配的快照去重；缺快照、待生成选项、换图和清图均恢复外部自动层',()=>{
 const f=basic();f.panel.artDirection={effectsMode:'integrated',effectsWords:['踏']};assert.equal(createComicEffectRouting([f.panel]).shouldRender(f.word),true);snapshot(f.panel,'integrated',['踏']);assert.equal(createComicEffectRouting([f.panel]).shouldRender(f.word),false);const before=clone(f);createComicEffectRouting([f.panel]).suppression(f.word);assert.deepEqual(f,before);f.panel.imageAssetId=id('asset');assert.equal(createComicEffectRouting([f.panel]).shouldRender(f.word),true);f.panel.imageAssetId=null;assert.equal(createComicEffectRouting([f.panel]).shouldRender(f.atmosphere),true);
});
test('图内氛围只隐藏自动氛围，不隐藏自动字效、手工氛围、其他父格或对白',()=>{
 const f=basic();snapshot(f.panel,'atmosphere');const route=createComicEffectRouting([f.panel]);assert.equal(route.shouldRender(f.atmosphere),false);assert.equal(route.shouldRender(f.word),true);assert.equal(route.shouldRender({...f.atmosphere,sfxAuto:undefined}),true);assert.equal(route.shouldRender({...f.atmosphere,parentPanelId:id('panel')}),true);for(const type of ['speech','thought','caption','system','label'])assert.equal(route.shouldRender({...f.atmosphere,type}),true);
});
test('图内拟声只匹配明确批准的词，手工同字层与未批准字仍保留',()=>{
 const f=basic();snapshot(f.panel,'integrated',[' 踏！ ']);const route=createComicEffectRouting([f.panel]);assert.equal(route.shouldRender(f.word),false);assert.equal(route.shouldRender(f.atmosphere),false);assert.equal(route.shouldRender({...f.word,sfxAuto:undefined}),true);assert.equal(route.shouldRender({...f.word,text:'啪',name:'啪 · 字效'}),true);assert.equal(route.shouldRender({...f.word,parentPanelId:undefined}),true);assert.equal(route.shouldRender({...f.word,type:'speech'}),true);
});
test('自动拆字保留完整源词语义，批准整串时才抑制相同拆字组，不按子串吞掉其他组',()=>{
 const f=basic(),whole='嗡嗡嗡',parts=Array(3).fill(0).map(()=>bubble(f.panel.id,{text:'嗡',name:whole+' · 字效',auto:'ambient'}));snapshot(f.panel,'integrated',[whole]);const route=createComicEffectRouting([f.panel]);assert.ok(parts.every(p=>!route.shouldRender(p)));assert.equal(route.shouldRender(bubble(f.panel.id,{text:'嗡',name:'嗡嗡 · 字效',auto:'ambient'})),true);
 snapshot(f.panel,'integrated',['嗡']);assert.ok(parts.every(p=>createComicEffectRouting([f.panel]).shouldRender(p)));assert.equal(createComicEffectRouting([f.panel]).shouldRender(bubble(f.panel.id,{text:'嗡',name:'嗡 · 字效',auto:'ambient'})),false);
});
test('手动改过字样的自动层不因旧源词或旧PNG匹配而被误抑制',()=>{
 const f=basic();snapshot(f.panel,'integrated',['踏','啪']);const route=createComicEffectRouting([f.panel]);assert.equal(route.shouldRender({...f.word,text:'啪',visualWord:'踏'}),true);assert.equal(route.shouldRender({...f.word,text:'啪'}),true);assert.equal(route.shouldRender({...f.word,name:'',text:'啪'}),false);assert.equal(route.shouldRender({...f.atmosphere,text:'改成文字',visualWord:''}),true);
});
test('外部快照恢复全部自动层；未来设计选项改变不改已有图片的去重事实',()=>{
 const f=basic();snapshot(f.panel,'integrated',['踏']);f.panel.artDirection={effectsMode:'external'};assert.equal(createComicEffectRouting([f.panel]).shouldRender(f.word),false);snapshot(f.panel,'external',['踏']);f.panel.artDirection={effectsMode:'integrated',effectsWords:['踏']};assert.equal(createComicEffectRouting([f.panel]).shouldRender(f.word),true);assert.equal(createComicEffectRouting([f.panel]).shouldRender(f.atmosphere),true);
});
test('无效快照与破框前景/SFX独立图片不影响普通自动层',()=>{
 const f=basic();snapshot(f.panel,'integrated',['踏']);f.panel.imageEffects.artDirection.effectsWords=[123];assert.equal(createComicEffectRouting([f.panel]).shouldRender(f.word),true);snapshot(f.panel,'integrated',['踏']);f.panel.breakoutForeground={backgroundPanelId:id('panel')};assert.equal(createComicEffectRouting([f.panel]).shouldRender(f.word),true);delete f.panel.breakoutForeground;f.panel.sfxImage=true;assert.equal(createComicEffectRouting([f.panel]).shouldRender(f.word),true);
});
test('渲染层过滤不改visible、图层顺序或编辑器记录；改变路由可完整恢复',()=>{
 const p=createProject('合成特效去重'),page=p.pages[0],frame=page.panels[0],word=bubble(frame.id),atmosphere=bubble(frame.id,{auto:'atmosphere',text:''});frame.imageAssetId=id('asset');snapshot(frame,'integrated',['踏']);page.bubbles=[word,atmosphere];p.layerOrder=[frame.id,word.id,atmosphere.id];const before=clone(p);assert.equal(sceneLayers(p).length,1);assert.equal(orderedLayers(p).length,3);assert.equal(allLayers(p).length,3);assert.deepEqual(p,before);snapshot(frame,'external');assert.equal(sceneLayers(p).length,3);assert.equal(word.visible,true);assert.equal(atmosphere.visible,true);
});
function image(color,size=200){const c=canvas.createCanvas(size,size);c.getContext('2d').fillStyle=color;c.getContext('2d').fillRect(0,0,size,size);c.naturalWidth=c.width;c.naturalHeight=c.height;return c;}
function renderingFixture(){
 const p=createProject('合成SVG与Canvas去重'),page=p.pages[0],f=page.panels[0];page.height=300;const bg=id('asset'),autoWordAsset=id('asset'),atmosAsset=id('asset'),manualAsset=id('asset');Object.assign(f,{x:20,y:20,w:200,h:200,imageAssetId:bg,imageTransform:{x:0,y:0,scale:1},border:0,feather:0});
 const make=(asset,text,name,x,y,auto)=>applyEffectVisual({id:id('bubble'),parentPanelId:f.id,text,name,x,y,w:40,h:40,fontSize:48,visible:true,locked:false,...(auto?{sfxAuto:auto}:{})},{id:'synthetic-'+asset,assetId:asset,word:text,width:40,height:40,label:name});
 const word=make(autoWordAsset,'踏','踏 · 字效',40,40,'impact'),atmos=make(atmosAsset,'','集中线 · 氛围',140,40,'atmosphere'),manual=make(manualAsset,'踏','手工字效',100,100);page.bubbles=[word,atmos,manual];p.layerOrder=[f.id,word.id,atmos.id,manual.id];snapshot(f,'integrated',['踏']);
 const images=new Map([[bg,image('#123456')],[autoWordAsset,image('#ff0000',40)],[atmosAsset,image('#ffff00',40)],[manualAsset,image('#00ff00',40)]]),assets=new Map([...images].map(([key,value])=>[key,{id:key,width:value.width,height:value.height}]));return {p,page,f,word,atmos,manual,assets,imageLoader:async key=>{assert.ok(images.has(key),'synthetic image exists '+key);return images.get(key);}};
}
const rgb=(ctx,x,y)=>[...ctx.getImageData(x,y,1,1).data].slice(0,3);
test('SVG预览不画重复自动特效，手工层仍画；Canvas整话与单页导出像素一致',async()=>{
 const r=renderingFixture(),before=clone(r.p),ctx=canvas.createCanvas(1280,300).getContext('2d');await paintSceneRegion(ctx,r.p,{region:{x:0,y:0,w:1280,h:300},imageLoader:r.imageLoader,canvasFactory:()=>canvas.createCanvas(1,1)});const page=await pageCanvas(r.page,{imageLoader:r.imageLoader,canvasFactory:()=>canvas.createCanvas(1,1)}),single=page.getContext('2d');for(const c of [ctx,single]){assert.deepEqual(rgb(c,50,50),[18,52,86]);assert.deepEqual(rgb(c,150,50),[18,52,86]);assert.deepEqual(rgb(c,110,110),[0,255,0]);}
 const svg=renderSceneSvg(r.p,{mode:'continuous',currentPageId:r.page.id,zoom:1,window:{startY:0,endY:300}},{assets:r.assets,measurement:ctx,selection:null,selectionIds:new Set(),tool:'move',brush:{size:20},escape:String,shotFor:()=>null,activeJob:()=>null});assert.ok(!svg.content.includes('data-bubble="'+r.word.id+'"'));assert.ok(!svg.content.includes('data-bubble="'+r.atmos.id+'"'));assert.ok(svg.content.includes('data-bubble="'+r.manual.id+'"'));assert.deepEqual(r.p,before);
});
test('外部快照或更换图后，SVG与两个Canvas入口都恢复自动字效和氛围',async()=>{
 const r=renderingFixture();snapshot(r.f,'external');const ctx=canvas.createCanvas(1280,300).getContext('2d');await paintSceneRegion(ctx,r.p,{region:{x:0,y:0,w:1280,h:300},imageLoader:r.imageLoader,canvasFactory:()=>canvas.createCanvas(1,1)});const page=await pageCanvas(r.page,{imageLoader:r.imageLoader,canvasFactory:()=>canvas.createCanvas(1,1)});for(const c of [ctx,page.getContext('2d')]){assert.deepEqual(rgb(c,50,50),[255,0,0]);assert.deepEqual(rgb(c,150,50),[255,255,0]);}
 const svg=renderSceneSvg(r.p,{mode:'continuous',currentPageId:r.page.id,zoom:1,window:{startY:0,endY:300}},{assets:r.assets,measurement:ctx,selection:null,selectionIds:new Set(),tool:'move',brush:{size:20},escape:String,shotFor:()=>null,activeJob:()=>null});assert.ok(svg.content.includes('data-bubble="'+r.word.id+'"'));assert.ok(svg.content.includes('data-bubble="'+r.atmos.id+'"'));
});
