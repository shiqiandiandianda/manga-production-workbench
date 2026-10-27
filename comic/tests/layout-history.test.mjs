import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {captureLayout,ensureLayoutHistory,recordLayoutAdjustment,preserveLayoutHistory,queryLayoutHistory,exportLayoutHistory,layoutHistorySummary} from '../public/layout-history.js';
import {layoutHistoryRecordMarkup} from '../public/layout-history-ui.js';
const clone=structuredClone;
function fixture(){return {id:'project_synthetic',title:'合成记录测试',revision:1,shots:[{id:'shot_a',code:'S01',storyboard:{sourceId:'source_one',sheet:'第一话',row:2}}],ruleLayout:{template:'fixture-template',templateVersion:'v-test'},layerOrder:['panel_a','panel_b','bubble_a'],pages:[{id:'page_a',width:1280,height:2000,layoutPreset:'stack',panels:[{id:'panel_a',shotId:'shot_a',x:0,y:0,w:1280,h:600,points:[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}],imageAssetId:'asset_reference',imageTransform:{x:0,y:0,scale:1},layoutIntent:{templateId:'panel-template',templateVersion:'1.2'}},{id:'panel_b',x:0,y:650,w:800,h:600}],bubbles:[{id:'bubble_a',parentPanelId:'panel_a',shotId:'shot_a',x:40,y:60,w:200,h:90,tail:{x:.5,y:1.3,base:.3,side:'bottom'}}]}],gradients:[]};}
test('first use captures only the current baseline, with real template / source provenance and no invented past',()=>{
 const p=fixture();ensureLayoutHistory(p,{now:'2026-10-12T00:00:00Z'});assert.equal(p.layoutHistory.records.length,0);assert.equal(p.layoutHistory.baseline.objects['panel:panel_a'].values.y,0);assert.equal(p.layoutHistory.baseline.origin,'current-layout-at-first-use');
 const c=p.layoutHistory.baseline.objects['panel:panel_a'].context;assert.equal(c.templateVersion,'1.2');assert.equal(c.sourceStoryboard.row,2);assert.equal(c.sourceShotCode,'S01');assert.equal(p.layoutHistory.baseline.objects['bubble:bubble_a'].context.templateId,'panel-template');
 delete p.ruleLayout;delete p.pages[0].panels[0].layoutIntent;assert.equal(captureLayout(p).objects['panel:panel_a'].context.templateVersion,null);
});
test('200 pointer updates produce one completed-operation record, no-op produces none, baseline stays immutable',()=>{
 const p=fixture();ensureLayoutHistory(p);const baseline=clone(p.layoutHistory.baseline),before=clone(p);
 for(let i=1;i<=200;i++){p.pages[0].panels[0].x=i;assert.equal(p.layoutHistory.records.length,0);}
 const result=recordLayoutAdjustment(before,p,{source:'manual',operation:'panel.drag'});assert.equal(p.layoutHistory.records.length,1);const x=result.record.changes.find(c=>c.objectId==='panel_a').fields.find(f=>f.field==='x');assert.deepEqual(x,{field:'x',before:0,after:200});assert.deepEqual(p.layoutHistory.baseline,baseline);
 assert.equal(recordLayoutAdjustment(clone(p),p).record,null);assert.equal(p.layoutHistory.records.length,1);
});
test('crop / resizing / bubble tail / arrangement differences retain before and after values',()=>{
 const p=fixture(),before=clone(p);p.pages[0].panels[0].imageTransform.scale=1.4;p.pages[0].panels[0].w=1100;p.pages[0].panels[1].y=900;p.pages[0].bubbles[0].tail.x=.7;p.pages[0].bubbles[0].w=220;
 const r=recordLayoutAdjustment(before,p,{source:'manual'}).record;assert.ok(r.operation.includes('crop'));assert.ok(r.operation.includes('bubble.tail'));assert.ok(r.operation.includes('arrangement'));
 const gap=r.changes.find(c=>c.objectId==='panel_b').fields.find(f=>f.field==='gapBefore');assert.deepEqual(gap,{field:'gapBefore',before:50,after:300});
 assert.deepEqual(r.changes.find(c=>c.objectId==='bubble_a').fields.find(f=>f.field==='tail.x'),{field:'tail.x',before:.5,after:.7});
});
test('paste records the independently identified layer, keeps source asset reference and clone provenance only',()=>{
 const p=fixture(),before=clone(p),newPanel=clone(p.pages[0].panels[0]);newPanel.id='panel_copy';newPanel.y=1200;p.pages[0].panels.push(newPanel);p.layerOrder.push(newPanel.id);
 const r=recordLayoutAdjustment(before,p,{source:'manual',operation:'layer.paste',copiedFrom:{panel_copy:'panel_a'}}).record,c=r.changes.find(c=>c.objectId==='panel_copy');
 assert.equal(c.action,'create');assert.equal(c.copiedFromId,'panel_a');assert.equal(c.fields.find(f=>f.field==='imageAssetId').after,'asset_reference');assert.equal(c.objectId,'panel_copy');assert.equal(before.pages[0].panels.length,2);
});
test('undo and redo append chronological audit operations without rolling back baseline or prior records',()=>{
 let p=fixture();ensureLayoutHistory(p);const original=clone(p);p.pages[0].panels[0].x=25;const first=recordLayoutAdjustment(original,p,{source:'manual'}).record;const moved=clone(p),undo=preserveLayoutHistory(p,clone(original));
 recordLayoutAdjustment(p,undo,{source:'undo',relatedOperationId:first.id});p=undo;assert.equal(p.layoutHistory.records.length,2);assert.equal(p.layoutHistory.records[1].source,'undo');assert.equal(p.layoutHistory.records[1].relatedOperationId,first.id);
 const redo=preserveLayoutHistory(p,clone(moved));recordLayoutAdjustment(p,redo,{source:'redo'});assert.equal(redo.layoutHistory.records.length,3);assert.equal(redo.layoutHistory.records[2].source,'redo');assert.deepEqual(redo.layoutHistory.baseline,original.layoutHistory.baseline);
});
test('save/reopen and JSON/summary export preserve records; filters find object, operation and source',()=>{
 const p=fixture(),before=clone(p);p.pages[0].panels[0].x=22;recordLayoutAdjustment(before,p,{source:'automatic',operation:'layout.reflow'});
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'comic-history-test-'));try{const file=path.join(dir,'synthetic.json');fs.writeFileSync(file,JSON.stringify(p));const reopened=JSON.parse(fs.readFileSync(file,'utf8'));assert.deepEqual(reopened.layoutHistory,p.layoutHistory);assert.equal(queryLayoutHistory(reopened,{objectId:'panel_a',operation:'reflow',source:'automatic'}).length,1);assert.equal(queryLayoutHistory(reopened,{source:'manual'}).length,0);const exported=exportLayoutHistory(reopened);assert.deepEqual(exported.history,p.layoutHistory);exported.history.records[0].operation='changed';assert.equal(p.layoutHistory.records[0].operation,'layout.reflow');assert.match(layoutHistorySummary(reopened),/panel-template.*1.2.*automatic.*panel.x/);}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('循环记录按数量和大小淘汰最旧记录、恢复旧暂停状态，基线保持，后续操作继续记录',()=>{
 const p=fixture();ensureLayoutHistory(p,{limits:{records:2}});const baseline=clone(p.layoutHistory.baseline);for(let x=1;x<=8;x++){const old=clone(p);p.pages[0].panels[0].x=x;assert.equal(recordLayoutAdjustment(old,p).warning,null);}assert.equal(p.layoutHistory.records.length,2);assert.equal(p.layoutHistory.evictedRecords,6);assert.equal(p.layoutHistory.paused,null);assert.equal(p.layoutHistory.records.at(-1).changes[0].fields.find(f=>f.field==='x').after,8);assert.deepEqual(p.layoutHistory.baseline,baseline);
 p.layoutHistory.paused={message:'旧暂停'};p.layoutHistory.unrecordedOperations=130;delete p.layoutHistory.retention;ensureLayoutHistory(p);assert.equal(p.layoutHistory.paused,null);const before=clone(p);p.pages[0].panels[0].x=9;recordLayoutAdjustment(before,p);assert.equal(p.layoutHistory.unrecordedOperations,130);assert.equal(p.layoutHistory.records.length,2);
 const small=fixture();ensureLayoutHistory(small);small.layoutHistory.limits.bytes=Buffer.byteLength(JSON.stringify(small.layoutHistory))+1600;for(let x=1;x<25;x++){const old=clone(small);small.pages[0].panels[0].x=x;recordLayoutAdjustment(old,small);}assert.ok(small.layoutHistory.evictedRecords>0);assert.ok(Buffer.byteLength(JSON.stringify(small.layoutHistory))<=small.layoutHistory.limits.bytes);assert.equal(small.layoutHistory.paused,null);
});

