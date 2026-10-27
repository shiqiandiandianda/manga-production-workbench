import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject,clone} from '../public/model.js';
import {ensureProjectPanelGeneration,panelProductionShot,panelContentKey} from '../public/panel-generation.js';
import {generationPromptSelection,setPanelPromptText,restorePanelPromptText,validPromptOverrides} from '../public/prompt-source.js';
import {inspectorPromptMarkup} from '../public/panel-inspector-content.js';
import {settleInspectorDrafts} from '../public/inspector-drafts.js';
import {layoutEditSnapshot,recordLayoutAdjustment} from '../public/layout-history.js';
import {validateProject} from '../lib/store.mjs';

function fixture(){
 const p=createProject('提示词编辑与撤回回归'),f=p.pages[0].panels[0],s=p.shots.find(s=>s.id===f.shotId);
 s.productionPrompt='导入原文：甲站在院内。';s.sourceFields={'生图提示词':'导入原文：甲站在院内。','生图提示词（后期嵌字）':'无泡原文：保留院内动作。'};
 ensureProjectPanelGeneration(p);return {p,f,s};
}
test('editing is local to this panel and prompt mode; reload preparation and both adapters select the edited text',()=>{
 const {p,f,s}=fixture(),original=clone(s),key=panelContentKey(p,f),before=layoutEditSnapshot(p);
 setPanelPromptText(f,'人工修改：平视，保留整只手。');
 assert.equal(generationPromptSelection(f,p).text,'人工修改：平视，保留整只手。');
 assert.equal(panelProductionShot(p,f).productionPrompt,'人工修改：平视，保留整只手。');assert.notEqual(panelContentKey(p,f),key);
 ensureProjectPanelGeneration(p);assert.equal(generationPromptSelection(f,p).text,'人工修改：平视，保留整只手。');assert.deepEqual(s,original);validateProject(p);
 const audit=recordLayoutAdjustment(before,p,{source:'manual',operation:'panel.prompt-edit'}).record;assert.ok(audit.changes.some(c=>c.fields.some(f=>f.field==='panelContentFingerprint')));
 f.generation.promptSource='post-lettering';assert.equal(generationPromptSelection(f,p).text,s.sourceFields['生图提示词（后期嵌字）']);setPanelPromptText(f,'手改无泡');
 f.generation.promptSource='imported';assert.equal(generationPromptSelection(f,p).text,'人工修改：平视，保留整只手。');
 assert.equal(restorePanelPromptText(f),true);assert.equal(generationPromptSelection(f,p).text,original.productionPrompt);
 f.generation.promptSource='post-lettering';assert.equal(generationPromptSelection(f,p).text,'手改无泡');
});
test('explicit empty override never falls back to imported text; undo snapshot and restore remain distinct',()=>{
 const {p,f}=fixture(),before=layoutEditSnapshot(p);setPanelPromptText(f,'');assert.equal(generationPromptSelection(f,p).text,'');assert.throws(()=>panelProductionShot(p,f),/缺少/);
 const restored=clone(before);ensureProjectPanelGeneration(restored);assert.match(generationPromptSelection(restored.pages[0].panels[0],restored).text,/导入原文/);
 restorePanelPromptText(f);assert.match(panelProductionShot(p,f).productionPrompt,/导入原文/);
});
test('editable inspector escapes text, honors lock, and provides a separate restore action',()=>{
 const {p,f}=fixture(),escape=s=>String(s).replaceAll('<','&lt;').replaceAll('>','&gt;');setPanelPromptText(f,'<测试>');
 const html=inspectorPromptMarkup(f,p,escape);assert.doesNotMatch(html,/<textarea[^>]*readonly/);assert.match(html,/data-section="panel-prompt"/);assert.match(html,/&lt;测试&gt;/);assert.match(html,/restore-panel-prompt/);
 f.locked=true;assert.match(inspectorPromptMarkup(f,p,escape),/<textarea[^>]*disabled/);
});
test('detached property inputs finalize their earliest transaction once and cannot permanently block undo',()=>{
 const {p,f}=fixture(),before=layoutEditSnapshot(p),drafts=new Map([[{isConnected:false},before]]),commits=[];f.x+=17;
 assert.equal(settleInspectorDrafts(drafts,p,b=>commits.push(b)),true);assert.equal(drafts.size,0);assert.equal(commits.length,1);assert.equal(commits[0].pages[0].panels[0].x,f.x-17);
 assert.equal(settleInspectorDrafts(drafts,p,b=>commits.push(b)),false);assert.equal(commits.length,1);
});
test('pending edits from a previous project clear without replaying a foreign snapshot',()=>{
 const {p}=fixture(),other=createProject('另一个工程'),drafts=new Map([[{},layoutEditSnapshot(other)]]);let committed=false;
 assert.equal(settleInspectorDrafts(drafts,p,()=>committed=true),false);assert.equal(committed,false);assert.equal(drafts.size,0);
});
test('backend validates edited prompt keys, type and length while retaining legacy project compatibility',()=>{
 const {p,f}=fixture();assert.ok(validPromptOverrides(undefined));
 for(const value of [[],{wrong:'x'},{imported:3},{imported:'a'.repeat(20001)}]){f.generation.promptOverrides=value;assert.throws(()=>validateProject(p),/修改提示词/);}
 f.generation.promptOverrides={imported:'有效本格修改',direct:'', 'post-lettering':'无泡'};assert.doesNotThrow(()=>validateProject(p));
});
