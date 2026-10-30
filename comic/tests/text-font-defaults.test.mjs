import test from 'node:test';
import assert from 'node:assert/strict';
import {TEXT_FONT_DEFAULTS as defaults,TEXT_FONT_DEFAULTS_VERSION} from '../public/text-font-defaults.js';
import {TYPOGRAPHY_DEFAULT,validateTypography,projectTypography} from '../public/unified-typography.js';
import {normalizeBubbleStyle} from '../public/lettering.js';
import {createProject} from '../public/model.js';
import {resolveProductionStyle} from '../public/production-lettering-style.js';
import {placementSettings} from '../public/manual-dialogue-placement.js';
const font=x=>Object.fromEntries(Object.keys(defaults).map(k=>[k,x[k]]));
test('统一字体、基础文字、演示工程和制作样式共用思源黑体36/500',()=>{
 assert.deepEqual(defaults,{fontFamily:'source-han-sans',fontSize:36,fontWeight:500});
 const p=createProject('默认字体',true);
 for(const value of [TYPOGRAPHY_DEFAULT,validateTypography({fontFamily:defaults.fontFamily}),normalizeBubbleStyle({type:'speech'}),normalizeBubbleStyle({type:'thought'}),p.pages[0].bubbles[0],resolveProductionStyle(p,'page:'+p.pages[0].id),placementSettings(p,p.pages[0])])assert.deepEqual(font(value),defaults);
 Object.assign(p.pages[0].bubbles[0],{fontFamily:'system-sans',fontSize:32,fontWeight:400});assert.deepEqual(font(projectTypography(p)),defaults);
 assert.equal(normalizeBubbleStyle({fontFamily:'system-sans',fontSize:32,fontWeight:400}).fontSize,32);
});
test('旧摆放设置升级默认值且保留外观；之后明确选择的字体仍可保存',()=>{
 const p=createProject('旧设置',true);p.manualDialogueSettings={fontFamily:'system-sans',fontSize:32,fontWeight:400,styleId:'none',columns:7};
 const before=structuredClone(p),settings=placementSettings(p,p.pages[0]);assert.deepEqual(font(settings),defaults);assert.equal(settings.styleId,'none');assert.equal(settings.columns,7);assert.equal(settings.fontDefaultsVersion,TEXT_FONT_DEFAULTS_VERSION);assert.deepEqual(p,before);
 p.manualDialogueSettings={...settings,fontSize:42,fontWeight:600};assert.equal(placementSettings(p,p.pages[0]).fontSize,42);assert.equal(placementSettings(p,p.pages[0]).fontWeight,600);
});
