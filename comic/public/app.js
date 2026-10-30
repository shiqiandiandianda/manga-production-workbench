import {mountPanelReferencePreview} from './panel-reference-preview.js';
import {openMokuProject} from './project-library-open.js';
import {mountCanvasPanelCancel} from './canvas-panel-cancel.js';
import {mountRepairTaskbar} from './repair-taskbar.js';
import {formatInputNumber} from './numeric-inputs.js';
import {mountRepairCompare} from './repair-compare.js';
import {mountTaskRailNavigation,updateTaskRailNavigation} from './task-rail-navigation.js';
import {episodeBatchLabel} from './episode-generation-batches.js';
import {confirmGeneration} from './generation-confirmation.js';
import {mountPromptRewriteUI} from './prompt-rewrite-ui.js';
import {reviewFrameUpscale} from './frame-upscale-ui.js';
import {addDialogueSegment,dialogueSegments,defaultDialogueBox} from './bubble-dialogue-segments.js';
import {mountLocalRegionUI} from './local-region-ui.js';
import {mountProjectSyncSetup} from './project-sync-setup.js';
import {mountStorageCleanup} from './storage-cleanup-ui.js';
import {assignMissingEpisodes} from './project-episode-classification.js';
import {imageCardControls} from './image-card-controls.js';
import {mountPanelImageInput} from './panel-image-input.js';
import {productionEpisodeUnit} from './production-episode-layout.js';
import {joinDialogueLines} from './production-text.js';
import {resizeArtworkCorner} from './artwork-transform.js';
import {mountAssetWorkspace} from './asset-workspace-ui.js';
import {mountMokuLoginUI} from './moku-login-ui.js';
import {mountBubbleInspectorNavigation,bubbleInspectorView,showBubbleInspectorTab} from './bubble-inspector-navigation.js';
import {mountCodexConnection} from './codex-connection-ui.js';
import {bindProductionExtraReference,productionExtraNeeds} from './production-extra-references.js';
import {applyProductionStyle,resolveProductionStyle,productionBubbleSegment,updateProductionStyle,dialogueTemplateStyle} from './production-lettering-style.js';
import {mountCanvasPan} from './canvas-pan.js';
import {fitDialogueBubble,fitBubbleToTextFrame} from './lettering.js';
import {episodeBubbleFitPlan,episodeBubbleFitMessage} from './episode-bubble-fit.js';
import {fitBubbleToCurrentLayout} from './bubble-fit-layout.js';
import {mountLibraryUI} from './library-ui.js';
import {mountTeamToolbar} from './team-toolbar.js';
import {mountProjectSyncUI} from './project-sync-ui.js';
import {loadRemoteBubbleStyles} from './bubble-styles-remote.js';
import {mountIntegratedWorkspace} from './layout-repair-ui.js';
import {resizeFrameCorner,moveFrameBoundary,preserveFrameArtwork} from './frame-resize.js';
import {resizePanelGroup} from './panel-group-resize.js';
import {resizeScreenGap} from './production-screen-spacing.js';
import {isCutoutLayer,cutoutPosition,setCutoutPosition} from './cutout-layer.js';
import {loadLibraryFont,loadSavedLibraryFonts} from './library-fonts.js';
import {FONT_FAMILIES} from './lettering.js';
import {initFrameShapeUI} from './frame-shape-ui.js';
import {PANEL_DISPLAY_MODES,panelDisplayMode as normalizePanelDisplayMode} from './panel-display.js';

import {mountCanvasLayerOrder,layerOrderAvailability} from './canvas-layer-order.js';
import {gradientStops,addGradientMidpoint,updateGradientStop} from './gradient-stops.js';
import {proportionalFrameDrag} from './panel-proportional-resize.js';
import {mountFrameGenerationStatus} from './frame-generation-status.js';
import {latestSubmission,taskCardMarkup,taskShortTime,taskDetailMarkup} from './job-cards.js';
import {panelInspectorView,showPanelInspectorTab,mountPanelInspectorNavigation} from './panel-inspector-navigation.js';
import {savedFrameShapes,deleteSavedFrameShape,openSaveFrameShape,scaleFrameUniformly} from './simple-frame-shapes.js';
import {auditPanelReferences,appendRequiredReferences} from './panel-reference-audit.js';
import {planPanelReferenceProcessing,processPanelReferences} from './reference-processing.js';
import {referenceInputStamp} from './reference-requirements.js';

import {mountEpisodeBoards} from './episode-board-ui.js';
import {canvasEpisodeBoards} from './episode-board-canvas.js';
import {boardAssetIds,ensureEpisodeBoards,currentBoardEpisode,episodeCatalog,pageEpisode} from './episode-boards.js';
import {episodePages,episodeShots,episodeLayerProject} from './episode-workspace.js';
import {mountPlatformConcurrency} from './platform-concurrency-ui.js';
import {createStateSync} from './state-sync.js';
import {mountBubbleSpeaker,bubbleSpeaker,speakerAvatar} from './bubble-speaker.js';
import {typographyMarkup,projectTypography,readTypography,paintTypographyPreview,rememberTypography,applyProjectTypography,syncTypographyInput,resetTypography} from './unified-typography.js';
import {isSfxImage,makeSfxImageLayer,resizeSfxImageCorner,sfxImageInspector,sfxImageDelta} from './sfx-image-layer.js';
import {ensurePanelGeneration,ensureProjectPanelGeneration} from "./panel-generation.js";
import {generationPromptChoices,generationPromptSelection,setPanelPromptText,restorePanelPromptText} from './prompt-source.js';
import {settleInspectorDrafts} from './inspector-drafts.js';
import {mountPromptSourceUI} from './prompt-source-ui.js';

import {projectFrameName,taskFrameName} from './frame-display-name.js';
import {panelGenerationAvailability,episodeGenerationPanelIds,MAX_BATCH_PANELS} from './generation-policy.js';
import {mountLazyAutoLayout as mountAutoLayout} from './auto-layout-loader.js';
import {mountResponsiveWorkbench} from './responsive-workbench.js';
import {mountNovelSourcePanel} from './novel-source-panel.js';
import {panelRoleLabel} from './panel-generation-ui.js';
import {openPanelReferences,referenceReviewMarkup} from './panel-reference-ui.js';
import {textAssetGenerationMode} from './asset-text-references.js';
import {panelReferenceIds,setPanelReferences,referenceCountError} from './panel-references.js';
import {toggleArtworkMirror,artworkDelta,artworkAngle,fitArtwork,scaleArtwork} from './artwork-transform.js';
import {mountFrameShortcuts,frameGaps} from './frame-shortcuts.js';
import {makeSfxLayer,isLibrarySfx} from "./sfx-library.js";
import {ensureLayoutHistory,recordLayoutAdjustment,preserveLayoutHistory,layoutEditSnapshot} from './layout-history.js';
import {createUndoMemoryBudget} from './undo-memory.js';
import {prepareProjectSave,mergeSavedHistory} from './project-save-budget.js';
import {saveProjectFile} from './project-file-save.js';
import {projectFileBinding,bindProjectFile} from './project-file-handles.js';
import {mountLayoutHistoryUI} from './layout-history-ui.js';
import {mountHistorySteps} from './layout-history-steps.js';
import {resolveHistoryLocation,historyStepAvailability} from './layout-history-navigation.js';
import {initStoryboardImportUI} from './production-import-ui.js';
import {mountProductionWorkspace,rememberedProductionFrame} from './production-workspace.js';
import {mountReferenceGenerationResults} from './reference-generation-results.js';
import {prepareProductionFrame} from './production-package-model.js';
import {planProductionReferences} from './production-reference-audit.js';
import {productionReferenceCardsMarkup} from './production-reference-cards.js';
import {productionBindingDraft} from './production-reference-audit.js';
import {archiveRemovedDialogue,mergeDialogueArchive,restoreArchivedDialogue} from './dialogue-archive.js';




import {batchStyleMarkup,applyBatchStyle} from './batch-style.js';
import {selectedLayers,expandedSelection,selectAllLayerKeys,marqueeSelection,selectionDocumentBox,translateSelection,deleteSelection} from './multi-selection.js';
import {constrainedNodeX} from './panel-width.js';
import {panelComposition,compositionDirection} from './panel-composition.js';
import {applyEffectVisual,normalizeSfxWord} from './comic-styles.js';
import {openComicSfxDesigner} from './comic-style-ui.js';
import {applyBubbleMaterial,bubbleMaterials} from './bubble-material.js';
import {openBubbleMaterialPicker} from './bubble-material-ui.js';
import {changeBubbleStyle} from './bubble-style-selector.js';
import {formatJobTime as jobTime} from './job-timing.js';
import {GRADIENT_HANDLES,resizeGradientRegion,constrainGradientRegion} from './gradient-region.js';
import {attachBubbleGroups,panelForBubble,groupForLayer,setGroupFlag,moveGroupedLayer,deleteGroupedLayer,assignBubbleToPanel,movePanelGroup} from './layer-groups.js';
import {allLayers,findLayer,normalizeLayerOrder,constrainProjectGradients,makeGradientLayer,gradientFrame,layerFocus} from './layers.js';
import {copyImageLayer,pasteImageLayer,imageLayerShortcut} from './image-layer-clipboard.js';
import {layerListMarkup,layerName,gradientInspectorMarkup} from './layer-ui.js';
import {renderSceneSvg,documentView} from './scene-svg.js';
import {initPanelInfoUI} from './panel-info-ui.js';
import {featherEdges,defaultGradient,gradientAngle,setGradientAngle,rebasePanelEffects} from "./panel-effects.js";
import {PanelPaintEditor} from './panel-paint-editor.js';
import {id,clone,rectangle,panel,makePage,bounds,validPolygon,fitImage,clamp,COMIC_PAGE_WIDTH,rescalePageWidth,resizePageHeight,validatePageHeight,layoutLongStrip} from "./model.js";



import {projectManagerMarkup} from './project-manager.js';
import {panelInspectorMarkup} from './inspector-ui.js';
import {taskGroups,taskSummary} from './workbench-state.js';
import {pageCanvas,exportPage,exportLayoutPage,exportEpisode,exportEpisodeBoard,download,clearImageCache,loadImage} from "./render.js";
import {requestBoardTransitionSafety} from "./episode-board-transitions.js";
import {svgBubbleMarkup,bubbleLayout} from "./lettering.js";
import {AUTO_LETTERING_VERSION,fitDialogueObject,reflowProjectLettering} from './auto-lettering.js';
import {mountManualDialoguePlacement} from './manual-dialogue-placement-ui.js';
import {placePreparedDialogue,placementSettings,preparePlacement} from './manual-dialogue-placement.js';
import {TEXT_FONT_DEFAULTS} from './text-font-defaults.js';
let dialoguePlacementUI=null;
import {BUBBLE_APPEARANCE_VERSION,repairLegacyBubbleAppearance} from './bubble-appearance.js';
import {productionStyleSegments} from './production-lettering-style.js';
import {BubbleEditor,applyBubbleEdit} from './bubble-editor.js';
import {selectionPage,localPagePoint,bubbleFieldChange} from './editor-state.js';
import {bubbleInspectorMarkup} from './editor-ui.js';
import {createViewportController,initWorkbenchChrome} from './viewport.js';
import {createStripSpaceUI} from './strip-space-ui.js';
import {insertStripSpace,resizeStripSpace,resizeEmptyGap,MAX_SPACE_HEIGHT} from './strip-space.js';
import {isStripBackground,anchoredBackground} from './strip-background.js';

import {projectLibraryAssets} from './project-asset-library.js';
import {assetUrl} from './asset-url.js';

import {comparableProject,revisionDecision,syncEpisodeBoardRevision,preserveEditRevision} from './revision-sync.js';
import {mergeProjectRevision} from './project-revision-merge.js';
import {exportWithLocalDraft} from './project-export-draft.js';
import {createBubbleSizeCache} from './bubble-size-cache.js';
import {rectangleDragY,nodeDragY} from './panel-size-limits.js';

