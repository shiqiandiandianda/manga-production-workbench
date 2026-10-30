import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {balancedWrapRows,meaningfulLength,orphanLine} from '../public/balanced-text-wrap.js';
import {autoLettering,reflowProjectLettering} from '../public/auto-lettering.js';
import {bubbleLayout,wrapText,svgBubbleSelectionMarkup} from '../public/lettering.js';
import {applyBubbleMaterial} from '../public/bubble-material.js';
import {applyBubbleEdit} from '../public/bubble-editor.js';
import {setBubbleEditMode,tailControlPositions} from '../public/bubble-edit-mode.js';
const require=createRequire(import.meta.url),{createCanvas}=require(process.env.COMIC_TEST_CANVAS_MODULE),ctx=createCanvas(1,1).getContext('2d');
const sample='我哪里来的媳妇。朋友，这是我的好友薛冰！',measure={measureText:s=>({width:[...s].length*36})};
const bubble=(text=sample,extra={})=>({id:'test-bubble',type:'speech',productionTextId:'source-text',text,x:60,y:90,w:1160,h:74.24,fontSize:36,fontFamily:'source-han-sans',fontWeight:500,lineHeight:1.32,padding:28,shape:'oval',visible:true,tail:{visible:true,side:'bottom',base:.5},...extra});
test('用户示例在不同宽度下不留下一个字加标点或孤立标点，台词逐字保留',()=>{
 for(const text of [sample,'我哪里来的媳妇。\n朋友，这是我的好友薛\n冰！','你们不好好上班，摸鱼也不至于摸到千里之外吧？','好朋友。','不要落下任何一个字！'])for(const width of [108,144,180,216,252,288,324,360]){
  const rows=balancedWrapRows(measure,text,()=>width,{protectedWords:['薛冰']});assert.equal(rows.join(''),text.replaceAll('\n',''));if(rows.length>1)assert.ok(meaningfulLength(rows.at(-1))>=2,JSON.stringify({text,width,rows}));for(const row of rows)assert.doesNotMatch(row,/^[，。？！、：；！？」』]/u);
 }
});
test('公开换行接口也避免孤行；英文单词、数字与引号不被随意拆散',()=>{
 for(const width of [180,216,252,288]){const rows=wrapText(measure,sample,width);assert.equal(rows.join(''),sample);assert.ok(!orphanLine(rows.at(-1)));}
 const text='他说「OpenAI 2026」测试完成！',rows=balancedWrapRows(measure,text,()=>320);assert.equal(rows.join(''),text);assert.ok(rows.some(l=>l.includes('OpenAI')));assert.ok(rows.some(l=>l.includes('2026')));
});
test('长短对白先排字后包框，字号不变、框内居中、圆形款不被压成长条',()=>{
 for(const text of ['你媳妇？',sample,'好！','这一段很长的台词需要自动换行，而且末尾不能只剩一个汉字或者一个标点符号。'])for(const shape of ['oval','rounded-rect','cloud','asset']){
  let b=bubble(text,{shape});if(shape==='asset')b=applyBubbleMaterial(b,'builtin-oval');const r=autoLettering(ctx,b,{maxWidth:704,protectedWords:['薛冰']});assert.equal(r.status,'fitted',text+' '+shape);const fitted=r.bubble,layout=bubbleLayout(ctx,fitted);assert.equal(fitted.text,text);assert.equal(layout.fontSize,36);assert.equal(layout.overflow,false);assert.equal(layout.lines.map(l=>l.text).join(''),text);assert.ok(fitted.w<=704);assert.ok(fitted.w/fitted.h<2.2);if(layout.lines.length>1)assert.ok(meaningfulLength(layout.lines.at(-1).text)>=2);assert.ok(Math.abs(fitted.textBox.x+fitted.textBox.w/2-fitted.w/2)<.01);if(shape==='asset')assert.equal(fitted.w,fitted.h);
 }
});
test('单字整句合法；仅自动换行修复尾行，显式回车和源文字不被改写',()=>{
 const single=autoLettering(ctx,bubble('嗯。'));assert.equal(single.status,'fitted');assert.equal(single.rows.length,1);const explicit=autoLettering(ctx,bubble('我说\n别走',{lineBreakMode:'explicit'}));assert.deepEqual(explicit.rows,['我说','别走']);assert.equal(explicit.bubble.text,'我说\n别走');
});
test('旧自动长条默认可升级，手工位置、锁定内容与图片几何保留；重复执行无新改动',()=>{
 const b=bubble(),manual=bubble('人工宽框',{id:'manual',textBox:{x:20,y:10,w:500,h:70}}),locked=bubble('锁定',{id:'locked',locked:true});const p={pages:[{width:1280,panels:[{id:'frame',x:0,y:0,w:1280,h:1280,imageAssetId:'source'}],bubbles:[b,manual,locked]}]};for(const item of p.pages[0].bubbles)item.parentPanelId='frame';const before=structuredClone(p),first=reflowProjectLettering(ctx,p);assert.equal(first.changed,1);assert.deepEqual(p.pages[0].panels,before.pages[0].panels);assert.deepEqual(manual,before.pages[0].bubbles[1]);assert.deepEqual(locked,before.pages[0].bubbles[2]);assert.equal(reflowProjectLettering(ctx,p).changed,0);assert.ok(b.w/b.h<2);
});
test('双圆气泡两句各自排字，保留说话人和源ID，文字框互不覆盖',()=>{
 let b=applyBubbleMaterial(bubble('第一段台词\n\n'+sample),'builtin-double');b.dialogueSegments=[{id:'one',text:'第一段台词',speaker:'甲',sourceTextId:'a',textBox:{x:.3,y:.1,w:.4,h:.2}},{id:'two',text:sample,speaker:'乙',sourceTextId:'b',textBox:{x:.15,y:.45,w:.7,h:.4}}];const r=autoLettering(ctx,b,{maxWidth:1000});assert.equal(r.status,'fitted');assert.equal(r.bubble.dialogueSegments[1].speaker,'乙');assert.equal(r.bubble.dialogueSegments[1].sourceTextId,'b');const [a,c]=r.bubble.dialogueSegments.map(s=>s.independentBox);assert.ok(a.y+a.h<c.y);assert.equal(bubbleLayout(ctx,r.bubble).overflow,false);
});
test('竖排按列适配且保持字体和原文',()=>{const b=bubble('醉仙居客房',{type:'caption',shape:'rounded-rect',writingMode:'vertical'}),r=autoLettering(ctx,b,{maxWidth:500});assert.equal(r.status,'fitted');assert.equal(bubbleLayout(ctx,r.bubble).fontSize,36);assert.equal(bubbleLayout(ctx,r.bubble).lines.map(l=>l.text).join(''),b.text);});

