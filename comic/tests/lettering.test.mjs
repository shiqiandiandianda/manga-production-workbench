import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject} from '../public/model.js';
import {validateProject,uid} from '../lib/store.mjs';
import {BUBBLE_TYPES,BUBBLE_SHAPES,bubbleLayout,thoughtOutlinePoints,paintBubble,svgBubbleMarkup} from '../public/lettering.js';
import {paintPage,wrapText} from '../public/render.js';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createStudio} from '../server.mjs';

const bubble=(type='speech',extra={})=>({id:uid('bubble'),type,text:'第一行\n第二行',x:17,y:23,w:240,h:100,fontSize:28,visible:true,...extra});
function contextSpy(){
  const calls=[],stack=[],fields=['font','fillStyle','strokeStyle','lineWidth','textAlign','textBaseline','lineJoin','globalAlpha'];
  const context={calls,measureText(text){return {width:[...text].length*(Number(/([\d.]+)px/.exec(this.font)?.[1])||28)/2};}};
  for(const method of ['translate','beginPath','ellipse','moveTo','lineTo','closePath','fill','stroke','fillRect','strokeRect','rect','clip','fillText','strokeText']){
    context[method]=(...args)=>calls.push({method,args,...Object.fromEntries(fields.map(field=>[field,context[field]]))});
  }
  context.save=()=>stack.push(Object.fromEntries(fields.map(field=>[field,context[field]])));
  context.restore=()=>Object.assign(context,stack.pop());
  return context;
}
const calls=(context,method)=>context.calls.filter(call=>call.method===method);
function projectWith(value){const project=createProject('文字测试',true);project.pages[0].bubbles=[value];return project;}
function attributes(markup,tag){
  return [...markup.matchAll(new RegExp('<'+tag+'\\b([^>]*)>','g'))].map(match=>Object.fromEntries([...match[1].matchAll(/([\w-]+)="([^"]*)"/g)].map(attribute=>[attribute[1],attribute[2]])));
}

test('旧三类工程无需新增字段，六类文字均通过保存校验且不改写原工程',()=>{
  const old=createProject('旧工程',true),before=structuredClone(old);
  assert.equal(validateProject(old),old);assert.deepEqual(old,before);
  for(const type of BUBBLE_TYPES){
    const value=bubble(type),project=projectWith(value),snapshot=structuredClone(project);
    assert.equal(validateProject(project),project);assert.deepEqual(project,snapshot);
  }
  assert.doesNotThrow(()=>validateProject(projectWith(bubble('label',{textColor:'#D9BC68'}))));
  for(const textColor of ['gold','#abc','" onload="alert(1)',null])assert.throws(()=>validateProject(projectWith(bubble('label',{textColor}))),/对白图层无效/);
  assert.throws(()=>validateProject(projectWith(bubble('unknown'))),/对白图层无效/);
});

test('新增类型保留坐标、最大尺寸、字号与文本长度限制',()=>{
  const project=projectWith(bubble('system')),page=project.pages[0];
  const invalid={x:page.width*2+1,y:Number.MAX_SAFE_INTEGER+1,w:page.width*2+1,h:Number.MAX_SAFE_INTEGER+1,fontSize:2049,text:'字'.repeat(4001)};
  for(const [field,value] of Object.entries(invalid)){
    const copy=structuredClone(project);copy.pages[0].bubbles[0][field]=value;
    assert.throws(()=>validateProject(copy),/对白图层无效/,field);
  }
  assert.doesNotThrow(()=>validateProject(projectWith(bubble('sfx',{w:30,h:20,fontSize:160}))));
});

test('心声轮廓为框内细放射闭合白底，没有椭圆、尾巴或点，Canvas与SVG坐标相同',()=>{
  const points=thoughtOutlinePoints();
  assert.deepEqual(points,thoughtOutlinePoints());assert.equal(points.length,80);
  for(let index=0;index<points.length;index++){
    const point=points[index];assert.ok(Number.isFinite(point.x)&&Number.isFinite(point.y));
    assert.ok(point.x>=0&&point.x<=1&&point.y>=0&&point.y<=1);
    const radius=Math.hypot((point.x-.5)*2,(point.y-.5)*2);
    assert.ok(index%2?radius<.95:radius>.99);
  }
  const value=bubble('thought'),context=contextSpy();paintBubble(context,value);
  assert.equal(calls(context,'ellipse').length,0);assert.equal(calls(context,'moveTo').length,1);
  assert.equal(calls(context,'lineTo').length,79);assert.equal(calls(context,'closePath').length,1);
  assert.equal(calls(context,'fill')[0].fillStyle,'#ffffff');assert.ok(calls(context,'stroke')[0].lineWidth<2);
  const markup=svgBubbleMarkup(contextSpy(),value);assert.doesNotMatch(markup,/<(?:ellipse|circle|path)\b/);
  const polygon=attributes(markup,'polygon')[0];assert.equal(polygon.fill,'#ffffff');
  const svgPoints=polygon.points.split(' ').map(pair=>pair.split(',').map(Number));
  assert.deepEqual(svgPoints,[...calls(context,'moveTo'),...calls(context,'lineTo')].map(call=>call.args));
});

test('旧对白保持椭圆与尾巴、旧旁白保持白底矩形，隐藏图层不绘制',()=>{
  const speech=contextSpy();paintBubble(speech,bubble('speech'));
  assert.equal(calls(speech,'ellipse').length,1);assert.equal(calls(speech,'lineTo').length,2);
  assert.ok(calls(speech,'lineTo').some(call=>call.args[1]===130));
  const caption=contextSpy();paintBubble(caption,bubble('caption'));
  assert.equal(calls(caption,'fillRect').length,1);assert.equal(calls(caption,'fillRect')[0].fillStyle,'#ffffff');
  assert.equal(calls(caption,'ellipse').length,0);
  const hidden=contextSpy(),value=bubble('system',{visible:false});paintBubble(hidden,value);
  assert.equal(hidden.calls.length,0);assert.equal(svgBubbleMarkup(hidden,value),'');
});

test('音效与画内字无可见底框但可选中；音效默认黑字白描边且可独立改色且字号与加粗斜体用于测量和绘制',()=>{
  for(const type of ['sfx','label']){
    const value=bubble(type,{fontSize:46,text:'轰！',textColor:'#e8c564'}),context=contextSpy();
    paintBubble(context,value);
    for(const method of ['fillRect','strokeRect','fill','stroke','ellipse'])assert.equal(calls(context,method).length,0,method);
    const markup=svgBubbleMarkup(contextSpy(),value,{selected:true,zoom:.4});
    const rects=attributes(markup,'rect');assert.ok(rects.some(rect=>rect.fill==='transparent'&&rect['pointer-events']==='all'));
    assert.ok(rects.some(rect=>rect.stroke==='#48a4ef'||rect.stroke==='#1789db'));assert.doesNotMatch(markup,/<(?:ellipse|polygon|path)\b/);
    const text=calls(context,'fillText')[0];
    if(type==='sfx'){
      assert.equal(text.fillStyle,'#e8c564');assert.match(text.font,/italic 700 46px/);
      assert.equal(calls(context,'strokeText')[0].strokeStyle,'#ffffff');
      assert.equal(calls(context,'strokeText')[0].font,text.font);
      assert.ok(context.calls.findIndex(call=>call.method==='strokeText')<context.calls.findIndex(call=>call.method==='fillText'));
      const svgText=attributes(markup,'text')[0];assert.equal(svgText['font-weight'],'700');assert.equal(svgText['font-style'],'italic');assert.equal(svgText['paint-order'],'stroke fill');
    }else{assert.equal(text.fillStyle,'#e8c564');assert.equal(calls(context,'strokeText').length,0);}
  }
});

test('系统文字只有给定内容，半透明黑底、金外框、红内框与金字一致',()=>{
  const value=bubble('system',{text:'轻身功夫：螺旋九影'}),context=contextSpy();paintBubble(context,value);
  assert.equal(calls(context,'fillRect')[0].fillStyle,'#000000');assert.equal(calls(context,'fillRect')[0].globalAlpha,.78);
  assert.deepEqual(calls(context,'strokeRect').map(call=>call.strokeStyle),['#e8c564','#9a3333']);
  assert.equal(calls(context,'fillText')[0].fillStyle,'#f4d77a');
  const markup=svgBubbleMarkup(contextSpy(),value),rects=attributes(markup,'rect').filter(rect=>rect.fill!=='transparent');
  assert.equal(rects[0]['fill-opacity'],'0.78');assert.equal(rects[0].stroke,'#e8c564');assert.equal(rects[1].stroke,'#9a3333');
  assert.equal(attributes(markup,'tspan').length,1);assert.match(markup,/>轻身功夫：螺旋九影<\/tspan>/);assert.doesNotMatch(markup,/系统提示/);
});

test('六类多行排版的坐标与字号一致，全文适配且特殊文本不生成非法SVG',()=>{
  for(const type of BUBBLE_TYPES)for(const size of [{w:240,h:100},{w:30,h:20}]){
    const value=bubble(type,{...size,text:'<>&"\n\n二三四',textColor:'" onload="evil()'}),context=contextSpy();paintBubble(context,value);
    const markup=svgBubbleMarkup(contextSpy(),value),clip=attributes(markup,'svg')[0],text=attributes(markup,'text')[0];
    assert.equal(calls(context,'clip').length,0);assert.equal(clip.overflow,'visible');
    assert.ok(Number(clip.width)>=0&&Number(clip.height)>=0);assert.equal(Number(text['font-size']),bubbleLayout(contextSpy(),value).fontSize);
    const spans=attributes(markup,'tspan'),canvasLines=calls(context,'fillText');
    assert.equal(spans.length,canvasLines.length);
    spans.forEach((span,index)=>{
      assert.equal(Number(span.x)+Number(clip.x),canvasLines[index].args[1]);
      assert.equal(Number(span.y)+Number(clip.y),canvasLines[index].args[2]);
    });
    assert.doesNotMatch(markup,/NaN|Infinity|onload|evil\(\)/);assert.match(markup,/&lt;/);
  }
  assert.deepEqual(wrapText(contextSpy(),'甲\n\n乙',100),['甲','','乙']);
});

test('整页导出真实调用共享文字绘制，并保留页面底色与坐标偏移',async()=>{
  const context=contextSpy(),value=bubble('system',{text:'轻身功夫：螺旋九影'});
  await paintPage(context,{width:800,height:1200,background:'#eeeeee',panels:[],bubbles:[value]},{offsetY:300});
  assert.equal(calls(context,'fillRect')[0].fillStyle,'#eeeeee');
  assert.deepEqual(calls(context,'translate').map(call=>call.args),[[0,300],[value.x,value.y]]);
  assert.equal(calls(context,'fillText')[0].args[0],value.text);
});

test('旧对白可保存，新六类型与可选颜色经过HTTP工程导出和重新导入后保留',async t=>{
  const testRoot=fileURLToPath(new URL('../.runtime/temp/',import.meta.url));
  fs.mkdirSync(testRoot,{recursive:true});
  const directory=fs.mkdtempSync(testRoot+'lettering-roundtrip-');
  const studio=createStudio({dataDir:directory,seedReference:false,bridge:{
    status:async()=>({connected:false,imageFeature:true}),close(){}
  }});
  studio.store.db.projects.push(createProject('文字回归样本',true));studio.store.save();
  t.after(async()=>{
    const closed=studio.server.listening?new Promise(resolve=>studio.server.once('close',resolve)):Promise.resolve();
    await studio.close();await closed;
    assert.ok(directory.startsWith(testRoot+'lettering-roundtrip-'));
    fs.rmSync(directory,{recursive:true,force:true});
  });
  await new Promise(resolve=>studio.server.listen(0,'127.0.0.1',resolve));
  const url='http://127.0.0.1:'+studio.server.address().port;
  async function request(route,method='GET',data){
    const response=await fetch(url+route,{method,headers:data?{'Content-Type':'application/json'}:undefined,body:data?JSON.stringify(data):undefined});
    return {status:response.status,data:await response.json()};
  }
  const state=(await request('/api/state')).data,legacy=state.projects[0];
  const oldBubbles=structuredClone(legacy.pages[0].bubbles);
  const oldSaved=await request('/api/projects/'+legacy.id,'PUT',legacy);
  assert.equal(oldSaved.status,200);assert.deepEqual(oldSaved.data.pages[0].bubbles,oldBubbles);
  const modern=oldSaved.data;
  modern.pages[0].bubbles=BUBBLE_TYPES.map(type=>bubble(type,type==='speech'?{shape:'cloud',outlineWidth:4,outlineColor:'#112233',fillColor:'#ffeedd',fillOpacity:.65,fontFamily:'source-han-serif',fontWeight:600,lineHeight:1.5,letterSpacing:1.5,textAlign:'left',padding:12,textColor:'#334455',textBox:{x:25,y:15,w:190,h:70},tail:{mode:'normalized',x:.7,y:1.4,side:'bottom',base:.55,visible:true},overflow:'visible'}:type==='label'?{textColor:'#e8c564'}:{}));
  const saved=await request('/api/projects/'+modern.id,'PUT',modern);
  assert.equal(saved.status,200);
  const exported=await request('/api/projects/'+modern.id+'/export');
  assert.equal(exported.status,200);
  const imported=await request('/api/projects/import','POST',exported.data);
  assert.equal(imported.status,201);
  assert.notEqual(imported.data.id,modern.id);
  const summarize=value=>value.pages[0].bubbles.map(({id,shotId,...fields})=>fields);
  assert.deepEqual(summarize(imported.data),summarize(modern));
  assert.ok(imported.data.pages[0].bubbles.every((value,index)=>value.id!==modern.pages[0].bubbles[index].id));
});


test('中文句末标点不会自动换到行首或单独成为一行，用户换行完整保留',()=>{
  const text='甲乙？！丙，丁。';
  const lines=wrapText(contextSpy(),text,28);
  assert.equal(lines.join(''),text);
  for(const line of lines){assert.doesNotMatch(line,/^[，、。？！：；!?.,:;]/u);assert.doesNotMatch(line,/^[\p{P}]+$/u);}
  assert.deepEqual(wrapText(contextSpy(),'甲\n\n乙？',28),['甲','','乙？']);
  assert.deepEqual(wrapText(contextSpy(),'甲「乙」丙',28),['甲','「乙」','丙']);
});

test('椭圆内逐行安全宽度随纵向收窄，换行后文字不贴边也不越出描边',()=>{
  const value=bubble('speech',{shape:'oval',w:340,h:220,fontSize:20,text:'甲乙丙丁戊己庚辛壬癸\n甲乙丙丁戊己庚辛壬癸\n甲乙丙丁戊己庚辛壬癸'}),context=contextSpy(),layout=bubbleLayout(context,value);
  assert.equal(layout.overflow,false);assert.equal(layout.lines.length,3);
  assert.ok(layout.lines[0].availableWidth<layout.lines[1].availableWidth);
  assert.ok(layout.lines[2].availableWidth<layout.lines[1].availableWidth);
  const rx=value.w/2-Math.max(layout.outlineWidth/2+2,layout.padding*.55),ry=value.h/2-Math.max(layout.outlineWidth/2+2,layout.padding*.55);
  for(const line of layout.lines){
    assert.ok(line.width<=line.availableWidth);
    for(const x of [line.x-line.width/2,line.x+line.width/2])for(const y of [line.y-layout.fontSize*1.05/2,line.y+layout.fontSize*1.05/2])
      assert.ok(((x-value.w/2)/rx)**2+((y-value.h/2)/ry)**2<=1.00001);
  }
});

test('自动适配保留全部原文，自动扩泡按设置扩大且不改写工程',()=>{
  const value=bubble('speech',{shape:'oval',w:60,h:30,text:'所有问号都应完整显示？！'}),snapshot=structuredClone(value),context=contextSpy();
  const visible=bubbleLayout(context,value);assert.equal(visible.overflow,false);assert.equal(visible.autoFitted,true);assert.equal(visible.expanded,false);
  paintBubble(context,value);assert.equal(calls(context,'clip').length,0);assert.equal(calls(context,'fillText').map(call=>call.args[0]).join(''),value.text);
  assert.match(svgBubbleMarkup(contextSpy(),value,{selected:true}),/data-overflow="false"/);assert.match(svgBubbleMarkup(contextSpy(),value),/overflow="visible"/);
  const expanded=bubbleLayout(contextSpy(),{...value,overflow:'expand'});
  assert.equal(expanded.expanded,true);assert.equal(expanded.overflow,false);assert.ok(expanded.w>value.w&&expanded.h>value.h);
  assert.deepEqual(value,snapshot);assert.ok(visible.fontSize<value.fontSize);
});

test('所有形状的颜色、描边与字体配置在SVG和Canvas中一致',()=>{
  for(const shape of BUBBLE_SHAPES.filter(value=>value!=="none")){
    const value=bubble('speech',{shape,w:360,h:180,text:'形状可编辑',outlineWidth:5,outlineColor:'#112233',fillColor:'#f0f0dd',fillOpacity:.35,fontFamily:'source-han-serif',fontWeight:700,textColor:'#445566',lineHeight:1.6,letterSpacing:2,textAlign:'left',padding:20,tail:{visible:false}}),context=contextSpy();
    const layout=paintBubble(context,value),markup=svgBubbleMarkup(contextSpy(),value),polygon=attributes(markup,'polygon')[0],svgText=attributes(markup,'text')[0];
    assert.equal(calls(context,'stroke')[0].lineWidth,5);assert.equal(calls(context,'stroke')[0].strokeStyle,'#112233');
    assert.equal(calls(context,'fill')[0].fillStyle,'#f0f0dd');assert.equal(calls(context,'fill')[0].globalAlpha,.35);
    assert.equal(polygon.stroke,'#112233');assert.equal(Number(polygon['stroke-width']),5);assert.equal(polygon.fill,'#f0f0dd');assert.equal(Number(polygon['fill-opacity']),.35);
    assert.equal(svgText['font-weight'],'700');assert.equal(svgText['letter-spacing'],'2');assert.equal(svgText['text-anchor'],'start');
    assert.match(calls(context,'fillText')[0].font,/Source Han Serif SC/);assert.equal(calls(context,'fillText')[0].fillStyle,'#445566');
    assert.equal(layout.lines[0].width,[...value.text].length*14+([...value.text].length-1)*2);
    assert.deepEqual(polygon.points.split(' ').map(pair=>pair.split(',').map(Number)),[...calls(context,'moveTo'),...calls(context,'lineTo')].map(call=>call.args));
  }
});

test('新样式字段严格校验，轮廓拒绝自交，字体与颜色不允许SVG注入',()=>{
  const invalid={shape:'rectangle',points:[{x:0,y:0},{x:1,y:1},{x:1,y:0},{x:0,y:1}],outlineWidth:257,outlineColor:'red',fillColor:'#fff',fillOpacity:1.1,fontFamily:'" onload="alert(1)',fontWeight:450,textColor:'url(javascript:evil)',lineHeight:0,letterSpacing:257,textAlign:'justify',padding:-1,overflow:'clip',textBox:{x:0,y:0,w:0,h:20},tail:{mode:'normalized',x:NaN,y:1},locked:'true'};
  for(const [field,value] of Object.entries(invalid))assert.throws(()=>validateProject(projectWith(bubble('speech',{[field]:value}))),/对白图层无效/,field);
  for(const tail of [{mode:'normalized',x:10,y:1},{visible:false},{x:125,y:300},{mode:'normalized',x:.5,y:1.4,side:'bottom',base:.5}])assert.doesNotThrow(()=>validateProject(projectWith(bubble('speech',{tail}))));
  const markup=svgBubbleMarkup(contextSpy(),bubble('speech',{fontFamily:invalid.fontFamily,outlineColor:invalid.outlineColor,fillColor:'" onload="evil()',textColor:invalid.textColor}));
  assert.doesNotMatch(markup,/onload|javascript|evil\(|NaN|Infinity/);assert.match(markup,/Source Han Sans SC/);
});

test('已有绝对尾尖与新增normalized尾尖得到同一整页位置，隐藏尾尖无绘制',()=>{
  const value=bubble('speech',{shape:'oval',tail:{x:280,y:175}}),local={x:280-value.x,y:175-value.y};
  const first=bubbleLayout(contextSpy(),value),second=bubbleLayout(contextSpy(),{...value,tail:{mode:'normalized',x:local.x/value.w,y:local.y/value.h}});
  assert.deepEqual(first.tail.tip,local);assert.deepEqual(second.tail.tip,local);assert.deepEqual(first.drawOutline,second.drawOutline);
  assert.equal(bubbleLayout(contextSpy(),{...value,tail:{visible:false}}).tail,null);
});


test('矩形和自定义轮廓的尾尖底座按边插入，底座不会误用整个边或消失',()=>{
  for(const extra of [{type:'caption'},{shape:'custom',points:[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}]},{shape:'rounded-rect'}]){
    const value=bubble('speech',{...extra,tail:{mode:'normalized',x:.55,y:1.3,side:'bottom',base:.55}}),layout=bubbleLayout(contextSpy(),value);
    assert.equal(layout.tail.anchors.length,2);
    assert.equal(Math.round(Math.abs(layout.tail.anchors[0].x-layout.tail.anchors[1].x)*100)/100,28.8);
    for(const anchor of layout.tail.anchors)assert.equal(anchor.y,value.h);
    assert.ok(layout.drawOutline.some(p=>p.x===layout.tail.tip.x&&p.y===layout.tail.tip.y));
    const context=contextSpy();paintBubble(context,value);
    const polygon=attributes(svgBubbleMarkup(contextSpy(),value),'polygon')[0];
    assert.deepEqual(polygon.points.split(' ').map(pair=>pair.split(',').map(Number)),[...calls(context,'moveTo'),...calls(context,'lineTo')].map(call=>call.args));
  }
});