const $=selector=>document.querySelector(selector),stage=$('#stage'),escape=text=>String(text??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let libraryUI=null,integratedWorkspace=null,episodeAssetsUI=null,codexConnectionUI=null,repairCompare=null,repairApplying=false;
for(const type of ['pointerdown','click','keydown','beforeinput'])document.addEventListener(type,event=>{if(repairApplying){event.preventDefault();event.stopImmediatePropagation();}},true);
let serverBase='',conflictNotice=null;
let projects=[],project=null,assets=[],jobs=[],pageId=null,selection=null,tool='move',nodeIndex=0,zoom=.4,tab='pages',history=[],future=[],drag=null,dirty=false,saveTimer=null,saving=null,uploadMode='panel',toastTimer=null,lastJobSignature='',status=null,draftMode=false,scheduler={concurrency:6,active:0,queued:0};

const stateSync=createStateSync((...args)=>api(...args));let storageWarningShown=null;
// Start each editing session with unobstructed artwork; cards are an explicit preview.
let showPanelInfo=false;
let showPanelNotes=localStorage.getItem('comic-panel-notes-visible')!=='false';
let panelDisplayMode=normalizePanelDisplayMode(localStorage.getItem('comic-panel-display-mode'));const panelDisplaySelect=document.createElement('select');panelDisplaySelect.id='panel-display-mode';panelDisplaySelect.setAttribute('aria-label','格内显示模式');panelDisplaySelect.title='选择格内显示：镜头号与比例像素、当前生图提示词、人物状态与角色卡';for(const [value,label] of Object.entries(PANEL_DISPLAY_MODES)){const option=document.createElement('option');option.value=value;option.textContent=label;panelDisplaySelect.append(option);}panelDisplaySelect.value=panelDisplayMode;$('#panel-notes-toggle').after(panelDisplaySelect);panelDisplaySelect.onchange=()=>{panelDisplayMode=normalizePanelDisplayMode(panelDisplaySelect.value);showPanelNotes=true;localStorage.setItem('comic-panel-display-mode',panelDisplayMode);localStorage.setItem('comic-panel-notes-visible','true');renderCanvas();};
let imageLayerClipboard=null;
let selectionScope='manual',batchPreviewFrame=null;
let cancellingAllJobs=false;
let projectClosed=localStorage.getItem('comic-project-closed')==='true';
const missingImageAssets=new Set();
const submitting=new Set(),referenceProcessingPanels=new Set(),referenceGenerations=new Map(),referenceGenerationKeys=new Map();let selectedLayerIds=new Set(),selectionMarker=null,multiGesture=null,selectionBox=null;
let lastLayerListMarkup='',layerListSelectionKey='',revealedLayerKey='',layerRevealFrame=0,jobCardFilter='all',cancellingRecentJobs=false;const submissionStorageKey='comic-job-submissions-v1';
function submissionRecords(){try{const records=JSON.parse(localStorage.getItem(submissionStorageKey)||'[]');return Array.isArray(records)?records.filter(r=>r&&Array.isArray(r.jobIds)&&typeof r.projectId==='string'):[];}catch{return [];}}
function rememberSubmission(projectId,created){try{const records=submissionRecords();records.push({projectId,jobIds:created.map(j=>j.id),createdAt:new Date().toISOString()});localStorage.setItem(submissionStorageKey,JSON.stringify(records.slice(-40)));}catch{}}
let stripSpaceUI=null,speakerUI=null,quickUI=null,promptSourceUI=null,quickGesture=null,episodeBoardUI=null;
let deletedProjects=[],deletedProjectNotice=null;
const ACTIVE_JOB_STATES=['queued','running','awaiting_confirmation','recoverable'];
let projectSyncUI=null;
let novelSourcePanel=null,historyStepsUI=null,historyLocateBox=null,historyLocateTimer=null,undoRevision=0;const undoOperationIds=new WeakMap(),invalidatedHistoryIds=new Set(),undoMemory=createUndoMemoryBudget();
let paintBefore=null,brushCursor=null;let locateOnSelect=localStorage.getItem('comic-auto-locate')!=='false',layerScope='all',layerSearch='',groupExpansion=new Map();let brush={mode:'hide',size:120,hardness:.8,opacity:1};
let bubbleGesture=null,viewState=null,generationProvider=localStorage.getItem('comic-generation-provider')||'jimeng',jimengStatus=null,jimengCatalogueError='',jimengModels=[],generationModel='',generationMode='t2i';
if(!['jimeng','codex'].includes(generationProvider))generationProvider='jimeng';
$('#generation-provider').value=generationProvider;
const measurement=document.createElement('canvas').getContext('2d');
const spacingMeasurements=createBubbleSizeCache(measurement);
const frameShapeUI=initFrameShapeUI({escape,edit,getPage:()=>page(),selectionChanged:()=>{nodeIndex=0;tool='rect';render();}});
const assetMap=()=>new Map(assets.map(a=>[a.id,a]));
const storyboardImportUI=initStoryboardImportUI({api,getProject:()=>project,flushSave,refreshState,chooseProject,toast,onImported:value=>acceptImportedProject(value)});
const referenceResultsUI=mountReferenceGenerationResults({api,getProject:()=>project,getSelected:()=>selected(),flushSave,accept:acceptImportedProject,onAssets:mergeImageAssets,modal,closeModal:()=>closeModal(),toast,onRegenerate:input=>submitReferenceGeneration(input.projectId,input.panelId,input.needId,undefined,{force:true})});
let autoLayoutUI;
const promptRewriteUI=mountPromptRewriteUI({root:$('#inspector-body'),api,getProject:()=>project,getPanel:()=>selection?.type==='panel'?selected():null,flushSave,toast,editImage:async(notes,target,referenceIds)=>generateWholeImageEdit(notes,target,{referenceIds}),apply:async(text,target,comparison)=>{if(project?.id!==target.p.id||selected()?.id!==target.panel.id)throw Error('当前格已改变');finishInspectorDrafts();edit(()=>{ensurePanelGeneration(project,selected(),assets);setPanelPromptText(selected(),text);if(comparison)selected().generation.promptComparisons={...selected().generation.promptComparisons,[target.chosen.source]:comparison};},{operation:'panel.prompt-rewrite'});await flushSave();}});
const productionUI=mountProductionWorkspace({selectDialogue:selectDialogueOnCanvas,onReflow:openAutoLetteringPreview,onAddDialogue:()=>dialoguePlacementUI?.open({customText:''}),onManualPlacement:options=>dialoguePlacementUI?.open(options),onTemplate:()=>fitCurrentEpisodeBubbles(),openImport:options=>storyboardImportUI.openImport(options),openAutoLayout:number=>autoLayoutUI.openForEpisode(number),getAssets:()=>assets,getEpisode:()=>project&&currentBoardEpisode(project,page()),onChooseEpisode:switchEpisode,api,getProject:()=>project,getSelected:()=>selected(),flushSave,accept:acceptImportedProject,toast,modal,closeModal:()=>closeModal(),selectFrame:frame=>{const owner=project.pages.find(p=>p.panels.includes(frame));pageId=owner.id;selection={type:'panel',id:frame.id,pageId};selectedLayerIds=new Set([frame.id]);tool='move';render();workbench.openInspector();viewport.scrollToPage(owner.id,{localY:frame.y-30});},generate:ids=>generateFrames(ids),chooseReferences:(frame,slot)=>{const owner=project.pages.find(p=>p.panels.includes(frame));pageId=owner.id;selection={type:"panel",id:frame.id,pageId};selectedLayerIds=new Set([frame.id]);render();choosePanelReferences(slot);},retrieveReferences:async(frame,slot)=>{if(episodeAssetsUI){await episodeAssetsUI.openTarget(frame.id,slot,'records');return;}const need=auditPanelReferences(project,frame,assets).needs.find(n=>n.slot===slot);if(need)await referenceResultsUI.open({projectId:project.id,panelId:frame.id,needId:need.id});},regenerateReferences:async(frame,slot)=>{if(episodeAssetsUI){await episodeAssetsUI.openTarget(frame.id,slot,'generate');return;}const owner=project.pages.find(p=>p.panels.includes(frame));pageId=owner.id;selection={type:"panel",id:frame.id,pageId};selectedLayerIds=new Set([frame.id]);render();const need=auditPanelReferences(project,frame,assets).needs.find(n=>n.slot===slot);if(need)await submitReferenceGeneration(project.id,frame.id,need.id);}});
const page=()=>project?.pages.find(p=>p.id===pageId)||project?.pages[0];
const selected=()=>{if(selection?.type==='gradient')return project?.gradients?.find(g=>g.id===selection.id)||null;const p=selectionPage(project,selection,pageId);return selection?.type==='bubble'?p?.bubbles.find(b=>b.id===selection.id):selection?.type==='panel'?p?.panels.find(f=>f.id===selection.id):null;};
const viewport=createViewportController({scroll:$('#canvas-scroll'),stage,onRender:state=>renderCanvas(state),onModeChange:()=>{renderCanvas();renderSidebar();},onZoomChange:syncZoomChoice,mode:'continuous'});
let chromeState={sidebar:false,inspector:false,jobs:false};
const workbench=initWorkbenchChrome({onChange:next=>{const openedSidebar=next.sidebar&&!chromeState.sidebar;chromeState=next;if((window.innerWidth<=1000||document.body.classList.contains('repair-workspace-active'))&&next.sidebar&&next.inspector){if(openedSidebar)workbench.closeInspector();else workbench.closeSidebar();return;}if(project){renderCanvas();if(openedSidebar){renderLayerList();revealSelectedLayer();}}}});
const panelInfoUI=initPanelInfoUI({root:$('#panel-info-layer'),stage,scroll:$('#canvas-scroll'),getProject:()=>project,getSelectedPanelId:()=>selection?.type==='panel'?selection.id:null,escape,onSelect:(id,owner)=>{pageId=owner;tool='move';setSelectionKeys([id]);renderCanvas();renderSidebar();renderInspector();}});
const selectionOwner=()=>selectionPage(project,selection,pageId);
function bubbleById(value){for(const p of project?.pages||[]){const bubble=p.bubbles.find(b=>b.id===value);if(bubble)return {page:p,bubble};}return null;}
function replaceBubble(value,fixedPageId){const p=project.pages.find(p=>p.id===fixedPageId),index=p?.bubbles.findIndex(b=>b.id===value.id);if(index>=0)p.bubbles[index]=value;}

function setSelectionKeys(keys,preferredId=null){const map=new Map(allLayers(project).map(e=>[e.item.id,e]));selectedLayerIds=new Set([...keys].filter(key=>map.has(key)));const key=preferredId&&selectedLayerIds.has(preferredId)?preferredId:[...selectedLayerIds].at(-1),entry=key&&map.get(key);selection=entry?{type:entry.type,id:key,pageId:entry.pageId||pageId}:null;selectionMarker=selection?.id||null;selectionScope='manual';}
function syncSelectionKeys(){if(!selection){selectedLayerIds.clear();selectionMarker=null;selectionScope='manual';return;}if(selection.id!==selectionMarker){selectedLayerIds=new Set([selection.id]);selectionMarker=selection.id;selectionScope='manual';}const valid=new Set(allLayers(project).map(e=>e.item.id));for(const key of selectedLayerIds)if(!valid.has(key))selectedLayerIds.delete(key);}
function updateSelectionSidebar(){for(const row of $('#layer-list').querySelectorAll('[data-stack-id]'))row.classList.toggle('active',selectedLayerIds.has(row.dataset.stackId));for(const group of $('#layer-list').querySelectorAll('[data-layer-group]'))group.classList.toggle('contains-selection',[...group.querySelectorAll('[data-stack-id]')].some(row=>selectedLayerIds.has(row.dataset.stackId)));}
function selectAllScoped(scope){if(!project)return;const started=performance.now(),preferred=selection?.id,allowed=new Set(allLayers(episodeLayerProject(project,page())).map(entry=>entry.item.id));tool='move';setSelectionKeys(selectAllLayerKeys(project,{scope,pageId}).filter(key=>allowed.has(key)),preferred);selectionScope=scope;renderCanvas();updateSelectionSidebar();renderInspector();workbench.openInspector();stage.dataset.selectionElapsedMs=(performance.now()-started).toFixed(1);stage.dataset.selectedCount=String(selectedLayerIds.size);toast(scope==='all'?'已全选本话 '+episodePages(project,page()).length+' 个画板的图层':'已全选当前画板的图层');}
function queueBatchPreview(){if(batchPreviewFrame!==null)return;batchPreviewFrame=requestAnimationFrame(()=>{batchPreviewFrame=null;renderCanvas();});}

function deleteSelectedLayers(){const keys=new Set(selectedLayerIds);if((keys.size>1?selectedLayers(project,keys):expandedSelection(project,keys)).some(e=>e.item.locked))return toast('请先解锁选中的图层',true);edit(()=>{deleteSelection(project,keys,{bubbleSizes:spacingBubbleSizes()});setSelectionKeys([]);});}
function renderMultiInspector(){const body=$('#inspector-body'),entries=selectedLayers(project,selectedLayerIds);$('#inspector-kind').textContent='多选属性';$('#inspector-title').textContent=(selectionScope==='all'?'本话 '+episodePages(project,page()).length+' 个画板 · ':selectionScope==='page'?'当前页面 · ':'')+'已选择 '+selectedLayerIds.size+' 个图层';$('#delete-layer').disabled=entries.some(e=>e.item.locked);
 body.dataset.inspectorKey='multi';body.innerHTML='<div class="common-inspector"><div class="selection-scope-actions"><button data-select-scope="page">当前页面全选</button><button data-select-scope="all">所有页面全选</button></div>'+batchStyleMarkup(project,selectedLayerIds,escape)+'<button data-action="merge-selected-layers" class="primary wide">合并所选图层</button><p class="sub-note">仅合并选中层，可撤销。</p><button data-action="multi-visible" class="wide">隐藏 / 显示所选</button><button data-action="multi-lock" class="wide">'+(entries.some(e=>e.item.locked)?'解锁所选':'锁定所选')+'</button><button data-action="multi-clear" class="wide">取消多选</button><div class="multi-layer-summary">'+entries.slice(0,30).map(entry=>'<p>'+escape(layerName(project,entry))+'</p>').join('')+(entries.length>30?'<p>另有 '+(entries.length-30)+' 项已选中</p>':'')+'</div></div>';}
function multiDown(event){
 if(episodeBoardUI?.active||$('#canvas-scroll').classList.contains('canvas-hand-ready'))return;
  if(!project||tool!=='move'||event.button!==0||event.target.closest('input,button,select,[data-bubble-handle]'))return;const scroll=$('#canvas-scroll'),box=scroll.getBoundingClientRect();if(event.clientX>=box.left+scroll.clientWidth||event.clientY>=box.top+scroll.clientHeight)return;
 syncSelectionKeys();const hit=event.target.closest('[data-bubble],[data-panel]'),key=hit?.dataset.bubble||hit?.dataset.panel,entry=key&&findLayer(project,key),additive=event.shiftKey||event.ctrlKey||event.metaKey;
 if(entry&&additive){event.preventDefault();event.stopImmediatePropagation();select(entry.type,key,null,{additive:true,inspector:true});return;}
 if(entry&&selectedLayerIds.size>1&&selectedLayerIds.has(key)){
  event.preventDefault();event.stopImmediatePropagation();if(selectedLayers(project,selectedLayerIds).some(e=>e.item.locked))return toast('请先解锁选中的图层',true);
  multiGesture={kind:'move',pointer:event.pointerId,start:documentPoint(event),before:layoutEditSnapshot(project),keys:new Set(selectedLayerIds),moved:false};scroll.setPointerCapture(event.pointerId);return;
 }
 if(entry)return;
 event.preventDefault();event.stopImmediatePropagation();multiGesture={kind:'marquee',pointer:event.pointerId,start:documentPoint(event),beforeKeys:new Set(selectedLayerIds),base:additive?new Set(selectedLayerIds):new Set(),moved:false};
 if(!additive)setSelectionKeys([]);scroll.setPointerCapture(event.pointerId);renderCanvas();renderSidebar();renderInspector();
}
function multiMove(event){const s=multiGesture;if(!s||event.pointerId!==s.pointer)return;event.preventDefault();event.stopImmediatePropagation();const pos=documentPoint(event),dx=pos.x-s.start.x,dy=pos.y-s.start.y;s.moved=s.moved||Math.hypot(dx*zoom,dy*zoom)>3;
 if(s.kind==='move'){if(s.moved)translateSelection(project,s.keys,{dx,dy},s.before);}
 else{selectionBox={x:Math.min(s.start.x,pos.x),y:Math.min(s.start.y,pos.y),w:Math.abs(dx),h:Math.abs(dy)};if(s.moved){const allowed=new Set(allLayers(episodeLayerProject(project,page())).map(entry=>entry.item.id));setSelectionKeys(new Set([...s.base,...marqueeSelection(project,selectionBox,{measurement}).filter(key=>allowed.has(key))]));}}
 renderCanvas();renderSidebar();if(s.kind==='marquee')renderInspector();
}
function multiEnd(event,cancelled=false){const s=multiGesture;if(!s||event.pointerId!==s.pointer)return;event.preventDefault();event.stopImmediatePropagation();multiGesture=null;selectionBox=null;undoRevision++;historyStepsUI?.refresh();const scroll=$('#canvas-scroll');if(scroll.hasPointerCapture(event.pointerId))scroll.releasePointerCapture(event.pointerId);
 if(cancelled){if(s.kind==='move')project=preserveLayoutHistory(project,s.before);else setSelectionKeys(s.beforeKeys);render();return;}
 if(s.kind==='move'&&s.moved)commit(s.before);else{renderCanvas();renderSidebar();renderInspector();}if(selectedLayerIds.size)workbench.openInspector();
}
function openCanvasFixedBoard(element,{locate=false,layerKey}={}){if(!project)return;quickUI?.finish();stripSpaceUI?.cancel({repaint:false});tool='move';setSelectionKeys([]);episodeBoardUI.open(element.dataset.fixedBoard,{locate,layerKey});}
$('#canvas-scroll').addEventListener('pointerdown',event=>{if(event.button!==0||$('#canvas-scroll').classList.contains('canvas-hand-ready'))return;const fixed=event.target.closest('[data-fixed-board]');if(!fixed){if(episodeBoardUI?.active)episodeBoardUI.close({render:false});return;}event.preventDefault();event.stopImmediatePropagation();const layerKey=event.target.closest('[data-board-layer]')?.dataset.boardLayer;openCanvasFixedBoard(fixed,{layerKey});episodeBoardUI.pointerDown(event);},true);
stage.addEventListener('keydown',event=>{const fixed=event.target.closest('[data-fixed-board]');if(fixed&&event.key==='Enter'){event.preventDefault();event.stopImmediatePropagation();openCanvasFixedBoard(fixed,{layerKey:event.target.closest('[data-board-layer]')?.dataset.boardLayer});}},true);
$('#canvas-scroll').addEventListener('pointerdown',event=>{
 if($('#canvas-scroll').classList.contains('canvas-hand-ready')||episodeBoardUI?.active||!project||event.button!==0||tool==='move'||tool==='insert-space'||drag||bubbleGesture||paintBefore||multiGesture)return;
 const scroll=$('#canvas-scroll'),box=scroll.getBoundingClientRect();if(event.clientX>=box.left+scroll.clientWidth||event.clientY>=box.top+scroll.clientHeight)return;
 if(event.target.closest('[data-panel],[data-bubble],[data-bubble-handle],button,input,select,a'))return;
 quickUI?.finish();setSelectionKeys([]);nodeIndex=0;event.stopImmediatePropagation();renderCanvas();renderSidebar();renderInspector();
},true);
$('#canvas-scroll').addEventListener('pointerdown',multiDown,true);
$('#canvas-scroll').addEventListener('pointermove',multiMove,true);
$('#canvas-scroll').addEventListener('pointerup',event=>multiEnd(event),true);
$('#canvas-scroll').addEventListener('pointercancel',event=>multiEnd(event,true),true);
window.addEventListener('blur',()=>{if(multiGesture)multiEnd({pointerId:multiGesture.pointer,preventDefault(){},stopImmediatePropagation(){}},true);});

new BubbleEditor({root:stage,getBubble:value=>bubbleById(value)?.bubble,getLayout:bubble=>bubbleLayout(measurement,bubble),toPagePoint:event=>pagePoint(event,bubbleGesture?.pageId||event.target.closest?.('[data-page-id]')?.dataset.pageId||pageId),
  onStart:(before,meta)=>{const owner=bubbleById(before.id)?.page;if(!owner)return;bubbleGesture={pageId:owner.id,before:layoutEditSnapshot(project)};pageId=owner.id;selection={type:'bubble',id:before.id,pageId};if(meta.kind==='point'&&Number.isInteger(meta.index))nodeIndex=meta.index;},
  onChange:(next,meta)=>{const owner=bubbleGesture?.pageId||bubbleById(next.id)?.page.id;if(owner)replaceBubble(next,owner);renderCanvas();if(meta.cancelled){bubbleGesture=null;undoRevision++;historyStepsUI?.refresh();renderInspector();}},
  onCommit:()=>{const before=bubbleGesture?.before;bubbleGesture=null;undoRevision++;historyStepsUI?.refresh();if(before)commit(before);}
});
const shotFor=frame=>project.shots.find(s=>s.id===frame?.shotId);
const activeJob=frame=>jobs.find(j=>j.id===frame?.generationToken&&ACTIVE_JOB_STATES.includes(j.status));
async function api(path,method='GET',body,{signal}={}){const response=await fetch(path,{method,signal,headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});const result=await response.json();if(!response.ok)throw Object.assign(new Error(result.error||`请求失败 ${response.status}`),{status:response.status,validation:result.validation,code:result.code,problems:result.problems,gate:result.gate,importIssues:result.importIssues,importInfo:result.importInfo});return result;}
function toast(text,error=false){clearTimeout(toastTimer);$('#toast').textContent=text;$('#toast').classList.toggle('error',error);$('#toast').hidden=false;toastTimer=setTimeout(()=>$('#toast').hidden=true,error?8500:3800);}
function safely(fn){return async(...args)=>{try{await fn(...args);}catch(error){toast(error.message,true);}};}
const storageClientId=crypto.randomUUID();
async function chooseProject(value,{fit=false,alreadyLoaded=false}={}){
 if(value)await api('/api/storage-maintenance/open','POST',{clientId:storageClientId,projectId:value.id});
 else await api('/api/storage-maintenance/activity','POST',{clientId:storageClientId,projectId:'',dirty:false});
 episodeBoardUI?.close({render:false});quickUI?.finish();if(value&&!alreadyLoaded)value=await api('/api/projects/'+value.id);stripSpaceUI?.cancel({repaint:false});
 if(value?.autoLayoutSource?.mode==='screen-crop-reflow'&&value.autoLayoutSource.sourceProjectId){try{const episode=value.autoLayoutSource.episode;value=await api('/api/auto-layout/reflow/merge-existing','POST',{projectId:value.id,expectedRevision:value.revision});localStorage.setItem('comic-active-episode:'+value.id,String(episode));const url=new URL(location.href);url.searchParams.set('project',value.id);url.searchParams.delete('page');window.history.replaceState(null,'',url);toast('已将成图重排接回原工程，并移出独立重排工程');}catch(error){toast('重排结果未自动接回：'+error.message,true);}}
 if(value&&(value.editorLayoutVersion!==2||value.layerGroupsVersion!==1||value.layerSchema!==1||value.pages.some(p=>p.width!==1280)||value.pages.some(p=>p.panels.some(f=>f.gradient))))value=await api('/api/projects/'+value.id+'/migrate-layers','POST',{expectedRevision:value.revision});
 project=value?clone(value):null;if(value){projectClosed=false;localStorage.removeItem('comic-project-closed');localStorage.setItem('comic-active-project',value.id);}setServerBase(value);conflictNotice=null;
 const newAudit=project&&(!project.layoutHistory||project.layoutHistory.retention!=='rolling');if(project)ensureLayoutHistory(project);imageLayerClipboard=null;
 const remembered=project&&Number(localStorage.getItem('comic-active-episode:'+project.id)),openingPage=project?.pages.find(p=>pageEpisode(project,p)===remembered)||project?.pages.find(p=>p.panels.length||p.bubbles.length)||project?.pages[0];
 pageId=openingPage?.id||null;const first=(openingPage&&rememberedProductionFrame(project,pageEpisode(project,openingPage)))||openingPage?.panels.find(p=>p.shotId===project.shots[0]?.id)||openingPage?.panels[0];if(first)pageId=project.pages.find(p=>p.panels.includes(first)).id;selection=first?{type:'panel',id:first.id,pageId}:null;
 history=[];future=[];invalidatedHistoryIds.clear();undoRevision++;historyLocateBox=null;dirty=false;deletedProjectNotice=null;groupExpansion.clear();selectedLayerIds.clear();selectionMarker=null;nodeIndex=0;
  viewState=viewport.set({pages:[],decorations:null,currentPageId:null});
 if(fit||openingPage&&openingPage!==project.pages[0]){$('#zoom').value='fit';localStorage.setItem('comic-zoom-choice','fit');}
 render();responsiveUI.syncInspectorShortcut();if(project)viewport.scrollToPage(pageId);$('#save-state').textContent=project?'已保存到本机':'暂无项目';if(newAudit)scheduleSave();
 if(project){const openingId=project.id,revision=undoRevision;await document.fonts.ready;if(project?.id===openingId&&undoRevision===revision&&!hasLocalEditing()){const upgradeLegacy=project.autoLetteringUpgradeVersion!==AUTO_LETTERING_VERSION;project.autoLetteringUpgradeVersion=AUTO_LETTERING_VERSION;const appearancePending=project.bubbleAppearanceVersion!==BUBBLE_APPEARANCE_VERSION;project.bubbleAppearanceVersion=BUBBLE_APPEARANCE_VERSION;const before=layoutEditSnapshot(project),appearance=appearancePending?repairLegacyBubbleAppearance(project):{changed:0},result={changed:0};if(result.changed||appearance.changed){commit(before,{source:'automatic',operation:'bubble.initial-auto-lettering'});toast('已修复旧气泡的不可见默认外观，可撤销；台词内容与位置保留。');}else if(upgradeLegacy||appearancePending)scheduleSave();}}
}
function protectImages(serverProject){for(const key of ['productionAssets'])if(serverProject[key]!==undefined)project[key]=clone(serverProject[key]);const currentPanels=new Map(project.pages.flatMap(p=>p.panels.map(f=>[f.id,f])));for(const serverPage of serverProject.pages)for(const serverPanel of serverPage.panels){const current=currentPanels.get(serverPanel.id);if(!current)continue;if(current.imageAssetId!==serverPanel.imageAssetId){current.imageAssetId=serverPanel.imageAssetId;current.imageTransform=clone(serverPanel.imageTransform);}if(serverPanel.imageEffects)current.imageEffects=clone(serverPanel.imageEffects);else delete current.imageEffects;current.candidates=clone(serverPanel.candidates);if(serverPanel.breakoutCandidates)current.breakoutCandidates=clone(serverPanel.breakoutCandidates);current.generationToken=serverPanel.generationToken;}}
function setServerBase(value){serverBase=value?comparableProject(value):'';}
// Another window may have saved different content. Never take its revision number without its content.
function adoptServerProject(server){project=clone(server);ensureLayoutHistory(project);setServerBase(server);history=[];future=[];invalidatedHistoryIds.clear();undoRevision++;historyLocateBox=null;selectedLayerIds.clear();if(!project.pages.some(p=>p.id===pageId))pageId=project.pages[0]?.id||null;if(!selected())selection=null;dirty=false;conflictNotice=null;render();$('#save-state').textContent='已载入工程的最新修改';toast('工程在后台或其他窗口发生修改，已载入最新内容；本窗口的撤回记录已清空。');}
function hasLocalEditing(){return !!(episodeBoardUI?.editing||episodeBoardUI?.active&&document.activeElement?.matches('[data-board-meta],[data-board-text],[data-board-style]')||drag||bubbleGesture||paintBefore||multiGesture||quickGesture||numericDrafts.size||(document.activeElement?.closest('#inspector-body')&&document.activeElement.matches('input[data-field],textarea[data-field],select[data-field]')));}
function rebaseLocalSnapshots(base,server){
 const rebase=value=>{const result=mergeProjectRevision({baseComparable:base,local:value,server});if(!result.ok)return value;const next=result.project;delete next.layoutHistory;undoOperationIds.set(next,undoOperationIds.get(value)||null);return next;};
 history=history.map(rebase);future=future.map(rebase);for(const [input,before]of numericDrafts)numericDrafts.set(input,rebase(before));
}
function updateConflictControl(){
 let button=$('#resolve-save-conflict');if(!button){button=document.createElement('button');button.id='resolve-save-conflict';button.textContent='处理保存冲突';button.addEventListener('click',safely(openSaveConflict));$('#save-state').after(button);}button.hidden=conflictNotice===null;
}
function applyServerRevision(server){
 if(drag||bubbleGesture||paintBefore||multiGesture||quickGesture||episodeBoardUI?.editing)return 'defer';
  const decision=revisionDecision({localRevision:project.revision,server,baseComparable:serverBase,dirty:dirty||hasLocalEditing(),saving});
  if(decision==='conflict'){
   const merged=mergeProjectRevision({baseComparable:serverBase,local:project,server});
   if(merged.ok){
    const prior=serverBase,focused=document.activeElement;rebaseLocalSnapshots(prior,server);project=merged.project;setServerBase(server);conflictNotice=null;updateConflictControl();
    if(focused?.matches('textarea[data-section="panel-prompt"]')&&selected()){const text=generationPromptSelection(selected(),project).text;if(focused.value!==text)focused.value=text;}
    dirty=comparableProject(project)!==serverBase;clearTimeout(saveTimer);if(dirty)scheduleSave();else $('#save-state').textContent='已同步生成结果 · 可继续编辑';
    if(!hasLocalEditing())renderInspector();renderSidebar();refreshHistoryButtons();return 'merged';
   }
  }
  if(decision==='adopt-revision'){project.revision=server.revision;project.updated=server.updated;syncEpisodeBoardRevision(server,project);setServerBase(server);}
  else if(decision==='adopt-content')adoptServerProject(server);
  else if(decision==='conflict'&&conflictNotice!==server.revision){conflictNotice=server.revision;clearTimeout(saveTimer);$('#save-state').textContent='同一内容有两份修改';toast('当前修改已保留。点击“处理保存冲突”可重新合并，或保留本窗口副本继续编辑。',true);}
  if(conflictNotice!==null&&(decision==='ignore'||decision==='adopt-revision')&&comparableProject(server)===serverBase){conflictNotice=null;if(dirty)scheduleSave();else $('#save-state').textContent='已保存到本机';}
  updateConflictControl();
  return decision;
}
async function openSaveConflict(){
 modal('处理保存冲突','<p>同一项内容有两份修改，当前窗口的文字和排版仍然保留。</p><p>可重新检查合并；若仍有冲突，另存本窗口副本即可继续编辑，原工程保留后台的最新内容。</p>',[
  {label:'重新合并',primary:true,run:async()=>{const id=project.id,fresh=await api('/api/projects/'+id);if(project?.id!==id)return;applyServerRevision(fresh);if(conflictNotice!==null)throw Error('同一内容仍有冲突，可另存本窗口副本继续编辑');closeModal();render();await saveNow();toast('已恢复保存，可以继续编辑');}},
  {label:'另存本窗口副本继续编辑',run:async()=>{document.activeElement?.blur();finishInspectorDrafts();const id=project.id,local=clone(project),token=undoRevision;const data=exportWithLocalDraft(await api('/api/projects/'+id+'/export?mode=local'),local,assets);data.project.title=local.title+' · 本窗口保留副本';const imported=await api('/api/projects/import','POST',data);if(project?.id!==id||undoRevision!==token){toast('本窗口副本已另存到工程列表，当前编辑继续保留');return;}closeModal();await chooseProject(imported,{alreadyLoaded:true});updateConflictControl();toast('已保留本窗口副本，可以继续编辑；原工程保留');}},
  {label:'导出本窗口备份',run:()=>$('#export-project').click()},
  {label:'关闭',run:closeModal}
 ]);
}
function scheduleSave(){dirty=true;clearTimeout(saveTimer);if(conflictNotice!==null){$('#save-state').textContent='同一内容有两份修改';return;}$('#save-state').textContent='正在保存…';saveTimer=setTimeout(()=>saveNow().catch(error=>toast(error.message,true)),500);}
async function saveNow(){clearTimeout(saveTimer);if(conflictNotice!==null){const id=project?.id,fresh=await api('/api/projects/'+id);if(project?.id!==id)return;applyServerRevision(fresh);if(conflictNotice!==null)throw Error('同一内容仍有冲突，请点顶部“处理保存冲突”继续。');}if(episodeBoardUI?.editing||drag||bubbleGesture||paintBefore||multiGesture||quickGesture){saveTimer=setTimeout(()=>saveNow().catch(error=>toast(error.message,true)),500);return;}if(saving){await saving;if(dirty)return saveNow();return;}if(!project||!dirty)return;let prepared;try{prepared=prepareProjectSave(project);}catch(error){$('#save-state').textContent='保存失败 · 可导出工程备份';throw error;}const {snapshot,removed}=prepared;if(removed){undoRevision++;historyStepsUI?.refresh();historyStepsUI?.notice('达到保存大小上限，已自动清理最早 '+removed+' 条历史记录。');}dirty=false;saving=api('/api/projects/'+snapshot.id,'PUT',snapshot).then(saved=>{if(project?.id===saved.id){project.revision=saved.revision;project.updated=saved.updated;if(mergeSavedHistory(project,snapshot,saved)){undoRevision++;historyStepsUI?.refresh();}syncEpisodeBoardRevision(saved,project);setServerBase(saved);protectImages(saved);mergeDialogueArchive(project,saved);$('#save-state').textContent=dirty?'正在保存…':'已保存到本机';}}).catch(error=>{dirty=true;$('#save-state').textContent='保存失败 · 可导出工程备份';throw error;}).finally(()=>saving=null);await saving;if(dirty)return saveNow();}
function finishInspectorDrafts(){settleInspectorDrafts(numericDrafts,project,before=>commit(before,{inspector:false}));}
function refreshHistoryButtons(){const draft=!!(quickGesture||numericDrafts.size);$('#undo').disabled=!history.length&&!draft;$('#redo').disabled=!future.length;}
async function flushSave(){clearTimeout(saveTimer);episodeBoardUI?.finish();quickUI?.finish();finishInspectorDrafts();await saveNow();}
function remember(before,operationId){const branched=future.length>0;if(branched)for(const snapshot of future){const id=undoOperationIds.get(snapshot);if(id)invalidatedHistoryIds.add(id);}while(invalidatedHistoryIds.size>2000)invalidatedHistoryIds.delete(invalidatedHistoryIds.values().next().value);undoOperationIds.set(before,operationId||null);history.push(before);future=[];const budget=undoMemory.trim(history,future);if(budget.removed)historyStepsUI?.notice('已自动回收较早的撤销快照，保留最近 '+budget.steps+' 步；当前编辑和已保存工程保留。');undoRevision++;$('#undo').disabled=!history.length;$('#redo').disabled=true;historyStepsUI?.refresh();if(branched){const message='新的修改已替换待重做分支，原分支步骤不能再重做。';historyStepsUI?.notice(message);setTimeout(()=>toast(message),0);}}
function commit(before,{inspector=true,source='manual',operation,copiedFrom}={}){archiveRemovedDialogue(project,before);attachBubbleGroups(project);normalizeLayerOrder(project);const comparable=layoutEditSnapshot(project);if(JSON.stringify(before)!==JSON.stringify(comparable)){const audit=recordLayoutAdjustment(before,project,{source,operation,copiedFrom});showAuditWarning(audit.warning);syncAuditWarning();remember(before,audit.record?.id);scheduleSave();}renderCanvas();renderSidebar();renderJobs();if(inspector)renderInspector();dialoguePlacementUI?.sync();}


function edit(fn,options){if(!project)return;const before=layoutEditSnapshot(project);fn();commit(before,options);window.dispatchEvent(new CustomEvent('production-activity',{detail:{projectId:project.id,episode:page()?pageEpisode(project,page()):null,stage:'layout'}}));}
let episodeBubbleFitBusy=false;
function selectDialogueOnCanvas(id){
 const entry=findLayer(project,id);if(entry?.type!=='bubble')return;
 finishInspectorDrafts();pageId=entry.pageId;selection={type:'bubble',id,pageId};selectedLayerIds=new Set([id]);tool='move';render();workbench.openInspector();viewport.scrollToPage(pageId,{localY:entry.item.y-100});
}
async function fitCurrentEpisodeBubbles(){
 if(!project||!page()||selection?.type!=='bubble'||episodeBubbleFitBusy)return;
 const projectId=project.id,episode=currentBoardEpisode(project,page()),bubbleId=selected()?.id;episodeBubbleFitBusy=true;
 try{
  await document.fonts.ready;
  if(project?.id!==projectId||!page()||currentBoardEpisode(project,page())!==episode||selection?.type!=='bubble'||selected()?.id!==bubbleId)return;
  finishInspectorDrafts();
  await flushSave();const revision=project.revision,template=clone(selected()),segmentId=productionBubbleSegment(project,template,selectionOwner()),result=episodeBubbleFitPlan(measurement,project,page(),template);
  if(!project.productionPackage){if(result.changes.length)edit(()=>{for(const change of result.changes)replaceBubble(change.bubble,change.pageId);},{source:'automatic',operation:'bubble.episode-auto-fit'});toast(episodeBubbleFitMessage(result));return;}
  modal('用选中句统一本话',`<p>以当前句的气泡、文字框和字体为样板，更新第 ${episode} 话 ${result.changes.length} 个对白；锁定、隐藏、无框和多段内容跳过。</p><p>应用后，本话后续新增对白也沿用这套字体与框样式。整次操作可撤销。</p>`,[{label:'取消',run:closeModal},{label:'应用到本话',primary:true,run:()=>{if(project?.id!==projectId||project.revision!==revision)throw Error('工程已有变化，请重新选择样板');edit(()=>{for(const change of result.changes)replaceBubble(change.bubble,change.pageId);if(segmentId){const saved=dialogueTemplateStyle(template);delete saved.fontSize;updateProductionStyle(project,segmentId,'episode',saved);}},{source:'automatic',operation:'bubble.episode-auto-fit'});closeModal();toast(episodeBubbleFitMessage(result));}}]);
 }finally{episodeBubbleFitBusy=false;}
}
function autoFitBubble(bubble,options={}){
 const owner=project?.pages.find(p=>p.bubbles.some(b=>b.id===bubble.id))||page(),parent=owner?.panels.find(p=>p.id===bubble.parentPanelId),words=(project?.pages.flatMap(p=>p.bubbles.map(b=>b.speaker))||[]).concat(project?.productionPackage?.episodes.flatMap(e=>(e.texts||[]).map(t=>t['说话人']))||[]).filter(Boolean);
 const result=fitDialogueObject(measurement,bubble,{pageWidth:owner?.width||1280,parentWidth:parent?.w||1280,maxHeight:Math.max(parent?.h||8192,bubble.fontSize*6),protectedWords:words,...options});
 if(result.status==='fitted'){const b=result.bubble,inside=parent&&b.w<=parent.w;b.x=Math.max(inside?parent.x:0,Math.min(b.x,(inside?parent.x+parent.w:owner?.width||1280)-b.w));b.y=Math.max(parent?.y||0,b.y);}
 return result;
}
async function openAutoLetteringPreview({segmentId,scope='screen'}={}){
 if(!project)return;finishInspectorDrafts();const ownerId=project.id,revision=undoRevision;await document.fonts.ready;if(project?.id!==ownerId||undoRevision!==revision)return;
 const segmentIds=segmentId?productionStyleSegments(project,segmentId,scope):undefined,planned=clone(project),result=reflowProjectLettering(measurement,planned,{force:true,segmentIds}),samples=planned.pages.flatMap(p=>p.bubbles).filter(b=>{const old=project.pages.flatMap(p=>p.bubbles).find(o=>o.id===b.id);return JSON.stringify(old)!==JSON.stringify(b);}).slice(0,3);
 modal('重新自动排字',`<p>将重新排字 ${result.changed} 条台词，跳过 ${result.locked} 条锁定内容${result.unsupported?'；'+result.unsupported+' 条需要手动调整':''}。保持字号和台词原文，均衡分行、避免尾行只剩一个字或标点，并让气泡包住文字。</p><p>本次会替换范围内的手工文字框与外框尺寸；图片和分镜来源保留，可整次撤销。</p><div class="auto-lettering-preview">${samples.map(b=>`<svg viewBox="${b.x-15} ${b.y-15} ${b.w+30} ${b.h+90}" role="img" aria-label="自动排字预览">${svgBubbleMarkup(measurement,b)}</svg>`).join('')}</div>`,[{label:'取消',run:closeModal},{label:'应用重新排字',primary:true,run:()=>{if(project?.id!==ownerId||undoRevision!==revision)throw Error('预览期间工程已有修改，请重新预览');edit(()=>{for(const p of planned.pages){const current=project.pages.find(q=>q.id===p.id);if(current)current.bubbles=p.bubbles;}},{source:'automatic',operation:'bubble.bulk-auto-lettering'});closeModal();toast('已重新排字 '+result.changed+' 条，可撤销。');}}]);
}
async function fitSelectedBubbleToLayout(){
 if(!project||selection?.type!=='bubble')return;
 const projectId=project.id,bubbleId=selected()?.id;
 await document.fonts.ready;
 if(project?.id!==projectId||selection?.type!=='bubble'||selected()?.id!==bubbleId)return;
 finishInspectorDrafts();
 const entry=findLayer(project,bubbleId),target=entry?.item,owner=project.pages.find(p=>p.id===entry?.pageId);
 if(!target||!owner)return;
 if(owner.locked||target.locked||panelForBubble(project,bubbleId)?.item?.locked)throw Error('请先解锁气泡及所属画格');
 const result=fitBubbleToCurrentLayout(measurement,target,{maxWidth:owner.width*2});
 if(result.status==='contour-space'){toast('当前轮廓无法在固定留白内容纳文字，已保留原样；请调整文字框或选择更宽松的气泡样式。');return;}
 if(result.status==='segments'){toast('双段气泡请分别调整两段文字框；本次未改动。');return;}
 if(result.status==='too-large'){toast('按当前排版适配会超出允许尺寸，已保留原样，请手动调整文字框。');return;}
 if(result.status==='skipped'){toast('请选择可见、有文字的有框气泡。');return;}
 if(result.bubble.autoLettering)result.bubble.autoLettering.mode='manual';
 if(JSON.stringify(target)!==JSON.stringify(result.bubble))edit(()=>replaceBubble(result.bubble,owner.id),{source:'manual',operation:'bubble.fit-current-layout'});
 toast('已按当前文字适配气泡；字号、分行、文字位置及文字框尺寸保持不变，可撤销。');
}
function quickTarget(){if(!project||selection?.type!=='panel'||selectedLayerIds.size>1||tool==='insert-space')return null;const item=selected();if(!item)return null;return {item,tool,asset:assetMap().get(item.imageAssetId),code:projectFrameName(project,item),generationState:currentPanelGenerationState(),promptSourceState:promptSourceUI?.currentState(),cutoutPosition:isCutoutLayer(item)?cutoutPosition(project,item):null,gaps:frameGaps(project,item.id,{bubbleSizes:spacingBubbleSizes([selectionOwner()])})};}
function previewQuickField(field,value){
 try{const target=quickTarget();if(!target||target.item.locked)throw Error('请先选中并解锁画格');
  if(quickGesture&&quickGesture.field!==field)finishQuickField();
  if(!quickGesture)quickGesture={field,panelId:target.item.id,pageId:selection.pageId,projectId:project.id,before:layoutEditSnapshot(project),gaps:target.gaps,bubbleSizes:field.startsWith('gap-')?spacingBubbleSizes():null};
  const g=quickGesture;if(project.id!==g.projectId||target.item.id!==g.panelId)throw Error('选中的画格已变化');const original=findLayer(g.before,g.panelId)?.item;if(!original)throw Error('画格已变化');
  if(field.startsWith('gap-')){const gap=g.gaps?.[field.slice(4)];if(!gap||gap.blocked)throw Error('此处与其他画格重叠，请使用插入底图');const result=gap.screen?resizeScreenGap(g.before,g.panelId,field.slice(4),Math.round(value),{bubbleSizes:g.bubbleSizes,assets:assetMap()}):resizeEmptyGap(g.before,{from:gap.from,to:gap.to,height:Math.round(value),bubbleSizes:g.bubbleSizes});result.project.layoutHistory=project.layoutHistory;project=preserveEditRevision(project,result.project);}
  else if(field==='image-scale'){const next=clone(original);scaleArtwork(next,target.asset,value);target.item.imageTransform=next.imageTransform;tool='image';}
  else if(field==='image-rotation'){if(!Number.isFinite(value)||value<-180||value>180)throw Error('旋转角度请输入 -180°—180°');target.item.imageTransform={...(original.imageTransform||fitImage(original,target.asset)),rotation:value};tool='image';}
  else if(field==='border-width'){if(!Number.isFinite(value)||value<0||value>256)throw Error('描边粗细请输入 0—256 px');target.item.border=value;}
  else if(field==='border-color'){if(!/^#[0-9a-f]{6}$/i.test(value))throw Error('请选择有效的描边颜色');target.item.borderColor=value;}
  renderCanvas();$('#save-state').textContent='调整中 · 松开后保存';
 }catch(error){toast(error.message,true);}
}
function finishQuickField(){if(!quickGesture)return;const g=quickGesture;quickGesture=null;if(project?.id!==g.projectId)return;commit(g.before,{operation:g.field.startsWith('gap-')?'strip.gap-'+g.field.slice(4):g.field==='image-scale'?'image.scale':g.field==='border-width'?'panel.border':g.field==='border-color'?'panel.border-color':'image.rotation'});}
function cancelQuickField(){if(!quickGesture)return;const g=quickGesture;quickGesture=null;if(project?.id!==g.projectId)return;project=preserveLayoutHistory(project,g.before);render();$('#save-state').textContent=dirty?'正在保存…':'已保存到本机';}
function spacingBubbleSizes(pages=project.pages){return Object.fromEntries(pages.filter(Boolean).flatMap(p=>p.bubbles).map(b=>[b.id,spacingMeasurements.size(b)]));}
function applySpacingResult(result){edit(()=>{project=result.project;pageId=result.pageId;selection=result.layerId?{type:'gradient',id:result.layerId,pageId}:null;tool='move';},{source:'manual',operation:'strip.spacing'});workbench.openInspector();}
function changeStripSpace(height,color){const item=selected();if(!item?.stripSpace||item.locked)return;applySpacingResult(resizeStripSpace(project,item.id,height,{color,bubbleSizes:spacingBubbleSizes()}));}
async function restoreHistory(direction,steps=1){
 if(episodeBoardUI?.editing||drag||bubbleGesture||paintBefore||multiGesture)return toast('请先完成当前拖拽后再撤回 / 重做',true);
 episodeBoardUI?.finish();quickUI?.finish();finishInspectorDrafts();
 stripSpaceUI?.cancel({repaint:false});const source=direction==='undo'?history:future,destination=direction==='undo'?future:history;
 if(!Number.isInteger(steps)||steps<1||steps>source.length){renderCanvas();return;}
 const before=project,auditHistory=project.layoutHistory;
 for(let i=0;i<steps;i++){const target=source.pop(),snapshot=layoutEditSnapshot(project);undoOperationIds.set(snapshot,undoOperationIds.get(target)||null);destination.push(snapshot);target.revision=project.revision;target.layoutHistory=auditHistory;syncEpisodeBoardRevision(project,target);project=target;}
 undoMemory.trim(history,future,{prefer:direction==='undo'?'history':'future'});undoRevision++;const audit=recordLayoutAdjustment(before,project,{source:direction,operation:steps===1?direction:direction+'.steps:'+steps});showAuditWarning(audit.warning);
 if(!project.pages.some(p=>p.id===pageId))pageId=project.pages[0].id;if(!selected())selection=null;if(tool==='rect'&&selection?.type==='panel'&&JSON.stringify(selected().points)!==JSON.stringify(rectangle()))tool='nodes';historyLocateBox=null;scheduleSave();render();
}
function historyStepControls(record){if(episodeBoardUI?.editing||drag||bubbleGesture||paintBefore||multiGesture||quickGesture||numericDrafts.size)return {undoSteps:0,redoSteps:0,reason:'请先完成当前拖拽或属性输入。'};return historyStepAvailability(record,history,future,undoOperationIds,invalidatedHistoryIds);}
function historyLocateMarkup(state){if(!historyLocateBox||historyLocateBox.projectId!==project?.id)return '';const b=historyLocateBox,offset=documentView(project,state).offset;return '<rect data-history-location="true" x="'+b.x+'" y="'+(b.y-offset)+'" width="'+b.w+'" height="'+b.h+'" fill="#f6c769" fill-opacity=".08" stroke="#f6c769" stroke-width="'+(2/state.zoom)+'" stroke-dasharray="'+(6/state.zoom)+' '+(4/state.zoom)+'" pointer-events="none"/>';}
function locateHistoryStep(record,objectId=''){
 if(drag||bubbleGesture||paintBefore||multiGesture||quickGesture||numericDrafts.size)return '请先完成当前拖拽或属性输入，再定位。';
 const result=resolveHistoryLocation(project,record,{objectId,measurement});if(!result.box){toast(result.message,true);return result.message;}
 stripSpaceUI?.cancel({repaint:false});tool='move';const owners=[...new Set(result.targets.map(t=>t.pageId).filter(Boolean))];if(owners.length>1)viewport.setMode('continuous');if(owners[0])pageId=owners[0];
 const keys=result.targets.filter(t=>t.status==='current'||t.status==='hidden').map(t=>t.id);setSelectionKeys(keys);nodeIndex=0;
 const b=result.box,scroll=$('#canvas-scroll'),availableW=Math.max(40,scroll.clientWidth-60),availableH=Math.max(40,scroll.clientHeight-60),fit=Math.min(zoom,availableW/Math.max(1,b.w),availableH/Math.max(1,b.h));syncZoomChoice(fit);
 historyLocateBox={...b,projectId:project.id};clearTimeout(historyLocateTimer);render();const offset=documentView(project,viewState).offset,visibleH=Math.max(1,scroll.clientHeight-48)/zoom;
 viewport.scrollToY(Math.max(0,b.y-offset+b.h/2-visibleH/2));scroll.scrollLeft=Math.max(0,(parseFloat(stage.style.left)||0)+(b.x+b.w/2)*zoom-scroll.clientWidth/2);renderCanvas();
 historyLocateTimer=setTimeout(()=>{historyLocateBox=null;renderCanvas();},2500);return result.message;
}
function locateLayer(key){const focus=layerFocus(project,key);if(!focus)return;if(focus.pageId)pageId=focus.pageId;else{const entry=viewport.getMode()==='continuous'?viewport.hitTest({x:640,y:focus.y-(viewState?documentView(project,viewState).offset:0)}):null;if(entry&&!entry.page.fixedEpisodeBoard)pageId=entry.pageId;}renderCanvas();viewport.scrollToY(Math.max(0,focus.y-(viewState?documentView(project,viewState).offset:0)-50));}
function select(type,value,targetPageId=null,{scroll=false,inspector=false,preserveView=false,additive=false}={}){if(episodeAssetsUI?.active)episodeAssetsUI.close(false);episodeBoardUI?.close({render:false});
 const layer=findLayer(project,value);if(!layer)return;if(layer.type==='bubble'||layer.item.cutoutLayer){const owner=groupForLayer(project,value);if(owner)groupExpansion.set(owner.id,true);}
 if(!preserveView&&layer.pageId)pageId=layer.pageId;
 const keys=additive?new Set(selectedLayerIds):new Set();if(additive&&keys.has(value))keys.delete(value);else keys.add(value);
  setSelectionKeys(keys);if(selectedLayerIds.size>1)tool='move';nodeIndex=0;renderCanvas();renderSidebar();revealSelectedLayer();renderInspector();if(quickTarget())responsiveUI.openCanvasTools();if(scroll&&selection)locateLayer(selection.id);if(inspector||(window.innerWidth>1000&&!document.body.classList.contains('repair-workspace-active')))workbench.openInspector();
}

function modal(title,markup,actions){$('#modal-title').textContent=title;$('#modal-body').innerHTML=markup;$('#modal-actions').replaceChildren();for(const action of actions){const button=document.createElement('button');button.textContent=action.label;button.className=action.primary?'primary':'';button.addEventListener('click',safely(async()=>{await action.run();}));$('#modal-actions').append(button);}$('#modal').showModal();}
const closeModal=()=>$('#modal').close();

async function acceptIntegratedProject(value,{poll=false,undoable=false}={}){
  if(project?.id!==value.id)return;
  if(!poll&&(dirty||hasLocalEditing()))poll=true;
  if(poll){
    if(saving)await saving.catch(()=>{});
    if(project?.id!==value.id)return;
    const decision=applyServerRevision(value);
    if(decision!=='conflict'&&conflictNotice===null&&value.revision>=project.revision){for(const key of ["productionAssets","assetLibrary"])if(value[key]!==undefined)project[key]=clone(value[key]);}
    if(dirty&&conflictNotice===null){clearTimeout(saveTimer);saveTimer=setTimeout(()=>saveNow().catch(error=>toast(error.message,true)),500);}
    return;
  }
  const previous=project;project=clone(value);setServerBase(value);conflictNotice=null;let externalAudit=null;if(previous?.layoutHistory){preserveLayoutHistory(previous,project);externalAudit=recordLayoutAdjustment(previous,project,{source:'unknown',operation:'external.update'});}else ensureLayoutHistory(project);projects=projects.map(p=>p.id===project.id?project:p);dirty=false;clearTimeout(saveTimer);let operationId=null;if(undoable){if(previous.revision!==value.revision){operationId=externalAudit?.record?.id||crypto.randomUUID();remember(layoutEditSnapshot(previous),operationId);}}else{history=[];future=[];invalidatedHistoryIds.clear();undoRevision++;}historyLocateBox=null;
  if(!project.pages.some(p=>p.id===pageId))pageId=project.pages[0]?.id;
  if(!selected())selection=null;
  await refreshState();render();$('#save-state').textContent='已保存';if(externalAudit?.record||externalAudit?.warning){showAuditWarning(externalAudit.warning);scheduleSave();}return operationId;
}
async function acceptImportedProject(value,{message='分镜已更新，已有图片与人工调整保留',refresh=true,deferRender=false,expectedRevision}={}){if(project?.id!==value.id){if(expectedRevision!==undefined)throw Error('作品已切换，接回结果已保存，未覆盖当前画布');return;}if(expectedRevision!==undefined&&(project.revision!==expectedRevision||dirty||saving||hasLocalEditing()))throw Error('接回期间本窗口有修改，服务器结果已保存；本地修改保留，请先核对再载入');episodeBoardUI?.close({render:false});const before=layoutEditSnapshot(project);project=clone(value);const upgradeLettering=project.autoLetteringUpgradeVersion!==AUTO_LETTERING_VERSION;project.autoLetteringUpgradeVersion=AUTO_LETTERING_VERSION;const appearancePending=project.bubbleAppearanceVersion!==BUBBLE_APPEARANCE_VERSION;project.bubbleAppearanceVersion=BUBBLE_APPEARANCE_VERSION;const appearance=appearancePending?repairLegacyBubbleAppearance(project):{changed:0},lettering=reflowProjectLettering(measurement,project,{onlyRequested:true});if(!project.pages.some(page=>page.id===pageId))pageId=project.pages[0]?.id;selection=null;selectedLayerIds.clear();setServerBase(value);dirty=false;clearTimeout(saveTimer);remember(before);if(lettering.changed||upgradeLettering||appearance.changed||appearancePending)scheduleSave();projects=projects.map(item=>item.id===project.id?project:item);if(refresh)await refreshState();if(!deferRender)render();if(message)toast(message);}


episodeBoardUI=mountEpisodeBoards({getProject:()=>project,getAssets:()=>assets,getPage:()=>page(),edit,onRender:render,onPreview:renderCanvas,onLocate:kind=>viewport.scrollToPage('fixed-'+kind+'-'+project.id),openInspector:()=>workbench.openInspector(),onUpload:async(file,target)=>{const dataUrl=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('无法读取图片'));reader.readAsDataURL(file);});const {asset}=await api('/api/episode-board-images','POST',{projectId:target.projectId,name:file.name||'粘贴图片',dataBase64:dataUrl.split(',')[1]});mergeImageAssets([asset]);return asset;},toast,measurement,onEpisode:async number=>{const kind=episodeBoardUI.kind;await switchEpisode(number);episodeBoardUI.open(kind);},onBackground:({onApply})=>libraryUI.open({kind:'image',onSelect:onApply})});
$('#storyboard-import').onclick=safely(openProjectFile);
$('#storyboard-import-empty').onclick=safely(openProjectFile);
$('#storyboard-import').innerHTML='<span class="wide-import-label">导入工程文件</span><span class="compact-import-label" aria-hidden="true">导入</span>';
$('#storyboard-import').setAttribute('aria-label','导入工程文件');






