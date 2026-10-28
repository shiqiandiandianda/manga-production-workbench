import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {DEFAULT_IMAGE_CONSTRAINTS,appendDefaultImageConstraints} from '../public/generation-constraints.js';
import {buildImagePrompt} from '../lib/codex.mjs';
import {buildJimengPrompt} from '../lib/jimeng.mjs';

test('默认约束放在两通道最终请求末尾，保留分镜原文、修改意见和参考资料',()=>{
 for(const action of ['generate','edit']){
  const input={action,shot:{productionPrompt:'第一行：原始分镜\n第二行：雨雪、飞溅与法术特效'},editPrompt:'只修改衣服颜色',panel:{w:1280,h:3840,points:[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}]},style:'二维国漫',referenceRoles:[],textAssetReferences:[{role:'character',name:'合成人物',description:'黑衣短发'}]};
  const before=structuredClone(input);
  for(const build of [buildImagePrompt,buildJimengPrompt]){
   const prompt=build(input);assert.ok(prompt.includes(input.shot.productionPrompt));assert.ok(prompt.includes('黑衣短发'));
   if(action==='edit')assert.ok(prompt.includes(input.editPrompt));
   assert.ok(prompt.endsWith(DEFAULT_IMAGE_CONSTRAINTS));assert.equal(prompt.split(DEFAULT_IMAGE_CONSTRAINTS).length,2);
   assert.equal(build(input),prompt);assert.equal(appendDefaultImageConstraints(prompt),prompt);
   assert.deepEqual(input,before);
  }
 }
});

test('默认约束完整保留用户四段正向正文和两段负面正文',()=>{
 assert.equal(DEFAULT_IMAGE_CONSTRAINTS.split('\n\n\n负面提示词\n').length,2);
 assert.equal(DEFAULT_IMAGE_CONSTRAINTS.split('\n\n\n负面提示词\n')[0].split('\n\n').length,4);
 assert.ok(DEFAULT_IMAGE_CONSTRAINTS.endsWith('头发区域出现无依据的细碎三角色块、三角面拼接、低多边形切面、碎片化明暗斑块，发束结构破碎、断裂或走向混乱。'));
 assert.equal(createHash('sha256').update(DEFAULT_IMAGE_CONSTRAINTS).digest('hex'),'d3fe09a4df1965c4d7f2db223a422055381773c6e6acfff7fbc624574e979e04');
});
