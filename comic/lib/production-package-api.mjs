import {appendAdoptedProductionReferences} from './production-reference-append.mjs';
import {assetUnavailable} from '../public/asset-availability.js';
import {ensureEpisodeLettering} from '../public/production-episode-lettering.js';
import {ensureProductionScreenLettering} from '../public/production-screen-lettering.js';
import {PRODUCTION_PACKAGE_LIMITS as limits} from '../public/production-package-limits.js';
import {layoutAssistantEpisode,switchProductionEpisodeUnit,switchProductionSegmentUnit,productionSegmentUnit} from '../public/production-episode-layout.js';
import {productionTextReference} from '../public/production-package-model.js';
import {productionExtraReferenceRoles} from '../public/production-extra-references.js';
import {FONT_FAMILIES} from '../public/lettering.js';
import {dialogueSegments} from '../public/bubble-dialogue-segments.js';
import {PRODUCTION_BOX_KINDS,PRODUCTION_FONT_FIELDS,productionStyleKind,updateProductionStyle,resolveProductionStyle,applyProductionStyle} from '../public/production-lettering-style.js';
import {resolveAssistantEpisode} from './assistant-episode-source.mjs';
import {applyEpisodeLocalBackgrounds} from './episode-local-backgrounds.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {loadPackageFiles,inspectProductionPackage,packagePath,packageDigest} from './production-package.mjs';
import {productionProject,productionDiff,mergeProductionProject} from './production-package-document.mjs';
import {productionSegment,productionFrame,productionRequirementKey,productionSourceAsset,applyProductionLettering} from '../public/production-package-model.js';
import {ensureProjectPanelGeneration} from '../public/panel-generation.js';
import {normalizeLayerOrder} from '../public/layers.js';
import {validateProject,check} from './store.mjs';
import {detectProductionRegions,removeConnectedWhite,stretchAtmosphere} from './production-package-images.mjs';
import {applyRemoteBubbleStyles} from '../public/comic-styles.js';
import {applyBubbleMaterial} from '../public/bubble-material.js';
import {builtinBubbleStyle} from '../public/builtin-bubble-data.js';
import {productionAssetBinding} from './production-reference-files.mjs';
import {prepareProductionPanel,findProductionPanel,productionPanelRecord,productionPanelRegion,applyProductionPanelLettering,ensureProductionSegmentLettering,automaticLetteringUntouched} from '../public/production-panel-generation.js';
import {productionPanelPrompts,productionPanelDataIssues} from '../public/production-panel-prompts.js';
import {auditPanelReferences} from '../public/panel-reference-audit.js';
const active=['queued','preparing','running','recoverable','awaiting_confirmation','delegated'];
export function createProductionPackageAPI({store,dataDir,library,body,json,saveProject,addAsset,projectView,getBubbleManifest}){
 const scans=new Map(),sourceRoot=path.join(dataDir,'production-sources');
 const idle=project=>check(!store.db.jobs.some(j=>j.projectId===project.id&&active.includes(j.status)),'当前作品还有任务，请结束后修改制作资料',409);
 const sourcePath=(hash,relativePath)=>{check(/^[a-f0-9]{64}$/.test(hash),'资料快照无效');return path.join(sourceRoot,hash,...packagePath(relativePath).split('/'));};
 const complete=(project,referenceSegments)=>{ensureProjectPanelGeneration(project,store.db.assets);for(const e of project.productionPackage?.episodes||[])for(const s of e.segments){if(referenceSegments&&!referenceSegments.has(s.id))continue;const f=productionFrame(project,s.id),roles=[];for(const r of s.references){if(productionTextReference(f,s,r,project))continue;if(r.skipped)continue;let assetId=r.binding?.assetId;if(r['类型']==='上一段成图')assetId=productionSourceAsset(productionFrame(project,e.segments.find(v=>v.localId===r['段ID'])?.id));if(assetId)roles.push({assetId,name:[r['人物'],r['服装']].filter(Boolean).join(' · ')||r['类型'],role:r['类型']==='设定卡'?'character':r['类型'].includes('场景')?'scene':/道具/.test(r['类型'])?'prop':'style'});}roles.push(...productionExtraReferenceRoles(project,f,store.db.assets));const unique=[...new Map(roles.map(r=>[r.assetId,r])).values()];delete f.referenceRequirements;f.referenceIds=unique.map(r=>r.assetId);f.generation.referenceRoles=unique;}normalizeLayerOrder(project);validateProject(project);return project;};
 async function applyLettering(next,s,frame,input,options){
   check(input.sourceAssetId===undefined||input.sourceAssetId===frame.imageAssetId,'成图已改变，请重新打开定位界面',409);const before=new Set(next.pages.flatMap(p=>p.bubbles.map(b=>b.id))),automatic=new Set(next.pages.flatMap(p=>p.bubbles.filter(automaticLetteringUntouched).map(b=>b.id))),styles=input.materialStyles||{},selected=Object.values(styles).filter(Boolean),materials=new Map();
   if(selected.length){let manifest;for(const key of Object.keys(styles)){const styleId=styles[key];if(!styleId)continue;let style=builtinBubbleStyle(styleId);if(!style){check(getBubbleManifest,'气泡素材读取接口尚未就绪');if(!manifest){manifest=await getBubbleManifest();applyRemoteBubbleStyles(manifest.items);}style=manifest.items.find(m=>m.id===styleId);check(style?.revisionId,'所选墨库气泡款式不存在');}let localAssetId;if(style.texture){const imported=await library.importAsset({assetId:style.assetId,revisionId:style.revisionId});check(imported.kind==='image','气泡纹理不是图片');localAssetId=imported.asset.id;}materials.set(key,{styleId,localAssetId,assetId:style.assetId,revisionId:style.revisionId,definitionSha256:packageDigest(Buffer.from(JSON.stringify(style)))});}check(store.project(next.id).revision===input.expectedRevision,'读取素材期间工程已改变，请重试',409);idle(next);}
   const count=applyProductionLettering(next,s.id,input,options);s.materialBindings={...s.materialBindings,...Object.fromEntries(materials)};for(const page of next.pages)for(const bubble of page.bubbles)if(bubble.productionSegment===s.id&&(!before.has(bubble.id)||automatic.has(bubble.id)||input.replace||(input.materialChangedKeys||[]).includes(JSON.stringify([bubble.productionOriginal?.['素材']?.['库']||bubble.productionOriginal?.['类型'],bubble.productionOriginal?.['素材']?.['款式']||'默认'])))){const original=bubble.productionOriginal,key=JSON.stringify([original?.['素材']?.['库']||original?.['类型'],original?.['素材']?.['款式']||'默认']),material=materials.get(key);if(material&&bubble.shape!=='none'&&(!dialogueSegments(bubble).length||(input.materialChangedKeys||[]).includes(key))){const typed=applyBubbleMaterial(bubble,material.styleId,material.localAssetId);typed.productionMaterialVersion=material;Object.assign(bubble,typed);}}
   const configured=resolveProductionStyle(next,s.id);if(input.fontChanged)configured.fontFamily=input.fontFamily;for(const page of next.pages)for(const bubble of page.bubbles)if(bubble.productionSegment===s.id&&(!before.has(bubble.id)||input.replace)){const original=bubble.productionOriginal,key=JSON.stringify([original?.['素材']?.['库']||original?.['类型'],original?.['素材']?.['款式']||'默认']);const style=structuredClone(configured);if(dialogueSegments(bubble).length||(input.materialChangedKeys||[]).includes(key))style.boxes={};applyProductionStyle(bubble,style);}
   return count;
 }
 async function handle(req,res,{pathname,method,url}){
  if(method==='POST'&&pathname==='/api/production-packages/scan'){
   const input=await body(req,limits.requestBytes),currentSessionVersion=library.sessionVersion?.();for(const [id,s] of scans)if(Date.now()-s.time>30*60*1000||s.mokuSessionVersion!==undefined&&s.mokuSessionVersion!==currentSessionVersion)scans.delete(id);check(scans.size<6,'已有多个未完成的资料预览，请稍后重试');
   if(input.sourceType==='moku')check(typeof library.sessionVersion==='function','墨库会话状态不可用，请重新连接',409);
   const mokuSessionVersion=input.sourceType==='moku'?library.sessionVersion():undefined,files=await loadPackageFiles(input,library),pkg=await inspectProductionPackage(files),scanId=randomUUID(),old=input.projectId?projectView(store.project(input.projectId)):null;
   if(mokuSessionVersion!==undefined)check(library.sessionVersion()===mokuSessionVersion,'墨库登录状态已变化，请重新扫描制作资料',409);
   if(old)check(old.productionPackage,'旧逐格工程请保留并新建屏段工程，避免混合覆盖',409);scans.set(scanId,{files,pkg,time:Date.now(),projectId:old?.id,revision:old?.revision,mokuSessionVersion});
   json(res,200,{scanId,title:pkg.title,sourceFormat:pkg.sourceFormat,hash:pkg.hash,count:pkg.count,files:pkg.manifest.map(f=>({path:f.relativePath,size:f.size,sourceType:f.sourceType,revisionId:f.revisionId})),episodes:pkg.episodes.map(e=>({episode:e.episode,title:e.title,segments:e.segments.length,panels:e.panelRecords.length,layoutVersion:e.layoutDesign?.data.layoutVersion})),issues:pkg.issues,diff:productionDiff(old,pkg),requirements:[...new Map(pkg.episodes.flatMap(e=>e.segments.flatMap(s=>s.references.filter(r=>r['类型']==='设定卡').map(r=>[productionRequirementKey(r),{name:r['人物'],outfit:r['服装'],required:r['必须']}])))).values()]});return true;
  }
  if(method==='POST'&&pathname==='/api/production-packages/import'){
   const input=await body(req),scan=scans.get(input.scanId);check(scan&&Date.now()-scan.time<30*60*1000,'资料预览已失效，请重新扫描',409);check(!scan.pkg.issues.some(i=>i.severity==='conflict')||input.acceptSourceConflicts===true,'资料源有差异，请在预览中核对并明确选择以JSON为准',409);
   if(scan.mokuSessionVersion!==undefined){check(library.sessionVersion()===scan.mokuSessionVersion,'墨库登录状态已变化，请重新扫描制作资料',409);await library.read('/api/auth/me');check(library.sessionVersion()===scan.mokuSessionVersion,'墨库登录状态已变化，请重新扫描制作资料',409);}
   const old=scan.projectId?store.project(scan.projectId):null;if(old&&(['single-mode-20261027','post-lettering-20261027'].includes(old.productionPackage?.sourceFormat)||['single-mode-20261027','post-lettering-20261027'].includes(scan.pkg.sourceFormat))&&old.productionPackage?.sourceFormat!==scan.pkg.sourceFormat)check(false,'本资料包与当前工程的制作契约不同，请新建工程导入，避免混入旧图片和提示词',409);if(old){idle(old);check(old.revision===scan.revision&&input.expectedRevision===old.revision,'资料预览后工程已改变，请重新扫描',409);if(old.productionPackage.hash===scan.pkg.hash){json(res,200,projectView(old));scans.delete(input.scanId);return true;}}
   let project=old?mergeProductionProject(projectView(old),scan.pkg,{replaceChanged:input.replaceChanged===true}):productionProject(scan.pkg,input.title);
   for(const file of scan.files){const dest=sourcePath(scan.pkg.hash,file.relativePath);fs.mkdirSync(path.dirname(dest),{recursive:true});if(!fs.existsSync(dest)||packageDigest(fs.readFileSync(dest))!==file.sha256)fs.writeFileSync(dest,file.bytes);}
   const packageImages=new Map();
   for(const e of project.productionPackage.episodes)for(const s of e.segments)for(const ref of s.references){if(!ref.packageImage||ref.binding)continue;const image=ref.packageImage;let binding=packageImages.get(image.path);if(!binding){const file=sourcePath(scan.pkg.hash,image.path);check(fs.existsSync(file)&&packageDigest(fs.readFileSync(file))===image.sha256,'随包参考图校验失败');const asset=addAsset(file,ref['名称']+' · 随包参考图','production-package');binding={...productionAssetBinding(store,asset.id),characterName:ref['人物']||undefined};packageImages.set(image.path,binding);}ref.binding=structuredClone(binding);}
   complete(project);
   if(old){const backup=path.join(dataDir,'backups',old.id+'_before_package_'+old.revision+'.json');fs.mkdirSync(path.dirname(backup),{recursive:true});fs.writeFileSync(backup,JSON.stringify(old));store.db.projects[store.db.projects.indexOf(old)]=project;}else store.db.projects.push(project);scans.delete(input.scanId);json(res,old?200:201,saveProject(project,{editor:!!old}));return true;
  }
  const match=pathname.match(/^\/api\/projects\/([a-z]+_[0-9a-f-]{36})\/production\/(source|bind|references|reference-options|layout|detect|compose|background|resolve|issues|mode|styles|unit|episode-unit|relayout-panels|episode-layout|episode-preview|panels|panel|panel-lettering|screen-lettering|episode-lettering)$/);if(!match)return false;
  const project=store.project(match[1]),pkg=project.productionPackage;check(pkg,'当前工程不是制作资料包工程',404);
  if(method==='GET'&&match[2]==='episode-preview'){
   const number=Number(url.searchParams.get('episode'));check(Number.isInteger(number),'请选择当前话');const source=resolveAssistantEpisode(project,number,{scriptId:url.searchParams.get('scriptId')||undefined});
   let previewGeometry=source?.geometry;
   if(source&&url.searchParams.get('summary')!=='1'){const preview=structuredClone(project);layoutAssistantEpisode(preview,number,source,{assets:store.db.assets});previewGeometry=await applyEpisodeLocalBackgrounds(preview,number,source,{store});}
   json(res,200,source?{available:true,projectId:project.id,episode:number,scriptId:source.scriptId,...(url.searchParams.get('summary')==='1'?{}:{geometry:previewGeometry}),contract:source.contract,packetHash:createHash('sha256').update(JSON.stringify(source.geometry)).digest('hex')}:{available:false,projectId:project.id,episode:number});return true;
  }
  if(method==='GET'&&match[2]==='source'){const rel=packagePath(url.searchParams.get('path')),file=pkg.manifest.find(f=>f.relativePath===rel);check(file,'原始资料不存在',404);const bytes=fs.readFileSync(sourcePath(pkg.hash,rel));check(packageDigest(bytes)===file.sha256,'缓存原件摘要不符，请重新导入',409);res.writeHead(200,{'Content-Type':/\.xlsx$/i.test(rel)?'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':'text/plain; charset=utf-8','Content-Disposition':"inline; filename*=UTF-8''"+encodeURIComponent(path.posix.basename(rel)),'Cache-Control':'no-store'});res.end(bytes);return true;}
  check(method==='POST','制作资料接口不存在',404);const input=await body(req);check(project.revision===input.expectedRevision,'工程已改变，请保存并重试',409);if(!['references','unit','panels','panel','panel-lettering','episode-lettering','styles'].includes(match[2])&&!(match[2]==='mode'&&input.gridId))idle(project);
  // Every mutation uses a clone so validation failures never partially edit a saved project.
  const returnStarted=performance.now();const cloneStarted=performance.now();const next=structuredClone(project),s=productionSegment(next,input.segmentId),frame=productionFrame(next,input.segmentId);const commit=options=>{complete(next,options?.referenceSegments);store.db.projects[store.db.projects.indexOf(project)]=next;return saveProject(next,{editor:true});};

  if(match[2]==='episode-lettering'){
   check(Number.isInteger(input.episode)&&pkg.episodes.some(e=>e.episode===input.episode),'请选择有效的话数');
   const result=ensureEpisodeLettering(next,input.episode);json(res,200,{...result,project:result.segments?commit({referenceSegments:new Set()}):project});return true;
  }
  if(match[2]==='styles'){
   check(s&&['screen','episode','all'].includes(input.scope),'请选择屏段及应用范围');const patch=input.patch;check(patch&&typeof patch==='object'&&!Array.isArray(patch)&&Object.keys(patch).length&&Object.keys(patch).every(k=>[...PRODUCTION_FONT_FIELDS,'boxes'].includes(k)),'样式设置无效');
   if(patch.fontFamily!==undefined)check(Object.hasOwn(FONT_FAMILIES,patch.fontFamily),'请选择支持的字体');if(patch.fontSize!==undefined)check(Number.isFinite(patch.fontSize)&&patch.fontSize>=10&&patch.fontSize<=2048,'字号范围为10至2048');if(patch.fontWeight!==undefined)check([300,400,500,600,700,800,900].includes(patch.fontWeight),'字重无效');
   if(patch.boxes){check(typeof patch.boxes==='object'&&!Array.isArray(patch.boxes)&&Object.keys(patch.boxes).every(k=>Object.hasOwn(PRODUCTION_BOX_KINDS,k)),'边框类型无效');let manifest;for(const key of Object.keys(patch.boxes)){const value=patch.boxes[key],id=value?.styleId;check(typeof id==='string'&&id.length<=160,'请选择边框样式');if(['none','default'].includes(id)){patch.boxes[key]={styleId:id};continue;}let d=builtinBubbleStyle(id);if(!d){manifest||=await getBubbleManifest();d=manifest.items.find(m=>m.id===id);check(d?.revisionId,'所选墨库样式不存在');}let localAssetId;if(d.texture){const imported=await library.importAsset({assetId:d.assetId,revisionId:d.revisionId});check(imported.kind==='image','边框素材不是图片');localAssetId=imported.asset.id;}patch.boxes[key]={styleId:id,assetId:d.assetId,revisionId:d.revisionId,localAssetId,definition:{contour:d.contour,insets:d.insets,label:d.label,texture:d.texture===true,parts:d.parts,rays:d.rays,frame:d.frame,preset:d.preset,tailKind:d.tailKind,tailPreset:d.tailPreset}};}}
   check(store.project(project.id).revision===input.expectedRevision,'读取素材期间工程已修改，请重试',409);const segments=updateProductionStyle(next,s.id,input.scope,patch);let count=0,skipped=0;
   for(const page of next.pages)for(const bubble of page.bubbles){const parent=page.panels.find(f=>f.id===bubble.parentPanelId),key=bubble.productionSegment||parent?.productionSegment||parent?.panelSlice?.segmentId||parent?.productionGrid?.segmentId||page.screenBoard?.segmentId;if(!segments.has(key))continue;if(!PRODUCTION_FONT_FIELDS.some(k=>Object.hasOwn(patch,k))&&!Object.hasOwn(patch.boxes||{},productionStyleKind(bubble)))continue;if(bubble.locked||page.locked){skipped++;continue;}const effective=resolveProductionStyle(next,key),selected={...Object.fromEntries(PRODUCTION_FONT_FIELDS.filter(k=>Object.hasOwn(patch,k)).map(k=>[k,effective[k]])),boxes:Object.fromEntries(Object.keys(patch.boxes||{}).map(k=>[k,effective.boxes[k]]))};applyProductionStyle(bubble,selected);count++;}
   // Lettering is editable while images generate. Do not rebuild source/reference snapshots.
   validateProject(next);store.db.projects[store.db.projects.indexOf(project)]=next;
   json(res,200,{project:saveProject(next,{editor:true}),count,skipped,segments:segments.size});return true;
  }
  if(match[2]==='issues'){check(Array.isArray(input.reviewed)&&input.reviewed.every(v=>Number.isInteger(v)&&v>=0&&v<pkg.issues.length),'核对项编号无效');next.productionPackage.reviewedIssues=input.reviewed;json(res,200,commit());return true;}
  if(match[2]==='reference-options'){
   check(Array.isArray(input.segmentIds)&&input.segmentIds.length>0&&input.segmentIds.length<=100&&new Set(input.segmentIds).size===input.segmentIds.length,'请选择不同的屏段');
   check(typeof input.omitCharacterOutfitLabels==='boolean','请选择人物参考标签方式');
   check(input.supplements===undefined||Array.isArray(input.supplements)&&input.supplements.length===0,'请先安装明确补充场景道具参考补丁');
   for(const id of input.segmentIds){const segment=productionSegment(next,id),target=productionFrame(next,id),owner=next.pages.find(p=>p.panels.some(f=>f.id===target?.id));check(segment&&target&&owner&&!target.locked&&!owner.locked,'屏段不存在或已锁定',409);if(input.requireEmpty===true)check(!target.imageAssetId&&!target.candidates?.length,'屏段已有成图或候选，请先核对',409);check(target.generation?.version===1,'屏段生成数据不完整',409);target.generation.omitCharacterOutfitLabels=input.omitCharacterOutfitLabels;}
   validateProject(next);store.db.projects[store.db.projects.indexOf(project)]=next;json(res,200,{project:saveProject(next,{editor:true}),segmentIds:input.segmentIds,supplementCount:0});return true;
  }
  if(match[2]==='references'){
   const referenceSegments=new Set();
   const editable=seg=>{const target=productionFrame(next,seg.id),owner=next.pages.find(p=>p.panels.some(v=>v.id===target?.id));check(target&&!target.locked&&!owner?.locked,'画格或画板已锁定',409);check(!store.db.jobs.some(j=>j.projectId===project.id&&[seg.panelId,seg.backgroundPanelId].includes(j.panelId)&&active.includes(j.status)),'待修改的屏段正在生成，请等本段完成或取消同时绑定',409);};
   const changes=input.changes||[{segmentId:input.segmentId,bindings:input.bindings}];check(Array.isArray(changes)&&changes.length>0&&changes.length<=100&&new Set(changes.map(c=>c.segmentId)).size===changes.length,'屏段参考修改范围无效');
   for(const change of changes){const seg=productionSegment(next,change.segmentId),f=productionFrame(next,change.segmentId);check(seg&&f,'屏段不存在');editable(seg);referenceSegments.add(seg.id);if(change.append){check(input.applyMatching!==true,'追加槽位不能同时跨话套用');appendAdoptedProductionReferences(next,seg,change.append,{episode:input.episode,assets:store.db.assets,makeBinding:id=>productionAssetBinding(store,id),isUnavailable:assetUnavailable});}check(Array.isArray(change.bindings)&&new Set(change.bindings.map(v=>v.slot)).size===change.bindings.length,'附图槽位重复或无效');
    for(const choice of change.bindings){const r=seg.references.find(v=>v.slot===choice.slot);check(r,'附图槽位不存在');check(!choice.skip||!r['必须'],'必需参考不能跳过');check(!choice.assetId||!choice.skip,'参考不能同时绑定和跳过');if(r['类型']==='上一段成图'){check(!choice.assetId,'接续参考由前段成图提供');r.skipped=choice.skip===true;continue;}r.binding=choice.assetId?productionAssetBinding(store,choice.assetId):null;r.skipped=choice.skip===true;}
    if(input.applyMatching===true)for(const choice of change.bindings){const source=seg.references.find(v=>v.slot===choice.slot);if(!source.binding||source['类型']==='上一段成图')continue;for(const e of next.productionPackage.episodes)for(const other of e.segments)for(const r of other.references)if(productionRequirementKey(r)===productionRequirementKey(source)){if(JSON.stringify(r.binding)!==JSON.stringify(source.binding)||r.skipped){editable(other);referenceSegments.add(other.id);r.binding=structuredClone(source.binding);r.skipped=false;}}}
    const assigned=seg.references.filter(r=>!r.skipped&&r.binding).map(r=>r.binding.assetId);check(new Set(assigned).size===assigned.length,'不同附图槽位不能指向同一图片');
   }
   next.assetLibrary||={version:1,assetIds:[],directories:[],recursive:true};next.assetLibrary.assetIds=[...new Set([...(next.assetLibrary.assetIds||[]),...next.productionPackage.episodes.flatMap(e=>e.segments.flatMap(s=>s.references.map(r=>r.binding?.assetId).filter(Boolean)))])];json(res,200,commit({referenceSegments}));return true;
  }
  if(match[2]==='episode-layout'){
   check(Number.isInteger(input.episode),'请选择当前话');const source=resolveAssistantEpisode(project,input.episode,{scriptId:input.scriptId,expectedPacketHash:input.expectedPacketHash});if(!source){json(res,200,{requiresPreview:true,episode:input.episode});return true;}
   const sourceChecked=performance.now();const result=layoutAssistantEpisode(next,input.episode,source,{assets:store.db.assets});await applyEpisodeLocalBackgrounds(next,input.episode,source,{store});check(store.project(project.id).revision===input.expectedRevision,'读取底色依据期间工程已改变，请重新读取',409);const geometryApplied=performance.now();
   const backup=path.join(dataDir,'backups',project.id+'_before_assistant_layout_'+project.revision+'.json');fs.mkdirSync(path.dirname(backup),{recursive:true});if(!fs.existsSync(backup))fs.writeFileSync(backup,JSON.stringify(project),{flag:'wx'});const backupDone=performance.now();
   const saved=commit({referenceSegments:new Set()}),committed=performance.now();
   json(res,200,{project:saved,...result,backupCreated:true,returnTiming:{sourceAndCloneMs:sourceChecked-returnStarted,geometryMs:geometryApplied-sourceChecked,backupMs:backupDone-geometryApplied,normalizeValidateSaveMs:committed-backupDone,totalMs:committed-returnStarted}});return true;
  }
  if(match[2]==='episode-unit'){
   check(Number.isInteger(input.episode)&&['screen','panel'].includes(input.unit),'请选择话数和生成单位');
   const episode=next.productionPackage.episodes.find(e=>e.episode===input.episode);check(episode?.segments.length,'当前话没有屏段');
   check(!['single-mode-20261027','post-lettering-20261027'].includes(next.productionPackage.sourceFormat),'单格专用资料包没有整屏模式');
   const previousUnits=new Map(episode.segments.map(segment=>[segment.id,productionSegmentUnit(next,input.episode,segment.id)]));
   for(const segment of episode.segments){
    check(productionFrame(next,segment.id),'屏段画板不存在：'+segment.id);
    if(input.unit==='panel')for(const gridId of segment.panelIds)if(!findProductionPanel(next,segment.id,gridId))prepareProductionPanel(next,segment.id,gridId);
   }
   switchProductionEpisodeUnit(next,input.episode,input.unit,{previousUnits});
   const backup=path.join(dataDir,'backups',project.id+'_before_episode_unit_'+project.revision+'.json');fs.mkdirSync(path.dirname(backup),{recursive:true});if(!fs.existsSync(backup))fs.writeFileSync(backup,JSON.stringify(project,null,2),{flag:'wx'});
   json(res,200,{project:commit({referenceSegments:new Set()}),unit:input.unit,segments:episode.segments.length,backupCreated:true});return true;
  }
  check(s&&frame,'请选择有效屏段');
  if(match[2]==='screen-lettering'){
   check(productionSegmentUnit(next,s.episode,s.id)==='screen','请先切换到屏段模式');
   check(frame.generation?.promptSource!=='imported','空泡模式请先使用“手动定位台词”确认每条台词的位置');
   const result=ensureProductionScreenLettering(next,s.id,{manual:true});
   json(res,200,{project:commit({referenceSegments:new Set()}),...result});return true;
  }
  if(match[2]==='panels'){
   const rows=s.panelIds.map(id=>productionPanelRecord(next,s.id,id));check(rows.length&&rows.every(Boolean),'本屏段的单镜头资料不完整');
   const preview=input.prepareOnly===true,source=input.mode==='clean'?'post-lettering':'imported',issues=[],panelIds=[];
   if(!preview)check(['clean','empty'].includes(input.mode),'请选择本屏全部单格的空泡或无泡模式');
   for(const record of rows){
    const existing=findProductionPanel(next,s.id,record.id),pending=existing&&store.db.jobs.some(j=>j.projectId===project.id&&j.panelId===existing.id&&active.includes(j.status));
    if(pending){if(preview){panelIds.push(existing.id);continue;}issues.push(record.id+'：正在生成或等待恢复');continue;}
    if(!preview){const prompts=productionPanelPrompts(record);if(!(input.mode==='clean'?prompts.clean:prompts.empty).text)issues.push(record.id+'：缺少'+(input.mode==='clean'?'无泡':'空泡')+'提示词');s.panelPromptSources={...s.panelPromptSources,[record.id]:source};}
    try{panelIds.push(prepareProductionPanel(next,s.id,record.id).panel.id);}catch(error){issues.push(record.id+'：'+error.message);}
   }
   if(!preview){ensureProjectPanelGeneration(next,store.db.assets);for(const id of panelIds){const target=next.pages.flatMap(p=>p.panels).find(f=>f.id===id),audit=auditPanelReferences(next,target,store.db.assets),record=productionPanelRecord(next,s.id,target.productionGrid.panelId);for(const issue of productionPanelDataIssues(record,{referenceAudit:audit}))issues.push(record.id+'：'+issue);if(audit.coverageEnforced&&!audit.ready)issues.push(target.productionGrid.panelId+'：参考未齐（'+audit.needs.filter(n=>n.blocking).map(n=>n.name).join('、')+'）');}}
   check(!issues.length,'本屏单格尚不能批量生成：\n'+issues.join('\n'));
   if(productionSegmentUnit(next,s.episode,s.id)==='panel')ensureProductionSegmentLettering(next,s.id);
   json(res,200,{project:commit(),panelIds,gridIds:rows.map(r=>r.id)});return true;
  }
  if(['panel','panel-lettering','mode'].includes(match[2])&&input.gridId){const target=findProductionPanel(next,s.id,input.gridId);if(target)check(!store.db.jobs.some(job=>job.projectId===project.id&&job.panelId===target.id&&active.includes(job.status)),'本格正在生成，请等本格完成后再修改',409);}
  if(match[2]==='relayout-panels'){
   check(s,'屏段不存在');const root=productionFrame(next,s.id);check(root,'屏段画板不存在');let moved=0,skipped=0;
   for(const record of next.productionPackage.episodes.flatMap(e=>e.panelRecords).filter(r=>r.segmentId===s.id)){
    const target=findProductionPanel(next,s.id,record.id);
    if(!target){prepareProductionPanel(next,s.id,record.id);moved++;continue;}
    if(target.locked||target.imageAssetId){skipped++;continue;}
    const {region,from}=productionPanelRegion(next,s.id,record.id);
    target.x=root.x+region.x*root.w;target.y=root.y+region.y*root.h;target.w=Math.max(20,region.w*root.w);target.h=Math.max(20,region.h*root.h);
    target.productionGrid={...(target.productionGrid||{}),rootPanelId:root.id,segmentId:s.id,panelId:record.id,placementSource:from};moved++;
   }
   json(res,200,{project:commit(),moved,skipped});return true;
  }
  if(match[2]==='unit'){
   check(s&&['screen','panel'].includes(input.unit),'请选择屏段或单格生成');
   const previousUnit=productionSegmentUnit(next,s.episode,s.id);
   if(input.unit==='panel')for(const gridId of s.panelIds)if(!findProductionPanel(next,s.id,gridId))prepareProductionPanel(next,s.id,gridId);
   switchProductionSegmentUnit(next,s.id,input.unit,{previousUnit});json(res,200,commit({referenceSegments:new Set()}));return true;
  }
  if(match[2]==='panel'){const prepared=prepareProductionPanel(next,s.id,input.gridId);if(productionSegmentUnit(next,s.episode,s.id)==='panel')applyProductionPanelLettering(next,s.id,input.gridId,{automatic:true});json(res,200,{project:commit(),panelId:prepared.panel.id});return true;}
  if(match[2]==='panel-lettering'){check(input.confirmed===true,'请确认本格台词后加入文字层');check(productionPanelRecord(next,s.id,input.gridId),'单格不属于当前屏段');const result=applyProductionPanelLettering(next,s.id,input.gridId);json(res,200,{project:commit(),...result});return true;}
  if(match[2]==='mode'){
   check(['clean','empty'].includes(input.mode),'请选择空泡或无泡');const source=input.mode==='clean'?'post-lettering':'imported';
   if(input.gridId){const record=productionPanelRecord(next,s.id,input.gridId);check(record,'单格不属于当前屏段');const prompts=productionPanelPrompts(record);check((input.mode==='clean'?prompts.clean:prompts.empty).text,'分镜表缺少本格'+(input.mode==='clean'?'无泡':'空泡')+'提示词：'+record.id);s.panelPromptSources={...s.panelPromptSources,[record.id]:source};const target=findProductionPanel(next,s.id,record.id);if(target){check(!target.locked,'请先解锁本格',409);prepareProductionPanel(next,s.id,record.id);target.generation.promptSource=source;}}
   else {if(input.mode==='empty')check(String(next.shots.find(v=>v.id===frame.shotId)?.sourceFields?.['生图提示词']||'').trim(),'本屏未提供空泡提示词，不能借用无泡原文');frame.generation.promptSource=source;if(productionSegmentUnit(next,s.episode,s.id)==='screen')ensureProductionScreenLettering(next,s.id);}
   if(input.gridId&&findProductionPanel(next,s.id,input.gridId)&&productionSegmentUnit(next,s.episode,s.id)==='panel')applyProductionPanelLettering(next,s.id,input.gridId,{automatic:true});
   json(res,200,commit());return true;
  }
  if(match[2]==='resolve'){check(s.pendingSourceFields,'该屏段没有提示词冲突');if(input.useIncoming===true){const shot=next.shots.find(v=>v.id===s.shotId);shot.sourceFields=s.pendingSourceFields;shot.productionPrompt=s.pendingSourceFields['生图提示词'];}s.sourceDecision={useIncoming:input.useIncoming===true,at:new Date().toISOString()};delete s.pendingSourceFields;json(res,200,commit());return true;}
  if(match[2]==='bind'){
   const ref=s.references.find(r=>r.slot===input.slot);check(ref,'附图槽位不存在');check(!input.skip||!ref['必须'],'必需参考不能跳过');
   let binding=null;if(input.assetId)binding=productionAssetBinding(store,input.assetId);
   const key=productionRequirementKey(ref);for(const e of next.productionPackage.episodes)for(const seg of e.segments)for(const r of seg.references)if(seg.id===s.id&&r.slot===ref.slot||input.applyMatching===true&&r['类型']!=='上一段成图'&&productionRequirementKey(r)===key){r.binding=binding;r.skipped=input.skip===true;}
   json(res,200,commit());return true;
  }
  if(match[2]==='layout'){
   const count=await applyLettering(next,s,frame,input);
   json(res,200,{project:commit(),created:count});return true;
  }
  const assetId=productionSourceAsset(frame);if(match[2]!=='background')check(assetId,'请先采用屏段成图');const source=assetId?store.assetPath(assetId):null;
  if(match[2]==='detect'){const e=pkg.episodes.find(e=>e.episode===s.episode),expected=e.panelRecords.filter(p=>p.segmentId===s.id).map(p=>p.layout),result=await detectProductionRegions(source,expected);check(store.project(project.id).revision===input.expectedRevision,'识别期间工程已改变',409);const transform=frame.imageTransform||{x:0,y:0,scale:frame.w/result.width};result.regions=Object.fromEntries(Object.entries(result.regions).map(([key,r])=>[key,{x:(transform.x+r.x*result.width*transform.scale)/frame.w,y:(transform.y+r.y*result.height*transform.scale)/frame.h,w:r.w*result.width*transform.scale/frame.w,h:r.h*result.height*transform.scale/frame.h}]));json(res,200,result);return true;}
  check(input.confirmed===true,'请看图确认后再应用');
  if(match[2]==='compose'){check(s.layoutAssetId===frame.imageAssetId,'请先在当前成图上确认格区并排字');const result=await removeConnectedWhite(source);check(store.project(project.id).revision===input.expectedRevision,'处理期间工程已改变',409);const file=path.join(dataDir,'production-composites',randomUUID()+'.png');fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,result.bytes);const asset=addAsset(file,s.id+' · 白缝透明副本','production-composite');frame.packageCutout={originalAssetId:assetId,assetId:asset.id,removedPixels:result.removedPixels};frame.imageAssetId=asset.id;frame.candidates=[...frame.candidates,asset.id].slice(-40);s.layoutAssetId=asset.id;json(res,200,commit());return true;}
  if(match[2]==='background'){const owner=s.background['方式']==='共用'?pkg.episodes.find(e=>e.episode===s.episode).segments.find(v=>v.localId===s.background['段ID']):s,bg=productionFrame(next,owner.id+'-BG');check(bg?.imageAssetId,'请先生成或放入这组底图');const originalId=bg.packageBackgroundComposite?.assetId===bg.imageAssetId?bg.packageBackgroundComposite.originalAssetId:bg.imageAssetId,bytes=await stretchAtmosphere(store.assetPath(originalId),Math.round(bg.w),Math.round(bg.h));check(store.project(project.id).revision===input.expectedRevision,'处理期间工程已改变',409);const file=path.join(dataDir,'production-composites',randomUUID()+'.png');fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,bytes);const asset=addAsset(file,owner.id+' · 氛围底图覆盖副本','production-background');bg.packageBackgroundComposite={originalAssetId:originalId,assetId:asset.id};bg.imageAssetId=asset.id;bg.imageTransform={x:0,y:0,scale:1};json(res,200,commit());return true;}
  return false;
 }
 function exportSources(project){return project.productionPackage?.manifest.map(f=>({relativePath:f.relativePath,sha256:f.sha256,dataBase64:fs.readFileSync(sourcePath(project.productionPackage.hash,f.relativePath)).toString('base64')}));}
 function restoreSources(project,files){if(!project.productionPackage)return;check(Array.isArray(files)&&files.length===project.productionPackage.manifest.length&&new Set(files.map(f=>f.relativePath)).size===files.length,'制作工程缺少原始资料快照或路径重复');check(packageDigest(Buffer.from(JSON.stringify(project.productionPackage.manifest.map(f=>[f.relativePath,f.sha256]))))===project.productionPackage.hash,'制作资料快照摘要与清单不符');let size=0;for(const file of files){const expected=project.productionPackage.manifest.find(f=>f.relativePath===file.relativePath);check(expected&&expected.sha256===file.sha256&&typeof file.dataBase64==='string'&&file.dataBase64.length<=Math.ceil(limits.fileBytes*4/3)+4,'制作原件清单不符');const bytes=Buffer.from(file.dataBase64,'base64');size+=bytes.length;check(size<=limits.bytes&&packageDigest(bytes)===expected.sha256,'制作原件摘要不符');}for(const file of files){const dest=sourcePath(project.productionPackage.hash,file.relativePath);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,Buffer.from(file.dataBase64,'base64'));}}
 return {handle,exportSources,restoreSources,applyLettering};
}