function renderProjectPicker(){
 const current=project?.id;$('#project-select').innerHTML=projects.map(p=>`<option value="${p.id}" ${p.id===current?'selected':''}>${escape(p.title)}</option>`).join('')||'<option value="">暂无项目</option>';$('#project-select').disabled=!projects.length;
 $('#close-project').disabled=!project;$('#project-label').textContent=project?.title||'选择 / 新建漫画';$('#project-trigger').title=project?.title||'项目菜单';
 $('#project-choices').innerHTML=projects.map(p=>`<button data-choose-project="${p.id}" class="${p.id===current?'active':''}">${escape(p.title)}</button>`).join('')||'<p class="sub-note">暂无项目</p>';
}
function syncEpisodePicker(){
 const host=$('#episode-workspace');host.hidden=!project;
 if(!project)return;
 const number=currentBoardEpisode(project,page()),catalog=episodeCatalog(project),pages=episodePages(project,page()),count=pages.reduce((sum,p)=>sum+p.panels.length,0);
 $('#episode-select').innerHTML=catalog.map(entry=>`<option value="${entry.episode}" ${entry.episode===number?'selected':''}>第${entry.episode}话${entry.title?' · '+escape(entry.title):''}</option>`).join('');
 const productionEpisode=project.productionPackage?.episodes.find(e=>e.episode===number);$('#episode-status').textContent=productionEpisode?(['single-mode-20261027','post-lettering-20261027'].includes(project.productionPackage.sourceFormat)?productionEpisode.panelRecords.length+' 单格 · '+pages.length+' 个正文画板':productionEpisode.segments.length+' 屏段 · '+productionEpisode.panelRecords.length+' 格 · '+pages.length+' 个正文画板'):count?count+' 格 · '+pages.length+' 个正文画板':'待导入制作资料';
 localStorage.setItem('comic-active-episode:'+project.id,String(number));
}
async function switchEpisode(number,{deferRender=false}={}){
 if(!project)return;
 if(drag||bubbleGesture||paintBefore||multiGesture||quickGesture)throw Error('请先完成当前拖动，再切换话数');
 await flushSave();let target=project.pages.find(p=>pageEpisode(project,p)===number);if(!target&&project.autoLayoutSource?.mode==='screen-crop-reflow'&&project.autoLayoutSource.sourceProjectId){const source=await api('/api/projects/'+project.autoLayoutSource.sourceProjectId);target=source.pages.find(p=>pageEpisode(source,p)===number);if(!target)throw Error('来源工程中这一话还没有正文画板');await chooseProject(source,{alreadyLoaded:true});target=project.pages.find(p=>p.id===target.id);toast('已回到来源工程的第'+number+'话；成图重排工程已保留');}if(!target)throw Error('这一话还没有正文画板');
 episodeBoardUI.close({render:false});stripSpaceUI?.cancel({repaint:false});quickUI?.finish();pageId=target.id;selection=null;selectedLayerIds.clear();selectionMarker=null;historyLocateBox=null;nodeIndex=0;tool='move';if(!deferRender){render();viewport.scrollToPage(pageId);}
}
$('#episode-select').addEventListener('change',safely(event=>switchEpisode(Number(event.target.value))));
function renderEmptyProject(){quickUI?.sync();
  speakerUI?.hide();
  viewport.set({pages:[],decorations:null,currentPageId:null,zoom:1});stage.innerHTML='';canvasLayerOrderUI.sync();
  for(const name of ['page-list','layer-list','shot-list','reference-list','inspector-body'])$('#'+name).replaceChildren();

  $('#page-marker').textContent='暂无页面';$('#image-context').hidden=true;$('#inspector-title').textContent='';$('#page-heading').textContent='暂无项目';$('#page-width-label').textContent='宽 1280 px';$('#page-height-input').value='';
  const modeHint=document.querySelector('#canvas-tool-dock .canvas-tool-content');if(modeHint)modeHint.title=selection?.type==='bubble'?'拖动对白移动；拖动文字框节点调整换行；双击编辑内容':{move:selected()?.proportionalResize!==false?'选择：拖动移动整组；等比已开，边角缩放整组':'选择：拖动移动整组；等比已关，边角自由调整框宽高',rect:'格子：方形柄改框大小，圆点标示原轮廓；图片保持原位',image:'图片：拖动移动画面，拖四角缩放图片，格子边框不变',nodes:'轮廓：拖动节点编辑画格形状'}[tool]||'选中图层后进行编辑';
  $('#tool-hint').textContent='新建或恢复项目后开始编辑';$('#selection-status').textContent='';renderJobs();
}
function syncEmptyProject(){const empty=!project||!episodePages(project,page()).some(page=>page.panels.length||page.bubbles.length);$('#empty-project').hidden=!!episodeBoardUI?.active||!empty;$('#empty-project strong').textContent='导入工程文件';$('#empty-project span').textContent='';}
function showAuditWarning(){}
function syncAuditWarning(){const button=$('#layout-history-paused');button.hidden=true;historyStepsUI?.refresh();}
function render(){referenceReviewButton.disabled=!project||!!episodeBoardUI?.active;episodeBoardUI?.sync();if(project){if(!project.episodeBoards){ensureEpisodeBoards(project);scheduleSave();}ensureProjectPanelGeneration(project,assets);}syncAuditWarning();
  $('#export-page').textContent=episodeBoardUI?.active?'当前'+(episodeBoardUI.kind==='cover'?'封面':'尾图')+' PNG':'当前长图 PNG';$('#export-layout').disabled=!!episodeBoardUI?.active;
  updateImageLayerActions();
  renderProjectPicker();syncEpisodePicker();syncEmptyProject();$('#add-page').hidden=false;
  $('.inspector').inert=!project;
  $('#sidebar-empty-note').hidden=!!project;
  for(const button of document.querySelectorAll('.tools button:not([data-image-layer-action]),.dock-primary-tools button'))button.disabled=!project;
  for(const control of document.querySelectorAll('#add-page,#layers-toggle,#auto-locate-layer,#layer-search,#layer-scope,#layer-add,#dialogue-tools-toggle,#layer-add-gradient,#layer-stack-up,#layer-stack-down,#layer-delete,#layers-tab [data-open-sfx],#asset-directory,#add-reference,#add-shot,#inspector-toggle'))control.disabled=!project;
  $('#page-marker').disabled=!project||!!episodeBoardUI?.active;$('#export-toggle').disabled=!project;$('#history-steps-toggle').disabled=!project;$('#layout-adjustments').disabled=!project;$('#save-project').disabled=!project;$('#export-menu').hidden=true;
  if(!project){renderEmptyProject();$('#undo').disabled=true;$('#redo').disabled=true;return;}
  renderSidebar();renderCanvas();renderInspector();renderJobs();dialoguePlacementUI?.sync();refreshHistoryButtons();syncNodeActions();document.querySelectorAll('[data-frame-modes]').forEach(el=>{el.hidden=!['rect','nodes'].includes(tool);});document.querySelectorAll('[data-tool]').forEach(button=>{button.classList.toggle('active',button.dataset.tool===tool);button.setAttribute('aria-pressed',String(button.dataset.tool===tool));});}
function renderSidebar(){
  productionUI.refresh();referenceResultsUI.refresh();episodeAssetsUI?.refresh();
  if(!project)return;
  syncEpisodePicker();const fixedCards=episodeBoardUI.cards(),pages=episodePages(project,page());$('#page-list').innerHTML=fixedCards.cover+pages.map((p,i)=>`<button class="page-card ${!episodeBoardUI.active&&p.id===pageId?'active':''}" data-page="${p.id}"><span class="page-thumb">${p.panels.filter(f=>f.visible).map(f=>`<i style="left:${f.x/p.width*100}%;top:${f.y/p.height*100}%;width:${f.w/p.width*100}%;height:${f.h/p.height*100}%"></i>`).join('')}</span><span>${pages.length===1?'正文长图':escape(p.name)}<div class="count">${p.panels.length?p.panels.filter(f=>f.visible!==false&&!f.cutoutLayer&&!f.productionBackground&&!f.productionBackgroundInstance).length+' 格 · 本话 '+(i+1)+'/'+pages.length:'待导入排版JSON'}</div></span></button>`).join('')+fixedCards.tail;
  renderLayerList();
  $('#shot-list').innerHTML=episodeShots(project,page()).map(s=>`<button class="shot-card" data-shot="${s.id}">${escape(s.code)} · ${escape(s.title)}<small>${escape(s.description.slice(0,75))}</small></button>`).join('');
  renderReferences();
}
function renderReferences(){const roles={character:'角色',scene:'场景',style:'画风',prop:'道具'};$('#reference-list').innerHTML=project.references.map(ref=>`<div class="reference-card"><button class="quiet" data-view-ref="${ref.assetId}" style="width:100%">查看图片 · ${escape(ref.name)}</button><input value="${escape(ref.name)}" data-ref-name="${ref.assetId}" aria-label="参考图名称"><div class="ref-controls"><select data-ref-role="${ref.assetId}" aria-label="参考图类型">${Object.entries(roles).map(([role,label])=>`<option value="${role}" ${role===ref.role?'selected':''}>${label}</option>`).join('')}</select><button data-remove-ref="${ref.assetId}">移除</button></div></div>`).join('')||'<p class="sub-note">从墨库添加角色、场景或画风参考，所有镜头可以共用。</p>';}
function svgBubble(bubble,effectiveZoom){return svgBubbleMarkup(measurement,bubble,{selected:false,zoom:effectiveZoom});}
function syncZoomChoice(value){
  const input=$('#zoom');
  let option=[...input.options].find(item=>Number(item.value)===value);
  if(!option){
    option=input.querySelector('[data-wheel-zoom]');
    if(!option){option=document.createElement('option');option.dataset.wheelZoom='true';input.append(option);}
    option.value=String(value);option.textContent=new Intl.NumberFormat('zh-CN',{maximumSignificantDigits:4}).format(value*100)+'%';
  }
  input.value=option.value;localStorage.setItem('comic-zoom-choice',input.value);
}
const frameStatusUI=mountFrameGenerationStatus({wrap:$('.canvas-wrap'),stage,escape,getState:()=>({project,jobs,submitting,pageIds:project&&page()?episodePages(project,page()).map(p=>p.id):[],fixed:!!episodeBoardUI?.active,layout:viewState?.layout,offset:project&&viewState&&!episodeBoardUI?.active&&viewState.layout.pages.some(e=>project.pages.some(p=>p.id===e.pageId))?documentView(project,viewState).offset:0,onChange:()=>renderCanvas()})});
const canvasLayerOrderUI=mountCanvasLayerOrder({wrap:$('.canvas-wrap'),scroll:$('#canvas-scroll'),stage,getState:()=>({project,keys:[...selectedLayerIds],fixed:!!episodeBoardUI?.active,busy:!!(drag||bubbleGesture||paintBefore||multiGesture||quickGesture),box:project&&selectedLayerIds.size===1?selectionDocumentBox(project,selectedLayerIds,measurement):null,offset:project&&viewState?documentView(project,viewState).offset:0}),onMove:moveCurrentLayerOrder});
const canvasGenerateButton=document.createElement('button');canvasGenerateButton.id='canvas-generate-current-panel';canvasGenerateButton.type='button';canvasGenerateButton.innerHTML='<b aria-hidden="true">✦</b><span data-generation-label>生成本格图片</span>';canvasGenerateButton.addEventListener('click',safely(generateCurrentPanel));canvasLayerOrderUI.addAction(canvasGenerateButton,{visible:state=>{const entry=findLayer(state.project,state.keys[0]);return entry?.type==='panel'&&!entry.item.cutoutLayer&&!entry.item.sfxImage&&!entry.item.breakoutForeground;}});
const panelReferencePreviewUI=mountPanelReferencePreview({toolbar:canvasLayerOrderUI,getState:()=>{const entry=project&&selectedLayerIds.size===1?findLayer(project,[...selectedLayerIds][0]):null;return {project,panel:entry?.type==='panel'&&!entry.item.cutoutLayer&&!entry.item.sfxImage&&!entry.item.breakoutForeground&&!entry.item.designDecoration?entry.item:null,assets,fixed:!!episodeBoardUI?.active};}});
const canvasPanelCancel=mountCanvasPanelCancel({toolbar:canvasLayerOrderUI,getState:()=>({project,jobs,keys:[...selectedLayerIds],fixed:!!episodeBoardUI?.active}),api,refresh:refreshState,onMessage:message=>toast(message),onError:error=>toast(error.message,true)});
function moveCurrentLayerOrder(direction){
 quickUI?.finish();if(!project||episodeBoardUI?.active||selectedLayerIds.size!==1||drag||bubbleGesture||paintBefore||multiGesture)return;
 const key=[...selectedLayerIds][0],state=layerOrderAvailability(project,key);if(!(direction>0?state.up:state.down))return;
 edit(()=>moveGroupedLayer(project,key,direction),{operation:'layers.order'});
}
function renderCanvas(state=null){
  panelReferencePreviewUI.sync();
  integratedWorkspace?.sync();
  novelSourcePanel?.refresh();
  refreshGenerationShortcuts();if(!project||episodeBoardUI?.active)canvasLayerOrderUI.sync();
  const notesToggle=$('#panel-notes-toggle');notesToggle.setAttribute('aria-pressed',String(showPanelNotes));notesToggle.setAttribute('aria-label',showPanelNotes?'隐藏全部格内提示词':'显示全部格内提示词');notesToggle.title=showPanelNotes?'批量隐藏所有画板格子中的提示词和原剧情':'批量显示所有画板格子中的提示词和原剧情';notesToggle.querySelector('img').src=showPanelNotes?'/icons/eye-off.svg':'/icons/eye.svg';notesToggle.querySelector('span').textContent=showPanelNotes?'隐藏格内信息':'显示格内信息';notesToggle.setAttribute('aria-label',showPanelNotes?'隐藏格内信息':'显示格内信息');notesToggle.title=(showPanelNotes?'隐藏':'显示')+'所有画格的'+PANEL_DISPLAY_MODES[panelDisplayMode];panelDisplaySelect.disabled=!project;
  syncEmptyProject();
  const compositionElement=document.querySelector('[data-panel-composition]'),compositionPanel=selection?.type==='panel'?selected():null;
  if(compositionElement&&compositionPanel){const c=panelComposition(compositionPanel);compositionElement.querySelector('strong').textContent=panelRoleLabel(project,compositionPanel)+' · '+c.label+' · 宽:高 '+c.ratioText;compositionElement.querySelector('span').textContent=Math.round(c.width)+' × '+Math.round(c.height)+' px';compositionElement.querySelector('p').textContent=compositionDirection(compositionPanel);}
  syncSelectionKeys();
  updateImageLayerActions();
  $('#panel-info-toggle').setAttribute('aria-pressed',String(showPanelInfo));$('#panel-info-toggle').textContent=showPanelInfo?'隐藏图片上的说明':'显示图片上的说明';
  if(!state?.layout||!state?.window)state=null;
  stripSpaceUI?.sync();
  if(!project||!page()){panelInfoUI.render([],false);frameStatusUI.render();return;}const displayProject=repairCompare?.project(stripSpaceUI?.previewProject||project)||(stripSpaceUI?.previewProject||project),p=displayProject.pages.find(p=>p.id===pageId)||displayProject.pages[0],mode=viewport.getMode(),displayWidth=mode==='continuous'?COMIC_PAGE_WIDTH:p.width,availableWidth=Math.max(80,$('#canvas-scroll').clientWidth-50),availableHeight=Math.max(80,$('#canvas-scroll').clientHeight-50),choice=$('#zoom').value;
  zoom=choice==='page'?Math.max(Number.MIN_VALUE,Math.min(availableWidth/displayWidth,availableHeight/(p.height*(mode==='continuous'?COMIC_PAGE_WIDTH/p.width:1)))):choice==='fit'?availableWidth/displayWidth:Number(choice);
  const displayedPages=episodePages(displayProject,p),scopedProject=episodeLayerProject(displayProject,p),episodeLayerIds=new Set(allLayers(scopedProject).map(entry=>entry.item.id));
  const hiddenLayerIds=new Set();
  if(displayProject.productionPackage){const frames=displayProject.pages.flatMap(pg=>pg.panels),sources=displayProject.pages.filter(pg=>!displayProject.productionEpisodeViews?.[pg.storyboard?.episode]&&productionEpisodeUnit(displayProject,pg.storyboard?.episode)==='panel').flatMap(pg=>pg.panels).filter(f=>f.productionGrid).map(f=>f.productionGrid),segments=new Set(sources.map(s=>s.segmentId));for(const source of sources)hiddenLayerIds.add(source.rootPanelId);for(const f of frames)if(segments.has(f.productionBackground?.replace(/-BG$/,'')))hiddenLayerIds.add(f.id);for(const f of frames)if(hiddenLayerIds.has(f.cutoutLayer?.parentPanelId))hiddenLayerIds.add(f.id);}
  const decorations=canvasEpisodeBoards(displayProject,p,assets,{hiddenLayerIds,episodeLayerIds,draft:draftMode});
  state=viewport.set({pages:displayedPages,decorations,currentPageId:pageId,zoom:state?.zoom||zoom});state.episodePageIds=new Set(displayedPages.map(page=>page.id));state.episodeLayerIds=episodeLayerIds;state.fixedBoardSelection=episodeBoardUI?.selection;viewState=state;zoom=state.zoom;
  const safetyProjectId=displayProject.id;for(const kind of ['cover','tail']){const board=state.decorations?.[kind]?.board,checking=board&&requestBoardTransitionSafety(board,{imageLoader:loadImage});if(checking)void checking.then(()=>{if(project?.id===safetyProjectId)renderCanvas();});}

  const scene=renderSceneSvg(displayProject,state,{assets:assetMap(),missingAssets:missingImageAssets,hiddenLayerIds,measurement,selection:tool==='insert-space'||selectedLayerIds.size>1||selectionBox?null:selection,selectionIds:selectedLayerIds.size>1||selectionBox?selectedLayerIds:null,selectionBox,showPanelInfo,panelInfoLayer:true,panelDisplayMode,panelNotesVisible:showPanelNotes,tool,nodeIndex,draft:draftMode,brush,brushCursor,escape,shotFor,activeJob});
  stage.innerHTML=`<defs>${scene.defs}</defs>${scene.content}${historyLocateMarkup(state)}${stripSpaceUI?.markup(state)||''}`;stage.dataset.paintMode=tool;dialoguePlacementUI?.refreshPreview();frameStatusUI.render();panelInfoUI.render(scene.panelInfos,selection?.type!=='gradient'&&tool!=='mask'&&showPanelNotes&&(showPanelInfo||scene.panelInfos.some(info=>info.placeholder)));
  $('#page-heading').textContent='第'+currentBoardEpisode(project,p)+'话 · '+(state.mode==='continuous'?'连续长图 · ':'')+displayedPages.length+' 个正文画板';
  $('#page-marker').textContent='第'+currentBoardEpisode(project,p)+'话 · P'+String(displayedPages.findIndex(real=>real.id===p.id)+1).padStart(3,'0')+' / '+displayedPages.length;
  if(episodeBoardUI?.active)$('#page-marker').textContent='第'+episodeBoardUI.episode+'话 · '+(episodeBoardUI.kind==='cover'?'封面':'尾图')+' · 连续画布';
  $('#image-context').hidden=true;
  $('#panel-tool-toggle')?.classList.toggle('active',tool==='mask');
  $('#gradient-tool').classList.toggle('active',tool==='gradient');
  $('#page-settings').classList.toggle('active',!selection);
  $('#page-width-label').textContent=`宽 ${p.width} px${p.width!==COMIC_PAGE_WIDTH?' · 旧页':''}`;
  if(document.activeElement!==$('#page-height-input'))$('#page-height-input').value=p.height;
  const modeHint=document.querySelector('#canvas-tool-dock .canvas-tool-content');if(modeHint)modeHint.title=selection?.type==='bubble'?'拖动对白移动；拖动文字框节点调整换行；双击编辑内容':{move:selected()?.proportionalResize!==false?'选择：拖动移动整组；等比已开，边角缩放整组':'选择：拖动移动整组；等比已关，边角自由调整框宽高',rect:'格子：方形柄改框大小，圆点标示原轮廓；图片保持原位',image:'图片：拖动移动画面，拖四角缩放图片，格子边框不变',nodes:'轮廓：拖动节点编辑画格形状'}[tool]||'选中图层后进行编辑';
  $('#tool-hint').textContent=tool==='insert-space'?'在格子间横向画线 · 自动取色并插入底图 · Esc 取消':isLibrarySfx(selected())?'拖动特效字移动 · 右下角缩放 · 上方圆点旋转':selection?.type==='bubble'?'拖动气泡移动整体 · 虚框节点编辑文字区域和尾尖':{move:'拖动移动整组 · 边角等比缩放格子和画面 · 方向键微调',nodes:'拖动圆点改轮廓 · 点击边线加点',rect:'拖动四角调整矩形 · 图片保持独立',image:'拖动图片移动画面 · 拖动图片四角缩放 · 格子边框保持不动',mask:'蒙版画笔 · 擦除 / 恢复画面 · Ctrl + Z 撤销',gradient:'从起点拖到终点设置渐变，也可拖动两端节点'}[tool];
  const frame=selection?.type==='panel'?selected():null;
  $('#selection-status').textContent=frame?`${shotFor(frame)?.code||'格子'} · ${frame.points.length} 个节点${frame.locked?' · 已锁定':''}`:selection?.type==='bubble'?'对白图层':'';
  syncNodeActions();document.querySelectorAll('[data-frame-modes]').forEach(el=>{el.hidden=!['rect','nodes'].includes(tool);});document.querySelectorAll('[data-tool]').forEach(button=>{button.classList.toggle('active',button.dataset.tool===tool);button.setAttribute('aria-pressed',String(button.dataset.tool===tool));});
  speakerUI?.refresh();quickUI?.sync();canvasLayerOrderUI.sync();refreshHistoryButtons();
}
const numberField=(label,key,value,section='panel',min=-Number.MAX_SAFE_INTEGER,max=null,step=1)=>`<label>${label}<input type="number" data-field="${key}" data-section="${section}" value="${formatInputNumber(value)}"${Number.isFinite(min)?` min="${min}"`:''}${Number.isFinite(max)?` max="${max}"`:''} step="${step}"></label>`;
function shotFields(shot){return `<h3>镜头内容</h3><div class="field-grid"><label>镜头编号<input data-section="shot" data-field="code" value="${escape(shot.code)}" maxlength="80"></label><label>镜头名称<input data-section="shot" data-field="title" value="${escape(shot.title)}" maxlength="180"></label></div><label>画面描述<textarea data-section="shot" data-field="description" rows="5">${escape(shot.description)}</textarea></label><label>对白（独立文字）<textarea data-section="shot" data-field="dialogue" rows="2" ${shot.storyboard?'readonly title="原文对白已审定，可在分镜审核中建立新版本"':''}>${escape(shot.dialogue)}</textarea></label>`;}
function renderInspector(){
 finishInspectorDrafts();
 if(episodeAssetsUI?.active){episodeAssetsUI.refresh();return;}
 if(episodeBoardUI?.active){episodeBoardUI.inspector();return;}
 if(!project)return;syncSelectionKeys();if(selectedLayerIds.size>1){renderMultiInspector();return;}const item=selected(),type=selection?.type,body=$('#inspector-body'),key=item?.id||'page_'+pageId,same=body.dataset.inspectorKey===key;
 const inspectorView=panelInspectorView(body),bubbleView=bubbleInspectorView(body),styleScroll=body.querySelector('[data-bubble-style-grid]')?.scrollTop||0,details=new Map([...body.querySelectorAll('details[data-inspector-section]')].map(d=>[d.dataset.inspectorSection,d.open]));
 $('#inspector-panel').classList.toggle('panel-properties-active',type==='panel'&&!item?.sfxImage&&!item?.breakoutForeground&&!item?.cutoutLayer);
 $('#delete-layer').disabled=!item;
 $('#inspector-kind').textContent=item?.stripSpace?'插入底图':type==='gradient'?'渐变图层':isSfxImage(item)?'冲刺线图片':isLibrarySfx(item)?'特效文字':type==='bubble'?'对白属性':item?'格子属性':'页面设置';
 $('#inspector-title').textContent=type==='gradient'?item?.name||'':isSfxImage(item)?'独立图片图层':isLibrarySfx(item)?'独立特效文字图层':type==='bubble'?'独立对白图层':item?projectFrameName(project,item):page().name;
 if(!item){
   body.innerHTML=`<div class="common-inspector"><label>长图名称<input data-section="page" data-field="name" value="${escape(page().name)}"></label>${numberField('页面长度 px','height',page().height,'page',1)}<label>页面底色<input type="color" data-section="page" data-field="background" value="${page().background}"></label><p class="sub-note">宽度 ${page().width} px · 调整长度保留图层位置。</p></div><details class="inspector-section" data-inspector-section="page-more"><summary>更多设置</summary><section class="project-art-style"><label>统一画风 · 后续生图<textarea data-section="project" data-field="style" rows="5" placeholder="例如：二维国漫，清晰手绘线条，赛璐璐上色，柔和暖光">${escape(project.style)}</textarea></label><p>用于本工程所有话的后续生图。人物、服装和剧情不变；分镜及参考图中的画风与此设置冲突时，以这里为准。</p><button type="button" data-action="apply-art-style" class="wide primary">应用统一画风</button><output data-art-style-status>${project.style?'后续生图已启用此画风':'尚未设置，沿用分镜与参考画风'}</output></section><button data-action="rename-project" class="wide">修改项目名称</button><button data-action="delete-page" class="wide page-danger" ${episodePages(project,page()).length<=1?'disabled':''}>删除当前长图</button></details>`;
 }else if(type==='gradient'&&item.stripSpace){
   body.innerHTML=`<div class="common-inspector"><label>底图名称<input data-section="gradient-layer" data-field="name" value="${escape(item.name)}" maxlength="120"></label><div class="field-grid"><label>留白高度 px<input data-space-edit-height type="number" min="1" max="${MAX_SPACE_HEIGHT}" step="1" value="${item.h}" ${item.locked?'disabled':''}></label><label>底图颜色<input data-space-edit-color type="color" value="${item.gradient.startColor}" ${item.locked?'disabled':''}></label></div><p class="inserted-space-note">位置 ${Math.round(item.y)} px · 宽 1280 px。修改高度时，下方画格、对白和底色一起移动。</p><label class="checkbox-field"><input type="checkbox" data-section="gradient-layer" data-field="locked" ${item.locked?'checked':''}>锁定底图</label><button data-action="remove-strip-space" class="wide page-danger" ${item.locked?'disabled':''}>删除底图并收起留白</button></div>`;
 }else if(type==='gradient'){body.innerHTML=gradientInspectorMarkup(gradientFrame(item,layoutLongStrip(project.pages)),{numberField,tool,layout:layoutLongStrip(project.pages)});
 }else if(isSfxImage(item)){body.innerHTML=sfxImageInspector(item,{escape,numberField,page:selectionOwner(),asset:assetMap().get(item.imageAssetId)});
 }else if(type==='bubble'){
   body.innerHTML=bubbleInspectorMarkup(item,{escape,numberField,nodeIndex,layout:bubbleLayout(measurement,item),page:selectionOwner(),project,assets});
 }else{
   nodeIndex=clamp(nodeIndex,0,item.points.length-1);
   body.innerHTML=panelInspectorMarkup(item,{escape,numberField,frameShapeUI,shots:project.shots,shot:shotFor(item),nodeIndex,providerLabel:providerLabel(),pending:!!activeJob(item)||submitting.has(item.id),project,assets,pageWidth:selectionOwner().width,brush,tool});
 }
 if(!item)paintTypographyPreview(body,'page-type');
 body.dataset.inspectorKey=key;
 const styleGrid=body.querySelector('[data-bubble-style-grid]');
 if(styleGrid){if(same)styleGrid.scrollTop=styleScroll;else{const chosen=styleGrid.querySelector('[aria-pressed="true"]');if(chosen)styleGrid.scrollTop=chosen.offsetTop-styleGrid.offsetTop;}}
 if(!item&&project.productionPackage)body.insertAdjacentHTML('afterbegin',`<section class="episode-style-entry"><h3>整话字体与气泡</h3><p>第 ${currentBoardEpisode(project,page())} 话 · 统一调整已有台词和后续摆放样式</p><button type="button" class="wide primary" data-action="episode-bubble-styles">调整本话字体与气泡</button></section>`);
 if(type==='bubble'&&item?.storyboard){const field=body.querySelector('[data-field="text"]');if(field){field.readOnly=true;field.title='原文对白已审定；可调整气泡外观与位置';}}
 if(type==='panel'&&shotFor(item)?.storyboard){const field=body.querySelector('[data-field="dialogue"]');if(field){field.readOnly=true;field.title='原文对白已审定；修改需新分镜版本';}}
 if(same)for(const d of body.querySelectorAll('details[data-inspector-section]'))if(details.has(d.dataset.inspectorSection))d.open=details.get(d.dataset.inspectorSection);
 if(body.querySelector('[data-bubble-properties]')){showBubbleInspectorTab(body,bubbleView.tab);$('#inspector-panel').scrollTop=same?bubbleView.scroll:0;}
 if(body.querySelector('[data-panel-properties]')){
  showPanelInspectorTab(body,inspectorView.tab);
  if(item.locked)for(const input of body.querySelectorAll('[data-field],#shape-preset,#point-select'))if(input.dataset.field!=='locked')input.disabled=true;
  $('#inspector-panel').scrollTop=same?inspectorView.scroll:0;
 }
 const processButton=body.querySelector('[data-action="process-panel-references"]');if(processButton&&referenceProcessingPanels.has(item?.id)){processButton.disabled=true;processButton.textContent='正在处理参考…';}
 renderCandidates();paintReferenceGenerationTasks();void promptRewriteUI.refresh();
}
mountPanelInspectorNavigation($('#inspector-body'));
mountBubbleInspectorNavigation($('#inspector-body'));
$('#inspector-body').addEventListener('click',safely(event=>{
 const button=event.target.closest('[data-frame-template],[data-edit-frame-shape],[data-save-frame-shape],[data-delete-frame-shape],[data-saved-frame-shape],[data-frame-scale]');if(!button||button.disabled)return;if(button.dataset.deleteFrameShape){deleteSavedFrameShape(frameShapeUI.shapeLibrary,button.dataset.deleteFrameShape);renderInspector();toast('已删除自定义形状，已应用的画格保留');return;}const frame=selected();if(selection?.type!=='panel'||!frame||frame.locked)return;
 if(button.hasAttribute('data-save-frame-shape'))return openSaveFrameShape({library:frameShapeUI.shapeLibrary,getTarget:selected,modal,closeModal,escape,toast,onSaved:()=>renderInspector()});
 if(button.hasAttribute('data-edit-frame-shape')){tool='nodes';nodeIndex=0;renderCanvas();renderInspector();return;}
 if(button.hasAttribute('data-frame-scale')){const percent=button.dataset.frameScale==='input'?Number($('#inspector-body').querySelector('[data-frame-scale-percent]').value):Number(button.dataset.frameScale);const next=clone(frame);scaleFrameUniformly(next,percent/100,{pageWidth:selectionOwner().width});edit(()=>Object.assign(frame,next),{operation:'panel.uniform-scale'});return;}
 const shape=button.dataset.savedFrameShape?savedFrameShapes(frameShapeUI.shapeLibrary).find(s=>s.id===button.dataset.savedFrameShape):button.dataset.frameTemplate;if(!shape)throw Error('形状不存在');frameShapeUI.setShape(shape,frame);
}));
$('#inspector-body').addEventListener('change',safely(async event=>{if(!event.target.hasAttribute('data-panel-prompt-source'))return;try{await promptSourceUI.setCurrent(event.target.value);}finally{renderInspector();}}));
async function applySavedTypography(input,scope='project'){
 const targetId=project?.id;await flushSave();const state=await api('/api/state');const targets=scope==='all'?state.projects:state.projects.filter(value=>value.id===targetId);
 if(!targets.length)throw new Error('还没有可调整的已保存工程，请先保存当前试排');
 const current=targets.find(value=>value.id===targetId);if(current&&project?.id===targetId&&current.revision!==project.revision)throw new Error('当前工程已在其他窗口修改，请刷新后再统一字体');
 const before=project?layoutEditSnapshot(project):null;
 const result=await api('/api/projects/typography','POST',{...input,projectIds:targets.map(value=>value.id),expectedRevisions:Object.fromEntries(targets.map(value=>[value.id,value.revision]))});
 rememberTypography(input);projects=state.projects.map(value=>result.projects.find(saved=>saved.id===value.id)||value);
 const saved=result.projects.find(value=>value.id===targetId);if(saved&&project?.id===targetId){applyProjectTypography(project,input);project.revision=saved.revision;project.updated=saved.updated;syncEpisodeBoardRevision(saved,project);setServerBase(saved);commit(before,{source:'manual',operation:'typography.apply',inspector:true});await flushSave();}
 renderProjectPicker();if(project)render();toast('已统一 '+targets.length+' 个工程、'+result.changed+' 个文字层'+(result.locked?'；'+result.locked+' 个锁定文字保持原样':''));return result;
}
$('#inspector-body').addEventListener('input',event=>{if(!event.target.hasAttribute('data-typography-field'))return;try{syncTypographyInput($('#inspector-body'),'page-type',event.target);paintTypographyPreview($('#inspector-body'),'page-type');}catch{}});
$('#inspector-body').addEventListener('change',safely(event=>{if(event.target.hasAttribute('data-typography-field')){syncTypographyInput($('#inspector-body'),'page-type',event.target);paintTypographyPreview($('#inspector-body'),'page-type');}}));
$('#inspector-body').addEventListener('click',safely(async event=>{const b=event.target.closest('[data-action="generate-breakout"],[data-action="confirm-breakout"]');if(!b||b.disabled)return;const frame=selected();if(!frame||selection?.type!=='panel')return;const projectId=project.id,frameId=frame.id;await flushSave();if(project?.id!==projectId||selected()?.id!==frameId)return;const operation=b.dataset.action==='generate-breakout'?'generate':'confirm',result=await api('/api/projects/'+projectId+'/panels/'+frameId+'/breakout/'+operation,'POST',{revision:project.revision,provider:'codex',assetId:b.dataset.assetId});if(result.project)await acceptIntegratedProject(result.project);await refreshState();render();toast(operation==='generate'?'透明前景已排队，生成完成后请看图确认':'透明前景已加入独立图层');}));

