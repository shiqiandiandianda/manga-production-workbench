import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareGenerationReferences,stripPromptAspect} from '../lib/generation-reference-order.mjs';
import {CodexBridge,buildImagePrompt} from '../lib/codex.mjs';
import {frameSizingInstructions} from '../public/generation-frame-sizing.js';
import fs from 'node:fs';import path from 'node:path';

const fixture=(prompt,refs,textAssetReferences=[],action='generate')=>({action,shot:{productionPrompt:prompt},panel:{w:1280,h:2417,points:[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}]},referenceRoles:refs,textAssetReferences});
const scene={assetId:'s',name:'兴云庄·冷香小筑｜俯视 · 日间 · 晴（室内）.png',role:'scene'},lin={assetId:'l',name:'林诗音',role:'character'},song={assetId:'g',name:'角色甲',role:'character'};
test('参考文件按提示词名称排序，未覆盖原项目或原始数组',()=>{
 const input=fixture('图1是角色甲，图2是林诗音，图3是兴云庄·冷香小筑。使用图1。独立单格，宽:高4:5。',[scene,song,lin]);const files=['scene.png','song.png','lin.png'];
 const out=prepareGenerationReferences(input,files);
 assert.deepEqual(out.referenceFiles,['song.png','lin.png','scene.png']);assert.deepEqual(out.input.referenceRoles.map(r=>r.assetId),['g','l','s']);
 assert.match(out.input.shot.productionPrompt,/图1是角色甲，图2是林诗音，图3是兴云庄/);assert.doesNotMatch(out.input.shot.productionPrompt,/4:5/);
 assert.deepEqual(files,['scene.png','song.png','lin.png']);assert.match(input.shot.productionPrompt,/4:5/);
 const prompt=buildImagePrompt({...out.input,referenceMode:'view'});assert.match(prompt,/1：character，角色甲\n2：character，林诗音\n3：scene/);assert.match(prompt,/1280 × 2417/);
});
test('文字场景不冒充图片，其余图号和文中引用同步重编号',()=>{
 const input=fixture('图1是场景，图2是林诗音。林诗音按图2，背景按图1。',[lin],[{name:'场景',role:'scene',description:'庭院画幅3:2'}]);
 const out=prepareGenerationReferences(input,['lin.png']);assert.deepEqual(out.referenceFiles,['lin.png']);
 assert.match(out.input.shot.productionPrompt,/场景按文字资产描述绘制，图1是林诗音/);assert.match(out.input.shot.productionPrompt,/林诗音按图1，背景按场景（文字描述）/);assert.doesNotMatch(out.input.textAssetReferences[0].description,/3:2/);
});
test('缺失、重名和未定义的图号拦截，不猜测身份',()=>{
 assert.throws(()=>prepareGenerationReferences(fixture('图1是角色甲，图2是场景。',[song]),['g']),/图2.*没有对应/);
 assert.throws(()=>prepareGenerationReferences(fixture('图1是角色甲。',[song,{...song,assetId:'other'}]),['g','other']),/多个参考/);
 assert.throws(()=>prepareGenerationReferences(fixture('图1是角色甲。再看图2。',[song]),['g']),/图2.*没有对应/);
 assert.throws(()=>prepareGenerationReferences(fixture('图1是角色甲。',[{...song,name:'角色甲之子'}]),['g']),/没有对应/);
});
test('旧通道未提供名称且正文不涉及图号时保留原参考',()=>{
 const input=fixture('画面，宽:高4:5',[]),out=prepareGenerationReferences(input,['unnamed.png']);assert.deepEqual(out.referenceFiles,['unnamed.png']);assert.doesNotMatch(out.input.shot.productionPrompt,/4:5/);
});
test('Codex 桥接实际写出的文件次序和提示词一致，未发送真实任务',async t=>{
 const parent=path.resolve('.runtime/temp');fs.mkdirSync(parent,{recursive:true});const dir=fs.mkdtempSync(path.join(parent,'reference-order-'));let captured;
 const bridge=new CodexBridge({env:{COMIC_CODEX_BIN:process.execPath,COMIC_PYTHON_BIN:process.execPath},workerFactory:()=>({closed:false,close(){this.closed=true},async request(payload){captured={input:JSON.parse(fs.readFileSync(path.join(payload.directory,'input.json'),'utf8')),prompt:fs.readFileSync(path.join(payload.directory,'request.txt'),'utf8')};throw Error('合成桥接截获');}})});
 t.after(()=>{bridge.close();assert.equal(path.dirname(dir),parent);fs.rmSync(dir,{recursive:true,force:true});});
 await assert.rejects(bridge.generate(dir,fixture('图1是林诗音，图2是兴云庄·冷香小筑。宽:高4:5。',[scene,lin]),['scene.png','lin.png']),/合成桥接截获/);
 assert.deepEqual(captured.input.referenceFiles,['lin.png','scene.png']);assert.deepEqual(captured.input.referenceRoles.map(r=>r.name),['林诗音',scene.name]);assert.match(captured.prompt,/1：character，林诗音\n2：scene/);assert.doesNotMatch(captured.prompt,/4:5/);assert.match(captured.prompt,/1280 × 2417/);
});
test('重绘底图占图1，参考与正文图号同时后移',()=>{
 const out=prepareGenerationReferences(fixture('图1是角色甲，图2是林诗音。按图2画。',[lin,song],[],'edit'),['l','g']);
 assert.deepEqual(out.referenceFiles,['g','l']);assert.match(out.input.shot.productionPrompt,/图2是角色甲，图3是林诗音。按图3画/);
 assert.match(buildImagePrompt({...out.input,referenceMode:'view'}),/2：character，角色甲\n3：character，林诗音/);
});
test('只删除画幅比，不破坏比例无关的画面与数量；整屏使用当前画格',()=>{
 const original='整屏宽:高1:3，3格；独立画幅4:5；画面比例3:2。下午3:20，九宫格3×3。';
 const result=stripPromptAspect(original);assert.doesNotMatch(result,/1:3|4:5|3:2(?!0)/);assert.match(result,/下午3:20/);assert.match(result,/九宫格3×3/);
 const input=fixture('整屏宽:高1:3',[song]);input.shot.productionSegment='s';assert.match(frameSizingInstructions(input),/1280 × 2417/);assert.doesNotMatch(frameSizingInstructions(input),/原文1:3/);
});
test('不规则画格只使用当前轮廓实际宽高，资产设定不被重写',()=>{
 const input=fixture('画幅4:5',[song]);input.panel.points=[{x:.25,y:0},{x:.75,y:0},{x:.75,y:1},{x:.25,y:1}];const out=prepareGenerationReferences(input,['g']);const prompt=buildImagePrompt(out.input);
 assert.match(prompt,/目标画格宽 640 px、高 2417 px/);assert.match(prompt,/640 × 2417/);assert.doesNotMatch(prompt,/4:5/);
 const asset={...input,shot:{productionPrompt:'场景16:9横版',assetVisualContract:{role:'scene'}}};assert.strictEqual(prepareGenerationReferences(asset,['g']).input,asset);
});
