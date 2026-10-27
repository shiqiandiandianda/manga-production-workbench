import test from 'node:test';
import assert from 'node:assert/strict';
import {REFERENCE_BUBBLE_STYLES} from '../../public/reference-bubble-data.js';
import {REFERENCE_BUBBLE_UPDATES} from '../../public/reference-bubble-updates.js';
import {REFERENCE_THOUGHT_BUBBLES} from '../../public/reference-thought-bubble-data.js';
import {VERTICAL_LABEL_FRAMES} from '../../public/vertical-label-frame-data.js';

test('样式几何保留，公开样式元数据不暴露个人临时截图路径',()=>{
 const groups=[REFERENCE_BUBBLE_STYLES,REFERENCE_BUBBLE_UPDATES,REFERENCE_THOUGHT_BUBBLES,VERTICAL_LABEL_FRAMES];
 assert.ok(groups.every(group=>group.length>0));
 for(const style of groups.flat()){
  assert.ok(style.id&&style.label&&Array.isArray(style.contour)&&style.contour.length>=3);
  assert.equal(Object.hasOwn(style,'sourceReference'),false);
  assert.doesNotMatch(JSON.stringify(style),/[A-Z]:[\\/]+Users[\\/]+[^\\/]+[\\/]+AppData[\\/]+Local[\\/]+Temp/i);
 }
 assert.equal(VERTICAL_LABEL_FRAMES.filter(style=>style.id.startsWith('ref23-person-')).length,5);
 assert.equal(VERTICAL_LABEL_FRAMES.filter(style=>style.id.startsWith('ref23-location-')).length,5);
});