$('#inspector-body').addEventListener('click',safely(async event=>{if(event.target.hasAttribute('data-typography-reset')){resetTypography($('#inspector-body'),'page-type');return;}if(event.target.hasAttribute('data-typography-apply'))await applySavedTypography(readTypography($('#inspector-body'),'page-type'),$('#page-type-scope').value);}));


const providerLabel=()=>generationProvider==='jimeng'?'即梦':'Codex';
function currentPanelGenerationState(){
 if(project?.autoLayoutSource?.mode==='screen-crop-reflow')return {disabled:true,pending:false,reason:'成图重排工程仅复用已有图片，不重新生图'};
 const frame=project&&!episodeBoardUI?.active&&selection?.type==='panel'&&selectedLayerIds.size<=1?selected():null;
 if(frame&&(scheduler.episodeBatches||[]).some(p=>p.projectId===project.id&&p.active&&p.pendingPanelIds?.includes(frame.id)))return {disabled:true,pending:true,reason:'已加入自动批次'};
 return panelGenerationAvailability(frame,jobs,submitting,project);
}
function refreshGenerationShortcuts(){
 promptSourceUI?.refresh();
 const inspectorSource=$('#inspector-body').querySelector('[data-panel-prompt-source]'),promptState=promptSourceUI?.currentState();if(inspectorSource&&promptState){inspectorSource.value=promptState.source;inspectorSource.disabled=promptState.disabled;}
 const state=currentPanelGenerationState();for(const button of document.querySelectorAll('#generate-current-panel,#canvas-generate-current-panel,[data-action="generate-current-panel"]')){button.disabled=state.disabled;(button.querySelector('[data-generation-label]')||button).textContent=state.pending?state.reason:'生成本格图片';button.title=state.reason||'使用'+providerLabel()+'，按当前画格宽高与提示词生成；已有图片可在候选中查看';button.setAttribute('aria-busy',String(state.pending));}
 canvasPanelCancel.sync();
 const reason=$('#inspector-body').querySelector('[data-panel-generation-status]');if(reason){reason.textContent=state.disabled?state.reason:'';reason.hidden=!state.disabled;}
 const ids=project&&!episodeBoardUI?.active?episodeGenerationPanelIds(project,page(),jobs,submitting):[],episode=project?currentBoardEpisode(project,page()):null;
 const generateEpisodeButton=$('#generate-current-episode');generateEpisodeButton.disabled=!ids.length||!!(scheduler.episodeBatches||[]).find(p=>p.projectId===project?.id&&p.episode===episode&&p.active);generateEpisodeButton.textContent=generateEpisodeButton.disabled&&ids.length?'本话正在自动提交':'生成本话缺图';generateEpisodeButton.title=project?'仅生成第'+episode+'话的 '+ids.length+' 个缺图画格；按并发数自动分批，每批结束后随机间隔 1–3 分钟':'请先导入或新建漫画工程';
 const paused=scheduler?.pausedUntil&&scheduler.pausedUntil>Date.now()?' · 账号限流，队列暂停到 '+new Date(scheduler.pausedUntil).toLocaleTimeString('zh-CN',{hour12:false})+' 自动继续':'';
 $('#generation-scope-status').textContent=(!project?'请先导入或新建漫画工程':episodeBoardUI?.active?'已选中'+(episodeBoardUI.kind==='cover'?'封面':'尾图')+' · 点击正文画格继续编辑':'第'+episode+'话 · '+ids.length+' 格缺图可生成 · '+providerLabel())+paused;
}
async function generateCurrentPanel(){
 quickUI?.finish();const state=currentPanelGenerationState();if(state.disabled)throw Error(state.reason);
 const frame=selected(),episode=currentBoardEpisode(project,page());
 await generateFrames([frame.id],'generate','',()=>{if(episodeBoardUI?.active||currentBoardEpisode(project,page())!==episode)throw Error('当前话已切换，请重新发起本格生成');});
}
async function generateCurrentEpisode(){
 quickUI?.finish();if(!project||episodeBoardUI?.active)throw Error('请先返回当前话的正文画格');
 const projectId=project.id,provider=generationProvider,episode=currentBoardEpisode(project,page()),ids=episodeGenerationPanelIds(project,page(),jobs,submitting);
 if(!ids.length)throw Error('本话没有可生成的缺图格子');
 if(document.querySelector('[data-generation-confirmation]'))return;
 const approved=await confirmGeneration({title:'生成第'+episode+'话缺图？',message:'将生成本话 '+ids.length+' 个缺图画格，使用 '+providerLabel()+'。已有图片、锁定格及其他话保持不变。',confirmLabel:'确认生成 '+ids.length+' 格'});
 if(!approved)return;
 const verifyEpisode=()=>{if(project?.id!==projectId||generationProvider!==provider||episodeBoardUI?.active||currentBoardEpisode(project,page())!==episode)throw Error('项目、话或生成渠道已切换，请重新发起本话生成');};verifyEpisode();
 const available=new Set(episodeGenerationPanelIds(project,page(),jobs,submitting)),remaining=ids.filter(id=>available.has(id));if(!remaining.length)throw Error('本话缺图已处理，无需重复生成');
 await generateFrames(remaining,'generate','',verifyEpisode,{episode,pageId:page().id});
}
function updateConnectionLabel(){
 codexConnectionUI?.update(status);
}
function currentJimengMode(){return jimengModels.find(m=>m.model===generationModel)?.modes?.find(m=>m.name===generationMode);}
function renderGenerationControls(){
  $('#generation-provider').value=generationProvider;$('#jimeng-options').hidden=generationProvider!=='jimeng';updateConnectionLabel();
  const selectedModel=jimengModels.find(m=>m.model===generationModel);$('#generation-model').innerHTML=jimengModels.length?jimengModels.map(model=>`<option value="${escape(model.model)}" ${model.model===generationModel?'selected':''}>${escape(model.name||model.displayName||model.model)}</option>`).join(''):`<option value="">${jimengStatus?.connected?'暂无可用模型':'登录后读取官方模型'}</option>`;
  $('#generation-model').disabled=!jimengModels.length;
  const modes=(selectedModel?.modes||[]).filter(mode=>['t2i','i2i'].includes(mode.name));$('#generation-mode').innerHTML=modes.length?modes.map(mode=>`<option value="${mode.name}" ${mode.name===generationMode?'selected':''}>${mode.name==='i2i'?'图生图':'文生图'}</option>`).join(''):'<option value="t2i">文生图</option><option value="i2i">图生图</option>';
  $('#generation-mode').disabled=!modes.length;
  const mode=currentJimengMode();for(const name of ['ratio','resolution']){
    const holder=$('#generation-'+name+'-field'),previous=$('#generation-'+name)?.value,flag=mode?.flags?.find(f=>f.flag?.replace(/^--/,'')===name),label=name==='ratio'?'比例':'分辨率';
    if(!flag){holder.replaceChildren();holder.hidden=true;continue;}holder.hidden=false;
    if(Array.isArray(flag.values)&&flag.values.length){const chosen=name==='ratio'&&(!previous||previous==='auto')?'auto':flag.values.includes(previous)?previous:flag.values.includes(String(flag.default||''))?String(flag.default):flag.required?flag.values[0]:'';
      holder.innerHTML=`<label>${label}<select id="generation-${name}" aria-label="即梦${label}">${name==='ratio'?'<option value="auto" '+(chosen==='auto'?'selected':'')+'>跟随当前格子（自动）</option>':''}${flag.required?'':'<option value="">官方默认</option>'}${flag.values.map(value=>`<option value="${escape(value)}" ${value===chosen?'selected':''}>${escape(value)}</option>`).join('')}</select></label>`;
    }else if(flag.required){holder.innerHTML=`<label>${label}<input id="generation-${name}" aria-label="即梦${label}" value="${escape(previous||flag.default||'')}" placeholder="模型要求参数"></label>`;}
    else {holder.replaceChildren();holder.hidden=true;}
  }
  $('#generation-status').textContent=jimengCatalogueError||(jimengStatus?.connected?`${jimengModels.length} 个官方模型 · 每次生成先核对报价`:jimengStatus?.message||'请完成即梦官方登录，再读取模型');
}
async function refreshGenerationOptions(){
  if(generationProvider!=='jimeng')return;
  jimengStatus=await api('/api/jimeng/status');jimengCatalogueError='';
  if(jimengStatus.connected){let catalogue;try{catalogue=await api('/api/jimeng/models');}catch(error){jimengModels=[];jimengCatalogueError='官方模型目录暂时不可读取：'+error.message;renderGenerationControls();renderCandidates();return;}jimengModels=(catalogue.items||[]).filter(m=>typeof m.model==='string'&&Array.isArray(m.modes));
    if(!jimengModels.some(m=>m.model===generationModel)){const preferred=localStorage.getItem('comic-jimeng-model');generationModel=jimengModels.find(m=>m.model===preferred)?.model||jimengModels[0]?.model||'';generationMode=project?.references.length?'i2i':'t2i';}
    const modes=jimengModels.find(m=>m.model===generationModel)?.modes||[];if(!modes.some(m=>m.name===generationMode))generationMode=modes.find(m=>['t2i','i2i'].includes(m.name))?.name||'t2i';
  }else jimengModels=[];
  renderGenerationControls();renderCandidates();
}
async function refreshProvider(){if(generationProvider==='jimeng')await refreshGenerationOptions();else{status=await api('/api/codex/status');updateConnectionLabel();renderGenerationControls();renderCandidates();}}
$('#generation-provider').addEventListener('change',safely(async event=>{generationProvider=event.target.value;localStorage.setItem('comic-generation-provider',generationProvider);renderGenerationControls();await refreshProvider();}));
$('#generation-model').addEventListener('change',event=>{generationModel=event.target.value;localStorage.setItem('comic-jimeng-model',generationModel);const modes=jimengModels.find(m=>m.model===generationModel)?.modes||[];if(!modes.some(m=>m.name===generationMode))generationMode=modes.find(m=>['t2i','i2i'].includes(m.name))?.name||'t2i';renderGenerationControls();});
$('#generation-mode').addEventListener('change',event=>{generationMode=event.target.value;renderGenerationControls();});
$('#refresh-generation-options').addEventListener('click',safely(refreshProvider));
function renderCandidates(){refreshGenerationShortcuts();quickUI?.sync();const frame=selection?.type==='panel'?selected():null;if(!frame||!$('#candidate-list'))return;$('#candidate-list').innerHTML=[...frame.candidates].reverse().map(assetId=>`<div class="panel-candidate-card"><button class="candidate ${assetId===frame.imageAssetId?'active':''}" data-candidate="${assetId}" aria-label="采用候选图片" ${frame.locked?'disabled':''}><img src="${assetUrl(assetId)}" alt="候选镜头"></button>${imageCardControls({add:'data-action="upload-image"',replace:'data-action="replace-image-candidate" data-image-asset="'+assetId+'"',remove:'data-action="delete-image-candidate" data-image-asset="'+assetId+'"',disabled:frame.locked||!!activeJob(frame)||submitting.has(frame.id)})}</div>`).join('');}
function renderEpisodeBatchStatus(){
 const host=$('#episode-batch-status'),plans=(scheduler.episodeBatches||[]).filter(p=>p.projectId===project?.id);
 host.hidden=!plans.length;
 const key=JSON.stringify(plans);if(host.dataset.key!==key){host.dataset.key=key;host.innerHTML=plans.map(p=>'<span data-episode-batch="'+escape(p.id)+'"><span data-batch-label></span> '+(p.active?'<button type="button" data-stop-episode-batch="'+escape(p.id)+'">停止后续</button>':'')+'</span>').join('');}
 for(const p of plans){const label=host.querySelector('[data-episode-batch="'+p.id+'"] [data-batch-label]');if(label)label.textContent=episodeBatchLabel(p);}
}
function renderJobs(){
 renderEpisodeBatchStatus();
 projectSyncUI?.paint();
 const groups=taskGroups(jobs,project?.id),recent=latestSubmission(jobs,project?.id,submissionRecords());$('#job-count').textContent=taskSummary(groups);$('#job-latest-status').textContent=recent.label;$('#job-latest-status').title=recent.jobs.map(j=>taskFrameName(project,j)).join('、');$('.job-tray').classList.toggle('has-attention',groups.approval>0||groups.failed.length>0||groups.recovery>0);
 $('#cancel-all-jobs').disabled=cancellingAllJobs||cancellingRecentJobs||(!groups.active.length&&!(scheduler.episodeBatches||[]).some(p=>p.projectId===project?.id&&p.active));$('#cancel-all-jobs').textContent=cancellingAllJobs?'正在全部取消…':'取消全部任务';$('#cancel-recent-jobs').disabled=cancellingAllJobs||cancellingRecentJobs||!recent.active.length;$('#cancel-recent-jobs').textContent=cancellingRecentJobs?'正在取消…':'取消最近一次'+(recent.active.length?'（'+recent.active.length+'）':'');
 const all=[...groups.active,...groups.failed,...groups.history],rows=all.filter(j=>jobCardFilter==='active'?ACTIVE_JOB_STATES.includes(j.status):jobCardFilter==='results'?!ACTIVE_JOB_STATES.includes(j.status):true).sort((a,b)=>Number(ACTIVE_JOB_STATES.includes(b.status))-Number(ACTIVE_JOB_STATES.includes(a.status))||String(b.created||'').localeCompare(String(a.created||''))),root=$('#job-list'),key=JSON.stringify({projectId:project?.id,filter:jobCardFilter,jobs:all});
 if(root.dataset.cardsKey===key)return;const scroll=root.querySelector('.task-card-rail')?.scrollLeft||0;root.dataset.cardsKey=key;
 root.innerHTML='<div class="task-card-filters" role="group" aria-label="任务显示范围">'+[['all','全部',all.length],['active','进行中',groups.active.length],['results','结果',all.length-groups.active.length]].map(([id,label,count])=>'<button type="button" data-task-filter="'+id+'" aria-pressed="'+(jobCardFilter===id)+'">'+label+' '+count+'</button>').join('')+'<span class="task-card-navigation"><button type="button" data-task-scroll="-1" aria-label="向左查看任务">←</button><button type="button" data-task-scroll="1" aria-label="向右查看任务">→</button></span></div><div class="task-card-rail" tabindex="0" aria-label="横向生成任务卡片">'+(rows.map(job=>taskCardMarkup(job,{project,escape})).join('')||'<p class="empty-note">'+(jobCardFilter==='active'?'没有进行中的任务':'还没有生成任务')+'</p>')+'</div>';root.querySelector('.task-card-rail').scrollLeft=scroll;updateTaskRailNavigation(root);
}
setInterval(()=>{renderEpisodeBatchStatus();for(const element of document.querySelectorAll('[data-job-time]')){const job=jobs.find(j=>j.id===element.dataset.jobTime);if(job)element.textContent=jobTime(job);}for(const element of document.querySelectorAll('[data-job-short-time]')){const job=jobs.find(j=>j.id===element.dataset.jobShortTime);if(job)element.textContent=taskShortTime(job);}},1000);


function worldPoint(event){const point=stage.createSVGPoint();point.x=event.clientX;point.y=event.clientY;return point.matrixTransform(stage.getScreenCTM().inverse());}
function addNode(index,point){const frame=selected();if(selection?.type!=='panel'||frame.locked||frame.points.length>=64)return;const a=frame.points[index],b=frame.points[(index+1)%frame.points.length],next=point||{x:(a.x+b.x)/2,y:(a.y+b.y)/2},candidate=clone(frame.points);candidate.splice(index+1,0,next);if(!validPolygon(candidate))return toast('这个位置无法增加节点',true);edit(()=>{frame.points=candidate;nodeIndex=index+1;tool='nodes';});}
function deleteNode(){const frame=selected();if(selection?.type!=='panel'||frame.locked||frame.points.length<=3)return;const points=clone(frame.points);points.splice(nodeIndex,1);if(!validPolygon(points))return toast('删除后边线会交叉，请先移动节点',true);edit(()=>{const before=clone(frame);Object.assign(frame,preserveFrameArtwork(before,{...clone(frame),points}));nodeIndex=Math.min(nodeIndex,points.length-1);tool='nodes';});}
function toRectangle(){const frame=selected();if(selection?.type!=='panel'||frame.locked)return;edit(()=>{const b=bounds(frame);rebasePanelEffects(frame,b);frame.x+=b.x;frame.y+=b.y;frame.w=b.w;frame.h=b.h;if(frame.imageTransform){frame.imageTransform.x-=b.x;frame.imageTransform.y-=b.y;}frame.points=rectangle();nodeIndex=0;});}
function documentPoint(event){const p=worldPoint(event);return {x:p.x,y:p.y+(viewState?documentView(project,viewState).offset:0)};}
function pagePoint(event,fixedPageId=null){const global=documentPoint(event),full=layoutLongStrip(project.pages);return fixedPageId?localPagePoint(full,fixedPageId,global):viewport.hitTest(worldPoint(event))?.local||global;}
function dragItem(value){return findLayer(project,value.id)?.item||null;}
let lastBubbleClick=null;
function focusBubbleText(event){const index=event?.target.closest('[data-bubble-point]')?.dataset.bubblePoint||'0',input=$('#inspector-body textarea[data-section="bubble-segment-'+index+'"]')||$('#inspector-body textarea[data-section="bubble"][data-field="text"]');if(input){input.focus({preventScroll:true});input.select();}}
stage.addEventListener('pointerdown',event=>{
  if(event.button!==0||event.target.closest('[data-bubble-handle]'))return;
  const ownerGroup=event.target.closest('[data-page-id]'),ownerId=ownerGroup?.dataset.pageId||viewport.hitTest(worldPoint(event))?.pageId;
  if(!ownerId&&!event.target.closest('[data-layer-type="gradient"]'))return;const artwork=event.target.closest('[data-artwork-scale]'),node=event.target.closest('[data-node]'),edge=event.target.closest('[data-edge]'),bubble=event.target.closest('[data-bubble]'),group=event.target.closest('[data-panel]');
  if(artwork&&group&&tool==='image'){select('panel',group.dataset.panel,ownerId);const item=selected(),asset=assetMap().get(item.imageAssetId);if(item.locked||!asset)return;drag={kind:'artwork-scale',pointer:event.pointerId,start:pagePoint(event,ownerId),before:layoutEditSnapshot(project),initial:clone(item),asset:clone(asset),index:Number(artwork.dataset.artworkScale),pageId:ownerId,type:'panel',id:item.id};}
  else if(node&&group){select('panel',group.dataset.panel,ownerId);const item=selected();if(item.locked||!['move','rect','nodes'].includes(tool)&&!isSfxImage(item))return;if(tool==='move'&&item.proportionalResize!==false&&!item.cutoutLayer&&groupForLayer(project,item.id)?.members.some(e=>e.item.locked)){toast('请先解锁镜头组中的图层',true);return;}nodeIndex=Number(node.dataset.node);drag={kind:isSfxImage(item)?'image-scale':tool==='move'?'group-scale':tool==='nodes'?'node':'rect',pointer:event.pointerId,start:pagePoint(event,ownerId),before:layoutEditSnapshot(project),initial:clone(item),index:nodeIndex,pageId:ownerId,type:'panel',id:item.id};}
  else if(edge&&group&&tool==='nodes'){select('panel',group.dataset.panel,ownerId);const frame=selected(),pos=pagePoint(event,ownerId),i=Number(edge.dataset.edge),a=frame.points[i],b=frame.points[(i+1)%frame.points.length],local={x:(pos.x-frame.x)/frame.w,y:(pos.y-frame.y)/frame.h},dx=b.x-a.x,dy=b.y-a.y,t=clamp(((local.x-a.x)*dx+(local.y-a.y)*dy)/(dx*dx+dy*dy),.08,.92);addNode(i,{x:a.x+t*dx,y:a.y+t*dy});return;}
  else if(bubble){const at=performance.now(),twice=lastBubbleClick?.id===bubble.dataset.bubble&&at-lastBubbleClick.at<500&&Math.hypot(event.clientX-lastBubbleClick.x,event.clientY-lastBubbleClick.y)<7;lastBubbleClick={id:bubble.dataset.bubble,at,x:event.clientX,y:event.clientY};select('bubble',bubble.dataset.bubble,ownerId,{inspector:true});if(twice){lastBubbleClick=null;event.preventDefault();focusBubbleText(event);return;}const item=selected();if(item.locked)return;drag={kind:'bubble',pointer:event.pointerId,start:pagePoint(event,ownerId),before:layoutEditSnapshot(project),initial:clone(item),pageId:ownerId,type:'bubble',id:item.id};}
  else if(group){const kind=group.dataset.layerType==='gradient'?'gradient':'panel';select(kind,group.dataset.panel,ownerId);if(kind==='gradient'){const frame=selected();if(frame.locked||frame.stripSpace)return;drag={kind:event.target.closest('[data-gradient-resize]')?'gradient-resize':'gradient-move',handle:event.target.closest('[data-gradient-resize]')?.dataset.gradientResize,pointer:event.pointerId,start:documentPoint(event),before:layoutEditSnapshot(project),initial:clone(gradientFrame(frame,layoutLongStrip(project.pages))),pageId:ownerId,type:'gradient',id:frame.id};}else{const frame=selected();if(frame.locked)return;if(tool==='move'&&!frame.cutoutLayer&&groupForLayer(project,frame.id)?.members.some(e=>e.item.locked)){toast('请先解锁镜头组中的图层',true);return;}drag={kind:tool==='image'?'image':tool==='rect'?'frame-move':'move',pointer:event.pointerId,start:pagePoint(event,ownerId),before:layoutEditSnapshot(project),initial:clone(selected()),pageId:ownerId,type:'panel',id:frame.id};}}
  else {pageId=ownerId;selection=null;renderCanvas();renderSidebar();renderInspector();return;}
  if(drag){event.preventDefault();stage.setPointerCapture(event.pointerId);}
});
stage.addEventListener('pointermove',event=>{
  if(!drag||event.pointerId!==drag.pointer)return;const pos=drag.type==='gradient'?documentPoint(event):pagePoint(event,drag.pageId),item=dragItem(drag),initial=drag.initial,p=project.pages.find(p=>p.id===drag.pageId);if(!item||!pos||(drag.type!=='gradient'&&!p))return;const dx=pos.x-drag.start.x,dy=pos.y-drag.start.y;if(dx===0&&dy===0)return;
  if(drag.kind==='artwork-scale'){const delta=sfxImageDelta(initial,dx,dy);Object.assign(item,resizeArtworkCorner(initial,drag.asset,drag.index,{dx:delta.x,dy:delta.y}));}
  else if(drag.kind==='rect'){Object.assign(item,resizeFrameCorner(initial,drag.index,{dx,dy},{pageWidth:p.width}));}
  else if(drag.kind==='group-scale'){resizePanelGroup(project,item.id,drag.index,{dx,dy},drag.before);}
  else if(drag.kind==='frame-move'){Object.assign(item,moveFrameBoundary(initial,{dx:Math.round(dx),dy:Math.round(dy)}));}
  else if(initial.proportionalResize&&drag.kind==='node'){Object.assign(item,preserveFrameArtwork(initial,proportionalFrameDrag(initial,drag.index,{dx,dy},{pageWidth:p.width})));}
  else if(drag.kind==='image-scale'){Object.assign(item,resizeSfxImageCorner(initial,drag.index,{dx,dy},{maxWidth:p.width*3,pageWidth:p.width}));}
  else if(drag.kind==='gradient-resize'){const handle=GRADIENT_HANDLES.find(h=>h[0]===drag.handle);const region=resizeGradientRegion(initial,drag.handle,{x:initial.x+handle[1]*initial.w+dx,y:initial.y+handle[2]*initial.h+dy},layoutLongStrip(project.pages));if(!item.stripSpace&&(region.x!==initial.x||region.w!==initial.w))item.freeGradientRegion=true;Object.assign(item,region);}
  else if(drag.kind==='node'){const points=clone(initial.points),anchor=initial.points[drag.index];points[drag.index]={x:constrainedNodeX(initial,p.width,drag.index,dx),y:nodeDragY(initial,drag.index,anchor.y+dy/initial.h)};if(validPolygon(points))Object.assign(item,preserveFrameArtwork(initial,{...clone(initial),points}));}
  else if(drag.kind==='image'){if(initial.imageTransform){const outer=sfxImageDelta(initial,dx,dy),local=artworkDelta(initial.imageTransform,outer.x,outer.y);item.imageTransform={...initial.imageTransform,x:initial.imageTransform.x+local.x,y:initial.imageTransform.y+local.y};}}
  else if(drag.kind==='bubble')replaceBubble(applyBubbleEdit(initial,{type:'move',dx:Math.round(dx),dy:Math.round(dy)}),drag.pageId);
  else if(drag.type==='panel'){movePanelGroup(project,item.id,{x:Math.round(initial.x+dx),y:Math.round(initial.y+dy)},drag.before);}
  else {if(!item.stripSpace&&dx!==0)item.freeGradientRegion=true;item.x=isStripBackground(item)?0:Math.round(initial.x+dx);item.y=Math.round(initial.y+dy);}
  if(drag.type==='gradient'){const layout=layoutLongStrip(project.pages);Object.assign(item,constrainGradientRegion(item,layout));if(item.assistantLayoutAnchor)item.assistantLayoutAnchor.y=item.y-(layout.pages.find(e=>e.pageId===item.assistantLayoutAnchor.pageId)?.y||0);}
  queueBatchPreview();
});
function finishDrag(event){if(!drag||event.pointerId!==drag.pointer)return;const before=drag.before;drag=null;undoRevision++;historyStepsUI?.refresh();if(stage.hasPointerCapture(event.pointerId))stage.releasePointerCapture(event.pointerId);commit(before);}
function cancelCanvasDrag(event){if(!drag||event?.pointerId!==undefined&&event.pointerId!==drag.pointer)return;const active=drag;drag=null;project=preserveLayoutHistory(project,active.before);undoRevision++;if(stage.hasPointerCapture(active.pointer))stage.releasePointerCapture(active.pointer);render();}
stage.addEventListener('pointerup',finishDrag);stage.addEventListener('pointercancel',cancelCanvasDrag);stage.addEventListener('lostpointercapture',cancelCanvasDrag);window.addEventListener('blur',()=>cancelCanvasDrag());
stage.addEventListener('dblclick',event=>{const group=event.target.closest('[data-bubble],[data-panel]');if(group){select(group.dataset.bubble?'bubble':group.dataset.layerType==='gradient'?'gradient':'panel',group.dataset.bubble||group.dataset.panel,event.target.closest('[data-page-id]')?.dataset.pageId);workbench.openInspector();if(group.dataset.bubble){event.preventDefault();focusBubbleText(event);}}});

