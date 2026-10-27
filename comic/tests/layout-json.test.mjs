import test from 'node:test';import assert from 'node:assert/strict';
import {createProject,clone} from "../public/model.js";

import {panelInfoMarkup} from '../public/panel-info-ui.js';
import {effectiveShotDescription,validateShotSettings} from '../public/shot-settings.js';
import {sourceKey,buildImagePrompt} from '../lib/codex.mjs';import {buildJimengPrompt} from '../lib/jimeng.mjs';import {validateProject} from '../lib/store.mjs';
const esc=value=>String(value).replaceAll('<','&lt;').replaceAll('>','&gt;');









test('审定分镜的人工提示词及镜头参数独立保存，并进入两种生图渠道和任务校验码',()=>{
 const project=createProject(),shot=project.shots[0];shot.description='画面内容：人物看向湖面\n景别：远景；机位角度：平视';shot.storyboard={format:'production',clientFields:{景别:'远景',机位角度:'平视'}};
 const original=shot.description,key=sourceKey(project,shot),before=clone(shot.storyboard);Object.assign(shot,{productionPrompt:'人物低头察看手中玉佩。',shotSize:'特写',cameraAngle:'俯拍'});
 const text=effectiveShotDescription(shot);assert.ok(text.includes('人物低头'));assert.ok(text.includes('景别：特写'));assert.ok(text.includes('机位角度：俯拍'));assert.equal(shot.description,original);assert.deepEqual(shot.storyboard,before);assert.notEqual(sourceKey(project,shot),key);
 const input={action:'generate',shot,panel:project.pages[0].panels[0],style:'漫画',referenceRoles:[]};assert.match(buildImagePrompt(input),/景别：特写/);assert.match(buildJimengPrompt(input),/机位角度：俯拍/);validateProject(project);
});



test('格内提示词显示转义文本且不会修改画面或写入导出数据',()=>{
 const frame=createProject().pages[0].panels[0],before=clone(frame),shot={code:'S01',description:'<script>这是提示词</script>',shotSize:'近景'};
 const markup=panelInfoMarkup(frame,shot,esc);assert.ok(markup.includes('S01'));assert.ok(markup.includes('近景'));assert.ok(!markup.includes('<script>'));assert.deepEqual(frame,before);assert.throws(()=>validateShotSettings({productionPrompt:'x'.repeat(20001)}),/20000/);
});
