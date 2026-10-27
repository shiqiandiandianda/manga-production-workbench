import test from 'node:test';
import assert from 'node:assert/strict';
import {makePage,createProject,rescalePageWidth,layoutLongStrip,stripSegments,resizePageHeight} from "../public/model.js";
import {paintPage,pageCanvas,exportPage,exportLayoutPage,exportEpisode,renderStripSegment,createSafeCanvas,pngBlob,zipStore} from '../public/render.js';
import {validateProject} from '../lib/store.mjs';

function contextSpy(){
  const calls=[],stack=[],fields=['font','fillStyle','strokeStyle','lineWidth','textAlign','textBaseline','lineJoin','globalAlpha','globalCompositeOperation'];
  const context={calls,globalAlpha:1,measureText:text=>({width:[...text].length*14})};
  for(const method of ['scale','translate','beginPath','ellipse','moveTo','lineTo','closePath','fill','stroke','fillRect','strokeRect','rect','clip','fillText','strokeText','drawImage'])context[method]=(...args)=>calls.push({method,args,...Object.fromEntries(fields.map(field=>[field,context[field]]))});
  context.save=()=>stack.push(Object.fromEntries(fields.map(field=>[field,context[field]])));
  context.restore=()=>Object.assign(context,stack.pop());
  context.createLinearGradient=(...args)=>{
    const gradient={stops:[],addColorStop(offset,color){this.stops.push([offset,color]);}};
    calls.push({method:'createLinearGradient',args,gradient});return gradient;
  };
  return context;
}
function canvases(){
  const created=[],encoded=[];
  const factory=()=>{
    const context=contextSpy(),canvas={width:0,height:0,context,getContext:()=>context,toBlob(callback){
      const sample={width:this.width,height:this.height,rects:context.calls.filter(call=>call.method==='rect').map(call=>call.args),texts:context.calls.filter(call=>call.method==='fillText').map(call=>call.args[0])};
      encoded.push(sample);callback(new Blob([JSON.stringify(sample)],{type:'image/png'}));
    }};
    let width=0,height=0;
    Object.defineProperties(canvas,{width:{get:()=>width,set:value=>{width=value;canvas.maxWidth=Math.max(canvas.maxWidth||0,value);}},height:{get:()=>height,set:value=>{height=value;canvas.maxHeight=Math.max(canvas.maxHeight||0,value);}}});
    created.push(canvas);return canvas;
  };
  return {created,encoded,factory};
}
const image={naturalWidth:1024,naturalHeight:1344};
function longImagePage(height=300000){
  const page=makePage(['shot'],'stack',1280,height),frame=page.panels[0];
  Object.assign(frame,{x:0,y:1000,w:1280,h:height-2000,feather:600,imageAssetId:'image',imageTransform:{x:0,y:0,scale:1},border:0});
  return page;
}
const calls=(context,method)=>context.calls.filter(call=>call.method===method);
async function localZipEntries(blob){
  const bytes=new Uint8Array(await blob.arrayBuffer()),view=new DataView(bytes.buffer),entries=[];
  for(let offset=0;offset+30<=bytes.length&&view.getUint32(offset,true)===0x04034b50;){
    const size=view.getUint32(offset+18,true),nameLength=view.getUint16(offset+26,true),extraLength=view.getUint16(offset+28,true),start=offset+30+nameLength+extraLength;
    entries.push({name:new TextDecoder().decode(bytes.subarray(offset+30,offset+30+nameLength)),bytes:bytes.subarray(start,start+size)});
    offset=start+size;
  }
  return entries;
}
test('超长柔边背景只创建当前分段大小的mask画布，渐变仍按完整格子坐标',async()=>{
  const page=longImagePage(),target=contextSpy(),pool=canvases();
  await paintPage(target,page,{region:{x:0,y:32000,w:1280,h:8192},canvasFactory:pool.factory,imageLoader:async()=>image});
  assert.equal(pool.created.length,1);assert.equal(pool.created[0].maxWidth,1280);assert.equal(pool.created[0].maxHeight,8192);assert.equal(pool.created[0].height,1);
  const layer=pool.created[0].context,gradient=calls(layer,'createLinearGradient')[0];
  assert.deepEqual(gradient.args,[0,0,0,298000]);assert.equal(gradient.gradient.stops[1][0],600/298000);
  assert.deepEqual(calls(layer,'translate')[0].args,[-0,-31000]);
  assert.deepEqual(calls(target,'rect')[0].args,[0,32000,1280,8192]);
  assert.deepEqual(calls(target,'drawImage')[0].args.slice(1),[0,31000,1280,8192]);
});
test('非可见格子不读取原图或创建mask；源图片和取景数据不被绘制改写',async()=>{
  const page=longImagePage(),before=structuredClone(page),pool=canvases();let reads=0;
  await paintPage(contextSpy(),page,{region:{x:0,y:0,w:1280,h:500},canvasFactory:pool.factory,imageLoader:async()=>{reads++;return image;}});
  assert.equal(reads,0);assert.equal(pool.created.length,0);assert.deepEqual(page,before);
});
test('局部页面快照在源页36000px位置创建1000px画布，并同步裁剪柔边图层',async()=>{
  const page=longImagePage(),pool=canvases();
  const canvas=await pageCanvas(page,{region:{x:0,y:36000,w:1280,h:1000},canvasFactory:pool.factory,imageLoader:async()=>image});
  assert.equal(canvas.width,1280);assert.equal(canvas.height,1000);assert.equal(pool.created.length,2);
  assert.equal(pool.created[1].maxHeight,1000);assert.deepEqual(calls(canvas.context,'translate')[0].args,[-0,-36000]);
});
test('单画布拒绝超尺寸或像素预算，分段绘制仍正常',async()=>{
  const pool=canvases();
  assert.throws(()=>createSafeCanvas(1280,30000,pool.factory),/单画布安全/);assert.throws(()=>createSafeCanvas(16384,16384,pool.factory),/单画布安全/);
  assert.equal(pool.created.length,0);
  const page=longImagePage(),layout=layoutLongStrip([page]),segment=stripSegments(layout).next().value;
  const canvas=await renderStripSegment(layout,segment,{canvasFactory:pool.factory,imageLoader:async()=>image});
  assert.equal(canvas.height,8192);assert.ok(pool.created.every(item=>item.maxHeight<=8192));
});
test('当前50002px长页自动导出7段ZIP，完整覆盖末段并由共享文字绘制气泡',async()=>{
  const page=makePage([],'stack',1280,50002),pool=canvases(),saved=[];
  page.name='超长页';page.bubbles=[{id:'bubble',type:'caption',text:'跨段对白',x:100,y:8180,w:300,h:150,fontSize:28,visible:true}];
  const before=structuredClone(page),result=await exportPage(page,{canvasFactory:pool.factory,download:(blob,name)=>saved.push({blob,name})});
  assert.deepEqual(result,{parts:7,height:50002,width:1280});assert.equal(saved[0].name,'超长页_分段.zip');
  assert.deepEqual(pool.encoded.map(sample=>sample.height),[8192,8192,8192,8192,8192,8192,850]);
  assert.ok(pool.encoded.every(sample=>sample.texts.includes('跨段对白')));assert.deepEqual(page,before);
  const entries=await localZipEntries(saved[0].blob);assert.equal(entries.length,7);assert.equal(entries.at(-1).name,'长图_07.png');
  assert.equal(JSON.parse(new TextDecoder().decode(entries.at(-1).bytes)).height,850);
  assert.equal(pool.encoded.at(-1).rects[0][1]+pool.encoded.at(-1).rects[0][3],50002);
});
test('整话输出1280宽，在混合旧宽与多页边界仍完整保持顺序，mask分配受分段限制',async()=>{
  const legacy=longImagePage(20000);rescalePageWidth(legacy,724);
  const last=makePage([],'stack',1280,600),pages=[legacy,last],before=structuredClone(pages),pool=canvases(),saved=[],progress=[];
  const layout=layoutLongStrip(pages);
  const session='export_11111111-1111-4111-8111-111111111111';
  const request=async(url,init)=>{const input=JSON.parse(init.body);return {ok:true,json:async()=>url.endsWith('/parts')?{received:input.index+1,nextY:input.y+pool.encoded.at(-1).height}:url.endsWith('/complete')?{width:1280,height:layout.height,files:1,url:'/api/strip-exports/'+session+'/download'}:{id:session,width:1280,height:layout.height}};};
  const result=await exportEpisode({id:'synthetic-project',revision:1,title:'整话',pages},message=>progress.push(message),{canvasFactory:pool.factory,imageLoader:async()=>image,request,downloadURL:(url,name)=>saved.push({url,name})});
  assert.equal(result.width,1280);assert.equal(result.height,layout.height);assert.equal(result.parts,1);assert.equal(result.files,1);assert.equal(progress.length,result.partsRendered+1);
  assert.equal(saved.length,1);assert.equal(saved[0].name,'整话_整话.png');assert.match(saved[0].url,/\/download$/);assert.ok(pool.created.every(item=>item.maxWidth<=1280&&item.maxHeight<=8193));
  assert.deepEqual(pages,before);const lastSample=pool.encoded.at(-1);assert.ok(lastSample.rects.some(rect=>rect[3]===lastSample.height));
});
test('版式草稿长页也自动分段；资源预算拒绝时不交付被截断的文件',async()=>{
  const page=makePage(['shot'],'stack',1280,20000),pool=canvases(),saved=[];
  const result=await exportLayoutPage(page,[{id:'shot',code:'S01',title:'主场景'}],{canvasFactory:pool.factory,download:(blob,name)=>saved.push({blob,name})});
  assert.equal(result.parts,3);assert.ok(pool.encoded.some(sample=>sample.texts.includes('S01 · 主场景')));
  assert.match(saved[0].name,/版式草稿_分段\.zip$/);
  const before=structuredClone(page);let delivered=false;
  await assert.rejects(exportPage(page,{canvasFactory:canvases().factory,maxArchiveBytes:1,download:()=>{delivered=true;}}),/没有截断页面/);
  assert.equal(delivered,false);assert.deepEqual(page,before);
  await assert.rejects(pngBlob({toBlob(callback){callback(null);}}),/PNG 导出失败/);
  assert.throws(()=>zipStore(Array.from({length:65536},()=>({name:'a',bytes:new Uint8Array()}))),/ZIP 格式容量/);
});
test('合法长页格子与同比例迁移后的外观/取景通过保存验证，危险超界仍拒绝',()=>{
  const project=createProject('合法长页'),page=project.pages[0],frame=page.panels[0];
  page.height=120000;Object.assign(frame,{y:110000,h:9000,border:256,feather:10000,imageTransform:{x:-200001,y:-350000,scale:2000000}});
  assert.equal(validateProject(project),project);
  for(const field of ['border','feather']){const copy=structuredClone(project);copy.pages[0].panels[0][field]=field==='border'?257:10001;assert.throws(()=>validateProject(copy),/格子外观/);}
  const legacy=createProject('迁移页');rescalePageWidth(legacy.pages[0],724);const legacyFrame=legacy.pages[0].panels[0];
  Object.assign(legacyFrame,{border:20,feather:1500,imageTransform:{x:-100000,y:-100000,scale:1000000}});rescalePageWidth(legacy.pages[0]);
  assert.ok(legacyFrame.border>20&&legacyFrame.feather>1500);assert.doesNotThrow(()=>validateProject(legacy));
  const extreme=structuredClone(project);extreme.pages[0].height=Number.MAX_SAFE_INTEGER;extreme.pages[0].panels[0].y=Number.MAX_SAFE_INTEGER+1;
  assert.throws(()=>validateProject(extreme),/格子轮廓/);
});

