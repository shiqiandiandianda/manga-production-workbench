import test from 'node:test';import assert from 'node:assert/strict';
import {createProject,shapePresets,polygonFor,clone} from '../public/model.js';
import {CUSTOM_FRAME_SHAPES_KEY,createCustomFrameShapeLibrary,validateCustomFramePoints,applyFrameShape,customFrameShapeIcon,customFrameShapeButtons,addCustomFrameNode,removeCustomFrameNode,overwriteFrameShapeTarget,selectFrameShapeOverwriteTarget,frameShapeTargetOptions} from '../public/custom-frame-shapes.js';
function storage(){const values=new Map();return {denied:false,writes:0,getItem:k=>values.get(k)||null,setItem(k,v){if(this.denied)throw Error('quota');this.writes++;values.set(k,v);},seed(k,v){values.set(k,v);}};}
const rect=()=>polygonFor('rectangle');
test('保存、重载、改名、覆盖和删除持久化；调用者或返回对象的修改不污染库',()=>{
 const s=storage(),lib=createCustomFrameShapeLibrary({storage:s}),points=rect(),item=lib.create('  我的矩形  ',points);assert.equal(item.name,'我的矩形');assert.match(item.id,/^custom-shape:/);points[0].x=.5;item.points[0].x=.6;assert.equal(lib.get(item.id).points[0].x,0);const reopened=createCustomFrameShapeLibrary({storage:s});assert.equal(reopened.list().length,1);const updated=reopened.update(item.id,{name:'斜切细格',points:polygonFor('slanted')});assert.equal(updated.createdAt,lib.get(item.id).createdAt);assert.equal(lib.get(item.id).name,'斜切细格');assert.deepEqual(lib.get(item.id).points,polygonFor('slanted'));reopened.remove(item.id);assert.equal(lib.list().length,0);assert.ok(s.getItem(CUSTOM_FRAME_SHAPES_KEY));
});
test('六默认常量始终保留，update/remove只管理自定义，默认覆盖使用独立API',()=>{
 const s=storage(),lib=createCustomFrameShapeLibrary({storage:s}),before=clone(shapePresets);for(const standard of shapePresets){assert.throws(()=>lib.remove(standard.id),/六种基础形状保持/);assert.throws(()=>lib.update(standard.id,{name:'覆盖',points:rect()}),/不存在/);}assert.equal(shapePresets.length,6);assert.deepEqual(shapePresets,before);assert.equal(s.writes,0);
});
test('没有自定义款也能选择并覆盖任一六默认槽位，重载后点击默认ID应用本地覆盖',()=>{
 const s=storage(),lib=createCustomFrameShapeLibrary({storage:s}),constants=clone(shapePresets),originalRectangle=rect(),triangle=[{x:0,y:0},{x:1,y:.5},{x:0,y:1}];for(const preset of shapePresets){const value=overwriteFrameShapeTarget(lib,preset.id,{name:'我的'+preset.label,points:triangle});assert.equal(value.id,preset.id);assert.equal(value.overridden,true);assert.deepEqual(value.points,triangle);}assert.equal(lib.list().length,0);assert.equal(lib.presets().length,6);assert.deepEqual(shapePresets,constants);assert.deepEqual(rect(),originalRectangle);const reopened=createCustomFrameShapeLibrary({storage:s}),f=createProject('合成默认覆盖').pages[0].panels[0];applyFrameShape(f,'rectangle',reopened);assert.deepEqual(f.points,triangle);assert.equal(JSON.parse(s.getItem(CUSTOM_FRAME_SHAPES_KEY)).version,1);
});
test('选择覆盖目标保留当前编辑草稿，保存写到用户指定槽位而非载入目标旧轮廓',()=>{
 const lib=createCustomFrameShapeLibrary({storage:storage()}),draft=polygonFor('trapezoid'),state={targetId:'rectangle',draft,draftName:'我的修改',nameEdited:true},before=clone(state),chosen=selectFrameShapeOverwriteTarget(lib,state,'hexagon');assert.equal(chosen.targetId,'hexagon');assert.deepEqual(chosen.draft,draft);assert.equal(chosen.draftName,'我的修改');assert.deepEqual(state,before);overwriteFrameShapeTarget(lib,chosen.targetId,{name:chosen.draftName,points:chosen.draft});assert.deepEqual(lib.getPreset('hexagon').points,draft);assert.deepEqual(lib.getPreset('rectangle').points,rect());
});
test('覆盖已保存自定义款和改名可明确选目标，不改变其他款或六默认槽位',()=>{
 const lib=createCustomFrameShapeLibrary({storage:storage()}),a=lib.create('第一款',rect()),b=lib.create('第二款',polygonFor('slanted')),before=lib.get(a.id);const chosen=selectFrameShapeOverwriteTarget(lib,{draft:polygonFor('hexagon'),draftName:'新的第二款',nameEdited:true},b.id);overwriteFrameShapeTarget(lib,chosen.targetId,{name:chosen.draftName,points:chosen.draft});assert.deepEqual(lib.get(a.id),before);assert.equal(lib.get(b.id).name,'新的第二款');assert.deepEqual(lib.get(b.id).points,polygonFor('hexagon'));assert.ok(lib.presets().every(p=>!p.overridden));
});
test('恢复默认只移除所选本地覆盖，不改变已应用的旧格子或其他库内容',()=>{
 const lib=createCustomFrameShapeLibrary({storage:storage()}),custom=lib.create('保留款',polygonFor('slanted'));lib.setPresetOverride('rectangle',{name:'三角替换',points:[{x:0,y:0},{x:1,y:.5},{x:0,y:1}]});lib.setPresetOverride('hexagon',{name:'另一替换',points:rect()});const frame=createProject('合成恢复默认').pages[0].panels[0];applyFrameShape(frame,'rectangle',lib);const old=clone(frame);const restored=lib.restorePreset('rectangle');assert.equal(restored.overridden,false);assert.deepEqual(restored.points,rect());assert.deepEqual(frame,old);assert.equal(lib.getPreset('hexagon').overridden,true);assert.equal(lib.get(custom.id).name,'保留款');
});
test('默认覆盖的非法轮廓、错误目标及存储失败不会污染原库或常量',()=>{
 const s=storage(),lib=createCustomFrameShapeLibrary({storage:s});lib.setPresetOverride('rectangle',{name:'可用替换',points:polygonFor('slanted')});lib.create('已有自定义',rect());const old=s.getItem(CUSTOM_FRAME_SHAPES_KEY),constants=clone(shapePresets);for(const points of [[{x:0,y:0},{x:1,y:1},{x:1,y:0},{x:0,y:1}],[],[{x:0,y:0},{x:9,y:0},{x:0,y:1}]]){assert.throws(()=>overwriteFrameShapeTarget(lib,'rectangle',{name:'不应保存',points}));assert.equal(s.getItem(CUSTOM_FRAME_SHAPES_KEY),old);}assert.throws(()=>overwriteFrameShapeTarget(lib,'unknown',{name:'无效',points:rect()}));assert.equal(s.getItem(CUSTOM_FRAME_SHAPES_KEY),old);s.denied=true;assert.throws(()=>lib.restorePreset('rectangle'),/原库保持/);assert.throws(()=>lib.setPresetOverride('hexagon',{name:'失败',points:rect()}),/原库保持/);assert.equal(s.getItem(CUSTOM_FRAME_SHAPES_KEY),old);assert.deepEqual(shapePresets,constants);
});
test('旧version1库保留自定义款，覆盖目标始终含六默认和已有自定义并转义名称',()=>{
 const s=storage(),lib=createCustomFrameShapeLibrary({storage:s}),custom=lib.create('<img onerror=bad>',rect()),legacy=JSON.parse(s.getItem(CUSTOM_FRAME_SHAPES_KEY));delete legacy.overrides;s.seed(CUSTOM_FRAME_SHAPES_KEY,JSON.stringify(legacy));const reopened=createCustomFrameShapeLibrary({storage:s});assert.equal(reopened.get(custom.id).name,'<img onerror=bad>');const markup=frameShapeTargetOptions(reopened,'hexagon');for(const preset of shapePresets)assert.ok(markup.includes('value="'+preset.id+'"'));assert.ok(markup.includes('value="'+custom.id+'"'));assert.match(markup,/value="hexagon" selected/);assert.doesNotMatch(markup,/<img/);assert.match(markup,/&lt;img/);reopened.setPresetOverride('rectangle',{name:'旧库新覆盖',points:polygonFor('trapezoid')});assert.equal(reopened.get(custom.id).name,'<img onerror=bad>');
});
test('自交、重复、退化、过近、节点数量和坐标范围非法时拒绝覆盖已保存形状',()=>{
 const s=storage(),lib=createCustomFrameShapeLibrary({storage:s}),item=lib.create('安全轮廓',rect()),old=s.getItem(CUSTOM_FRAME_SHAPES_KEY);
 const invalid=[[],rect().slice(0,2),Array(33).fill({x:0,y:0}),[{x:0,y:0},{x:1,y:1},{x:1,y:0},{x:0,y:1}],[{x:0,y:0},{x:.5,y:0},{x:1,y:0}],[{x:0,y:0},{x:.001,y:0},{x:1,y:1}],rect().map((p,i)=>i===0?{x:Infinity,y:0}:p),rect().map((p,i)=>i===0?{x:9,y:0}:p),rect().map((p,i)=>i===0?{x:0,y:NaN}:p),rect().map((p,i)=>i===0?{x:'0',y:0}:p)];
 for(const points of invalid){assert.throws(()=>lib.update(item.id,{points}));assert.equal(s.getItem(CUSTOM_FRAME_SHAPES_KEY),old);assert.throws(()=>lib.create('拒绝',points));assert.equal(s.getItem(CUSTOM_FRAME_SHAPES_KEY),old);}
 for(const name of ['',null,'形'.repeat(81)]){assert.throws(()=>lib.update(item.id,{name}));assert.equal(s.getItem(CUSTOM_FRAME_SHAPES_KEY),old);}
});
test('存储失败、无存储和损坏库不伪造保存成功，不破坏原库',()=>{
 const s=storage(),lib=createCustomFrameShapeLibrary({storage:s}),item=lib.create('原款',rect()),old=s.getItem(CUSTOM_FRAME_SHAPES_KEY);s.denied=true;assert.throws(()=>lib.update(item.id,{name:'失败改名'}),/原库保持/);assert.throws(()=>lib.remove(item.id),/原库保持/);assert.equal(s.getItem(CUSTOM_FRAME_SHAPES_KEY),old);
 const missing=createCustomFrameShapeLibrary({storage:null});assert.deepEqual(missing.list(),[]);assert.throws(()=>missing.create('不能保存',rect()),/尚未写入/);
 const bad=storage();bad.seed(CUSTOM_FRAME_SHAPES_KEY,'{invalid');const broken=createCustomFrameShapeLibrary({storage:bad});assert.throws(()=>broken.create('不能覆盖',rect()),/原数据已保留/);assert.equal(bad.getItem(CUSTOM_FRAME_SHAPES_KEY),'{invalid');
});
test('应用对象或保存ID仅复制轮廓，原格位置、尺寸、图片取景、来源及所属文字保持',()=>{
 const p=createProject('合成形状复用',true),frame=p.pages[0].panels[0],lib=createCustomFrameShapeLibrary({storage:storage()}),item=lib.create('斜切',polygonFor('slanted'));Object.assign(frame,{imageAssetId:'asset_synthetic',imageTransform:{x:-30,y:20,scale:1.2,rotation:35,flipX:true},generation:{prompt:'甲的原画面事实',sourceSnapshot:{original:{description:'原文'}}}});const before=clone(p);applyFrameShape(frame,item,lib);const expected=clone(before);expected.pages[0].panels[0].points=polygonFor('slanted');assert.deepEqual(p,expected);item.points[0].x=.9;assert.deepEqual(frame.points,polygonFor('slanted'));applyFrameShape(frame,'rectangle',lib);assert.deepEqual(frame.points,rect());applyFrameShape(frame,item.id,lib);assert.deepEqual(frame.points,polygonFor('slanted'));
});
test('覆盖或删除库中款式不会改动已经应用的画格；库与工程保留独立副本',()=>{
 const lib=createCustomFrameShapeLibrary({storage:storage()}),item=lib.create('三角', [{x:0,y:0},{x:1,y:.5},{x:0,y:1}]),p=createProject('合成独立形状'),frame=p.pages[0].panels[0];applyFrameShape(frame,item,lib);const old=clone(frame.points);lib.update(item.id,{points:rect()});assert.deepEqual(frame.points,old);lib.remove(item.id);assert.deepEqual(frame.points,old);
});
test('锁定画格、未知形状和非法应用轮廓失败时，整个画格保持',()=>{
 const p=createProject('合成锁定'),frame=p.pages[0].panels[0],before=clone(frame);for(const value of ['missing',{points:[{x:0,y:0}]},null]){assert.throws(()=>applyFrameShape(frame,value));assert.deepEqual(frame,before);}frame.locked=true;const locked=clone(frame);assert.throws(()=>applyFrameShape(frame,'slanted'),/解锁/);assert.deepEqual(frame,locked);
});
test('增加最长边中点和删除节点均校验轮廓，不修改输入，至少3点、至多64点',()=>{
 const source=rect(),before=clone(source),added=addCustomFrameNode(source);assert.equal(added.length,5);assert.deepEqual(source,before);assert.deepEqual(added[1],{x:.5,y:0});assert.deepEqual(removeCustomFrameNode(added,1),source);assert.throws(()=>removeCustomFrameNode([{x:0,y:0},{x:1,y:0},{x:0,y:1}],0),/至少保留3/);const circle=Array.from({length:64},(_,i)=>({x:.5+.5*Math.cos(i*2*Math.PI/64),y:.5+.5*Math.sin(i*2*Math.PI/64)}));assert.throws(()=>addCustomFrameNode(circle),/最多64/);assert.throws(()=>addCustomFrameNode(source,99),/位置无效/);
});
test('自定义SVG图标适配正常与越框坐标，名称转义，非法坐标不能进入SVG',()=>{
 const shape={id:'custom-shape:00000000-0000-0000-0000-000000000001',name:'<img onerror="bad">',points:[{x:-.2,y:0},{x:1,y:.2},{x:.7,y:1},{x:0,y:1.1}]};const svg=customFrameShapeIcon(shape.points);assert.match(svg,/viewBox="0 0 26 22"/);assert.doesNotMatch(svg,/NaN|Infinity/);const buttons=customFrameShapeButtons([shape]);assert.doesNotMatch(buttons,/<img/);assert.match(buttons,/&lt;img/);assert.throws(()=>customFrameShapeIcon([{x:NaN,y:0},{x:1,y:0},{x:0,y:1}]));
});
test('同源不同实例收到成功保存通知，失败不通知，解除订阅停止通知',()=>{
 const s=storage(),a=createCustomFrameShapeLibrary({storage:s}),b=createCustomFrameShapeLibrary({storage:s});let count=0;const off=b.subscribe(()=>count++);const item=a.create('共享',rect());assert.equal(count,1);a.update(item.id,{name:'共享改名'});assert.equal(count,2);s.denied=true;assert.throws(()=>a.remove(item.id));assert.equal(count,2);off();s.denied=false;a.remove(item.id);assert.equal(count,2);
});