function mergeImageAssets(registered){for(const asset of registered)missingImageAssets.delete(asset.id);for(const asset of registered){const index=assets.findIndex(a=>a.id===asset.id);if(index<0)assets.push(asset);else{const old=assets[index];if(old.filePath!==asset.filePath||old.fileSize!==asset.fileSize||old.fileModified!==asset.fileModified||old.fileChanged!==asset.fileChanged)clearImageCache(asset.id);assets[index]=asset;}}}
function chooseDirectoryAssets(mode='reference'){libraryUI.open({kind:'image'});}
document.addEventListener('error',event=>{const target=event.target;if(!target?.getAttribute)return;const url=target.getAttribute('href')||target.getAttribute('src')||'',match=/\/assets\/(asset_[0-9a-f-]{36})(?:[?.]|$)/.exec(url);if(!match||missingImageAssets.has(match[1]))return;missingImageAssets.add(match[1]);renderCanvas();toast('图片文件缺失或无法读取，请重新指定原文件路径。',true);},true);
function chooseLocalImages(mode='reference'){libraryUI.open({kind:'image'});}
function chooseSpeakerAvatar(){
 const bubble=selection?.type==='bubble'?selected():null,speaker=bubbleSpeaker(project,bubble);if(!speaker?.known)throw new Error('请先在分镜资料中指定说话人');
 const projectId=project.id,name=speaker.name,current=speakerAvatar(project,bubble,assets);
 libraryUI.open({kind:'image',onSelect:async asset=>{if(project?.id!==projectId)throw Error('工程已切换，请重新选择头像');edit(()=>{project.speakerAvatars={...project.speakerAvatars,[name]:asset.id};},{operation:'speaker.avatar'});await flushSave();}});
}
async function attachImage(assetId,options={}){const frame=selected();if(selection?.type!=='panel'||!frame)throw new Error('请先选中一个格子');const projectId=project.id,panelId=frame.id;await flushSave();if(project?.id!==projectId||selection?.type!=='panel'||selected()?.id!==panelId)throw new Error('工程或画格已切换，请重新选择图片');const expectedRevision=project.revision,saved=await api(`/api/projects/${projectId}/panels/${panelId}/image`,'POST',{assetId,...options,expectedRevision});if(project?.id!==projectId)return;if(saving)await saving.catch(()=>{});if(project?.id!==projectId)return;if(dirty||hasLocalEditing()){applyServerRevision(saved);return;}if(Number.isInteger(saved.revision)&&saved.revision<project.revision)return;project=clone(saved);setServerBase(saved);render();$('#save-state').textContent='已保存到本机';}
function referenceTarget(projectId,panelId,shotId){
 if(project?.id!==projectId)throw new Error('项目已切换，请重新选择本格参考');
 const frame=project.pages.flatMap(p=>p.panels).find(f=>f.id===panelId);
 if(!frame)throw new Error('画格已删除，请重新选择参考');
 if(frame.locked)throw new Error('请先解锁画格');return frame;
}
function choosePanelReferences(initialSlot){
 const frame=selected();
 if(frame&&episodeAssetsUI){const projectId=project.id,panelId=frame.id;void episodeAssetsUI.openTarget(panelId,initialSlot,'moku').then(opened=>{if(!opened&&project?.id===projectId&&selection?.type==='panel'&&selected()?.id===panelId)document.querySelector('[data-rail-tab="references"]')?.click();}).catch(e=>toast(e.message,true));return;}if(selection?.type!=='panel'||!frame)return;
 const projectId=project.id,panelId=frame.id,shotId=frame.shotId,referenceStamp=referenceInputStamp(project,frame);
 referenceTarget(projectId,panelId,shotId);
 openPanelReferences({project:clone(project),panel:clone(frame),getAssets:()=>assets,api,modal,closeModal,escape,onAssets:mergeImageAssets,toast,initialSlot:Number.isInteger(initialSlot)?initialSlot:undefined,initialNeed:typeof initialSlot==='object'?(frame.productionSegment?initialSlot:initialSlot.id):typeof initialSlot==='string'?initialSlot:undefined,
 onRetrieve:needId=>referenceResultsUI.open({projectId,panelId,needId}),onGenerationRefresh:()=>referenceResultsUI.refresh(),
 onGenerate:(needId,requestId)=>submitReferenceGeneration(projectId,panelId,needId,requestId),
 onApply:async (ids,options={})=>{let target=referenceTarget(projectId,panelId,shotId);if(ids?.productionSupplement){await flushSave();target=referenceTarget(projectId,panelId,shotId);if(referenceInputStamp(project,target)!==referenceStamp)throw Error('参考需求已改变，请重新选图');const need=ids.productionSupplement,episode=project.productionPackage.episodes.find(e=>e.segments.some(s=>s.id===target.productionSegment)),targets=ids.applyMatching?project.pages.flatMap(p=>p.panels).filter(f=>episode.segments.some(s=>s.id===f.productionSegment)&&productionExtraNeeds(project,f,assets).some(n=>n.id===need.id)):[target];for(const f of targets){referenceTarget(projectId,f.id);if(project.pages.find(p=>p.panels.includes(f))?.locked)throw Error('画板已锁定');if(activeJob(f)||submitting.has(f.id))throw Error('待修改的屏段正在生成，请完成后再更换参考');}const prepared=targets.map(f=>{const draft=clone(f);bindProductionExtraReference(project,draft,need,assets);return [f,draft];});edit(()=>{for(const [f,draft]of prepared)Object.assign(f,draft);});await flushSave();return;}if(ids?.productionBindings){await flushSave();target=referenceTarget(projectId,panelId,shotId);if(referenceInputStamp(project,target)!==referenceStamp)throw Error('屏段附图已改变，请重新选图');const saved=await api('/api/projects/'+project.id+'/production/references','POST',{segmentId:target.productionSegment,bindings:ids.productionBindings,applyMatching:ids.applyMatching,expectedRevision:project.revision});if(project?.id!==projectId)throw Error('工程已切换，原工程附图已保存');project=clone(saved);setServerBase(saved);dirty=false;projects=projects.map(p=>p.id===saved.id?project:p);render();return;}edit(()=>{if(options.needBindings)target.referenceNeedBindings=clone(options.needBindings);setPanelReferences(target,ids,{project,assets});});}});
}
function showReferenceProcessingResult(plan){
 const frame=selected();if(selection?.type!=='panel'||!frame)return;const projectId=project.id,panelId=frame.id;
 const roles={character:'人物',scene:'场景',prop:'道具'},notes=plan.notes||frame.referenceRequirements?.notes||[];
 if(frame.productionSegment){modal('墨库参考',`<div class="reference-processing-report production-reference-report"><p class="reference-process-summary">${escape(plan.summary)}</p>${productionReferenceCardsMarkup(auditPanelReferences(project,frame,assets),assets,escape,{disabled:frame.locked||!!activeJob(frame)})}${notes.map(note=>'<p class="reference-warning">'+escape(note)+'</p>').join('')}</div>`,[{label:'关闭',run:closeModal}]);document.querySelector('.production-reference-report').addEventListener('click',safely(async event=>{const button=event.target.closest('[data-action]');if(!button)return;if(project?.id!==projectId||selected()?.id!==panelId)throw Error('画格已切换，请重新打开参考');await productionReferenceAction(button);}));paintReferenceGenerationTasks();return;}
 modal('参考图处理结果',`<div class="reference-processing-report"><p class="reference-process-summary">${escape(plan.summary)}</p><div class="reference-process-matches">${plan.matches.map(m=>`<article><img src="/api/assets/${encodeURIComponent(m.assetId)}/thumbnail" alt="${escape(m.name)}"><span><strong>${escape(m.name)}</strong><small>${escape(roles[m.role]||'参考')} · ${escape(m.reason)}</small></span></article>`).join('')}</div>${plan.issues.length?`<div class="reference-process-issues">${plan.issues.map(i=>`<p><strong>${escape(i.name)}</strong><span>${escape(i.message)}</span></p>`).join('')}</div>`:'<p class="reference-process-complete">已识别的需求已匹配参考图片。</p>'}${notes.map(note=>'<p class="reference-warning">'+escape(note)+'</p>').join('')}<p class="sub-note">仅补充这一格的参考，保留原有顺序。缺图需生成后看图确认。</p></div>`,[{label:'关闭',run:closeModal},{label:'手动调整参考',primary:true,run:()=>{if(project?.id!==projectId||selected()?.id!==panelId)throw Error('画格已切换，请重新选择');closeModal();choosePanelReferences();}}]);
}
function paintReferenceGenerationTasks(){
 referenceResultsUI.refresh();if(!project||!selected())return;const prefix=project.id+':'+selected().id+':';
 for(const element of document.querySelectorAll('[data-reference-task]')){const entry=referenceGenerations.get(prefix+element.dataset.referenceTask);if(!entry)continue;const task=entry.task||{},status=({queued:'排队中',running:'生成中',claimed:'已接单',review:'新图待确认',completed:'新图待确认',done:'已完成',failed:'生成失败',uncertain:'提交状态待核实',submitting:'提交中…',cancelled:'已取消'})[task.status]||task.status||'';let taskLine=element.querySelector('[data-reference-status-line]');if(!taskLine){taskLine=document.createElement('span');taskLine.dataset.referenceStatusLine='';element.prepend(taskLine);}taskLine.replaceChildren(document.createTextNode(status+' '));if(entry.url&&/^https?:\/\//i.test(entry.url)){const link=document.createElement('a');link.href=entry.url;link.target='_blank';link.rel='noopener';link.textContent='查看生成任务';taskLine.append(link);}const card=element.closest('[data-reference-need-row]'),button=card?.querySelector('[data-action="production-reference-generate"]');if(button&&['submitting','queued','running','claimed'].includes(task.status)){button.disabled=true;button.textContent=status;}}
}
async function submitReferenceGeneration(projectId,panelId,needId,requestId,{force=false}={}){
 const key=projectId+':'+panelId+':'+needId,prior=referenceGenerations.get(key);if(['submitting','queued','running','claimed'].includes(prior?.task?.status))return prior;
 referenceGenerations.set(key,{task:{status:'submitting'}});paintReferenceGenerationTasks();
 try{
  referenceTarget(projectId,panelId);await flushSave();referenceTarget(projectId,panelId);
  const returned=await referenceResultsUI.load({projectId,panelId,needId},{force:true});referenceTarget(projectId,panelId);const need=auditPanelReferences(project,referenceTarget(projectId,panelId),assets).needs.find(n=>n.id===needId);
  if(returned.error)throw Error(returned.error);if(!force&&!need?.selectedIds.length&&returned.items.some(i=>i.available)){referenceGenerations.delete(key);return referenceResultsUI.open({projectId,panelId,needId});}
  // Recover an active request after reload before creating another paid task.
  const existing=await api('/api/project-center/reference-generation?'+new URLSearchParams({projectId,panelId}));referenceTarget(projectId,panelId);
  const ongoing=(existing.items||[]).filter(item=>item.needId===needId&&['queued','running','claimed'].includes(item.task?.status)).at(-1);
  let result;
  if(ongoing)result=await api('/api/project-center/reference-generation?'+new URLSearchParams({projectId,taskId:ongoing.task.id}));
  if(!result||!['queued','running','claimed'].includes(result.task?.status)){
   if(!referenceGenerationKeys.has(key))referenceGenerationKeys.set(key,requestId||crypto.randomUUID());
   result=await api('/api/project-center/reference-generation','POST',{projectId,panelId,needId,requestId:referenceGenerationKeys.get(key),expectedRevision:project.revision});referenceGenerationKeys.delete(key);
  }
  if(result?.task?.id)referenceGenerationKeys.delete(key);
  referenceGenerations.set(key,result);paintReferenceGenerationTasks();toast('已提交资产生成，可在这张卡片查看任务');
  if(['queued','running','claimed'].includes(result.task?.status))setTimeout(()=>void pollReferenceGeneration(projectId,panelId,needId),5000);return result;
 }catch(error){referenceGenerations.set(key,{task:{status:referenceGenerationKeys.has(key)?'uncertain':'failed'}});paintReferenceGenerationTasks();throw error;}
}
async function pollReferenceGeneration(projectId,panelId,needId){const key=projectId+':'+panelId+':'+needId,current=referenceGenerations.get(key);if(!current?.task?.id)return;try{const result=await api('/api/project-center/reference-generation?'+new URLSearchParams({projectId,taskId:current.task.id}));referenceGenerations.set(key,result);paintReferenceGenerationTasks();if(!['queued','running','claimed'].includes(result.task?.status)){await referenceResultsUI.load({projectId,panelId,needId},{force:true});referenceResultsUI.refresh();return;}}catch{}if(project?.id===projectId)setTimeout(()=>void pollReferenceGeneration(projectId,panelId,needId),5000);}
async function productionReferenceAction(button){
 const frame=selected();if(selection?.type!=='panel'||!frame?.productionSegment)return;const projectId=project.id,panelId=frame.id;
 if(button.dataset.action==='production-reference-retrieve'){await referenceResultsUI.open({projectId,panelId,needId:button.dataset.needId});return;}
 if(button.dataset.action==='production-reference-choose'){choosePanelReferences(button.dataset.slot.startsWith('name:')?button.dataset.slot:Number(button.dataset.slot));return;}
 if(button.dataset.action==='production-reference-generate'){await submitReferenceGeneration(projectId,panelId,button.dataset.needId);return;}
 if(button.dataset.action==='production-reference-skip'){
  const slot=Number(button.dataset.slot),choice=productionBindingDraft(project,frame).find(r=>r.slot===slot);if(!choice)throw Error('参考项已改变，请重新打开');const stamp=referenceInputStamp(project,frame);await flushSave();const target=referenceTarget(projectId,panelId);if(referenceInputStamp(project,target)!==stamp)throw Error('参考已变化，请重新操作');
  const saved=await api('/api/projects/'+projectId+'/production/references','POST',{segmentId:target.productionSegment,bindings:[{slot,assetId:null,skip:!choice.skip}],expectedRevision:project.revision});if(project?.id!==projectId)return;project=clone(saved);setServerBase(saved);dirty=false;projects=projects.map(p=>p.id===saved.id?project:p);render();if(document.querySelector('.production-reference-report'))showReferenceProcessingResult(planPanelReferenceProcessing(project,selected(),assets));toast(choice.skip?'已恢复这项参考需求':'已跳过可选参考');
 }
}
async function processCurrentPanelReferences({silent=false,submissionPanelId=null}={}){
 const initial=selected();if(selection?.type!=='panel'||!initial)return;if(referenceProcessingPanels.has(initial.id))return;
 const projectId=project.id,panelId=initial.id;if(activeJob(initial)||(submitting.has(panelId)&&submissionPanelId!==panelId))throw Error('当前画格正在生成，请完成后再处理参考');referenceTarget(projectId,panelId);referenceProcessingPanels.add(panelId);renderInspector();
 try{
  await flushSave();const sourceProject=clone(project),sourcePanel=findLayer(sourceProject,panelId).item,stamp=referenceInputStamp(sourceProject,sourcePanel),beforeIds=JSON.stringify(panelReferenceIds(sourceProject,sourcePanel));
  const verify=()=>{const target=referenceTarget(projectId,panelId);if(project.pages.find(p=>p.panels.some(f=>f.id===panelId))?.locked)throw Error('画板已锁定，未修改参考');if(selected()?.id!==panelId||referenceInputStamp(project,target)!==stamp||JSON.stringify(panelReferenceIds(project,target))!==beforeIds)throw Error('画格或分镜内容已变化，未修改本格参考，请重新处理');if(activeJob(target)||(submitting.has(panelId)&&submissionPanelId!==panelId))throw Error('画格已开始生成，未修改参考');};
  const plan=await processPanelReferences({project:sourceProject,panel:sourcePanel,getAssets:()=>assets,api,onAssets:mergeImageAssets,verify,onProgress:message=>{const button=$('#inspector-body').querySelector('[data-action="process-panel-references"]');if(button)button.textContent=message;}});verify();
  const target=referenceTarget(projectId,panelId);if(plan.productionBindings){const saved=await api('/api/projects/'+project.id+'/production/references','POST',{segmentId:target.productionSegment,bindings:plan.productionBindings,expectedRevision:project.revision});if(project?.id!==projectId)throw Error('工程已切换，原屏段附图已保存');project=clone(saved);setServerBase(saved);dirty=false;projects=projects.map(p=>p.id===saved.id?project:p);render();}else{edit(()=>{target.referenceRequirements={...plan.requirements,notes:plan.notes};project.assetLibrary||={version:1,assetIds:[],directories:[],recursive:true};project.assetLibrary.assetIds=[...new Set([...project.assetLibrary.assetIds,...plan.ids])];setPanelReferences(target,plan.ids,{project,assets});},{operation:'panel.references-process'});await flushSave();}if(!silent){toast(plan.summary);if(plan.issues.length||plan.notes.length)showReferenceProcessingResult(plan);}
 }finally{referenceProcessingPanels.delete(panelId);if(project?.id===projectId)renderInspector();}
}
function reviewFrameReferences(panelIds){
 if(!project||episodeBoardUI?.active)throw Error('请先返回正文画格');
 const scope={projectId:project.id,episode:currentBoardEpisode(project,page())},scopePanels=episodePages(project,page()).flatMap(p=>p.panels),targets=scopePanels.filter(f=>panelIds.includes(f.id)&&!f.breakoutForeground&&!f.cutoutLayer&&!f.sfxImage),rows=targets.map(panel=>({panel,audit:auditPanelReferences(project,panel,assets)}));
 const pending=panel=>submitting.has(panel.id)||jobs.some(j=>j.panelId===panel.id&&ACTIVE_JOB_STATES.includes(j.status));
 modal('本话参考图核对',referenceReviewMarkup(rows,{escape,name:panel=>projectFrameName(project,panel),pending,episode:scope.episode}),[{label:'关闭',run:closeModal},{label:'补齐勾选格的参考',primary:true,run:async()=>{
  if(project?.id!==scope.projectId||currentBoardEpisode(project,page())!==scope.episode)throw Error('作品或话数已切换，请重新核对参考');const ids=[...document.querySelectorAll('[data-reference-review-check]:checked:not(:disabled)')].map(input=>input.closest('[data-audit-panel]').dataset.auditPanel),changes=ids.map(id=>{const panel=referenceTarget(scope.projectId,id);if(pending(panel))throw Error('有画格已开始生成，请重新检查');return {panel,...appendRequiredReferences(project,panel,assets)};}).filter(change=>change.added>0);if(!changes.length){toast('没有可直接补齐的已确认图片；请先定义本格需求或从墨库选图');return;}if(changes.every(change=>change.panel.productionSegment)){await flushSave();const saved=await api('/api/projects/'+project.id+'/production/references','POST',{expectedRevision:project.revision,changes:changes.map(change=>({segmentId:change.panel.productionSegment,bindings:planProductionReferences(project,change.panel,assets).productionBindings}))});if(project?.id!==scope.projectId)throw Error('工程已切换，原工程附图已保存');project=clone(saved);setServerBase(saved);dirty=false;render();}else{edit(()=>{for(const change of changes)setPanelReferences(change.panel,change.ids,{project,assets});},{operation:'panel.references-append-required'});await flushSave();}closeModal();toast('已为 '+changes.length+' 格补齐 '+changes.reduce((n,c)=>n+c.added,0)+' 张参考；现有图片保持原样，可重新发起生成');
 }}]);
 const root=document.querySelector('.reference-review-rows');root.addEventListener('click',event=>{const b=event.target.closest('[data-reference-review-open]');if(!b)return;if(project?.id!==scope.projectId||currentBoardEpisode(project,page())!==scope.episode){toast('话数已变化，请重新打开',true);return;}const panel=referenceTarget(scope.projectId,b.dataset.referenceReviewOpen),owner=project.pages.find(p=>p.panels.some(f=>f.id===panel.id));closeModal();select('panel',panel.id,owner.id,{scroll:true,inspector:true});choosePanelReferences();});
 const checks=()=>[...root.querySelectorAll('[data-reference-review-check]:not(:disabled)')],syncCount=()=>{const boxes=checks();document.querySelector('[data-reference-review-status]').textContent='已选 '+boxes.filter(input=>input.checked).length+' / '+boxes.length+' 格';};
 for(const [selector,value]of [['[data-reference-review-all]',true],['[data-reference-review-none]',false]])document.querySelector(selector).onclick=()=>{for(const input of checks())input.checked=value;syncCount();};root.addEventListener('change',syncCount);syncCount();
}
const referenceReviewButton=document.createElement('button');referenceReviewButton.id='reference-review-episode';referenceReviewButton.textContent='检查本话参考';referenceReviewButton.type='button';document.querySelector('#generation-scope-status').before(referenceReviewButton);referenceReviewButton.onclick=safely(()=>reviewFrameReferences(episodePages(project,page()).flatMap(p=>p.panels).map(f=>f.id)));

async function generateWholeImageEdit(notes,target,{frameUpscale=false,referenceIds=[],previewId=null}={}){
 const panelId=target.panel.id,projectId=target.p.id;
 if(submitting.has(panelId)||activeJob(target.panel))throw Error('本格已有任务，请等待完成');
 if(!target.panel.imageAssetId)throw Error('请先选择已有图片的画格');
 submitting.add(panelId);renderCandidates();
 try{
  await flushSave();const frame=referenceTarget(projectId,panelId);if(frameUpscale&&((await api('/api/health')).frameUpscaleVersion<2||!previewId))throw Error('请重新打开格内高清预览后提交');
  const created=await api('/api/jobs','POST',{projectId,panelIds:[panelId],action:'edit',editScope:'full-image',...(frameUpscale?{frameUpscale:true,frameUpscalePreviewId:previewId}:{}),editReferenceIds:referenceIds,editPrompt:notes,sourceImageAssetId:frame.imageAssetId,expectedRevision:project.revision,provider:'codex'});
  rememberSubmission(projectId,created);jobs.push(...created);await refreshState();toast(frameUpscale?'格内截图已交给 Codex 高清，完成后加入原位高清图层':'整张原图与 '+referenceIds.length+' 张参考图已提交，原图保留在记录和候选中');
 }finally{submitting.delete(panelId);renderCandidates();renderCanvas();}
}
async function generateFrames(panelIds,action='generate',editPrompt='',verifyScope=()=>{},episodeBatch=null){
 const targetProjectId=project.id,targetProvider=generationProvider;
 const verifyTarget=()=>{if(project?.id!==targetProjectId)throw new Error('生图准备期间项目已切换，请重新发起生成');if(generationProvider!==targetProvider)throw Error('生图准备期间渠道已切换，请重新发起生成');verifyScope();};
 // Reserve the panels before any await: a second click during reference
 // preparation used to silently drop the first submission.
 if(panelIds.some(id=>submitting.has(id)))return;
 panelIds.forEach(id=>submitting.add(id));renderCandidates();renderCanvas();
 try{
 if(panelIds.length===1){const frame=project.pages.flatMap(p=>p.panels).find(f=>f.id===panelIds[0]);if((frame?.productionGrid||frame?.panelSlice)&&selected()?.id===frame.id&&!auditPanelReferences(project,frame,assets).ready){await processCurrentPanelReferences({silent:true,submissionPanelId:frame.id});verifyTarget();}}
 for(const pid of panelIds){const frame=project.pages.flatMap(p=>p.panels).find(f=>f.id===pid);if(!frame)throw new Error('画格已删除');prepareProductionFrame(project,frame,assets,{deferPanelIds:panelIds,jobs});ensurePanelGeneration(project,frame,assets);}
 const incomplete=panelIds.some(id=>{const frame=project.pages.flatMap(p=>p.panels).find(f=>f.id===id);if(frame.productionSegment||frame.productionBackground)return false;const audit=auditPanelReferences(project,frame,assets);return audit.coverageEnforced&&!audit.ready;});if(incomplete){reviewFrameReferences(panelIds);toast('本格参考不完整，已打开需求清单；补齐后再生成',true);return;}
  if(generationProvider==='jimeng'){
    await refreshGenerationOptions();verifyTarget();if(!jimengStatus?.connected)throw new Error(jimengStatus?.message||'即梦尚未登录，请完成官方授权后检查连接');
    const model=jimengModels.find(m=>m.model===generationModel);
    if(action!=='edit'&&generationMode==='t2i'&&panelIds.some(pid=>panelReferenceIds(project,project.pages.flatMap(p=>p.panels).find(f=>f.id===pid)).length)&&model?.modes?.some(m=>m.name==='i2i')){generationMode='i2i';renderGenerationControls();}
    const mode=action==='edit'?'i2i':generationMode;
    if(!model||!model.modes?.some(m=>m.name===mode))throw new Error(action==='edit'?'请选择支持图生图的即梦模型后重绘':'请先选择官方模型与支持的生图方式');if(action==='edit'){generationMode='i2i';renderGenerationControls();}
    for(const pid of panelIds){const frame=project.pages.flatMap(p=>p.panels).find(f=>f.id===pid),count=panelReferenceIds(project,frame).length,message=referenceCountError(model,textAssetGenerationMode(model,mode,count,frame,{edit:action==='edit'}),count,{edit:action==='edit'});if(message)throw new Error(message);}
  }
    await flushSave();verifyTarget();const revision=project.revision,payload={projectId:targetProjectId,panelIds,action,editPrompt,expectedRevision:revision,provider:generationProvider,referenceIdsByPanel:Object.fromEntries(panelIds.map(pid=>[pid,panelReferenceIds(project,project.pages.flatMap(p=>p.panels).find(f=>f.id===pid))]))};
    if(generationProvider==='jimeng'){payload.model=generationModel;payload.mode=action==='edit'?'i2i':generationMode;for(const name of ['ratio','resolution']){const value=$('#generation-'+name)?.value;if(value)payload[name]=value;}}
    if(action==='edit'){
      const owner=project.pages.find(p=>p.panels.some(f=>f.id===panelIds[0])),snapshot=clone(owner),frame=snapshot.panels.find(f=>f.id===panelIds[0]),b=bounds(frame),left=Math.max(0,Math.floor(frame.x+b.x)),top=Math.max(0,Math.floor(frame.y+b.y)),right=Math.min(snapshot.width,Math.ceil(frame.x+b.x+b.w)),bottom=Math.min(snapshot.height,Math.ceil(frame.y+b.y+b.h));
      if(right<=left||bottom<=top)throw new Error('格子不在当前页面内');
      const region={x:left,y:top,w:right-left,h:bottom-top};snapshot.bubbles=[];frame.feather=0;delete frame.featherEdges;delete frame.mask;delete frame.gradient;
      toast('正在准备当前格子的局部重绘底图');payload.basePanelDataUrl=(await pageCanvas(snapshot,{region})).toDataURL('image/png');payload.baseRegion=region;
    }
    verifyTarget();if(episodeBatch){await api('/api/episode-generation-batches','POST',{...payload,...episodeBatch});await refreshState();toast('已开启本话自动提交：按并发数分批，每批结束后随机间隔 1–3 分钟');return;}const created=await api('/api/jobs','POST',payload);rememberSubmission(targetProjectId,created);jobs.push(...created);await refreshState();toast(`${generationProvider==='jimeng'?'即梦':'Codex'}任务已进入队列`);
  }finally{panelIds.forEach(id=>submitting.delete(id));renderCandidates();renderCanvas();}
}
async function refreshState(){
  const previousJobs=new Map(jobs.map(job=>[job.id,job.status]));
  const data=await stateSync.fetch();if(data.storageWarning&&data.storageWarning!==storageWarningShown){storageWarningShown=data.storageWarning;toast(data.storageWarning,true);}else if(!data.storageWarning)storageWarningShown=null;projects=data.projects;deletedProjects=data.deletedProjects||[];assets=data.assets;jobs=data.jobs;scheduler=data.scheduler||scheduler;
  const saved=projects.find(p=>p.id===project?.id);
  if(repairApplying){renderProjectPicker();renderJobs();return;}
  if(saved){const decision=applyServerRevision(saved);if(conflictNotice===null&&!saving&&!dirty&&!hasLocalEditing()&&(decision==='adopt-revision'||decision==='ignore'&&saved.revision===project.revision))protectImages(saved);}
  else if(project&&!dirty&&!saving){await chooseProject(projects[0]||null);}
  else if(project&&deletedProjects.some(p=>p.id===project.id)&&deletedProjectNotice!==project.id){deletedProjectNotice=project.id;toast('项目已在其他窗口删除；当前未保存修改仍保留，可导出工程备份。',true);}
  else if(!project&&projects.length&&!projectClosed){await chooseProject(projects[0]);}
  if(jobs.some(job=>job.provider==='codex'&&['failed','done','completed','succeeded'].includes(job.status)&&previousJobs.get(job.id)!==job.status)){try{status=await api('/api/codex/status');updateConnectionLabel();}catch{}}
  renderProjectPicker();renderJobs();renderCandidates();renderCanvas();productionUI.refresh();
}
async function openProjectManager(){
  await flushSave();await refreshState();closeModal();
  modal('项目管理',projectManagerMarkup({projects,deletedProjects,currentProjectId:project?.id,jobs}),[{label:'关闭',run:closeModal}]);
}
async function confirmProjectDeletion(projectId){
  await flushSave();await refreshState();
  const target=projects.find(item=>item.id===projectId);if(!target)throw new Error('项目已删除，请刷新项目管理');
  closeModal();
  modal('删除项目','<p>将“<strong>'+escape(target.title)+'</strong>”移入已删除项目？</p><p>'+target.pages.length+' 页 · '+target.shots.length+' 个镜头。排版、图片和镜头资料会保留，可以在项目管理中恢复。</p>',[{label:'取消',run:openProjectManager},{label:'删除项目',primary:true,run:async()=>{
    await api('/api/projects/'+target.id,'DELETE',{expectedRevision:target.revision});
    closeModal();await refreshState();await openProjectManager();toast('项目已移入已删除项目，可以恢复。');
  }}]);
}
async function confirmProjectPurge(projectId){
  await flushSave();await refreshState();const target=deletedProjects.find(item=>item.id===projectId);if(!target)throw Error('已删除项目不存在，请刷新项目管理');
  const plan=await api('/api/projects/'+projectId+'/purge');closeModal();
  const size=plan.bytes<1024*1024?Math.ceil(plan.bytes/1024)+' KB':(plan.bytes/1024/1024).toFixed(1)+' MB';
  modal('彻底删除项目','<p>彻底删除“<strong>'+escape(plan.title)+'</strong>”？删除后无法恢复。</p><p>将清理本机项目存档、备份和专属文件，共 '+plan.files+' 个文件，约 '+size+'。</p><p>其他项目共用的图片、原始导入文件夹及墨库原件会保留。</p>',[{label:'取消',run:openProjectManager},{label:'确认彻底删除',primary:true,run:async()=>{
    const result=await api('/api/projects/'+projectId+'/purge','POST',{expectedRevision:plan.revision,confirmation:plan.title,planToken:plan.token});closeModal();if(project?.id===projectId)await chooseProject(null);await refreshState();await openProjectManager();toast('项目已彻底删除，已清理 '+result.removedFiles+' 个本机文件。');
  }}]);
}

const numericDrafts=new Map();
function applyBatchInspectorField(input,preview){
 const kind=input.dataset.batchKind,key=input.dataset.field;
 const value=input.type==='number'||input.dataset.valueType==='number'?Number(input.value):input.value;
 if(input.value===''||input.type==='number'&&!Number.isFinite(input.valueAsNumber)||['borderColor','outlineColor','textColor'].includes(key)&&!/^#[a-f0-9]{6}$/i.test(value)){if(!preview&&input.value!=='')toast('请输入有效的样式值',true);return;}
 const before=numericDrafts.get(input)||layoutEditSnapshot(project);
 try{applyBatchStyle(project,selectedLayerIds,kind,key,value);}catch(error){if(!preview)toast(error.message,true);return;}
 if(preview&&!numericDrafts.has(input))numericDrafts.set(input,before);
 if(['borderColor','outlineColor','textColor'].includes(key))for(const partner of $('#inspector-body').querySelectorAll('[data-batch-kind="'+kind+'"][data-field="'+key+'"]'))if(partner!==input)partner.value=value;
 if(preview){scheduleSave();queueBatchPreview();}else{if(batchPreviewFrame!==null){cancelAnimationFrame(batchPreviewFrame);batchPreviewFrame=null;}numericDrafts.delete(input);commit(before);}
}
async function setSelectedBubbleStyle(styleId,{ownerProjectId=project?.id,bubbleId=selected()?.id,isCurrent=()=>true}={}){
 const style=bubbleMaterials.find(style=>style.id===styleId);if(!style&&!styleId.startsWith('shape:'))throw Error('气泡素材款式不存在');
 let target=project?.id===ownerProjectId?findLayer(project,bubbleId):null;
 if(target?.type!=='bubble'||target.item.locked||project.pages.find(p=>p.id===target.pageId)?.locked)throw Error('请先选择并解锁气泡与画板');
 let textureAssetId;
 if(style?.texture){
  if(style.assetId&&style.revisionId){const imported=await api('/api/library/import','POST',{assetId:style.assetId,revisionId:style.revisionId});mergeImageAssets([imported.asset]);textureAssetId=imported.asset.id;}
  else{const result=await api('/api/comic-style-library/register','POST',{ids:[styleId]});mergeImageAssets(result.assets);textureAssetId=result.assets.find(asset=>asset.comicStyleId===styleId)?.id;if(!textureAssetId)throw Error('气泡纹理无法读取，请恢复素材库后重试');}
 }
 await document.fonts.ready;
 if(!isCurrent())return;
 target=project?.id===ownerProjectId?findLayer(project,bubbleId):null;
 if(target?.type!=='bubble')throw Error('原气泡或工程已变化，请重新选择');
 if(target.item.locked||project.pages.find(p=>p.id===target.pageId)?.locked)throw Error('请先解锁气泡与画板');
 finishInspectorDrafts();
 edit(()=>replaceBubble(changeBubbleStyle(measurement,target.item,styleId,textureAssetId),target.pageId),{operation:'bubble.material'});
}
function chooseBubbleMaterial(){
 const bubble=selected();if(selection?.type!=='bubble'||!bubble||isLibrarySfx(bubble))return;
 if(bubble.locked){toast('请先解锁气泡',true);return;}
 const ownerProjectId=project.id,bubbleId=bubble.id;
 openBubbleMaterialPicker({bubble:clone(bubble),modal,closeModal,api,onPick:async(styleId,isOpen)=>{
  await setSelectedBubbleStyle(styleId,{ownerProjectId,bubbleId,isCurrent:isOpen});
 }});
}
function applyInspectorField(event,preview=false){
  const input=event.target;if(!input.isConnected){numericDrafts.delete(input);return;}
  if(selected()?.locked&&input.dataset.field!=='locked'&&input.dataset.section!=='brush')return;

  if(input.dataset.section==='bubble'&&input.dataset.field==='shape'&&input.value==='asset'){input.value=selected()?.shape??'';chooseBubbleMaterial();return;}
  if(input.matches('[data-space-edit-height],[data-space-edit-color]')){if(preview)return;try{const item=selected();if(!item?.stripSpace)return;changeStripSpace(input.hasAttribute('data-space-edit-height')?input.valueAsNumber:item.h,input.hasAttribute('data-space-edit-color')?input.value:item.gradient.startColor);}catch(error){toast(error.message,true);renderInspector();}return;}
  if(input.id==='point-select'||input.dataset.section==='bubble-node-index'){nodeIndex=Number(input.value);renderInspector();renderCanvas();return;}
  if(input.id==='shape-preset'){try{frameShapeUI.setShape(input.value,selected());}catch(error){toast(error.message,true);}return;}
  if(!input.dataset.field)return;if(input.dataset.section==='batch-style'){applyBatchInspectorField(input,preview);return;}if(input.dataset.section==='brush'){const key=input.dataset.field;let value=key==='mode'?input.value:input.valueAsNumber;if(key!=='mode'&&(!Number.isFinite(value)||value<Number(input.min)||value>Number(input.max)))return;brush[key]=['hardness','opacity'].includes(key)?value/100:value;return;}const section=input.dataset.section,key=input.dataset.field,item=selected(),owner=selectionOwner();
  const target=section==='project'?project:section==='page'?page():section==='shot'?shotFor(item):section==='panel-generation'?item?.generation:item;if(!target)return;
  const old=numericDrafts.get(input)||layoutEditSnapshot(project);if(preview&&!numericDrafts.has(input))numericDrafts.set(input,old);if(!preview)numericDrafts.delete(input);
  let value=input.type==='checkbox'?input.checked:['number','range'].includes(input.type)?input.valueAsNumber:input.dataset.valueType==='number'?Number(input.value):input.value;
  if((['number','range'].includes(input.type)||input.dataset.valueType==='number')&&(!Number.isFinite(value)||(input.min!==''&&value<Number(input.min))||(input.max!==''&&value>Number(input.max)))){if(!preview){toast('数值超出范围',true);renderInspector();}return;}
  if(['borderColor','outlineColor','fillColor','textColor','startColor','endColor'].includes(key)){
    if(!/^#[0-9a-f]{6}$/i.test(value)){if(!preview)toast('颜色请使用 # 加六位 HEX 值，例如 #111111',true);return;}
    for(const partner of $('#inspector-body').querySelectorAll(`[data-field="${key}"]`))if(partner!==input)partner.value=value;
  }
  if(section==='bubble'&&key==='fillOpacity')value/=100;
  try{
    if(section==='image-transform'){if(!item.imageAssetId)throw Error('请先填入图片');if(key==='scale')scaleArtwork(item,assetMap().get(item.imageAssetId),value);else if(key==='rotation')item.imageTransform={...(item.imageTransform||fitImage(item,assetMap().get(item.imageAssetId))),rotation:value};}
    else if(section==='feather'){for(const partner of $('#inspector-body').querySelectorAll(`[data-section="feather"][data-field="${key}"]`))if(partner!==input){if(partner.type==='range'&&Number(partner.max)<value)partner.max=String(Math.ceil(value/500)*500);partner.value=value;}item.featherEdges={...featherEdges(item),[key]:value};item.feather=0;}
    else if(section==='gradient-layer'&&isStripBackground(item)&&['x','w'].includes(key)){if(item.stripSpace){item.x=0;item.w=COMIC_PAGE_WIDTH;}else{item.freeGradientRegion=true;item[key]=value;}}
    else if(section==='gradient-layer'&&key==='coverage'){if(value==='area'){const material=gradientFrame(item,layoutLongStrip(project.pages));Object.assign(item,material);}else{delete item.mask;delete item.featherEdges;item.feather=0;}item.coverage=value;}
    else if(section==='mask'){item.mask={...(item.mask||{strokes:[]}),[key]:value};}
    else if(section==='gradient-stop'){updateGradientStop(item.gradient,Number(input.dataset.stopIndex),key,key==='color'?value:key==='opacity'?value/100:key==='feather'?value:value/100);}
    else if(section==='gradient'){item.gradient={...(item.gradient||defaultGradient()),[key]:key==='opacity'?value/100:value};if(item.gradient.stops&&key==='mode'){const stops=structuredClone(gradientStops(item.gradient));stops.at(-1).opacity=value==='transparent'?0:1;item.gradient.stops=stops;}if(key==='angle'){delete item.gradient.angle;setGradientAngle(item,value);}}
    else if(section==='bubble-parent'){assignBubbleToPanel(project,item.id,value);}
    else if(section==='panel'&&['x','y'].includes(key)){if(!movePanelGroup(project,item.id,{x:key==='x'?value:item.x,y:key==='y'?value:item.y}))throw new Error('请先解锁镜头组中的图层');}
    else if(section.startsWith('bubble')){let next=bubbleFieldChange(item,section,key,value,nodeIndex,(section==='bubble-tail'||section==='bubble-textbox'||section.startsWith('bubble-part-')||section==='bubble'&&['w','h'].includes(key))?bubbleLayout(measurement,item):undefined);if(key==='productionBoxKind'){const defaults=resolveProductionStyle(project,productionBubbleSegment(project,item,owner));applyProductionStyle(next,{boxes:{[value]:defaults.boxes?.[value]||{styleId:'default'}}});}if(next.autoLettering)next.autoLettering.mode='manual';replaceBubble(next,owner.id);}
    else if(section==='node'){const points=clone(item.points);points[nodeIndex][key]=value/100;if(!validPolygon(points))throw new Error('边线不能交叉，格子需要保留面积');item.points=points;tool='nodes';}
    else if(section==='panel-prompt'){if(selection?.type!=='panel')return;ensurePanelGeneration(project,item,assets);setPanelPromptText(item,value);const status=$('#inspector-body').querySelector('[data-prompt-edit-status]'),restore=$('#inspector-body').querySelector('[data-action="restore-panel-prompt"]');if(status)status.textContent='本格已修改';if(restore)restore.hidden=false;}
    else if(section==='page'&&key==='height')resizePageHeight(target,validatePageHeight(value));
    else target[key]=value;
    if(section==='gradient-layer'){const layout=layoutLongStrip(project.pages);if(key==='y'&&item.assistantLayoutAnchor)item.assistantLayoutAnchor.y=item.y-(layout.pages.find(e=>e.pageId===item.assistantLayoutAnchor.pageId)?.y||0);constrainProjectGradients(project);}
  }catch(error){if(!preview){toast(error.message,true);renderInspector();}return;}
  if(preview){scheduleSave();renderCanvas();renderSidebar();refreshHistoryButtons();if(section==='panel-prompt')renderCandidates();}else commit(old,{inspector:section==='gradient-layer'||key==='locked'||section==='panel'&&['w','h'].includes(key)||key==='shotId'||section.startsWith('bubble')||(section==='gradient'&&key==='mode')||!!item?.stripSpace});
}
$('#panel-info-toggle').addEventListener('click',()=>{showPanelInfo=!showPanelInfo;renderCanvas();});
$('#panel-notes-toggle').addEventListener('click',()=>{showPanelNotes=!showPanelNotes;localStorage.setItem('comic-panel-notes-visible',String(showPanelNotes));renderCanvas();});
$('#inspector-body').addEventListener('change',event=>applyInspectorField(event));
$('#inspector-body').addEventListener('input',event=>{if(['number','range'].includes(event.target.type)||event.target.type==='color'||event.target.dataset.field==='borderColor'||event.target.matches('textarea[data-field],input[type=text][data-field],input:not([type])[data-field]'))applyInspectorField(event,true);});
$('#inspector-body').addEventListener('focusout',event=>{if(numericDrafts.has(event.target))applyInspectorField(event);});
window.addEventListener('blur',()=>{if(drag||bubbleGesture||paintBefore||multiGesture)return;quickUI?.finish();finishInspectorDrafts();});
document.addEventListener('click',safely(async event=>{
  if(!event.target.closest('#inspector-body,[data-image-controls],.dialogue-manager'))return;
  const candidate=event.target.closest('[data-candidate]');if(candidate){await attachImage(candidate.dataset.candidate);return;}const button=event.target.closest('[data-action]');if(!button)return;const action=button.dataset.action,item=selected();if(event.target.closest('.dialogue-manager')&&action!=='restore-dialogue-archive')closeModal();
  if(action==='open-original-image'){if(!button.disabled&&item?.imageAssetId)window.open(assetUrl(item.imageAssetId),'_blank','popup=yes,width=1200,height=900,noopener,noreferrer');return;}
  if(action==='generate-current-panel'){if(!button.disabled)await generateCurrentPanel();return;}

  if(action==='cutout-above'||action==='cutout-below'){if(!isCutoutLayer(item))return;edit(()=>setCutoutPosition(project,item,action==='cutout-above'?'above':'below'),{operation:'cutout.stack'});return;}
  if(action==='gradient-add-midpoint'||action==='gradient-remove-midpoint'){if(!item?.gradient||item.locked||item.stripSpace)return;edit(()=>{if(action==='gradient-add-midpoint')addGradientMidpoint(item.gradient);else{const stops=gradientStops(item.gradient);item.gradient.stops=[structuredClone(stops[0]),structuredClone(stops.at(-1))];}},{operation:'gradient.stops'});return;}
  if(action==='choose-speaker-avatar'){chooseSpeakerAvatar();return;}
  if(action==='asset-open'||action==='asset-open-source'){await episodeAssetsUI.openTarget(item.id,button.dataset.needId,action==='asset-open-source'?'source':'current');return;}
  if(action==='choose-panel-references'){choosePanelReferences();return;}
  if(action.startsWith('production-reference-')){await productionReferenceAction(button);return;}
  if(action==='process-panel-references'){if(item)await episodeAssetsUI.openTarget(item.id,undefined,'moku');return;}
  if(action==='reference-processing-report'){showReferenceProcessingResult(planPanelReferenceProcessing(project,item,assets));return;}
  if(action==='move-panel-reference'){
   if(selection?.type!=='panel'||!item)return;if(item.locked||selectionOwner()?.locked)throw new Error('请先解锁画格和画板');
   if(item.productionSegment||item.productionBackground)throw new Error('制作资料附图按原顺序使用');
   const visible=panelReferenceIds(project,item),index=visible.indexOf(button.dataset.referenceId),direction=Number(button.dataset.direction),next=index+direction;
   if(index<0||![-1,1].includes(direction)||next<0||next>=visible.length)return;
   const ids=Array.isArray(item.referenceIds)?[...item.referenceIds]:[...visible],a=ids.indexOf(visible[index]),b=ids.indexOf(visible[next]);
   if(a<0||b<0)throw new Error('参考列表已变化，请重新操作');[ids[a],ids[b]]=[ids[b],ids[a]];
   edit(()=>setPanelReferences(item,ids,{project,assets}),{operation:'panel.references.order'});return;
  }
  if(action==='remove-panel-reference'||action==='inherit-panel-references'){
   if(selection?.type!=='panel'||!item)return;if(item.locked||selectionOwner()?.locked)throw new Error('请先解锁画格和画板');
   if(item.productionSegment||item.productionBackground)throw new Error('制作资料附图请在本话资产中调整');
   const ids=action==='inherit-panel-references'?null:(Array.isArray(item.referenceIds)?item.referenceIds:panelReferenceIds(project,item)).filter(id=>id!==button.dataset.referenceId);
   edit(()=>setPanelReferences(item,ids,{project,assets}),{operation:'panel.references'});return;
  }
  if(action==='sfx-image-crop'&&isSfxImage(item)){tool='image';renderCanvas();renderInspector();return;}
  if(action==='crop-image'){if(selection?.type!=='panel'||!item?.imageAssetId||item.locked)return;tool='image';renderCanvas();renderInspector();return;}
  if(action==='mirror-image'||action==='mirror-image-vertical'){if(selection?.type!=='panel'||!item?.imageAssetId)return;if(item.locked)throw new Error('请先解锁画面');const axis=action==='mirror-image'?'horizontal':'vertical';edit(()=>toggleArtworkMirror(item,fitImage(item,assetMap().get(item.imageAssetId)),axis),{source:'manual',operation:'image.mirror-'+axis});return;}
  if(action==='rotate-image-left'||action==='rotate-image-right'){if(selection?.type!=='panel'||!item?.imageAssetId)return;if(item.locked)throw Error('请先解锁画面');edit(()=>{const t=item.imageTransform||fitImage(item,assetMap().get(item.imageAssetId));item.imageTransform={...t,rotation:((artworkAngle(t)+(action.endsWith('left')?-90:90)+540)%360)-180};tool='image';},{operation:'image.rotation'});return;}
  if(action==='move-panel'||action==='free-panel'){if(selection?.type!=='panel'||!item)return;if(item.locked)throw new Error('请先解锁格子');tool=action==='free-panel'?'nodes':'move';nodeIndex=0;renderCanvas();renderInspector();if(action==='free-panel'){for(const name of ['advanced','nodes']){const detail=$('#inspector-body').querySelector('[data-inspector-section="'+name+'"]');if(detail)detail.open=true;}}return;}
  if(action==='generation-settings'){openGenerationSettings();return;}
  if(action==='restore-panel-prompt'){if(selection?.type!=='panel'||!item||item.locked)return;finishInspectorDrafts();edit(()=>restorePanelPromptText(item),{operation:'panel.prompt-restore'});return;}
  if(action==='sfx-choose-style'){libraryUI.open({kind:'sfx'});return;}
  if(action==='bubble-choose-material'){chooseBubbleMaterial();return;}
  if(action==='bubble-pick-style'){
   if(selection?.type!=='bubble'||!item)return;
   const ownerProjectId=project.id,bubbleId=item.id,grid=button.closest('[data-bubble-style-grid]');
   if(grid?.dataset.busy)return;if(grid){grid.dataset.busy='1';for(const choice of grid.querySelectorAll('button'))choice.disabled=true;}
   try{await setSelectedBubbleStyle(button.dataset.bubbleStyle,{ownerProjectId,bubbleId,isCurrent:()=>project?.id===ownerProjectId&&selected()?.id===bubbleId});}
   finally{if(grid?.isConnected){delete grid.dataset.busy;renderInspector();}}
   return;
  }
  if(action==='sfx-redesign'){const ownerProject=project.id,targetId=item.id,text=item.text;openComicSfxDesigner({word:text,api,toast,onUse:asset=>{const target=project?.id===ownerProject?findLayer(project,targetId)?.item:null;if(!target||target.text!==text)throw Error('原字效或工程已变化，设计结果已保留到素材库');mergeImageAssets([asset]);edit(()=>applyEffectVisual(target,{id:'custom-'+asset.id,word:asset.word,label:asset.name,width:asset.width,height:asset.height,assetId:asset.id}),{operation:'sfx.redesign.apply'});}});return;}
  if(action==='gradient-fit-strip'){if(selection?.type!=='gradient'||item.locked||item.stripSpace)return;edit(()=>{const oldX=item.x,oldW=item.w,g=item.gradient;g.start={...g.start,x:(oldX+g.start.x*oldW)/1280};g.end={...g.end,x:(oldX+g.end.x*oldW)/1280};item.x=0;item.w=1280;item.coverage='area';item.stripBackground=true;item.freeGradientRegion=false;},{operation:'gradient.fit-width'});return;}
  if(action==='remove-strip-space')return changeStripSpace(0);
  if(action==='reset-feather')return edit(()=>{item.feather=0;item.featherEdges={top:0,bottom:0,left:0,right:0};});
  if(action==='clear-mask')return edit(()=>{item.mask={enabled:true,strokes:[]};});
  if(action==='undo-mask-stroke')return edit(()=>{item.mask?.strokes.pop();});
  if(action==='mask-paint'||action==='gradient-draw'){tool=tool===(action==='mask-paint'?'mask':'gradient')?'move':action==='mask-paint'?'mask':'gradient';renderCanvas();renderInspector();return;}

  if(action==='migrate-page-width'){
    const owner=page(),factor=COMIC_PAGE_WIDTH/owner.width,nextHeight=validatePageHeight(Math.round(owner.height*factor));
    modal('等比迁移到 1280 px',`<p>${escape(owner.name)}：${owner.width} × ${owner.height} → ${COMIC_PAGE_WIDTH} × ${nextHeight} px。</p><p>镜头、图片取景和气泡外框按比例调整，文字保留原字号和分行。此操作可撤销。</p>`,[{label:'取消',run:closeModal},{label:'等比迁移',primary:true,run:()=>{edit(()=>rescalePageWidth(owner,COMIC_PAGE_WIDTH));closeModal();toast('当前页已等比迁移到 1280 px');}}]);return;
  }
  if(action==='bubble-add-dialogue'){edit(()=>replaceBubble(addDialogueSegment(item),selectionOwner().id),{operation:'bubble.add-dialogue'});$('#inspector-body textarea[data-section="bubble-segment-1"]')?.focus();return;}
  if(action==='bubble-join-lines')return edit(()=>{item.text=joinDialogueLines(item.text);item.lineBreakMode='auto';item.textFlowVersion=1;delete item.textLayout;},{operation:'bubble.join-lines'});
  if(action==='bubble-reset-textbox')return edit(()=>{dialogueSegments(item).forEach((s,i)=>{s.textBox=defaultDialogueBox(item,i);delete s.independentBox;delete s.textLayout;});delete item.textBox;delete item.textLayout;delete item.textFrameLayout;});
  if(action==='bubble-fit-text')return edit(()=>{const owner=selectionOwner();replaceBubble(fitBubbleToTextFrame(measurement,item),owner.id);},{source:'automatic',operation:'bubble.auto-fit'});
  if(action==='episode-bubble-fit-text')return fitCurrentEpisodeBubbles();
  if(action==='bubble-fit-current-layout')return fitSelectedBubbleToLayout();
  if(action==='bubble-fit-preserve-layout')return fitSelectedBubbleToLayout({preserve:true});
  if(action==='merge-selected-layers'){
   const projectId=project.id,layerIds=[...selectedLayerIds];if(layerIds.length<2)return;
   await flushSave();if(project.id!==projectId)return;
   const dialog=$('#modal'),close=$('#modal-close'),prevent=event=>event.preventDefault();
   modal('正在合并图层','<p role="status">正在按原有叠放顺序合成图片…</p>',[]);close.disabled=true;dialog.addEventListener('cancel',prevent);
   try{const result=await api('/api/projects/'+projectId+'/merge-layers','POST',{layerIds,expectedRevision:project.revision});mergeImageAssets([result.asset]);await acceptImportedProject(result.project,{message:null});const entry=findLayer(project,result.layerId);if(entry){pageId=entry.pageId;setSelectionKeys([result.layerId]);tool='move';render();}toast('已合并 '+layerIds.length+' 个图层，可撤销；原图文件保留');}
   finally{dialog.removeEventListener('cancel',prevent);close.disabled=false;closeModal();}return;
  }
  if(action==='episode-bubble-styles'){productionUI.openStyles('episode','styles');return;}
  if(action==='dialogue-manager'){productionUI.openStyles('screen');return;}
  if(action==='apply-art-style'){await flushSave();const status=$('#inspector-body').querySelector('[data-art-style-status]');if(status)status.textContent=project.style.trim()?'已保存，后续生图统一使用此画风':'已清除统一画风';toast(project.style.trim()?'统一画风已应用到后续生图':'已清除统一画风');return;}
  if(action==='multi-clear'){setSelectionKeys([]);renderCanvas();renderSidebar();renderInspector();return;}
 if(action==='multi-visible'||action==='multi-lock'){const entries=selectedLayers(project,selectedLayerIds),field=action==='multi-visible'?'visible':'locked',value=field==='visible'?!entries.some(e=>e.item.visible):!entries.some(e=>e.item.locked);edit(()=>{for(const entry of entries)entry.item[field]=value;});return;}
 if(action==='gradient-bounds'){tool='move';renderCanvas();renderInspector();return;}
  if(action==='bubble-add-node'||action==='bubble-delete-node')return edit(()=>{const next=applyBubbleEdit(item,{type:action==='bubble-add-node'?'insert-point':'remove-point',index:nodeIndex});replaceBubble(next,selectionOwner().id);nodeIndex=Math.min(nodeIndex,next.points.length-1);});
  if(action==='add-node')return addNode(nodeIndex);if(action==='delete-node')return deleteNode();if(action==='to-rectangle')return toRectangle();
  if(action==='delete-image-candidate'){if(selection?.type!=='panel'||!item||item.locked||activeJob(item)||submitting.has(item.id))throw Error('画格锁定或正在生成，请稍后操作');await attachImage(button.dataset.imageAsset,{action:'remove-candidate'});toast('已从这个画格移除图片');return;}
  if(action==='replace-image-candidate'){if(selection?.type!=='panel'||!item||item.locked||activeJob(item))throw Error('画格锁定或正在生成，请稍后操作');const targetProject=project.id,targetPanel=item.id,previous=button.dataset.imageAsset;libraryUI.open({kind:'image',onSelect:async asset=>{if(project?.id!==targetProject||selected()?.id!==targetPanel)throw Error('画格已切换，请在当前画格重新选择');await attachImage(asset.id,{replaceCandidateId:previous});}});return;}
  if(action==='upload-local-image'){await uploadLocalPanel();return;}if(action==='paste-local-image'){await panelImageInput.paste();return;}if(action==='upload-image'){chooseLocalImages('panel');return;}if(action==='relink-image'){chooseLocalImages('panel',{relink:true});return;}if(action==='clear-image'){if(!item?.imageAssetId||item.locked||activeJob(item))return;return attachImage(item.imageAssetId,{action:'remove-candidate'});}
  if(action==='fit-image'||action==='reset-image'){if(selection?.type!=='panel'||!item?.imageAssetId)return;if(item.locked)throw Error('请先解锁画面');edit(()=>item.imageTransform=fitArtwork(item,assetMap().get(item.imageAssetId),{reset:action==='reset-image'}),{operation:action==='reset-image'?'image.reset':'image.fit'});return;}
      if(action.startsWith('zoom-image')){edit(()=>{const transform=item.imageTransform,b=bounds(item),factor=action.endsWith('in')?1.12:1/1.12,cx=b.x+b.w/2,cy=b.y+b.h/2;transform.x=cx+(transform.x-cx)*factor;transform.y=cy+(transform.y-cy)*factor;transform.scale=clamp(transform.scale*factor,Number.MIN_VALUE,Number.MAX_SAFE_INTEGER);});return;}
  if(action==='generate')return generateFrames([item.id]);
  if(action==='dialogue-to-page')return addBubble(item?.generation?.dialogue||shotFor(item)?.dialogue||'填写对白');
  if(action==='layer-up'||action==='layer-down'){moveCurrentLayerOrder(action==='layer-up'?1:-1);return;}
  if(action==='rename-project'){modal('漫画名称',`<label>名称<input id="rename-title" value="${escape(project.title)}" maxlength="180"></label>`,[{label:'保存',primary:true,run:()=>{const title=$('#rename-title').value.trim();if(!title)throw new Error('名称不能为空');edit(()=>project.title=title);projects.find(p=>p.id===project.id).title=title;renderProjectPicker();closeModal();}}]);return;}
  if(action==='restore-dialogue-archive'){modal('原文归档','<p>这些审定原文已从画面移除，内容和出处保留。可以恢复到当前页面。</p><div class="dialogue-archive-list">'+(project.archivedBubbles||[]).map(b=>'<article><p>'+escape(b.text)+'</p><small>'+escape(b.archivedFrom.pageName)+'</small><button data-restore-archived="'+b.id+'">恢复到当前页</button></article>').join('')+'</div>',[{label:'关闭',run:closeModal}]);for(const button of document.querySelectorAll('[data-restore-archived]'))button.addEventListener('click',safely(()=>{edit(()=>{const b=restoreArchivedDialogue(project,button.dataset.restoreArchived,pageId);selection={type:'bubble',id:b.id,pageId};});closeModal();toast('原文已恢复，内容和出处保留');}));return;}
  if(action==='delete-page'&&episodePages(project,page()).length>1){edit(()=>{const number=currentBoardEpisode(project,page());project.pages=project.pages.filter(p=>p.id!==pageId);pageId=project.pages.find(p=>pageEpisode(project,p)===number).id;selection=null;});return;}
}));

function visibleEditingPage(){
 const state=viewport.snapshot(),middle=state.window.logicalTop+state.window.logicalVisibleHeight/2;
 const entries=state.layout.pages.filter(e=>project.pages.some(p=>p.id===e.pageId));
 const entry=entries.find(e=>middle>=e.y&&middle<e.endY)||entries.sort((a,b)=>Math.abs((a.y+a.endY)/2-middle)-Math.abs((b.y+b.endY)/2-middle))[0];
 return project.pages.find(p=>p.id===entry?.pageId)||page();
}
function addPanel(shotId=''){if(!project)return;let frame,owner;edit(()=>{owner=visibleEditingPage();frame=panel(shotId,Math.round((owner.width-500)/2),Math.max(0,Math.round((owner.height-500)/2)),500,500);owner.panels.push(frame);pageId=owner.id;selection={type:'panel',id:frame.id,pageId:owner.id};selectedLayerIds.clear();selectedLayerIds.add(frame.id);nodeIndex=0;tool='move';});viewport.scrollToPage(owner.id,{localY:Math.max(0,frame.y-100)});renderInspector();workbench.openInspector();}
function syncNodeActions(){const frame=selection?.type==='panel'?selected():null;for(const root of document.querySelectorAll('[data-node-controls]')){root.hidden=tool!=='nodes'||!frame;root.querySelector('[data-node-add]').disabled=!frame||frame.locked||frame.points.length>=64;root.querySelector('[data-node-delete]').disabled=!frame||frame.locked||frame.points.length<=3;}}
const panelImageInput=mountPanelImageInput({
 getTarget:()=>{const frame=selection?.type==='panel'?selected():null;return project&&frame&&!frame.cutoutLayer&&!frame.breakoutForeground&&!episodeBoardUI?.active&&!document.body.classList.contains('repair-workspace-active')?{projectId:project.id,panelId:frame.id,locked:frame.locked||selectionOwner()?.locked}:null;},
 isCurrent:target=>project?.id===target.projectId,
 upload:async(file,target)=>{await flushSave();if(project?.id!==target.projectId||selected()?.id!==target.panelId)throw Error('格子已切换，请重新选择图片');const dataUrl=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('无法读取图片'));reader.readAsDataURL(file);});if(project?.id!==target.projectId||selected()?.id!==target.panelId)throw Error('格子已切换，请重新选择图片');return api('/api/panel-images/import','POST',{...target,expectedRevision:project.revision,name:file.name||'粘贴图片'+({'image/png':'.png','image/jpeg':'.jpg','image/webp':'.webp'}[file.type]||'.png'),dataBase64:dataUrl.split(',')[1]});},
 onApply:async result=>{mergeImageAssets([result.asset]);await acceptIntegratedProject(result.project,{undoable:true});},canPasteLayer:()=>tool!=='insert-space'&&!episodeBoardUI?.active&&!document.body.classList.contains('repair-workspace-active')&&canPasteImageLayer(),pasteLayer:()=>pasteSelectedImageLayer(),toast
});
async function uploadLocalPanel(){panelImageInput.choose();}

function addSfx(text,preset){
 if(!project||!page())return;
 if(page().bubbles.length>=3200)return toast('当前画板文字层已达上限',true);
 edit(()=>{const view=documentView(project,viewState),top=view.offset+viewState.window.logicalTop,height=viewState.window.logicalVisibleHeight;
  const frame=selection?.type==='panel'?selected():null,entry=frame?view.layout.pages.find(e=>e.pageId===selection.pageId):null;
  const near=frame&&entry&&entry.y+frame.y*entry.scale+frame.h*entry.scale>top&&entry.y+frame.y*entry.scale<top+height;
  const visibleEntry=view.layout.pages.filter(e=>episodePages(project,page()).some(p=>p.id===e.pageId)).find(e=>e.y<=top+Math.min(height/3,180)&&e.endY>top+Math.min(height/3,180))||view.layout.pages.find(e=>e.pageId===pageId)||view.layout.pages[0];
  const p=near?selectionOwner():project.pages.find(p=>p.id===visibleEntry.pageId),localTop=(top-visibleEntry.y)/visibleEntry.scale;
  const layer=makeSfxLayer({id:id('bubble'),text,preset,page:p,frame:near?frame:null,visibleTop:Math.max(0,localTop),visibleHeight:height/visibleEntry.scale});
  p.bubbles.push(layer);project.layerOrder.push(layer.id);pageId=p.id;selection={type:'bubble',id:layer.id,pageId:p.id};tool='move';
 },{source:'manual',operation:'sfx.add'});workbench.openInspector();toast('已添加独立特效层，可关闭字库后拖动、缩放、旋转');
}
async function addSprintImage(asset,item){
 if(!project||!page())return;if(drag||bubbleGesture||paintBefore||multiGesture||numericDrafts.size)throw new Error('请先完成当前拖动或属性输入，再添加冲刺线');if(page().panels.length>=1000)throw new Error('当前画板图片层已达上限');mergeImageAssets([asset]);
 edit(()=>{const view=documentView(project,viewState),top=view.offset+viewState.window.logicalTop,height=viewState.window.logicalVisibleHeight;
  const frame=selection?.type==='panel'?selected():null,entry=frame?view.layout.pages.find(e=>e.pageId===selection.pageId):null;
  const near=frame&&entry&&entry.y+frame.y*entry.scale+frame.h*entry.scale>top&&entry.y+frame.y*entry.scale<top+height;
  const visibleEntry=view.layout.pages.filter(e=>episodePages(project,page()).some(p=>p.id===e.pageId)).find(e=>e.y<=top+Math.min(height/3,180)&&e.endY>top+Math.min(height/3,180))||view.layout.pages.find(e=>e.pageId===pageId)||view.layout.pages[0];
  const p=near?selectionOwner():project.pages.find(p=>p.id===visibleEntry.pageId),localTop=(top-visibleEntry.y)/visibleEntry.scale;
  if(p.panels.length>=1000)throw new Error('当前画板图片层已达上限');const layer=makeSfxImageLayer(asset,item,{id:id('panel'),page:p,frame:near?frame:null,visibleTop:Math.max(0,localTop),visibleHeight:height/visibleEntry.scale});
  p.panels.push(layer);project.layerOrder.push(layer.id);pageId=p.id;selection={type:'panel',id:layer.id,pageId:p.id};tool='move';nodeIndex=0;
 },{source:'manual',operation:'sfx.image.add'});workbench.openInspector();toast('已添加独立冲刺线，右侧可缩放、旋转、镜像和取景裁切');
}
function addVisualSfx(asset,style,targetFrame=null,targetPage=null){
 if(!project||!page())return;mergeImageAssets([asset]);const frame=targetFrame||(selection?.type==='panel'?selected():null),owner=targetPage||(frame?project.pages.find(p=>p.panels.some(item=>item.id===frame.id)):page());
 edit(()=>{const bubble=applyEffectVisual(makeSfxLayer({id:id('bubble'),text:style.word,page:owner,frame,visibleTop:(viewport.snapshot().window?.logicalTop||0)+(viewState?documentView(project,viewState).offset:0),visibleHeight:600}),{...style,assetId:asset.id});if(frame){bubble.shotId=frame.shotId;bubble.parentPanelId=frame.id;}bubble.sfxDemandOrigin='column';owner.bubbles.push(bubble);selection={type:'bubble',id:bubble.id,pageId:owner.id};},{operation:'sfx.asset.add'});toast('已加入独立PNG字效，可拖动、缩放和旋转');
}
function addMatchedSfx(pairs,registered){
 if(!project)return;mergeImageAssets(registered);let count=0;
 edit(()=>{for(const {demand,style} of pairs){const asset=registered.find(item=>item.comicStyleId===style.id)||assets.find(item=>item.id===style.assetId);if(!asset)continue;for(const occurrence of demand.occurrences){const owner=project.pages.find(p=>p.panels.some(frame=>frame.shotId===occurrence.shotId)),frame=owner?.panels.find(frame=>frame.shotId===occurrence.shotId);if(!frame)continue;const existing=owner.bubbles.find(b=>b.type==='sfx'&&normalizeSfxWord(b.text)===demand.word&&(b.shotId===occurrence.shotId||b.parentPanelId===frame.id));if(existing){applyEffectVisual(existing,{...style,assetId:asset.id});count++;continue;}const b=applyEffectVisual(makeSfxLayer({id:id('bubble'),text:demand.word,page:owner,frame,visibleTop:0,visibleHeight:600}),{...style,assetId:asset.id});b.shotId=occurrence.shotId;b.parentPanelId=frame.id;b.sfxDemandOrigin='column';owner.bubbles.push(b);count++;}}},{operation:'sfx.asset.batch'});toast('已为本话匹配 '+count+' 处独立字效，未匹配的字样可重新设计');
}
document.querySelectorAll('[data-open-sfx]').forEach(button=>button.addEventListener('click',()=>libraryUI.open({kind:'sfx'})));
function addBubble(text='填写对白'){dialoguePlacementUI?.open({customText:text});}
function addBubbleLayer(){
 if(!project||!page())return;
 // Reuse the normal bubble model, contour fitting, grouping and undo transaction.
 const frame=selection?.type==='panel'&&selectedLayerIds.size<=1?selected():null;
 const state=viewport.snapshot(),view=documentView(project,state),middle=view.offset+state.window.logicalTop+state.window.logicalVisibleHeight/2;
 const entry=view.layout.pages.find(e=>e.y<=middle&&e.endY>middle&&episodePages(project,page()).some(p=>p.id===e.pageId))||view.layout.pages.find(e=>e.pageId===pageId);
 const owner=frame?selectionOwner():project.pages.find(p=>p.id===entry?.pageId);
 if(!owner)return;
 if(owner.locked||frame?.locked)return toast('请先解锁画板或格子，再添加气泡',true);
 if(owner.visible===false||frame?.visible===false)return toast('请先显示画板或格子，再添加气泡',true);
 if(owner.bubbles.length>=3200)return toast('当前画板文字层已达上限',true);
 const row={key:'custom',text:'填写对白',kind:'speech',speaker:''};
 const settings={...placementSettings(project,owner),...TEXT_FONT_DEFAULTS,styleId:'builtin-oval',definition:undefined,localAssetId:undefined,fillOpacity:1,outlineWidth:2.8,tailVisible:true};
 const result=preparePlacement(measurement,row,settings,{pageWidth:owner.width});
 if(result.status!=='fitted')return toast('当前画板无法容纳气泡，请调整画板尺寸',true);
 const point=frame?{x:frame.x+frame.w/2,y:frame.y+frame.h/2}:{x:owner.width/2,y:Math.max(0,Math.min(owner.height,(middle-entry.y)/entry.scale))};
 dialoguePlacementUI?.pause();
 let placed;
 edit(()=>{placed=placePreparedDialogue(project,row,result.bubble,owner,point,frame);pageId=owner.id;selection={type:'bubble',id:placed.id,pageId};selectedLayerIds=new Set([placed.id]);tool='move';},{operation:'bubble.add'});
 select('bubble',placed.id,owner.id,{scroll:true,inspector:true});
 toast(frame?'已添加气泡，归入所选格子图层；可在右侧编辑文字':'已添加气泡，可在右侧编辑文字');
}
function addShot(){const shot={id:id('shot'),episode:currentBoardEpisode(project,page()),code:`S${String(project.shots.length+1).padStart(2,'0')}`,title:'新镜头',description:'填写这个镜头的画面内容',dialogue:'',referenceIds:[]};edit(()=>project.shots.push(shot));addPanel(shot.id);}
$('#page-list').addEventListener('click',event=>{const fixed=event.target.closest('[data-episode-board]');if(fixed){quickUI?.finish();tool='move';selection=null;selectedLayerIds.clear();episodeBoardUI.open(fixed.dataset.episodeBoard);return;}const button=event.target.closest('[data-page]');if(button){episodeBoardUI.close({render:false});pageId=button.dataset.page;selection=page().panels[0]?{type:'panel',id:page().panels[0].id,pageId}:null;nodeIndex=0;render();viewport.scrollToPage(pageId);}});
$('#layer-list').addEventListener('click',event=>{const remove=event.target.closest('[data-delete-upscale-layer]');if(remove){const entry=findLayer(project,remove.dataset.deleteUpscaleLayer);if(!entry||entry.item.cutoutLayer?.kind!=='upscale')return;if(entry.item.locked||entry.page?.locked)return toast('请先解锁高清图层和画板',true);const parentId=entry.item.cutoutLayer.parentPanelId;edit(()=>{deleteGroupedLayer(project,entry.item.id);if(selection?.id===entry.item.id){selection={type:'panel',id:parentId,pageId:entry.pageId};selectedLayerIds=new Set([parentId]);}});return;}const toggle=event.target.closest('[data-toggle-group]'),groupVisible=event.target.closest('[data-group-visible]'),groupLock=event.target.closest('[data-group-lock]');if(toggle){groupExpansion.set(toggle.dataset.toggleGroup,toggle.getAttribute('aria-expanded')!=='true');renderLayerList();return;}if(groupVisible||groupLock){const key=groupVisible?.dataset.groupVisible||groupLock.dataset.groupLock,field=groupVisible?'visible':'locked',entry=findLayer(project,key);if(entry)edit(()=>setGroupFlag(project,key,field,!entry.item[field]));return;}const row=event.target.closest('[data-layer]'),visible=event.target.closest('[data-visible]'),lock=event.target.closest('[data-lock]'),locate=event.target.closest('[data-locate-layer]');if(row)select(row.dataset.layerType,row.dataset.layer,null,{scroll:locateOnSelect&&!event.shiftKey&&!event.ctrlKey&&!event.metaKey,inspector:true,preserveView:!locateOnSelect,additive:event.shiftKey||event.ctrlKey||event.metaKey});else if(locate){const layer=findLayer(project,locate.dataset.locateLayer);select(layer.type,layer.item.id,null,{scroll:true,inspector:true});}else if(visible)edit(()=>{const item=findLayer(project,visible.dataset.visible)?.item;if(item)item.visible=!item.visible;});else if(lock)edit(()=>{const item=findLayer(project,lock.dataset.lock)?.item;if(item)item.locked=!item.locked;});});
$('#shot-list').addEventListener('click',event=>{const button=event.target.closest('[data-shot]');if(!button)return;for(const p of project.pages){const frame=p.panels.find(f=>f.shotId===button.dataset.shot);if(frame){pageId=p.id;select('panel',frame.id,p.id,{scroll:true,inspector:true});return;}}addPanel(button.dataset.shot);});
$('#reference-list').addEventListener('change',event=>{const input=event.target,assetId=input.dataset.refName||input.dataset.refRole;if(assetId)edit(()=>{const ref=project.references.find(r=>r.assetId===assetId);ref[input.dataset.refName?'name':'role']=input.value;});});
$('#reference-list').addEventListener('click',event=>{const remove=event.target.closest('[data-remove-ref]'),view=event.target.closest('[data-view-ref]');if(remove)edit(()=>{project.references=project.references.filter(r=>r.assetId!==remove.dataset.removeRef);project.shots.forEach(s=>s.referenceIds=s.referenceIds.filter(id=>id!==remove.dataset.removeRef));});else if(view){const asset=assetMap().get(view.dataset.viewRef);modal('参考图片',`<p class="sub-note" style="overflow-wrap:anywhere">${escape(asset?.filePath||'')}</p><img class="reference-preview" src="${assetUrl(view.dataset.viewRef)}" alt="参考图片">`,[{label:'从墨库替换',run:()=>{closeModal();chooseLocalImages('reference',{relink:true,assetId:view.dataset.viewRef});}},{label:'关闭',run:closeModal}]);}});
document.querySelectorAll('[data-tab]').forEach(button=>button.addEventListener('click',()=>{tab=button.dataset.tab;if(tab==='references')episodeAssetsUI?.open();else if(episodeAssetsUI?.active)episodeAssetsUI.close(false);document.querySelectorAll('[data-tab]').forEach(b=>b.classList.toggle('active',b===button));for(const name of ['pages','layers','shots','references','production'])$('#'+name+'-tab').hidden=name!==tab;$('#sidebar-heading').textContent=tab==='layers'?'图层管理':'页面与素材';if(tab==='layers'&&project){renderLayerList();revealSelectedLayer();}if(tab==='production')void productionUI.open().catch(e=>toast(e.message,true));}));
document.querySelectorAll('[data-tool]').forEach(button=>button.addEventListener('click',()=>{tool=button.dataset.tool==='nodes'&&tool==='nodes'?'rect':button.dataset.tool;renderCanvas();renderInspector();}));
const fitPortraitBoard=document.createElement('button');fitPortraitBoard.id='fit-portrait-board';fitPortraitBoard.textContent='整板';fitPortraitBoard.title='一键完整显示当前竖版画板，最大利用可视高度';$('#zoom').before(fitPortraitBoard);fitPortraitBoard.addEventListener('click',()=>{if(!project)return;workbench.closeSidebar();const tools=document.querySelector('#canvas-tools-toggle');if(tools?.getAttribute('aria-expanded')==='true')tools.click();$('#zoom').value='page';localStorage.setItem('comic-zoom-choice','page');renderCanvas();viewport.scrollToPage(pageId);});
$('#zoom').addEventListener('change',()=>{renderCanvas();localStorage.setItem('comic-zoom-choice',$('#zoom').value);});new ResizeObserver(()=>{if(window.innerWidth<=1000&&chromeState.sidebar&&chromeState.inspector)workbench.closeSidebar();if(project)renderCanvas();}).observe($('#canvas-scroll'));
$('#layer-add').addEventListener('click',()=>addPanel());$('#add-shot').addEventListener('click',addShot);$('#add-page').addEventListener('click',()=>edit(()=>{const old=page(),pages=episodePages(project,old),number=currentBoardEpisode(project,old),last=project.pages.indexOf(pages.at(-1)),p=makePage([],'overlay',COMIC_PAGE_WIDTH,old.height),cut=layoutLongStrip(project.pages).pages[last].endY;p.name='正文长图 '+(pages.length+1);p.storyboard={episode:number,projection:'manual'};for(const gradient of project.gradients||[])if(gradient.y>=cut)gradient.y+=p.height;project.pages.splice(last+1,0,p);pageId=p.id;selection=null;}));
$('#delete-layer').addEventListener('click',safely(()=>{if(selectedLayerIds.size>1)return deleteSelectedLayers();const item=selected();if(!item||item.locked)return;if(item.stripSpace)return changeStripSpace(0);if(selection.type==='panel'&&groupForLayer(project,item.id)?.members.some(e=>e.item.locked))return toast('请先解锁镜头组中的图层',true);edit(()=>{deleteGroupedLayer(project,item.id);selection=null;});}));
$('#page-settings').addEventListener('click',()=>{selection=null;renderCanvas();renderInspector();$('#inspector-panel').scrollTop=0;workbench.openInspector();});
$('#page-height-input').addEventListener('change',safely(event=>{const height=validatePageHeight(event.target.valueAsNumber);edit(()=>resizePageHeight(page(),height));}));
$('#undo').addEventListener('click',safely(()=>restoreHistory('undo')));$('#redo').addEventListener('click',safely(()=>restoreHistory('redo')));
$('#project-select').addEventListener('change',safely(async event=>{await flushSave();await chooseProject(await api('/api/projects/'+event.target.value));}));
$('#manage-projects').addEventListener('click',safely(openProjectManager));
$('#close-project').addEventListener('click',safely(async()=>{await flushSave();projectClosed=true;localStorage.setItem('comic-project-closed','true');localStorage.removeItem('comic-active-project');await chooseProject(null);closeWorkbenchMenus();toast('当前项目已关闭，工程和图片仍保留，可从项目菜单重新打开');}));
$('#new-project').addEventListener('click',()=>{
 let pending=false,created=null;
 modal('新建漫画工程','<label>漫画名称<input id="new-title" value="未命名漫画" maxlength="180"></label>',[{label:'取消',run:closeModal},{label:'创建',primary:true,run:async()=>{
  if(pending)return;pending=true;
  const input=$('#new-title'),buttons=[...$('#modal-actions').querySelectorAll('button')],submit=buttons.find(b=>b.classList.contains('primary')),title=input.value.trim()||'未命名漫画';
  input.disabled=true;for(const button of buttons)button.disabled=true;submit.textContent=created?'正在打开…':'正在创建…';
  try{
   if(!created){await flushSave();created=await api('/api/projects','POST',{title});projects.push(created);}
   await chooseProject(created);closeModal();
  }finally{pending=false;input.disabled=!!created;for(const button of buttons)button.disabled=false;submit.textContent=created?'打开工程':'创建';}
 }}]);
});
let projectFileSaving=false;
async function saveCurrentProjectFile(){if(!project||projectFileSaving)return;if(paintBefore||multiGesture||drag||bubbleGesture)throw Error('请先完成当前拖动，再保存工程');projectFileSaving=true;const projectId=project.id,title=project.title;try{document.activeElement?.blur();const binding=await projectFileBinding(projectId);const result=await saveProjectFile({projectId,title,binding,chooseFile:window.showSaveFilePicker?.bind(window),flushSave,exportProject:id=>api('/api/projects/'+id+'/export?compact=1','POST',{}),currentProjectId:()=>project?.id});if(!result.cancelled){await bindProjectFile(projectId,result.binding);toast('已保存 '+result.name+'；工程携带墨库固定版本或未入库图片原件，可跨机器打开');}}finally{projectFileSaving=false;}}
$('#save-project').addEventListener('click',safely(saveCurrentProjectFile));
$('#open-moku-project').addEventListener('click',safely(async()=>{$('#export-menu').hidden=true;await openMokuProject({api,flushSave,getProject:()=>project,toast,onImported:async(imported,{activate})=>{await refreshState();if(activate)await chooseProject(imported);}});}));
// Save also works while editing a text field; flushSave commits its draft first.
document.addEventListener('keydown',safely(async event=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'){event.preventDefault();if(event.repeat||event.isComposing)return;await saveCurrentProjectFile();}}),{capture:true});
$('#add-reference').addEventListener('click',safely(()=>chooseLocalImages('reference')));
$('#asset-directory').addEventListener('click',safely(()=>chooseDirectoryAssets('reference')));
$('#import-shots').addEventListener('click',()=>storyboardImportUI.openImport());
$('#modal-body').addEventListener('click',safely(async event=>{

  const opening=event.target.closest('[data-open-project]'),deleting=event.target.closest('[data-delete-project]'),restoring=event.target.closest('[data-restore-project]'),purging=event.target.closest('[data-purge-project]');
  if(opening){await flushSave();const saved=await api('/api/projects/'+opening.dataset.openProject);closeModal();await chooseProject(saved);}
  else if(deleting&&!deleting.disabled){await confirmProjectDeletion(deleting.dataset.deleteProject);}
  else if(purging&&!purging.disabled){await confirmProjectPurge(purging.dataset.purgeProject);}
  else if(restoring){const restored=await api('/api/projects/'+restoring.dataset.restoreProject+'/restore','POST',{});await refreshState();if(!project)await chooseProject(restored);await openProjectManager();toast('项目已恢复');}
}));

const adjustmentUI=mountLayoutHistoryUI({getProject:()=>project,modal,closeModal,download,toast,flushSave});
historyStepsUI=mountHistorySteps({getProject:()=>project,getRevision:()=>undoRevision,getControls:historyStepControls,onRestore:restoreHistory,onLocate:locateHistoryStep,onVisibility:()=>renderCanvas(),onExport:()=>adjustmentUI.open(),toast});
$('#layout-adjustments').addEventListener('click',safely(()=>{$('#export-menu').hidden=true;adjustmentUI.open();}));
$('#layout-history-paused').addEventListener('click',safely(()=>adjustmentUI.open()));
$('#export-toggle').addEventListener('click',()=>$('#export-menu').hidden=!$('#export-menu').hidden);document.addEventListener('click',event=>{if(!event.target.closest('.export-wrap'))$('#export-menu').hidden=true;});
$('#export-layout').addEventListener('click',safely(async()=>{$('#export-menu').hidden=true;const result=await exportLayoutPage(clone(page()),project.shots);toast(result.parts>1?`版式草稿已导出，共 ${result.parts} 段`:'已导出版式草稿 PNG');}));
$('#export-page').addEventListener('click',safely(async()=>{$('#export-menu').hidden=true;await flushSave();if(episodeBoardUI.active){const result=await exportEpisodeBoard(episodeBoardUI.board);toast('已导出'+(episodeBoardUI.kind==='cover'?'封面':'尾图')+(result.parts>1?'分段 PNG，共 '+result.parts+' 段':' PNG'));return;}toast('正在合成当前长图');const result=await exportPage(clone(page()),{project:clone(project)});toast(result.parts>1?`当前长图已导出，共 ${result.parts} 段`:'已导出当前长图 PNG');}));
$('#export-episode').addEventListener('click',safely(async()=>{$('#export-menu').hidden=true;await flushSave();const result=await exportEpisode(clone(project),toast,{assets,episode:episodeBoardUI?.active?episodeBoardUI.episode:currentBoardEpisode(project,page())});toast('整话已导出：'+result.width+' × '+result.height+' px');}));
$('#export-project').addEventListener('click',safely(async()=>{
 $('#export-menu').hidden=true;let draft=false;try{await flushSave();}catch{draft=true;}
 let data;try{data=await api('/api/projects/'+project.id+'/export'+(draft?'?mode=local':'?compact=1'),draft?'GET':'POST',draft?undefined:{});if(draft)data=exportWithLocalDraft(data,project,assets);}
 catch(error){if(!draft)throw error;download(new Blob([JSON.stringify({format:'comic-strip-local-draft',version:1,project:clone(project)})],{type:'application/json'}),project.title+'-本窗口草稿.json');toast('已保留本窗口排版草稿；缺少原件，不能直接完整恢复。'+error.message,true);return;}
 download(new Blob([JSON.stringify(data)],{type:'application/json'}),project.title+(draft?'-本窗口路径备份':'')+'.json');toast(draft?'已保留未保存内容的路径备份，仅供原电脑恢复':data.portability?.embeddedImages?'已导出跨机工程；未入墨库的图片已携带原件':'已导出跨机工程；使用墨库固定素材时，新电脑需登录墨库');
}));
let projectFileOpening=false;
async function importProjectFile(file,handle){await flushSave();const sourceId=project?.id,sourceRevision=project?.revision,editToken=undoRevision;const data=JSON.parse(await file.text());const imported=await api('/api/projects/import','POST',data);if(handle)await bindProjectFile(imported.id,{handle,stamp:{lastModified:file.lastModified,size:file.size}});const activate=project?.id===sourceId&&project?.revision===sourceRevision&&undoRevision===editToken&&!dirty&&!hasLocalEditing();await refreshState();if(activate){await chooseProject(imported);toast('工程和图片已恢复；Ctrl+S 保存到原文件');}else toast('工程已恢复到本机列表；当前正在编辑的工程保留');}
async function openProjectFile(){if(projectFileOpening)return;if(!window.showOpenFilePicker){$('#project-input').click();return;}projectFileOpening=true;try{const [handle]=await window.showOpenFilePicker({multiple:false,types:[{description:'JSON 工程文件',accept:{'application/json':['.json']}}],excludeAcceptAllOption:true});await importProjectFile(await handle.getFile(),handle);}catch(error){if(error.name!=='AbortError')throw error;}finally{projectFileOpening=false;}}
$('#project-input').addEventListener('change',safely(async event=>{const file=event.target.files[0];event.target.value='';if(file)await importProjectFile(file,null);}));
$('#episode-batch-status').addEventListener('click',safely(async event=>{const button=event.target.closest('[data-stop-episode-batch]');if(!button)return;button.disabled=true;try{await api('/api/episode-generation-batches/'+button.dataset.stopEpisodeBatch+'/stop','POST',{});await refreshState();toast('已停止后续提交；已提交任务继续执行');}finally{button.disabled=false;}}));
$('#generate-current-episode').addEventListener('click',safely(generateCurrentEpisode));
$('#generate-current-panel').addEventListener('click',safely(generateCurrentPanel));
$('#cancel-recent-jobs').addEventListener('click',safely(async()=>{
 if(cancellingRecentJobs||cancellingAllJobs||!project)return;const targetProjectId=project.id,recent=latestSubmission(jobs,targetProjectId,submissionRecords()),jobIds=recent.active.map(j=>j.id);if(!jobIds.length)return;cancellingRecentJobs=true;renderJobs();try{const result=await api('/api/jobs/cancel-all','POST',{projectId:targetProjectId,jobIds});await refreshState();toast('已取消最近一次提交的 '+result.cancelled+' 个任务');}finally{cancellingRecentJobs=false;renderJobs();}
}));
async function locateTask(job,adopt=false){if(!job||job.projectId!==project?.id)throw Error('任务不属于当前作品');const target=project.pages.find(p=>p.panels.some(f=>f.id===job.panelId));if(!target)throw Error('原画格已删除，结果仍保留在素材中');await flushSave();pageId=target.id;select('panel',job.panelId,target.id,{scroll:true,inspector:true});if(adopt){if(selected().locked)throw Error('请先解锁画格');if(job.assetId&&selected().imageAssetId!==job.assetId)await attachImage(job.assetId);}viewport.scrollToPage(pageId,{localY:Math.max(0,selected().y-40)});}
$('#cancel-all-jobs').addEventListener('click',safely(async()=>{
 if(cancellingAllJobs||!project)return;const projectId=project.id,jobIds=taskGroups(jobs,projectId).active.map(job=>job.id);if(!jobIds.length&&!(scheduler.episodeBatches||[]).some(p=>p.projectId===projectId&&p.active))return;
 cancellingAllJobs=true;renderJobs();try{const result=await api('/api/jobs/cancel-all','POST',{projectId,jobIds,stopEpisodeBatches:true});await refreshState();toast('已停止后续批次，并取消 '+result.cancelled+' 个任务'+(result.cloudPending.length?'；已提交云端的任务可在历史中查询':''));}finally{cancellingAllJobs=false;renderJobs();}
}));
mountTaskRailNavigation($('#job-list'));
$('#job-list').addEventListener('click',safely(async event=>{
 const remove=event.target.closest('[data-delete-job]');if(remove){if(remove.disabled)return;remove.disabled=true;try{await api('/api/jobs/'+remove.dataset.deleteJob,'DELETE');await refreshState();toast('失败记录已删除，已有图片保留');}finally{remove.disabled=false;}return;}
 const filter=event.target.closest('[data-task-filter]');if(filter){jobCardFilter=filter.dataset.taskFilter;renderJobs();return;}
 const details=event.target.closest('[data-job-details],[data-preview-job]'),locate=event.target.closest('[data-locate-job]');if(locate){await locateTask(jobs.find(j=>j.id===locate.dataset.locateJob));return;}if(details){const job=jobs.find(j=>j.id===(details.dataset.jobDetails||details.dataset.previewJob));if(!job)return;modal('生成任务 · '+taskFrameName(project,job),taskDetailMarkup(job,{project,escape}),[{label:'关闭',run:closeModal},{label:'定位画格',run:async()=>{closeModal();await locateTask(job);}},...(job.assetId?[{label:'采用此图',primary:true,run:async()=>{closeModal();await locateTask(job,true);}}]:[])]);return;}
  const cancel=event.target.closest('[data-cancel-job]'),use=event.target.closest('[data-use-job]'),approve=event.target.closest('[data-approve-job]'),resume=event.target.closest('[data-resume-job]');
  if(approve){const job=jobs.find(j=>j.id===approve.dataset.approveJob),ceiling=job?.quote?.totalMaxCredits;if(!Number.isSafeInteger(ceiling)||ceiling<0||job.status!=='awaiting_confirmation')throw new Error('请刷新最新报价');
    modal('批准即梦积分上限',`<p>${escape(taskFrameName(project,job))}</p><p>本次生成消费上限：<strong class="credit-ceiling">${ceiling} 积分</strong></p><p>批准后开始此镜头生成；若最新报价提高，会再次等待批准。</p>`,[{label:'取消',run:closeModal},{label:`批准最多 ${ceiling} 积分并生成`,primary:true,run:async()=>{try{await api('/api/jobs/'+job.id+'/approve','POST',{approved:true,creditCeiling:ceiling});}catch(error){closeModal();await refreshState().catch(()=>{});throw error;}closeModal();await refreshState();}}]);return;
  }
  if(resume){await api('/api/jobs/'+resume.dataset.resumeJob+'/resume','POST',{});await refreshState();toast('正在查询原即梦任务');return;}
  if(cancel){await api('/api/jobs/'+cancel.dataset.cancelJob+'/cancel','POST',{});await refreshState();}
  else if(use)await locateTask(jobs.find(j=>j.id===use.dataset.useJob),true);
}));
async function showConnection(force=true){
  if(generationProvider==='jimeng'){
    await refreshGenerationOptions();const login=jimengStatus.login||{},url=typeof login.verificationUrl==='string'&&/^https:\/\//i.test(login.verificationUrl)?login.verificationUrl:null;
    modal('即梦官方账号',`<p>${escape(jimengStatus.message)}</p><p>${escape(jimengStatus.version||'')}</p>${url?`<p><a href="${escape(url)}" target="_blank" rel="noopener noreferrer">打开官方授权页面</a></p>`:''}${login.userCode?`<p>授权码：<strong>${escape(login.userCode)}</strong></p>`:''}<p>生成使用官方模型目录与最新报价；需要积分时会显示具体上限，等待你批准。</p>`,[{label:'关闭',run:closeModal},{label:'检查连接',run:async()=>{closeModal();await showConnection(false);}},...(!jimengStatus.connected&&jimengStatus.installed&&!login.running?[{label:'打开官方登录',primary:true,run:async()=>{await api('/api/jimeng/login','POST',{});closeModal();toast('请在即梦官方页面完成授权，再检查连接');}}]:[])]);return;
  }
  await codexConnectionUI.open(force);
}
$('#modal-close').addEventListener('click',closeModal);
document.addEventListener('keydown',safely(async event=>{if(!project||paintBefore||multiGesture||drag||bubbleGesture)return;if(event.isComposing||event.target.isContentEditable||event.target.closest('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"]')||$('#modal').open||$('#generation-settings-dialog').open)return;if(episodeBoardUI?.active){if(event.key==='Escape')episodeBoardUI.close();else if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='z'){event.preventDefault();await restoreHistory(event.shiftKey?'redo':'undo');}else if(event.key==='Delete'||event.ctrlKey&&event.key.toLowerCase()==='a')event.preventDefault();return;}if(event.key==='Escape'){setSelectionKeys([]);renderCanvas();renderSidebar();renderInspector();return;}
 const imageAction=imageLayerShortcut(event);if(imageAction&&imageAction!=='paste'&&imageAction!=='copy'&&tool!=='insert-space'){const handled=imageAction==='paste'?canPasteImageLayer():canCopyImageLayer();if(handled){event.preventDefault();if(imageAction==='copy')copySelectedImageLayer();else if(imageAction==='paste')pasteSelectedImageLayer();else{copySelectedImageLayer(false);pasteSelectedImageLayer();}return;}}
 if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='a'){event.preventDefault();selectAllScoped(event.shiftKey?'all':'page');return;}
 if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='z'){event.preventDefault();await restoreHistory(event.shiftKey?'redo':'undo');return;}if(tool==='insert-space')return;if(event.key==='Delete'){event.preventDefault();if(selectedLayerIds.size>1)return deleteSelectedLayers();if(tool==='nodes'&&selection?.type==='panel')deleteNode();else $('#delete-layer').click();return;}const deltas={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]};if(deltas[event.key]&&selectedLayerIds.size>1){event.preventDefault();const [dx,dy]=deltas[event.key],step=event.shiftKey?10:1;edit(()=>{if(!translateSelection(project,selectedLayerIds,{dx:dx*step,dy:dy*step}))toast('请先解锁选中的图层',true);});return;}if(deltas[event.key]&&selected()&&!selected().locked&&!selected().stripSpace){event.preventDefault();const [dx,dy]=deltas[event.key],step=event.shiftKey?10:1;edit(()=>{const item=selected();if(tool==='nodes'&&selection.type==='panel'){const points=clone(item.points);points[nodeIndex].x=constrainedNodeX(item,selectionOwner().width,nodeIndex,dx*step);points[nodeIndex].y=nodeDragY(item,nodeIndex,points[nodeIndex].y+dy*step/item.h);if(item.proportionalResize){const before=clone(item);Object.assign(item,preserveFrameArtwork(before,proportionalFrameDrag(before,nodeIndex,{dx:dx*step,dy:dy*step},{pageWidth:selectionOwner().width})));}else if(validPolygon(points)){const before=clone(item);Object.assign(item,preserveFrameArtwork(before,{...clone(item),points}));}}else if(tool==='image'&&item.imageTransform){const outer=sfxImageDelta(item,dx*step,dy*step),local=artworkDelta(item.imageTransform,outer.x,outer.y);item.imageTransform.x+=local.x;item.imageTransform.y+=local.y;}else if(selection.type==='bubble')replaceBubble(applyBubbleEdit(item,{type:'move',dx:dx*step,dy:dy*step}),selectionOwner().id);else if(selection.type==='panel')movePanelGroup(project,item.id,{x:item.x+dx*step,y:item.y+dy*step});else{item.x=selection.type==='gradient'&&isStripBackground(item)?0:item.x+dx*step;item.y+=dy*step;if(item.assistantLayoutAnchor)item.assistantLayoutAnchor.y+=dy*step;}});}}));
