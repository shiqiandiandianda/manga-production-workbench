import test from 'node:test';
import assert from 'node:assert/strict';
import {createStudio} from '../server.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {syntheticFiles} from './helpers/two-screen-package.mjs';
import {inspectProductionPackage} from '../lib/production-package.mjs';
import {productionProject} from '../lib/production-package-document.mjs';
import {productionFrame,applyProductionLettering} from '../public/production-package-model.js';
import {placeSourceDialogue} from './helpers/manual-dialogue.mjs';
const placeSegment=(p,id)=>placeSourceDialogue(p,p.pages.find(pg=>pg.panels.some(f=>f.productionSegment===id)),{segmentId:id});
import {applyProductionFrameLettering} from '../public/production-panel-generation.js';
import {resolveProductionStyle,updateProductionStyle,applyProductionStyleToScope,productionStyleKind} from '../public/production-lettering-style.js';
import {applyProjectTypography} from '../public/unified-typography.js';
import {dialogueInventory} from '../public/dialogue-system.js';
import {applyBubbleMaterial} from '../public/bubble-material.js';
import {bubbleFieldChange} from '../public/editor-state.js';
import {ensureProjectPanelGeneration} from '../public/panel-generation.js';
import {mergeDialogueBubbles} from '../public/bubble-dialogue-segments.js';

