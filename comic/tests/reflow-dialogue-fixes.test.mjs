import test from 'node:test';
import assert from 'node:assert/strict';
import {generationPromptChoices,generationPromptSelection} from '../public/prompt-source.js';
import {speakerOrder} from '../public/bubble-speaker.js';
import {bubbleTextBox,normalizeBubbleStyle,svgBubbleSelectionMarkup} from '../public/lettering.js';
import {mergeReflowIntoOriginal} from '../public/auto-layout-reflow.mjs';

test('重排单格保留嵌套的带字和无泡原文，缺少空泡时不伪称空泡',()=>{
 const shot={id:'shot1',productionPromptVariants:1,sourceFields:{提示词:{带字:'带字原文',无泡:'无泡原文'}}},panel={shotId:'shot1',generation:{}},project={shots:[shot]};
 const list=generationPromptChoices(panel,project);assert.equal(list[0].text,'带字原文');assert.equal(list[0].label,'单格带字原文');assert.equal(list[1].text,'无泡原文');
 assert.equal(generationPromptSelection(panel,project).text,'带字原文');panel.generation.promptSource='post-lettering';assert.equal(generationPromptSelection(panel,project).text,'无泡原文');
});
test('说话顺序按当前屏段或整话逐句编号，重复说话有独立顺序',()=>{
 const project={productionPackage:{episodes:[{segments:[{id:'S1',localId:'段01'},{id:'S2',localId:'段02'}],texts:[{'段ID':'段01','文字ID':'a','说话人':'甲','类型':'对白','渲染':'工具'},{'段ID':'段01','文字ID':'b','说话人':'乙','类型':'对白','渲染':'工具'},{'段ID':'段02','文字ID':'c','说话人':'甲','类型':'对白','渲染':'工具'}]}]},pages:[]};
 const b={productionSegment:'S2',productionTextId:'c'};assert.equal(speakerOrder(project,b),1);assert.equal(speakerOrder(project,b,'episode'),3);assert.equal(speakerOrder(project,{...b,productionTextId:'missing'}),null);
});
test('默认文字框为居中横向区域，气泡内部拖动不再拦截整框拖动',()=>{
 const b={id:'b',productionTextId:'t1',type:'speech',shape:'oval',text:'测试台词',x:0,y:0,w:240,h:180,fontSize:30,visible:true};const box=bubbleTextBox(b,normalizeBubbleStyle(b));assert.ok(box.w>box.h);assert.ok(box.h>100);
 const context={measureText:t=>({width:t.length*20})};const markup=svgBubbleSelectionMarkup(context,b,{zoom:1});assert.match(markup,/pointer-events="none"/);assert.doesNotMatch(markup,/<rect data-bubble-handle="text-move"/);assert.match(markup,/<circle data-bubble-handle="text-move"/);
});
test('重排接回原工程且只替换目标话，其他话与原画板图层保留',()=>{
 const old={id:'old',name:'旧板',storyboard:{episode:1},panels:[{id:'root',visible:true}],bubbles:[{id:'text',visible:true}]},other={id:'other',name:'其他话',storyboard:{episode:2},panels:[{id:'other-panel',visible:true}],bubbles:[]};
 const original={id:'original',title:'原工程',revision:7,pages:[old,other],shots:[],gradients:[],layerOrder:['root','text','other-panel']};
 const derived={pages:[{id:'new',name:'新板',storyboard:{episode:1},panels:[{id:'root',visible:false,autoLayoutOriginalPageId:'old'},{id:'other-panel',visible:false,autoLayoutOriginalPageId:'other'},{id:'cut',visible:true}],bubbles:[{id:'text',visible:false,autoLayoutOriginalPageId:'old'}]}],shots:[],gradients:[],autoLayoutSource:{mode:'screen-crop-reflow',batchId:'batch'}};
 const before=structuredClone(original),merged=mergeReflowIntoOriginal(original,derived,1);assert.equal(merged.id,'original');assert.equal(merged.revision,7);assert.deepEqual(merged.pages[1],other);assert.deepEqual(merged.pages[0].panels.map(p=>p.id),['root','cut']);assert.equal(merged.pages[0].panels[0].visible,false);assert.equal(merged.episodeReflows[1].batchId,'batch');assert.deepEqual(original,before);
});
