import test from 'node:test';import assert from 'node:assert/strict';
import {taskGroups,taskSummary} from '../public/workbench-state.js';
import {panelInspectorMarkup} from '../public/inspector-ui.js';
import {bubbleInspectorMarkup} from '../public/editor-ui.js';
import {createProject} from '../public/model.js';
const escape=value=>String(value??'').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const numberField=(label,key,value,section,min,max)=>`<label>${label}<input type="number" data-section="${section}" data-field="${key}" value="${value}" min="${min}" max="${max}"></label>`;
test('任务摘要突出当前处理和费用确认，旧失败进入历史而不会永久霸占状态条',()=>{
 const jobs=[{id:'old',projectId:'p',panelId:'a',created:'2026-10-08',status:'failed'},{id:'new',projectId:'p',panelId:'a',created:'2026-10-09',status:'done'},{id:'approval',projectId:'p',panelId:'b',created:'2026-10-09',status:'awaiting_confirmation'},{id:'running',projectId:'p',panelId:'c',created:'2026-10-09',status:'running'},{id:'other',projectId:'q',panelId:'d',created:'2026-10-09',status:'failed'}];
 const groups=taskGroups(jobs,'p');assert.equal(groups.failed.length,0);assert.equal(groups.history.length,2);assert.equal(groups.active.length,2);assert.equal(taskSummary(groups),'生成中 1 · 待确认 1');
});
test('最新失败仍可见，可恢复任务不会伪装为完成，也不自动触发费用',()=>{
 const groups=taskGroups([{id:'a',projectId:'p',panelId:'a',created:'2026-10-09',status:'failed'},{id:'b',projectId:'p',panelId:'b',created:'2026-10-09',status:'recoverable'}],'p');
 assert.equal(groups.failed.length,1);assert.equal(groups.recovery,1);assert.match(taskSummary(groups),/失败 1/);assert.match(taskSummary(groups),/可恢复 1/);assert.equal(taskSummary(taskGroups([],'p')),'暂无进行中的任务');
});
test('格子属性四区只显示所选提示词，删除重复来源块，尺寸和节点仍可编辑且不改数据',()=>{
 const project=createProject(),item=project.pages[0].panels[0],before=structuredClone(item),html=panelInspectorMarkup(item,{project,escape,numberField,frameShapeUI:{shapeOptions:()=>'<label>画格形状</label>'},nodeIndex:0,pending:false,pageWidth:1280});
 assert.equal((html.match(/role="tab" /g)||[]).length,4);assert.equal((html.match(/data-section="panel" data-field="x"/g)||[]).length,1);assert.doesNotMatch(html,/来源镜头 · 仅追溯|panel-composition-status|selected-table-prompt/);assert.match(html,/id="generate-selected"/);assert.match(html,/id="point-select"/);assert.match(html,/data-field="proportionalResize"/);assert.deepEqual(item,before);
});
test('对白分为字体和气泡框，文字框尾尖及精确位置在更多中折叠，旧图层能继续编辑',()=>{
 const page=createProject().pages[0],bubble={id:'b',type:'speech',shape:'oval',x:40,y:80,w:320,h:140,text:'你好',fontSize:28,visible:true},before=structuredClone(bubble);
 const html=bubbleInspectorMarkup(bubble,{escape,numberField,page});
 const more=html.indexOf('data-bubble-inspector-pane="more"');assert.equal((html.match(/role="tab" /g)||[]).length,3);assert.ok(html.indexOf('data-field="fontFamily"')<more);assert.ok(html.indexOf('data-field="outlineWidth"')<more);assert.ok(html.indexOf('data-section="bubble-textbox"')>more);assert.ok(!html.includes('音效（旧工程）'));assert.deepEqual(bubble,before);
 const legacy=bubbleInspectorMarkup({...bubble,type:'sfx'},{escape,numberField,page});assert.ok(legacy.includes('音效文字'));assert.match(legacy,/value="sfx" selected/);
});
