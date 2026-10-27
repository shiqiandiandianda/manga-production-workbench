import test from 'node:test';import assert from 'node:assert/strict';
import {generationPromptChoices,generationPromptSelection} from '../public/prompt-source.js';import {createProject,clone} from '../public/model.js';import {ensurePanelGeneration,panelProductionShot,panelProductionSnapshot,panelContentKey} from '../public/panel-generation.js';import {buildImagePrompt} from '../lib/codex.mjs';import {buildJimengPrompt} from '../lib/jimeng.mjs';import {validateProject} from '../lib/store.mjs';import {layoutEditSnapshot,recordLayoutAdjustment,ensureLayoutHistory} from '../public/layout-history.js';
function fixture(){const project=createProject('合成双提示词'),panel=project.pages[0].panels[0],shot=project.shots.find(s=>s.id===panel.shotId);shot.sourceFields={'生图提示词（后期嵌字）':'后期原文\n画面：合成人物在桥上。\n不要：任何文字、对白气泡和拟声字。','直出提示词':'直出原文\n画面：合成人物在桥上。\n画内文字：「测试对白」\n字体：思源黑体 CN Medium。'};ensurePanelGeneration(project,panel);panel.generation.prompt='人工独立修改，保留这一份';return {project,panel,shot};}
test('两列原文各自选择；已发起任务保留提交快照，后续源更改影响新任务但不影响旧任务',()=>{
 const {project,panel,shot}=fixture(),variants=generationPromptChoices(panel,project);
 assert.equal(variants.find(v=>v.value==='direct').text,shot.sourceFields['直出提示词']);
 assert.equal(variants.find(v=>v.value==='post-lettering').text,shot.sourceFields['生图提示词（后期嵌字）']);
 panel.generation.promptSource='direct';
 const submitted=clone(panelProductionShot(project,panel)),geometry=panelProductionSnapshot(panel),beforeKey=panelContentKey(project,panel);
 assert.equal(submitted.productionPrompt,shot.sourceFields['直出提示词']);
 for(const build of [buildImagePrompt,buildJimengPrompt])assert.match(build({action:'generate',shot:submitted,panel:geometry,style:project.style,referenceRoles:[]}),/直出原文/);
 shot.sourceFields['直出提示词']='更新后的直出原文';
 assert.equal(generationPromptSelection(panel,project).text,'更新后的直出原文');
 assert.equal(panelProductionShot(project,panel).productionPrompt,'更新后的直出原文');
 assert.match(submitted.productionPrompt,/直出原文/);assert.notEqual(submitted.productionPrompt,shot.sourceFields['直出提示词']);
 assert.notEqual(panelContentKey(project,panel),beforeKey);
 panel.generation.promptSource='current';assert.equal(panelProductionShot(project,panel).productionPrompt,'人工独立修改，保留这一份');
});

test('切换来源参与撤销和过期检测；当前列缺失时拒绝生成，不回退到其他列或旧快照',()=>{
 const {project,panel,shot}=fixture();ensureLayoutHistory(project);
 const before=layoutEditSnapshot(project),key=panelContentKey(project,panel);panel.generation.promptSource='direct';
 assert.notEqual(panelContentKey(project,panel),key);
 const record=recordLayoutAdjustment(before,project,{source:'manual',operation:'panel.prompt-source'}).record;
 assert.ok(record.changes.some(change=>change.fields?.some(field=>field.field==='panelContentFingerprint')));
 panel.generation.promptSource='unknown';assert.throws(()=>validateProject(project),/提示词来源/);
 panel.generation.promptSource='direct';delete shot.sourceFields['直出提示词'];
 assert.equal(generationPromptSelection(panel,project).text,'');assert.throws(()=>panelProductionShot(project,panel),/缺少.*提示词/);
 assert.equal(panel.generation.prompt,'人工独立修改，保留这一份');
});
