import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject,makePage,layoutLongStrip,clone,rescalePageWidth} from '../public/model.js';
import {selectionPage,localPagePoint,bubbleFieldChange} from '../public/editor-state.js';
import {bubbleInspectorMarkup} from '../public/editor-ui.js';
import {normalizeBubbleStyle,svgBubbleSelectionMarkup,bubbleLayout} from '../public/lettering.js';
import {validateProject} from '../lib/store.mjs';
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
const measurement={measureText:text=>({width:[...text].length*14})};

test('连续画布选择保存页面身份，拖动跨边界仍采用原页局部坐标',()=>{
  const first=makePage([],'stack',724,2172),second=makePage([],'stack',1280,90000),project={pages:[first,second]};
  second.bubbles.push({id:'target',x:120,y:200});const selection={type:'bubble',id:'target',pageId:second.id},layout=layoutLongStrip(project.pages);
  assert.equal(selectionPage(project,selection,first.id),second);
  assert.equal(selectionPage(project,{type:'bubble',id:'target'},first.id),second);
  assert.deepEqual(localPagePoint(layout,second.id,{x:120,y:4040}),{x:120,y:200});
  assert.deepEqual(localPagePoint(layout,second.id,{x:120,y:3000}),{x:120,y:-840});
  const old=localPagePoint(layout,first.id,{x:640,y:1920});near(old.x,362);near(old.y,1086);
  assert.equal(localPagePoint(layout,'removed',{x:1,y:1}),null);
});

test('属性字段按类型更新，样式、独立文字框和尾尖可保存且不改写原层',()=>{
  const project=createProject('UI 属性验证',true),bubble=project.pages[0].bubbles[0],original=clone(bubble);
  const fields={shape:'cloud',fontFamily:'source-han-serif',fontWeight:700,outlineWidth:6,outlineColor:'#112233',fillColor:'#ddeeff',fillOpacity:.5,textColor:'#334455',lineHeight:1.6,letterSpacing:2,textAlign:'left',padding:18,overflow:'visible'};
  let next=bubble;for(const [key,value] of Object.entries(fields))next=bubbleFieldChange(next,'bubble',key,value);
  next=bubbleFieldChange(next,'bubble-textbox','x',25);next=bubbleFieldChange(next,'bubble-textbox','w',180);
  next=bubbleFieldChange(next,'bubble-tail','visible',true);next=bubbleFieldChange(next,'bubble-tail','x',75);next=bubbleFieldChange(next,'bubble-tail','base',60);
  assert.equal(next.fontWeight,700);assert.equal(next.fontFamily,'source-han-serif');assert.equal(next.textBox.x,25);assert.equal(next.textBox.w,180);assert.equal(next.tail.x,.75);assert.equal(next.tail.base,.6);assert.equal(next.tail.mode,'normalized');
  assert.equal(next.id,bubble.id);assert.equal(next.shotId,bubble.shotId);assert.equal(next.text,bubble.text);assert.deepEqual(bubble,original);
  project.pages[0].bubbles[0]=next;assert.doesNotThrow(()=>validateProject(project));
});

test('尾尖属性兼容旧整页坐标，单独改气泡坐标同步绝对尾尖',()=>{
  const value={id:'keep',type:'speech',text:'保留',visible:true,x:17,y:23,w:240,h:100,fontSize:28,tail:{x:280,y:175}};
  const moved=bubbleFieldChange(value,'bubble','x',47);assert.deepEqual(moved.tail,{x:310,y:175});assert.equal(moved.y,23);
  const changed=bubbleFieldChange(value,'bubble-tail','side','left');near(changed.tail.x,(280-17)/240);near(changed.tail.y,(175-23)/100);assert.equal(changed.tail.side,'left');
  const hidden=bubbleFieldChange(value,'bubble-tail','visible',false);assert.equal(hidden.tail.visible,false);
});

test('非整数位置的轮廓节点属性正确更新，交叉节点更新被拒绝',()=>{
  const value={id:'keep',type:'speech',text:'保留',visible:true,x:123.456,y:78.9,w:234.567,h:120,fontSize:28,shape:'custom',points:[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}]};
  const changed=bubbleFieldChange(value,'bubble-node','x',12.5,0);near(changed.points[0].x,.125);
  assert.throws(()=>bubbleFieldChange({...value,points:[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}]},'bubble-node','y',100,0),/轮廓边线/);
  assert.equal(value.points[0].x,0);
});

