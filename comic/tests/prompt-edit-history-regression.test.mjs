import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject,clone} from '../public/model.js';
import {ensureProjectPanelGeneration,panelProductionShot,panelContentKey} from '../public/panel-generation.js';
import {generationPromptSelection,setPanelPromptText,restorePanelPromptText,validPromptOverrides} from '../public/prompt-source.js';
import {inspectorPromptMarkup} from '../public/panel-inspector-content.js';
import {settleInspectorDrafts} from '../public/inspector-drafts.js';
import {layoutEditSnapshot,recordLayoutAdjustment} from '../public/layout-history.js';
import {validateProject} from '../lib/store.mjs';
import {mergeStoryboardImport} from '../lib/storyboard-document.mjs';
import {hydrateProductionSlices} from '../public/production-slice-source.js';

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

test('旧工程本格手改相对来源快照迁移为独立修改，恢复原文后不会复活',()=>{
 const {p,f,s}=fixture();f.generation.prompt='旧工作台手改的本格';ensureProjectPanelGeneration(p);
 assert.equal(generationPromptSelection(f,p).text,'旧工作台手改的本格');assert.equal(s.productionPrompt,'导入原文：甲站在院内。');
 assert.equal(restorePanelPromptText(f),true);ensureProjectPanelGeneration(p);assert.equal(generationPromptSelection(f,p).text,s.productionPrompt);
});
test('旧版当前提示词只迁移到分镜表模式，切换其他模式不会串用并且切回保留手改',()=>{
 const {p,f,s}=fixture();s.sourceFields['直出提示词']='直出原文：院内对话。';
 f.generation.prompt='旧工作台手改的本格';f.generation.promptSource='direct';
 assert.equal(panelProductionShot(p,f).productionPrompt,'直出原文：院内对话。');
 ensureProjectPanelGeneration(p);
 assert.equal(generationPromptSelection(f,p).text,s.sourceFields['直出提示词']);
 assert.deepEqual(f.generation.promptOverrides,{imported:'旧工作台手改的本格'});
 f.generation.promptSource='post-lettering';assert.equal(panelProductionShot(p,f).productionPrompt,s.sourceFields['生图提示词（后期嵌字）']);
 f.generation.promptSource='current';assert.equal(panelProductionShot(p,f).productionPrompt,'旧工作台手改的本格');
 assert.equal(restorePanelPromptText(f),true);ensureProjectPanelGeneration(p);assert.equal(panelProductionShot(p,f).productionPrompt,s.productionPrompt);
});
test('来源更新而本格未手改，不将旧来源误判为本格修改',()=>{
 const {p,f,s}=fixture();s.productionPrompt='新的分镜原文';s.sourceFields['生图提示词']=s.productionPrompt;ensureProjectPanelGeneration(p);
 assert.equal(generationPromptSelection(f,p).text,'新的分镜原文');assert.equal(f.generation.promptOverrides,undefined);
});
test('重新导入分镜时先迁移旧本格修改，未修改的画格采用新原文',()=>{
 for(const edited of [false,true]){
  const {p,f,s}=fixture();s.episode=11;p.pages[0].storyboard={episode:11};p.storyboardImport={episodes:[{episode:11,shotIds:[s.id]}]};
  if(edited)f.generation.prompt='旧版人工修改';
  const incomingShot={...clone(s),id:'shot_incoming',productionPrompt:'新版分镜原文',sourceFields:{'生图提示词':'新版分镜原文'}};
  const incoming={shots:[incomingShot],storyboardImport:{episodes:[{episode:11,shotIds:[incomingShot.id]}]}};
  const next=mergeStoryboardImport(p,incoming),frame=next.pages[0].panels.find(v=>v.id===f.id);
  ensureProjectPanelGeneration(next);
  assert.equal(panelProductionShot(next,frame).productionPrompt,edited?'旧版人工修改':'新版分镜原文');
  assert.equal(frame.generation.prompt,'新版分镜原文');
  assert.equal(f.generation.prompt,edited?'旧版人工修改':'导入原文：甲站在院内。');
  if(edited){assert.equal(restorePanelPromptText(frame),true);assert.equal(panelProductionShot(next,frame).productionPrompt,'新版分镜原文');}
 }
});
test('旧裁格重新绑定分镜记录时保留原有手改提示词',()=>{
 const {p,f}=fixture();f.generation.prompt='旧裁格人工修改';
 f.panelSlice={segmentId:'S1',panelId:'G1',rootPanelId:'parent'};
 p.productionPackage={episodes:[{episode:11,segments:[{id:'S1',references:[]}],panelRecords:[{id:'G1',segmentId:'S1',original:{'生图提示词':'新裁格原文'},production:{},source:{file:'synthetic'}}]}]};
 hydrateProductionSlices(p,[]);assert.equal(f.generation.promptOverrides.imported,'旧裁格人工修改');
 ensureProjectPanelGeneration(p);assert.equal(panelProductionShot(p,f).productionPrompt,'旧裁格人工修改');
 assert.equal(restorePanelPromptText(f),true);assert.equal(panelProductionShot(p,f).productionPrompt,'新裁格原文');
});
