import {switchProductionSegmentUnit} from '../public/production-episode-layout.js';
import {applySliceDialogueGroups} from '../public/slice-dialogue-groups.js';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {productionSegment,productionFrame,productionSourceAsset} from '../public/production-package-model.js';
import {sliceFrame,validateSliceRegion,sourceRegionOnFrame} from '../public/panel-slices.js';
import {normalizeLayerOrder} from '../public/layers.js';
import {ensureProjectPanelGeneration} from '../public/panel-generation.js';
import {validateProject,check} from './store.mjs';
import {detectSliceRegions,cropSliceImages} from './panel-slices-images.mjs';
import {writeZip} from './xlsx.mjs';
import {sendFile} from './send-file.mjs';
import {annotationSpeaker} from '../public/slice-annotation-speakers.js';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex'),active=['queued','running','recoverable','awaiting_confirmation','delegated'];
const frameStamp=f=>JSON.stringify([f.x,f.y,f.w,f.h,f.points,f.imageAssetId,f.imageTransform,f.packageCutout]);
export function createPanelSlicesAPI({store,dataDir,body,json,saveProject,addAsset,applyLettering}){
 const directory=path.join(dataDir,'panel-slices'),uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
 const fileFor=id=>{check(uuid.test(id),'裁格记录编号无效');return path.join(directory,id,'manifest.json');};
 const load=id=>{const file=fileFor(id);check(fs.existsSync(file),'裁格预览不存在，请重新识别',404);return JSON.parse(fs.readFileSync(file));};
 const sources=(p,root)=>{const raw=productionSourceAsset(root),result=[{panelId:root.id,assetId:raw,label:'整屏原图'}];for(const f of p.pages.flatMap(p=>p.panels))if(f.cutoutLayer?.kind==='upscale'&&f.cutoutLayer.parentPanelId===root.id&&f.cutoutLayer.sourceAssetId===raw&&f.imageAssetId)result.push({panelId:f.id,assetId:f.imageAssetId,label:(f.name||'高清图')+(f.visible?'':'（已隐藏）')});return result.filter(s=>s.assetId);};
 function context(project,input){const root=productionFrame(project,input.segmentId),segment=productionSegment(project,input.segmentId);check(root&&segment,'请先选择制作资料中的屏段');const choices=sources(project,root),choice=input.sourcePanelId?choices.find(s=>s.panelId===input.sourcePanelId):choices.at(-1);check(choice,'该屏段尚无可用成图，或高清图已不属于当前原图',409);const frame=project.pages.flatMap(p=>p.panels).find(f=>f.id===choice.panelId),page=project.pages.find(p=>p.panels.includes(root)),asset=store.asset(choice.assetId),file=store.assetPath(choice.assetId);check(fs.existsSync(file),'来源图片无法读取',409);return {root,segment,choices,choice,frame,page,asset,file};}
 function guard(p,snapshot,input,{apply=false}={}){
  check(p.revision===input.expectedRevision,'工程已有修改，请重新打开裁格预览',409);check(snapshot.projectId===p.id,'裁格预览不属于当前工程',409);
  const c=context(p,{segmentId:snapshot.segmentId,sourcePanelId:snapshot.sourcePanelId});check(p.productionPackage.hash===snapshot.packageHash&&c.choice.assetId===snapshot.sourceAssetId&&productionSourceAsset(c.root)===snapshot.originalAssetId&&frameStamp(c.root)===snapshot.rootStamp&&frameStamp(c.frame)===snapshot.frameStamp&&sha(fs.readFileSync(c.file))===snapshot.sourceHash,'来源图片、资料版本或取景已改变，请重新识别',409);
  check(!store.db.jobs.some(j=>j.projectId===p.id&&[c.root.id,c.frame.id].includes(j.panelId)&&active.includes(j.status)),'本段还有生成任务，请完成后裁格',409);
  if(apply)check(!c.root.locked&&!c.frame.locked&&!c.page.locked,'请先解锁来源画格和画板',409);return c;
 }
 async function handle(req,res,{pathname,method}){
  const download=pathname.match(/^\/api\/panel-slices\/([0-9a-f-]+)\/(zip|files\/[^/]+)$/);
  if(download&&method==='GET'){const record=load(download[1]),name=download[2]==='zip'?'panels.zip':decodeURIComponent(download[2].slice(6));check(record.files?.some(f=>f.name===name)||name==='panels.zip'&&record.files,'文件不属于此裁格记录',404);await sendFile(res,path.join(directory,record.id,name),{'Content-Type':name.endsWith('.zip')?'application/zip':name.endsWith('.png')?'image/png':'application/json','Content-Disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(name)});return true;}
  const match=pathname.match(/^\/api\/projects\/([a-z]+_[0-9a-f-]{36})\/production\/slices\/(preview|export|apply)$/);if(!match)return false;check(method==='POST','请使用 POST',405);const input=await body(req),project=store.project(match[1]);check(project.revision===input.expectedRevision,'工程已有修改，请重新打开裁格预览',409);check(!input.lettering?.enabled,'请从上方“台词与气泡”在主画板逐句点击摆放',400);
  if(match[2]==='preview'){
   const c=context(project,input),hash=sha(fs.readFileSync(c.file)),expected=project.productionPackage.episodes.find(e=>e.episode===c.segment.episode).panelRecords.filter(p=>p.segmentId===c.segment.id).map(p=>p.layout),detected=await detectSliceRegions(c.file,expected),id=randomUUID();
   const snapshot={version:1,id,projectId:project.id,packageHash:project.productionPackage.hash,segmentId:c.segment.id,rootPanelId:c.root.id,sourcePanelId:c.frame.id,originalAssetId:productionSourceAsset(c.root),sourceAssetId:c.choice.assetId,sourceHash:hash,rootStamp:frameStamp(c.root),frameStamp:frameStamp(c.frame),width:detected.width,height:detected.height,expected:expected.map(p=>p['格ID']),created:new Date().toISOString()};guard(store.project(project.id),snapshot,input);fs.mkdirSync(path.dirname(fileFor(id)),{recursive:true});fs.writeFileSync(fileFor(id),JSON.stringify(snapshot,null,2));const speakers=Object.fromEntries(project.productionPackage.episodes.find(e=>e.episode===c.segment.episode).texts.filter(t=>t['段ID']===c.segment.localId).map(t=>[t['文字ID'],annotationSpeaker(project,c.segment,t,store.db.assets)]));json(res,200,{...snapshot,...detected,sources:c.choices,speakers});return true;
  }
  check(input.confirmed===true,'请先看图确认裁切框与格号');const snapshot=load(input.previewId),c=guard(project,snapshot,input,{apply:match[2]==='apply'}),regions=input.regions;check(regions&&typeof regions==='object'&&!Array.isArray(regions),'裁格区域无效');check(Object.keys(regions).length===snapshot.expected.length&&snapshot.expected.every(id=>Object.hasOwn(regions,id)&&validateSliceRegion(regions[id])),'每个源格ID都需要有效且不越界的裁切区域');
  const ordered=Object.fromEntries(snapshot.expected.map(id=>[id,regions[id]])),images=await cropSliceImages(c.file,ordered),current=store.project(project.id);guard(current,snapshot,input,{apply:match[2]==='apply'});
  const id=randomUUID(),folder=path.join(directory,id),record={...snapshot,id,previewId:snapshot.id,files:[],toolText:'工具排字仍为画布上的独立文字层；PNG只裁取来源图片。'},entries=[];fs.mkdirSync(folder,{recursive:true});
  for(const image of images){const name=image.panelId.replace(/[^a-zA-Z0-9_-]/g,'_')+'.png',key=sha(Buffer.from(JSON.stringify([snapshot.sourceHash,image.panelId,image.region]))),file={name,panelId:image.panelId,region:image.region,pixels:image.crop,sha256:sha(image.bytes),key,width:image.crop.w,height:image.crop.h};record.files.push(file);fs.writeFileSync(path.join(folder,name),image.bytes);entries.push([name,image.bytes]);}
  entries.push(['manifest.json',Buffer.from(JSON.stringify(record,null,2))]);fs.writeFileSync(path.join(folder,'panels.zip'),writeZip(entries.map(([name,data])=>({name,data}))));fs.writeFileSync(fileFor(id),JSON.stringify(record,null,2));
  const response={id,folder,zipUrl:'/api/panel-slices/'+id+'/zip',files:record.files.map(f=>({...f,url:'/api/panel-slices/'+id+'/files/'+encodeURIComponent(f.name)}))};
  if(match[2]==='apply'){
   const next=structuredClone(current),page=next.pages.find(p=>p.id===c.page.id),root=page.panels.find(f=>f.id===c.root.id),created=[],reused=[],ownedAssets=new Set();
   try{for(const file of record.files){const existing=page.panels.find(f=>f.panelSlice?.rootPanelId===root.id&&f.panelSlice.key===file.key);if(existing){reused.push(existing.id);continue;}const asset=addAsset(path.join(folder,file.name),file.panelId+' · 裁格','panel-slice'),frame=sliceFrame(c.frame,{width:snapshot.width,height:snapshot.height},file.pixels,asset,{rootPanelId:root.id,sourceAssetId:snapshot.sourceAssetId,sourceHash:snapshot.sourceHash,segmentId:snapshot.segmentId,panelId:file.panelId,region:file.region,pixels:file.pixels,key:file.key,batchId:id});ownedAssets.add(asset.id);page.panels.push(frame);created.push(frame.id);
     for(const b of page.bubbles)if(b.parentPanelId===root.id&&b.productionOriginal?.['格ID']===file.panelId)b.parentPanelId=frame.id;
    }
    if(created.length&&input.hideSource===true){for(const f of page.panels)if(f.cutoutLayer?.parentPanelId===root.id)check(!f.locked,'来源子图层已锁定，请先解锁',409);}
    let letterCount=0;if(input.lettering?.enabled){check(applyLettering,'排字接口未就绪');const convert=r=>sourceRegionOnFrame(c.frame,c.root,{width:snapshot.width,height:snapshot.height},r),gridRegions=Object.fromEntries(Object.entries(ordered).map(([id,r])=>[id,convert(r)])),positions=Object.fromEntries(Object.entries(input.lettering.positions||{}).map(([id,r])=>{check(validateSliceRegion(r),'文字区域无效：'+id);return [id,convert(r)];}));letterCount=await applyLettering(next,productionSegment(next,snapshot.segmentId),root,{...input.lettering,regions:gridRegions,positions,confirmed:true,expectedRevision:input.expectedRevision},{coordinateBounds:convert({x:0,y:0,w:1,h:1})});letterCount+=applySliceDialogueGroups(next,productionSegment(next,snapshot.segmentId),root,input.lettering.dialogueGroups,convert);for(const b of page.bubbles)if(b.parentPanelId===root.id){const grid=b.productionGridId||b.productionOriginal?.['格ID'],child=page.panels.find(f=>f.panelSlice?.rootPanelId===root.id&&f.panelSlice.panelId===grid&&record.files.some(file=>file.panelId===grid&&file.key===f.panelSlice.key));if(child)b.parentPanelId=child.id;}}
    ensureProjectPanelGeneration(next,store.db.assets);if(created.length&&input.hideSource===true)switchProductionSegmentUnit(next,snapshot.segmentId,'panel',{ensureLettering:false});normalizeLayerOrder(next);const added=new Set(created);next.layerOrder=next.layerOrder.filter(id=>!added.has(id));const bubbleIds=new Set(next.pages.flatMap(p=>p.bubbles.map(b=>b.id))),beforeText=next.layerOrder.findIndex(id=>bubbleIds.has(id));next.layerOrder.splice(beforeText<0?next.layerOrder.length:beforeText,0,...created);validateProject(next);if(created.length||input.lettering?.enabled)store.db.projects[store.db.projects.indexOf(current)]=next;response.project=created.length||input.lettering?.enabled?saveProject(next,{editor:true}):current;response.letteringCount=letterCount;response.created=created;response.reused=reused;
   }catch(error){store.db.assets=store.db.assets.filter(a=>!ownedAssets.has(a.id));throw error;}
  }json(res,200,response);return true;
 }
 return {handle};
}
