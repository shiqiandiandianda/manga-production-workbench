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
test('回填比较忽略独立提示词未采用的来源变更，但继续检测当前内容、模式及参考变化',()=>{
 const {p,f,s}=fixture();setPanelPromptText(f,'本格明确采用的提示词');const before=panelContentKey(p,f);
 s.productionPrompt='新的分镜来源';s.description='更新的来源说明';s.sourceFields['生图提示词']='新的分镜来源';ensureProjectPanelGeneration(p);
 assert.equal(panelContentKey(p,f),before);
 setPanelPromptText(f,'本格实际改动');assert.notEqual(panelContentKey(p,f),before);
 setPanelPromptText(f,'本格明确采用的提示词');f.referenceIds=['asset_new_reference'];assert.notEqual(panelContentKey(p,f,[{id:'asset_new_reference',name:'合成参考',mime:'image/png'}]),before);f.referenceIds=[];
 f.generation.promptSource='post-lettering';assert.notEqual(panelContentKey(p,f),before);
 const fresh=fixture(),sourceKey=panelContentKey(fresh.p,fresh.f);fresh.s.sourceFields['生图提示词']='未手改时采用新来源';assert.notEqual(panelContentKey(fresh.p,fresh.f),sourceKey);
});
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


test('legacy manual prompt migrates once without changing source, and reset cannot resurrect it',()=>{
 const {p,f,s}=fixture();delete f.generation.promptEditVersion;f.generation.prompt='旧版手工修改';
 const source=clone(s);ensureProjectPanelGeneration(p);
 assert.equal(generationPromptSelection(f,p).text,'旧版手工修改');assert.deepEqual(s,source);
 const copy=clone(p);ensureProjectPanelGeneration(copy);assert.equal(generationPromptSelection(copy.pages[0].panels[0],copy).text,'旧版手工修改');
 assert.equal(restorePanelPromptText(f),true);ensureProjectPanelGeneration(p);assert.equal(generationPromptSelection(f,p).text,source.productionPrompt);
});
test('unchanged legacy source cache does not become a manual override when source changes',()=>{
 const {p,f,s}=fixture();delete f.generation.promptEditVersion;s.productionPrompt='新导入原文';s.sourceFields['生图提示词']='新导入原文';
 ensureProjectPanelGeneration(p);assert.equal(generationPromptSelection(f,p).text,'新导入原文');assert.equal(f.generation.promptOverrides,undefined);
});
