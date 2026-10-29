import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import {createProject} from '../public/model.js';
import {normalizeArtDirection,panelArtDirection,COMIC_VIEWS,COMIC_LENSES,COMIC_COMPOSITIONS,stripLegacyArtBoilerplate,panelCastAudit,breakoutGenerationPlan,inspectForegroundAlpha} from "../public/comic-art-direction.js";
import {ensurePanelGeneration,panelProductionShot,panelContentKey,generationLayoutInstructions} from '../public/panel-generation.js';
import {buildImagePrompt,sourceKey,inspectTransparentForegroundFile} from "../lib/codex.mjs";
import {buildJimengPrompt} from '../lib/jimeng.mjs';

import {validateShotSettings} from '../public/shot-settings.js';
import {run,findPython} from '../lib/process.mjs';
const copy=value=>structuredClone(value);
const fixture=()=>{const project=createProject('合成漫画'),panel=project.pages[0].panels[0];project.style='清晰线稿赛璐璐漫画';project.shots[0].description='甲走出合成门口，乙跟在身后，好奇地打量甲的背影。';ensurePanelGeneration(project,panel);return {project,panel};};
const inputFor=(project,panel)=>({action:'generate',shot:panelProductionShot(project,panel),style:project.style,panel,referenceRoles:[]});

test('漫画设计严格校验，选项保持单一主视角、单一透视和单一构图，读取不修改输入',()=>{
 const source={view:'worm',lens:'16mm',composition:'diagonal',emotion:'impact',intensity:3,effectsMode:'integrated',effectsWords:[' 踏 ','踏'],designNotes:' 保留既有衣服 '},before=copy(source),d=normalizeArtDirection(source);
 assert.deepEqual(source,before);assert.deepEqual(d.effectsWords,['踏']);assert.equal(d.designNotes,'保留既有衣服');
 for(const value of [{view:['worm','dutch']},{lens:'17mm'},{composition:'不存在'},{emotion:'暴怒猜测'},{intensity:4},{effectsWords:['甲：对白\n乙：对白']},{effectsWords:[123]},{breakout:'fake-white'},{visibleCharacters:['']},{version:99}])assert.throws(()=>normalizeArtDirection(value),error=>error.status===400);
 const first=normalizeArtDirection();first.effectsWords.push('污染');assert.deepEqual(normalizeArtDirection().effectsWords,[]);
});
test('词库覆盖虫视、大仰角、荷兰角、16mm、框式、大特写，同时保留自然叙事选择',()=>{
 for(const id of ['worm','extreme-low','dutch','over-shoulder','pov','close'])assert.ok(COMIC_VIEWS.some(v=>v.id===id));
 for(const id of ['16mm','28mm','85mm'])assert.ok(COMIC_LENSES.some(v=>v.id===id));
 for(const id of ['frame','negative-space','triangle','silhouette','leading-lines'])assert.ok(COMIC_COMPOSITIONS.some(v=>v.id===id));
 for(const angle of ['大仰角','虫视视角','荷兰角'])assert.equal(validateShotSettings({cameraAngle:angle}).cameraAngle,angle);
});

test('编译明确区分事实和设计，不覆盖保存的本格提示词、不堆全部视角',()=>{
 const {project,panel}=fixture(),original=copy(project);panel.artDirection={view:'worm',lens:'16mm',composition:'size-contrast',emotion:'pressure',intensity:2};const before=copy(project),prompt=buildImagePrompt(inputFor(project,panel));
 assert.match(prompt,/原审定画面事实/);assert.match(prompt,/属于设计补充，不能新增故事事实/);assert.match(prompt,/虫视视角/);assert.match(prompt,/16mm大广角/);assert.doesNotMatch(prompt,/荷兰角构图|85mm压缩|鸟瞰或顶视/);assert.match(prompt,/避免真人摄影皮肤、毛孔、半真人面部/);assert.deepEqual(project,before);assert.equal(panel.generation.prompt,original.pages[0].panels[0].generation.prompt);
});

