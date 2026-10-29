import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject,clone} from '../public/model.js';
import {comparableProject} from '../public/revision-sync.js';
import {mergeProjectRevision} from '../public/project-revision-merge.js';
const fixture=()=>{const base=createProject('合成同步',true);base.revision=5;return {base,local:clone(base),server:clone(base)};};
const reconcile=({base,local,server})=>mergeProjectRevision({baseComparable:comparableProject(base),local,server});
const frame=p=>p.pages[0].panels[0];
test('生成回填不升版本也能与未保存提示词合并，原对象不改写',()=>{
 const f=fixture();frame(f.local).generation={promptEdits:{direct:'本窗口文字'}};frame(f.server).imageAssetId='generated';frame(f.server).imageTransform={x:0,y:0,scale:1};frame(f.server).candidates=['generated'];
 const before=JSON.stringify(f),r=reconcile(f);assert.equal(r.ok,true);assert.equal(frame(r.project).generation.promptEdits.direct,'本窗口文字');assert.equal(frame(r.project).imageAssetId,'generated');assert.deepEqual(frame(r.project).candidates,['generated']);assert.equal(JSON.stringify(f),before);
});
test('仅聚焦或选中文字，无实际编辑时可接回结果',()=>{const f=fixture();frame(f.server).imageAssetId='generated';assert.equal(reconcile(f).ok,true);});
test('移动画格时生成回填保留位置，生成附加台词与本机旧台词编辑并存',()=>{
 const f=fixture();frame(f.local).x+=30;f.base.pages[0].bubbles=[{id:'old',text:'原文'}];f.local.pages[0].bubbles=[{id:'old',text:'人工修改'}];f.server.pages[0].bubbles=[{id:'old',text:'原文'},{id:'auto',text:'后台排字'}];frame(f.server).imageAssetId='generated';const r=reconcile(f);assert.equal(r.ok,true);assert.equal(frame(r.project).x,frame(f.local).x);assert.deepEqual(r.project.pages[0].bubbles,f.local.pages[0].bubbles.concat({id:'auto',text:'后台排字'}));
});
test('本地与后台同时更改同一个提示词必须保留冲突',()=>{const f=fixture();frame(f.base).prompt='原';frame(f.local).prompt='本地';frame(f.server).prompt='远端';assert.equal(reconcile(f).ok,false);assert.equal(frame(f.local).prompt,'本地');});
test('本机取景与后台替图、双方调整几何不能静默混合',()=>{
 for(const configure of [f=>{frame(f.local).imageTransform={x:40,y:0,scale:1};frame(f.server).imageAssetId='new';},f=>{frame(f.local).x+=20;frame(f.server).y+=30;},f=>{frame(f.local).w+=20;frame(f.server).imageAssetId='new';}]){const f=fixture();configure(f);assert.equal(reconcile(f).ok,false);}
});
test('删除与编辑冲突；独立新增按ID保留；双方不同重排冲突',()=>{
 const f=fixture();f.local.pages[0].panels=[];frame(f.server).x+=5;assert.equal(reconcile(f).ok,false);
 const g=fixture();g.local.pages[0].bubbles=[{id:'local'}];g.server.pages[0].bubbles=[{id:'remote'}];assert.equal(reconcile(g).ok,true);assert.equal(reconcile(g).project.pages[0].bubbles.length,2);
 const h=fixture();h.base.pages[0].bubbles=['a','b','c'].map(id=>({id}));h.local.pages[0].bubbles=['b','a','c'].map(id=>({id}));h.server.pages[0].bubbles=['a','c','b'].map(id=>({id}));assert.equal(reconcile(h).ok,false);
});
test('快照可补入后台图片，撤销本地文字时不撤走新图；更新的版本元数据保留',()=>{const f=fixture();delete f.local.layoutHistory;frame(f.server).imageAssetId='generated';f.server.revision=6;f.server.updated='later';const r=reconcile(f);assert.equal(r.ok,true);assert.equal(frame(r.project).imageAssetId,'generated');assert.equal(r.project.revision,6);assert.equal(r.project.updated,'later');});
test('旧版本、其他工程、损坏基线拒绝合并',()=>{const f=fixture();f.server.revision=4;assert.equal(reconcile(f).ok,false);f.server.revision=5;f.server.id='other';assert.equal(reconcile(f).ok,false);assert.equal(mergeProjectRevision({baseComparable:'broken',local:f.local,server:f.local}).ok,false);});
