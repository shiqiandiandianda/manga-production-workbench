// 《大周玄衣卫》专属模板已整体下线：新排版只用通用模板；旧工程照常打开、重排和生图，提示词里不再出现专属规则。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {createProject,rectangle,normalizeRows} from '../public/model.js';


import {ensurePanelGeneration,resolvePanelGeneration,panelProductionShot,panelProductionSnapshot} from "../public/panel-generation.js";
import {buildImagePrompt} from '../lib/codex.mjs';
import {buildJimengPrompt} from '../lib/jimeng.mjs';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const RETIRED_TEXT=/大周|只绘制当前阅读单元|本层表达职责|构图表达目的|分镜构图重点|当前可见人物与画面横向位置|脸部\/上身特写直接生成/;
const builders=[buildImagePrompt,buildJimengPrompt];
const prompts=(p,f)=>builders.map(build=>build({action:'generate',shot:panelProductionShot(p,f),panel:panelProductionSnapshot(f,p),style:p.style,referenceRoles:[]}));

/** 旧工程里保存下来的专属模板阅读单元画格（合成数据）。 */
function legacyUnitPanel(){
 const p=createProject('旧专属模板工程'),s=p.shots[0],f=p.pages[0].panels[0];
 Object.assign(s,{description:'甲与乙交谈后，乙离开。',dialogue:'甲：先等一下。\n乙：我去看看。',shotSize:'全景',cameraAngle:'侧拍'});
 Object.assign(f,{x:100,y:100,w:400,h:400,points:rectangle(),layoutIntent:{templateId:'dazhou-xuanyiwei',templateVersion:'1.4.0',narrativePolicyVersion:'1.4.0',visualPurpose:'response',
  contentProfile:'face',compositionFocus:'甲的表情与目光',shotScale:'close',characterSlots:{甲:{x:.2}},safeArt:{x:40,y:40,w:320,h:320},
  readingUnit:{id:s.id+'/response',localId:'response',purpose:'response',focus:'甲',description:'甲抬眼，严肃开口。',keyAction:'甲手指拢起',utterances:[{speaker:'甲',type:'speech',text:'先等一下。'}]}}});
 return {p,s,f};
}



test('源码里没有任何文件再引用已删除的专属模板模块',()=>{
 for(const dir of ['public','lib'])for(const name of fs.readdirSync(path.join(root,dir)).filter(n=>/\.(m?js)$/.test(n))){
  const text=fs.readFileSync(path.join(root,dir,name),'utf8');
  assert.doesNotMatch(text,/from '\.\/dazhou-|art-edge-colors/,dir+'/'+name);
 }
 for(const name of ['dazhou-templates.js','dazhou-rhythm.js','dazhou-reading-units.js','dazhou-observations.js','art-edge-colors.js'])assert.equal(fs.existsSync(path.join(root,'public',name)),false,name);
});

test('旧工程已保存的专属规则行在生图前被清掉，本格描述照常保留',()=>{
 const {p,f}=legacyUnitPanel();ensurePanelGeneration(p,f);
 f.generation.narrativePromptVersion='1.4.0';
 f.generation.prompt='甲抬眼，严肃开口。\n大周玄衣卫叙事取景规则 1.4.0；只绘制当前阅读单元，不把相邻单元合进一张图。\n本层表达职责：response；视觉重点：甲。\n构图表达目的：甲的表情与目光\n当前可见人物与画面横向位置：甲 20%。其余源人物不自动补入本镜头。\n脸部/上身特写直接生成可读细节，不先画全景再强放大；动作镜头保留必要的手、脚、道具及通道。';
 for(const prompt of prompts(p,f)){assert.match(prompt,/甲抬眼，严肃开口/);assert.doesNotMatch(prompt,RETIRED_TEXT);}
});

test('旧阅读单元画格首次生成提示词时只用单元自己的描述与台词，不再附加专属规则',()=>{
 const {p,f}=legacyUnitPanel(),g=resolvePanelGeneration(p,f);
 assert.equal(g.prompt,'甲抬眼，严肃开口。');assert.equal(g.dialogue,'甲：先等一下。');assert.equal(g.shotSize,'近景');
 assert.equal(g.narrativePromptVersion,undefined);assert.equal(g.readingUnitId,f.layoutIntent.readingUnit.id);
 ensurePanelGeneration(p,f);for(const prompt of prompts(p,f))assert.doesNotMatch(prompt,RETIRED_TEXT);
});