window.addEventListener('beforeunload',event=>{if(dirty||saving||quickGesture){event.preventDefault();event.returnValue='';}});
async function poll(){try{const signature=jobs.map(j=>`${j.id}:${j.status}`).join('|');await refreshState();const next=jobs.map(j=>`${j.id}:${j.status}`).join('|');if(signature!==next)renderSidebar();}catch{}finally{setTimeout(poll,2000);}}
const openDetailedInspector=()=>{if(!project)return;renderInspector();workbench.openInspector();};
const getDetailedInspectorState=()=>({enabled:!!project,expanded:chromeState.inspector});
const responsiveUI=mountResponsiveWorkbench({onOpenInspector:openDetailedInspector,getInspectorState:getDetailedInspectorState,onAddNode:()=>addNode(nodeIndex),onDeleteNode:deleteNode});
novelSourcePanel=mountNovelSourcePanel({getProject:()=>project,getPage:page,getSelected:selected,onVisibility:()=>renderCanvas()});
autoLayoutUI=mountAutoLayout({applyCurrent:input=>productionUI.applyAssistantPreview(input),getProject:()=>project,getEpisode:()=>project&&currentBoardEpisode(project,page()),flushSave,api,refreshState,chooseProject,toast,accept:acceptImportedProject,onChooseEpisode:switchEpisode,modal,closeModal,selectFrame:()=>{}});
$('#screen-artwork-reflow-toggle').after($('#dialogue-tools-toggle'));
dialoguePlacementUI=mountManualDialoguePlacement({stage,button:$('#dialogue-tools-toggle'),getProject:()=>project,getPage:page,getAssets:()=>assets,
 getPoint:event=>{const ownerId=event.target.closest('[data-page-id]')?.dataset.pageId||viewport.hitTest(worldPoint(event))?.pageId,owner=project?.pages.find(p=>p.id===ownerId);if(!owner)return null;const view=documentView(project,viewState),entry=view.layout.pages.find(p=>p.pageId===ownerId);return {page:owner,point:pagePoint(event,ownerId),previewTransform:`translate(0 ${entry.y-view.offset}) scale(${entry.scale})`};},
 onPlace:({row,prepared,page:owner,point,parent})=>{edit(()=>{const placed=placePreparedDialogue(project,row,prepared,owner,point,parent);pageId=owner.id;selection={type:'bubble',id:placed.id,pageId};selectedLayerIds=new Set([placed.id]);tool='move';project.manualDialoguePlacementVersion=1;},{operation:'bubble.manual-place'});},
 onSettings:settings=>edit(()=>{project.manualDialogueSettings=clone(settings);},{operation:'bubble.placement-settings'}),
 onLocate:row=>{if(row?.bubbleId){selectDialogueOnCanvas(row.bubbleId);return;}const entry=row?.pageId?project.pages.find(p=>p.id===row.pageId):project.pages.find(p=>p.panels.some(f=>f.productionGrid?.panelId===row?.gridId||f.panelSlice?.panelId===row?.gridId||f.productionSegment===row?.segmentId));if(entry){const frame=entry.panels.find(f=>f.visible!==false&&(f.productionGrid?.panelId===row?.gridId||f.panelSlice?.panelId===row?.gridId))||entry.panels.find(f=>f.productionSegment===row?.segmentId);viewport.scrollToPage(entry.id,{localY:frame?.y||0});}},
 onStyles:()=>{if(project.productionPackage)productionUI.openStyles('screen','styles');},
 registerMaterial:async style=>{if(style.assetId&&style.revisionId){const r=await api('/api/library/import','POST',{assetId:style.assetId,revisionId:style.revisionId});mergeImageAssets([r.asset]);return r.asset.id;}const r=await api('/api/comic-style-library/register','POST',{ids:[style.id]});mergeImageAssets(r.assets);return r.assets.find(a=>a.comicStyleId===style.id)?.id;},toast});