test('外框、文字和尾巴直接同时编辑；控制点保持原位置',()=>{
 const b=autoLettering(ctx,bubble()).bubble,controls=mode=>{setBubbleEditMode(b.id,mode);return [...svgBubbleSelectionMarkup(ctx,b,{zoom:.25}).matchAll(/data-bubble-handle="([^"]+)"/g)].map(m=>m[1]);};
 for(const mode of ['body','text','tail'])for(const name of ['resize','text-move','text-resize','tail','tail-anchor','tail-width'])assert.ok(controls(mode).includes(name));
 const tail=bubbleLayout(ctx,b).tail;for(const zoom of [.1,.2711,.7919,1,2]){const points=tailControlPositions(tail,zoom);for(let i=0;i<points.length;i++)for(let j=i+1;j<points.length;j++)assert.ok(Math.hypot(points[i].shownX-points[j].shownX,points[i].shownY-points[j].shownY)*zoom>=29.99);for(const p of points){assert.equal(p.shownX-p.offsetX,p.x);assert.equal(p.shownY-p.offsetY,p.y);}}
});
test('手工移动与单独拉伸外框冻结自动排版，重新拖文字宽度后可以重新排字',()=>{
 const b=autoLettering(ctx,bubble()).bubble,rows=bubbleLayout(ctx,b).lines.map(l=>l.text),moved=applyBubbleEdit(b,{type:'text-move',dx:12,dy:16}),resized=applyBubbleEdit(b,{type:'resize',dx:50,dy:60});
 assert.equal(moved.autoLettering.mode,'manual');assert.equal(resized.autoLettering.mode,'manual');assert.deepEqual(bubbleLayout(ctx,moved).lines.map(l=>l.text),rows);assert.deepEqual(bubbleLayout(ctx,resized).lines.map(l=>l.text),rows);
 const narrow=autoLettering(ctx,moved,{textWidth:150});assert.equal(narrow.status,'fitted');assert.equal(narrow.bubble.autoLettering.mode,'auto');assert.equal(narrow.bubble.fontSize,b.fontSize);assert.ok(!orphanLine(narrow.rows.at(-1)));
});
test('初次测量前已手改的台词和坐标不被启动升级覆盖，明确重排才重新计算',()=>{
 const b=autoLettering(null,bubble()).bubble;b.productionAutoLettering={source:'post-lettering',snapshot:JSON.stringify(b)};b.x=177;b.text='保留手改台词';const p={pages:[{width:1280,panels:[],bubbles:[b]}]},before=structuredClone(b);
 assert.equal(reflowProjectLettering(ctx,p).changed,0);assert.deepEqual(b,before);assert.equal(reflowProjectLettering(ctx,p,{force:true}).changed,1);assert.equal(b.text,before.text);assert.equal(b.autoLettering.measurement,'canvas');
});
