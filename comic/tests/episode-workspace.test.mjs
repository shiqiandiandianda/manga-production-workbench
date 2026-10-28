import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject,clone,makePage,panel,normalizeRows,layoutLongStrip} from '../public/model.js';
import {episodePages,episodeShots,episodeLayerProject} from '../public/episode-workspace.js';
import {ensureEpisodeBoards} from '../public/episode-boards.js';
import {canvasEpisodeBoards,comicViewOffset} from '../public/episode-board-canvas.js';
import {sourceCharacterStates,parseNamedStates} from '../public/character-states.js';
import {ensurePanelGeneration,resolvePanelGeneration,panelProductionShot} from '../public/panel-generation.js';

import {planAssetBindings} from '../public/asset-auto-bind.js';

test('episode workspace scopes pages, source shots and director gradients without rewriting project coordinates',()=>{
 const project=createProject('合成两话'),first=project.pages[0];first.storyboard={episode:11};first.height=500;project.shots[0].episode=11;
 const second=makePage([],'overlay',1280,600);second.storyboard={episode:12};const shot={...clone(project.shots[0]),id:'shot-second',episode:12};project.shots.push(shot);second.panels=[panel(shot.id,30,40,300,200)];project.pages.push(second);project.gradients=[{id:'g11',designEpisode:11},{id:'g12',designEpisode:12}];ensureEpisodeBoards(project);
 const before=clone(project);assert.deepEqual(episodePages(project,second),[second]);assert.deepEqual(episodeShots(project,second),[shot]);assert.deepEqual(episodeLayerProject(project,second).gradients.map(g=>g.id),['g12']);
 const decorations=canvasEpisodeBoards(project,second),state={mode:'continuous',decorations,layout:layoutLongStrip([decorations.cover.page,second,decorations.tail.page])};assert.equal(comicViewOffset(project,state,layoutLongStrip(project.pages)),500-decorations.cover.page.height);assert.deepEqual(project,before);
 const legacy=createProject();legacy.pages.push(makePage([]));assert.equal(episodePages(legacy,legacy.pages[0]).length,2);
});
test('costume alias and physical states merge by character, preserving both source columns and genuine empty props',()=>{
 const row={'格号':'1','画面内容':'甲走进门。','角色状态（服装/形态）':'甲:白衣；乙:黑袍','人物状态':'甲:左臂包扎','道具状态':''},text=sourceCharacterStates(row);assert.deepEqual(parseNamedStates(text),{entries:[{name:'甲',state:'白衣，左臂包扎'},{name:'乙',state:'黑袍'}],errors:[]});
 const shot=normalizeRows([row])[0];assert.equal(shot.characterStates,text);assert.equal(shot.propStates,undefined);assert.match(shot.productionPrompt,/白衣，左臂包扎/);assert.equal(sourceCharacterStates({'角色状态(服装/形态)':'甲:青衫'}),'甲:青衫');
});
test('old imported panels recover missing source states without overwriting independent edits, explicit clears, images or crops',()=>{
 const project=createProject(),shot=project.shots[0],frame=project.pages[0].panels[0];shot.sourceFields={'角色状态（服装/形态）':'甲:白衣','人物状态':'甲:左臂包扎','道具状态':'剑:入鞘'};shot.characterStates='甲:左臂包扎';shot.propStates='剑:入鞘';ensurePanelGeneration(project,frame);frame.imageAssetId='existing-image';frame.imageTransform={x:4,y:5,scale:.5};
 delete frame.generation.characterStates;delete frame.generation.propStates;const artwork=clone({image:frame.imageAssetId,crop:frame.imageTransform});ensurePanelGeneration(project,frame);assert.equal(frame.generation.characterStates,'甲:白衣，左臂包扎');assert.equal(panelProductionShot(project,frame).propStates,'剑:入鞘');assert.deepEqual({image:frame.imageAssetId,crop:frame.imageTransform},artwork);
 frame.generation.characterStates='甲:人工改成青衫';frame.generation.propStates='';ensurePanelGeneration(project,frame);assert.equal(frame.generation.characterStates,'甲:人工改成青衫');assert.equal(frame.generation.propStates,'');
 frame.generation.characterStates='甲:左臂包扎';project.designLocks=[{objectId:frame.id,fields:['generation.characterStates']}];assert.equal(resolvePanelGeneration(project,frame).characterStates,'甲:左臂包扎');
});

test('episode asset matching updates only chosen shots and pages and preserves the rest of the work',()=>{
 const project=createProject(),first=project.pages[0],second=makePage([]),shot={...clone(project.shots[0]),id:'shot-two',participants:'乙',episode:12};first.storyboard={episode:11};second.storyboard={episode:12};second.panels=[panel(shot.id,10,10,200,200)];project.pages.push(second);project.shots.push(shot);const before=clone(project),result=planAssetBindings(project,[],{sourceShotIds:[shot.id],sourcePageIds:[second.id]});
 assert.equal(result.project.pages.length,2);assert.deepEqual(result.project.pages[0],before.pages[0]);assert.deepEqual(result.project.shots[0],before.shots[0]);assert.equal(result.panelsSynced,1);assert.ok(result.needs.some(need=>need.name==='乙'));assert.ok(!result.needs.some(need=>need.name==='许青'));
});