mountCanvasPan({scroll:$('#canvas-scroll'),viewport});
const promptScope=()=>project?.id+':'+currentBoardEpisode(project||{pages:[],shots:[]},page())+':'+!!episodeBoardUI?.active;
promptSourceUI=mountPromptSourceUI({getSelected:()=>project&&!episodeBoardUI?.active&&selection?.type==='panel'&&selectedLayerIds.size<=1?selected():null,getPanels:()=>project&&!episodeBoardUI?.active?episodePages(project,page()).flatMap(page=>page.panels):[],getSelectedIds:()=>[...selectedLayerIds],getTargetKey:promptScope,isPending:panel=>submitting.has(panel.id)||jobs.some(job=>job.panelId===panel.id&&ACTIVE_JOB_STATES.includes(job.status)),modal,closeModal,toast,
 apply:async(changes,scope)=>{quickUI?.finish();if(!project||promptScope()!==scope)throw Error('当前作品或话数已切换，请重新选择提示词');const panels=episodePages(project,page()).flatMap(page=>page.panels),targets=changes.map(change=>{const panel=panels.find(panel=>panel.id===change.panelId);if(!panel||panel.locked||submitting.has(panel.id)||jobs.some(job=>job.panelId===panel.id&&ACTIVE_JOB_STATES.includes(job.status)))throw Error('画格已变化、锁定或正在生成，请刷新后选择');const choice=generationPromptChoices(panel,project).find(choice=>choice.value===change.source);if(!choice?.text.trim())throw Error((panel.name||'本格')+'缺少所选提示词原文');return {panel,source:change.source};});edit(()=>{for(const {panel,source} of targets)ensurePanelGeneration(project,panel,assets).promptSource=source;},{operation:'panel.prompt-source'});await flushSave();}});

