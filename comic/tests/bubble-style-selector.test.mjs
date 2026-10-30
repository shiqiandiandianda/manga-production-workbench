import test from 'node:test';
import assert from 'node:assert/strict';
import {bubbleMaterials,applyBubbleMaterial} from '../public/bubble-material.js';
import {changeBubbleStyle,bubbleStyleSelectorMarkup} from '../public/bubble-style-selector.js';
import {bubbleLayout} from '../public/lettering.js';
import {createProject} from '../public/model.js';
import {validateProject} from '../lib/store.mjs';
import {addDialogueSegment} from '../public/bubble-dialogue-segments.js';
const context={measureText:text=>({width:[...text].length*25})};
const rows=b=>{const l=bubbleLayout(context,b);return {fontSize:l.fontSize,box:l.textBox,lines:l.lines.map(r=>({text:r.text,x:r.x,y:r.y,glyphs:r.glyphs}))};};
test('basic thumbnail images contain visible bubble contours',()=>{
 const html=bubbleStyleSelectorMarkup(createProject('缩略图',true).pages[0].bubbles[0]);
 const previews=[...html.matchAll(/src="data:image\/svg\+xml;charset=utf-8,([^"]+)"/g)].slice(0,5).map(m=>decodeURIComponent(m[1]));
 assert.equal(previews.length,5);assert.match(previews[0],/台词文字/);
 for(const svg of previews.slice(1)){assert.match(svg,/data-bubble="preview-/);assert.match(svg,/<(?:path|polygon|ellipse|rect)[^>]*stroke=/);assert.doesNotMatch(svg,/NaN/);}
});
test('changing every material preserves displaced text geometry, rows, typography and tail',()=>{
 const project=createProject('样式更换',true),b=project.pages[0].bubbles[0];
 Object.assign(b,{shape:'oval',w:420,h:210,text:'这是我的好友薛冰！\n换款后原位置不变。',fontSize:36,fontWeight:500,textBox:{x:-150,y:300,w:270,h:180},tail:{visible:true,mode:'normalized',x:.2,y:1.4,anchorT:.42,width:.15}});
 const before=structuredClone(b),layout=rows(b);
 for(const id of [...bubbleMaterials.map(s=>s.id),'shape:none','shape:oval','shape:rounded-rect']){
  const next=changeBubbleStyle(context,b,id);assert.deepEqual(rows(next),layout,id);
  for(const key of ['x','y','w','h','fontSize','fontWeight','text','tail'])assert.deepEqual(next[key],before[key],id+' '+key);
  project.pages[0].bubbles[0]=next;assert.doesNotThrow(()=>validateProject(project),id);
 }
 assert.deepEqual(b,before);
});
test('two independent dialogue segments survive a material change',()=>{
 const b=addDialogueSegment(applyBubbleMaterial({...createProject('双圆',true).pages[0].bubbles[0],text:'第一段文字'},'builtin-double'),'第二段文字');
 const before=bubbleLayout(context,b).dialogueLayouts.map(l=>l.lines.map(r=>[r.text,r.x,r.y]));
 const next=changeBubbleStyle(context,b,'builtin-cloud');
 assert.deepEqual(bubbleLayout(context,next).dialogueLayouts.map(l=>l.lines.map(r=>[r.text,r.x,r.y])),before);
});
