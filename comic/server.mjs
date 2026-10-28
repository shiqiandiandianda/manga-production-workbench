import {createHash} from 'node:crypto';
import {createEpisodeGenerationBatches} from './lib/episode-generation-batches.mjs';
import {episodeGenerationPanelIds} from './public/generation-policy.js';
import {currentBoardEpisode} from './public/episode-boards.js';
import {createPromptRewriteAPI} from './lib/prompt-rewrite-api.mjs';
import {Readable} from 'node:stream';
import {pipeline as formalPreviewPipeline} from 'node:stream/promises';
import {createFormalEngineeringVersions} from './lib/formal-engineering-versions.mjs';
import {createEpisodeVersionStore} from './lib/episode-versions.mjs';
import {ensureProductionScreenLettering} from './public/production-screen-lettering.js';
import {productionSegmentUnit} from './public/production-episode-layout.js';
import {PRODUCTION_PACKAGE_LIMITS as productionPackageLimits} from './public/production-package-limits.js';
import {createPanelImageImports} from './lib/panel-image-imports.mjs';
import {planProjectPurge,executeProjectPurge,purgeSummary} from './lib/project-purge.mjs';
import {novelEvidence,saveNovelSources,readNovelChapter} from './lib/novel-evidence.mjs';
import {createAutoLayoutAPI} from './lib/auto-layout-api.mjs';
import {remapWorkspaceRemovals} from './public/asset-workspace-removal.js';
import {createLocalRegionAPI} from './lib/local-region-api.mjs';
import {referencePackingRoles} from './lib/reference-packing.mjs';
import {textAssetGenerationMode,textAssetSignature} from './public/asset-text-references.js';
import {panelTextAssets} from './public/panel-text-assets.js';
import {createAssetWorkspaceAPI} from './lib/asset-workspace-api.mjs';
import {createLayerMergeAPI} from './lib/layer-merge-api.mjs';
import {stripObsoleteProductionReferences} from './public/production-reference-policy.js';
import {restoreLegacyBubbleMaterialVisibility} from './public/bubble-material.js';
import {productionReferenceVersions,verifyProductionReferenceFiles} from './lib/production-reference-files.mjs';
import {hydrateProductionSlices} from './public/production-slice-source.js';
import {createPanelSlicesAPI} from './lib/panel-slices-api.mjs';
import {referenceContentStamp} from './lib/reference-content.mjs';
import {splitProductionScreenBoards,syncScreenBackgrounds} from './public/production-screen-boards.js';
import {generationTargetStamp,autoApplyBlocks} from './lib/generation-autofill.mjs';
import {createProductionPackageAPI} from './lib/production-package-api.mjs';
import {hydrateProductionTableRegions} from './lib/production-table-regions.mjs';
import {productionAssetIds,remapProductionPackage} from './lib/production-package-portable.mjs';
import {packageResultView,preparePackageJob,packageJobReady,packageJobWait,refreshPackageJob} from './lib/production-package-jobs.mjs';
import {productionJobSignature} from './public/production-package-model.js';
import {ensureLayoutHistory} from './public/layout-history.js';
import {EDITOR_SAVE_COMPATIBILITY_LIMIT,EDITOR_SERVER_FIELDS,rotateProjectHistory} from './public/project-save-budget.js';
import {createProjectPortability} from './lib/project-portability.mjs';
import {createRemoteLibrary} from './lib/remote-library.mjs';
import {createBubbleStyleLibrary} from './lib/bubble-style-library.mjs';
import {createProjectSync} from './lib/project-sync.mjs';
import {createTeamReleaseContext} from './lib/team-release-context.mjs';
import {createTeamProduction} from './lib/team-production.mjs';
import {createTeamMemberProxy} from './lib/team-member-services.mjs';
import {createIntegratedRepair,rebaseRepairSessions} from './lib/integrated-repair.mjs';
import {createLocalImageTools} from './lib/local-image-tools.mjs';
import {documentHash,mergeStoryboardImport} from './lib/storyboard-document.mjs';
import {sanitizeTrustedNativeSizing} from './lib/native-sizing.mjs';
import {assertPanelReferenceCoverage,auditPanelReferences} from './public/panel-reference-audit.js';

import {assessFrameComposition} from './public/generation-frame-sizing.js';
import {fitGeneratedArtwork} from './public/artwork-transform.js';
import {assertCharacterReferences} from './public/character-state-references.js';
import {productionPanelDataIssues} from './public/production-panel-prompts.js';
import {ensurePanelGeneration,ensureProjectPanelGeneration,panelProductionShot,panelContentKey,panelProductionSnapshot} from './public/panel-generation.js';
import {referencesForPanel,panelReferenceKey,referenceCountError} from './public/panel-references.js';
import {GenerationSlots} from './lib/generation-slots.mjs';
import {readGate,blockGate,clearGate} from '../distribution/generation-gate.mjs';

import {createEpisodeBoardSharing} from "./lib/episode-boards.mjs";
import {boardAssetIds,remapBoardAssets} from './public/episode-boards.js';









import {archiveRemovedDialogue} from "./public/dialogue-archive.js";
import {createStripExports} from './lib/strip-export.mjs';
import {DEFAULT_MAIN_CONCURRENCY,DEFAULT_REPAIR_CONCURRENCY,normalizeConcurrency} from './lib/concurrency.mjs';
import {GenerationSettings} from './lib/generation-settings.mjs';
import {validateTypography,applyProjectTypography} from './public/unified-typography.js';



import {migrateLayerDocument,normalizeLayerOrder} from './public/layers.js';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {Store,check,cleanId,validateProject,imageInfo,uid} from './lib/store.mjs';
import {inspectTransparentForegroundFile,CodexBridge,sourceKey} from './lib/codex.mjs';
import {JimengBridge,TERMINAL_PHASES} from './lib/jimeng.mjs';
import {stopChild,redact} from './lib/process.mjs';
import {createCodexLogin} from './lib/codex-login.mjs';
import {inspectImageFile,inspectImageFileAsync,localImagePath,imagePathValue,referenceStamp,selectImageFiles} from './lib/image-files.mjs';
import {imagePathKey,registerImagePaths,resolveImageAssets} from './lib/image-directory.mjs';
import {isMountedImagePath,mountedImageIO} from './lib/mounted-io.mjs';
import {createProject,clone,fitImage,bounds} from "./public/model.js";


import {handleComicStyleLibrary,registerComicStyle} from "./lib/comic-style-library.mjs";
import {ComicSfxDesigner} from './lib/comic-sfx-designer.mjs';
import {createImageThumbnails} from './lib/image-thumbnail.mjs';
import {sendFile} from './lib/send-file.mjs';

import {preserveOriginalUploads,validateOriginalRecords,decodeOriginalUpload} from "./lib/source-originals.mjs";
import {createAssetProductionHandler,productionImageIds} from './lib/asset-production-api.mjs';
import {applyAssetResult,remapProductionAssets} from './lib/asset-production.mjs';
import {createBreakoutHandler} from './lib/breakout-api.mjs';
import {applyBreakoutResult} from './lib/breakout-production.mjs';
import {createStateSnapshot} from './lib/state-snapshot.mjs';

import {readStoryboardData} from './lib/storyboard-data.mjs';


import {projectLibraryAssetIds} from './public/project-asset-library.js';
import {createAssetCenterHandler} from './lib/asset-center-api.mjs';
import {createCollabJobs} from './lib/collab-jobs.mjs';
import {createCollabClient} from './lib/collab-client.mjs';
import {createProjectCenterSync} from './lib/project-center.mjs';