test('超长页图片取景不会被旧1000000倍率间接截断，只接受正有限安全倍率',()=>{
  const project=createProject('极长取景'),page=project.pages[0],frame=page.panels[0];
  page.height=1000000000000;frame.y=0;frame.h=page.height;frame.imageTransform={x:0,y:0,scale:page.height/1344};
  assert.doesNotThrow(()=>validateProject(project));
  for(const scale of [0,-1,Infinity,NaN,Number.MAX_SAFE_INTEGER+1]){
    const copy=structuredClone(project);copy.pages[0].panels[0].imageTransform.scale=scale;
    assert.throws(()=>validateProject(copy),/图片取景参数/);
  }
});
test('任意正安全整数高度的空白短页可以保存；0、负数和小数仍拒绝',()=>{
  const project=createProject('短页'),page=project.pages[0];
  page.panels=[];page.bubbles=[];
  for(const height of [1,2,399,Number.MAX_SAFE_INTEGER]){page.height=height;assert.doesNotThrow(()=>validateProject(project));}
  for(const height of [0,-1,1.5,Infinity,Number.MAX_SAFE_INTEGER+1]){page.height=height;assert.throws(()=>validateProject(project),/长图尺寸/);}
});
test('带格子、取景、气泡、绝对尾尖与独立文字框的3840px页缩到1可保存，拉长后全部原样恢复',()=>{
  const project=createProject('保留完整图层',true),page=project.pages[0];
  page.panels[0].imageTransform={x:-30,y:-120,scale:.8};
  Object.assign(page.bubbles[0],{tail:{mode:'absolute',x:600,y:4050,base:.5},textBox:{x:18,y:12,w:260,h:120}});
  const before=structuredClone(page),ids=[page.id,...page.panels.map(panel=>panel.id),...page.bubbles.map(bubble=>bubble.id)];
  assert.equal(page.height,3840);assert.doesNotThrow(()=>validateProject(project));
  resizePageHeight(page,1);assert.doesNotThrow(()=>validateProject(project));
  assert.equal(page.height,1);assert.deepEqual(page.panels,before.panels);assert.deepEqual(page.bubbles,before.bubbles);
  assert.deepEqual([page.id,...page.panels.map(panel=>panel.id),...page.bubbles.map(bubble=>bubble.id)],ids);
  resizePageHeight(page,3840);assert.doesNotThrow(()=>validateProject(project));assert.deepEqual(page,before);
});
test('纵向几何脱离页高限制后仍拒绝不足20px以及越出safe的终点',()=>{
  const base=createProject('纵向安全',true);base.pages[0].height=1;
  for(const type of ['panel','bubble']){
    for(const change of [{h:19},{y:Number.MAX_SAFE_INTEGER-10,h:20},{y:-Number.MAX_SAFE_INTEGER-1,h:20},{y:0,h:Infinity}]){
      const project=structuredClone(base),item=type==='panel'?project.pages[0].panels[0]:project.pages[0].bubbles[0];
      Object.assign(item,change);assert.throws(()=>validateProject(project),type==='panel'?/格子轮廓/:/对白图层/);
    }
  }
});