quickUI=mountFrameShortcuts({...responsiveUI,stage,scroll:$('#canvas-scroll'),getTarget:quickTarget,modal,closeModal,escape,toast,onGenerate:generateCurrentPanel,onUniformResize:value=>{const frame=selected();if(!frame||frame.locked)return;edit(()=>frame.proportionalResize=value,{operation:'panel.proportional-resize'});},onPromptSource:source=>promptSourceUI.setCurrent(source),onOpenInspector:openDetailedInspector,getInspectorState:getDetailedInspectorState,onEditNodes:()=>{tool='nodes';nodeIndex=0;renderCanvas();renderInspector();},onShape:key=>{try{frameShapeUI.setShape(key,selected());}catch(error){toast(error.message,true);}},onPreview:previewQuickField,onFinish:finishQuickField,onCancel:cancelQuickField});
speakerUI=mountBubbleSpeaker({displayOnCanvas:true,stage,scroll:$('#canvas-scroll'),getProject:()=>project,getSelection:()=>selectedLayerIds.size>1?null:selection,getAssets:()=>assets});
const savedZoom=localStorage.getItem('comic-zoom-choice');if(savedZoom==='fit'||savedZoom==='page')$('#zoom').value=savedZoom;else if(Number(savedZoom)>0&&Number(savedZoom)<=8)syncZoomChoice(Number(savedZoom));
stripSpaceUI=createStripSpaceUI({stage,scroll:$('#canvas-scroll'),host:$('.canvas-wrap'),getProject:()=>project,getTool:()=>tool,setTool:value=>{tool=value;renderCanvas();renderInspector();},getPoint:documentPoint,measurement,render:renderCanvas,onInsert:request=>{applySpacingResult(insertStripSpace(project,request));toast('已插入 '+request.height+' px 底图，可在右侧继续调整');},toast});
try{const data=await stateSync.fetch();projects=data.projects;deletedProjects=data.deletedProjects||[];assets=data.assets;jobs=data.jobs;scheduler=data.scheduler||scheduler;const linkedProject=projects.find(p=>p.id===new URLSearchParams(location.search).get('project')),rememberedProject=projects.find(p=>p.id===localStorage.getItem('comic-active-project'));await chooseProject(linkedProject||(projectClosed?null:rememberedProject||projects[0]),{alreadyLoaded:true});const linkedPage=new URLSearchParams(location.search).get('page');if(project?.pages.some(p=>p.id===linkedPage)){pageId=linkedPage;const first=page().panels[0];selection=first?{type:'panel',id:first.id,pageId}:null;render();viewport.scrollToPage(pageId);}void poll();renderGenerationControls();}catch(error){toast(error.message,true);$('#save-state').textContent='载入失败';}


if(document.fonts)document.fonts.addEventListener('loadingdone',()=>{spacingMeasurements.clear();if(project)renderCanvas();});





function closeWorkbenchMenus(){
 for(const id of ['project-menu','view-menu','panel-tool-menu','select-all-menu']){const node=$('#'+id);if(node)node.hidden=true;}
 for(const id of ['project-trigger','view-more','panel-tool-toggle','select-all-trigger'])$('#'+id)?.setAttribute('aria-expanded','false');
}
function toggleWorkbenchMenu(buttonId,menuId){
 const opening=$('#'+menuId).hidden;closeWorkbenchMenus();$('#'+menuId).hidden=!opening;$('#'+buttonId).setAttribute('aria-expanded',String(opening));
}
const platformConcurrencyUI=mountPlatformConcurrency({host:$('#platform-concurrency-settings'),api,toast});
function openGenerationSettings(){closeWorkbenchMenus();renderGenerationControls();$('#generation-settings-dialog').showModal();void platformConcurrencyUI.load();}
$('#project-trigger').addEventListener('click',()=>toggleWorkbenchMenu('project-trigger','project-menu'));
$('#view-more').addEventListener('click',()=>toggleWorkbenchMenu('view-more','view-menu'));
$('#panel-tool-toggle')?.addEventListener('click',()=>toggleWorkbenchMenu('panel-tool-toggle','panel-tool-menu'));
$('#select-all-trigger').addEventListener('click',()=>toggleWorkbenchMenu('select-all-trigger','select-all-menu'));
document.addEventListener('click',event=>{const button=event.target.closest('[data-select-scope]');if(button){closeWorkbenchMenus();selectAllScoped(button.dataset.selectScope);}});
$('#project-choices').addEventListener('click',safely(async event=>{const button=event.target.closest('[data-choose-project]');if(!button)return;await flushSave();await chooseProject(await api('/api/projects/'+button.dataset.chooseProject));closeWorkbenchMenus();}));
for(const button of document.querySelectorAll('[data-open-generation-settings]'))button.addEventListener('click',openGenerationSettings);
for(const id of ['generation-settings-close','generation-settings-done'])$('#'+id).addEventListener('click',()=>$('#generation-settings-dialog').close());
$('#toolbar-add-panel').addEventListener('click',()=>{addPanel();closeWorkbenchMenus();workbench.openInspector();});
$('#page-marker').addEventListener('click',()=>$('#page-settings').click());
for(const button of document.querySelectorAll('[data-rail-tab]'))button.addEventListener('click',()=>{
 const next=button.dataset.railTab;if(chromeState.sidebar&&tab===next&&next!=='references'){workbench.closeSidebar();return;}
 if(next==='references'){tab=next;episodeAssetsUI?.open();document.querySelectorAll('[data-tab]').forEach(b=>b.classList.remove('active'));}else document.querySelector('[data-tab="'+next+'"]').click();workbench.openSidebar();
 for(const item of document.querySelectorAll('[data-rail-tab]'))item.classList.toggle('active',item===button);
});
document.addEventListener('click',event=>{
 if(!event.target.closest('.project-switcher,.workspace-controls,.panel-tool-wrap,.select-all-wrap'))closeWorkbenchMenus();
 if(event.target.closest('#project-menu button:not(#project-trigger),#view-menu button,#panel-tool-menu button,#select-all-menu button'))closeWorkbenchMenus();
});
document.addEventListener('keydown',safely(async event=>{
 if(event.key==='Escape')closeWorkbenchMenus();
 if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='s'){event.preventDefault();await flushSave();toast('工程已保存到本机');}
}));

const panelPaintEditor=new PanelPaintEditor({root:stage,getTool:()=>tool,getTarget:()=>selection?.type==='gradient'&&!selected()?.stripSpace?{panel:selected(),pageId:null}:selection?.type==='panel'&&tool==='mask'?{panel:selected(),pageId:selectionOwner().id}:null,getBrush:()=>({...brush}),toPagePoint:(event,owner)=>owner?pagePoint(event,owner):documentPoint(event),
 onStart:()=>{paintBefore=layoutEditSnapshot(project);if(selection?.type==='gradient')tool='gradient';},onChange:()=>{renderCanvas();if(selection?.type==='gradient'){const input=$('#inspector-body').querySelector('[data-section="gradient"][data-field="angle"]');if(input&&document.activeElement!==input)input.value=Math.round(gradientAngle(selected())*100)/100;}},onCommit:()=>{const before=paintBefore;paintBefore=null;undoRevision++;historyStepsUI?.refresh();if(before)commit(before);},onCancel:()=>{if(paintBefore)project=preserveLayoutHistory(project,paintBefore);paintBefore=null;undoRevision++;render();},onError:message=>toast(message,true),onCursor:value=>{brushCursor=value;const cursor=stage.querySelector('[data-brush-preview]'),frame=selected();if(cursor){cursor.setAttribute('visibility',value?'visible':'hidden');if(value&&frame)cursor.setAttribute('transform',`translate(${value.point.x-frame.x} ${value.point.y-frame.y})`);}}});

function canCopyImageLayer(){return !!project&&selection?.type==='panel'&&!!selected()&&selectedLayerIds.size<=1;}
function canPasteImageLayer(){return !!project&&imageLayerClipboard?.projectId===project.id&&!!page();}
function updateImageLayerActions(){for(const button of document.querySelectorAll('[data-image-layer-action]'))button.disabled=button.dataset.imageLayerAction==='copy'?!canCopyImageLayer():!canPasteImageLayer();}
function copySelectedImageLayer(notify=true,writeClipboard=true){if(!canCopyImageLayer())return;imageLayerClipboard=copyImageLayer(project,selection.id);if(writeClipboard&&notify&&navigator.clipboard?.writeText)void navigator.clipboard.writeText('comic-image-layer:'+imageLayerClipboard.sourcePanelId).catch(()=>{});updateImageLayerActions();if(notify)toast('已复制画面层，可粘贴；对白保留在原层');}
document.addEventListener('copy',event=>{if(event.defaultPrevented||!canCopyImageLayer()||episodeBoardUI?.active||document.body.classList.contains('repair-workspace-active')||document.querySelector('dialog[open]')||event.target.closest?.('input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"]'))return;copySelectedImageLayer(true,false);event.clipboardData?.setData('text/plain','comic-image-layer:'+imageLayerClipboard.sourcePanelId);event.preventDefault();});
function pasteSelectedImageLayer(){if(!canPasteImageLayer()||drag||bubbleGesture||paintBefore||multiGesture)return;const copiedFrom={};edit(()=>{const pasted=pasteImageLayer(project,imageLayerClipboard,{pageId:page().id});if(!pasted)return;copiedFrom[pasted.item.id]=imageLayerClipboard.sourcePanelId;pageId=pasted.pageId;setSelectionKeys([pasted.item.id]);nodeIndex=0;tool='move';},{source:'manual',operation:'layer.paste',copiedFrom});workbench.openInspector();toast('已粘贴独立画面层，可分别裁切、取景和移动');}
document.addEventListener('click',safely(event=>{const button=event.target.closest('[data-image-layer-action]');if(!button||button.disabled)return;if(button.dataset.imageLayerAction==='copy')copySelectedImageLayer();else pasteSelectedImageLayer();}));
function revealSelectedLayer(){
 cancelAnimationFrame(layerRevealFrame);
 const key=selection?.id,context=key&&project.id+':'+key;if(!context||selectedLayerIds.size>1)return;
 layerRevealFrame=requestAnimationFrame(()=>{
  if(selection?.id!==key||project?.id+':'+key!==context)return;
  const pane=$('#layers-tab'),row=$('#layer-list').querySelector('[data-stack-id="'+CSS.escape(key)+'"]');
  if(pane.hidden||!pane.getClientRects().length||!row?.getClientRects().length)return;
  const area=pane.getBoundingClientRect(),box=row.getBoundingClientRect(),top=area.top+pane.clientTop+6,bottom=area.top+pane.clientTop+pane.clientHeight-6;
  // Scroll only the layer pane; revealing a row must not pan the canvas or page.
  if(box.top<top)pane.scrollTop+=box.top-top;
  else if(box.bottom>bottom)pane.scrollTop+=box.bottom-bottom;
  revealedLayerKey=context;
 });
}
function renderLayerList(){
 const key=selection?.id&&project.id+':'+selection.id;
 if(key!==layerListSelectionKey){layerListSelectionKey=key;if(key&&selectedLayerIds.size<=1){const group=groupForLayer(project,selection.id);if(group&&group.id!==selection.id)groupExpansion.set(group.id,true);}}
 const scoped=episodeLayerProject(project,page()),markup=layerListMarkup(scoped,{escape,selectedId:selection?.id,scope:layerScope,pageId,search:layerSearch,groupExpansion,selectedIds:selectedLayerIds});if(markup!==lastLayerListMarkup||!$('#layer-list').children.length){$('#layer-list').innerHTML=markup;lastLayerListMarkup=markup;}$('#layer-count').textContent='本话 '+allLayers(scoped).length+' 个图层';$('#auto-locate-layer').checked=locateOnSelect;
 if(key!==revealedLayerKey)revealSelectedLayer();
}
function openLayers(){tab='layers';document.querySelector('[data-tab=layers]').click();workbench.openSidebar();renderLayerList();}
function addGradientLayer(){edit(()=>{const y=documentView(project,viewport.snapshot()).region.y,g=makeGradientLayer(project,{y});project.gradients.push(g);selection={type:'gradient',id:g.id,pageId};tool='gradient';});workbench.openInspector();openLayers();}
$('#gradient-tool').addEventListener('click',addGradientLayer);$('#layer-add-gradient').addEventListener('click',addGradientLayer);$('#layers-toggle').addEventListener('click',openLayers);
$('#layer-scope').addEventListener('change',event=>{layerScope=event.target.value;renderLayerList();});$('#layer-search').addEventListener('input',event=>{layerSearch=event.target.value;renderLayerList();});$('#auto-locate-layer').addEventListener('change',event=>{locateOnSelect=event.target.checked;localStorage.setItem('comic-auto-locate',String(locateOnSelect));});
$('#layer-list').addEventListener('dblclick',event=>{const row=event.target.closest('[data-stack-id]');if(!row)return;const entry=findLayer(project,row.dataset.stackId);modal('图层名称',`<label>名称<input id="layer-name-input" value="${escape(layerName(project,entry))}" maxlength="120"></label>`,[{label:'保存',primary:true,run:()=>{const name=$('#layer-name-input').value.trim();if(!name)throw new Error('名称不能为空');edit(()=>entry.item.name=name);closeModal();}}]);});
let stackDrag=null;
const clearStackDrop=()=>{for(const row of $('#layer-list').querySelectorAll('.drop-above,.drop-below'))row.classList.remove('drop-above','drop-below');};
$('#layer-list').addEventListener('pointerdown',event=>{const grip=event.target.closest('.drag-grip'),row=grip?.closest('[data-stack-id]');if(!row||event.button!==0)return;event.preventDefault();stackDrag={id:row.dataset.stackId,pointerId:event.pointerId,x:event.clientX,y:event.clientY,moved:false};$('#layer-list').setPointerCapture(event.pointerId);});
$('#layer-list').addEventListener('pointermove',event=>{if(!stackDrag||event.pointerId!==stackDrag.pointerId)return;event.preventDefault();if(Math.hypot(event.clientX-stackDrag.x,event.clientY-stackDrag.y)>4)stackDrag.moved=true;clearStackDrop();const row=document.elementFromPoint(event.clientX,event.clientY)?.closest('[data-stack-id]');if(!row||row.dataset.stackId===stackDrag.id)return;const box=row.getBoundingClientRect();row.classList.add(event.clientY<box.y+box.height/2?'drop-above':'drop-below');});
$('#layer-list').addEventListener('pointerup',event=>{if(!stackDrag||event.pointerId!==stackDrag.pointerId)return;const drag=stackDrag;stackDrag=null;clearStackDrop();if($('#layer-list').hasPointerCapture(event.pointerId))$('#layer-list').releasePointerCapture(event.pointerId);const row=document.elementFromPoint(event.clientX,event.clientY)?.closest('[data-stack-id]');if(!drag.moved||!row||row.dataset.stackId===drag.id)return;const box=row.getBoundingClientRect();edit(()=>moveGroupedLayer(project,drag.id,row.dataset.stackId,event.clientY<box.y+box.height/2?'above':'below'));});
$('#layer-list').addEventListener('pointercancel',()=>{stackDrag=null;clearStackDrop();});
for(const [name,direction]of [['layer-stack-up',1],['layer-stack-down',-1]])$('#'+name).addEventListener('click',()=>moveCurrentLayerOrder(direction));$('#layer-delete').addEventListener('click',()=>$('#delete-layer').click());




async function useLibraryAsset(result,action,context){
 if(result.kind==='font'){await loadLibraryFont(result.font);if(context.target==='repair'){integratedWorkspace.addFont(result.font);return;}edit(()=>{if(selection?.type==='bubble')selected().fontFamily=result.font.key;else project.typography={...projectTypography(project),fontFamily:result.font.key};},{operation:'font.library'});render();return;}
 const asset=result.asset;mergeImageAssets([asset]);if(context.onSelect&&action==='image'){await context.onSelect(asset);document.querySelector('[data-rail-tab="pages"]').click();return;}if(context.target==='repair'){integratedWorkspace.addReference(asset);return;}
 if(action==='reference'){edit(()=>{if(!project.references.some(r=>r.assetId===asset.id))project.references.push({assetId:asset.id,name:asset.name,role:['character','scene','prop'].includes(context.item.category)?context.item.category:'style'});},{operation:'reference.library'});return;}
 if(action==='image'){if(selection?.type!=='panel')throw Error('先选择需要换图的画格');await attachImage(asset.id);return;}
 await addSprintImage(asset,{id:asset.id,label:asset.name});
 const image=selected();if(image)edit(()=>{image.name=(action==='bubble'?'气泡 · ':'元素 · ')+asset.name;},{operation:'element.library'});
 if(action==='bubble')dialoguePlacementUI?.open({customText:''});
}
libraryUI=mountLibraryUI({api,getProject:()=>project,onUse:useLibraryAsset,toast,onOpen:()=>{episodeAssetsUI?.close(false);tab='references';document.querySelectorAll('[data-tab]').forEach(button=>button.classList.toggle('active',button.dataset.tab===tab));for(const name of ['pages','layers','shots','references','production'])$('#'+name+'-tab').hidden=name!==tab;$('#sidebar-heading').textContent='墨库素材';workbench.openSidebar();}});
episodeAssetsUI=mountAssetWorkspace({api,getProject:()=>project,getPage:()=>page(),getSelected:()=>selected(),getAssets:()=>assets,flushSave,accept:acceptImportedProject,onAssets:mergeImageAssets,toast,locate:id=>select('panel',id,null,{scroll:true,inspector:true}),showSidebar:()=>workbench.openSidebar(),showInspector:()=>workbench.openInspector(),renderInspector,onChooseEpisode:switchEpisode});
const mokuLoginUI=mountMokuLoginUI({api,toast});

codexConnectionUI=mountCodexConnection({api,modal,closeModal,toast,onStatus:value=>{status=value;}});
const jimengConnect=document.createElement('button');jimengConnect.textContent='连接即梦 / 查看状态';jimengConnect.type='button';jimengConnect.addEventListener('click',safely(()=>showConnection(false)));$('#jimeng-options').append(jimengConnect);
const storageCleanupUI=mountStorageCleanup({api,getProject:()=>project,isDirty:()=>dirty||!!saving||hasLocalEditing(),flushSave,modal,closeModal,toast,clientId:storageClientId});
const projectSyncSetup=mountProjectSyncSetup({api,getProject:()=>project,flushSave,modal,closeModal,toast,assignEpisodes:async entries=>{edit(()=>assignMissingEpisodes(project,entries),{operation:'project.episode-classification'});await flushSave();}});
projectSyncUI=mountProjectSyncUI({getProject:()=>project,getJobs:()=>jobs,api,toast,openLibrary:()=>libraryUI.open(),openLogin:()=>mokuLoginUI.open(),openSetup:()=>projectSyncSetup.open()});
const episodeVersionButton=document.createElement('button');episodeVersionButton.id='episode-version-open';episodeVersionButton.textContent='本话版本';$('#project-trigger').after(episodeVersionButton);
episodeVersionButton.addEventListener('click',safely(async()=>{const {openFormalEngineeringVersions}=await import('./formal-engineering-versions.js');return openFormalEngineeringVersions({getProject:()=>project,getEpisode:()=>currentBoardEpisode(project,page()),flushSave,modal,closeModal,toast,applyProject:async p=>{await loadSavedLibraryFonts(api);await refreshState();await chooseProject(p);},reloadProject:async()=>{const fresh=await api('/api/projects/'+project.id);await loadSavedLibraryFonts(api);await refreshState();await chooseProject(fresh);}});}));
void loadRemoteBubbleStyles(api).then(result=>{if(result.loaded&&project)render();});
const localRegionUI=mountLocalRegionUI({api,getProject:()=>project,getSelected:()=>selection?.type==='panel'?selected():null,flushSave,accept:acceptImportedProject,onAssets:mergeImageAssets,modal,closeModal,toast});
repairCompare=mountRepairCompare({api,getProject:()=>project,getPanel:()=>selection?.type==='panel'?selected():null,getPage:page,getAssets:assetMap,onRender:renderCanvas,canCompare:()=>!!project&&!repairApplying&&!hasLocalEditing(),toast});
mountRepairTaskbar({api,getProject:()=>project,canApply:()=>!!project&&!dirty&&!saving&&!hasLocalEditing()&&!repairApplying&&conflictNotice===null&&!document.querySelector('dialog[open]'),
 apply:async task=>{await flushSave();if(dirty||saving||hasLocalEditing()||repairApplying)return null;repairApplying=true;document.body.classList.add('repair-applying');try{const target=project?.id===task.projectId?project:await api('/api/projects/'+task.projectId);const result=await api('/api/integrated-repair/tasks/'+task.id+'/apply','POST',{expectedRevision:target.revision});if(result.project&&project?.id===result.project.id){mergeImageAssets([result.asset]);await acceptIntegratedProject(result.project,{undoable:true});}return result;}finally{repairApplying=false;document.body.classList.remove('repair-applying');}},
 onResult:result=>{integratedWorkspace?.backgroundApplied(result);void repairCompare.refresh().catch(()=>{});},
 onLocate:async task=>{if(repairApplying)throw Error('正在合成，请稍候');await integratedWorkspace?.closeLocal();await flushSave();if(project?.id!==task.projectId){const target=await api('/api/projects/'+task.projectId);await chooseProject(target,{alreadyLoaded:true});}const entry=findLayer(project,task.layerId||task.panelId);if(!entry)throw Error('原画格已删除，修图结果仍保留在处理记录');episodeBoardUI?.close({render:false});stripSpaceUI?.cancel({repaint:false});pageId=entry.pageId;setSelectionKeys([entry.item.id]);tool='move';if(entry.item.cutoutLayer)groupExpansion.set(entry.item.cutoutLayer.parentPanelId,true);render();viewport.scrollToPage(pageId,{localY:Math.max(0,entry.item.y-40)});},toast});
integratedWorkspace=mountIntegratedWorkspace({api,getProject:()=>project,getPanel:()=>selection?.type==='panel'?selected():null,getSelectedIds:()=>[...selectedLayerIds],canvasActions:canvasLayerOrderUI,flushSave,canApply:()=>!dirty&&!hasLocalEditing(),onLocalRegion:({operation,...target})=>localRegionUI.open(operation,target),openLibrary:options=>libraryUI.open(options),toast,onAction:action=>{if(action==='frame-upscale')return reviewFrameUpscale({api,getProject:()=>project,getPanel:()=>selected(),flushSave,modal,closeModal,submit:async(preview,referenceIds)=>{if(project?.id!==preview.projectId||selected()?.id!==preview.panelId)throw Error('当前画格已改变，请重新打开高清预览');return generateWholeImageEdit('格内画面高清重绘',{p:project,panel:selected()},{frameUpscale:true,previewId:preview.id,referenceIds});}});if(action==='mask')document.querySelector('.canvas-toolbar [data-tool=mask]').click();if(action==='image-edit'){workbench.openInspector();renderInspector();const mode=document.querySelector('[data-picture-edit-mode]');if(!mode)throw Error('当前图层暂不支持 AI 改图，请选择原画格');mode.value='image';mode.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('[data-prompt-rewrite-notes]')?.focus();}},onModeChange:value=>{if(value==='repair'&&selection?.type==='panel')viewport.scrollToPage(selection.pageId||pageId,{localY:Math.max(0,selected()?.y||0)});},onHistory:async({direction,operationId,projectId})=>{if(project?.id!==projectId||typeof operationId!=='string'||!operationId||!['undo','redo'].includes(direction)||undoOperationIds.get((direction==='undo'?history:future).at(-1))!==operationId)throw Error('左侧已有其他修改，请先在排版区按顺序撤回 / 重做');await restoreHistory(direction);await flushSave();return project;},onApplied:async result=>{mergeImageAssets([result.asset]);result.operationId=await acceptIntegratedProject(result.project,{undoable:!!(result.unchanged||result.applied&&(result.mode==='upscale'||result.createdLayer||result.updatedLayer||result.session?.targetKind==='upscale'))});const entry=result.layerId&&findLayer(project,result.layerId);if(entry){pageId=entry.pageId;setSelectionKeys([entry.item.id]);tool='move';if(entry.item.cutoutLayer)groupExpansion.set(entry.item.cutoutLayer.parentPanelId,true);render();viewport.scrollToPage(pageId,{localY:Math.max(0,entry.item.y-40)});}}});
mountTeamToolbar({getProject:()=>project,getPage:()=>page()});
$('#add-bubble').addEventListener('click',safely(addBubbleLayer));
await loadSavedLibraryFonts(api).catch(()=>{});if(project)render();

// Explicit navigation from the assistant preview applies once, with normal save/undo protection.
const assistantReturn=new URL(location.href),assistantReturnId=assistantReturn.searchParams.get('apply-layout');
if(assistantReturnId){
 const target=assistantReturn.searchParams.get('project'),number=Number(assistantReturn.searchParams.get('layout-episode')),expectedPacketHash=assistantReturn.searchParams.get('layout-hash');
 for(const key of ['apply-layout','layout-episode','layout-hash'])assistantReturn.searchParams.delete(key);window.history.replaceState(null,'',assistantReturn);
 try{if(!/^[\w-]{1,90}$/.test(assistantReturnId)||!project||project.id!==target||!Number.isInteger(number))throw Error('接回目标工程或话数不符，请回预览页重新接回');await productionUI.applyAssistantPreview({episodeNumber:number,scriptId:assistantReturnId,expectedPacketHash});}catch(error){toast(error.message,true);}
}
