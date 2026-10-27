import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject,clone} from '../public/model.js';
import {resizeEmptyGap} from '../public/strip-space.js';
import {preserveEditRevision,revisionDecision,comparableProject} from '../public/revision-sync.js';
import {ensureLayoutHistory,preserveLayoutHistory,layoutEditSnapshot} from '../public/layout-history.js';

test('保存响应在多次间距预览之间返回时，旧快照不能退回已确认版本',()=>{
 const p=createProject('合成间距竞态',true);p.pages=p.pages.slice(0,1);p.pages[0].bubbles=[];p.pages[0].panels=p.pages[0].panels.slice(0,1);Object.assign(p.pages[0].panels[0],{y:100,h:300});p.revision=2;
 const before=clone(p),gap={from:0,to:100};let current=resizeEmptyGap(before,{...gap,height:200}).project;
 current.revision=3;current.updated='save-acknowledged';
 const next=preserveEditRevision(current,resizeEmptyGap(before,{...gap,height:300}).project);
 assert.equal(next.revision,3);assert.equal(next.updated,'save-acknowledged');assert.equal(next.pages[0].panels[0].y,300);
 assert.equal(before.revision,2);assert.equal(before.pages[0].panels[0].y,100);
});

test('取消预览恢复几何，保留保存响应版本和历史',()=>{
 const current=createProject('合成取消预览',true);ensureLayoutHistory(current);current.revision=8;
 const before=layoutEditSnapshot(current),x=before.pages[0].panels[0].x;current.pages[0].panels[0].x+=100;current.revision=9;current.updated='new-save';
 const restored=preserveLayoutHistory(current,before);assert.equal(restored.revision,9);assert.equal(restored.updated,'new-save');assert.equal(restored.pages[0].panels[0].x,x);assert.deepEqual(restored.layoutHistory,current.layoutHistory);
});

test('收到较新服务端工程时，历史合并不能反向降版本',()=>{
 const current=createProject('当前',true);current.revision=10;const next=clone(current);next.revision=11;next.updated='newer';
 assert.equal(preserveLayoutHistory(current,next).revision,11);assert.equal(next.updated,'newer');
 const unrelated=clone(current);unrelated.id='other';unrelated.revision=1;assert.equal(preserveEditRevision(current,unrelated).revision,1);
});

test('真正其他窗口修改仍触发冲突，不能靠恢复预览获取其版本',()=>{
 const base=createProject('合成多窗口',true);base.revision=5;const local=clone(base),remote=clone(base);local.pages[0].panels[0].x+=10;remote.pages[0].panels[0].y+=20;remote.revision=6;
 preserveEditRevision(local,clone(base));assert.equal(local.revision,5);
 assert.equal(revisionDecision({localRevision:local.revision,server:remote,baseComparable:comparableProject(base),dirty:true,saving:false}),'conflict');
});
