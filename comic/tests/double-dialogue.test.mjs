import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {addDialogueSegment,mergeDialogueBubbles,validDialogueSegments,bubbleSourceTextIds} from '../public/bubble-dialogue-segments.js';
import {bubbleLayout,paintBubble,svgBubbleMarkup,svgBubbleSelectionMarkup} from '../public/lettering.js';
import {applyBubbleEdit} from '../public/bubble-editor.js';
import {bubbleFieldChange} from '../public/editor-state.js';
import {applyBubbleMaterial} from '../public/bubble-material.js';
import {editBubblePart} from '../public/bubble-parts.js';
import {applySliceDialogueGroups,createSliceDialogueGroup,groupTextRegions,updateGroupTextRegion} from '../public/slice-dialogue-groups.js';
import {selectedProductionSegment} from '../public/production-workspace.js';
import {productionSegmentUnit,switchProductionSegmentUnit} from '../public/production-episode-layout.js';
import {syntheticFiles} from './fixtures/production-synthetic.mjs';
import {inspectProductionPackage} from '../lib/production-package.mjs';
import {productionProject} from '../lib/production-package-document.mjs';
import {productionFrame,applyProductionLettering} from '../public/production-package-model.js';
import {prepareProductionPanel,applyProductionPanelLettering} from '../public/production-panel-generation.js';
import {normalizeLayerOrder} from '../public/layers.js';
import {createProject,id} from '../public/model.js';
import {validateProject} from '../lib/store.mjs';
const {createCanvas}=createRequire(import.meta.url)(process.env.COMIC_TEST_CANVAS_MODULE),ctx=createCanvas(1000,1000).getContext('2d');
const first=()=>({id:id('bubble'),type:'speech',visible:true,x:80,y:60,w:350,h:160,fontSize:36,text:'在下青城派掌门余沧海，阁下又是何人？',productionTextId:'E011-T001',productionSegment:'E011-S001',productionGridId:'E011-001',speaker:'余沧海',parentPanelId:'parent'});
const second=()=>({...first(),id:id('bubble'),text:'刚才可是你杀了我门下弟子？',productionTextId:'E011-T004',y:230});
test('合并保留两句原文及来源，固定字号并在溢出时提示',()=>{
 const a=first(),b=second(),snapshot=structuredClone([a,b]),merged=mergeDialogueBubbles(a,b),layout=bubbleLayout(ctx,merged);
 assert.equal(validDialogueSegments(merged),true);assert.deepEqual([a,b],snapshot);assert.deepEqual(bubbleSourceTextIds(merged),['E011-T001','E011-T004']);assert.equal(layout.dialogueLayouts.length,2);assert.equal(layout.overflow,true);assert.ok(layout.dialogueLayouts.every(part=>part.fontSize===merged.fontSize&&!part.autoFitted));
 assert.equal(layout.lines.map(l=>l.text).join(''),a.text+b.text);
 for(const part of layout.dialogueLayouts)for(const line of part.lines)if(!line.overflow)assert.ok(line.width<=line.availableWidth+.01);
 assert.deepEqual(paintBubble(ctx,merged).dialogueLayouts,layout.dialogueLayouts);
 const svg=svgBubbleMarkup(ctx,merged);assert.equal((svg.match(/data-dialogue-segment=/g)||[]).length,2);assert.match(svg,/data-overflow="true"/);
 const controls=svgBubbleSelectionMarkup(ctx,merged);assert.equal((controls.match(/<rect data-bubble-handle="segment-move"/g)||[]).length,2);assert.match(controls,/data-bubble-handle="segment-resize" data-bubble-point="1"/);
});
test('双圆新增第二段、独立改字/拖动/换行，另一段和气泡不动',()=>{
 const one=applyBubbleMaterial(first(),'builtin-double'),b=addDialogueSegment(one,'第二段'),before=structuredClone(b);
 const moved=applyBubbleEdit(b,{type:'segment-move',index:0,dx:10,dy:5});assert.ok(moved.dialogueSegments[0].independentBox.x>b.dialogueSegments[0].textBox.x*b.w);assert.deepEqual(moved.dialogueSegments[1],b.dialogueSegments[1]);assert.deepEqual([moved.x,moved.y,moved.w,moved.h],[b.x,b.y,b.w,b.h]);
 const resized=applyBubbleEdit(moved,{type:'segment-resize',index:1,dx:-25,dy:10});assert.deepEqual(resized.dialogueSegments[0],moved.dialogueSegments[0]);assert.ok(resized.dialogueSegments[1].independentBox.w<moved.dialogueSegments[1].textBox.w*b.w);
 const edited=bubbleFieldChange(resized,'bubble-segment-1','text','单独编辑第二段\n保留回车');assert.equal(edited.dialogueSegments[0].text,b.text.split('\n\n')[0]);assert.match(edited.text,/单独编辑第二段/);assert.equal(validDialogueSegments(edited),true);assert.deepEqual(b,before);const layout=bubbleLayout(ctx,edited);assert.equal(layout.overflow,true);assert.ok(layout.dialogueLayouts.every(part=>part.fontSize===edited.fontSize&&!part.autoFitted));assert.equal(layout.lines.map(line=>line.text).join(''),edited.text.replaceAll('\n',''));
 assert.throws(()=>addDialogueSegment(edited),/已有两段/);assert.throws(()=>mergeDialogueBubbles({...first(),locked:true},second()),/解锁/);assert.throws(()=>mergeDialogueBubbles(first(),{...second(),parentPanelId:'other'}),/同一格/);
});
test('长文、手动换行、竖排和外框缩放均保留两段和用户字号',()=>{
 for(const mode of ['horizontal','vertical'])for(const size of [160,350,800]){
  const b=mergeDialogueBubbles(first(),second(),{x:20,y:20,w:size,h:size*.9});b.fontSize=72;b.writingMode=mode;b.dialogueSegments[1].text='这是很长的第二段台词，必须完整放在气泡里面。'.repeat(8);b.text=b.dialogueSegments.map(s=>s.text).join('\n\n');
  const l=bubbleLayout(ctx,b);assert.equal(l.lines.map(l=>l.text).join(''),b.text.replaceAll('\n',''));assert.equal(validDialogueSegments(b),true);assert.equal(l.overflow,l.dialogueLayouts.some(part=>part.overflow));assert.ok(l.dialogueLayouts.every(part=>part.fontSize===72&&!part.autoFitted));
 }
});
test('上圆移动不改变文字框；保存校验拒绝坏数据',()=>{
 const b=mergeDialogueBubbles(first(),second()),n=editBubblePart(b,0,{dx:8,dy:5});assert.deepEqual(n.dialogueSegments[0].textBox,b.dialogueSegments[0].textBox);assert.deepEqual(n.dialogueSegments[1],b.dialogueSegments[1]);
 const p=createProject('独立测试',true),pg=p.pages[0];delete b.parentPanelId;pg.bubbles=[b];normalizeLayerOrder(p);validateProject(p);validateProject(JSON.parse(JSON.stringify(p)));
 b.dialogueSegments[0].textBox.w=NaN;assert.throws(()=>validateProject(p),/独立台词/);assert.equal(validDialogueSegments({...n,text:'lost'}),false);
});
test('裁格合并连续应用不复制台词，后续自动/手动排字都识别两个来源',async()=>{
 const p=productionProject(await inspectProductionPackage(syntheticFiles())),ep=p.productionPackage.episodes[0],seg=ep.segments[0],root=productionFrame(p,seg.id),pg=p.pages.find(pg=>pg.panels.includes(root));root.imageAssetId=id('asset');root.generation.promptSource='post-lettering';
 ep.texts.push({...structuredClone(ep.texts[0]),'文字ID':'E011-T004','文本':second().text,'分行':[second().text]});
 const args={regions:{'E011-001':{x:.03,y:.02,w:.94,h:.95}},positions:{},confirmed:true};applyProductionLettering(p,seg.id,args);
 const texts=ep.texts.filter(t=>t['段ID']===seg.localId&&t['渲染']==='工具'),positions={},groups={},existing=new Map(pg.bubbles.map(b=>[b.productionTextId,b]));
 const g=createSliceDialogueGroup(['E011-T001','E011-T004'],{texts,positions,groups,existing,regions:args.regions,preview:{width:400,height:1200}});applySliceDialogueGroups(p,seg,root,[g],r=>r);
 assert.equal(pg.bubbles.filter(b=>b.productionSegment===seg.id).length,1);assert.equal(pg.bubbles[0].dialogueSegments.length,2);
 applyProductionLettering(p,seg.id,{...args,replace:true});applySliceDialogueGroups(p,seg,root,[g],r=>r);assert.equal(pg.bubbles.length,1);
 const panel=prepareProductionPanel(p,seg.id,'E011-001').panel;pg.bubbles[0].parentPanelId=panel.id;assert.equal(applyProductionPanelLettering(p,seg.id,'E011-001').created,0);
 const prior=structuredClone(g.segments[1]),pos=groupTextRegions(g)['E011-T001'];updateGroupTextRegion(groups,'E011-T001',{...pos,x:pos.x+.01});assert.deepEqual(g.segments[1],prior);
});
test('选择当前屏段始终优先于左侧旧记忆，模式切换仅改变对应屏段',async()=>{
 const p=productionProject(await inspectProductionPackage(syntheticFiles())),ep=p.productionPackage.episodes[0],a=ep.segments[0],b=ep.segments[1],rootA=productionFrame(p,a.id),rootB=productionFrame(p,b.id),pa=p.pages.find(pg=>pg.panels.includes(rootA)),pb=p.pages.find(pg=>pg.panels.includes(rootB));
 const panel=prepareProductionPanel(p,a.id,a.panelIds[0]).panel;switchProductionSegmentUnit(p,a.id,'panel');const aBefore=JSON.stringify(pa);
 assert.equal(selectedProductionSegment(p,ep,rootB,{current:a.id,remembered:a.id}),b.id);assert.equal(productionSegmentUnit(p,ep.episode,b.id),'screen');
 prepareProductionPanel(p,b.id,b.panelIds[0]);switchProductionSegmentUnit(p,b.id,'panel');assert.equal(JSON.stringify(pa),aBefore);assert.equal(rootA.visible,false);assert.equal(panel.visible,true);
 const bBefore=JSON.stringify(pb);switchProductionSegmentUnit(p,a.id,'screen');assert.equal(JSON.stringify(pb),bBefore);assert.equal(productionSegmentUnit(p,ep.episode,b.id),'panel');
 assert.equal(selectedProductionSegment(p,ep,{id:'text',parentPanelId:panel.id},{current:b.id}),a.id);
});
test('旧工程页面仍为单格但缓存模式已是整屏时，切回整屏恢复原图且不改变其他屏',async()=>{
 const p=productionProject(await inspectProductionPackage(syntheticFiles())),segment=p.productionPackage.episodes[0].segments[0],root=productionFrame(p,segment.id),page=p.pages.find(x=>x.panels.includes(root)),other=structuredClone(p.pages.find(x=>x!==page));
 const image=id('asset');root.imageAssetId=image;root.visible=false;delete root.productionModeHidden;delete root.productionModeVisible;page.productionUnit='panel';
 const slice={...structuredClone(root),id:id('panel'),visible:true,panelSlice:{rootPanelId:root.id,segmentId:segment.id,panelId:segment.panelIds[0]}};delete slice.productionSegment;page.panels.push(slice);
 switchProductionSegmentUnit(p,segment.id,'screen',{ensureLettering:false,previousUnit:'screen'});assert.equal(root.visible,true);assert.equal(root.imageAssetId,image);assert.equal(slice.visible,false);assert.deepEqual(p.pages.find(x=>x.id===other.id),other);
});
