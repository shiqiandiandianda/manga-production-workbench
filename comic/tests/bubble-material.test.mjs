import test from 'node:test';
import assert from 'node:assert/strict';
import {applyBubbleMaterial,bubbleMaterials,restoreLegacyBubbleMaterialVisibility} from '../public/bubble-material.js';
import {BUILTIN_BUBBLE_STYLES} from '../public/builtin-bubble-data.js';
import {bubbleFieldChange} from '../public/editor-state.js';
import {validAssetContour} from '../public/comic-styles.js';
import {createProject} from '../public/model.js';
import {validateProject} from '../lib/store.mjs';
import {svgBubbleMarkup,bubbleShapePoints} from '../public/lettering.js';

const measurement={measureText:text=>({width:[...text].length*14})};
test('系统默认与54款气泡素材可保存，替换轮廓保留对白、原文出处、几何、字体、文字框与尾尖',()=>{
 const project=createProject('合成素材气泡',true),bubble=project.pages[0].bubbles[0];
 Object.assign(bubble,{shape:'custom',points:bubbleShapePoints('custom'),outlineWidth:6,fontFamily:'source-han-serif',textBox:{x:20,y:15,w:150,h:100},tail:{mode:'normalized',x:.8,y:1.3,side:'bottom',base:.6,visible:true}});
 const before=structuredClone(bubble);assert.equal(bubbleMaterials.length,54+BUILTIN_BUBBLE_STYLES.length);
 for(const material of bubbleMaterials){
  const next=applyBubbleMaterial(bubble,material.id);
  assert.equal(next.shape,'asset');assert.ok(validAssetContour(next.assetContour));assert.equal(next.comicStyleId,material.id);
  for(const key of ['id','shotId','parentPanelId','text','x','y','fontFamily','fontSize','points',...(!material.preset?['w','h','textBox']:[])])assert.deepEqual(next[key],before[key],key);if(material.preset){assert.equal(next.writingMode,'vertical');assert.ok(next.h>next.w*2);assert.equal(next.textBox,undefined);}
  assert.deepEqual(next.tail,material.tailPreset||before.tail);project.pages[0].bubbles[0]=next;assert.doesNotThrow(()=>validateProject(project));
 }
 assert.deepEqual(bubble,before);assert.throws(()=>applyBubbleMaterial(bubble,'missing'),/素材款式/);
});

test('切回每一种普通形状和无框清除旧素材纹理，恢复描边且保留自定义节点',()=>{
 const project=createProject('合成形状切换',true),bubble=project.pages[0].bubbles[0];
 Object.assign(bubble,{shape:'custom',points:bubbleShapePoints('custom'),outlineWidth:6});
 const textured=applyBubbleMaterial(bubble,bubbleMaterials.find(style=>style.texture).id);
 textured.styleTextureAssetId='asset_00000000-0000-0000-0000-000000000001';
 for(const shape of ['','oval','rounded-rect','cloud','burst','custom','none']){
  const next=bubbleFieldChange(textured,'bubble','shape',shape);
  assert.equal(next.shape,shape||undefined);assert.equal(next.outlineWidth,6);assert.deepEqual(next.points,bubble.points);
  for(const key of ['assetContour','assetInsets','comicStyleId','comicStyleLabel','styleTextureId','styleTextureAssetId','materialOutlineWidth'])assert.equal(next[key],undefined,key);
  assert.ok(!svgBubbleMarkup(measurement,next).includes('<image'));
  project.pages[0].bubbles[0]=next;assert.doesNotThrow(()=>validateProject(project));
 }
 assert.equal(textured.shape,'asset');assert.ok(textured.styleTextureId);
});

test('程序性选择素材轮廓不会产生缺少轮廓的无效中间状态，后选款式能替换原轮廓',()=>{
 const project=createProject('合成素材默认',true),bubble=project.pages[0].bubbles[0];
 for(const shape of ['oval','custom']){
  const prior={...bubble,shape},next=bubbleFieldChange(prior,'bubble','shape','asset');
  assert.equal(next.shape,'asset');assert.ok(validAssetContour(next.assetContour));assert.equal(prior.assetContour,undefined);
  const other=applyBubbleMaterial(next,'thin-14');assert.notDeepEqual(other.assetContour,next.assetContour);
  assert.equal(other.text,next.text);assert.deepEqual(other.tail,next.tail);
  project.pages[0].bubbles[0]=other;assert.doesNotThrow(()=>validateProject(project));
 }
});

test('无框排字切换素材及普通气泡恢复填充与轮廓，既有透明故障可修复且不改文字和位置',()=>{
 const source={...createProject('无框测试',true).pages[0].bubbles[0],shape:'none',fillOpacity:0,outlineWidth:0,materialOutlineWidth:0,text:'不打了！宋师兄，\n恐怖如斯啊！'},material=bubbleMaterials.find(s=>!s.texture),next=applyBubbleMaterial(source,material.id);assert.equal(next.fillOpacity,1);assert.equal(next.outlineWidth,2.8);assert.equal(next.materialOutlineWidth,2.8);assert.match(svgBubbleMarkup(measurement,next),/fill-opacity="1"/);assert.match(svgBubbleMarkup(measurement,next),/stroke-width="2.8"/);assert.equal(next.text,source.text);assert.equal(next.x,source.x);const legacy={...next,fillOpacity:0,outlineWidth:0,materialOutlineWidth:0};delete legacy.materialVisibilityVersion;assert.equal(restoreLegacyBubbleMaterialVisibility(legacy),true);assert.equal(legacy.fillOpacity,1);assert.equal(restoreLegacyBubbleMaterialVisibility(legacy),false);const intentional={...next,fillOpacity:0,outlineWidth:0,materialOutlineWidth:0};assert.equal(restoreLegacyBubbleMaterialVisibility(intentional),false);const oval=bubbleFieldChange(source,'bubble','shape','oval');assert.equal(oval.fillOpacity,1);assert.equal(oval.outlineWidth,2.8);
});
