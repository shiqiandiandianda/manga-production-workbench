import test from 'node:test';
import assert from 'node:assert/strict';
import {createProject} from '../../public/model.js';
import {panelDisplayData} from '../../public/panel-display.js';

test('整屏缺少出场人物时明确显示段级参考；单格不把段级参考猜成出场人物',()=>{
 const project=createProject('合成屏段'),frame=project.pages[0].panels[0],shot=project.shots[0];
 const segment={id:'S1',episode:1,panelIds:['G1'],references:[{'类型':'设定卡','人物':'角色甲','服装':'蓝衣'},{'类型':'设定卡','人物':'角色乙','服装':'黑衣'}]};
 project.productionPackage={episodes:[{episode:1,segments:[segment],panelRecords:[{id:'G1',segmentId:'S1',original:{}}]}]};frame.productionSegment='S1';
 const screen=panelDisplayData(frame,shot,project);assert.match(screen.characters,/分镜未标注出场人物/);assert.match(screen.characters,/本段参考：角色甲（蓝衣）、角色乙（黑衣）/);assert.deepEqual(screen.characterCards,[]);
 delete frame.productionSegment;frame.panelSlice={panelId:'G1',segmentId:'S1'};
 const grid=panelDisplayData(frame,shot,project);assert.equal(grid.characters,'本格未声明出场人物');assert.deepEqual(grid.characterCards,[]);
 project.productionPackage.episodes[0].panelRecords[0].original['出现角色']='角色甲、角色乙';
 const named=panelDisplayData(frame,shot,project);assert.equal(named.characters,'角色甲、角色乙');assert.deepEqual(named.characterCards.map(c=>c.name),['角色甲','角色乙']);
});
