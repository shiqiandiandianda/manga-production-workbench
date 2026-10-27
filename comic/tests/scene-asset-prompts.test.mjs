import test from 'node:test';import assert from 'node:assert/strict';
import {sceneFacts,sceneAssetSpec,sceneCameraPlan,sceneFrontPrompt,sceneReversePrompt,propAssetPrompt,asset2DStyle,PROP_CARD_LAYOUT_RULES} from '../lib/scene-asset-prompts.mjs';
import {assessSceneReverse,SCENE_SIGNATURE} from '../../asset-studio/app/roles/scene-image-review.mjs';
import {assetStagePrompt,prepareAssetGeneration,initializeProductionAsset} from '../lib/asset-production.mjs';
import {buildImagePrompt} from '../lib/codex.mjs';import {buildJimengPrompt} from '../lib/jimeng.mjs';
import {resolvePanelGeneration,panelProductionShot} from '../public/panel-generation.js';

export const sceneSource=`制作漫画生产用场景参考资产：聚缘阁雅间。
本次服装 / 形态 / 状态：未指定（原创候选，待确认）。
当前格分镜原文（仅作资产外观与用途依据，不画成剧情镜头）：
全景，俯拍，对称构图，情绪：平静，画面张力 1/3。
画面：雅间圆桌北席宋凌天朝南、东席叶麟朝西、南席王长生朝北；门在东南，西窗透入上午漫射天光。各人杯碗分开，早点在桌心。
人物与表情：宋凌天（灵剑峰内门道袍）；叶麟（太玄杂役道袍）；王长生（雷云峰外门道袍）
动作：宋凌天朝南坐直，望两友；叶麟朝西落座，望宋；王长生朝北坐，望宋
构图：全景；宋凌天在画面上方北席；叶麟在画面右侧东席；王长生在画面下方南席。
光影：上午西窗漫射天光，西面受光；不出现月夜室内光
画面里的道具：茶杯与早点餐具（场景中）
其余随身道具（不必画出）：玄铁剑（叶麟）:叶麟身上；连鞘佩剑（宋凌天）:宋凌天身上
场景：聚缘阁雅间，上午，室内
不要：人物长相、服装以参考为准；手指数量正常；重伤不画血腥特写`;
const record={name:'聚缘阁雅间',prompt:sceneSource,sceneMeta:{camera:'俯拍'}},project={style:'3D国漫，电影CG渲染，PBR，长条漫画，竖向1:3'};
test('场景从真实分镜提取空间，保留门窗和餐具，移除人物、动作、隐去道具与整页要求',()=>{
 const facts=sceneFacts(sceneSource,{name:record.name});for(const value of ['北侧、东侧、南侧','门在东南','西窗','上午','杯碗','早点在桌心','茶杯与早点餐具'])assert.ok(facts.includes(value),facts);
 for(const value of ['宋凌天','叶麟','王长生','道袍','玄铁剑','佩剑','手指','张力','1/3','血腥'])assert.ok(!facts.includes(value),value);
 assert.equal(sceneAssetSpec(record).time,'上午');const front=sceneFrontPrompt(record,project);assert.match(front,/二维动漫/);assert.match(front,/禁止3D国漫/);assert.doesNotMatch(front,/电影CG|竖向1:3|本次服装/);assert.equal(sceneFacts(front),facts);
});
test('机位规划共用固定轴线，旧正打没有轴线时根据图像反向观察，不伪造方位',()=>{
 const plan=sceneCameraPlan({...record,sceneMeta:{camera:'平视，由东向西'}});assert.match(plan.front,/东侧，朝西/);assert.match(plan.reverse,/西侧，朝东/);
 assert.throws(()=>sceneCameraPlan({...record,sceneMeta:{camera:'南向北'},reverseCamera:'东向西'}),/朝向不一致/);
 const reverse=sceneReversePrompt({...record,scenePlan:plan},project);assert.match(reverse,/西侧，朝东/);assert.match(reverse,/原正打远端墙面现在位于相机B身后/);assert.doesNotMatch(reverse,/宋凌天|石灯笼固定|电影CG/);
 assert.match(sceneReversePrompt(record),/以附图前景到远景的主空间轴线为准/);
 const outside=sceneReversePrompt({name:'林道',prompt:'青石道路两侧是竹林，清晨薄雾。'});assert.match(outside,/相反方向观察来路/);assert.doesNotMatch(outside,/背景转为原相机A所在一侧的墙面/);
});
test('场景和道具的最终通道不会追加工程的3D或竖屏画风，普通漫画原文不变',()=>{
 const prompt=sceneFrontPrompt(record,project),shot={id:'s',description:prompt,assetVisualContract:{role:'scene',version:2}},p={id:'p',style:project.style,shots:[shot],references:[]},panel={id:'f',shotId:'s',referenceIds:[],x:0,y:0,w:1536,h:864,points:[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}]};
 panel.generation=resolvePanelGeneration(p,panel);const generated=panelProductionShot(p,panel);assert.equal(generated.assetVisualContract.role,'scene');
 const input={shot:generated,panel,style:project.style,referenceRoles:[]};for(const final of [buildImagePrompt(input),buildJimengPrompt(input)]){assert.match(final,/二维动漫/);assert.doesNotMatch(final,/电影CG渲染|长条漫画|竖向1:3/);}
 const ordinary=buildImagePrompt({shot:{description:'用户原始漫画提示词'},panel,style:'用户原始漫画风格'});assert.match(ordinary,/用户原始漫画提示词/);assert.match(ordinary,/用户原始漫画风格/);
});
test('道具独立组件与最终请求强制二维，保留结构描述',()=>{
 const prompt=propAssetPrompt({name:'古式油灯',prompt:'浅口铜灯盏、一根灯芯、没有玻璃罩。3D国漫，PBR渲染。'},project);assert.match(prompt,/浅口铜灯盏/);assert.ok(prompt.includes(PROP_CARD_LAYOUT_RULES));assert.match(prompt,/顶部只写道具名称/);assert.match(prompt,/侧视图、背面视图、关键结构局部/);assert.match(prompt,/禁止3D国漫/);assert.doesNotMatch(prompt,/3D国漫，PBR渲染/);
 const asset=initializeProductionAsset({id:'P001',name:'古式油灯',type:'prop',description:'浅口铜灯盏，一根灯芯，没有玻璃罩。'}),p={id:'p',title:'合成道具',revision:1,style:project.style,productionAssets:[asset],references:[]};const r=prepareAssetGeneration(p,{revision:1,assetId:asset.id,stageId:'prop-card',provider:'codex'});assert.match(r.prompt,/二维动漫/);assert.match(r.bridgeInput.style,/二维动漫/);assert.doesNotMatch(r.bridgeInput.style,/电影CG/);assert.doesNotMatch(assetStagePrompt(project,{...asset,type:'prop'},{component:'prop'}),/人物身份|同一个人/);
 assert.doesNotMatch(asset2DStyle(project.style),/竖向1:3|电影CG/);
});
test('镜像检查拒绝原图、镜像和调色镜像，接受真正不同的结构',()=>{
 const {width:w,height:h}=SCENE_SIGNATURE,front=Float32Array.from({length:w*h},(_,i)=>30+(i%w)*1.2+Math.sin(i/7)*20+(i%19)*2),mirror=Float32Array.from(front,(_,i)=>front[Math.floor(i/w)*w+w-1-i%w]),tinted=Float32Array.from(mirror,v=>v*.8+28),other=Float32Array.from(front,(_,i)=>70+Math.sin(i/23)*24+(i%31)*2);
 assert.equal(assessSceneReverse(front,front).status,'rejected');assert.match(assessSceneReverse(front,mirror).reason,/镜像/);assert.match(assessSceneReverse(front,tinted).reason,/镜像/);assert.equal(assessSceneReverse(front,other).status,'passed-duplicate-check');
});