test('whitelist excludes binary images, original art, prompt text, dialogue, mask strokes and unrelated changes',()=>{
 const p=fixture();p.pages[0].panels[0].dataUrl='data:image/png;base64,FORBIDDEN';p.pages[0].panels[0].mask={strokes:[{points:[{x:2,y:3}]}]};p.pages[0].panels[0].imageTransform.dataUrl='data:image/png;base64,FORBIDDEN';p.shots[0].description='SECRET_PROMPT';p.pages[0].bubbles[0].text='PRIVATE_DIALOGUE';ensureLayoutHistory(p);const before=clone(p);p.revision++;p.shots[0].description='changed';assert.equal(recordLayoutAdjustment(before,p).record,null);p.pages[0].panels[0].x=10;recordLayoutAdjustment(before,p,{source:'untrusted'});assert.equal(p.layoutHistory.records[0].source,'unknown');assert.doesNotMatch(JSON.stringify(exportLayoutHistory(p)),/FORBIDDEN|SECRET_PROMPT|PRIVATE_DIALOGUE|strokes/);
});
test('viewer escapes all context and before/after values',()=>{
 const p=fixture(),before=clone(p);p.pages[0].panels[0].borderColor='<script>alert(1)</script>';const r=recordLayoutAdjustment(before,p).record;const html=layoutHistoryRecordMarkup(r);assert.ok(!html.includes('<script>'));assert.match(html,/&lt;script&gt;/);assert.ok(html.includes('之前'));assert.ok(html.includes('之后'));
});