async function fixture(){const p=productionProject(await inspectProductionPackage(syntheticFiles()));ensureProjectPanelGeneration(p,[]);for(const s of p.productionPackage.episodes[0].segments){productionFrame(p,s.id).generation.promptSource='post-lettering';placeSegment(p,s.id);}return p;}
test('全套字体按工程、话、屏继承；批量和之后新增台词使用同一规则',async()=>{
 const p=await fixture(),a='E011-S001',b='E011-S002';
 applyProjectTypography(p,{fontFamily:'source-han-serif',fontSize:40,textColor:'#123456',lineHeight:1.6,letterSpacing:2,padding:20});
 updateProductionStyle(p,a,'screen',{textColor:'#654321'});assert.equal(resolveProductionStyle(p,a).textColor,'#654321');assert.equal(resolveProductionStyle(p,b).textColor,'#123456');
 const r=applyProductionStyleToScope(p,a,'episode',{fontSize:46,textColor:'#112233',boxes:{speech:{styleId:'builtin-rounded'}}});assert.equal(r.count,2);
 const page=p.pages.find(pg=>pg.bubbles.some(v=>v.productionSegment===a)),frame=productionFrame(p,a);page.bubbles=[];delete frame.productionLetteringVersion;placeSegment(p,a);
 const fresh=page.bubbles[0];for(const key of ['fontFamily','fontSize','textColor','lineHeight','letterSpacing','padding'])assert.equal(fresh[key],resolveProductionStyle(p,a)[key]);assert.equal(fresh.shape,'asset');assert.equal(fresh.fillOpacity,1);
});
test('字体修改不顺带换框；换框保留原文、说话人、位置、独立文字框；跳过画格锁定',async()=>{
 const p=await fixture(),b=p.pages.flatMap(p=>p.bubbles)[0],original=structuredClone(b);b.textBox={x:12,y:14,w:160,h:120};
 applyProductionStyleToScope(p,'E011-S001','screen',{fontSize:44});assert.equal(b.shape,original.shape);assert.deepEqual(b.textBox,{x:12,y:14,w:160,h:120});
 applyProductionStyleToScope(p,'E011-S001','screen',{boxes:{speech:{styleId:'builtin-rounded'}}});for(const key of ['text','speaker','x','y','w','h','productionOriginal'])assert.deepEqual(b[key],original[key]);assert.equal(b.fontSize,44);assert.equal(b.fillOpacity,1);
 const before=structuredClone(b);productionFrame(p,'E011-S001').locked=true;const result=applyProductionStyleToScope(p,'E011-S001','screen',{fontSize:50});assert.equal(result.skipped,1);assert.deepEqual(b,before);
});
test('空泡填字继承统一字体且默认不叠加新框；无框转款式修复透明残留',async()=>{
 const p=await fixture(),s=p.productionPackage.episodes[0].segments[0],frame=productionFrame(p,s.id),page=p.pages.find(pg=>pg.panels.includes(frame));
 applyProductionStyleToScope(p,s.id,'episode',{fontSize:42,textColor:'#234567',lineHeight:1.5});page.bubbles=[];delete frame.productionLetteringVersion;frame.generation.promptSource='imported';
 applyProductionFrameLettering(p,frame,p.productionPackage.episodes[0],s.id,p.productionPackage.episodes[0].texts.filter(t=>t['段ID']===s.localId&&t['渲染']==='工具'));
 const b=page.bubbles[0];assert.equal(b.shape,'none');assert.equal(b.fillOpacity,0);assert.equal(b.fontSize,42);assert.equal(b.textColor,'#234567');
 const hidden={...b,shape:'asset',fillOpacity:0,outlineWidth:0,materialOutlineWidth:2.8};const fixed=applyBubbleMaterial(hidden,'builtin-oval');assert.equal(fixed.fillOpacity,1);assert.ok(fixed.outlineWidth>0);assert.equal(fixed.text,b.text);assert.equal(fixed.x,b.x);
});
test('裁格排字的新台词同样继承默认；已有手工台词不被重写',async()=>{
 const p=await fixture(),s=p.productionPackage.episodes[0].segments[0],frame=productionFrame(p,s.id),page=p.pages.find(pg=>pg.panels.includes(frame));applyProductionStyleToScope(p,s.id,'episode',{fontSize:48,textColor:'#234567',boxes:{speech:{styleId:'builtin-oval'}}});page.bubbles=[];frame.imageAssetId='fixture-image';
 applyProductionLettering(p,s.id,{regions:{[s.panelIds[0]]:{x:0,y:0,w:1,h:1}},confirmed:true});const b=page.bubbles[0];assert.equal(b.fontSize,48);assert.equal(b.textColor,'#234567');assert.equal(b.comicStyleId,'builtin-oval');b.text='保留手工文字';const before=structuredClone(b);applyProductionLettering(p,s.id,{regions:{[s.panelIds[0]]:{x:0,y:0,w:1,h:1}},confirmed:true});assert.deepEqual(b,before);
});
test('台词清单按源ID去重并优先可见单格，列出缺失台词，排除特效字',async()=>{
 const p=await fixture(),s='E011-S001',page=p.pages.find(pg=>pg.bubbles.some(b=>b.productionSegment===s)),original=page.bubbles[0],copy=structuredClone(original);copy.id='visible-copy';copy.parentPanelId='visible-frame';copy.text='单格中的手工修改';productionFrame(p,s).visible=false;page.panels.push({id:'visible-frame',visible:true,productionGrid:{segmentId:s,panelId:'E011-001'}});page.bubbles.push(copy);page.bubbles.push({...copy,id:'sfx',type:'sfx'});
 const rows=dialogueInventory(p,s,'episode');assert.equal(rows.length,2);assert.equal(rows[0].bubbleId,'visible-copy');assert.equal(rows[0].text,copy.text);assert.equal(rows[0].status,'placed');p.pages.forEach(pg=>pg.bubbles=pg.bubbles.filter(b=>b.productionSegment!==s));assert.equal(dialogueInventory(p,s)[0].status,'missing');
});
test('单句类型修改同步到六类框分类，不被导入类型或旧款式覆盖',()=>{
 const b={type:'speech',productionBoxKind:'speech',productionOriginal:{类型:'对白'},fontSize:36};const next=bubbleFieldChange(b,'bubble','productionBoxKind','person');assert.equal(next.type,'caption');assert.equal(productionStyleKind(next),'person');assert.deepEqual(next.productionOriginal,b.productionOriginal);
});
test('双圆合并后清单保留两句各自的文字和说话人；手动第二段也列出',async()=>{
 const p=await fixture(),segment='E011-S001',pg=p.pages.find(pg=>pg.bubbles.some(b=>b.productionSegment===segment)),first=pg.bubbles[0],second={...structuredClone(first),id:'second',productionTextId:'second-source',text:'第二个人的话',speaker:'乙'};
 const episode=p.productionPackage.episodes[0];episode.texts.push({...structuredClone(episode.texts[0]),文字ID:'second-source',文本:second.text,说话人:'乙'});const merged=mergeDialogueBubbles(first,second);pg.bubbles=[merged];let rows=dialogueInventory(p,segment);assert.equal(rows.length,2);assert.equal(rows[0].text,first.text);assert.equal(rows[1].text,second.text);assert.equal(rows[1].speaker,'乙');assert.equal(rows[0].bubbleId,rows[1].bubbleId);
 delete merged.dialogueSegments[1].sourceTextId;episode.texts=episode.texts.filter(t=>t['文字ID']!=='second-source');rows=dialogueInventory(p,segment);assert.equal(rows.length,2);assert.equal(rows[1].manual,true);assert.equal(rows[1].text,second.text);
});
test('图片出字方式仅提供初始值，之后新增台词沿用用户明确选择的框样式',async()=>{
 const p=await fixture(),segment='E011-S001',frame=productionFrame(p,segment),pg=p.pages.find(pg=>pg.panels.includes(frame));applyProductionStyleToScope(p,segment,'screen',{boxes:{speech:{styleId:'builtin-rounded'}}});frame.generation.promptSource='imported';pg.bubbles=[];delete frame.productionLetteringVersion;applyProductionFrameLettering(p,frame,p.productionPackage.episodes[0],segment,p.productionPackage.episodes[0].texts.filter(t=>t['段ID']==='段01'&&t['渲染']==='工具'));assert.equal(pg.bubbles[0].comicStyleId,'builtin-rounded');assert.equal(pg.bubbles[0].fillOpacity,1);
});
test('人名地点时间旁白换素材后不继承对白尾巴',async()=>{
 const p=await fixture(),bubble=p.pages.flatMap(p=>p.bubbles)[0];for(const kind of ['person','location','time','narration']){bubble.productionBoxKind=kind;bubble.tail.visible=true;applyProductionStyleToScope(p,'E011-S001','screen',{boxes:{[kind]:{styleId:'builtin-rounded'}}});assert.equal(bubble.tail.visible,false);assert.equal(bubble.text,'测试台词1');}
});
test('统一样式API校验完整排字字段并原子保存，拒绝版本冲突和非法输入',async t=>{
 const proof=path.resolve('../../verification/unified-lettering-20261030');fs.mkdirSync(proof,{recursive:true});const dir=fs.mkdtempSync(path.join(proof,'api-'));Object.assign(process.env,{COMIC_PROJECT_SYNC:'0',COMIC_TEAM_AUTO_SYNC:'0',COMIC_SLOT_DIR:path.join(dir,'slots'),COMIC_LIBRARY_CONFIG:path.join(dir,'offline.json')});fs.writeFileSync(process.env.COMIC_LIBRARY_CONFIG,'{"base":"http://127.0.0.1:9"}');
 const fake={close(){},status:async()=>({connected:false}),generate(){assert.fail('不得生图');}},studio=createStudio({dataDir:path.join(dir,'data'),seedReference:false,bridge:fake,jimengBridge:fake});await new Promise(r=>studio.server.listen(0,'127.0.0.1',r));t.after(()=>{studio.close();studio.server.closeAllConnections();});const p=await fixture();studio.store.db.projects.push(p);studio.store.save();const request=async(patch,revision=studio.store.project(p.id).revision)=>{const r=await fetch('http://127.0.0.1:'+studio.server.address().port+'/api/projects/'+p.id+'/production/styles',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({expectedRevision:revision,segmentId:'E011-S001',scope:'episode',patch})});return {status:r.status,data:await r.json()};};
 const good=await request({fontSize:44,textColor:'#123456',lineHeight:1.7,letterSpacing:3,padding:22,boxes:{speech:{styleId:'builtin-oval'}}});assert.equal(good.status,200,JSON.stringify(good.data));assert.equal(good.data.count,2);assert.ok(good.data.project.pages.flatMap(p=>p.bubbles).every(b=>b.fontSize===44&&b.textColor==='#123456'&&b.lineHeight===1.7));
 const before=JSON.stringify(studio.store.project(p.id));assert.equal((await request({lineHeight:.1})).status,400);assert.equal((await request({textColor:'red'})).status,400);assert.equal((await request({fontSize:36},-1)).status,409);assert.equal(JSON.stringify(studio.store.project(p.id)),before);assert.equal(studio.store.db.jobs.length,0);
});