test('剔除可证明是旧机器排版说明的人物整场名单，仅当前描述中的人物进入站位约束',()=>{
 const {project,panel}=fixture();panel.generation.narrativePromptVersion='1.4.0';panel.generation.prompt+='\n示例项目叙事取景规则 1.4.0；只绘制当前阅读单元，不把相邻单元合进一张图。\n当前可见人物与画面横向位置：甲 20%；丙 50%；乙 80%。其余源人物不自动补入本镜头。\n对白、心声、气泡、尾尖、拟声、边框、渐变底与冲刺线由外部图层排版，不生成在原图内；世界内明确铭文除外。';panel.layoutIntent={characterPlacement:[{name:'甲',x:.2},{name:'丙',x:.5},{name:'乙',x:.8}],characterSlots:{甲:{x:.2},丙:{x:.5},乙:{x:.8}}};
 const before=copy(panel);assert.deepEqual(panelCastAudit(panel).unconfirmed,['丙']);assert.doesNotMatch(generationLayoutInstructions(panel,project),/丙/);
 for(const builder of [buildImagePrompt,buildJimengPrompt]){const prompt=builder(inputFor(project,panel));assert.doesNotMatch(prompt,/丙 50%|丙在画面|当前可见人物与画面横向位置/);assert.match(prompt,/甲走出/);assert.match(prompt,/乙跟在/);assert.doesNotMatch(prompt,/拟声、边框、渐变底与冲刺线由外部图层排版/);}
 assert.deepEqual(panel,before);
 assert.equal(stripLegacyArtBoilerplate('甲说：“构图表达目的：这个词是什么意思？”'),'甲说：“构图表达目的：这个词是什么意思？”');
});
test('无明确人物称呼时提出核对而非自动删除；已确认空人物名单也能阻止旧人物站位',()=>{
 const panel={layoutIntent:{characterSlots:{甲:{x:.2}},characterPlacement:[{name:'甲',x:.2}]},generation:{prompt:'他望向合成门口。'}};assert.equal(panelCastAudit(panel).requiresReview,true);assert.equal(panelCastAudit(panel).confirmed,null);panel.artDirection={visibleCharacters:[]};assert.deepEqual(panelCastAudit(panel).unconfirmed,['甲']);
});


test('画面设计参与本格与来源指纹，修改机位或特效路由后旧任务不得静默回填',()=>{
 const {project,panel}=fixture(),key=panelContentKey(project,panel),source=sourceKey(project,panelProductionShot(project,panel));panel.artDirection={view:'dutch'};assert.notEqual(panelContentKey(project,panel),key);assert.notEqual(sourceKey(project,panelProductionShot(project,panel)),source);const next=panelContentKey(project,panel);panel.artDirection.effectsMode='atmosphere';assert.notEqual(panelContentKey(project,panel),next);
});
test('新分镜明确的画面设计随首次画格生成冻结，后续源表修改不覆盖本格设计',()=>{
 const project=createProject('合成来源设计'),panel=project.pages[0].panels[0];project.shots[0].artDirection={view:'worm',lens:'16mm',emotion:'impact'};ensurePanelGeneration(project,panel);assert.equal(panelArtDirection(panel).view,'worm');project.shots[0].artDirection.view='eye';assert.equal(panelArtDirection(panel).view,'worm');panel.artDirection={view:'dutch'};assert.equal(panelArtDirection(panel).view,'dutch');
});

