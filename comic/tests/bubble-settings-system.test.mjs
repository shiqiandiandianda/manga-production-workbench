import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {applyBubbleMaterial} from '../public/bubble-material.js';
import {applyProductionStyle,applyProductionStyleToScope,resolveProductionStyle,updateProductionStyle,dialogueTemplateStyle} from '../public/production-lettering-style.js';
import {repairLegacyBubbleAppearance} from '../public/bubble-appearance.js';
import {bubbleLayout,svgBubbleMarkup,paintBubble} from '../public/lettering.js';
import {fitDialogueObject,reflowProjectLettering} from '../public/auto-lettering.js';
import {rescalePageWidth,resizePageHeight} from '../public/model.js';
import {paintTextureInk,svgTextureInk} from '../public/bubble-texture-ink.js';
import {dialogueStylePreview} from '../public/dialogue-style-preview.js';
import {applyBubbleEdit} from '../public/bubble-editor.js';
import {bubbleFieldChange} from '../public/editor-state.js';
import {scaleReflowLettering,ensureReflowLetteringMinimum} from '../public/reflow-lettering.mjs';
import {applyDialogueTemplate} from '../public/episode-bubble-fit.js';
import {createStudio} from '../server.mjs';
import {productionProject} from '../lib/production-package-document.mjs';
import {inspectProductionPackage} from '../lib/production-package.mjs';
import {syntheticFiles} from './helpers/two-screen-package.mjs';
import {placementRows,placementSettings,preparePlacement,placePreparedDialogue} from '../public/manual-dialogue-placement.js';
import {ensureProjectPanelGeneration} from '../public/panel-generation.js';
import fs from 'node:fs';import path from 'node:path';
const require=createRequire(import.meta.url),{createCanvas}=require(process.env.COMIC_TEST_CANVAS_MODULE),ctx=createCanvas(1,1).getContext('2d');
const b=(extra={})=>({id:'bubble-test',type:'speech',shape:'rounded-rect',productionTextId:'source-one',text:'没什么事，该干啥干啥去。对了，找几个人，把院子清理一番。',speaker:'角色甲',x:120,y:100,w:500,h:360,fontSize:32,fontFamily:'source-han-sans',fontWeight:500,fillOpacity:0,outlineWidth:0,visible:true,tail:{visible:false},...extra});
const p=bubbles=>({pages:[{width:1280,panels:[{id:'frame',x:0,y:0,w:1280,h:1280,generation:{promptSource:'post-lettering'}}],bubbles}],productionPackage:{episodes:[{episode:38,segments:[{id:'S1'},{id:'S2'}]},{episode:39,segments:[{id:'S3'}]}]}});
test('基础框和旧素材一次修复为可见，默认对白尾巴显示；明确透明、隐藏尾巴、无框和锁定内容保留',()=>{
 const bubbles=[b(),b({id:'intentional',materialVisibilityVersion:2,tail:{visible:false,visibilityExplicit:true}}),b({id:'none',shape:'none'}),b({id:'locked',locked:true}),applyBubbleMaterial(b({id:'double',type:'thought'}),'builtin-double')];
 bubbles.at(-1).tail={visible:false};const project=p(bubbles),before=structuredClone(project),r=repairLegacyBubbleAppearance(project);assert.equal(r.fill,1);assert.equal(r.tail,2);assert.equal(bubbles[0].fillOpacity,1);assert.equal(bubbles[0].outlineWidth,2.8);assert.equal(bubbles[0].tail.visible,true);for(let i=1;i<4;i++)assert.deepEqual(bubbles[i],before.pages[0].bubbles[i]);assert.equal(repairLegacyBubbleAppearance(project).changed,0);
});
test('不透明度和尾巴按屏、话、工程继承，只修改指定字段和分类，保留材质、文字、字号与手工几何',()=>{
 const a=b({productionSegment:'S1',fillOpacity:1,outlineWidth:2.8}),c=b({id:'two',productionSegment:'S2',fillOpacity:1}),d=b({id:'three',productionSegment:'S3',fillOpacity:1}),lock=b({id:'lock',productionSegment:'S1',locked:true,fillOpacity:1}),project=p([a,c,d,lock]);
 updateProductionStyle(project,'S1','all',{boxes:{speech:{styleId:'builtin-double'}}});updateProductionStyle(project,'S1','screen',{boxes:{speech:{fillOpacity:.2,outlineColor:'#aa3344'}}});const before=structuredClone(a),r=applyProductionStyleToScope(project,'S1','episode',{boxes:{speech:{fillOpacity:.65,tailVisible:false}}});assert.equal(r.count,2);assert.equal(r.skipped,1);assert.equal(a.fillOpacity,.65);assert.equal(c.fillOpacity,.65);assert.equal(d.fillOpacity,1);assert.equal(lock.fillOpacity,1);for(const f of ['text','speaker','x','y','w','h','fontSize','shape'])assert.deepEqual(a[f],before[f]);assert.equal(resolveProductionStyle(project,'S1').boxes.speech.styleId,'builtin-double');assert.equal(resolveProductionStyle(project,'S1').boxes.speech.outlineColor,'#aa3344');assert.equal(resolveProductionStyle(project,'S1').boxes.speech.fillOpacity,.65);const future=b();applyProductionStyle(future,resolveProductionStyle(project,'S1'));assert.equal(future.fillOpacity,.65);assert.equal(future.tail.visible,false);assert.equal(future.comicStyleId,'builtin-double');
});
test('默认圆框、双圆和心声选用对白材质时尾巴可用，文字模式无框保持无填充',()=>{
 for(const type of ['speech','thought'])for(const id of ['builtin-oval','builtin-double','builtin-rounded']){const after=applyBubbleMaterial(b({type}),id);assert.equal(after.fillOpacity,1);assert.equal(after.tail.visible,true);assert.ok(bubbleLayout(ctx,after).tail);}
 const none=b({shape:'none'});applyProductionStyle(none,{boxes:{speech:{fillOpacity:1,tailVisible:true}}});assert.equal(none.shape,'none');assert.equal(none.fillOpacity,0);assert.equal(none.tail.visible,false);
});
test('拉框、拖文字、重排缩放、换样式与模板复制均不改变32px字号，实际SVG与Canvas同为32px',()=>{
 const source=dialogueStylePreview(ctx,{fontSize:32,boxes:{speech:{styleId:'builtin-oval'}}},'speech',b().text).bubble;
 for(const factor of [.08,.4,1.7,3]){const scaled=structuredClone(source),layout=bubbleLayout(ctx,scaled);scaled.w*=factor;scaled.h*=factor;scaleReflowLettering(scaled,factor);ensureReflowLetteringMinimum(scaled);assert.equal(scaled.fontSize,32);assert.equal(bubbleLayout(ctx,scaled).fontSize,32);assert.deepEqual(bubbleLayout(ctx,scaled).lines.map(l=>l.text),layout.lines.map(l=>l.text));assert.match(svgBubbleMarkup(ctx,scaled),/font-size="32"/);}
 for(const type of ['resize','text-resize','text-move'])assert.equal(applyBubbleEdit(source,{type,dx:100,dy:60}).fontSize,32);const changed=applyBubbleMaterial(source,'builtin-double');assert.equal(bubbleLayout(ctx,changed).fontSize,32);const template={...source,fontSize:60},copied=applyDialogueTemplate(ctx,source,template);assert.equal(copied.fontSize,32);assert.equal(dialogueTemplateStyle(source).boxes.speech.fillOpacity,source.fillOpacity);assert.equal(bubbleFieldChange(source,'bubble','fontSize',48).fontSize,48);
});
test('页面宽高迁移和重排保持原字号、字距与冻结分行，Canvas实际绘制仍为32px',()=>{
 const source=dialogueStylePreview(ctx,{fontSize:32,letterSpacing:2,boxes:{speech:{styleId:'builtin-oval'}}},'speech',b().text).bubble,rows=bubbleLayout(ctx,source).lines.map(l=>l.text),project=p([source]),page=project.pages[0];page.height=3840;
 for(const width of [724,2560,1280]){rescalePageWidth(page,width);resizePageHeight(page,page.height*2,{scaleContent:true});assert.equal(source.fontSize,32);assert.equal(source.letterSpacing,2);assert.equal(bubbleLayout(ctx,source).fontSize,32);assert.deepEqual(bubbleLayout(ctx,source).lines.map(l=>l.text),rows);}
 const drawn=[],original=ctx.fillText.bind(ctx);ctx.fillText=(...args)=>{drawn.push(ctx.font);original(...args);};try{paintBubble(ctx,source);}finally{ctx.fillText=original;}assert.ok(drawn.length);assert.ok(drawn.every(font=>/32px/.test(font)));
});
test('手工框换款与预览使用同一适配，选择默认32px样式不能覆盖本句24px字号',()=>{
 const source=b({fontSize:24,fillOpacity:1,outlineWidth:2.8,productionSegment:'S1',autoLettering:{mode:'manual'},textBox:{x:5,y:5,w:450,h:100}}),project=p([source]),patch={boxes:{speech:{styleId:'builtin-oval'}}},style={fontSize:32,boxes:patch.boxes},preview=dialogueStylePreview(ctx,style,'speech',source.text,{sourceBubble:source,patch,maxHeight:1280,protectedWords:[source.speaker]});
 applyProductionStyleToScope(project,'S1','episode',patch);reflowProjectLettering(ctx,project);assert.equal(source.fontSize,24);assert.equal(source.w,preview.bubble.w);assert.equal(source.h,preview.bubble.h);assert.deepEqual(bubbleLayout(ctx,source).lines.map(l=>l.text),preview.rows);assert.equal(bubbleLayout(ctx,source).overflow,false);
});
test('素材白纸不遮盖不透明度，墨线描边颜色与宽度在Canvas和SVG真实生效',()=>{
 const artwork=createCanvas(40,40),ink=artwork.getContext('2d');ink.fillStyle='white';ink.fillRect(0,0,40,40);ink.fillStyle='black';ink.fillRect(12,12,16,16);const canvas=createCanvas(40,40),c=canvas.getContext('2d'),bubble={id:'ink',textureInkVersion:1,materialOutlineWidth:2.8,outlineColor:'#bb2244'};
 paintTextureInk(c,artwork,bubble,{w:40,h:40});let pixels=c.getImageData(0,0,40,40).data;assert.equal(pixels[3],0);assert.deepEqual([...pixels.slice((20*40+20)*4,(20*40+20)*4+4)],[187,34,68,255]);const count=()=>{let n=0;for(let i=3;i<pixels.length;i+=4)if(pixels[i]>0)n++;return n;},thin=count();c.clearRect(0,0,40,40);paintTextureInk(c,artwork,{...bubble,materialOutlineWidth:6.8},{w:40,h:40});pixels=c.getImageData(0,0,40,40).data;assert.ok(count()>thin);c.clearRect(0,0,40,40);paintTextureInk(c,artwork,{...bubble,materialOutlineWidth:0},{w:40,h:40});assert.ok(c.getImageData(0,0,40,40).data.every(v=>v===0));const markup=svgTextureInk(bubble,'fixture.png',40,40,v=>v);assert.match(markup,/feColorMatrix/);assert.match(markup,/filter="url\(#bubble-ink-ink\)"/);
});
test('HTTP批量外观支持0/65/100%、尾巴开关和未来默认；拒绝越界和非法颜色，源码不调用生成',async t=>{
 process.env.COMIC_PROJECT_SYNC='0';process.env.COMIC_TEAM_AUTO_SYNC='0';const dir=fs.mkdtempSync(path.join(process.env.TEMP,'bubble-settings-api-'));process.env.COMIC_SLOT_DIR=path.join(dir,'slots');process.env.COMIC_LIBRARY_CONFIG=path.join(dir,'offline.json');fs.writeFileSync(process.env.COMIC_LIBRARY_CONFIG,'{"base":"http://127.0.0.1:9"}');const fake={close(){},status:async()=>({connected:false}),generate(){assert.fail('禁止真实生成');}},studio=createStudio({dataDir:path.join(dir,'data'),seedReference:false,bridge:fake,jimengBridge:fake});await new Promise(r=>studio.server.listen(0,'127.0.0.1',r));t.after(()=>{studio.close();studio.server.closeAllConnections();});const project=productionProject(await inspectProductionPackage(syntheticFiles()));ensureProjectPanelGeneration(project,[]);const target=project.pages[0],row=placementRows(project,target)[0];placePreparedDialogue(project,row,preparePlacement(ctx,row,placementSettings(project,target)).bubble,target,{x:450,y:500},target.panels[0]);studio.store.db.projects.push(project);studio.store.save();const call=async box=>{const current=studio.store.project(project.id);return fetch('http://127.0.0.1:'+studio.server.address().port+'/api/projects/'+project.id+'/production/styles',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({expectedRevision:current.revision,segmentId:'E011-S001',scope:'all',patch:{boxes:{speech:box}}})});};
 for(const opacity of [0,.65,1]){const response=await call({fillOpacity:opacity,tailVisible:opacity>0});assert.equal(response.status,200,await response.clone().text());const saved=(await response.json()).project;assert.equal(saved.pages.flatMap(p=>p.bubbles)[0].fillOpacity,opacity);assert.equal(resolveProductionStyle(saved,'E011-S001').boxes.speech.fillOpacity,opacity);}
 for(const invalid of [{fillOpacity:1.1},{fillOpacity:-.1},{tailVisible:'yes'},{outlineWidth:1000},{fillColor:'url(evil)'}])assert.equal((await call(invalid)).status,400);assert.equal(studio.store.db.jobs.length,0);
});
