import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {syntheticFiles} from './fixtures/production-synthetic.mjs';
import {inspectProductionPackage} from '../lib/production-package.mjs';
import {productionProject} from '../lib/production-package-document.mjs';
import {createScreenReflow} from '../lib/screen-reflow.mjs';
import {createLayoutPlanning} from '../lib/layout-planning.mjs';
import {ensureProjectPanelGeneration} from '../public/panel-generation.js';
import {prepareProductionPanel} from '../public/production-panel-generation.js';
import {productionFrame} from '../public/production-package-model.js';
import {validateProject} from '../lib/store.mjs';
import {id,panel} from '../public/model.js';
import {sampleArtworkPixels} from '../lib/artwork-palette.mjs';
import {artworkBackgroundGeometry} from '../public/artwork-backgrounds.mjs';
import {gradientFrame} from '../public/layers.js';
import {createBatchLayoutRun} from '../public/batch-layout-run.js';
import {buildReflowProject} from '../public/auto-layout-reflow.mjs';
import {artworkZoomPercent} from '../public/artwork-transform.js';
import {ensureEpisodeBoards,hasEpisodeBoard} from '../public/episode-boards.js';
const sha=b=>createHash('sha256').update(b).digest('hex'),stamp=f=>JSON.stringify([f.x,f.y,f.w,f.h,f.points,f.imageAssetId,f.imageTransform,f.packageCutout]);
process.env.COMIC_CANVAS_MODULE||=path.resolve(import.meta.dirname,'../../runtime/node/node_modules/@napi-rs/canvas');
const {createCanvas}=createRequire(import.meta.url)(process.env.COMIC_CANVAS_MODULE);
const contract={id:'synthetic',name:'测试规则',digest:'a'.repeat(64),version:'synthetic-v1'};
const proof=path.resolve(import.meta.dirname,'../../verification/original-canvas');fs.mkdirSync(proof,{recursive:true});
function geometry(script){return {format:'comic-layout-geometry',version:1,profileVersion:'test',sourcePanelKeys:script.shots.map(s=>s.key),layoutRuleDigest:contract.digest,canvas:{width:1280,height:2120},panels:script.shots.map((s,i)=>({key:s.key,sourceShotCode:String(s.code),readingOrder:i+1,shape:'rectangle',role:i?'support':'main',x:i?580:0,y:i?1220:0,w:600,h:900})),backgrounds:[{x:0,y:0,w:1280,h:2120,mode:'solid',color:'#d9d7d1'}],generator:{backgrounds:'local-palette-pending'}};}
async function fixture({existing=true}={}){
 const project=productionProject(await inspectProductionPackage(syntheticFiles())),ep=project.productionPackage.episodes[0];ensureProjectPanelGeneration(project,[]);
 // Include another episode to detect accidental whole-document replacement.
 const other=structuredClone(project.pages[0]);other.id=id('page');other.storyboard={episode:12,projection:'manual'};other.panels=[];other.bubbles=[];project.pages.push(other);
 const dir=fs.mkdtempSync(path.join(proof,'fixture-')),assets=[],scripts=new Map(),records=[];
 const store={db:{projects:[project],assets,jobs:[]},project(key){const p=this.db.projects.find(p=>p.id===key);if(!p)throw Error('missing');return p;},asset(key){return assets.find(a=>a.id===key);},assetPath(key){return this.asset(key).filePath;},save(){},markProject(){}};
 for(const [n,segment]of ep.segments.entries()){
  ep.panelRecords[n].original['当前场景']=n?'测试室内':'测试河边';ep.panelRecords[n].original['画面内容']=n?'棕色木墙与暖橙灯光':'蓝色河水映着蓝色天空';
  const c=createCanvas(120,180),ctx=c.getContext('2d');ctx.fillStyle=n?'#ba7040':'#386bac';ctx.fillRect(0,0,120,180);const bytes=c.toBuffer('image/png'),file=path.join(dir,'source-'+n+'.png');fs.writeFileSync(file,bytes);
  const asset={id:id('asset'),width:120,height:180,filePath:file};assets.push(asset);const root=productionFrame(project,segment.id);root.imageAssetId=asset.id;root.imageTransform={x:0,y:0,scale:root.w/120};
  let crop;if(existing){crop=prepareProductionPanel(project,segment.id,segment.panelIds[0]).panel;crop.imageAssetId=asset.id;crop.imageTransform={x:4,y:8,scale:3};crop.w=400;crop.h=600;crop.x=50;crop.y=80;}
  const batchId=randomUUID(),folder=path.join(dir,'panel-slices',batchId);fs.mkdirSync(folder,{recursive:true});fs.copyFileSync(file,path.join(folder,'crop.png'));
  const key=segment.panelIds[0],region={x:0,y:0,w:1,h:1};
  if(crop)crop.panelSlice={version:1,sourceBindingVersion:1,rootPanelId:root.id,segmentId:segment.id,panelId:key,sourceAssetId:asset.id,sourceHash:sha(bytes),region,pixels:{x:0,y:0,w:120,h:180},batchId,key:'f'.repeat(64)};
  const record={id:batchId,projectId:project.id,segmentId:segment.id,packageHash:project.productionPackage.hash,sourcePanelId:root.id,rootPanelId:root.id,originalAssetId:asset.id,sourceAssetId:asset.id,sourceHash:sha(bytes),rootStamp:stamp(root),frameStamp:stamp(root),expected:[key],created:new Date().toISOString(),width:120,height:180,files:[{name:'crop.png',panelId:key,key:'f'.repeat(64),region,pixels:{x:0,y:0,w:120,h:180},width:120,height:180,sha256:sha(bytes),...(crop?{existingPanelId:crop.id,existingAssetId:asset.id,existingFrameStamp:stamp(crop)}:{})}]};
  fs.writeFileSync(path.join(folder,'manifest.json'),JSON.stringify(record));records.push({segmentId:segment.id,recordId:batchId});
 }
 ensureProjectPanelGeneration(project,assets);validateProject(project);
 const request=async(route,input)=>{if(route.endsWith('/rules/resolve'))return contract;if(route==='/api/integration/import'){const script={id:'script-'+scripts.size,episode:input.episode,source:{kind:'synthetic'},shots:input.shots,layoutRuleContract:contract,studioSource:{projectId:project.id,revision:project.revision,reflowBatchId:input.reflowBatchId,planningBatchId:input.planningBatchId}};scripts.set(script.id,script);return script;}if(route.startsWith('/api/scripts/'))return scripts.get(route.split('/').at(-1));if(route.startsWith('/api/drafts/'))return geometry(scripts.get(route.split('/').at(-1)));if(route==='/api/export')return {packet:input.packet};throw Error(route);};
 const api=createScreenReflow({store,dataDir:dir,request,body:async req=>req,json:(res,status,value)=>Object.assign(res,{status,value}),validateProject,checkAssets(){},addAsset(filePath){const a={id:id('asset'),filePath,width:120,height:180};assets.push(a);return a;}});
 const call=async(action,input={})=>{const res={};await api.handle({projectId:project.id,episode:11,learningProjectId:'synthetic',expectedRevision:store.project(project.id).revision,...input},res,{method:'POST',pathname:'/api/auto-layout/reflow/'+action});return res.value;};
 return {project,store,dir,records,assets,scripts,request,api,call,other};
}
test('成图接回保留工程、画板与手动中心；不足100%补足，重复接回只写一次',async()=>{
 const f=await fixture(),before=JSON.stringify(f.project),ready=await f.call('source',{records:f.records,learningProjectId:'synthetic'}),script=f.scripts.get(ready.scriptId),packet=geometry(script),ids=f.project.pages.map(p=>p.id),oldCrop=f.project.pages[0].panels.find(p=>p.panelSlice);
 const result=await f.api.importResult(script,packet);validateProject(result);
 assert.equal(result.id,f.project.id);assert.equal(result.title,f.project.title);assert.equal(result.revision,1);assert.equal(f.store.db.projects.length,1);assert.deepEqual(result.pages.map(p=>p.id),ids);assert.deepEqual(result.pages.at(-1),f.other);assert.equal(JSON.stringify(f.project),before);
 const crop=result.pages[0].panels.find(p=>p.id===oldCrop.id);assert.equal(crop.imageAssetId,oldCrop.imageAssetId);assert.ok(Math.abs(artworkZoomPercent(crop,f.assets.find(a=>a.id===crop.imageAssetId))-100)<1e-8);assert.ok(Math.abs((crop.w/2-crop.imageTransform.x)/crop.imageTransform.scale-(oldCrop.w/2-oldCrop.imageTransform.x)/oldCrop.imageTransform.scale)<1e-8);assert.ok(Math.abs((crop.h/2-crop.imageTransform.y)/crop.imageTransform.scale-(oldCrop.h/2-oldCrop.imageTransform.y)/oldCrop.imageTransform.scale)<1e-8);assert.equal(crop.visible,true);
 const visibleBackgrounds=result.gradients.filter(g=>g.visible);assert.equal(visibleBackgrounds.length,2);assert.ok(visibleBackgrounds.every(g=>g.gradient.startColor===g.gradient.endColor));assert.ok(visibleBackgrounds.some(g=>g.featherEdges?.top>0));assert.ok(visibleBackgrounds.some(g=>g.featherEdges?.bottom>0));
 for(const g of result.gradients.filter(g=>g.visible)){assert.equal(g.assistantLayoutAnchor.pageId,ids[0]);assert.equal(g.designEpisode,11);assert.notEqual(g.gradient.startColor,'#000000');assert.equal(gradientFrame(g,{pages:[{pageId:ids[0],y:500}],width:1280,height:3000}).y,g.y+500);}
 const again=await f.api.importResult(script,packet);assert.equal(again.revision,1);assert.equal(f.store.db.projects.length,1);assert.ok(fs.existsSync(path.join(f.dir,'backups',result.id+'_before_canvas_layout_0.json')));assert.ok(result.layoutHistory.records.length);
});
test('原整屏工程首次接回裁格，保留来源图和其他画板',async()=>{const f=await fixture({existing:false}),source=await f.call('source',{records:f.records}),script=f.scripts.get(source.scriptId),result=await f.api.importResult(script,geometry(script));validateProject(result);assert.equal(result.pages.length,3);for(const s of result.productionPackage.episodes[0].segments){assert.equal(productionFrame(result,s.id).visible,false);assert.ok(result.pages.flatMap(p=>p.panels).some(p=>p.visible&&p.panelSlice?.segmentId===s.id));}assert.equal(f.store.db.projects.length,1);});
test('版本变化、锁定及任务中的目标拒绝接回且不增加工程',async()=>{
 for(const type of ['revision','locked','job']){const f=await fixture(),source=await f.call('source',{records:f.records}),script=f.scripts.get(source.scriptId);if(type==='revision')f.project.revision++;if(type==='locked')f.project.pages[0].locked=true;if(type==='job')f.store.db.jobs.push({projectId:f.project.id,panelId:f.project.pages[0].panels[0].id,status:'running'});const before=JSON.stringify(f.project);await assert.rejects(()=>f.api.importResult(script,geometry(script)));assert.equal(JSON.stringify(f.project),before);assert.equal(f.store.db.projects.length,1);}
});
test('像素仅输出候选，结合本格明确颜色原文后形成留白渐变',()=>{
 const pixels=new Uint8ClampedArray(64*4);for(let i=0;i<pixels.length;i+=4)pixels.set([60,100,180,255],i);const blue=sampleArtworkPixels(pixels,{sha256:'a'.repeat(64)});assert.equal(blue.status,'candidates');for(let i=0;i<pixels.length;i+=4)pixels.set([255,255,255,255],i);assert.equal(sampleArtworkPixels(pixels).status,'pending');
 const shots=[{key:'a',location:'河边',description:'蓝色河水映着蓝色天空'},{key:'b',location:'室内',description:'棕色木墙围住房间'}],packet=geometry({shots:shots.map(s=>({...s,code:s.key}))}),items=[{key:'a',filePath:'image-a.png',sha256:'a'.repeat(64),palette:blue},{key:'b',filePath:'image-b.png',sha256:'a'.repeat(64),palette:{...blue,candidates:[{color:'#986c4a',family:'brown',coverage:.7,spatialTiles:12}]}}],result=artworkBackgroundGeometry(packet,items,shots),transition=result.backgrounds.find(b=>b.mode==='linear');assert.ok(transition.y>=900&&transition.y+transition.h<=1220);assert.deepEqual(result.panels,packet.panels);assert.equal(packet.generator.backgrounds,'local-palette-pending');
});
test('再次成图重排仍接回同一工程，不增加画格、文字或镜头',async()=>{
 const f=await fixture();let priorCounts;
 for(let n=0;n<3;n++){
  let records=f.records;
  if(n)records=(await f.call('prepare')).records;
  const source=await f.call('source',{records,forceNew:true}),script=f.scripts.get(source.scriptId),result=await f.api.importResult(script,geometry(script));validateProject(result);
  const counts=[result.pages.length,result.pages.flatMap(p=>p.panels).length,result.pages.flatMap(p=>p.bubbles).length,result.shots.length];
  if(priorCounts)assert.deepEqual(counts,priorCounts);priorCounts=counts;assert.equal(result.revision,n+1);assert.equal(f.store.db.projects.length,1);
 }
});
test('前期排版旧导入入口也接回原画布，其他话及工程数保留',async()=>{
 const f=await fixture({existing:false});for(const frame of f.project.pages.flatMap(p=>p.panels))frame.imageAssetId=null;
 const api=createLayoutPlanning({store:f.store,dataDir:f.dir,request:f.request,body:async req=>req,json:(res,status,value)=>Object.assign(res,{status,value}),validateProject,checkAssets(){}}),res={};
 await api.handle({projectId:f.project.id,episode:11,expectedRevision:0,learningProjectId:'synthetic'},res,{method:'POST',pathname:'/api/auto-layout/planning/source'});
 const script=f.scripts.get(res.value.scriptId),result=await api.importResult(script,geometry(script));validateProject(result);assert.equal(result.id,f.project.id);assert.equal(result.revision,1);assert.deepEqual(result.pages.at(-1),f.other);assert.equal(f.store.db.projects.length,1);
 assert.equal((await api.importResult(script,geometry(script))).revision,1);
});
test('批量成图接回每次采用同一工程的新版本，下话来源使用更新后的版本',async()=>{
 let project={id:id('project'),revision:0,productionPackage:{episodes:[{episode:11},{episode:12}]}},episode=11,token=0;const sent=[],accepted=[],memory=new Map(),storage={getItem:k=>memory.get(k),setItem:(k,v)=>memory.set(k,v)};
 for(const n of [11,12])storage.setItem('comic-direct-layout-v1:'+project.id+':'+n+':synthetic',JSON.stringify({projectId:project.id,revision:n-11,episode:n,learningProjectId:'synthetic',ruleVersion:contract.version,runToken:'run-'+n,scriptId:'script-'+n,status:'running',planningMode:false}));
 const api=async(route,method,input)=>{
  if(route.endsWith('/plan'))return {projectId:project.id,episode:input.episode,segments:[{id:'seg',hasImage:true}],rules:[{id:'synthetic',activeVersion:contract.version}]};
  if(route.endsWith('/resolve'))return {status:'done',jobId:'job',sourceMatch:true};
  if(route==='/api/auto-layout/import'){sent.push({script:input.scriptId,revision:project.revision});return {...structuredClone(project),revision:project.revision+1};}
  throw Error(route);
 };
 const batch=createBatchLayoutRun({api,getProject:()=>project,getEpisode:()=>episode,flushSave:async()=>{},applyCurrent:()=>{throw Error('not planning');},accept:async(next,options)=>{assert.equal(options.expectedRevision,project.revision);project=next;accepted.push(next.revision);},storage,token:()=>String(++token),wait:async()=>{}});
 const result=await batch.start({episodes:[11,12],styleId:'synthetic'});assert.equal(result.status,'done');assert.deepEqual(accepted,[1,2]);assert.deepEqual(sent.map(s=>s.revision),[0,1]);assert.equal(result.projectId,project.id);assert.ok(result.completed.every(r=>!r.resultProjectId));
});
test('正式成图接回接口将旧单画板稿恢复为来源屏段；取景预览仍是一张长图',async()=>{
 const f=await fixture(),first=await f.call('source',{records:f.records}),script=f.scripts.get(first.scriptId),packet=geometry(script),batch=JSON.parse(fs.readFileSync(path.join(f.dir,'auto-layout-reflow',first.id+'.json'))),items=batch.items.map(item=>({...item,asset:f.store.asset(item.existingAssetId)})),legacy=buildReflowProject({original:f.project,script,geometry:packet,items,batchId:'old-result'}),originalId=f.project.id;
 Object.assign(f.project,legacy,{id:originalId});ensureProjectPanelGeneration(f.project,f.assets);validateProject(f.project);
 const ready=await f.call('prepare'),source=await f.call('source',{records:ready.records,forceNew:true}),nextScript=f.scripts.get(source.scriptId),preview=await f.call('preview',{scriptId:source.scriptId});assert.equal(preview.project.pages.length,1);
 const result=await f.api.importResult(nextScript,geometry(nextScript));validateProject(result);assert.equal(result.id,originalId);assert.equal(result.pages.filter(p=>p.storyboard?.episode===11).length,2);assert.equal(result.reflowBoardRestoration.boards,2);assert.equal(f.store.db.projects.length,1);
});

test('无首尾画板或只有一侧时成图重排仍正常接回，并保留画板启用状态',async()=>{
 for(const mode of ['none','cover-only','tail-only']){const f=await fixture();if(mode==='none')delete f.project.episodeBoards;else{const state=ensureEpisodeBoards(f.project),e=state.episodes[11]={};e[mode==='cover-only'?'tail':'cover']={useOwnBackground:false,backgroundAssetId:null,enabled:false};}const before=structuredClone(f.project.episodeBoards),ready=await f.call('source',{records:f.records}),script=f.scripts.get(ready.scriptId),result=await f.api.importResult(script,geometry(script));validateProject(result);assert.equal(result.id,f.project.id);assert.deepEqual(result.episodeBoards,before);assert.equal(hasEpisodeBoard(result,'cover',11),mode==='cover-only');assert.equal(hasEpisodeBoard(result,'tail',11),mode==='tail-only');assert.ok(result.gradients.some(g=>g.visible&&g.designEpisode===11));assert.equal(f.store.db.projects.length,1);}
});