test('属性面板列出实际样式字段，内容转义且页高没有30000限制',()=>{
  const project=createProject('界面验证',true),bubble={...project.pages[0].bubbles[0],shape:'custom',text:'<script>注入</script>😄'},escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const numberField=(label,key,value,section,min,max,step)=>`<label>${label}<input data-section="${section}" data-field="${key}" value="${value}" min="${min}" max="${max}" step="${step}"></label>`;
  const markup=bubbleInspectorMarkup(bubble,{escape,numberField,page:project.pages[0],layout:{overflow:true}});
  for(const key of ['shape','outlineWidth','outlineColor','fillColor','fillOpacity','fontFamily','fontSize','fontWeight','textColor','lineHeight','letterSpacing','textAlign','padding'])assert.ok(markup.includes(`data-field="${key}"`),key);
  assert.doesNotMatch(markup,/data-field="overflow"/);assert.match(markup,/填充不透明度 %/);
  for(const section of ['bubble-textbox','bubble-tail','bubble-node'])assert.ok(markup.includes(`data-section="${section}"`),section);
  assert.doesNotMatch(markup,/<script>/);assert.match(markup,/&lt;script&gt;/);assert.match(markup,/文字超出区域/);
});

test('明确724迁移后气泡外观与文字框仍满足保存校验，选中控件不重复绘制正文',()=>{
  const project=createProject('迁移验证',true),page=project.pages[0];rescalePageWidth(page,724);page.bubbles[0].outlineWidth=5;page.bubbles[0].fontFamily='source-han-serif';
  const original=clone(project);assert.equal(original.pages[0].width,724);rescalePageWidth(page,1280);assert.doesNotThrow(()=>validateProject(project));assert.equal(page.id,original.pages[0].id);assert.equal(page.bubbles[0].id,original.pages[0].bubbles[0].id);
  const markup=svgBubbleSelectionMarkup(measurement,page.bubbles[0],{zoom:.5});assert.match(markup,/data-bubble-handle="text-move"/);assert.doesNotMatch(markup,/<(?:text|tspan|ellipse|polygon)\b/);
  assert.equal(normalizeBubbleStyle(page.bubbles[0]).fontFamily,'source-han-serif');
});


test("expanded bubble inspector changes preserve the rendered tail tip",()=>{
  const value={id:"keep",type:"speech",text:"A synthetic multiline speech bubble checks the rendered tail position.",overflow:"expand",x:100,y:500,w:350,h:120,fontSize:46,tail:{mode:"absolute",x:300,y:460,side:"top",base:.5,visible:true}},original=clone(value),before=bubbleLayout(measurement,value);
  assert.equal(before.expanded,false);assert.equal(before.fontSize,46);assert.equal(before.w,value.w);assert.equal(before.h,value.h);
  for(const [key,fieldValue] of [["side","left"],["base",60],["visible",true]]){
    const changed=bubbleFieldChange(value,"bubble-tail",key,fieldValue,0,before),after=bubbleLayout(measurement,changed);
    near(after.tail.tip.x,before.tail.tip.x);near(after.tail.tip.y,before.tail.tip.y);
  }
  const changed=bubbleFieldChange(value,"bubble-tail","x",75,0,before),after=bubbleLayout(measurement,changed);
  near(after.tail.tip.x,before.w*.75);near(after.tail.tip.y,before.tail.tip.y);
  const normalized={...value,tail:{mode:"normalized",x:.4,y:1.2,side:"bottom",base:.5,visible:true}},layout=bubbleLayout(measurement,normalized),side=bubbleFieldChange(normalized,"bubble-tail","side","right",0,layout);
  near(side.tail.x,.4);near(side.tail.y,1.2);assert.deepEqual(value,original);
});

test("expanded bubble inspector percentages use the drawn dimensions",()=>{
  const bubble={type:"speech",text:"A synthetic multiline speech bubble checks the rendered tail position.",overflow:"expand",x:100,y:500,w:350,h:120,fontSize:46,tail:{mode:"absolute",x:300,y:460,side:"top",base:.5,visible:true}},layout=bubbleLayout(measurement,bubble),fields=[];
  bubbleInspectorMarkup(bubble,{escape:String,page:{width:1280},layout,numberField:(label,key,value,section)=>{fields.push({key,value,section});return "";}});
  near(fields.find(f=>f.section==="bubble-tail"&&f.key==="x").value,200/layout.w*100);
  near(fields.find(f=>f.section==="bubble-tail"&&f.key==="y").value,-40/layout.h*100);
});
