import test from 'node:test';
import assert from 'node:assert/strict';
import {cleanPromptVariant} from '../public/clean-prompt-variant.js';
import {generationPromptSelection} from '../public/prompt-source.js';
const source='屏段编号：E041-S06\n整屏画布：1280×3760像素。\n画风：二维动漫。空框按工程指定位置和合并样式呈现，框内完全留白，禁止生成对白、心声、旁白及占位符；画内字和拟声仅按非空条目绘制。\n只绘指定空框，按同一张样式图取样。\n第14格〔E041-014〕：\n观察方向：从南朝北\n本格画面：角色甲骑马，百户在马前躬身行礼。\n01｜对白｜空框｜归属：百户；位置：上部。\n尾尖指向百户嘴部附近。\n容量：按36号字留2行。';
test('empty-frame variant converts without losing scene or camera and never masquerades as imported original',()=>{
 const clean=cleanPromptVariant(source);assert.match(clean,/不绘制气泡/);assert.match(clean,/本格画面：角色甲骑马，百户在马前躬身行礼。/);assert.match(clean,/观察方向：从南朝北/);assert.doesNotMatch(clean,/空框按工程|只绘指定空框|｜空框｜|尾尖指向|容量：/);
 const shot={id:'shot',productionSegment:'E041-S06',sourceFields:{生图提示词:source}},p={shots:[shot]},b={shotId:'shot',productionSegment:'E041-S06',generation:{promptSource:'post-lettering'}};
 assert.equal(generationPromptSelection(b,p).text,clean);assert.equal(generationPromptSelection(b,p).derived,true);
 b.generation.promptSource='imported';assert.equal(generationPromptSelection(b,p).text,source);
 shot.sourceFields['生图提示词（无泡）']='用户提供的无框原文';b.generation.promptSource='post-lettering';assert.equal(generationPromptSelection(b,p).text,'用户提供的无框原文');
 b.generation.promptOverrides={'post-lettering':'用户手动改的当前模式'};assert.equal(generationPromptSelection(b,p).text,'用户手动改的当前模式');
 assert.equal(cleanPromptVariant('普通原文，角色说看那个空框。'),'');
});