test('资产生成在两通道均采用多视图契约，允许群像编号，不受单格约束',()=>{
 const {project,panel}=fixture(),input={kind:'asset-production',shot:{description:'左侧3×3人脸，右侧9个无头服装身体，完整手脚鞋子。',assetProductionContract:{kind:'crowd',stage:'card',allowLayoutDividers:true,allowAssetCodes:true,transparentBackground:false}},style:project.style,panel,referenceRoles:[]};
 for(const builder of [buildImagePrompt,buildJimengPrompt]){const prompt=builder(input);assert.match(prompt,/左侧3×3人脸/);assert.match(prompt,/允许辅助分区线/);assert.match(prompt,/A01…A09、B01…B09/);assert.doesNotMatch(prompt,/画面只有一个镜头|不画分格边框|角色台词、常规字幕、编号/);assert.match(prompt,/不画剧情对白/);}
});
test('破框计划要求已确认背景、明确主体和Codex真实透明；即梦明确拒绝',()=>{
 const {project,panel}=fixture();panel.artDirection={breakout:'foreground',breakoutSubject:'甲举起的右手及前臂'};let plan=breakoutGenerationPlan(panel);assert.equal(plan.ready,false);assert.match(plan.missing.join(''),/确认背景/);plan=breakoutGenerationPlan(panel,{backgroundAssetId:'asset_synthetic'});assert.equal(plan.ready,true);assert.equal(plan.tasks[1].requireRealAlpha,true);assert.equal(plan.tasks[1].layerRole,'unclipped-foreground');assert.equal(breakoutGenerationPlan(panel,{provider:'jimeng',backgroundAssetId:'asset_synthetic'}).ready,false);
 const input={...inputFor(project,panel),kind:'breakout-foreground',breakoutContract:{subject:panel.artDirection.breakoutSubject},referenceRoles:[{role:'scene',name:'已确认合成背景主图'}]};assert.match(buildImagePrompt(input),/transparent_background=true/);assert.throws(()=>buildJimengPrompt(input),e=>e.code==='transparent_foreground_unsupported');assert.throws(()=>buildImagePrompt({...input,referenceRoles:[]}),/背景主图参考/);
});
test('真实alpha检查拒绝全白不透明PNG、全透明空图和只有极少边缘透明的伪前景',()=>{
 const rgba=alpha=>new Uint8Array(Array.from({length:100},()=>[255,255,255,alpha]).flat());assert.equal(inspectForegroundAlpha({width:10,height:10,data:rgba(255)}).valid,false);assert.equal(inspectForegroundAlpha({width:10,height:10,data:rgba(0)}).valid,false);const good=rgba(255);for(let i=3;i<good.length/2;i+=4)good[i]=0;assert.equal(inspectForegroundAlpha({width:10,height:10,data:good}).valid,true);
 const edge=new Uint8Array(1000*4).fill(255);edge[3]=0;assert.equal(inspectForegroundAlpha({width:100,height:10,data:edge}).valid,false);
});
test('Codex前景验收读取解码后的真实alpha，文件名或PNG头不能冒充透明',async t=>{
 const python=findPython(process.env);assert.ok(python,'test requires existing trusted Python');const dir=fs.mkdtempSync(path.join(os.tmpdir(),'comic-alpha-')),opaque=path.join(dir,'opaque.png'),cutout=path.join(dir,'cutout.png'),fake=path.join(dir,'renamed.png');
 t.after(()=>{assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));fs.rmSync(dir,{recursive:true,force:true});});
 const script="import sys;from PIL import Image;im=Image.new('RGBA',(20,20),(255,255,255,255));im.save(sys.argv[1]);im=Image.new('RGBA',(20,20),(0,0,0,0));im.paste((20,50,90,255),(5,5,15,15));im.save(sys.argv[2]);Image.new('RGB',(20,20),(255,255,255)).save(sys.argv[3],format='JPEG')";
 const made=await run([python],['-c',script,opaque,cutout,fake],{timeout:30000});assert.equal(made.code,0,made.stderr);await assert.rejects(inspectTransparentForegroundFile(opaque,python),/真实透明背景/);assert.equal((await inspectTransparentForegroundFile(cutout,python)).transparentPixels,300);await assert.rejects(inspectTransparentForegroundFile(fake,python),/必须是PNG/);
 await assert.rejects(inspectTransparentForegroundFile(cutout,python,run,{backgroundRect:{x:0,y:0,w:20,h:20},canvas:{w:20,h:20}}),/没有实际越过/);
 const crossing=await inspectTransparentForegroundFile(cutout,python,run,{backgroundRect:{x:8,y:8,w:4,h:4},canvas:{w:20,h:20}});assert.equal(crossing.outsideVisiblePixels,84);assert.equal(crossing.valid,true);
});