const root=path.dirname(fileURLToPath(import.meta.url));
// A single batch must not queue an entire long episode in one click: it is the
// main way a short burst exhausts the provider image quota.
const MAX_BATCH_PANELS=Math.max(1,Math.min(100,Number(process.env.COMIC_MAX_BATCH_PANELS)||24));
const geometryKey=panel=>JSON.stringify({x:panel.x,y:panel.y,w:panel.w,h:panel.h,points:panel.points,imageAssetId:panel.imageAssetId,imageTransform:panel.imageTransform});
const json=(response,status,value)=>{response.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});response.end(JSON.stringify(value));};
async function body(request,maxBytes=2*1024*1024){const chunks=[];let total=0;for await(const chunk of request){total+=chunk.length;check(total<=maxBytes,'文件或请求超过大小限制',413);chunks.push(chunk);}try{return JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');}catch(error){check(false,'请求不是有效 JSON');}}
export function createStudio({dataDir=process.env.COMIC_DATA_DIR||path.join(root,'data'),maxConcurrent=Number(process.env.COMIC_MAIN_MAX_CONCURRENT??(process.env.COMIC_MAX_CONCURRENT?normalizeConcurrency(process.env.COMIC_MAX_CONCURRENT):DEFAULT_MAIN_CONCURRENCY)),repairConcurrent=Number(process.env.COMIC_REPAIR_MAX_CONCURRENT??Math.min(DEFAULT_REPAIR_CONCURRENCY,maxConcurrent)),bridge=new CodexBridge({poolSize:maxConcurrent}),jimengBridge=new JimengBridge({taskRoot:path.resolve(dataDir),stateDir:path.join(dataDir,'provider-jimeng')}),seedReference=false,teamProductionFetcher=fetch,teamProductionNodeFile=null,formalVersionLibrary=null}={}) {
  const store=new Store(dataDir),imageThumbnails=createImageThumbnails(path.join(dataDir,'thumbnails')),running=new Map();
  const teamRelease=createTeamReleaseContext({root,dataDir,store,body,json});
  for(const old of [...store.db.projects]){const result=old.productionPackage?splitProductionScreenBoards(old):{project:clone(old),changed:false};if(!result.changed)result.project=clone(old);const referencesRemoved=stripObsoleteProductionReferences(result.project),sliceChanged=hydrateProductionSlices(result.project,store.db.assets);let bubbleChanged=false;for(const page of result.project.pages)for(const bubble of page.bubbles)bubbleChanged=restoreLegacyBubbleMaterialVisibility(bubble)||bubbleChanged;if(result.changed||sliceChanged||bubbleChanged||referencesRemoved){ensureProjectPanelGeneration(result.project,store.db.assets);validateProject(result.project);const backup=path.join(dataDir,'backups','screen-boards');fs.mkdirSync(backup,{recursive:true});fs.writeFileSync(path.join(backup,old.id+'_r'+old.revision+'.json'),JSON.stringify(old));if(result.changed)rebaseRepairSessions(dataDir,old,result.project);result.project.revision=(old.revision||0)+1;result.project.updated=new Date().toISOString();store.db.projects[store.db.projects.indexOf(old)]=result.project;store.markProject(result.project);}}store.save();
  for(const p of store.db.projects)if(p.layoutHistory&&p.layoutHistory.retention!=='rolling'){ensureLayoutHistory(p);p.revision++;store.markProject?.(p);}store.save();
  {let changed=false;for(const project of store.db.projects)if(hydrateProductionTableRegions(project,dataDir)){store.markProject?.(project);changed=true;}if(changed)store.save();}
  const boardSharing=createEpisodeBoardSharing(store);
  const generationSettings=new GenerationSettings(dataDir,normalizeConcurrency(maxConcurrent),{main:maxConcurrent,repair:repairConcurrent});
  let concurrency=generationSettings.platforms.main;
  // Provider rate limits are account-wide. When Codex answers 429/quota the queue
  // pauses for a cooldown instead of burning the rest of the batch on failures.
  const rateLimit={until:0,strikes:0,timer:null,lastFailure:null};
  const generationGateFile=process.env.COMIC_GENERATION_GATE||path.join(dataDir,'generation-gate.json');
  {
    const gate=readGate(generationGateFile);
    if(gate.until>Date.now()){rateLimit.until=gate.until;rateLimit.strikes=gate.strikes||0;rateLimit.lastFailure=gate.updatedAt;}
  }
  const rateLimitBaseMs=Math.max(250,Number(process.env.COMIC_RATE_LIMIT_COOLDOWN_MS)||60000);
  const rateLimitMaxMs=Math.max(rateLimitBaseMs,Number(process.env.COMIC_RATE_LIMIT_MAX_COOLDOWN_MS)||30*60*1000);
  const rateLimitDelay=()=>Math.min(rateLimitMaxMs,rateLimitBaseMs*2**Math.min(rateLimit.strikes,6));
  bridge.ensurePoolSize?.(generationSettings.limits.codex);
  let closed=false;
  const codexLogin=createCodexLogin(bridge);
  
  
  for(const job of store.db.jobs){if(job.provider!=='jimeng'||job.status!=='failed')continue;const stateFile=path.join(dataDir,'jobs',job.id,'jimeng-state.json');if(!fs.existsSync(stateFile))continue;try{const state=JSON.parse(fs.readFileSync(stateFile,'utf8'));if(TERMINAL_PHASES.includes(state.phase))continue;if(state.submissionAttempted){Object.assign(job,{status:'recoverable',phase:'recoverable',requiredAction:'resume',recovery:jimengBridge.publicState(state),message:'上次即梦任务被中断；请查询原任务恢复，避免重复扣费。'});}else if(state.quote){Object.assign(job,{status:'awaiting_confirmation',phase:'awaiting_confirmation',quote:state.quote,recovery:jimengBridge.publicState(state),message:'即梦草稿已保留，请检查报价并批准消费上限后继续。'});}else if(state.nodeId&&state.submitId){Object.assign(job,{status:'recoverable',phase:'recoverable',requiredAction:'resume',recovery:jimengBridge.publicState(state),message:'即梦保存步骤被中断，请回读原节点恢复到报价；不会直接运行生成。'});}}catch{job.message='即梦恢复记录暂时无法读取，请保留原文件检查。';}}store.save();
  const findPanel=(project,panelId)=>{const page=project.pages.find(page=>page.panels.some(p=>p.id===panelId));const panel=page?.panels.find(p=>p.id===panelId);check(panel,'格子不存在',404);return {page,panel};};
  
  const publicJob=job=>{const result={executionActive:running.has(job.id),...Object.fromEntries(Object.entries(job).filter(([key])=>!['input','key','panelContentKey','referenceKey','approvalCeiling','recoveryOnly','preparationOnly'].includes(key)))},waiting=packageJobWait(job,store);return waiting?{...result,waitingFor:waiting,phase:'dependency',message:waiting.message}:result;};
  const stateSnapshot=createStateSnapshot({store,publicJob,projectView:boardSharing.view});
  const imageGeometryKey=panel=>{const frame=geometryKey(panel);if(!panel.imageAssetId)return frame;const file=store.assetPath(panel.imageAssetId);try{const stat=fs.statSync(file);return JSON.stringify([frame,fs.realpathSync(file),stat.size,stat.mtimeMs,stat.ctimeMs]);}catch{return JSON.stringify([frame,file,'missing']);}};
  function addAsset(filePath,name,source='local-path'){
    return addAssetInfo(inspectImageFile(filePath),name,source);
  }
  function addAssetInfo(info,name,source='local-path'){
    const same=store.db.assets.find(a=>imagePathKey(store.assetPath(a.id))===imagePathKey(info.filePath));
    if(same){Object.assign(same,info);return same;}
    const asset={id:uid('asset'),name:String(name||path.basename(info.filePath)).slice(0,180),...info,source,created:new Date().toISOString()};store.db.assets.push(asset);return asset;
  }
  function generatedAsset(result,directory,name,source,{aligned=false}={}){
    let file=aligned?result.alignedPath:result.filePath;
    if(!file){const bytes=aligned?result.alignedBytes:result.bytes,info=imageInfo(bytes);const out=path.join(directory,'out');fs.mkdirSync(out,{recursive:true});file=path.join(out,(aligned?'aligned':'generated')+info.extension);fs.writeFileSync(file,bytes);}
    return addAsset(file,name,source);
  }
  const referencePath=path.join(root,'public','reference.png');
  if(seedReference&&store.db.assets.length===0&&fs.existsSync(referencePath)&&!store.db.projects[0]?.deletedAt&&store.db.projects[0]?.title==='门前来信 · 排版示例'){
    const asset=addAsset(referencePath,'用户提供的漫画参考','reference');store.db.projects[0].references.push({assetId:asset.id,role:'style',name:asset.name});store.save();
  }
  let projectCenter,projectSync=null;
  function saveProject(project,{editor=false}={}){stripObsoleteProductionReferences(project);hydrateProductionSlices(project,store.db.assets);syncScreenBackgrounds(project,store.db.assets);if(project.layoutHistory)ensureLayoutHistory(project);project.updated=new Date().toISOString();if(editor)project.revision++;store.markProject?.(project);store.save();projectCenter?.mark(project);projectSync?.mark(project);return boardSharing.view(project);}
  
  const generationSlots=new GenerationSlots({directory:process.env.COMIC_SLOT_DIR||path.join(dataDir,'generation-slots'),platforms:generationSettings.platforms,onChange:pump});
  generationSlots.setProviderLimits(generationSettings.limits);
  const localRuntime=path.resolve(root,'../.runtime/image-tools');
  const localTools=createLocalImageTools({runtimeRoot:localRuntime,dataDir,script:path.join(root,'python/local_image_tools.py'),python:path.join(localRuntime,'python/python.exe')});
  const library=createRemoteLibrary({dataDir,configPath:process.env.COMIC_LIBRARY_CONFIG||path.resolve(root,'../asset-studio/data/moku.json'),store,addAsset,body,json});
  const promptRewrites=createPromptRewriteAPI({store,dataDir,bridge,body,json});
  const panelSlices=createPanelSlicesAPI({store,dataDir,body,json,saveProject,addAsset,applyLettering:(...args)=>productionPackages.applyLettering(...args)});
  const productionPackages=createProductionPackageAPI({store,dataDir,library,body,json,saveProject,addAsset,projectView:boardSharing.view,getBubbleManifest:()=>bubbleStyleLibrary.readManifest()});
  library.exportProjectSources=productionPackages.exportSources;
  const projectPortability=createProjectPortability({store,library,dataDir,productionPackages});
  const panelImageImports=createPanelImageImports({store,dataDir});
  // 工程快照自动上传墨库：保存后按内容摘要去重、串行推送；失败只记录状态，不阻断本机保存。
  const episodeVersions=createEpisodeVersionStore({dataDir,store});
  const formalLibrary=formalVersionLibrary||library;
  const formalVersions=createFormalEngineeringVersions({dataDir,store,library:formalLibrary,episodeVersions,validateProject,materializeImage:async(file,r)=>addAssetInfo(await inspectImageFileAsync(file),r.revisionId,'moku-formal-version'),materializeFont:(file,r)=>library.registerSnapshotFont(file,r),getRemoteProjectId:id=>projectSync?.status(id).target?.projectId||''});
  projectSync=createProjectSync({dataDir,store,library,isFormallyManaged:formalVersions.isManaged,projectView:boardSharing.view,json,body});
  const teamMembers=createTeamMemberProxy({root,dataDir,library,body,json});
  // 气泡样式库放在墨库独立文件夹，编辑器从墨库读取；本地文件只用于首次发布。
  const bubbleStyleLibrary=createBubbleStyleLibrary({dataDir,library,store,json,body});
  const localRegions=createLocalRegionAPI({store,dataDir,localTools,body,json,saveProject,addAsset});
  const assetWorkspace=createAssetWorkspaceAPI({store,body,json,saveProject});
  const layerMerge=createLayerMergeAPI({store,dataDir,body,json,saveProject,addAsset});
  const integratedRepair=createIntegratedRepair({dataDir,store,body,json,saveProject,addAsset,apiOrigin:()=>`http://127.0.0.1:${server.address().port}`,localTools});
  const handleAssetCenter=createAssetCenterHandler({store,dataDir,body,json,saveProject,bridge,generationSlots,apiOrigin:()=>`http://127.0.0.1:${server.address().port}`});
  const comicSfxDesigner=new ComicSfxDesigner({store,bridge,slots:generationSlots,dataDir,slotOrigin:()=>`http://127.0.0.1:${server.address().port}`});
  function jimengUncertain(job){
    try{const state=JSON.parse(fs.readFileSync(path.join(dataDir,'jobs',job.id,'jimeng-state.json'),'utf8'));return state.submissionAttempted===true&&state.generationEnded!==true&&!['done','rejected','failed','awaiting_confirmation'].includes(state.phase);}
    catch(error){return error.code!=='ENOENT';}
  }
  // A crashed local CLI does not imply that its cloud image stopped. Only a
  // known pre-submission or finished state can free that persistent slot.
  for(const lease of generationSlots.listRemote()){
    const job=store.db.jobs.find(item=>lease.ownerId==='comic:'+item.id);
    if(job?.provider==='jimeng'&&!jimengUncertain(job))generationSlots.release(lease.token,{completed:true});
  }
  
  
  const handleAssetProduction=createAssetProductionHandler({store,body,json,saveProject,enqueue:enqueueProduction,checkImage:async imageId=>{const result=await resolveImageAssets(store,[imageId]);check(!result.failed.length,'图片原路径已失效，请重新登记原图');}});
  
  
  const handleBreakout=createBreakoutHandler({store,body,json,saveProject,enqueue:enqueueBreakout,python:process.env.COMIC_PYTHON_BIN||bridge.python});
  function enqueueBreakout(project,request){
    check(!closed,'服务正在关闭，请稍后重试',503);check(!store.db.jobs.some(j=>j.projectId===project.id&&j.panelId===request.panelId&&['queued','running','awaiting_confirmation','recoverable','delegated'].includes(j.status)),'当前画格还有生成任务，请等待完成或取消',409);
    check(store.db.jobs.filter(j=>['queued','running'].includes(j.status)).length<120,'任务队列最多保留120个等待或运行任务');request.referenceAssetIds.forEach(id=>localImagePath(store.assetPath(id)));
    const snapshot=clone(request);snapshot.referenceStamp=referenceStamp(request.referenceAssetIds.map(id=>store.assetPath(id)));delete snapshot.bridgeInput;delete snapshot.referenceFiles;
    const job={id:uid('job'),kind:'breakout-foreground',provider:'codex',projectId:project.id,panelId:request.panelId,shotId:'',shotCode:'破框',shotTitle:request.subject,action:'generate',status:'queued',phase:'queued',message:'透明前景已排队，完成后需看图确认',created:new Date().toISOString(),updated:new Date().toISOString(),breakoutRequest:snapshot,input:clone(request.bridgeInput)};
    store.db.jobs.push(job);store.save();void pump();return publicJob(job);
  }
  function enqueueProduction(project,request,input={}){
    check(!closed,'服务正在关闭，请稍后重试',503);const snapshot=request.stageSnapshot;
    check(!store.db.jobs.some(j=>j.projectId===project.id&&j.assetProductionRequest?.stageSnapshot?.assetId===snapshot.assetId&&j.assetProductionRequest?.stageSnapshot?.stageId===snapshot.stageId&&['queued','running','awaiting_confirmation','recoverable','delegated'].includes(j.status)),'这个资产步骤已有任务，请等待完成或取消',409);
    check(store.db.jobs.filter(j=>['queued','running'].includes(j.status)).length<120,'任务队列最多保留120个等待或运行任务');
    request.referenceIds.forEach(assetId=>localImagePath(store.assetPath(assetId)));
    const job={id:uid('job'),kind:'asset-production',provider:request.provider,projectId:project.id,panelId:'',shotId:'',shotCode:request.asset.id,shotTitle:request.asset.name+' · '+request.stage.label,action:'generate',status:'queued',phase:'queued',message:'资产已排队，完成后需看图确认',created:new Date().toISOString(),updated:new Date().toISOString(),assetProductionRequest:{asset:{id:request.asset.id},stage:{id:request.stage.id},stageSnapshot:clone(snapshot),requestKey:request.requestKey,referenceStamp:referenceContentStamp(request.referenceIds.map(id=>store.assetPath(id)))},input:clone(request.bridgeInput)};
    if(input.model)job.input.model=String(input.model).slice(0,100);store.db.jobs.push(job);store.save();void pump();return publicJob(job);
  }
  // 局域网协作接入层（协议 §7）：执行适配层与 A 端客户端都只在 createStudio 内实例化一次。
  // 注意：两者都复用上面的 pump()/running/updateJob/generatedAsset，不复制生图链路。
  const collabJobs=createCollabJobs({store,dataDir,pump,updateJob,addAssetInfo,generatedAsset:(...args)=>generatedAsset(...args),getRunningOperation:id=>running.get(id),isClosed:()=>closed});
  const collabClient=createCollabClient({store,dataDir,root,canApply:task=>projectCenter?.isPolicyCurrent(task.generationInput?.projectPolicy,task.panelId)??true});
  const teamProduction=createTeamProduction({root,dataDir,store,collabClient,body,json,fetcher:teamProductionFetcher,nodeConfigFile:teamProductionNodeFile});
  projectCenter=createProjectCenterSync({store,dataDir,saveProject,collabClient,generationSlots,library,apiOrigin:()=>`http://127.0.0.1:${server.address().port}`});
  function updateJob(job,updates,{soon=false}={}){Object.assign(job,updates,{updated:new Date().toISOString()});if(soon)store.saveSoon();else store.save();}
  // Finished jobs keep their status and timings for the history list. The full generation input
  // is already on disk in jobs/<id>/input.json, so the database copy is dropped once nothing can rerun it.
  const JOB_HISTORY_LIMIT=2000,COMPACTED_JOB_KEYS=['input','key','panelContentKey','referenceKey','geometryKey','autoFillStamp'];
  const jimengResumable=job=>job.provider==='jimeng'&&job.status!=='done'&&!!job.recovery?.submitId;
  const finishedJob=job=>['done','failed','cancelled'].includes(job.status)&&!running.has(job.id)&&!jimengResumable(job);
  function compactJobs(){
    let changed=false;
    for(const job of store.db.jobs)if(finishedJob(job))for(const key of COMPACTED_JOB_KEYS)if(key in job){delete job[key];changed=true;}
    const finished=store.db.jobs.filter(finishedJob);
    if(finished.length>JOB_HISTORY_LIMIT){const drop=new Set(finished.sort((a,b)=>String(a.updated||a.created).localeCompare(String(b.updated||b.created))).slice(0,finished.length-JOB_HISTORY_LIMIT));store.db.jobs=store.db.jobs.filter(job=>!drop.has(job));changed=true;}
    return changed;
  }
  if(compactJobs())store.save();
  function resetJobAttempt(job,{keepGenerationStartedAt=false}={}){
    delete job.dismissedAt;
    for(const key of ['completedAt','errorDetails','errorCode','requiredAction','validation','protocol','nativeDiagnostics','startedAt','phaseStartedAt','elapsedMs','stage','timings','generationCompletedAt','imageGenerationMs','dispatchEffort'])delete job[key];
    if(!keepGenerationStartedAt)delete job.generationStartedAt;
  }
  function scheduler(){const value={concurrency:generationSlots.mainLimit(),active:running.size,queued:store.db.jobs.filter(j=>j.status==='queued').length,episodeBatches:episodeBatches.snapshot()};if(Date.now()<rateLimit.until){value.pausedUntil=rateLimit.until;value.rateLimitStrikes=rateLimit.strikes;}return value;}
  function schedulePumpAfterCooldown(){
    if(closed||rateLimit.timer||rateLimit.until<=Date.now())return;
    rateLimit.timer=setTimeout(()=>{rateLimit.timer=null;if(!closed)pump();},Math.max(0,rateLimit.until-Date.now())+50);
    rateLimit.timer.unref?.();
  }
  function clearRateLimitCooldown(){
    rateLimit.strikes=0;rateLimit.until=0;rateLimit.lastFailure=null;
    if(rateLimit.timer){clearTimeout(rateLimit.timer);rateLimit.timer=null;}
    clearGate(generationGateFile);
  }
  function pump(){
    if(closed)return;
    const sharedGate=readGate(generationGateFile);
    if(sharedGate.until>rateLimit.until)rateLimit.until=sharedGate.until;
    if(Date.now()<rateLimit.until){schedulePumpAfterCooldown();return;}
    const remoteOwners=new Set(generationSlots.listRemote().map(lease=>lease.ownerId));
    function start(job,remoteRecovery=false){
      const operation={controller:new AbortController(),handle:null,remoteRecovery};running.set(job.id,operation);
      const startedAt=new Date().toISOString();
      updateJob(job,{status:'running',phase:'preparing',startedAt,phaseStartedAt:startedAt,message:'正在准备镜头参考'});
      void executeJob(job,operation);
    }
    // Queries reuse the original cloud slot. They must remain runnable when
    // two ordinary local jobs are already waiting for those same slots.
    for(const job of store.db.jobs.filter(j=>j.status==='queued'&&j.provider==='jimeng'&&j.recoveryOnly===true&&remoteOwners.has('comic:'+j.id)))start(job,true);
    while([...running.values()].filter(operation=>!operation.remoteRecovery).length<generationSlots.mainLimit()){
      const job=store.db.jobs.find(j=>{
        if(j.status!=='queued'||running.has(j.id)||!packageJobReady(j,store))return false;
        const provider=j.provider||'codex';
        const active=store.db.jobs.filter(item=>(item.provider||'codex')===provider&&((running.has(item.id)&&!running.get(item.id).remoteRecovery)||remoteOwners.has('comic:'+item.id))).length;
        return active<generationSettings.limits[provider];
      });if(!job)break;
      start(job);
    }
  }
  async function executeJob(job,operation){
    let lease,completed=false;
    try{
      updateJob(job,{message:`等待生图名额；主平台平时最多 ${concurrency} 张，补图任务优先插队`});
      lease=await generationSlots.acquire({ownerId:'comic:'+job.id,requestId:uid('attempt'),recoveryOnly:job.recoveryOnly===true,signal:operation.controller.signal,provider:job.provider||'codex'});
      if(operation.controller.signal.aborted)throw Object.assign(new Error('任务已取消'),{name:'AbortError'});
      const directory=job.kind==='collab-generation'?path.join(dataDir,'collab','jobs',job.id):path.join(dataDir,'jobs',job.id);fs.mkdirSync(directory,{recursive:true});
      refreshPackageJob(job,store);if(job.input.productionSource)fs.writeFileSync(path.join(directory,'production-source.json'),JSON.stringify(job.input.productionSource,null,2));
      const resolved=job.input.referenceRoles.length?await resolveImageAssets(store,job.input.referenceRoles.map(ref=>ref.assetId)):{assets:[],failed:[]};
      check(!resolved.failed.length,'参考原图无法读取：'+resolved.failed.map(f=>(f.filePath||f.assetId)+'：'+f.error).join('；'));
      const referenceFiles=job.input.referenceRoles.map(reference=>localImagePath(store.assetPath(reference.assetId))),contentReferences=!!job.productionSignature||!!job.input.productionSource||job.assetProductionRequest?.referenceStamp?.startsWith('sha256:'),referencesBefore=contentReferences?referenceContentStamp(referenceFiles):referenceStamp(referenceFiles);
      if(job.productionSignature||job.input.productionSource){job.referenceContentStamp=referencesBefore;store.save();}
      const selectedBridge=job.provider==='jimeng'?jimengBridge:bridge;
      const bridgeInput=job.provider==='jimeng'?job.input:{...job.input,referenceRoles:referencePackingRoles(job.input.referenceRoles,{project:store.db.projects.find(p=>p.id===job.projectId)||{},assets:store.db.assets})};
      if(job.provider==='jimeng')lease.keepRemote();
      const result=await selectedBridge.generate(directory,bridgeInput,referenceFiles,{approvalCeiling:job.approvalCeiling,recoveryOnly:job.recoveryOnly===true,preparationOnly:job.preparationOnly===true,signal:operation.controller.signal,globalSlot:{origin:`http://127.0.0.1:${server.address().port}`,token:lease.token},onWorkerPid:pid=>lease.trackPid(pid),onChild:handle=>{operation.handle=handle;if(Number.isInteger(handle?.pid)&&handle.pid>0)lease.trackPid(handle.pid);},onProgress:(message,details={})=>{
        if(job.status!=='running')return;const phase=details.phase||job.phase;
        if(details.referencePacking)job.referencePacking=details.referencePacking;
        updateJob(job,{message,phase,stage:details.stage||null,...(phase!==job.phase?{phaseStartedAt:new Date().toISOString()}:{}),...(phase==='generating'&&!job.generationStartedAt?{generationStartedAt:new Date().toISOString()}:{}),...(details.stage==='image_generation_completed'?{generationCompletedAt:new Date().toISOString(),...(Number.isFinite(details.imageGenerationMs)?{imageGenerationMs:details.imageGenerationMs}:{})}:{}),...(details.dispatchEffort?{dispatchEffort:details.dispatchEffort}:{}),elapsedMs:details.elapsedMs,...(details.recovery?{recovery:details.recovery}:{})},{soon:!details.phase||details.phase===job.phase});
      }});
      completed=true;
      clearRateLimitCooldown();
       if(closed)return;
      if(result.awaitingConfirmation){if(job.kind==='collab-generation'){updateJob(job,{status:'failed',phase:'failed',completedAt:new Date().toISOString(),message:'即梦需要批准积分，协作任务不能自动批准；请在执行节点改用 Codex 或手动处理'});return;}updateJob(job,{status:'awaiting_confirmation',phase:'awaiting_confirmation',quote:result.quote,recovery:result.recovery,message:`即梦需要批准积分；本镜头报价 ${result.quote.totalMaxCredits} 积分，请明确批准消费上限`});return;}
        // 协作任务：只校验/登记结果并写回 job，绝不触碰任何工程画格（回填由 A 端 collab-apply 完成）。
        if(job.kind==='collab-generation'){collabJobs.complete(job,result,{directory});return;}
        const rawAsset=generatedAsset(result,directory,`${job.shotCode} · ${job.shotTitle} · 原始生成图`,job.provider==='jimeng'?'jimeng':'codex');
        const frameComposition=assessFrameComposition(job.input,rawAsset);if(job.input.editScope==='full-image'&&Math.abs(rawAsset.width/rawAsset.height-job.input.fullImageSource.width/job.input.fullImageSource.height)>.001)result.alignmentError='改图结果比例与原图不同，已保留候选，请人工采用';
        if(frameComposition){result.nativeComposition=frameComposition;const native=result.nativeGeneration,expectedModel=job.input.nativeSizing?.imageModelId||job.input.model;
          if(native?.notice&&result.alignmentError===native.notice&&native.provider===job.provider&&(!expectedModel||!native.imageModelId||native.imageModelId===expectedModel))result.alignmentError=null;
        }
        if(result.nativeComposition){rawAsset.nativeComposition=clone(result.nativeComposition);job.nativeComposition=clone(result.nativeComposition);}
        if(result.nativeGeneration){rawAsset.nativeGeneration=clone(result.nativeGeneration);job.nativeSizingResult=clone(result.nativeGeneration);}if(result.sizeMismatch&&!result.alignmentError&&!result.nativeComposition)result.alignmentError='实际生图尺寸与设计要求不一致，已保留原图候选';
        if(job.kind==='breakout-foreground'){
          check(result.transparency?.valid===true,'生成结果未通过真实PNG透明像素验收');rawAsset.transparency=clone(result.transparency);
          const current=store.db.projects.find(p=>p.id===job.projectId&&!p.deletedAt);let candidate=null;
          if(current&&job.status!=='cancelled'){const merged=applyBreakoutResult(clone(current),job.breakoutRequest,{assetId:rawAsset.id,jobId:job.id,alphaVerified:true,transparency:result.transparency,assets:store.db.assets});candidate=merged.candidate;
            let refsCurrent=false;try{refsCurrent=referencesBefore===referenceStamp(job.input.referenceRoles.map(ref=>store.assetPath(ref.assetId)));}catch{}candidate.referenceStamp=job.breakoutRequest.referenceStamp;if(!refsCurrent||referencesBefore!==job.breakoutRequest.referenceStamp)candidate.status='stale';
            store.db.projects[store.db.projects.indexOf(current)]=merged.project;saveProject(merged.project,{editor:true});}
          updateJob(job,{status:job.status==='cancelled'?'cancelled':'done',phase:job.status==='cancelled'?'cancelled':'done',assetId:rawAsset.id,rawAssetId:rawAsset.id,applied:false,completedAt:new Date().toISOString(),message:candidate?.status==='ready'?'透明前景已生成，请在本格确认加入':'透明前景已保留，来源有变化，请重新核验'});return;
        }
        if(job.kind==='asset-production'){
          rawAsset.productionStatus='candidate';rawAsset.productionAssetId=job.assetProductionRequest.stageSnapshot.assetId;rawAsset.productionStageId=job.assetProductionRequest.stageSnapshot.stageId;
          let unchanged=false;try{unchanged=referencesBefore===(job.assetProductionRequest.referenceStamp?.startsWith('sha256:')?referenceContentStamp:referenceStamp)(job.input.referenceRoles.map(ref=>store.assetPath(ref.assetId)));}catch{}
          const current=store.db.projects.find(p=>p.id===job.projectId&&!p.deletedAt);let stale=true;
          if(current&&job.status!=='cancelled'){try{const merged=applyAssetResult(current,job.assetProductionRequest,{assetId:rawAsset.id,jobId:job.id,stale:!unchanged||referencesBefore!==job.assetProductionRequest.referenceStamp});merged.candidate.referenceStamp=job.assetProductionRequest.referenceStamp;stale=merged.stale;store.db.projects[store.db.projects.indexOf(current)]=merged.project;saveProject(merged.project,{editor:true});}catch(error){job.assetNotice=error.message;}}
          updateJob(job,{status:job.status==='cancelled'?'cancelled':'done',phase:job.status==='cancelled'?'cancelled':'done',assetId:rawAsset.id,rawAssetId:rawAsset.id,applied:false,completedAt:new Date().toISOString(),timings:result.timings||null,message:stale?'资产图已保留，设定或参考有变化，请重新核验':'资产图已生成，请在拆解资产中看图确认'});return;
        }
        const asset=result.alignedPath||result.alignedBytes?generatedAsset(result,directory,`${job.shotCode} · 对齐后的重绘`,job.provider==='jimeng'?'jimeng-edit':'codex-edit',{aligned:true}):rawAsset;let applied=false,referencesUnchanged=false,bindingUnchanged=await projectCenter.isPolicyCurrent(job.input.projectPolicy,job.panelId);
        try{referencesUnchanged=referencesBefore===(contentReferences?referenceContentStamp:referenceStamp)(job.input.referenceRoles.map(reference=>store.assetPath(reference.assetId)));}catch{}
        const project=store.db.projects.find(p=>p.id===job.projectId);let autoApplyBlocked=['工程已删除'];
        if(project){const page=project.pages.find(p=>p.panels.some(f=>f.id===job.panelId)),target=page?.panels.find(p=>p.id===job.panelId),shot=project.shots.find(s=>s.id===job.shotId);
          let comparison={project,frame:target,signatureUnchanged:true};try{comparison=packageResultView(project,target,store.db.assets,job.productionSignature);}catch{comparison.signatureUnchanged=false;}bindingUnchanged&&=comparison.signatureUnchanged;
          if(target&&job.referenceKey){try{bindingUnchanged&&=panelReferenceKey(comparison.project,comparison.frame,store.db.assets)===job.referenceKey;}catch{bindingUnchanged=false;}}
          let contentUnchanged=false;if(target){try{contentUnchanged=job.panelContentKey?(job.input.editScope==='full-image'?JSON.stringify({generation:target.generation,referenceIds:target.referenceIds}):panelContentKey(comparison.project,comparison.frame,store.db.assets))===job.panelContentKey:!!shot&&sourceKey(project,shot)===job.key;}catch{}}
          autoApplyBlocked=autoApplyBlocks({target,page,job,contentUnchanged:contentUnchanged&&(!job.panelContentKey?target?.shotId===job.shotId:true),referencesUnchanged,bindingUnchanged,geometryUnchanged:!!target&&(job.autoFillStamp?generationTargetStamp(target,job.action,id=>store.assetPath(id))===job.autoFillStamp:!job.geometryKey||imageGeometryKey(target)===job.geometryKey),alignmentError:result.alignmentError});
          if(target){target.candidates=[...new Set([...target.candidates,...(job.input.editScope==='full-image'&&target.imageAssetId?[target.imageAssetId]:[]),rawAsset.id,asset.id])].slice(-40);if(!autoApplyBlocked.length){if(comparison.frame!==target){target.referenceIds=[...comparison.frame.referenceIds];target.generation.referenceRoles=clone(comparison.frame.generation.referenceRoles);}target.imageAssetId=asset.id;target.imageTransform=job.input.editScope==='full-image'?{...job.input.fullImageSource.transform,scale:job.input.fullImageSource.transform.scale*job.input.fullImageSource.width/asset.width}:job.action==='edit'?{x:job.input.cropBox[0]-target.x,y:job.input.cropBox[1]-target.y,scale:1}:fitGeneratedArtwork(target,asset);target.imageEffects={version:1,imageAssetId:asset.id,artDirection:clone(job.input.shot.artDirection||{})};applied=true;if(target.productionSegment&&productionSegmentUnit(project,job.input.shot.episode,target.productionSegment)==='screen')ensureProductionScreenLettering(project,target.productionSegment);}syncScreenBackgrounds(project,store.db.assets);project.updated=new Date().toISOString();}
        }
        updateJob(job,{status:job.status==='cancelled'?'cancelled':'done',assetId:asset.id,rawAssetId:rawAsset.id,applied,autoApplyBlocked,repairedPage:result.repairedPage,imageToolSeen:result.imageToolSeen,message:applied?'镜头已生成并贴入格子'+(result.nativeComposition?.notice?'；'+result.nativeComposition.notice:''):'结果已保留为候选：'+autoApplyBlocked.join('；'),description:result.description});
      if(job.status==='done')updateJob(job,{phase:'done',completedAt:new Date().toISOString(),timings:result.timings||null,...(result.recovery?{recovery:result.recovery}:{})});
     }catch(error){completed||=error.generationEnded===true;if(job.status!=='cancelled'&&!closed){
      if(error.code==='account_rate_limited'){
        // The provider refused the request before any turn existed. Keep the job
        // queued (not failed), pause the whole queue and resume automatically.
        rateLimit.strikes++;rateLimit.until=Date.now()+rateLimitDelay();rateLimit.lastFailure=new Date().toISOString();
        blockGate(generationGateFile,rateLimit.until,'codex_rate_limited',rateLimit.strikes);
        const resume=new Date(rateLimit.until).toLocaleTimeString('zh-CN',{hour12:false});
        updateJob(job,{status:'queued',phase:'queued',message:`官方 Codex 账号限流或额度用尽（429）；队列已暂停到 ${resume}，恢复后自动继续。本次没有提交生成，原图与任务保留，请勿重复提交。`,errorCode:error.code,requiredAction:null,rateLimitedUntil:rateLimit.until});
        schedulePumpAfterCooldown();return;
      }
      if(job.provider==='jimeng'&&error.awaitingConfirmation){updateJob(job,{status:'awaiting_confirmation',phase:'awaiting_confirmation',quote:error.quote,recovery:error.recovery,requiredAction:error.requiredAction||null,errorCode:error.code||null,message:redact(error.message)});return;}
      const recoverable=job.provider==='jimeng'&&error.recoverable===true;
      updateJob(job,{status:recoverable?'recoverable':'failed',phase:recoverable?'recoverable':'failed',completedAt:new Date().toISOString(),message:redact(error.message).slice(0,900),requiredAction:error.requiredAction||null,errorCode:error.code||null,...(error.diagnostics?{nativeDiagnostics:error.diagnostics}:{}),...(error.validation?{validation:error.validation}:{}),...(error.protocol?{protocol:error.protocol}:{}),...(error.recovery?{recovery:error.recovery}:{})});
    }}
    finally{try{if(lease)await lease.release({completed:completed||(job.provider==='jimeng'&&!jimengUncertain(job))});}finally{running.delete(job.id);if(!closed&&compactJobs())store.save();pump();}}
  }
  function checkAssets(project){for(const id of project.assetLibrary?.assetIds||[])store.asset(id);for(const id of boardAssetIds(project))store.asset(id);for(const id of productionImageIds(project))store.asset(id);for(const ref of project.references)store.asset(ref.assetId);for(const shot of project.shots)for(const id of shot.referenceIds)store.asset(id);for(const page of project.pages)for(const panel of page.panels){if(panel.imageAssetId)store.asset(panel.imageAssetId);for(const c of panel.breakoutCandidates||[]){store.asset(c.assetId);if(c.backgroundAssetId)store.asset(c.backgroundAssetId);for(const id of c.referenceAssetIds||[])store.asset(id);}if(panel.panelSlice?.sourceAssetId)store.asset(panel.panelSlice.sourceAssetId);if(panel.cutoutLayer?.sourceAssetId)store.asset(panel.cutoutLayer.sourceAssetId);if(panel.breakoutForeground?.backgroundAssetId)store.asset(panel.breakoutForeground.backgroundAssetId);for(const candidate of panel.candidates)store.asset(candidate);for(const id of panel.referenceIds||[])store.asset(id);}}
  // Panel images, candidates and references must exist for a complete export; bubble materials are optional.
  function panelAssetRequired(project,id){return boardAssetIds(project).includes(id)||productionImageIds(project).includes(id)||project.references.some(r=>r.assetId===id)||project.shots.some(s=>s.referenceIds.includes(id))||project.pages.some(page=>page.panels.some(panel=>panel.imageAssetId===id||panel.candidates.includes(id)||(panel.breakoutCandidates||[]).some(c=>c.assetId===id||c.backgroundAssetId===id||(c.referenceAssetIds||[]).includes(id))||panel.cutoutLayer?.sourceAssetId===id||panel.breakoutForeground?.backgroundAssetId===id||(panel.referenceIds||[]).includes(id)));}
  // Bubble materials point at assets too. Keep them valid in the importing data directory:
  // remap exported assets, re-register library materials, or drop a reference that cannot be resolved.
  function remapBubbleAssets(bubble,mapping){
    for(const [key,styleKey] of [['styleTextureAssetId','styleTextureId'],['visualAssetId','visualStyleId']]){
      if(!bubble[key])continue;
      if(mapping.get(bubble[key])){bubble[key]=mapping.get(bubble[key]);continue;}
      let restored=null;if(bubble[styleKey]){try{restored=registerComicStyle(store,bubble[styleKey]).id;}catch{}}
      if(restored)bubble[key]=restored;else delete bubble[key];
    }
  }
  const stripExports=createStripExports({dataDir,store,body,json,projectView:boardSharing.view});
  const autoLayout=createAutoLayoutAPI({store,dataDir,body,json,validateProject,checkAssets,addAsset,saveProject});
  async function submitGenerationJobs(input,hooks={}){
        const project=store.project(cleanId(input.projectId)),panelIds=input.panelIds,action=input.action==='edit'?'edit':'generate',provider=input.provider==='jimeng'?'jimeng':'codex';
        const fullImage=action==='edit'&&input.editScope==='full-image';check(!input.editScope||fullImage,'改图模式无效');check(!fullImage||provider==='codex','整张原图改图使用 Codex');
        check(project.autoLayoutSource?.mode!=='screen-crop-reflow','成图重排工程只复用已有图片，不提交重新生图；请回到原工程制作新图',409);
        check(!panelIds.some(id=>project.pages.some(p=>p.panels.some(f=>f.id===id&&f.autoLayoutCrop))),'成图重排画格复用已有图片，不能直接重新生图',409);
        check(!input.provider||['jimeng','codex'].includes(input.provider),'生图来源无效');
        if(input.expectedRevision!==undefined)check(input.expectedRevision===project.revision,'当前排版已改变，请重新发起生成或重绘。',409);
        check(Array.isArray(panelIds)&&panelIds.length>0&&panelIds.length<=MAX_BATCH_PANELS&&new Set(panelIds).size===panelIds.length,`一批最多提交 ${MAX_BATCH_PANELS} 个不同格子，请分批生成`);
        if(!hooks.beforeCommit)check(!panelIds.some(id=>episodeBatches.reserved(project.id,id)),'画格已加入本话自动提交，请先停止后续批次',409);
        await teamProduction.refreshReservations(project.id);teamProduction.assertAvailable(project.id,panelIds);
        check(store.db.jobs.filter(j=>['queued','running'].includes(j.status)).length+panelIds.length<=120,'任务队列最多保留 120 个等待或运行任务');
        const packageModel=provider==='jimeng'&&(project.productionPackage||project.pages.some(p=>p.panels.some(f=>panelIds.includes(f.id)&&textAssetSignature(f).length)))?(await jimengBridge.models()).items?.find(m=>m.model===input.model):null;if(provider==='jimeng'&&project.productionPackage)check(packageModel,'请重新选择可用的官方模型');const candidates=panelIds.map(panelId=>{const {panel}=findPanel(project,cleanId(panelId));check(!panel.locked,'请先解锁格子');check(!project.pages.find(p=>p.panels.includes(panel))?.locked,'请先解锁画板');if(fullImage){check(panel.imageAssetId&&input.sourceImageAssetId===panel.imageAssetId,'原图已改变，请重新发起改图',409);return {panel,shot:{id:panel.shotId||'',code:panel.name||'整图修改',title:panel.name||'整图修改',description:input.editPrompt||''},refs:[],packagePlan:null};}check(panel.coordinateSource?.generation!=='不生成','该格标记为不生成，仅显示边框与文字');check(!panel.breakoutForeground,'透明前景请通过原画格的破框功能生成');ensurePanelGeneration(project,panel,store.db.assets);const packagePlan=preparePackageJob(project,panel,store.db.assets,panelIds,store.db.jobs);if(packagePlan&&packageModel){const error=referenceCountError(packageModel,textAssetGenerationMode(packageModel,input.mode,packagePlan.refs.length+packagePlan.dependencies.length,panel,{edit:action==='edit'}),packagePlan.refs.length+packagePlan.dependencies.length,{edit:action==='edit'});check(!error,error);}if(panel.productionGrid){const record=project.productionPackage.episodes.flatMap(e=>e.panelRecords).find(r=>r.id===panel.productionGrid.panelId&&r.segmentId===panel.productionGrid.segmentId),problems=productionPanelDataIssues(record,{referenceAudit:auditPanelReferences(project,panel,store.db.assets)});check(!problems.length,'本格分镜资料不完整：'+panel.productionGrid.panelId+'；'+problems.join('；'));}const shot=panelProductionShot(project,panel,store.db.assets);check(shot.description.trim(),'请先填写本格提示词');const refs=referencesForPanel(project,panel,store.db.assets);if(panel.productionGrid||panel.panelSlice)verifyProductionReferenceFiles({segment:project.productionPackage.episodes.flatMap(e=>e.segments).find(s=>s.id===(panel.productionGrid||panel.panelSlice).segmentId),refs},store.db.assets);if(input.referenceIdsByPanel!==undefined){check(input.referenceIdsByPanel&&typeof input.referenceIdsByPanel==='object'&&!Array.isArray(input.referenceIdsByPanel),'本格参考请求格式无效');check(JSON.stringify(input.referenceIdsByPanel[panelId])===JSON.stringify(refs.map(ref=>ref.assetId)),'本格参考已改变，请保存并重新发起生成',409);}refs.forEach(ref=>store.asset(ref.assetId));if(!packagePlan){if(!panel.productionGrid&&!panel.panelSlice)assertCharacterReferences(project,shot,store.db.assets,refs.map(ref=>ref.assetId),panel);assertPanelReferenceCoverage(project,panel,store.db.assets);}return {panel,shot,refs,packagePlan};});
        await handleAssetCenter.ensureAssets(candidates.flatMap(candidate=>candidate.refs.map(ref=>ref.assetId)));await projectCenter.ensureAssets(candidates.flatMap(candidate=>candidate.refs.map(ref=>ref.assetId)));
        const projectPolicy=await projectCenter.preflight(project,panelIds);
        check(store.project(project.id)===project&&(input.expectedRevision===undefined||input.expectedRevision===project.revision),'读取共享资产期间工程已改变，请重新发起',409);
        let basePageBytes=null,basePanelBytes=null,cropBox=null,maskPolygon=null,fullImageSource=null;
        if(action==='edit'){
          check(panelIds.length===1&&typeof input.editPrompt==='string'&&input.editPrompt.trim()&&input.editPrompt.length<=10000,'重绘需要一个格子和明确修改要求');
          const {page,panel}=findPanel(project,panelIds[0]);check(panel.imageAssetId,'请先给格子填入图片再重绘');
          if(fullImage){
            const file=store.assetPath(panel.imageAssetId);basePanelBytes=fs.readFileSync(file);const info=imageInfo(basePanelBytes);cropBox=[0,0,info.width,info.height];
            fullImageSource={assetId:panel.imageAssetId,width:info.width,height:info.height,sha256:createHash('sha256').update(basePanelBytes).digest('hex'),transform:clone(panel.imageTransform||fitImage(panel,info))};
          }else{
          const b=bounds(panel),left=Math.max(0,Math.floor(panel.x+b.x)),top=Math.max(0,Math.floor(panel.y+b.y)),right=Math.min(page.width,Math.ceil(panel.x+b.x+b.w)),bottom=Math.min(page.height,Math.ceil(panel.y+b.y+b.h));check(right>left&&bottom>top,'格子不在当前页面内');cropBox=[left,top,right-left,bottom-top];maskPolygon=panel.points.map(p=>[panel.x+p.x*panel.w,panel.y+p.y*panel.h]);
          if(input.basePanelDataUrl!==undefined){
            check(typeof input.basePanelDataUrl==='string'&&/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(input.basePanelDataUrl),'局部重绘快照无效');
            const region=input.baseRegion;check(region&&[region.x,region.y,region.w,region.h].every(Number.isInteger)&&JSON.stringify([region.x,region.y,region.w,region.h])===JSON.stringify(cropBox),'局部快照区域与当前格子不一致，请重新发起重绘',409);
            basePanelBytes=Buffer.from(input.basePanelDataUrl.split(',')[1],'base64');const info=imageInfo(basePanelBytes);check(info.width===cropBox[2]&&info.height===cropBox[3],'局部快照尺寸与当前格子不一致',409);
          }else{
            check(provider!=='jimeng','即梦重绘需要局部格子快照，请刷新页面后重试',409);
            check(typeof input.basePageDataUrl==='string'&&/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(input.basePageDataUrl),'重绘缺少当前页面快照');basePageBytes=Buffer.from(input.basePageDataUrl.split(',')[1],'base64');const info=imageInfo(basePageBytes);check(info.width===page.width&&info.height===page.height,'页面快照尺寸与当前长图不一致');
          }
        }
        }
        const selectedBridge=provider==='jimeng'?jimengBridge:bridge,status=await selectedBridge.status();check(status.connected,status.message,409);if(provider==='codex')check(status.imageFeature,'当前 Codex 未开启内置生图功能，请检查 Codex 版本与设置。',409);
        if(provider==='jimeng'){check(typeof input.model==='string'&&input.model.trim(),'请选择即梦官方模型');check(['t2i','i2i'].includes(input.mode),'请选择即梦生图方式');}
        for(const {panel} of candidates){if(fullImage)continue;const sizing=panel.nativeSizing;if(sizing?.mode!=='model-long')continue;check(sizing.provider===provider,'当前主格的长幅尺寸属于另一通道，请先更新尺寸方案',409);if(provider==='jimeng'){check(!sizing.imageModelId||sizing.imageModelId===input.model,'主格尺寸能力与当前即梦模型不一致',409);check(!sizing.generationMode||sizing.generationMode===input.mode,'主格尺寸能力与即梦生成方式不一致',409);check(!sizing.request?.ratio||!input.ratio||sizing.request.ratio===input.ratio,'主格尺寸方案与所选生成比例不一致',409);input.ratio??=sizing.request?.ratio;input.resolution??=sizing.request?.resolution;}}
        check(store.project(project.id)===project,'连接检查期间工程已改变，请重新提交生成。',409);
        check(store.db.jobs.filter(j=>['queued','running'].includes(j.status)).length+panelIds.length<=120,'任务队列最多保留120个等待或运行任务');
        check(!store.db.jobs.some(j=>j.projectId===project.id&&panelIds.includes(j.panelId)&&['queued','running','awaiting_confirmation','recoverable','delegated'].includes(j.status)),'这个格子已经在排队或生成，请等待完成或取消当前任务。',409);
        if(input.expectedRevision!==undefined)check(input.expectedRevision===project.revision,'当前排版已改变，请重新发起生成或重绘。',409);
        if(!hooks.beforeCommit)check(!panelIds.some(id=>episodeBatches.reserved(project.id,id)),'画格已加入本话自动提交，请先停止后续批次',409);
        if(fullImage)check(fullImageSource.sha256===createHash('sha256').update(fs.readFileSync(store.assetPath(fullImageSource.assetId))).digest('hex'),'原图文件已改变，请重新提交',409);
        hooks.beforeCommit?.();
        const batchId=uid('batch'),submittedAt=new Date().toISOString();const jobs=candidates.map(({panel,shot,refs,packagePlan})=>{const job={id:uid('job'),batchId,batchSize:candidates.length,provider,projectId:project.id,panelId:panel.id,shotId:panel.shotId||'',shotCode:shot.code,shotTitle:shot.title,action,status:'queued',phase:'queued',message:provider==='jimeng'?'等待即梦保存与报价':'等待 Codex 生成',created:submittedAt,updated:submittedAt,panelContentKey:fullImage?JSON.stringify({generation:panel.generation,referenceIds:panel.referenceIds}):panelContentKey(project,panel,store.db.assets),geometryKey:imageGeometryKey(panel),autoFillStamp:generationTargetStamp(panel,action,id=>store.assetPath(id)),referenceKey:panelReferenceKey(project,panel,store.db.assets),input:clone({action,editScope:fullImage?'full-image':undefined,fullImageSource,projectId:project.id,projectTitle:project.title,model:input.model,mode:provider==='jimeng'?textAssetGenerationMode(packageModel,input.mode,refs.length+ (packagePlan?.dependencies.length||0),panel,{edit:action==='edit'}):input.mode,ratio:input.ratio,resolution:input.resolution,shot,projectPolicy:projectPolicy||undefined,style:fullImage?'':project.style,panel:fullImage?{...panelProductionSnapshot(panel,project),nativeSizing:null}:panelProductionSnapshot(panel,project),nativeSizing:fullImage?null:panel.nativeSizing||null,referenceRoles:refs,textAssetReferences:fullImage?[]:panelTextAssets(project,panel,store.db.assets),editPrompt:input.editPrompt||'',cropBox,maskPolygon,feather:panel.feather,border:panel.border})};if(packagePlan){job.productionDependencies=packagePlan.dependencies;job.productionSignature=productionJobSignature(project,panel);if(packagePlan.dependencies.length)job.message='等待接续前段成图';}const gridSource=panel.productionGrid||panel.panelSlice;if(!fullImage&&gridSource&&project.productionPackage)job.input.productionSource={packageId:project.productionPackage.id,packageHash:project.productionPackage.hash,segmentId:gridSource.segmentId,gridId:gridSource.panelId,source:gridSource.sourceLocation,originalPrompt:shot.description,promptSource:shot.promptSource,textAssetReferences:job.input.textAssetReferences,referenceOrder:refs.map(r=>r.assetId),referenceVersions:productionReferenceVersions(project,panel,refs,store.db.assets)};if(basePageBytes){const directory=path.join(dataDir,'jobs',job.id);fs.mkdirSync(directory,{recursive:true});const base=path.join(directory,'base_page.png');fs.writeFileSync(base,basePageBytes);job.input.basePagePath=base;}if(basePanelBytes){const directory=path.join(dataDir,'jobs',job.id);fs.mkdirSync(directory,{recursive:true});const base=path.join(directory,'base_panel.png');fs.writeFileSync(base,basePanelBytes);job.input.basePanelPath=base;}panel.generationToken=job.id;store.db.jobs.push(job);return job;});hooks.onCommitted?.(jobs);store.save();if(hooks.onCommitted&&store.lastSaveError){for(const job of jobs)Object.assign(job,{status:'failed',phase:'failed',message:'任务进度未成功保存，未调用生图通道'});throw Error('任务进度暂时无法写盘，请检查磁盘后重新提交');}void pump();return jobs.map(publicJob);
      }

  const episodeBatches=createEpisodeGenerationBatches({db:store.db,save:()=>{store.save();check(!store.lastSaveError,'自动提交进度暂时无法写盘，请检查磁盘后重新发起',503);},redact,isExecuting:id=>running.has(id),
    capacity:provider=>Math.min(MAX_BATCH_PANELS,generationSlots.mainLimit(),generationSettings.limits[provider]||generationSlots.mainLimit()),
    select:(plan,id)=>{
      const project=store.project(plan.projectId),owner=project.pages.find(p=>p.panels.some(f=>f.id===id)),frame=owner?.panels.find(f=>f.id===id);
      if(!frame)return '画格已删除';if(owner.locked)return '画板已锁定';
      const anchor=project.pages.find(p=>p.id===plan.pageId);if(!anchor||currentBoardEpisode(project,anchor)!==plan.episode)return '原话画板已改变';
      return episodeGenerationPanelIds(project,anchor,store.db.jobs.filter(j=>j.projectId===project.id)).includes(id)?null:'画格已有图片、已锁定、已隐藏、正在处理或缺少提示词，已跳过';
    },
    submit:(input,hooks)=>{
      const project=store.project(input.projectId),refs={...input.referenceIdsByPanel};
      for(const id of input.panelIds){const {panel}=findPanel(project,id);if(panel.productionSegment||panel.productionBackground){preparePackageJob(project,panel,store.db.assets,input.panelIds,store.db.jobs);refs[id]=referencesForPanel(project,panel,store.db.assets).map(r=>r.assetId);}}
      return submitGenerationJobs({...input,referenceIdsByPanel:input.referenceIdsByPanel?refs:undefined,expectedRevision:project.revision},hooks);
    }
  });
  const server=http.createServer(async(request,response)=>{
    try{
      const host=request.headers.host||'',origin=request.headers.origin;
      check(/^(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/i.test(host),'仅允许本机访问',403);
      if(origin)check(origin===`http://${host}`,'请从本机工具页面发起请求',403);
      const url=new URL(request.url,`http://${host}`),pathname=decodeURIComponent(url.pathname),method=request.method;
      if(await autoLayout.handle(request,response,{pathname,method}))return;
      // 协作接入层统一分派：只接管 /api/collab/*，不会遮蔽任何既有路由。
      if(await layerMerge.handle(request,response,{pathname,method,url}))return;
      if(await localRegions.handle(request,response,{pathname,method,url}))return;
      if(await panelSlices.handle(request,response,{pathname,method,url}))return;
      if(await productionPackages.handle(request,response,{pathname,method,url}))return;
      if(await bubbleStyleLibrary.handle(request,response,{pathname,method,url}))return;
      if(await promptRewrites.handle(request,response,{pathname,method,url}))return;
      if(await library.handle(request,response,{pathname,method,url}))return;
      if(pathname.startsWith('/api/formal-engineering-versions/')){
        const input=method==='GET'?Object.fromEntries(url.searchParams):await body(request),p=store.project(input.projectId),n=Number(input.episode),action=pathname.split('/').at(-1);
        const execute=async()=>{if(method==='GET'){
          if(action==='preview'){const original=await formalVersions.preview(p,n,input);response.writeHead(200,{'Content-Type':original.headers.get('content-type')||'application/octet-stream','Cache-Control':'no-store'});await formalPreviewPipeline(Readable.fromWeb(original.body),response);return;}
          const handler={status:formalVersions.status,diff:formalVersions.compareVersions,history:formalVersions.history,inventory:formalVersions.inventory,submission:formalVersions.query}[action];check(handler,'版本操作不存在',404);return json(response,200,await handler(p,n,input));
        }if(method==='POST'){const handler={publish:formalVersions.publish,compare:formalVersions.compare,'commit-merge':formalVersions.commitMerge,checkout:formalVersions.checkout,restore:formalVersions.restore}[action];check(handler,'版本操作不存在',404);return json(response,200,await handler(p,n,input));}check(false,'版本操作不存在',404);};
        try{return await (formalLibrary.withSession?formalLibrary.withSession(execute):execute());}catch(error){if(response.headersSent)throw error;return json(response,error.status||500,{error:error.message,code:error.code||'FORMAL_VERSION_ERROR'});}
      }
      if(pathname==='/api/episode-versions'&&method==='GET'){const p=store.project(url.searchParams.get('projectId'));return json(response,200,episodeVersions.status(p,Number(url.searchParams.get('episode'))));}
      if(pathname==='/api/episode-versions/checkpoint'&&method==='POST'){const input=await body(request),p=store.project(input.projectId);return json(response,200,episodeVersions.checkpoint(p,Number(input.episode),input.expectedRevision,input.note));}
      if(await library.withSession(()=>projectSync.handle(request,response,{pathname,method,url})))return;
      if(await integratedRepair.handle(request,response,{pathname,method,url}))return;
      if(pathname==='/api/project-center/service/stop'&&method==='POST'&&process.env.PRODUCTION_INTEGRATION_ROOT){const input=await body(request);check(input.expectedCodeRoot===root,'服务身份不符',409);check(!episodeBatches.active().length&&!promptRewrites.running()&&!layerMerge.running()&&!integratedRepair.running()&&!running.size&&!handleAssetCenter.running()&&!comicSfxDesigner.running()&&!store.db.jobs.some(j=>['queued','running'].includes(j.status)),'服务仍有任务，未退出',409);json(response,200,{ok:true});setTimeout(shutdownStudio,50);return;}
      if(pathname.startsWith('/api/collab/')){if(process.env.COMIC_TEAM_HELP!=='1')return json(response,410,{error:'团队帮忙生图功能已移除；请使用本机生图'});if(await collabJobs.handle(request,response,{pathname,method,url}))return;if(await collabClient.handle(request,response,{pathname,method,url}))return;return json(response,404,{error:'协作接口不存在',code:'collab_route_not_found'});}
      
      
      if(await stripExports.handle(request,response,pathname,method))return;
      if(await generationSlots.handle(request,response,url))return;
      
      
      
      if(await assetWorkspace(request,response,{pathname,method,url}))return;
      if(await handleAssetCenter(request,response,{pathname,method,url}))return;
      if(await projectCenter?.handle(request,response,{pathname,method,url}))return;
      
      if(await handleAssetProduction(request,response,{pathname,method}))return;
      if(await handleBreakout(request,response,{pathname,method}))return;
      if(await handleComicStyleLibrary(request,response,url,store,json,body))return;
      if(method==='POST'&&pathname==='/api/comic-style-library/design'){const input=await body(request);check(input&&typeof input==='object'&&!Array.isArray(input),'字效设计参数无效');return json(response,202,comicSfxDesigner.start(input));}
      const comicDesign=pathname.match(/^\/api\/comic-style-library\/design\/([a-z]+_[0-9a-f-]{36})$/);
      if(comicDesign&&method==='GET')return json(response,200,comicSfxDesigner.get(comicDesign[1]));
      if(comicDesign&&method==='DELETE')return json(response,200,comicSfxDesigner.cancel(comicDesign[1]));
      
      
      if(await teamRelease.handle(request,response,url))return;
      if(await teamMembers.handle(request,response,url))return;
      if(await teamProduction.handle(request,response,url))return;
      if(method==='GET'&&pathname==='/api/team-release/status'){
        const address=process.env.COMIC_TEAM_CONTROL_URL;if(!address)return json(response,200,{managed:false});const control=new URL(address);if(control.hostname!=='127.0.0.1'||control.protocol!=='http:')return json(response,503,{error:'本机版本管理地址无效'});
        try{const upstream=await fetch(control.origin+'/api/status',{signal:AbortSignal.timeout(2000)});if(!upstream.ok)throw Error('版本管理未就绪');const state=await upstream.json();return json(response,200,{managed:true,role:state.role,controlUrl:control.origin,current:state.current,latest:state.latest,available:state.available,busy:state.busy});}catch{return json(response,503,{error:'版本管理正在启动或重启'});}
      }
      if(method==='GET'&&pathname==='/api/runtime-memory'){response.setHeader('Cache-Control','no-store');return json(response,200,{sampledAt:Date.now(),scope:'editor-service',rssBytes:process.memoryUsage.rss()});}
      if(method==='GET'&&pathname==='/api/health')return json(response,200,{application:'comic-merged-studio',version:'0.7.0-integrated-repair',mokuCompatibilityBuild:'Moku-only-20261027-r1',workspaceUpdateBuild:'20261028-compact-json-lettering-r2',assetRequirementIdentityVersion:2,typedAssetCandidateVersion:1,teamAssetCorrections:false,taskRailNavigationVersion:1,doubleDialogueVersion:1,promptRewriteVersion:2,wholeImageEditVersion:1,referencePreparationVersion:2,promptRewrite:{running:promptRewrites.running()},integrationVersion:'10.24-unified-layout-3',autoLayout:true,codeRoot:root,dataRoot:path.resolve(dataDir),teamControlUrl:process.env.COMIC_TEAM_CONTROL_URL||null,generation:{...generationSlots.snapshot(),queued:store.db.jobs.filter(j=>j.status==='queued').length,remoteUnknown:generationSlots.listRemote().length,pausedUntil:Date.now()<rateLimit.until?rateLimit.until:null,rateLimitStrikes:rateLimit.strikes,maxBatchPanels:MAX_BATCH_PANELS,sharedGateUntil:readGate(generationGateFile).until||null,activeEpisodeBatches:episodeBatches.active().length},styleDesign:{running:comicSfxDesigner.running()},workflow:'storyboard-import',productionPackageVersion:2,productionLayoutDesignVersion:1,productionPackageBoardLimit:1000,productionReferenceBindings:true,mokuReferencesOnly:true,defaultGeneratedImageZoom:95,referenceContentVerification:true,generationAutoFillVersion:2,panelSlicesVersion:1,panelSlicesInteractionVersion:2,referenceGenerationReturnVersion:1,referencePickerSplitVersion:1,sceneReferencePickerVersion:1,assetInlineWorkspaceVersion:1,textAssetReferencesVersion:1,assetProvenanceVersion:1,bubbleTextFrameVersion:1,episodeAssetOverviewVersion:1,unifiedArtStyleVersion:1,imageCornerResizeVersion:1,frameCornerDragVersion:2,localRegionToolsVersion:1,layerMergeVersion:2,productionDuplicateArchiveVersion:1,inlineEpisodeBoardsVersion:1,episodeBoardLocalImages:true,nativeReferencePackingVersion:1,nativeReferenceLimit:5,backgroundFrameDragVersion:1,productionScreenBoardsVersion:1,productionSliceGenerationVersion:1,productionPanelGenerationVersion:1,productionPanelBatchVersion:1,generationReferenceOrderVersion:2,generationFrameRatioVersion:1,fixedTextFontVersion:1,projectFileSavePickerVersion:1,sceneTextResultReturnVersion:1,failedJobDeletionVersion:1,episodeGenerationBatchVersion:1,canvasPanelGenerateShortcutVersion:1,roundBubbleDefaultVersion:1,productionLetteringStylesVersion:1,projectSnapshotCompression:true,portableProjectVersion:3,contentInputs:['production-package','storyboard-table'],imageStorage:'path',fixedEpisodeBoards:true,continuousCanvasCoverTailVisible:true,assetDirectoryImport:false,storyboardBatchImport:true,collaboration:process.env.COMIC_TEAM_HELP==='1',projectCenter:true,remoteLibrary:true,projectSync:true,integratedRepair:true,localImageTools:localTools.status(),mode:'whole-strip',assetCenter:{running:handleAssetCenter.running(),...handleAssetCenter.status()}});
      if(method==='GET'&&pathname==='/api/state')return json(response,200,stateSnapshot(url.searchParams,{login:codexLogin.snapshot({links:false}),scheduler:scheduler(),...(store.lastSaveError?{storageWarning:'工程数据暂时无法写盘（'+store.lastSaveError+'），工作台会自动重试；请检查磁盘空间或是否有程序占用数据文件。'}:{})}));
      if(method==='GET'&&pathname==='/api/generation-settings')return json(response,200,generationSettings.snapshot());
      if(method==='GET'&&pathname==='/api/platform-generation-settings')return json(response,200,generationSettings.platformSnapshot());
      if(method==='PUT'&&pathname==='/api/platform-generation-settings'){
        const settings=generationSettings.updatePlatforms(await body(request));
        concurrency=settings.main;generationSlots.setPlatforms(settings);generationSlots.setProviderLimits(generationSettings.limits);bridge.ensurePoolSize?.(generationSettings.limits.codex);pump();
        return json(response,200,settings);
      }
      if(method==='PUT'&&pathname==='/api/generation-settings'){
        const input=await body(request),settings=generationSettings.update(input.provider,input.concurrency);
        generationSlots.setProviderLimits(settings.limits);bridge.ensurePoolSize?.(settings.limits.codex);pump();
        return json(response,200,settings);
      }
      if(method==='GET'&&pathname==='/api/codex/status')return json(response,200,{...await bridge.status({force:url.searchParams.get('force')==='1',checkSession:url.searchParams.get('force')==='1'}),login:codexLogin.snapshot()});
      if(method==='GET'&&pathname==='/api/codex/login')return json(response,200,codexLogin.snapshot());
      if(method==='POST'&&pathname==='/api/codex/login'){
        const input=await body(request);return json(response,202,codexLogin.start(input.method||'browser'));
      }
      if(method==='POST'&&pathname==='/api/codex/login/cancel')return json(response,200,codexLogin.cancel((await body(request)).attemptId));
      if(method==='GET'&&pathname==='/api/jimeng/status')return json(response,200,await jimengBridge.status());
      if(method==='GET'&&pathname==='/api/jimeng/models')return json(response,200,await jimengBridge.models());
      if(method==='POST'&&pathname==='/api/jimeng/login')return json(response,202,await jimengBridge.startLogin());
      if(method==='GET'&&pathname==='/api/jimeng/login')return json(response,200,{...await jimengBridge.status(),login:jimengBridge.publicLogin()});
      
      
      
      
      
      
      
      
      
      
      
      
      if(method==='POST'&&pathname==='/api/projects/storyboard-import'){
const input=await body(request,16*1024*1024);check(!input.layoutFiles?.length,'请直接导入分镜表');const old=input.projectId?store.project(input.projectId):null,revision=old?.revision,before=old?documentHash(boardSharing.view(old)):null;const idle=()=>{if(old){check(store.project(old.id).revision===input.expectedRevision,'工程已有新修改，请重新导入',409);check(!store.db.jobs.some(job=>job.projectId===old.id&&['queued','running','awaiting_confirmation','recoverable','delegated'].includes(job.status)),'当前工程有任务正在进行，请完成后再导入',409);}};idle();check(!old?.productionPackage,'单表不能覆盖屏段工程，请导入完整制作资料包',409);const incoming=await readStoryboardData(input),project=old?mergeStoryboardImport(boardSharing.view(old),incoming):incoming;idle();if(old)check(old.revision===revision&&documentHash(boardSharing.view(store.project(old.id)))===before,'导入期间工程已有新修改，未覆盖',409);ensureProjectPanelGeneration(project,store.db.assets);normalizeLayerOrder(project);validateProject(project);if(input.dataBase64)project.sourceOriginalFiles=preserveOriginalUploads({dataDir,projectId:project.id,records:project.sourceOriginalFiles||[],files:[decodeOriginalUpload({name:input.name,base64:input.dataBase64},'storyboard')]});if(old){boardSharing.accept(old,project);store.db.projects[store.db.projects.indexOf(old)]=project;}else store.db.projects.push(project);return json(response,old?200:201,saveProject(project,{editor:!!old}));
}
      
      if(method==='POST'&&pathname==='/api/projects'){
        const input=await body(request),project=createProject(String(input.title||'未命名漫画').slice(0,180));boardSharing.inherit(project);ensureProjectPanelGeneration(project,store.db.assets);store.db.projects.push(project);store.save();projectSync?.mark(project);return json(response,201,project);
      }
      if(method==='POST'&&pathname==='/api/internal/asset-workspace'){
        const input=await body(request);check(input.purpose==='asset-generation','内部工作区用途无效');let p=store.db.projects.find(p=>p.internalAssetWorkspace===true&&!p.deletedAt);if(!p){p=createProject('资产生成 · 内部工作区');p.internalAssetWorkspace=true;store.db.projects.push(p);store.save();}return json(response,200,{id:p.id,title:p.title});
      }
      const migrateMatch=pathname.match(/^\/api\/projects\/([a-z]+_[0-9a-f-]{36})\/migrate-layers$/);
      if(migrateMatch&&method==='POST'){const input=await body(request),old=store.project(migrateMatch[1]);check(input.expectedRevision===old.revision,'工程已有新修改，请重新载入后升级画板。',409);check(!store.db.jobs.some(j=>j.projectId===old.id&&['running','queued'].includes(j.status)),'生成结束后再升级画板，已有任务不会被重建。',409);const result=migrateLayerDocument(old);if(result.changed){validateProject(result.project);const directory=path.join(dataDir,'backups');fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(path.join(directory,old.id+'_before_layers_'+old.revision+'.json'),JSON.stringify(old,null,2));result.project.revision=old.revision+1;result.project.updated=new Date().toISOString();store.db.projects[store.db.projects.indexOf(old)]=result.project;store.save();}return json(response,200,boardSharing.view(result.project));}
      const projectMatch=pathname.match(/^\/api\/projects\/([a-z]+_[0-9a-f-]{36})$/);
      const novelMatch=pathname.match(/^\/api\/projects\/(project_[a-f0-9-]{36})\/(novel-evidence|novel-sources|novel-source)$/);
      if(novelMatch){const p=store.project(novelMatch[1]);if(method==='GET'&&novelMatch[2]==='novel-source'){const number=Number(new URL(request.url,'http://localhost').searchParams.get('chapter'));check(Number.isInteger(number)&&number>0,'章节编号无效');const source=readNovelChapter(dataDir,p,number);response.writeHead(200,{'Content-Type':'text/plain; charset=utf-8','Content-Length':source.bytes.length,'X-Content-Type-Options':'nosniff'});return response.end(source.bytes);}if(method==='GET'&&novelMatch[2]==='novel-evidence'){const url=new URL(request.url,'http://localhost'),name=String(url.searchParams.get('name')||'').slice(0,100),state=String(url.searchParams.get('state')||'').slice(0,1000),chapters=String(url.searchParams.get('chapters')||'').split(',').map(Number).filter(n=>Number.isInteger(n)&&n>0).slice(0,12);return json(response,200,novelEvidence(dataDir,p,{name,state,chapters}));}if(method==='POST'&&novelMatch[2]==='novel-sources'){const input=await body(request,20*1024*1024);check(input.expectedRevision===p.revision,'工程已改变，请重新打开资产后补充原文',409);return json(response,200,saveNovelSources(dataDir,p,input.files));}}
      if(projectMatch&&method==='GET')return json(response,200,boardSharing.view(store.project(projectMatch[1])));
      if(projectMatch&&method==='DELETE'){
        const input=await body(request),project=store.project(projectMatch[1]);
        check(Number.isInteger(input.expectedRevision)&&input.expectedRevision===project.revision,'项目已在其他窗口修改，请刷新项目管理后再删除。',409);
        check(!store.db.jobs.some(j=>j.projectId===project.id&&['queued','running','delegated'].includes(j.status)),'这个项目还有生成任务正在处理，请先完成或取消任务再删除。',409);
        check(!store.db.jobs.some(j=>j.projectId===project.id&&j.provider==='jimeng'&&(j.status==='recoverable'||(j.status!=='done'&&jimengUncertain(j)))),'这个项目还有即梦云端任务结果未确认，请先查询原任务完成后再删除',409);
        project.deletedAt=new Date().toISOString();project.revision++;store.save();
        return json(response,200,{id:project.id,title:project.title,deletedAt:project.deletedAt});
      }
      const restoreProjectMatch=pathname.match(/^\/api\/projects\/([a-z]+_[0-9a-f-]{36})\/restore$/);
      if(restoreProjectMatch&&method==='POST'){
        check(!store.pendingPurges.has(restoreProjectMatch[1]),'此项目已开始彻底删除，只能重试清理，不能恢复',409);
        const project=store.db.projects.find(p=>p.id===restoreProjectMatch[1]&&p.deletedAt);
        check(project,'已删除项目不存在',404);delete project.deletedAt;project.revision++;project.updated=new Date().toISOString();store.save();
        return json(response,200,boardSharing.view(project));
      }
      const purgeMatch=pathname.match(/^\/api\/projects\/(project_[0-9a-f-]{36})\/purge$/);
      if(purgeMatch&&['GET','POST'].includes(method)){
        const id=purgeMatch[1],input=method==='POST'?await body(request):null,idle=()=>{
          check(!store.db.jobs.some(j=>j.projectId===id&&['queued','preparing','running','recoverable','awaiting_confirmation','delegated'].includes(j.status)),'这个项目还有未结束或待确认的任务，请处理后再彻底删除',409);
          check(!store.db.jobs.some(j=>j.projectId===id&&j.provider==='jimeng'&&j.status!=='done'&&jimengUncertain(j)),'云端任务结果未确认，请先查询原任务',409);
          check(!integratedRepair.running()&&!projectSync.running()&&!projectCenter.running(),'修图或工程同步正在处理，请完成后再彻底删除',409);
        };idle();const stamp=()=>JSON.stringify([store.db.projects.map(p=>[p.id,p.revision,p.updated,store.projectStamp(p.id)]),store.db.assets.map(a=>[a.id,a.filePath])]),before=stamp(),plan=await planProjectPurge(store,id);idle();check(stamp()===before,'统计期间工程或图片发生变化，请重新确认',409);
        if(method==='GET')return json(response,200,purgeSummary(plan));
        check(input.expectedRevision===plan.revision&&input.confirmation===plan.title&&input.planToken===plan.token,'项目或清理范围已改变，请重新打开彻底删除确认窗口',409);
        idle();const latest=store.db.projects.find(p=>p.id===id);check(store.pendingPurges.has(id)||latest?.deletedAt&&latest.revision===plan.revision,'项目状态已改变，未执行彻底删除',409);
        const result=executeProjectPurge(store,plan);projectSync.forget(id);projectCenter.forget(id);return json(response,200,{ok:true,permanent:true,...result});
      }
      if(projectMatch&&method==='PUT'){
        const input=await body(request,EDITOR_SAVE_COMPATIBILITY_LIMIT),old=store.project(projectMatch[1]);check(input.id===old.id,'工程编号不一致');check(old.layerSchema!==1||input.layerSchema===1,'工程已升级为联通图层，请刷新页面后继续编辑。',409);check(old.editorLayoutVersion!==2||input.editorLayoutVersion===2,'工程已升级为渐变区域和镜头组，请保存旧窗口副本后刷新页面。',409);check(input.revision===old.revision,'工程已在其他窗口修改，请先保存本地工程副本再重新载入。',409);for(const key of [...EDITOR_SERVER_FIELDS,'formalVersionBindings']){if(old[key]!==undefined)input[key]=clone(old[key]);else delete input[key];}
        
        
        
        
        check(Array.isArray(input.pages)&&input.pages.every(page=>Array.isArray(page.bubbles))&&(input.archivedBubbles===undefined||Array.isArray(input.archivedBubbles)),'长图或归档格式无效');archiveRemovedDialogue(input,old);
        
        
        
        
        
        
        
        const priorNative=new Map(old.pages.flatMap(page=>page.panels.map(panel=>[panel.id,panel])));for(const page of input.pages)for(const panel of page.panels){if(panel.nativeSizing){const prior=priorNative.get(panel.id);panel.nativeSizing=JSON.stringify(prior?.nativeSizing)===JSON.stringify(panel.nativeSizing)?clone(prior.nativeSizing):sanitizeTrustedNativeSizing(panel.nativeSizing,{assets:store.db.assets,panelWidth:panel.w});}}
        ensureProjectPanelGeneration(input,store.db.assets);normalizeLayerOrder(input);validateProject(input);checkAssets(input);
        const mergeRestores=new Set([...layerMerge.restorableImages(old,input),...integratedRepair.restorableImages(old,input),...panelImageImports.restorableImages(old,input)]),oldPanels=new Map(old.pages.flatMap(page=>page.panels.map(panel=>[panel.id,panel])));
        for(const page of input.pages)for(const panel of page.panels){const current=oldPanels.get(panel.id);if(current){if(!mergeRestores.has(panel.id)){if(current.imageEffects)panel.imageEffects=clone(current.imageEffects);else delete panel.imageEffects;}if(current.breakoutCandidates)panel.breakoutCandidates=clone(current.breakoutCandidates);else delete panel.breakoutCandidates;if(current.breakoutForeground)panel.breakoutForeground=clone(current.breakoutForeground);else delete panel.breakoutForeground;if(current.generation&&panel.generation===undefined){panel.generation=clone(current.generation);panel.referenceIds=clone(current.referenceIds);}if(!mergeRestores.has(panel.id)){if(panel.imageAssetId!==current.imageAssetId){panel.imageTransform=current.imageTransform;if(current.cutoutLayer?.kind==='upscale')panel.cutoutLayer=clone(current.cutoutLayer);}panel.imageAssetId=current.imageAssetId;panel.candidates=current.candidates;}panel.generationToken=current.generationToken;}}
        rotateProjectHistory(input);boardSharing.accept(old,input);delete input.deletedAt;input.created=old.created;input.revision=old.revision+1;input.updated=new Date().toISOString();store.db.projects[store.db.projects.indexOf(old)]=input;store.save();projectSync?.mark(input);return json(response,200,input);
      }
      if(method==='GET'&&pathname==='/api/assets')return json(response,200,store.db.assets);
      if(method==='POST'&&pathname==='/api/episode-board-images'){
        const input=await body(request,84*1024*1024);store.project(input.projectId);
        check(typeof input.dataBase64==='string'&&input.dataBase64.length<=84*1024*1024&&/^[A-Za-z0-9+/=]+$/.test(input.dataBase64),'图片内容无效');
        const bytes=Buffer.from(input.dataBase64,'base64');check(bytes.length>0&&bytes.length<=60*1024*1024,'图片为空或超过60MB',413);const info=imageInfo(bytes);
        const dir=path.join(dataDir,'board-images');fs.mkdirSync(dir,{recursive:true});const file=path.join(dir,uid('image')+info.extension);let asset;
        try{fs.writeFileSync(file,bytes,{flag:'wx'});asset=addAsset(file,path.basename(String(input.name||'粘贴图片')).slice(0,180),'episode-board-upload');}catch(error){if(fs.existsSync(file))fs.unlinkSync(file);throw error;}
        store.save();return json(response,201,{asset});
      }
      if(method==='POST'&&['/api/manual-panel-image','/api/panel-images/import'].includes(pathname)){
        const input=await body(request,84*1024*1024),project=store.project(input.projectId),owner=project.pages.find(p=>p.panels.some(f=>f.id===input.panelId)),frame=owner?.panels.find(f=>f.id===input.panelId);
        check(frame&&!frame.cutoutLayer&&!frame.breakoutForeground,'请选择要放入图片的画格');check(!owner.locked&&!frame.locked,'请先解锁画格');check(input.expectedRevision===project.revision,'工程已有修改，请重新上传',409);
        check(!store.db.jobs.some(j=>j.projectId===project.id&&j.panelId===frame.id&&['queued','preparing','running','awaiting_confirmation','recoverable','delegated'].includes(j.status)),'当前格子还有生成任务，请结束后再导入图片',409);
        check(typeof input.dataBase64==='string'&&input.dataBase64.length<=84*1024*1024&&/^[A-Za-z0-9+/=]+$/.test(input.dataBase64),'图片内容无效');const bytes=Buffer.from(input.dataBase64,'base64');check(bytes.length>0&&bytes.length<=60*1024*1024,'图片为空或超过60MB',413);
        const info=imageInfo(bytes),ext=info.extension;check(['.png','.jpg','.jpeg','.webp'].includes(ext),'请选择PNG、JPEG或WebP图片');const dir=path.join(dataDir,'manual-images');fs.mkdirSync(dir,{recursive:true});const file=path.join(dir,uid('image')+ext);let asset;
        try{fs.writeFileSync(file,bytes,{flag:'wx'});asset=addAsset(file,path.basename(String(input.name||'粘贴图片'+ext)).slice(0,180),'manual-upload');}catch(error){if(fs.existsSync(file))fs.unlinkSync(file);throw error;}
        panelImageImports.record(project,frame,asset);frame.candidates=[...new Set([...(frame.candidates||[]),frame.imageAssetId,asset.id].filter(Boolean))].slice(-40);frame.imageAssetId=asset.id;frame.imageTransform=fitImage(frame,asset,.95);delete frame.imageEffects;
        return json(response,201,{asset,project:saveProject(project,{editor:true})});
      }
      if(method==='POST'&&pathname==='/api/assets'){
        const input=await body(request);check(!input.dataUrl,'当前只登记本地图片路径，请选择本地图片或粘贴完整路径');const result=await registerImagePaths(store,[input.filePath]);check(result.assets.length===1,result.failed[0]?.error||'图片路径无法读取');const asset=result.assets[0];if(result.created&&input.name){asset.name=String(input.name).slice(0,180);store.save();}return json(response,201,asset);
      }
      if(method==='POST'&&pathname==='/api/assets/pick'){const input=await body(request);return json(response,200,{paths:await selectImageFiles({multiple:input.multiple===true})});}
      if(method==='POST'&&pathname==='/api/assets/batch'){const input=await body(request);check(Array.isArray(input.filePaths)&&input.filePaths.length<=60,'图片路径数量无效');return json(response,200,await registerImagePaths(store,input.filePaths));}
      
      
      
      
      if(method==='POST'&&pathname==='/api/assets/resolve'){const input=await body(request);check(Array.isArray(input.assetIds),'资产编号无效');input.assetIds.forEach(cleanId);await handleAssetCenter.ensureAssets(input.assetIds);await projectCenter.ensureAssets(input.assetIds);return json(response,200,await resolveImageAssets(store,input.assetIds));}
      const thumbnailMatch=pathname.match(/^\/api\/assets\/([a-z]+_[0-9a-f-]{36})\/thumbnail$/);
      if(thumbnailMatch&&method==='GET'){await handleAssetCenter.ensureAssets([cleanId(thumbnailMatch[1])]);await projectCenter.ensureAssets([cleanId(thumbnailMatch[1])]);const file=await imageThumbnails(store.asset(cleanId(thumbnailMatch[1])));return await sendFile(response,file,{'Content-Type':'image/png','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'},{missingMessage:'缩略图暂时无法读取，请稍后重试'});}
      const assetPathMatch=pathname.match(/^\/api\/assets\/([a-z]+_[0-9a-f-]{36})\/path$/);
      if(assetPathMatch&&method==='PUT'){const input=await body(request),asset=store.asset(assetPathMatch[1]),oldPath=store.assetPath(asset.id),info=await inspectImageFileAsync(input.filePath);check(store.assetPath(asset.id)===oldPath,'图片路径已在其他窗口修改，请重新选择',409);check(!asset.width||(info.width===asset.width&&info.height===asset.height),'新路径图片的尺寸不同，请使用“填入图片”替换，避免改变现有取景');Object.assign(asset,info,{inspection:'ready'});projectCenter.markAsset(asset);for(const p of store.db.projects)for(const page of p.pages)for(const f of page.panels)if(f.imageAssetId===asset.id)delete f.imageEffects;store.save();return json(response,200,asset);}
      const assetMatch=pathname.match(/^\/assets\/([a-z]+_[0-9a-f-]{36})$/);
      if(assetMatch&&method==='GET'){
        const asset=store.asset(assetMatch[1]);
        await handleAssetCenter.ensureAssets([asset.id]);await projectCenter.ensureAssets([asset.id]);
        if(!asset.width){const resolved=await resolveImageAssets(store,[asset.id]);check(!resolved.failed.length,resolved.failed[0]?.error||'图片无法读取',404);}
        const raw=store.assetPath(asset.id),file=isMountedImagePath(raw)?imagePathValue(raw):localImagePath(raw);
        let stat;try{stat=await mountedImageIO(file,()=>response.destroyed?null:fs.promises.lstat(file));if(!stat)return;check(stat.isFile()&&!stat.isSymbolicLink(),'图片路径不是普通文件');}catch(error){check(false,'无法读取图片，请检查文件或共享盘连接：'+file,404);}
        const etag='"'+asset.id+'-'+stat.size+'-'+stat.mtimeMs+'-'+stat.ctimeMs+'"',headers={'Content-Type':asset.mime,'Cache-Control':'private, no-cache','ETag':etag,'X-Content-Type-Options':'nosniff'};
        if(request.headers['if-none-match']===etag){response.writeHead(304,headers);response.end();return;}
        await mountedImageIO(file,()=>new Promise(resolve=>{if(response.destroyed){resolve();return;}response.writeHead(200,{...headers,'Content-Length':stat.size});const stream=fs.createReadStream(file);response.once('close',()=>{stream.destroy();resolve();});stream.once('error',()=>{response.destroy();resolve();});stream.once('end',resolve);stream.pipe(response);}));return;
      }
      const attachMatch=pathname.match(/^\/api\/projects\/([a-z]+_[0-9a-f-]{36})\/panels\/([a-z]+_[0-9a-f-]{36})\/image$/);
      if(attachMatch&&method==='POST'){
        const input=await body(request);let project=store.project(attachMatch[1]),{panel}=findPanel(project,attachMatch[2]);const revision=project.revision;
        if(input.expectedRevision!==undefined)check(input.expectedRevision===revision,'工程已更新，请保存后重新选择图片',409);
        if(input.action==='remove-candidate'||input.replaceCandidateId){
          check(input.expectedRevision===revision,'工程已更新，请重新选择图片',409);check(!panel.locked,'画格已锁定，请解锁后再操作',409);
          check(!store.db.jobs.some(job=>job.projectId===project.id&&job.panelId===panel.id&&['queued','preparing','running','recoverable','awaiting_confirmation','delegated'].includes(job.status)),'画格正在生成，请完成后再操作图片',409);
          const previous=cleanId(input.replaceCandidateId||input.assetId);check(panel.candidates.includes(previous)||panel.imageAssetId===previous,'这张图片已不在当前画格中',409);
          if(input.action==='remove-candidate'){panel.candidates=panel.candidates.filter(id=>id!==previous);if(panel.imageAssetId===previous){panel.imageAssetId=null;panel.imageTransform=null;delete panel.imageEffects;}panel.generationToken=null;return json(response,200,saveProject(project,{editor:true}));}
        }
        if(input.assetId){const asset=store.asset(cleanId(input.assetId));if(!asset.width){const ready=await resolveImageAssets(store,[asset.id]);check(!ready.failed.length,ready.failed[0]?.error||'图片无法读取');project=store.project(attachMatch[1]);check(project.revision===revision,'读取图片期间画格已修改，请重新填入图片',409);({panel}=findPanel(project,attachMatch[2]));}const nativeComposition=asset.nativeComposition?assessFrameComposition({action:'generate',panel},asset):null;check(!nativeComposition?.requiresAcceptance,nativeComposition?.notice||'原图不符合当前画格，未放大或拉伸',409);if(panel.imageAssetId!==asset.id){panel.imageAssetId=asset.id;panel.imageTransform=nativeComposition?fitGeneratedArtwork(panel,asset):fitImage(panel,asset,panel.layoutIntent?1:1.08);}if(!panel.candidates.includes(asset.id))panel.candidates=[...panel.candidates,asset.id].slice(-40);}else{panel.imageAssetId=null;panel.imageTransform=null;}
        if(input.assetId&&panel.productionSegment&&productionSegmentUnit(project,project.shots.find(s=>s.id===panel.shotId)?.episode,panel.productionSegment)==='screen')ensureProductionScreenLettering(project,panel.productionSegment);
        if(input.replaceCandidateId&&input.replaceCandidateId!==input.assetId)panel.candidates=panel.candidates.filter(id=>id!==input.replaceCandidateId);
        panel.generationToken=null;if(input.assetId){const adopted=store.db.jobs.filter(job=>job.projectId===project.id&&job.panelId===panel.id&&job.status==='done'&&job.assetId===input.assetId).at(-1);if(adopted){if(adopted.autoApplyBlocked?.length)adopted.previousAutoApplyBlocked=clone(adopted.autoApplyBlocked);adopted.autoApplyBlocked=[];adopted.applied=true;adopted.adoptedAt=new Date().toISOString();adopted.message='已采用生成结果并贴入格子';}}const saved=saveProject(project,{editor:true});void pump();return json(response,200,saved);
      }
      if(method==='POST'&&pathname==='/api/jobs')return json(response,202,await submitGenerationJobs(await body(request,43*1024*1024)));
      if(method==='POST'&&pathname==='/api/episode-generation-batches'){
        const input=await body(request),project=store.project(cleanId(input.projectId)),page=project.pages.find(p=>p.id===input.pageId);
        check(page,'当前画板不存在',404);check(project.autoLayoutSource?.mode!=='screen-crop-reflow','成图重排工程不提交重新生图',409);
        const episode=currentBoardEpisode(project,page);check(input.episode===episode,'当前话已改变，请重新提交',409);
        const existing=episodeBatches.active().find(p=>p.projectId===project.id&&p.episode===episode);
        if(existing)return json(response,200,episodeBatches.snapshot().find(p=>p.id===existing.id));
        check(input.expectedRevision===project.revision,'工程已改变，请保存后重新提交',409);
        check(['codex','jimeng'].includes(input.provider),'生图来源无效');
        const available=new Set(episodeGenerationPanelIds(project,page,store.db.jobs.filter(j=>j.projectId===project.id)));
        check(Array.isArray(input.panelIds)&&input.panelIds.length>0&&input.panelIds.length<=10000&&new Set(input.panelIds).size===input.panelIds.length,'本话缺图列表无效');
        check(input.panelIds.every(id=>available.has(id)),'缺图列表已改变，请刷新后重新提交',409);
        const plan=episodeBatches.start({projectId:project.id,pageId:page.id,episode,panelIds:input.panelIds,request:{provider:input.provider,model:input.model,mode:input.mode,ratio:input.ratio,resolution:input.resolution,referenceIdsByPanel:input.referenceIdsByPanel}});
        void episodeBatches.tick();return json(response,202,episodeBatches.snapshot().find(p=>p.id===plan.id));
      }
      const stopEpisodeBatch=pathname.match(/^\/api\/episode-generation-batches\/(episode_batch_[0-9a-f-]{36})\/stop$/);
      if(method==='POST'&&stopEpisodeBatch){const plan=episodeBatches.stop(stopEpisodeBatch[1]);check(plan,'自动提交记录不存在',404);return json(response,200,episodeBatches.snapshot().find(p=>p.id===plan.id));}
      const deleteJobMatch=pathname.match(/^\/api\/jobs\/(job_[0-9a-f-]{36})$/);
      if(deleteJobMatch&&method==='DELETE'){
        const job=store.db.jobs.find(j=>j.id===deleteJobMatch[1]);check(job,'任务记录不存在',404);
        store.project(job.projectId);check(job.status==='failed'&&!running.has(job.id),'只能删除已结束的失败任务记录',409);
        // Keep task provenance and files: assets and production records may still refer to this task.
        if(!job.dismissedAt){job.dismissedAt=new Date().toISOString();store.save();}
        return json(response,200,{id:job.id,deleted:true});
      }
      const approveMatch=pathname.match(/^\/api\/jobs\/([a-z]+_[0-9a-f-]{36})\/approve$/);
      if(approveMatch&&method==='POST'){
        const input=await body(request),job=store.db.jobs.find(j=>j.id===approveMatch[1]);check(job?.provider==='jimeng','即梦任务不存在',404);store.project(job.projectId);check(job.status==='awaiting_confirmation','任务当前不等待积分批准',409);
        check(input.approved===true&&Number.isInteger(input.creditCeiling)&&input.creditCeiling>=0,'请明确批准有效的积分消费上限');check(job.quote&&Number.isFinite(job.quote.totalMaxCredits)&&job.quote.totalMaxCredits>=0,'任务缺少完整最新报价，请查询原任务恢复',409);check(job.quote.confirmable!==false&&input.creditCeiling>=job.quote.totalMaxCredits,'批准上限需覆盖完整最新报价',409);
        resetJobAttempt(job);job.approvalCeiling=input.creditCeiling;job.recoveryOnly=false;job.preparationOnly=false;updateJob(job,{status:'queued',phase:'queued',requiredAction:null,errorCode:null,message:'已批准积分消费上限，等待即梦检查最新报价'});pump();return json(response,202,publicJob(job));
      }
      const resumeMatch=pathname.match(/^\/api\/jobs\/([a-z]+_[0-9a-f-]{36})\/resume$/);
      if(resumeMatch&&method==='POST'){
        const job=store.db.jobs.find(j=>j.id===resumeMatch[1]);check(job?.provider==='jimeng','即梦任务不存在',404);check(['recoverable','failed','cancelled'].includes(job.status)&&job.recovery?.submitId,'任务没有可恢复的即梦提交记录',409);
        store.project(job.projectId);const plan=jimengBridge.resumeState(path.join(dataDir,'jobs',job.id));resetJobAttempt(job,{keepGenerationStartedAt:plan.submissionAttempted});job.recoveryOnly=plan.submissionAttempted;job.preparationOnly=!plan.submissionAttempted;delete job.approvalCeiling;updateJob(job,{status:'queued',phase:'queued',recovery:plan.recovery,message:plan.submissionAttempted?'查询同一次即梦任务，不重新提交生成':'回读原节点恢复保存与报价，等待重新批准积分'});pump();return json(response,202,publicJob(job));
      }
      const cancelMatch=pathname.match(/^\/api\/jobs\/([a-z]+_[0-9a-f-]{36})\/cancel$/);
      if(method==='POST'&&pathname==='/api/jobs/cancel-all'){
        const input=await body(request),projectId=cleanId(input.projectId);store.project(projectId);
        check(input.jobIds===undefined||Array.isArray(input.jobIds)&&input.jobIds.length<=10000,'批量取消任务列表无效');
        const ids=input.jobIds?new Set(input.jobIds.map(cleanId)):null;
        if(ids)for(const id of ids){const job=store.db.jobs.find(j=>j.id===id);check(!job||job.projectId===projectId,'取消列表包含其他漫画的任务');}
        if(!ids||input.stopEpisodeBatches===true)episodeBatches.stopProject(projectId);
        const targets=store.db.jobs.filter(job=>job.projectId===projectId&&(!ids||ids.has(job.id))&&['queued','running','awaiting_confirmation','recoverable','delegated'].includes(job.status)),cloudPending=targets.filter(jimengUncertain).map(job=>job.id),now=new Date().toISOString();
        // Mark the entire snapshot before aborting or pumping, so queued targets never start.
        for(const job of targets)Object.assign(job,{status:'cancelled',phase:'cancelled',completedAt:now,updated:now,message:cloudPending.includes(job.id)?'本地任务已取消，原图保留；已提交云端的原任务可在历史中查询':'任务已取消，原图保留'});
        if(targets.length)store.save();for(const job of targets){const operation=running.get(job.id);operation?.controller.abort();operation?.handle?.cancel?.();}
        pump();return json(response,200,{cancelled:targets.length,jobs:targets.map(publicJob),cloudPending});
      }
      if(method==='POST'&&pathname==='/api/projects/typography'){
        const input=await body(request),value=validateTypography(input),ids=input.projectIds;
        check(Array.isArray(ids)&&ids.length>0&&ids.length<=200&&new Set(ids).size===ids.length,'请选择需要统一字体的工程');
        const originals=ids.map(id=>store.project(cleanId(id)));
        for(const project of originals)check(input.expectedRevisions?.[project.id]===project.revision,'工程已在其他窗口修改，请刷新后再统一字体',409);
        const results=originals.map(original=>{const project=clone(original),counts=applyProjectTypography(project,value);validateProject(project);project.revision=original.revision+1;project.updated=new Date().toISOString();return {project,...counts};});
        // Validate the entire selection before changing any saved project.
        for(const result of results)store.db.projects[store.db.projects.findIndex(project=>project.id===result.project.id)]=result.project;
        store.save();return json(response,200,{projects:results.map(result=>result.project),changed:results.reduce((n,result)=>n+result.changed,0),locked:results.reduce((n,result)=>n+result.locked,0)});
      }
      if(cancelMatch&&method==='POST'){const job=store.db.jobs.find(j=>j.id===cancelMatch[1]);check(job,'任务不存在',404);check(['queued','running','awaiting_confirmation','recoverable','delegated'].includes(job.status),'任务已结束');updateJob(job,{status:'cancelled',phase:'cancelled',completedAt:new Date().toISOString(),message:job.remoteTaskId?'本机任务已取消；协作中控任务 '+job.remoteTaskId+' 可能仍在其他电脑运行，请在协作页核对或取消':'任务已取消，原图保留'});const operation=running.get(job.id);operation?.controller.abort();operation?.handle?.cancel?.();pump();return json(response,200,publicJob(job));}
      const repairedMatch=pathname.match(/^\/api\/jobs\/([a-z]+_[0-9a-f-]{36})\/repaired-page$/);
      if(repairedMatch&&method==='GET'){const job=store.db.jobs.find(j=>j.id===repairedMatch[1]);check(job?.repairedPage,'这个任务没有完成的修复页',404);const file=path.join(dataDir,'jobs',job.id,'out','repaired_page.png');return await sendFile(response,file,{'Content-Type':'image/png','Content-Disposition':'attachment; filename="repaired_page.png"','X-Content-Type-Options':'nosniff'},{missingMessage:'修复页文件已不存在，可能已被清理；请重新生成'});}
      const exportMatch=pathname.match(/^\/api\/projects\/([a-z]+_[0-9a-f-]{36})\/export$/);
      if(exportMatch&&['GET','POST'].includes(method)){
        if(url.searchParams.get('mode')!=='local'){
          const project=boardSharing.view(store.project(exportMatch[1]));
          const packed=await library.withSession(async()=>projectPortability.exportFile(project,{syncMedia:method==='POST',remoteProjectId:method==='POST'?await projectSync.exportTarget(project.id):projectSync.status(project.id).target?.projectId||'',manifests:{versionManifest:episodeVersions.manifest(project),formalVersionManifest:formalVersions.exportManifest(project)}}));
          return json(response,200,packed);
        }
        const project=boardSharing.view(store.project(exportMatch[1])),ids=new Set([...projectLibraryAssetIds(project),...project.references.map(r=>r.assetId),...boardAssetIds(project)]);for(const id of productionImageIds(project))ids.add(id);for(const shot of project.shots){shot.referenceIds.forEach(id=>ids.add(id));if(shot.nativeSizing?.observed?.assetId)ids.add(shot.nativeSizing.observed.assetId);}for(const bubble of [...project.pages.flatMap(page=>page.bubbles),...(project.archivedBubbles||[])]){if(bubble.styleTextureAssetId)ids.add(bubble.styleTextureAssetId);if(bubble.visualAssetId)ids.add(bubble.visualAssetId);}for(const page of project.pages)for(const panel of page.panels){for(const id of panel.referenceIds||[])ids.add(id);for(const ref of panel.generation?.referenceRoles||[])ids.add(ref.assetId);for(const c of panel.breakoutCandidates||[]){ids.add(c.assetId);if(c.backgroundAssetId)ids.add(c.backgroundAssetId);for(const id of c.referenceAssetIds||[])ids.add(id);}if(panel.cutoutLayer?.sourceAssetId)ids.add(panel.cutoutLayer.sourceAssetId);if(panel.breakoutForeground?.backgroundAssetId)ids.add(panel.breakoutForeground.backgroundAssetId);if(panel.nativeSizing?.observed?.assetId)ids.add(panel.nativeSizing.observed.assetId);if(panel.imageAssetId)ids.add(panel.imageAssetId);panel.candidates.forEach(id=>ids.add(id));panel.generationToken=null;}
        for(const id of productionAssetIds(project))ids.add(id);for(const id of Object.values(project.speakerAvatars||{}))ids.add(id);const assets=[...ids].filter(id=>store.db.assets.some(a=>a.id===id)||panelAssetRequired(project,id)).map(id=>({...store.asset(id),filePath:store.assetPath(id)}));return json(response,200,{format:'comic-strip-studio',version:2,imageStorage:'path',project,assets,versionManifest:episodeVersions.manifest(project),formalVersionManifest:formalVersions.exportManifest(project),...(project.productionPackage?{packageSources:productionPackages.exportSources(project)}:{})});
      }
      if(method==='POST'&&pathname==='/api/projects/import'){
        return await library.withSession(async()=>{
        const prepared=await projectPortability.prepareImport(await body(request,productionPackageLimits.projectImportBytes)),input=prepared.input;validateProject(input.project);validateOriginalRecords(input.project.sourceOriginalFiles);
        const decoded=[];for(const asset of input.assets){cleanId(asset.id);check(!asset.dataUrl&&typeof asset.filePath==='string','这是旧版内嵌图片工程；请在旧工作台载入后，用新版导出路径工程再导入');const cached=store.db.assets.find(a=>imagePathKey(store.assetPath(a.id))===imagePathKey(imagePathValue(asset.filePath)));decoded.push({original:asset,info:await inspectImageFileAsync(asset.filePath,{cached})});}
        const mapping=new Map();for(const item of decoded){check(!mapping.has(item.original.id),'工程中图片编号重复');mapping.set(item.original.id,null);}
        const needed=new Set([...projectLibraryAssetIds(input.project),...input.project.references.map(ref=>ref.assetId)]);for(const shot of input.project.shots){shot.referenceIds.forEach(id=>needed.add(id));if(shot.nativeSizing?.observed?.assetId)needed.add(shot.nativeSizing.observed.assetId);}for(const page of input.project.pages)for(const panel of page.panels){for(const id of panel.referenceIds||[])needed.add(id);if(panel.nativeSizing?.observed?.assetId)needed.add(panel.nativeSizing.observed.assetId);if(panel.imageAssetId)needed.add(panel.imageAssetId);panel.candidates.forEach(id=>needed.add(id));}for(const id of Object.values(input.project.speakerAvatars||{}))needed.add(id);for(const page of input.project.pages)for(const panel of page.panels)if(panel.cutoutLayer?.sourceAssetId)needed.add(panel.cutoutLayer.sourceAssetId);for(const id of productionAssetIds(input.project))needed.add(id);for(const id of needed)check(mapping.has(id),'工程缺少原始图片，不能完整恢复');
        for(const item of decoded){const same=store.db.assets.find(a=>imagePathKey(store.assetPath(a.id))===imagePathKey(item.info.filePath));check(!same?.width||(same.width===item.info.width&&same.height===item.info.height),'同一路径的图片尺寸已变化，请先修复图片路径');}
        for(const item of decoded){const asset=addAssetInfo(item.info,item.original.name,'import-project');for(const key of ['libraryName','libraryState','libraryAliases','libraryStateAliases','productionStatus','productionAssetId','productionStageId','referenceGeneration','comicKind'])if(item.original[key]!==undefined)asset[key]=clone(item.original[key]);if(!asset.libraryRole&&['character','scene','prop','style'].includes(item.original.libraryRole))asset.libraryRole=item.original.libraryRole;if(item.original.library)asset.library=clone(item.original.library);mapping.set(item.original.id,asset.id);}
        const restoreNative=(value,width)=>{if(!value)return value;const native=clone(value);delete native.resolved;if(native.observed)native.observed.assetId=mapping.get(native.observed.assetId);return sanitizeTrustedNativeSizing(native,{assets:store.db.assets,panelWidth:width});};
        const project=clone(input.project),shotMapping=new Map(),layerMapping=new Map(),pageMapping=new Map();delete project.deletedAt;const sourceFormalBindings=clone(project.formalVersionBindings||{});delete project.formalVersionBindings;project.versionImportSource={sourceProjectId:input.project.id,sourceFormalBindings,kind:'explicit-copy',importedAt:new Date().toISOString()};project.id=uid('project');if(project.assetLibrary){project.assetLibrary.assetIds=project.assetLibrary.assetIds.map(id=>mapping.get(id));project.assetLibrary.manualAssetIds=(project.assetLibrary.manualAssetIds||[]).map(id=>mapping.get(id));}remapBoardAssets(project,mapping);if(project.episodeBoards)project.episodeBoards.sharedKey=project.id;project.title=project.title.slice(0,170)+' · 导入';project.revision=0;project.created=new Date().toISOString();if(project.speakerAvatars)for(const name of Object.keys(project.speakerAvatars))project.speakerAvatars[name]=mapping.get(project.speakerAvatars[name]);project.references.forEach(r=>r.assetId=mapping.get(r.assetId));for(const settings of Object.values(project.assetWorkspaceSettings||{}))for(const key of ['identityAssetId','costumeAssetId','propAssetId'])if(settings[key])settings[key]=mapping.get(settings[key])||'';project.shots.forEach(s=>{const old=s.id;s.id=uid('shot');shotMapping.set(old,s.id);s.referenceIds=s.referenceIds.map(id=>mapping.get(id));});
        for(const episode of project.storyboardImport?.episodes||[])episode.shotIds=episode.shotIds.map(id=>shotMapping.get(id));
        for(const page of project.pages){const oldPageId=page.id;page.id=uid('page');pageMapping.set(oldPageId,page.id);for(const panel of page.panels){const oldId=panel.id;panel.id=uid('panel');layerMapping.set(oldId,panel.id);panel.shotId=shotMapping.get(panel.shotId)||'';if(panel.generation){panel.generation.referenceRoles=panel.generation.referenceRoles.filter(ref=>mapping.has(ref.assetId));for(const ref of panel.generation.referenceRoles)ref.assetId=mapping.get(ref.assetId);}if(panel.referenceIds)panel.referenceIds=panel.referenceIds.map(id=>mapping.get(id));if(panel.referenceTextBindings)for(const b of Object.values(panel.referenceTextBindings))b.imageIds=b.imageIds.map(id=>mapping.get(id)).filter(Boolean);if(panel.referenceNeedBindings)for(const b of Object.values(panel.referenceNeedBindings))b.assetId=mapping.get(b.assetId);panel.imageAssetId=panel.imageAssetId?mapping.get(panel.imageAssetId):null;panel.candidates=panel.candidates.map(id=>mapping.get(id));panel.generationToken=null;}for(const bubble of page.bubbles){const oldId=bubble.id;bubble.id=uid('bubble');layerMapping.set(oldId,bubble.id);bubble.shotId=shotMapping.get(bubble.shotId)||'';}}
        remapWorkspaceRemovals(project,mapping,layerMapping);
        for(const shot of project.shots)if(shot.nativeSizing)shot.nativeSizing=restoreNative(shot.nativeSizing,1280);for(const page of project.pages)for(const panel of page.panels)if(panel.nativeSizing)panel.nativeSizing=restoreNative(panel.nativeSizing,panel.w);
        
        for(const layer of [...project.pages.flatMap(page=>[...page.panels,...page.bubbles]),...(project.gradients||[])]){for(const key of ['designParentPanelId','parentPanelId'])if(layer[key])layer[key]=layerMapping.get(layer[key])||layer[key];}
        for(const page of project.pages)for(const b of page.bubbles)if(b.parentPanelId&&layerMapping.has(b.parentPanelId))b.parentPanelId=layerMapping.get(b.parentPanelId);
        for(const bubble of [...project.pages.flatMap(page=>page.bubbles),...(project.archivedBubbles||[])]){remapBubbleAssets(bubble,mapping);if(bubble.localReplacement)bubble.localReplacement.patchLayerId=layerMapping.get(bubble.localReplacement.patchLayerId)||bubble.localReplacement.patchLayerId;}for(const page of project.pages)for(const f of page.panels)if(f.localRegion)f.localRegion.sourcePanelId=layerMapping.get(f.localRegion.sourcePanelId)||f.localRegion.sourcePanelId;
        for(const bubble of project.archivedBubbles||[]){const oldId=bubble.id;bubble.id=uid('bubble');layerMapping.set(oldId,bubble.id);bubble.shotId=shotMapping.get(bubble.shotId)||'';delete bubble.parentPanelId;if(bubble.archivedFrom?.pageId)bubble.archivedFrom.pageId=pageMapping.get(bubble.archivedFrom.pageId)||bubble.archivedFrom.pageId;}
        for(const g of project.gradients||[]){const oldId=g.id;g.id=uid('gradient');layerMapping.set(oldId,g.id);if(g.stripSpace)g.stripSpace.pageId=pageMapping.get(g.stripSpace.pageId);}if(project.layerOrder)project.layerOrder=project.layerOrder.map(key=>layerMapping.get(key)||key);for(const entry of project.spacingEdits||[]){if(entry.layerId)entry.layerId=layerMapping.get(entry.layerId)||entry.layerId;}normalizeLayerOrder(project);
        for(const page of project.pages)for(const frame of page.panels)if(frame.layoutIntent){
          frame.layoutIntent.previousShotId=shotMapping.get(frame.layoutIntent.previousShotId)||null;
          frame.layoutIntent.nextShotId=shotMapping.get(frame.layoutIntent.nextShotId)||null;
          if(frame.layoutIntent.overlap)frame.layoutIntent.overlap.withShotId=shotMapping.get(frame.layoutIntent.overlap.withShotId)||frame.layoutIntent.overlap.withShotId;
        }
        
        
        const remapAssets=record=>{if(record?.managedIds)record.managedIds=record.managedIds.map(id=>mapping.get(id)).filter(Boolean);};
        for(const [key,binding] of Object.entries(project.assetBindings||{})){if(mapping.has(binding.assetId))binding.assetId=mapping.get(binding.assetId);else delete project.assetBindings[key];}
        for(const shot of project.shots)remapAssets(shot.assetAutoBinding);for(const page of project.pages)for(const frame of page.panels)remapAssets(frame.assetReferenceBinding);
        for(const page of project.pages)for(const frame of page.panels){if(frame.cutoutLayer){frame.cutoutLayer.parentPanelId=layerMapping.get(frame.cutoutLayer.parentPanelId);frame.cutoutLayer.sourceAssetId=mapping.get(frame.cutoutLayer.sourceAssetId);}if(frame.imageEffects)frame.imageEffects.imageAssetId=mapping.get(frame.imageEffects.imageAssetId);if(frame.breakoutCandidates){for(const c of frame.breakoutCandidates){c.assetId=mapping.get(c.assetId);c.backgroundAssetId=mapping.get(c.backgroundAssetId);c.referenceAssetIds=(c.referenceAssetIds||[]).map(id=>mapping.get(id)).filter(Boolean);if(c.foregroundPanelId)c.foregroundPanelId=layerMapping.get(c.foregroundPanelId);c.status='stale';}}if(frame.breakoutForeground){frame.breakoutForeground.backgroundPanelId=layerMapping.get(frame.breakoutForeground.backgroundPanelId);frame.breakoutForeground.backgroundAssetId=mapping.get(frame.breakoutForeground.backgroundAssetId);const a=store.asset(frame.imageAssetId);a.transparency=await inspectTransparentForegroundFile(store.assetPath(a.id),process.env.COMIC_PYTHON_BIN||bridge.python);}}
        remapProductionPackage(project,mapping,layerMapping,shotMapping);productionPackages.restoreSources(project,input.packageSources);Object.assign(project,remapProductionAssets(input.project,project,mapping));boardSharing.inherit(project);validateProject(project);checkAssets(project);prepared.finish(project);store.db.projects.push(project);store.save();return json(response,201,project);
        });
      }
      if(method==='GET'&&(pathname==='/project-center.html'||pathname==='/collab.html')){
        response.writeHead(410,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
        response.end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>功能已移除</title><body style="font:16px/1.7 system-ui;padding:40px;max-width:720px"><h1>团队帮忙生图功能已移除</h1><p>本机生图、资产生产、制作资料和工程保存不受影响。</p><p><a href="/">返回漫画工作台</a></p></body></html>');
        return;
      }
      if(method==='GET'){
        const name=pathname==='/'?'index.html':pathname.slice(1);check(/^[a-zA-Z0-9._/-]+$/.test(name)&&!name.split('/').includes('..'),'文件路径无效');const file=path.join(root,'public',name);check(fs.existsSync(file)&&fs.statSync(file).isFile(),'页面不存在',404);
        const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.png':'image/png','.svg':'image/svg+xml','.woff2':'font/woff2','.woff':'font/woff'}[path.extname(file)]||'application/octet-stream';return await sendFile(response,file,{'Content-Type':mime,'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; frame-src 'self' http://127.0.0.1:19848; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'"},{missingMessage:'页面不存在',request});
      }
      json(response,404,{error:'接口不存在'});
    }catch(error){if(!response.headersSent)json(response,error.status||error.statusCode||500,{error:redact(error.message),...(error.code?{code:error.code}:{}),...(Array.isArray(error.problems)?{problems:error.problems.map(p=>typeof p==='string'?{message:redact(p)}:{code:p.code,message:redact(p.message||p.code||'无法读取计划'),shotCode:p.shotCode,unitId:p.unitId})}:{}),...(error.validation?{validation:error.validation}:{}),...(error.protocol?{protocol:error.protocol}:{})});else response.end();}
  });
  const forceStopStudio=()=>{for(const plan of episodeBatches.active())episodeBatches.stop(plan.id);const now=new Date().toISOString();for(const job of store.db.jobs)if(['queued','running','preparing','awaiting_confirmation','recoverable','delegated'].includes(job.status))Object.assign(job,{status:'cancelled',phase:'cancelled',completedAt:now,updated:now,message:'主机强制升级，已停止本机任务；原图和云端提交编号保留'});store.save();shutdownStudio();};
  const shutdownStudio=()=>{closed=true;episodeBatches.close();promptRewrites.close();for(const stop of [()=>teamProduction.close(),()=>teamMembers.close(),()=>projectCenter.close(),()=>projectSync?.close(),()=>collabClient.close(),()=>integratedRepair.close(),()=>collabJobs.close(),()=>handleAssetCenter.close()]){try{stop();}catch{}}try{store.flush();}catch{}try{store.close?.();}catch{}comicSfxDesigner.close();for(const operation of running.values()){operation.controller.abort();operation.handle?.cancel?.();}codexLogin.close();bridge.close?.();jimengBridge.close?.();server.close();};
  server.once('listening',()=>{if(!closed){pump();episodeBatches.run();}});
  return {server,store,bridge,jimengBridge,generationSlots,collabJobs,collabClient,episodeBatches,close:shutdownStudio,forceStop:forceStopStudio,idle:()=>!episodeBatches.active().length&&!promptRewrites.running()&&!layerMerge.running()&&!integratedRepair.running()&&handleAssetCenter.running()===0&&running.size===0&&comicSfxDesigner.running()===0};
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
  const studio=createStudio(),port=Number(process.env.COMIC_PORT||8794);studio.server.listen(port,'127.0.0.1',()=>console.log(`长条漫画工作台 http://127.0.0.1:${studio.server.address().port}`));
  studio.server.on('error',error=>{console.error(error.code==='EADDRINUSE'?'端口已被占用：请在 config.local.bat 中设置 COMIC_PORT 后重启。':error.message);process.exitCode=1;});
  process.on('unhandledRejection',error=>{console.error('后台任务出现未处理的错误（服务继续运行）：',error?.stack||error);});
  process.on('SIGINT',()=>{studio.close();process.exit(0);});process.on('SIGTERM',()=>{studio.close();process.exit(0);});
}




