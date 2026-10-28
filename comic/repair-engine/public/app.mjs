import {registerLibraryFont} from './text-fonts.mjs';
let embeddedAutoFit=true;
let embeddedSession=null;const embeddedApplies=new Map();let embeddedUpscaleModel="";
import {reflowOutputObjects,recoverUntrackedTaskLayout} from './layout-followers.mjs';
import {selectionHandles,selectionHandleAt,selectionResizeCursor,resizeSelectionFrame} from './selection-resize.mjs';
import {displayRegionFrame,regionSpaceHeight} from './region-coordinates.mjs';
const textControlIDs=['layer-text','text-font','text-size','text-weight','text-italic','text-underline','text-color','text-direction','text-align','text-spacing','text-line-height','text-paragraph-spacing','text-box-width','text-box-height','text-wrap','text-strikethrough','text-stroke-width','text-stroke-color','text-shadow','text-shadow-color','text-shadow-blur','text-shadow-x','text-shadow-y'];
import {textLayoutSettings as normalizeTextLayout,layoutText,renderTextCanvas} from './text-layout.mjs';

import {FolderPicker,requestJSON} from './folder-picker.mjs';
import {LayerSelection,bindInspectorResize,planLayerDeletion} from './layer-selection.mjs';
import {visualLayers,linkedMembers,linkLayers,unlinkLayers,canvasLayerAtPoint} from './layer-operations.mjs';
let layerClipboard=null;const layerClipboardPrefix='PATCH_LAYER_CLIPBOARD_V1\n';
import {QuickRepairPanel} from './quick-repair.mjs';
import {ensureTextFont,ensureLayerFonts,setFontSelection,setFontWeightSelection,textFontWeight,defaultTextFont,setProjectFontAssets,textFontStack} from './text-fonts.mjs';
import {contentRegion,canEditRegion,canEditLayer,toggleObjectLock,toolProperties,editorToolShortcut,freeSelectionRect,editorCursor,repairAtPoint} from './editor-tools.mjs';
import { maskBounds, featherMask, gaussianMask, composite, aspectMismatch, fixedRatioRect, fixedRatioCrop,moveFixedFrame,bindWheelNavigation,ratioFrameAtCenter } from './core.mjs';
import {PageView} from './page-view.mjs?v=strip-cache';
import {LayerEditor} from './layers.mjs';
import {belongsToEditor,taskStatus,canReceive,mergeTask,generationTimer,hasReviewableAttempt,reviewAttemptNotice} from './tasks.mjs';
import {EditHistory} from './history.mjs';
import {formatDecimal,scaleLayerAtCenter,resizeLayerAtCenter,layerScales} from './layer-geometry.mjs';
import {chosenRegionLayer,normalizeRepairVersions,repairVersionTasks,restorePreviousVersion} from './repair-versions.mjs';
import {layerMatrix,invertMatrix,layerDelta,poseOf,mapPoint,mappedFrame,mapMarks,frameMap,transformLayer} from './affine-links.mjs';
import {AnnotationEditor} from './annotations.mjs?v=ctrl-wheel';
import {assignRegionNumbers,currentRegionTask,buildRepairItems,centeredFrameView,regionDeleted} from './repair-items.mjs';

import {normalizePageGaps,pageSegments,pageHeight,sourceToDisplay,displayToSource} from './page-layout.mjs';
import {sectionManifest,normalizeSections,sectionSegments,sectionsHeight,sectionAt,sectionDisplayPoint,sectionSourceY} from './page-sections.mjs';
import {compareViewport} from './compare-view.mjs';
import {bindSelectionToolMenu} from './selection-menu.mjs';
import {imageCornerPoints,resizeImageFromCorner,imageResizeCursor} from './image-resize.mjs';
import {textFrameHandles,resizeTextFrame} from './text-frame.mjs';
import {blocksEditorShortcuts,bindPropertyShortcutFocus,clipboardDestination,handleLayerPasteKey} from './editor-shortcuts.mjs';
import {imagePlacement,decodeLayerFile} from './image-layer.mjs';
import {taskIsRunning,activeRegionAttempt,canEditRepairInstructions,updateRepairInstructions,restoreRegionDescriptor,adoptCanonicalReferences,visibleLayerWindows,shouldActivateReceivedVersion,taskLayerBackup} from './repair-workflow.mjs';
import {canReceiveEarlyText,addEarlyTextLayers,completeCompanions} from './early-text.mjs';
import {isTextReviewTask,taskHasPendingWork,canOpenTextReview,copyTextReviewDraft,validateTextReviewBubbles,mergeTextReviewBubbles,localTextReviewDraft} from './text-review.mjs';
const $ = id => document.getElementById(id);
const canvas = (width = 1, height = 1) => Object.assign(document.createElement('canvas'), { width, height });
const current = canvas(), original = canvas(), selection = canvas();
const view = $('view'), stage = $('stage'), ctx = view.getContext('2d');
const selectionCtx = selection.getContext('2d', { willReadFrequently: true });
const state = { width: 0, height: 0, name: '', zoom: 1, panX: 0, panY: 0, tool: 'pan', pointer: null, bounds: null, job: null, preview: null, result: null, history: [], revision: 0, exportedRevision: 0, show: 'current', before: false, space: false, target: 'auto', codexReady: false, codexChecking: false, codexError:'', codexRetries:0, codexRetryTimer:null, autoStarting: false, loading: false, creating: false, polling: false, resultVersion: '', invalidAlignment: false, toastTimer: null };
Object.assign(state,{extractBox:null,sectionMode:false,pageGaps:[],gapPicking:false,gapPreview:null,initializing:true,page:null,frame:null,selectionOrigin:{x:0,y:0},alignedPatch:null});
Object.assign(state,{references:[],aiLayerId:null,keepAI:false});
Object.assign(state,{tasks:new Map(),taskNotes:{},editorKey:null,pageEpoch:0,focusing:false,exporting:false});
Object.assign(state,{fontAssets:[],regions:[],regionNumbers:{},deletedRegionIds:{},restoredRegionIds:{},activeRegionId:null,projects:[],projectVersion:0,selectingRegion:false});
const generationTimerNodes=new Map();
function regionGenerationTimer(region){return generationTimer(regionBusy(region)||currentRegionTask(region,state.tasks.values()));}
function updateGenerationTimerLabels(){
  for(const [id,node] of generationTimerNodes){
    if(node.hidden)continue;
    const region=state.regions.find(item=>item.id===id),timer=region&&regionGenerationTimer(region);
    if(!timer){node.hidden=true;continue;}
    node.textContent=timer.label;node.dataset.running=String(timer.running);
    node.setAttribute('aria-label',`${region.name} ${timer.label}`);
  }
}
const layers=new LayerEditor(render,updateLayers);
const editHistory=new EditHistory(5),propertyEdits=new Map();
const layerSelection=new LayerSelection();
Object.assign(state,{linkCache:new Map(),regionMaskCache:new Map(),versionSelecting:false,selectionTarget:'region',maskMode:'hide',librarySelectionMode:'multiple',viewMode:'display'});
function setAutoText(enabled,key=quickRegionKey()){if(key!==quickRegionKey()||!canEditQuickRegion())return;const region=activeRegion();region.autoText=enabled;region.modifiedAt=Date.now();$('auto-text').checked=enabled;if(enabled&&state.target!=='auto')setTarget('auto');saveActiveRegion();}
function setSeparateBubble(enabled,key=quickRegionKey()){if(key!==quickRegionKey()||!canEditQuickRegion())return;const region=activeRegion();region.separateBubble=enabled;$('separate-bubble').checked=enabled;region.modifiedAt=Date.now();if(enabled&&state.target!=='auto')setTarget('auto');saveActiveRegion();}
const quickRepair=new QuickRepairPanel($('quick-repair'),{
 autoText:setAutoText,separateBubble:setSeparateBubble,
 prompt:(value,key)=>{if(key!==quickRegionKey()||!canEditQuickRegion())return;$('prompt').value=value;saveActiveRegion();},
 submit:key=>{if(key===quickRegionKey()&&!$('create-job').disabled&&!state.selectingRegion)void createJob();},
 preset:index=>{const region=activeRegion(),preset=customPrompts[index];if(!region||!canEditQuickRegion()||!preset?.prompt)return;edit('载入自定义提示词',()=>{$('prompt').value=preset.prompt;saveActiveRegion();});},
 action:action=>void quickRepairAction(action),layout:()=>syncQuickRepair(),canvasFocus:()=>stage.focus({preventScroll:true}),
 referenceFocus:()=>{state.referencePasteFocus=true;state.resultPasteFocus=false;},
 files:files=>void uploadQuickReferences(files),chooseReference:reference=>chooseReference(reference),
 removeReference:id=>{if(!canEditQuickRegion())return;state.references=state.references.filter(ref=>ref.id!==id);showReferences();},
 libraryMode:mode=>{if(!canEditQuickRegion())return;state.librarySelectionMode=mode;$('reference-selection-mode').value=mode;if(mode==='single'&&state.references.length>1){state.references=state.references.slice(0,1);showReferences();}renderReferenceLibrary();}
});
function quickRegionKey(){return `${state.page?.metadata.id||state.editorKey||'image'}:${state.activeRegionId||''}`;}
function canEditQuickRegion(){return canEditRepairInstructions(activeRegion(),state);}
function regionBusy(region){return activeRegionAttempt(region,state.tasks.values());}
const maskEncodings=new WeakMap(),linkLoads=new WeakMap(),taskMaskCache=new WeakMap();
function encodedMask(target){if(!target)return undefined;let saved=maskEncodings.get(target);if(!saved){saved=target.toDataURL('image/png');maskEncodings.set(target,saved);}return saved;}
function invalidateSelectionEncoding(){maskEncodings.delete(selection);state.selectionDirty=true;}
function regionMarkers(){return{deletedRegionIds:state.deletedRegionIds,restoredRegionIds:state.restoredRegionIds};}
function markRegionDeleted(id){state.deletedRegionIds[id]=Math.max(Date.now(),Number(state.restoredRegionIds[id]||0)+1);}
function markRegionRestored(id){state.restoredRegionIds[id]=Math.max(Date.now(),Number(state.deletedRegionIds[id]||0)+1);}
function syncQuickRepair(){
 const region=activeRegion(),visible=!document.body.classList.contains('integrated-repair')&&layerSelection.size<=1&&!!region&&state.viewMode==='edit'&&state.show==='current'&&!state.before&&['rect','frame-move'].includes(state.tool)&&!state.pointer&&!state.loading&&!$('annotation-dialog').open&&!$('generated-viewer').open&&!$('prompt-template-dialog').open&&!$('text-review-dialog').open;
 const disabled=!canEditQuickRegion();
 quickRepair.update({region,regionKey:quickRegionKey(),visible,disabled,locked:!!region&&!canEditRegion(region,chosenRegionLayer(region,layers.layers)),busy:state.loading||state.creating||state.versionSelecting,submitDisabled:$('create-job').disabled||!!state.selectingRegion,target:state.target,reason:$('submit-status').textContent,checking:state.codexChecking,reconnect:state.target==='auto'&&!state.codexReady,presets:customPrompts,references:region?.references||[],annotationImage:region?.annotations?.length?region.annotationImage:null,library:referenceLibraryCache.filter(ref=>!ref.deletedAt),libraryMode:state.librarySelectionMode});
 if(!visible)return;
 const t=transform(),frame=state.frame||region.frame,bounds=stage.getBoundingClientRect(),obstacles=[];
 for(const element of [$('repair-inspector'),$('floating-tools'),$('project-drawer'),$('frame-link'),document.querySelector('.view-controls')]){if(!element||element.hidden||!element.offsetWidth)continue;const b=element.getBoundingClientRect();const labelWidth=element.id==='frame-link'?Number(element.dataset.labelWidth)||0:0;obstacles.push({x:b.left-bounds.left-labelWidth,y:b.top-bounds.top,width:b.width+labelWidth,height:b.height});}
 quickRepair.place({x:t.x+frame.x*state.zoom,y:t.y+(region.coordinateSpace==='output'?frame.y:sourceY(frame.y))*state.zoom,width:frame.width*state.zoom,height:frame.height*state.zoom},{width:stage.clientWidth,height:stage.clientHeight},obstacles);
}
async function uploadQuickReferences(files){for(const file of files){try{await uploadReference(file);}catch(error){toast(error.message,true);}}}
async function quickRepairAction(action){
 if(action==='library'){await openReferenceLibrary(false);syncQuickRepair();return;}
 if(action==='manage-library'){revealProperties(['repair-details']);libraryManagementMode=true;await openReferenceLibrary(false,true);return;}
 if(action==='paste'){await pasteReference(quickRepair.referenceArea);return;}
 if(action==='mode'){revealProperties(['repair-details']);$('repair-mode-options').open=true;$('repair-mode-options').scrollIntoView({block:'nearest'});return;}
 if(action==='reconnect'){await checkCodex(true);return;}
 if(action==='unlock'){toggleRegionLock(activeRegion());return;}
 const id={annotation:'open-annotation',files:'add-reference',templates:'edit-prompt-templates','view-annotation':'view-annotation','delete-annotation':'delete-annotation'}[action];if(id)$(id).click();
}

function editorSnapshot(){
  flushRegionMasks();return{source:state.page?{metadata:structuredClone(state.page.metadata),revision:state.page.revision,session:embeddedSession?structuredClone(embeddedSession):null}:null,selectionSpace:state.selectionSpace||'source',sectionMode:state.sectionMode,pageGaps:structuredClone(state.pageGaps),layers:layers.snapshot(),regions:structuredClone(state.regions),activeRegionId:state.activeRegionId,selection:copyCanvas(selection),frame:state.frame?{...state.frame}:null,origin:{...state.selectionOrigin},ratio:$('selection-ratio').value,tasks:Object.fromEntries([...state.tasks].map(([id,task])=>[id,{decision:task.decision,alignment:task.alignment?{...task.alignment}:undefined,resultVersion:task.resultVersion}]))};
}
function rememberStep(snapshot,label){if(!snapshot)return;editHistory.commit(snapshot,label);updateHistory();}
function layerBackup(layer,decision){return taskLayerBackup(layers,layer,decision);}
function edit(label,action){for(const key of [...propertyEdits.keys()])finishPropertyEdit(key,'调整图层');const before=editorSnapshot();action();rememberStep(before,label);state.revision++;}
function restoreEditor(snapshot){
  const previousLayers=layers.layers;state.sectionMode=!!snapshot.sectionMode;state.pageGaps=structuredClone(snapshot.pageGaps||[]);
  for(const region of state.regions)if(!(snapshot.regions||[]).some(item=>item.id===region.id))markRegionDeleted(region.id);for(const region of snapshot.regions||[])if(!state.regions.some(item=>item.id===region.id)&&regionDeleted(region.id,regionMarkers()))markRegionRestored(region.id);
  state.regions=structuredClone(snapshot.regions||[]);state.regionMaskCache.clear();for(const region of state.regions){region.selectedVersionJobId=region.selectedVersionJobId||null;region.selectedVersionUpdatedAt=Date.now();region.link=region.link||null;region.linkUpdatedAt=Date.now();}state.activeRegionId=snapshot.activeRegionId||null;state.selectionSpace=snapshot.selectionSpace||activeRegion()?.coordinateSpace||'source';
  layers.restoreSnapshot(snapshot.layers);if(layers.active?.type==='text')writeTextLayoutControls(layers.active);selection.width=snapshot.selection.width;selection.height=snapshot.selection.height;selectionCtx.drawImage(snapshot.selection,0,0);invalidateSelectionEncoding();state.frame=snapshot.frame?{...snapshot.frame}:null;state.selectionOrigin={...snapshot.origin};$('selection-ratio').value=snapshot.ratio;
  for(const task of state.tasks.values()){
    const layer=layers.layers.find(item=>item.jobId===task.id),note=snapshot.tasks[task.id];
    if(layer){task.layerId=layer.id;task.decision=note?.decision==='discarded'?undefined:note?.decision;task.alignment=note?.alignment||task.alignment;task.resultVersion=task.result?.version||note?.resultVersion||task.resultVersion;}
    else if(task.layerId){const old=previousLayers.find(item=>item.id===task.layerId);if(old)task.layerBackup=layerBackup(old,task.decision);task.layerId=null;task.decision='discarded';task.resultVersion=task.result?.version||task.resultVersion;}
    rememberTask(task);
  }
  const selectedLayer=activeRegion()&&chosenRegionLayer(activeRegion(),layers.layers);if(selectedLayer&&state.tasks.has(selectedLayer.jobId))state.job=state.tasks.get(selectedLayer.jobId);if(state.job)focusTaskPanel(state.job);writeRegionFields(activeRegion());state.revision++;boundsChanged();updateHistory();renderTasks();renderRegions();render();
}
function beginPropertyEdit(key){if(!propertyEdits.has(key))propertyEdits.set(key,editorSnapshot());}
function finishPropertyEdit(key,label){const before=propertyEdits.get(key);if(before){propertyEdits.delete(key);rememberStep(before,label);}}
let projectTimer=null;
function adoptSavedProject(saved,submitted,epoch){
  if(epoch!==state.pageEpoch||!saved.project)return;
  const canonical=saved.project;layers.adoptCanonical(canonical.layers||[],submitted.layers||[],canonical.renderedLayers||[]);
  const current={regions:state.regions,tasks:state.taskNotes};adoptCanonicalReferences(current,submitted,canonical);
  for(const region of state.regions){const before=submitted.regions.find(item=>item.id===region.id),after=canonical.regions?.find(item=>item.id===region.id),mask=state.regionMaskCache.get(region.id);if(mask&&before&&after?.maskImage?.startsWith('/repair/project-assets/')&&encodedMask(mask)===before.maskImage&&region.maskImage===after.maskImage)state.regionMaskCache.delete(region.id);}
  for(const key of ['deletedRegionIds','restoredRegionIds'])for(const [id,time] of Object.entries(canonical[key]||{}))state[key][id]=Math.max(Number(state[key][id]||0),Number(time)||0);
  state.projectVersion=Math.max(state.projectVersion,saved.version||0);
}
async function saveProjectNow(){
  const id=state.page?.metadata.id,epoch=state.pageEpoch;if(!id)return;
  await ensureLayerFonts(layers.layers);await layers.ensureForSerialization();if(epoch!==state.pageEpoch||id!==state.page?.metadata.id)return;
  const submitted=projectPayload(),response=await fetch(`/repair/api/sources/${id}/project`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(submitted)}),saved=await response.json();
  if(!response.ok)throw new Error(saved.error||'工程暂时未保存');adoptSavedProject(saved,submitted,epoch);
}
function scheduleProjectSave(){
  if(!state.page||state.loading)return;
  clearTimeout(projectTimer);const epoch=state.pageEpoch;
  projectTimer=setTimeout(()=>{if(epoch===state.pageEpoch)void saveProjectNow().catch(error=>toast(error.message||'工程暂时未保存，请检查本地服务',true));},800);
}
function projectPayload(){syncBackgroundDimensions();flushRegionMasks();return{canvasVersion:2,assetsVersion:1,sectionMode:state.sectionMode,pageSections:editorSections(),pageGaps:state.pageGaps,layers:layers.project(),renderedLayers:layers.serialize(),activeLayerId:layers.activeId,regions:state.regions.map(({submitting,referenceLoading,linking,...region})=>region),activeRegionId:state.activeRegionId,regionNumbers:state.regionNumbers,...regionMarkers(),commonPrompt:'',tasks:state.taskNotes,sourceRevision:state.page?.revision,fontAssets:state.fontAssets};}
async function flushProject(){clearTimeout(projectTimer);await saveProjectNow();}
function rememberTask(task){
  const note={decision:task.decision,layerId:task.layerId,resultVersion:task.resultVersion,alignment:task.alignment,layerBackup:task.layerBackup,textLayerBackup:task.textLayerBackup,autoTextReceived:task.autoTextReceived,earlyTextReceived:task.earlyTextReceived,earlyTextIds:task.earlyTextIds,earlyTextVersion:task.earlyTextVersion,earlyTextAttemptId:task.earlyTextAttemptId,updatedAt:Date.now()};
  state.taskNotes[task.id]=note;localStorage.setItem(`patch-tasks:${state.editorKey}`,JSON.stringify(state.taskNotes));scheduleProjectSave();
}
function resetTasks(key,saved={}){
  state.fontAssets=[];setProjectFontAssets([]);
  selectionMenu.close();
  state.pageEpoch++;state.compareBookmark=null;state.editorKey=key;state.tasks=new Map();state.job=null;state.result=null;state.preview=null;state.aiLayerId=null;state.taskNotes={...saved};editHistory.clear();propertyEdits.clear();
  state.sectionMode=false;state.pageGaps=[];state.gapPicking=false;state.gapPreview=null;
  state.linkCache.clear();state.regionMaskCache.clear();state.regions=[];state.selectionSpace=null;state.regionNumbers={};state.deletedRegionIds={};state.restoredRegionIds={};invalidateSelectionEncoding();state.activeRegionId=null;state.selectingRegion=false;layerSelection.clear();
  try{const local=JSON.parse(localStorage.getItem(`patch-tasks:${key}`)||'{}');for(const [id,note] of Object.entries(local))if((note.updatedAt||0)>=(state.taskNotes[id]?.updatedAt||0))state.taskNotes[id]=note;}catch{}
  $('job-panel').hidden=true;$('result-panel').hidden=true;renderTasks();renderRegions();
}


function readTextLayoutControls(){return normalizeTextLayout({fontSize:$('text-size').value,textDirection:$('text-direction').value,textAlign:$('text-align').value,letterSpacing:$('text-spacing').value,lineHeight:Number($('text-line-height').value)/100,paragraphSpacing:$('text-paragraph-spacing').value,textBoxWidth:$('text-box-width').value,textBoxHeight:$('text-box-height').value,textWrap:$('text-wrap').checked,strikethrough:$('text-strikethrough').checked,textStrokeWidth:$('text-stroke-width').value,textStrokeColor:$('text-stroke-color').value,textShadow:$('text-shadow').checked?{color:$('text-shadow-color').value,blur:$('text-shadow-blur').value,x:$('text-shadow-x').value,y:$('text-shadow-y').value}:null});}
function writeTextLayoutControls(layer){const settings=normalizeTextLayout(layer),values={'text-direction':settings.textDirection,'text-align':settings.textAlign,'text-spacing':settings.letterSpacing,'text-line-height':settings.lineHeight*100,'text-paragraph-spacing':settings.paragraphSpacing,'text-box-width':settings.textBoxWidth,'text-box-height':settings.textBoxHeight,'text-stroke-width':settings.textStrokeWidth,'text-stroke-color':settings.textStrokeColor,'text-shadow-color':settings.textShadow?.color||'#000000','text-shadow-blur':settings.textShadow?.blur??4,'text-shadow-x':settings.textShadow?.x??2,'text-shadow-y':settings.textShadow?.y??2};for(const [id,value] of Object.entries(values))if(document.activeElement!==$(id))$(id).value=String(value);$('text-wrap').checked=settings.textWrap;$('text-strikethrough').checked=settings.strikethrough;$('text-shadow').checked=!!settings.textShadow;}
function updateTextLayoutPreview(preview){const settings=readTextLayoutControls(),vertical=settings.textDirection!=='horizontal';preview.style.writingMode=vertical?settings.textDirection:'horizontal-tb';preview.style.letterSpacing=settings.letterSpacing+'px';preview.style.lineHeight=String(settings.lineHeight);preview.style.textAlign=settings.textAlign;preview.style.color=$('text-color').value;preview.style.fontStyle=$('text-italic').checked?'italic':'normal';preview.style.textDecoration=[$('text-underline').checked?'underline':'',settings.strikethrough?'line-through':''].filter(Boolean).join(' ')||'none';preview.style.webkitTextStroke=settings.textStrokeWidth+'px '+settings.textStrokeColor;preview.style.textShadow=settings.textShadow?`${settings.textShadow.x}px ${settings.textShadow.y}px ${settings.textShadow.blur}px ${settings.textShadow.color}`:'none';const names=vertical?['顶端对齐','中部对齐','底端对齐','两端对齐']:['居左','居中','居右','两端对齐'];[...$('text-align').options].forEach((option,index)=>option.textContent=names[index]);}

function updateTextFontPreview(){
 const select=$('text-font'),preview=$('text-font-preview'),family=select.value||defaultTextFont,fontWeight=Number($('text-weight').value)||400;
 preview.textContent=$('layer-text').value.trim().slice(0,70)||'山河万里，风月同天。';preview.style.fontFamily=`"${family}","${defaultTextFont}",sans-serif`;preview.style.fontWeight=String(fontWeight);updateTextLayoutPreview(preview);
 const request=state.fontPreviewRequest=(state.fontPreviewRequest||0)+1;$('text-font-status').textContent='正在加载字体…';
 Promise.all([ensureTextFont({fontFamily:family,fontWeight}),ensureTextFont({fontFamily:defaultTextFont})]).then(()=>{if(state.fontPreviewRequest===request){$('text-font-status').textContent=select.selectedOptions[0]?.dataset.legacy?'旧图层系统字体':'内置中文字体 · 免费商用';render();}}).catch(error=>{if(state.fontPreviewRequest===request)$('text-font-status').textContent=error.message;});
}
function selectedLayerControls(){
  const selected=layers.active,locked=!!selected&&(!canEditLayer(selected,contentRegion(selected,state.regions))||['section','background'].includes(selected.type));
  for(const [id,key,multiplier] of [['layer-x','x',1],['layer-y','y',1],['layer-scale','scale',100],['layer-angle','angle',1],['layer-opacity','opacity',100]]){const input=$(id);input.disabled=!selected||locked;if(selected&&document.activeElement!==input)input.value=formatDecimal(selected[key]*multiplier);}
  const scales=selected?layerScales(selected):{x:1,y:1};for(const [id,value] of [['layer-scale-x',scales.x],['layer-scale-y',scales.y]]){$(id).disabled=!selected||locked;if(document.activeElement!==$(id))$(id).value=formatDecimal(value*100);}$('layer-scale-mode').disabled=!selected||locked;$('layer-scale-mode').value=selected?.scaleMode||'uniform';$('uniform-scale-field').hidden=selected?.scaleMode==='independent';$('independent-scale-fields').hidden=selected?.scaleMode!=='independent';
  $('layer-opacity-value').textContent=`${selected?Math.round(selected.opacity*100):100}%`;$('toggle-layer-lock').disabled=!selected;$('toggle-layer-lock').textContent=locked?'🔒 解锁图层':'🔓 锁定图层';
  for(const id of ['layer-up','layer-down','layer-delete','mask-hide','mask-show','mask-reset'])$(id).disabled=!selected||locked;
  for(const id of textControlIDs)$(id).disabled=locked;
  updateFeatherControls();syncInspector();
  for(const [id,mode] of [['mask-hide','hide'],['mask-show','show']]){$(id).setAttribute('aria-pressed',String(state.maskMode===mode));$(id).classList.toggle('active',state.maskMode===mode);}
  $('mask-state').textContent=selected?.type==='image'?(locked?'图片已锁定，解锁后可绘制蒙版':`当前${state.maskMode==='hide'?'黑笔：隐藏':'白笔：显示'} · ${selected.maskCanvas?'蒙版独立保留':'可添加蒙版'} · X 切换黑白`):'请选择生成的图片图层';
}

async function selectContentLayer(id,{reveal=true,locate=true,preserveListSelection=false}={}){
  const layer=layers.layers.find(item=>item.id===id);if(!layer)return;
  if(!preserveListSelection)layerSelection.single(layerSelectionKey(layer));
  const request=state.contentFocusRequest=(state.contentFocusRequest||0)+1,epoch=state.pageEpoch,region=contentRegion(layer,state.regions);
  if(region&&region.id!==state.activeRegionId)await selectRegion(region.id,{focus:false,preserveListSelection:true});
  if(request!==state.contentFocusRequest||epoch!==state.pageEpoch)return;
  if(!region){saveActiveRegion();state.activeRegionId=null;clearSelection();writeRegionFields(null);}
  await layers.ensureLayer(layer);if(request!==state.contentFocusRequest||epoch!==state.pageEpoch)return;state.selectionTarget='layer';layers.select(id);
  if(layer.type==='text'){for(const [name,key] of [['layer-text','text'],['text-font','fontFamily'],['text-size','fontSize'],['text-color','color']])name==='text-font'?setFontSelection($(name),layer[key]):$(name).value=layer[key]|| (name==='text-color'?'#111111':'');for(const [name,key] of [['text-italic','italic'],['text-underline','underline']])$(name).checked=!!layer[key];setFontWeightSelection($('text-weight'),layer.fontFamily,textFontWeight(layer),{preserve:true});writeTextLayoutControls(layer);}
  if(locate){if(layer.type==='section')locateSection(layer);else if(layer.type!=='background'){const box=layers.bounds(layer);if(box)locateFrame(box,layer.coordinateSpace==='output');}}
  setViewMode('edit');selectedLayerControls();
  if(layer.type==='text')updateTextFontPreview();if(reveal)revealProperties(layer.type==='section'?['section-details']:layer.type==='background'?['background-details']:layer.type==='text'?['text-details']:['layer-edit-details','image-stroke-details']);
}
function selectedObjects(){const region=state.selectionTarget==='region'?activeRegion():contentRegion(layers.active,state.regions);return{region,layer:state.selectionTarget==='region'?(region&&chosenRegionLayer(region,layers.layers)):layers.active};}
function centerStatus(message){$('center-status').textContent=message;$('center-status').hidden=false;clearTimeout(state.centerStatusTimer);state.centerStatusTimer=setTimeout(()=>$('center-status').hidden=true,1300);}
function toggleLayerLock(layer=layers.active){if(!layer)return;const region=contentRegion(layer,state.regions);let locked;edit('切换图层锁定',()=>{locked=toggleObjectLock('layer',region,layer);if(region)region.modifiedAt=Date.now();layers.update();});centerStatus((region?region.name+' · 选框与图片':layer.name)+' · '+(locked?'已锁定':'已解锁'));renderRegions();updateButtons();}
function toggleSelectedLock(){if(state.pointer||state.selectingRegion)return;if(layerSelection.size>1)return setSelectedLocks();const {region,layer}=selectedObjects();if(state.selectionTarget==='region'&&region)return toggleRegionLock(region);if(layer)return toggleLayerLock(layer);centerStatus('请先选择选区或图层');}
function toggleRegionLock(region){if(!region)return;let locked;edit('切换选区锁定',()=>{locked=toggleObjectLock('region',region,chosenRegionLayer(region,layers.layers));region.modifiedAt=Date.now();layers.update();});centerStatus(region.name+(chosenRegionLayer(region,layers.layers)?' · 选框与图片':'')+' · '+(locked?'已锁定':'已解锁'));renderRegions();updateButtons();}
function revealProperties(ids){
  if(document.body.classList.contains('integrated-repair')){if(!ids.length)return;const inspector=$('repair-inspector');inspector.dataset.tab='properties';for(const button of inspector.querySelectorAll('[data-repair-tab]'))button.classList.toggle('active',button.dataset.repairTab==='properties');}
  const inspector=$('repair-inspector');inspector.hidden=false;inspector.classList.remove('collapsed');$('toggle-inspector').setAttribute('aria-expanded','true');
  for(const group of $('property-scroll').querySelectorAll(':scope > details'))group.open=ids.includes(group.id);
  for(const id of ids)$(id).open=true;syncInspector();
  requestAnimationFrame(()=>{$('property-scroll').scrollTop=0;const group=$(ids.at(-1));if(group&&!group.hidden)group.scrollIntoView({block:'start'});});
}
function syncInspector(){
  const region=activeRegion(),layer=layers.active,layerTarget=state.selectionTarget==='layer',ordinary=layerTarget&&layer&&['paint','text','background'].includes(layer.type),generated=layer?.type==='image';
  $('object-kind').textContent=layerTarget?(layer?.type==='background'?'底色图层':layer?.type==='section'?'漫画图层':generated?((layer?.imported||layer?.extracted)?'图片图层':'生成图片'):layer?.type==='text'?'文字图层':layer?.type==='paint'?'绘画图层':state.tool==='text'?'文字工具':'画笔工具'):'修复选区';
  $('object-title').textContent=layerTarget?(layer?.name||(state.tool==='text'?'点击画面放置文字':'新建透明图层后绘画')):(region?region.name+' · '+(region.ratio||'1:1'):'先画框，或选择一个选区');
  if(!layer&&!region&&state.tool==='select'){$('object-kind').textContent='未选择';$('object-title').textContent='点击画布或图层列表选择元素';}
  const object=layerTarget?layer:region;$('selected-unlock').disabled=!object||state.loading||state.creating;$('selected-unlock').textContent=object&&(layerTarget?!canEditLayer(layer,contentRegion(layer,state.regions)):!canEditRegion(region,chosenRegionLayer(region,layers.layers)))?'解锁（F）':'锁定（F）';
  $('repair-details').hidden=!region||!!ordinary;$('selection-settings').hidden=!!ordinary||(!region&&!['rect','frame-move','brush','erase'].includes(state.tool));
  $('layer-edit-details').hidden=!layer||['section','background'].includes(layer.type);$('background-details').hidden=!(layerTarget&&layer?.type==='background');if(layer?.type==='background')syncBackgroundControls(layer);$('section-details').hidden=!(layerTarget&&layer?.type==='section');if(layer?.type==='section'){$('section-size').textContent='图层长度 '+layer.height+' px · 画面 '+layer.sourceHeight+' px · 透明 '+(layer.height-layer.sourceHeight)+' px';for(const id of ['section-grow','section-shrink','section-reset','section-up','section-down','section-delete'])$(id).disabled=!!layer.locked||state.loading||state.creating;}$('generated-details').hidden=!!ordinary||(!region&&!layer?.jobId);
  $('image-stroke-details').hidden=!(layerTarget&&generated);if(generated){if(document.activeElement!==$('image-stroke-width'))$('image-stroke-width').value=String(layer.strokeWidth||0);$('image-stroke-color').value=layer.strokeColor||'#111111';for(const id of ['image-stroke-width','image-stroke-color'])$(id).disabled=!!layer.locked;}
  $('paint-details').hidden=state.tool!=='paint'&&layer?.type!=='paint';$('text-details').hidden=true;$('layer-mask-details').hidden=!generated;
  const maskSlot=state.tool==='mask'?$('mask-brush-slot'):$('paint-details');if($('paint-controls').parentElement!==maskSlot)maskSlot.append($('paint-controls'));
  $('paint-color').closest('label').hidden=state.tool==='mask';
  syncFrameLinkState(region);
  $('object-link').hidden=!region||!!ordinary||!chosenRegionLayer(region,layers.layers);$('object-link').textContent=region?.link?'解开链接':'链接图片';$('object-link').setAttribute('aria-pressed',String(!!region?.link));$('object-link').disabled=state.loading||state.creating||!!region?.linking;
  for(const [id,key] of [['selection-x','x'],['selection-y','y'],['selection-width','width'],['selection-height','height']]){const input=$(id);input.disabled=!canEditRegion(region,region&&chosenRegionLayer(region,layers.layers))||state.loading||state.creating||!!state.selectingRegion;if(document.activeElement!==input)input.value=region?.frame?.[key]??'';}
  if(document.activeElement!==$('view-zoom'))$('view-zoom').value=formatDecimal(state.zoom*100);
  const preview=$('mask-preview'),pctx=preview.getContext('2d');pctx.clearRect(0,0,72,72);if(generated){pctx.fillStyle='#fff';pctx.fillRect(0,0,72,72);if(layer.maskCanvas){pctx.clearRect(0,0,72,72);pctx.drawImage(layer.maskCanvas,0,0,72,72);const mask=pctx.getImageData(0,0,72,72);for(let i=0;i<mask.data.length;i+=4){mask.data[i]=mask.data[i+1]=mask.data[i+2]=mask.data[i+3];mask.data[i+3]=255;}pctx.putImageData(mask,0,0);}}
}
function updateLayers(editor){
  const chosen=normalizeRepairVersions(state.regions,editor.layers);const active=editor.active;if(active?.versionHidden&&active.regionId===state.activeRegionId&&state.selectionTarget==='layer'){const layer=chosen.get(active.regionId);if(layer)editor.activeId=layer.id;}syncLinkedRegions();
  $('layer-list').replaceChildren();
  for(const layer of [...editor.layers].reverse()){
    if(state.regions.some(region=>region.id===layer.regionId||(!!layer.jobId&&region.jobId===layer.jobId)))continue;
    const row=document.createElement('div');row.className=`layer-row${layer.id===editor.activeId?' active':''}`;const label=document.createElement('span');label.textContent=`${layer.type==='text'?'T':layer.type==='paint'?'◒':'▧'} ${layer.linkGroupId?'🔗 ':''}${layer.name}`;label.title=layer.name+(layer.autoTextPending?' · 原文已识别，可编辑；等待图片返回，暂时隐藏以避免重影':layer.textNeedsReview?' · Codex 标出了疑字，请对照原图校对文字':'');if(layer.autoTextPending||layer.textNeedsReview){const hint=document.createElement('small');hint.className='pending-text-label';hint.textContent=layer.textNeedsReview?'原文需校对':'文字就绪';hint.title=label.title;row.append(hint);}row.append(label);
    const lock=document.createElement('button');lock.textContent=layer.locked?'🔒':'🔓';lock.title=layer.locked?'解锁图层':'锁定图层';lock.addEventListener('click',event=>{event.stopPropagation();toggleLayerLock(layer);});row.append(lock);
    const visible=document.createElement('button');visible.textContent=layer.visible?'◉':'○';visible.title=layer.visible?'隐藏图层':'显示图层';visible.disabled=!!layer.locked;visible.addEventListener('click',event=>{event.stopPropagation();edit('图层显示／隐藏',()=>{if(layer.autoTextPending)layer.pendingAutoShow=false;layer.visible=!layer.visible;editor.update();});});row.append(visible);
    if(layer.jobId){const viewButton=document.createElement('button');viewButton.textContent='原图';viewButton.addEventListener('click',event=>{event.stopPropagation();const task=state.tasks.get(layer.jobId);if(task)void viewGenerated(task);});row.append(viewButton);}
    row.dataset.selectionKey='layer:'+layer.id;row.prepend(selectionCheck('layer:'+layer.id,layer.name));row.addEventListener('click',event=>{if(event.target.closest('button'))return;void selectListItem('layer:'+layer.id,event);});$('layer-list').append(row);
  }selectedLayerControls();renderRegions();scheduleProjectSave();
}
function textSettings(){return{text:$('layer-text').value,fontFamily:$('text-font').value,fontSize:Math.max(6,Math.min(512,Number($('text-size').value)||36)),fontWeight:Number($('text-weight').value)||400,bold:Number($('text-weight').value)>=700,italic:$('text-italic').checked,underline:$('text-underline').checked,color:$('text-color').value,...readTextLayoutControls()};}
function viewCenter(){const t=transform();return{x:Math.max(0,Math.min(state.width,Math.round((stage.clientWidth/2-t.x)/state.zoom))),y:Math.max(0,Math.min(displayHeight(),Math.round((stage.clientHeight/2-t.y)/state.zoom)))};}

function copyCanvas(source) {
  const copy = canvas(source.width, source.height); copy.getContext('2d').drawImage(source, 0, 0); return copy;
}
function activeRegion(){return state.regions.find(region=>region.id===state.activeRegionId);}
function syncRegionNumbers(){state.regionNumbers=assignRegionNumbers(state.regions,state.tasks.values(),state.regionNumbers);}
function taskRegionName(task){return `选区 ${state.regionNumbers[task.regionId||`task:${task.id}`]||task.region?.number||'—'}`;}
function regionHasPrompt(region){return !!region?.prompt?.trim()||region?.autoText===true||region?.separateBubble===true;}
function writeRegionFields(region){
  $('selected-region-label').textContent=region?`${region.name} · ${region.ratio||'1:1'}`:'先画框，或选择一个选区图层。';
  $('auto-text').checked=region?.autoText===true;$('separate-bubble').checked=region?.separateBubble===true;$('generation-mode').value=region?.generationMode==='configured'?'configured':'low';
  $('prompt').value=region?.prompt||'';state.references=structuredClone(region?.references||[]);$('reference-library').hidden=true;$('library-tools').hidden=true;showReferences(false);
  if(region){$('selection-ratio').value=region.ratio||'1:1';$('context-padding').value=String(region.padding??80);$('padding-value').textContent=`${$('context-padding').value} px`;$('feather').value=String(region.feather??6);$('feather-value').textContent=`${$('feather').value} px`;}
}
function addRegionFromSelection(){
  syncRegionNumbers();const number=Math.max(0,...Object.values(state.regionNumbers))+1;
  const region={id:crypto.randomUUID(),number,name:`选区 ${number}`,coordinateSpace:state.selectionSpace||'source',locked:false,frame:{...state.frame},origin:{...state.selectionOrigin},maskImage:encodedMask(selection),ratio:$('selection-ratio').value,padding:Number($('context-padding').value),feather:6,prompt:'',references:[],modifiedAt:Date.now()};
  state.regionNumbers[region.id]=number;state.regions.push(region);layerSelection.single('region:'+region.id);state.activeRegionId=region.id;state.selectionDirty=false;layers.activeId=null;state.selectionTarget='region';state.resultPasteFocus=false;writeRegionFields(region);closeJob();renderRegions();scheduleProjectSave();updateButtons();if(document.body.classList.contains('integrated-repair'))revealProperties(['repair-details']);
}
function saveActiveRegion(){
  const region=activeRegion();if(!region)return;
  if(state.selectingRegion||!updateRepairInstructions(region,{prompt:$('prompt').value,references:state.references,padding:$('context-padding').value}))return;if(!region.locked)region.ratio=$('selection-ratio').value;$('selected-region-label').textContent=`${region.name} · ${region.ratio}`;
  if(!region.locked&&state.frame&&state.bounds&&(state.selectionDirty||JSON.stringify(region.frame)!==JSON.stringify(state.frame))){region.frame={...state.frame};region.origin={...state.selectionOrigin};region.maskImage=encodedMask(selection);state.regionMaskCache.delete(region.id);if(region.link){const layer=chosenRegionLayer(region,layers.layers);if(layer){region.link={id:crypto.randomUUID(),layerId:layer.id,pose:poseOf(layer),frame:{...region.frame},origin:{...region.origin},maskImage:region.maskImage,marks:structuredClone(region.annotations||[])};state.linkCache.set(region.link.id,{mask:copyCanvas(selection),pose:JSON.stringify(poseOf(layer))});region.linkUpdatedAt=Date.now();}}}
  state.selectionDirty=false;region.modifiedAt=Date.now();scheduleProjectSave();renderRegions();updateButtons();
}
async function selectRegion(id,{locate=false,focus=true,preserveListSelection=false}={}){
  const region=state.regions.find(item=>item.id===id);if(!region)return;if(!preserveListSelection)layerSelection.single('region:'+id);saveActiveRegion();state.taskFocusRequest=(state.taskFocusRequest||0)+1;state.activeRegionId=id;layers.activeId=chosenRegionLayer(region,layers.layers)?.id||null;state.selectionTarget='region';state.resultPasteFocus=false;writeRegionFields(region);
  promoteRegionCoordinates(region);state.selectionSpace=region.coordinateSpace||'source';invalidateSelectionEncoding();state.selectingRegion=id;state.frame={...region.frame};state.selectionOrigin=region.origin||{x:region.frame.x,y:region.frame.y};selection.width=region.frame.width;selection.height=region.frame.height;selectionCtx.fillStyle='#ec7952';selectionCtx.fillRect(0,0,selection.width,selection.height);boundsChanged();if(locate)locateFrame(region.frame,region.coordinateSpace==='output');renderRegions();focusRegionTaskPanel(region);
  const epoch=state.pageEpoch;
  try{const image=region.maskImage?await decodeImage(region.maskImage):null;if(epoch!==state.pageEpoch||state.activeRegionId!==id)return;const frame=region.frame;selection.width=image?.naturalWidth||frame.width;selection.height=image?.naturalHeight||frame.height;state.selectionOrigin=region.origin||{x:frame.x,y:frame.y};state.frame={...frame};if(image)selectionCtx.drawImage(image,0,0);else{selectionCtx.fillStyle='#ec7952';selectionCtx.fillRect(0,0,selection.width,selection.height);}state.selectionDirty=false;boundsChanged();renderRegions();const task=focusRegionTaskPanel(region);if(task){if(task.layerId)layers.select(task.layerId);if(focus)void focusTask(task.id);}}
  catch(error){if(epoch===state.pageEpoch&&state.activeRegionId===id)toast(error.message||'选区读取失败',true);}
  finally{if(epoch===state.pageEpoch&&state.selectingRegion===id){state.selectingRegion=false;updateButtons();}}
}
function focusRegionTaskPanel(region){
  const selectedLayer=chosenRegionLayer(region,layers.layers),latest=currentRegionTask(region,state.tasks.values()),task=isTextReviewTask(latest)||latest?.receiveError?latest:(selectedLayer&&state.tasks.get(selectedLayer.jobId))||latest;
  if(task)focusTaskPanel(task);else closeJob();return task;
}
function flushRegionMasks(){for(const region of state.regions){const mask=state.regionMaskCache.get(region.id);if(mask)region.maskImage=encodedMask(mask);}}
function setRegionMask(region,mask,frame,marks){region.frame={...frame};region.origin={x:frame.x,y:frame.y};region.annotations=marks;state.regionMaskCache.set(region.id,mask);region.modifiedAt=Date.now();if(region.id===state.activeRegionId){invalidateSelectionEncoding();selection.width=mask.width;selection.height=mask.height;selectionCtx.drawImage(mask,0,0);state.frame={...frame};state.selectionOrigin={...region.origin};state.bounds={...frame};$('selection-info').textContent=`${frame.width} × ${frame.height} px · 位置 ${frame.x}, ${frame.y}`;}}
async function cacheLink(region){if(!region.link||state.linkCache.has(region.link.id))return;const descriptor=region.link,epoch=state.pageEpoch;if(linkLoads.has(descriptor))return linkLoads.get(descriptor);const pending=(async()=>{const image=await decodeImage(descriptor.maskImage);if(epoch===state.pageEpoch&&region.link?.id===descriptor.id)state.linkCache.set(descriptor.id,{mask:copyCanvas(image),pose:''});})();linkLoads.set(descriptor,pending);try{await pending;}finally{linkLoads.delete(descriptor);}}
async function restoreLinkCaches(){syncLinkedRegions();}
function syncLinkedRegions(){
  const ids=new Set(state.regions.map(region=>region.link?.id).filter(Boolean));for(const id of state.linkCache.keys())if(!ids.has(id))state.linkCache.delete(id);
  for(const region of state.regions){const layer=chosenRegionLayer(region,layers.layers),link=region.link;if(!layer||!link||link.layerId!==layer.id)continue;const pose=JSON.stringify(poseOf(layer));if(pose===JSON.stringify(link.pose)&&!state.linkCache.has(link.id))continue;const cache=state.linkCache.get(link.id);if(!cache){void cacheLink(region).then(()=>{if(region.link){syncLinkedRegions();render();}}).catch(error=>toast(error.message,true));continue;}if(cache.pose===pose)continue;cache.pose=pose;const delta=layerDelta(link.pose,layer),frame=mappedFrame(link.frame,delta,state.width,regionSpaceHeight(region,state.height,displayHeight())),mask=canvas(frame.width,frame.height),c=mask.getContext('2d');c.setTransform(delta.a,delta.b,delta.c,delta.d,delta.e-frame.x,delta.f-frame.y);c.drawImage(cache.mask,link.origin.x,link.origin.y);setRegionMask(region,mask,frame,mapMarks(delta,link.marks));}
}
async function bindRegionLink(region,layer){const epoch=state.pageEpoch;await layers.ensureLayer(layer);flushRegionMasks();const mask=region.maskImage?copyCanvas(await decodeImage(region.maskImage)):copyCanvas(selection);if(epoch!==state.pageEpoch||!state.regions.includes(region)||!layers.layers.includes(layer))throw new Error('页面已切换');region.link={id:crypto.randomUUID(),layerId:layer.id,pose:poseOf(layer),frame:{...region.frame},origin:{...(region.origin||region.frame)},maskImage:encodedMask(mask),marks:structuredClone(region.annotations||[])};state.linkCache.set(region.link.id,{mask,pose:JSON.stringify(poseOf(layer))});region.linkUpdatedAt=Date.now();}
async function toggleRepairLink(region){if(region.linking||state.pointer)return;const layer=chosenRegionLayer(region,layers.layers);if(!layer)return toast('生成图片后可以链接选区和图片',true);const before=editorSnapshot();region.linking=true;renderRegions();try{if(region.link){region.link=null;region.linkUpdatedAt=Date.now();}else await bindRegionLink(region,layer);rememberStep(before,region.link?'链接选区与图片':'解开选区与图片');state.revision++;scheduleProjectSave();}catch(error){toast(error.message,true);}finally{region.linking=false;renderRegions();render();}}
function frameMoveSource(region){const mask=state.regionMaskCache.get(region.id)||selection;return{frame:{...region.frame},origin:{...(region.origin||region.frame)},mask:copyCanvas(mask),marks:structuredClone(region.annotations||[]),layer:chosenRegionLayer(region,layers.layers),pose:chosenRegionLayer(region,layers.layers)?poseOf(chosenRegionLayer(region,layers.layers)):null};}
function applyRegionFrame(region,source,frame){
  const delta=frameMap(source.frame,frame);if(region.link&&source.layer){const transformed={...source.layer,...source.pose};transformLayer(transformed,delta);Object.assign(source.layer,poseOf(transformed),{scaleMode:transformed.scaleMode});syncLinkedRegions();layers.update();}
  else {const mask=canvas(frame.width,frame.height),c=mask.getContext('2d');c.setTransform(delta.a,delta.b,delta.c,delta.d,delta.e-frame.x,delta.f-frame.y);c.drawImage(source.mask,source.origin.x,source.origin.y);setRegionMask(region,mask,frame,mapMarks(delta,source.marks));}
  render();
}
async function selectRepairVersion(region,task){
  if(state.loading||state.creating||state.pointer||state.versionSelecting)return;if(!task.result)return;const epoch=state.pageEpoch;
  if(region.id!==state.activeRegionId)await selectRegion(region.id,{locate:true,focus:false});const before=editorSnapshot();state.versionSelecting=true;updateButtons();
  try{let layer=layers.layers.find(item=>item.jobId===task.id);if(!layer){task.decision=undefined;task.resultVersion='';await receiveTaskResult(task,undefined,task.result.version,{record:false});layer=layers.layers.find(item=>item.jobId===task.id);if(!layer)throw new Error('该版本暂时无法读取');const backup=task.layerBackup;if(backup){for(const key of ['x','y','scale','scaleX','scaleY','scaleMode','angle','skewX','opacity','visible','locked','userMaskModified','feather'])if(backup[key]!==undefined)layer[key]=backup[key];for(const [key,data] of [['maskCanvas',backup.mask],['baseMaskCanvas',backup.baseMask],['maskEditsCanvas',backup.maskEdits]])if(data)layer[key]=copyCanvas(await decodeImage(data));delete layer.maskedCache;}else layer.locked=true;}
    if(epoch!==state.pageEpoch)return;region.selectedVersionJobId=task.id;region.versionPinned=true;region.selectedVersionUpdatedAt=Date.now();if(region.link)await bindRegionLink(region,layer);layer.visible=true;task.layerId=layer.id;task.decision='accepted';region.locked=!!layer.locked;normalizeRepairVersions(state.regions,layers.layers);state.selectionTarget='layer';layers.select(layer.id);rememberTask(task);rememberStep(before,'切换生成版本');state.revision++;await focusTask(task.id);setShow('current');toast(`${region.name} 已采用这个历史版本，无需重新生成。`);
  }catch(error){if(epoch===state.pageEpoch)toast(error.message,true);}finally{state.versionSelecting=false;renderRegions();updateButtons();}
}
function regionState(region){if(region.submitting)return'提交中';const pending=regionBusy(region);if(pending)return statusLabels[taskStatus(pending)]||'处理中';const latest=currentRegionTask(region,state.tasks.values()),layer=chosenRegionLayer(region,layers.layers),selected=layer&&state.tasks.get(layer.jobId),task=autoRunning(latest)||latest?.receiveError||latest&&taskStatus(latest)==='awaiting_result_review'?latest:selected||latest;if(task)return statusLabels[taskStatus(task)]||'已提交';if(region.jobId)return'读取任务中';return regionHasPrompt(region)?'待提交':'待填写';}
async function chooseRepairRegion(region,{preserveListSelection=false}={}){setViewMode('edit');await selectRegion(region.id,{locate:true,preserveListSelection});setTool('frame-move',{reveal:false});revealProperties(['repair-details']);}
function repairAction(container,text,action,{disabled=false,title='',key=text}={}){
  const button=document.createElement('button');button.textContent=text;button.dataset.action=key;button.disabled=state.loading||state.creating||disabled;if(title)button.title=title;
  button.addEventListener('click',event=>{event.stopPropagation();void action();});container.append(button);return button;
}
function taskActions(task,container){
  const status=taskStatus(task),locked=!!layers.layers.find(layer=>layer.id===task.layerId)?.locked;
  const action=(text,callback,disabled=false,title='')=>repairAction(container,text,callback,{disabled,title});
  if(hasReviewableAttempt(task)){
    const keep=action(task.accepting?'正在采用…':'仍然采用这次结果',()=>acceptFlaggedAttempt(task),!!task.accepting,'使用这次已经生成的图片，不重新生图');
    keep.classList.add('accept-flagged-result');
  }
  if(task.result)action('查看生成原图',()=>viewGenerated(task));
  if(task.layerId)action('编辑结果',async()=>{const region=state.regions.find(item=>item.id===task.regionId);if(region)await selectRegion(region.id,{locate:true,focus:false});else locateTask(task);if(task.layerId){setViewMode('edit');$('layer-edit-details').open=true;state.selectionTarget='layer';await selectContentLayer(task.layerId,{locate:false});}await focusTask(task.id);});
  if(status==='review')action('检查结果',()=>{void focusTask(task.id);$('generated-details').open=true;});
  else if(canOpenTextReview(task)){action(status==='refining_text'?'查看复核进度／校对':'校对原文',()=>openTextReview(task));action('放弃',()=>discardTask(task),locked);}
  else if(['recognition_queued','recognizing_text'].includes(status))action('取消识字',()=>cancelTask(task));
  else if(['failed','cancelled','awaiting_result_review'].includes(status)){action(status==='awaiting_result_review'?'重新生成':'重试',()=>startAutomation(task));action('放弃',()=>discardTask(task),locked);}
  else if(['queued','running'].includes(status))action('取消任务',()=>cancelTask(task));
  else if(status==='waiting'){action('发送／接回',()=>focusTask(task.id));action('放弃',()=>discardTask(task),locked);}
  else if(['archived','discarded'].includes(status)&&task.result&&!regionDeleted(task.regionId,regionMarkers()))action('恢复修改',()=>restoreTask(task));
  else if(status==='ready'||task.receiveError){if(task.result)action('重新接回',()=>{task.resultVersion='';task.receiveError='';return receiveTaskResult(task);});else action('重新读取结果',()=>poll(),false,'读取已生成的结果，不重新生图');}
}
function repairItemSelected(region,task){return region?region.id===state.activeRegionId&&(state.selectionTarget==='region'||contentRegion(layers.active,state.regions)?.id===region.id):state.job?.id===task?.id;}
function renderRegions(){
  syncRegionNumbers();
  const {items,history,historyGroups}=buildRepairItems(state.regions,state.tasks.values(),state.regionNumbers,regionMarkers());
  layerSelection.reconcile(layerListKeys(items));syncLayerSelection();
  const signature=JSON.stringify([layerSelection.keys,state.activeRegionId,state.job?.id,state.selectionTarget,state.target,state.codexReady,state.loading,state.creating,state.versionSelecting,state.invalidAlignment,layers.activeId,state.regionNumbers,regionMarkers(),state.regions.map(region=>[region.id,region.name,region.frame,region.prompt,(region.references||[]).length,regionState(region),region.submitting,region.referenceLoading,region.locked,region.jobId,region.selectedVersionJobId,region.versionPinned,region.link?.id,region.linking]),[...state.tasks.values()].map(task=>[task.id,taskStatus(task),task.layerId,task.receiveError,task.accepting,task.automation?.phase,task.automation?.publishable,task.automation?.message,task.result?.version]),layers.layers.map(layer=>[layer.id,layer.locked])]);
  if(state.regionsSignature===signature)return;state.regionsSignature=signature;
  const list=$('region-list'),scrollArea=$('unified-layer-list'),openedActions=new Set([...list.querySelectorAll('.region-row.expanded')].map(row=>row.dataset.repairKey)),scrollTop=scrollArea.scrollTop,expanded=new Set([...list.querySelectorAll('details[open]')].map(node=>node.dataset.historyKey));
  const counts={};const summarized=[...items.map(item=>item.task).filter(Boolean),...history.flatMap(item=>[item.task,...item.previous]).filter(task=>autoRunning(task))];for(const task of summarized){const status=taskStatus(task),key=status==='awaiting_result_review'?'review':status;counts[key]=(counts[key]||0)+1;}
  const summary=['recognition_queued','recognizing_text','awaiting_text_review','refining_text','running','queued','waiting','review','awaiting_result_review','receive_failed','failed','accepted'].filter(status=>counts[status]).map(status=>`${statusLabels[status]} ${counts[status]}`).join(' · ');
  $('queue-summary').textContent=summary||'暂无后台任务';$('region-count').textContent=`${items.length} 个选区`;list.replaceChildren();
  if(!items.length){const p=document.createElement('p');p.className='queue-empty';p.textContent='按 D 圈出问题。点击选区条目，直接定位并填写修改要求。';list.append(p);}
  const taskHistoryRow=(task,number)=>{
    const row=document.createElement('div');row.className='repair-attempt';row.dataset.jobId=task.id;
    const label=document.createElement('p');label.className='repair-message';label.textContent=`选区 ${number} · ${new Date(task.orderAt||task.createdAt).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})} · ${statusLabels[taskStatus(task)]||taskStatus(task)}`;row.append(label);
    const actions=document.createElement('div');actions.className='region-row-actions';repairAction(actions,'定位',()=>{setShow('current');locateTask(task);void focusTask(task.id);});taskActions(task,actions);row.append(actions);return row;
  };
  const appendItem=item=>{
    const {region,task,number}=item,status=region?regionState(region):statusLabels[taskStatus(task)]||taskStatus(task),box=region?.frame||task.frame||task.crop;
    const row=document.createElement('div');row.className=`region-row${repairItemSelected(region,task)?' active':''}`;row.dataset.repairKey=item.key;if(region)row.dataset.selectionKey='region:'+region.id;row.classList.toggle('expanded',openedActions.has(item.key));row.dataset.regionNumber=String(number);if(region)row.dataset.regionId=region.id;if(task)row.dataset.jobId=task.id;row.dataset.status=region?regionState(region):taskStatus(task);
    const choose=()=>region?chooseRepairRegion(region):(setShow('current'),locateTask(task),focusTask(task.id));
    const heading=document.createElement('div');heading.className='region-row-header';const select=document.createElement('button');select.className='region-select';const thumbnail=document.createElement('img');thumbnail.className='region-thumbnail';thumbnail.alt='';thumbnail.loading='lazy';if(state.page)thumbnail.src=`/repair/api/sources/${state.page.metadata.id}/region?revision=${state.page.revision}&x=${box.x}&y=${box.y}&width=${box.width}&height=${box.height}`;else if(task)thumbnail.src=`/repair/jobs/${task.id}/crop.png`;if(region)heading.append(selectionCheck('region:'+region.id,region.name));heading.append(thumbnail);select.textContent=`选区 ${number}`;select.title=`定位选区 ${number}，位置 ${box.x}, ${box.y}`;select.setAttribute('aria-label',`定位并选择选区 ${number}`);select.setAttribute('aria-pressed',String(repairItemSelected(region,task)));select.addEventListener('click',event=>{event.stopPropagation();if(region)void selectListItem('region:'+region.id,event);else void choose();});const badge=document.createElement('span');badge.className='repair-status';badge.textContent=status;const more=document.createElement('button');more.className='region-more';more.textContent='操作';more.title='展开此选区的操作';more.setAttribute('aria-expanded',String(openedActions.has(item.key)));more.addEventListener('click',event=>{event.stopPropagation();row.classList.toggle('expanded');more.setAttribute('aria-expanded',String(row.classList.contains('expanded')));});const versions=region?repairVersionTasks(region,state.tasks.values()):[],chosen=region&&chosenRegionLayer(region,layers.layers);if(versions.length){const strip=document.createElement('div');strip.className='version-thumbnails';strip.setAttribute('aria-label',`选区 ${number} 的历史生成`);for(const [index,version] of versions.entries()){const button=document.createElement('button');button.className=`version-thumb${chosen?.jobId===version.id?' active':''}`;button.dataset.versionJobId=version.id;button.setAttribute('aria-label',`采用选区 ${number} 的生成版本 ${index+1}`);button.setAttribute('aria-pressed',String(chosen?.jobId===version.id));button.title=`版本 ${index+1} · ${version.label||'局部修复'}`;const img=document.createElement('img');img.src=`/repair/api/jobs/${version.id}/thumbnail?v=${encodeURIComponent(version.result.version)}`;img.alt=`版本 ${index+1}`;img.loading='lazy';button.append(img);button.addEventListener('click',event=>{event.stopPropagation();if(event.shiftKey||event.ctrlKey||event.metaKey){void selectListItem('region:'+region.id,event);return;}layerSelection.single('region:'+region.id);void selectRepairVersion(region,version);});strip.append(button);}heading.append(strip);}heading.append(select,badge,more);
    const info=document.createElement('p');info.textContent=region?.prompt?.trim()||task?.label||'尚未填写修改要求';info.title=info.textContent;
    const details=document.createElement('p');details.textContent=`位置 ${box.x}, ${box.y} · ${box.width} × ${box.height} · 参考图 ${(region?.references||task?.referenceFiles||[]).length} 张`;
    const actions=document.createElement('div');actions.className='region-row-actions';repairAction(actions,'定位',choose);
    if(region){const linkButton=repairAction(actions,region.link?'解开链接':'链接图片',()=>toggleRepairLink(region),{disabled:region.linking||!chosenRegionLayer(region,layers.layers)});linkButton.className='repair-link';const linkIcon=document.createElement('img');linkIcon.src=`/repair/icons/${region.link?'link-simple':'link-simple-break'}.svg`;linkIcon.alt='';linkIcon.className='ui-icon';linkButton.prepend(linkIcon);linkButton.setAttribute('aria-pressed',String(!!region.link));repairAction(actions,region.locked?'解锁':'锁定',()=>toggleRegionLock(region));const pending=regionBusy(region);repairAction(actions,task?'重新修改':'修改',()=>submitRegion(region),{disabled:!!region.submitting||!!region.referenceLoading||!regionHasPrompt(region)||!!pending||(state.target==='auto'&&!state.codexReady),title:pending?'此选区正在处理，请等待完成':'保留几何锁定，使用当前要求重新生成'});repairAction(actions,'删除',()=>removeRegion(region),{disabled:!!region.locked||!!region.submitting,title:region.locked?'先解锁，再删除选区':''});}
    if(task){if(item.historyKind==='deleted')repairAction(actions,'恢复选区',()=>restoreDeletedRegion(item),{disabled:!restoreRegionDescriptor(task,state),title:'恢复这个选区及所选版本'});else taskActions(task,actions);}row.append(heading,info,details,actions);
    const reviewTask=chosen?state.tasks.get(chosen.jobId)||task:task,reviewLayer=reviewTask&&layers.layers.find(layer=>layer.id===reviewTask.layerId);
    if(reviewLayer&&!['discarded','archived'].includes(reviewTask.decision)){
      const reviews=document.createElement('div');reviews.className='repair-review-actions';reviews.setAttribute('aria-label',`选区 ${number} 的结果确认`);reviews.dataset.reviewJobId=reviewTask.id;
      const discard=repairAction(reviews,'放弃本次',()=>discardTask(reviewTask),{disabled:state.versionSelecting||!canEditLayer(reviewLayer,region),title:!canEditLayer(reviewLayer,region)?'图层已锁定，请先按 F 解锁':''});discard.className='button secondary';discard.dataset.reviewAction='discard';
      const accept=repairAction(reviews,'✓ 采用修改',()=>acceptTask(reviewTask),{disabled:state.versionSelecting||reviewTask.decision==='accepted'||(state.job?.id===reviewTask.id&&state.invalidAlignment),title:reviewTask.decision==='accepted'?'此版本已采用':''});accept.className='button primary';accept.dataset.reviewAction='accept';
      row.append(reviews);
    }
    const message=task?.receiveError||reviewAttemptNotice(task)||(['failed','cancelled','queued','running','recognition_queued','recognizing_text','awaiting_text_review','refining_text','receiving','ready'].includes(task&&taskStatus(task))?task.automation?.message:'');if(message){const p=document.createElement('p');p.className='repair-message';p.textContent=message;p.title=task?.automation?.message||message;row.append(p);}
    if(item.previous.length){const prior=document.createElement('details');prior.className='repair-history';prior.dataset.historyKey=item.key;prior.open=expanded.has(item.key);const label=document.createElement('summary');label.textContent=`此前提交 ${item.previous.length} 次`;prior.append(label);for(const old of item.previous)prior.append(taskHistoryRow(old,number));row.append(prior);}
    row.addEventListener('click',event=>{if(event.target.closest('button,details'))return;if(region)void selectListItem('region:'+region.id,event);else void choose();});return row;
  };
  for(const item of items)list.append(appendItem(item));
  for(const [kind,title] of [['deleted','已删除选区'],['discarded','已放弃任务'],['orphaned','旧任务（缺少原选区记录）']]){const group=historyGroups[kind];if(!group.length)continue;const archived=document.createElement('details');archived.className='repair-history deleted-repairs';archived.dataset.historyKey=kind;archived.open=expanded.has(kind);const label=document.createElement('summary');label.textContent=`${title} (${group.length})`;archived.append(label);for(const item of group)archived.append(appendItem(item));list.append(archived);}
  scrollArea.scrollTop=scrollTop;syncLayerSelection();
}
async function restoreDeletedRegion(item){
 const region=restoreRegionDescriptor(item.task,state);if(!region||state.regions.some(other=>other.id===region.id)||state.loading||state.creating)return;
 const before=editorSnapshot();markRegionRestored(region.id);state.regions.push(region);syncRegionNumbers();state.revision++;rememberStep(before,'恢复已删除选区');
 if(item.task.result){item.task.decision=undefined;item.task.resultVersion='';rememberTask(item.task);await receiveTaskResult(item.task);}await selectRegion(region.id,{locate:true});scheduleProjectSave();renderRegions();toast('已恢复此选区，其他旧版本仍在任务记录中。');
}
async function removeRegion(region){
 const output=chosenRegionLayer(region,layers.layers);if(!canEditRegion(region,output))return centerStatus('选区已锁定，请按 F 解锁');layerSelection.single('region:'+region.id);await deleteSelected();
}
function renderProjects(){
  const signature=JSON.stringify([state.page?.metadata.id,state.projects.map(project=>[project.id,project.name,project.regions,project.counts,project.composite?.status,project.composite?.url])]);if(state.projectsSignature===signature)return;state.projectsSignature=signature;
  $('project-count').textContent=String(state.projects.length);$('project-list').replaceChildren();
  for(const project of state.projects){const button=document.createElement('button');button.className=`project-card${project.id===state.page?.metadata.id?' active':''}`;button.dataset.projectId=project.id;const name=document.createElement('strong');name.textContent=project.name;name.title=project.name;const progress=document.createElement('span'),c=project.counts;progress.textContent=`选区 ${project.regions} · 已完成 ${c.completed}${c.running?` · 处理 ${c.running}`:''}${c.queued?` · 排队 ${c.queued}`:''}${c.waiting?` · 待返回 ${c.waiting}`:''}${c.draft?` · 待提交 ${c.draft}`:''}${c.review?` · 待确认 ${c.review}`:''}${c.failed?` · 失败 ${c.failed}`:''}`;const result=document.createElement('span');result.textContent=project.composite?.status==='compositing'?'正在自动合成整图':project.composite?.status==='ready'?'自动合成已保存':project.composite?.status==='failed'?'自动合成未完成，检查后可重试':'';button.append(name,progress);if(result.textContent)button.append(result);button.addEventListener('click',()=>openProject(project.id));const row=document.createElement('div');row.className='project-entry';const remove=document.createElement('button');remove.className='project-delete';remove.textContent='删除';remove.title='直接删除项目并清理文件';remove.addEventListener('click',event=>{event.stopPropagation();void deleteProject(project.id);});row.append(button,remove);$('project-list').append(row);}
}
async function refreshProjects(){try{const response=await fetch('/repair/api/projects'),data=await response.json();if(response.ok){state.projects=data.projects;$('batch-hint').textContent=`本地并发 ${data.queue.concurrency} 项 · 处理中 ${data.queue.running} · 排队 ${data.queue.waiting}。提交后可处理下一张漫画。`;renderProjects();}}catch{}}
async function openProject(id){if(state.loading||state.creating||state.page?.metadata.id===id)return;state.loading=true;busy(true,'打开漫画项目…');updateButtons();try{const response=await fetch(`/repair/api/sources/${id}`),meta=await response.json();if(!response.ok)throw new Error(meta.error);await loadPage(meta);}catch(error){toast(error.message||'项目读取失败',true);}finally{state.loading=false;busy(false);updateButtons();void poll();}}
function toast(message, error = false) {
  $('toast').classList.remove('export-success');$('toast').textContent = message; $('toast').classList.toggle('error', error); $('toast').hidden = false;
  clearTimeout(state.toastTimer); state.toastTimer = setTimeout(() => { $('toast').hidden = true; }, error ? 8000 : 4500);
}
function showExportSuccess(saved,message){
  toast(message);clearTimeout(state.toastTimer);
  const notice=$('toast'),status=document.createElement('span');status.textContent=message;notice.replaceChildren(status);notice.classList.add('export-success');
  const open=document.createElement('button');open.id='open-export-folder';open.type='button';open.className='toast-action';open.textContent='打开文件夹';open.title=saved.exportFolder||saved.archivePath||saved.file;open.disabled=!saved.folderToken;
  open.addEventListener('click',async()=>{
    open.disabled=true;open.textContent='正在打开…';
    try{await requestJSON('/repair/api/exports/open-folder',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({folderToken:saved.folderToken})});if(notice.contains(open)){status.textContent='已打开导出文件夹';notice.classList.remove('error');}}
    catch(error){if(notice.contains(open)){status.textContent='成品已保存；'+error.message;notice.classList.add('error');}}
    finally{open.disabled=false;open.textContent='打开文件夹';}
  });
  const close=document.createElement('button');close.type='button';close.id='close-export-notice';close.className='toast-dismiss';close.textContent='×';close.setAttribute('aria-label','关闭导出提示');close.addEventListener('click',()=>{notice.hidden=true;});notice.append(open,close);
}
function syncEditorShell(){
 const hasImage=state.width>0&&state.height>0;
 document.body.dataset.editorState=hasImage?'ready':'empty';
 $('empty-project').hidden=hasImage;$('current-source').hidden=!hasImage;
 $('welcome-import').disabled=state.initializing||state.loading||state.creating;
 $('welcome-title').textContent=state.initializing?'正在加载项目…':document.body.classList.contains('integrated-repair')?'选择一格，开始修图':'新建漫画项目';
 $('welcome-description').textContent=state.initializing?'正在检查本机保存的漫画项目。':document.body.classList.contains('integrated-repair')?'在排版页选择图片，再点击「框选局部修图」。':'导入一张漫画，开始局部修复。';
 stage.setAttribute('aria-label',hasImage?'图片画布，拖动框选需要修复的区域':'新建漫画项目');
 if(!hasImage){$('header-filename').textContent='新建项目';$('source-thumb').removeAttribute('src');$('source-name').textContent='未打开漫画';$('source-size').textContent='导入漫画开始修图';$('image-info').textContent='';}
}
function busy(value, message = '处理中…') { $('busy-overlay').hidden = !value; $('busy-text').textContent = message; }
function maskValues(source = selection) {
  const pixels = source.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, source.width, source.height).data;
  const mask = new Uint8ClampedArray(source.width * source.height);
  for (let i = 0; i < mask.length; i++) mask[i] = pixels[i * 4 + 3];
  return mask;
}
function boundsChanged() {
  const local=maskBounds(maskValues(),selection.width,selection.height);
  state.bounds=local?{...local,x:local.x+state.selectionOrigin.x,y:local.y+state.selectionOrigin.y}:null;
  const b = state.frame || state.bounds;
  $('selection-info').textContent = b ? `${b.width} × ${b.height} px　·　位置 ${b.x}, ${b.y}` : '在画布上框选，或用涂抹精细圈选';
  $('selection-status').textContent = b ? '已选中' : '待圈选';
  $('selection-status').classList.toggle('ready', !!b);
  $('stage-hint').hidden = !!b || !!state.job||!['rect','extract'].includes(state.tool);$('stage-hint').textContent=state.tool==='extract'?'自由选框：拖出画面，松开剪切为新图层':'拖动框选需要修改的地方';
  updateButtons(); render();
}
function clearSelection(){invalidateSelectionEncoding();selection.width=1;selection.height=1;state.frame=null;state.selectionOrigin={x:0,y:0};boundsChanged();}
function repairCrop(){return fixedRatioCrop(state.frame||state.bounds,Math.max(Number($('context-padding').value),Math.ceil((activeRegion()?.feather??6)*3)),$('selection-ratio').value,state.width,selectionHeight());}
function localMask(crop){const mask=canvas(crop.width,crop.height);mask.getContext('2d').drawImage(selection,state.selectionOrigin.x-crop.x,state.selectionOrigin.y-crop.y);return maskValues(mask);}
function updateButtons() {
  if(state.didMigrate&&!state.loading&&!state.initializing&&state.page?.metadata.id===state.didMigrate){state.didMigrate=null;scheduleProjectSave();}
  syncEditorShell();
  const locked = state.creating || state.loading||state.versionSelecting||state.localProcessing;
  $('create-job').disabled = !activeRegion() || locked || !regionHasPrompt(activeRegion()) || activeRegion().submitting || activeRegion().referenceLoading || !!regionBusy(activeRegion()) || (state.target === 'auto' && !state.codexReady);
  $('auto-text').disabled=!canEditQuickRegion();$('separate-bubble').disabled=!canEditQuickRegion();$('generation-mode').disabled=!canEditQuickRegion();
  $('prompt').disabled = locked; $('context-padding').disabled = locked;
  $('selection-ratio').disabled=locked;
  $('clear-selection').disabled = locked || !state.bounds;
  $('undo').disabled = !state.history.length || locked;
  $('undo').disabled=!editHistory.past.length||locked;$('redo').disabled=!editHistory.future.length||locked;
  $('undo').title=`撤销（Ctrl+Z）${editHistory.past.length?` · ${editHistory.past.length}/5`:''}`;$('redo').title=`恢复（Ctrl+Shift+Z / Ctrl+Y）${editHistory.future.length?` · ${editHistory.future.length}/5`:''}`;
  updateSubmitFeedback();renderRegions();
  $('image-input').disabled = locked; $('open-image').disabled = locked; $('source-card').disabled = locked;
  $('restore-job').disabled = locked;
  for(const id of ['export-image','export-repaired','export-original'])$(id).disabled=!state.width||state.loading||state.creating||state.exporting;
  $('save-project-file').disabled=!state.page||state.loading||state.creating||state.exporting||!!state.pointer;
  $('import-project-file').disabled=state.loading||state.creating||state.exporting||!!state.pointer;
  $('project-file-input').disabled=$('import-project-file').disabled;
  $('import-result').disabled = !state.job || state.loading || taskHasPendingWork(state.job);
  document.querySelectorAll('[data-tool]').forEach(button => { button.disabled = locked; });
  $('add-reference').disabled=locked;
  for(const id of ['add-image-layer','add-background-layer'])$(id).disabled=locked||state.exporting;
  for(const id of ['paste-reference','reference-library-button','feather','add-paint-layer','layer-delete','layer-up','layer-down'])$(id).disabled=locked;
  document.querySelectorAll('[data-custom-prompt]').forEach(button=>{button.disabled=locked||!activeRegion()||activeRegion().submitting||!customPrompts[Number(button.dataset.customPrompt)]?.prompt.trim();});
  $('create-job').textContent = activeRegion()?.submitting ? '正在保存此选区…' : state.target === 'auto' ? `修改${activeRegion()?.name||'所选选区'}` : '✦ 保存所选图层任务';
  $('check-codex').hidden = state.target !== 'auto'; $('check-codex').disabled = state.codexChecking;
  $('copy-job-message').hidden = state.job?.automatic === true;
  $('retry-auto').hidden = !state.job?.automatic || !['failed','cancelled'].includes(state.job?.automation?.status);
  $('retry-auto').disabled = !!state.job?.starting;
  for(const id of ['target-auto','target-codex','target-web'])$(id).disabled=locked;selectedRegionControls();syncQuickRepair();
}
function autoRunning(task) { return taskIsRunning(arguments.length?task:state.job); }

function syncToolUI(){
 document.querySelectorAll('[data-tool]').forEach(button=>{const active=button.dataset.tool===state.tool;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));});
 $('brush-control').hidden=!['brush','erase'].includes(state.tool);
 updateBrushCursor();
}
function setTool(tool,{reveal=true}={}){
  if(!['select','rect','frame-move','layer-move','pan','paint','mask','extract','brush','erase'].includes(tool)||state.pointer)return;selectionMenu.close();if(tool!=='pan'){setViewMode('edit');state.show='current';state.before=false;}state.tool=tool;if(tool==='frame-move')promoteRegionCoordinates(activeRegion());if(tool!=='extract')state.extractBox=null;
  if(['rect','frame-move','brush','erase'].includes(tool))state.selectionTarget='region';
  else if(['layer-move','mask'].includes(tool)){
    if(state.selectionTarget==='region'&&activeRegion()){const layer=chosenRegionLayer(activeRegion(),layers.layers);layers.activeId=layer?.id||null;}
    state.selectionTarget='layer';if(!layers.active&&reveal)centerStatus('此选区尚无生成图');
  }else if(tool==='paint'){if(layers.active?.type!=='paint')layers.activeId=[...layers.layers].reverse().find(layer=>layer.type==='paint')?.id||null;state.selectionTarget='layer';}
  if(tool==='paint'){if(layers.active)layerSelection.single(layerSelectionKey(layers.active));else layerSelection.clear();syncLayerSelection();}
  if(layers.active&&['mask','layer-move'].includes(tool))void layers.ensureLayer(layers.active).catch(error=>toast(error.message,true));syncToolUI();selectedLayerControls();renderRegions();render();
  if(reveal&&!(document.body.classList.contains('integrated-repair')&&['pan','select','rect','frame-move'].includes(tool)))revealProperties(toolProperties(tool));
}


const selectionMenu=bindSelectionToolMenu({
 menu:$('selection-tool-menu'),surfaces:[view,$('image-resize-controls'),$('floating-tools')],
 canOpen:()=>state.width>0&&state.viewMode==='edit'&&['select','frame-move','layer-move'].includes(state.tool)&&!state.pointer&&!state.loading&&!state.creating&&!state.selectingRegion&&!state.versionSelecting&&!state.exporting,
 getTool:()=>state.tool,onChoose:tool=>setTool(tool),focusCanvas:()=>stage.focus({preventScroll:true})
});

bindPropertyShortcutFocus($('repair-inspector'),()=>stage.focus({preventScroll:true}));

function editorSections(){return sectionManifest(layers.layers);}
function visiblePageGaps(){return state.show==='original'||state.sectionMode?[]:state.pageGaps;}
function visibleSegments(){return state.show!=='original'&&state.sectionMode?sectionSegments(editorSections()):pageSegments(state.height,visiblePageGaps());}
function sourceY(y){return state.show!=='original'&&state.sectionMode?sectionSourceY(y,editorSections()):sourceToDisplay(y,visiblePageGaps());}
function sourcePoint(y){return state.show!=='original'&&state.sectionMode?sectionDisplayPoint(y,editorSections()):displayToSource(y,visiblePageGaps());}

function displayHeight(){return state.show!=='original'&&state.sectionMode?sectionsHeight(editorSections()):pageHeight(state.height,visiblePageGaps());}
function fit() {
  embeddedAutoFit=true;
  if (!state.width||!stage.clientWidth||!stage.clientHeight) return;
  state.zoom = Math.min((stage.clientWidth - 70) / state.width, (stage.clientHeight - 108) / displayHeight(), 1);
  state.zoom = Math.max(.00001, state.zoom); state.panX = 0; state.panY = 0;
  if(displayHeight()/state.width>4){state.zoom=Math.min(6,(stage.clientWidth-48)/state.width);state.panY=(displayHeight()*state.zoom-stage.clientHeight)/2+28;}
  render();
}
function transform() {
  return { x: (stage.clientWidth - state.width * state.zoom) / 2 + state.panX, y: (stage.clientHeight - displayHeight() * state.zoom) / 2 + state.panY };
}
function render() {
  syncBackgroundDimensions();syncEditorShell();
  for(const [id,node] of generationTimerNodes){node.hidden=true;if(!state.regions.some(region=>region.id===id)){node.remove();generationTimerNodes.delete(id);}}
  $('frame-link').hidden=true;
  if(document.activeElement!==$('view-zoom'))$('view-zoom').value=formatDecimal(state.zoom*100);
  updateExtractPreview();$('image-resize-controls').hidden=true;if (!state.width) return;
  const deviceScale = Math.min(devicePixelRatio || 1, 2), width = stage.clientWidth, height = stage.clientHeight;
  if (view.width !== Math.round(width * deviceScale) || view.height !== Math.round(height * deviceScale)) { view.width = Math.round(width * deviceScale); view.height = Math.round(height * deviceScale); }
  ctx.setTransform(deviceScale, 0, 0, deviceScale, 0, 0); ctx.clearRect(0, 0, width, height);
  const showGuides=state.viewMode==='edit'&&!['mask','paint','brush','erase','extract','cut'].includes(state.tool);
  const layerGuides=showGuides&&!(state.tool==='layer-move'&&layers.active?.type==='image');
  const t = transform(), display = state.show === 'original' ? original : current;
  ctx.save(); ctx.shadowColor = '#39423316'; ctx.shadowBlur = 14; ctx.fillStyle = state.sectionMode&&state.show!=='original'?transparentPattern:'#fff'; ctx.fillRect(t.x, t.y, state.width * state.zoom, displayHeight() * state.zoom); ctx.restore();
  const gaps=visiblePageGaps(),segments=visibleSegments(),baseT=t;layers.updateVisibleWindows(state.show==='original'?{source:[],output:[]}:visibleLayerWindows(t,state.zoom,{width,height},state.width,segments));
  if(state.show!=='original'){ctx.save();ctx.beginPath();ctx.rect(t.x,t.y,state.width*state.zoom,displayHeight()*state.zoom);ctx.clip();layers.draw(ctx,t,state.zoom,false,'background');ctx.restore();}
  if(state.page){const revision=state.show==='original'?0:state.before&&state.job?state.job.baseRevision:state.page.revision;state.page.drawLayout(ctx,t,state.zoom,width,height,revision,segments);}
  for(const segment of segments){
    const top=baseT.y+(segment.start+segment.offset)*state.zoom,bottom=baseT.y+(segment.end+segment.offset)*state.zoom;
    if(bottom<=0||top>=height)continue;
    ctx.save();ctx.beginPath();ctx.rect(baseT.x,top,state.width*state.zoom,bottom-top);ctx.clip();for(const hole of segment.cutouts||[]){ctx.beginPath();ctx.rect(baseT.x,top,state.width*state.zoom,bottom-top);ctx.rect(baseT.x+hole.x*state.zoom,baseT.y+(hole.y+segment.offset)*state.zoom,hole.width*state.zoom,hole.height*state.zoom);ctx.clip('evenodd');}
    const t={x:baseT.x,y:baseT.y+segment.offset*state.zoom};
    if(!state.page)ctx.drawImage(display,t.x,t.y,state.width*state.zoom,state.height*state.zoom);
  if(state.show!=='original'){if(state.before&&state.aiLayerId){const ai=layers.layers.find(item=>item.id===state.aiLayerId),was=ai?.visible;if(ai)ai.visible=false;layers.draw(ctx,t,state.zoom,false);if(ai)ai.visible=was;}else layers.draw(ctx,t,state.zoom,layerGuides);}

    ctx.restore();
  }
  if(state.show!=='original'){ctx.save();ctx.beginPath();ctx.rect(baseT.x,baseT.y,state.width*state.zoom,displayHeight()*state.zoom);ctx.clip();layers.draw(ctx,baseT,state.zoom,layerGuides,'output');ctx.restore();}
  if(showGuides&&state.show!=='original'&&!state.before)drawRegionGuides(baseT);
  drawSelectedLayerGuides(baseT);
  drawSectionControls(baseT);
  drawImageResizeControls(baseT);
  drawTextResizeControls(baseT);
  updateExtractPreview();

  if(state.gapPreview!==null&&state.show!=='original'){
    const y=baseT.y+sourceToDisplay(state.gapPreview,gaps)*state.zoom;ctx.save();ctx.strokeStyle='#dd6545';ctx.lineWidth=2;ctx.setLineDash([8,5]);ctx.beginPath();ctx.moveTo(baseT.x,y);ctx.lineTo(baseT.x+state.width*state.zoom,y);ctx.stroke();ctx.restore();
  }
  updateBrushCursor();syncQuickRepair();
  $('zoom-text').textContent = `${Math.round(state.zoom * 100)}%`;
  $('image-info').textContent=state.name+' · '+state.width+' × '+displayHeight()+' px'+(state.sectionMode&&state.show!=='original'?' · '+editorSections().filter(item=>item.visible).length+' 个漫画图层':visiblePageGaps().length?' · 已增加 '+(displayHeight()-state.height)+' px 间隔':' · 原尺寸保留');
  const long=displayHeight()/state.width>4;$('page-navigation').hidden=!long;$('page-jump').hidden=!long;$('current-ratio').textContent=$('selection-ratio').value;$('header-filename').textContent=state.name;
  if(long){const max=Math.max(0,displayHeight()-Math.ceil((stage.clientHeight-56)/state.zoom));$('page-position').max=String(max);$('page-position').value=String(Math.max(0,Math.min(max,Math.round((28-t.y)/state.zoom))));$('page-position-value').textContent=`${$('page-position').value} px`;}
}



function selectionHeight(){return activeRegion()?.coordinateSpace==='output'||state.selectionSpace==='output'?displayHeight():state.height;}
function promoteRegionCoordinates(region){if(!region||region.coordinateSpace==='output'||region.jobId||(!state.sectionMode&&!state.pageGaps.length))return;const dy=sourceY(region.frame.y)-region.frame.y;region.frame={...region.frame,y:region.frame.y+dy};region.origin={...(region.origin||region.frame),y:(region.origin?.y??region.frame.y-dy)+dy};region.coordinateSpace='output';for(const mark of region.annotations||[])if(mark.points)for(const point of mark.points)point.y+=dy;else if(mark.y!==undefined)mark.y+=dy;if(region.id===state.activeRegionId){state.frame={...region.frame};state.selectionOrigin={...region.origin};state.selectionSpace='output';}region.modifiedAt=Date.now();}
function drawRegionGuides(t){
 for(const region of state.regions){const active=region.id===state.activeRegionId,frame=active&&state.frame?state.frame:region.frame,b=displayRegionFrame({...region,frame},sourceY);ctx.save();ctx.strokeStyle=active?'#dd6545':region.jobId?'#6a9874':'#e88962';ctx.lineWidth=active?1.5:1;ctx.setLineDash(active?[]:[4,3]);ctx.strokeRect(t.x+b.x*state.zoom,t.y+b.y*state.zoom,b.width*state.zoom,b.height*state.zoom);drawRegionLabel(region,b,t,active);if(active&&state.tool!=='layer-move'){ctx.fillStyle='#fff';ctx.setLineDash([]);for(const {x,y} of selectionHandles(b)){ctx.fillRect(t.x+x*state.zoom-3,t.y+y*state.zoom-3,6,6);ctx.strokeRect(t.x+x*state.zoom-3,t.y+y*state.zoom-3,6,6);}}ctx.restore();}
 if(state.frame&&!activeRegion()){const b=state.frame;ctx.save();ctx.strokeStyle='#dd6545';ctx.lineWidth=1.5;ctx.strokeRect(t.x+b.x*state.zoom,t.y+b.y*state.zoom,b.width*state.zoom,b.height*state.zoom);ctx.restore();}
 if(state.bounds&&activeRegion()){const crop=repairCrop(),b=displayRegionFrame({coordinateSpace:activeRegion().coordinateSpace,frame:crop},sourceY);ctx.save();ctx.strokeStyle='#7893a0';ctx.lineWidth=1;ctx.setLineDash([4,4]);ctx.strokeRect(t.x+b.x*state.zoom,t.y+b.y*state.zoom,b.width*state.zoom,b.height*state.zoom);ctx.restore();}
}

function drawSelectedLayerGuides(t){
 const members=operationMembers();if(members.length<2||state.show==='original')return;ctx.save();ctx.strokeStyle='#dd6545';ctx.lineWidth=1;ctx.setLineDash([5,4]);for(const layer of members){if(!layer.visible||layer.versionHidden)continue;const b=layers.bounds(layer);if(!b)continue;const top=layer.coordinateSpace==='output'?b.y:sourceY(b.y);ctx.strokeRect(t.x+b.x*state.zoom,t.y+top*state.zoom,b.width*state.zoom,b.height*state.zoom);}ctx.restore();
}
function drawImageResizeControls(t){
 const overlay=$('image-resize-controls'),layer=layers.active;
 if(state.viewMode!=='edit'||state.tool!=='layer-move'||state.selectionTarget!=='layer'||operationMembers().length>1||state.show==='original'||state.before||state.loading||state.creating||state.versionSelecting||layer?.type!=='image'||!layer.visible||layer.versionHidden||!layers.imageSize(layer).width)return;
 const size=layers.imageSize(layer),corners=imageCornerPoints(layer,size.width,size.height).map(point=>({...point,x:t.x+point.x*state.zoom,y:t.y+(layer.coordinateSpace==='output'?point.y:sourceY(point.y))*state.zoom})),editable=canEditLayer(layer,contentRegion(layer,state.regions));
 overlay.hidden=false;overlay.dataset.layerId=layer.id;
 ctx.save();ctx.setLineDash([]);ctx.strokeStyle=editable?'#dd6545':'#8b9699';ctx.lineWidth=1.5;ctx.beginPath();
 corners.forEach((point,index)=>index?ctx.lineTo(point.x,point.y):ctx.moveTo(point.x,point.y));ctx.closePath();ctx.stroke();ctx.restore();
 for(let index=0;index<corners.length;index++){
  const point=corners[index],opposite=corners[(index+2)%4],button=overlay.querySelector('[data-image-corner='+point.corner+']');
  button.style.left=point.x+'px';button.style.top=point.y+'px';button.style.cursor=editable?imageResizeCursor({x:point.x-opposite.x,y:point.y-opposite.y}):'not-allowed';button.setAttribute('aria-disabled',String(!editable));
 }
}
function startImageResize(event){
 if(event.button!==0)return;
 event.preventDefault();event.stopPropagation();stage.focus({preventScroll:true});
 const layer=layers.active,corner=event.target.closest('[data-image-corner]')?.dataset.imageCorner;
 if(!corner||layer?.type!=='image'||state.pointer||state.loading||state.creating||state.versionSelecting||state.exporting)return;
 if(!canEditLayer(layer,contentRegion(layer,state.regions)))return centerStatus('图片或链接选框已锁定，请按 F 解锁');
 view.setPointerCapture(event.pointerId);
 const size=layers.imageSize(layer),pose={...poseOf(layer),scaleMode:layer.scaleMode},cancelPose=Object.fromEntries(['x','y','scale','scaleX','scaleY','scaleMode','angle','skewX'].map(key=>[key,layer[key]])),points=imageCornerPoints(pose,size.width,size.height),index=points.findIndex(point=>point.corner===corner),point=points[index],opposite=points[(index+2)%4];
 state.pointer={mode:'image-resize',before:editorSnapshot(),layerId:layer.id,corner,pose,cancelPose,width:size.width,height:size.height,clientX:event.clientX,clientY:event.clientY,changed:false,cursor:imageResizeCursor({x:point.x-opposite.x,y:point.y-opposite.y})};
 updateBrushCursor();
}
function moveImageResize(event){
 const pointer=state.pointer,layer=layers.layers.find(item=>item.id===pointer.layerId);
 if(!layer)return;
 const delta={x:(event.clientX-pointer.clientX)/state.zoom,y:(event.clientY-pointer.clientY)/state.zoom},next=resizeImageFromCorner(pointer.pose,pointer.width,pointer.height,pointer.corner,delta);
 pointer.changed=Math.abs(next.scaleX-pointer.pose.scaleX)>1e-9||Math.abs(next.scaleY-pointer.pose.scaleY)>1e-9;
 Object.assign(layer,next);syncLinkedRegions();selectedLayerControls();render();
}
$('image-resize-controls').addEventListener('pointerdown',startImageResize);


function textFrameLayout(layer){const layout=layoutText(canvas(1,1).getContext('2d'),layer);return{layout,frame:{x:layout.bleed,y:layout.bleed,width:layout.boxWidth,height:layout.boxHeight}};}
function drawTextResizeControls(t){
 const overlay=$('text-resize-controls'),layer=layers.active;overlay.hidden=true;$('text-overflow').hidden=true;
 if(layer?.type==='text'){const {layout}=textFrameLayout(layer);$('text-overflow').hidden=!layout.overflow;}
 if(state.viewMode!=='edit'||!['select','frame-move','layer-move','text'].includes(state.tool)||state.selectionTarget!=='layer'||layerSelection.size>1||state.show==='original'||state.before||state.loading||state.creating||state.versionSelecting||layer?.type!=='text'||!layer.visible||layer.versionHidden)return;
 const {frame}=textFrameLayout(layer),handles=textFrameHandles(layer,frame).map(p=>({...p,x:t.x+p.x*state.zoom,y:t.y+(layer.coordinateSpace==='output'?p.y:sourceY(p.y))*state.zoom})),editable=canEditLayer(layer,contentRegion(layer,state.regions));
 overlay.hidden=false;overlay.dataset.layerId=layer.id;ctx.save();ctx.setLineDash([]);ctx.strokeStyle=editable?'#dd6545':'#8b9699';ctx.lineWidth=1;ctx.beginPath();for(const [index,p] of handles.filter(p=>p.name.length===2).entries())index?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y);ctx.closePath();ctx.stroke();ctx.restore();
 for(const p of handles){const button=overlay.querySelector('[data-text-handle='+p.name+']');button.style.left=p.x+'px';button.style.top=p.y+'px';button.style.cursor=editable?p.cursor:'not-allowed';button.setAttribute('aria-disabled',String(!editable));}
}
function startTextResize(event){
 if(event.button!==0)return;event.preventDefault();event.stopPropagation();const layer=layers.active,handle=event.target.closest('[data-text-handle]')?.dataset.textHandle;
 if(!handle||layer?.type!=='text'||state.pointer||state.loading||state.creating||state.versionSelecting||state.exporting)return;
 if(!canEditLayer(layer,contentRegion(layer,state.regions)))return centerStatus('文字图层已锁定，请按 F 解锁');
 const {frame}=textFrameLayout(layer);state.pointer={mode:'text-resize',before:editorSnapshot(),layerId:layer.id,handle,frame,base:{...layer},clientX:event.clientX,clientY:event.clientY,changed:false,cursor:event.target.style.cursor};updateBrushCursor();
}
function moveTextResize(event){
 const pointer=state.pointer,layer=layers.layers.find(item=>item.id===pointer.layerId);if(!layer)return;
 const next=resizeTextFrame(pointer.base,pointer.frame,pointer.handle,{x:(event.clientX-pointer.clientX)/state.zoom,y:(event.clientY-pointer.clientY)/state.zoom});
 if(Math.abs(event.clientX-pointer.clientX)<.5&&Math.abs(event.clientY-pointer.clientY)<.5&&!pointer.changed)return;
 pointer.changed=true;Object.assign(layer,next);writeTextLayoutControls(layer);layers.update();
}
$('text-resize-controls').addEventListener('pointerdown',startTextResize);

function drawRegionLabel(region,box,t,active){
  const text=`选区 ${region.number||state.regionNumbers[region.id]||'—'} · ${region.ratio||'1:1'}`,x=t.x+box.x*state.zoom,y=t.y+box.y*state.zoom;ctx.save();ctx.setLineDash([]);ctx.font='600 12px "Microsoft YaHei",sans-serif';const width=ctx.measureText(text).width+14,button=$('frame-link');
  const timer=regionGenerationTimer(region),timerWidth=timer?ctx.measureText(timer.label).width+14:0,labelWidth=width+(timer?timerWidth+6:0);
  const showLink=active&&(state.selectionTarget==='region'||contentRegion(layers.active,state.regions)?.id===region.id)&&layerSelection.size<=1&&!state.loading&&!state.creating&&!state.versionSelecting&&!state.selectingRegion&&!state.pointer&&!!chosenRegionLayer(region,layers.layers)&&x+box.width*state.zoom>0&&y+box.height*state.zoom>0&&x<stage.clientWidth&&y<stage.clientHeight;
  if(showLink){syncFrameLinkState(region);button.dataset.labelWidth=String(labelWidth+4);button.hidden=false;}
  const extra=showLink?button.offsetWidth+4:0,left=Math.max(2,Math.min(stage.clientWidth-labelWidth-extra-2,x)),top=Math.max(2,y-25);
  if(showLink){button.style.left=`${Math.round(left+labelWidth+4)}px`;button.style.top=`${Math.round(top)}px`;}
  if(timer){
    let node=generationTimerNodes.get(region.id);
    if(!node){node=document.createElement('span');node.className='generation-timer';node.setAttribute('role','timer');node.setAttribute('aria-live','off');node.title='本次任务计时，完成、失败或取消后停止。';$('generation-timers').append(node);generationTimerNodes.set(region.id,node);}
    node.hidden=false;node.textContent=timer.label;node.dataset.running=String(timer.running);node.setAttribute('aria-label',`${region.name} ${timer.label}`);
    node.style.left=`${Math.round(left+width+6)}px`;node.style.top=`${Math.round(top)}px`;
  }
  ctx.fillStyle=active?'#dd6545':'#6d8975';ctx.fillRect(left,top,width,22);ctx.fillStyle='#fff';ctx.fillText(text,left+7,top+15);ctx.restore();
}
function syncFrameLinkState(region){
  const button=$('frame-link'),linked=!!region?.link;
  button.querySelector('span').textContent=linked?'解开链接':'链接图片';
  button.querySelector('img').src=`/repair/icons/${linked?'link-simple':'link-simple-break'}.svg`;
  button.setAttribute('aria-pressed',String(linked));button.setAttribute('aria-label',`${region?.name||'选区'}：${linked?'解开链接':'链接图片'}`);
  button.title=linked?'解开后，选框和图片各自移动、缩放':'链接后，选框和图片一起移动、缩放';
  button.disabled=!region||state.loading||state.creating||state.versionSelecting||state.selectingRegion||!!state.pointer||!!region?.linking;
}
function jumpToPage(y){state.panY=28-y*state.zoom-(stage.clientHeight-displayHeight()*state.zoom)/2;render();}
function outputEditing(){return state.tool==='rect'||(['select','frame-move','brush','erase'].includes(state.tool)&&activeRegion()?.coordinateSpace==='output')||['paint','text','extract'].includes(state.tool)||(['mask','layer-move'].includes(state.tool)&&layers.active?.coordinateSpace==='output');}
function point(event) {
  const rect = view.getBoundingClientRect(), t = transform();
  return { x: Math.max(0, Math.min(state.width, (event.clientX - rect.left - t.x) / state.zoom)), y: Math.max(0, Math.min(outputEditing()?displayHeight():state.height,outputEditing()?(event.clientY-rect.top-t.y)/state.zoom:sourcePoint((event.clientY - rect.top - t.y) / state.zoom).y)) };
}
function inside(event) {
  const rect = view.getBoundingClientRect(), t = transform(), x = event.clientX - rect.left, y = event.clientY - rect.top;
  return x >= t.x && x <= t.x + state.width * state.zoom && y >= t.y && y <= t.y + displayHeight() * state.zoom && (outputEditing()||!sourcePoint((y-t.y)/state.zoom).inGap);
}
function brush(from, to) {
  invalidateSelectionEncoding();
  from={x:from.x-state.selectionOrigin.x,y:from.y-state.selectionOrigin.y};to={x:to.x-state.selectionOrigin.x,y:to.y-state.selectionOrigin.y};
  selectionCtx.save(); selectionCtx.globalCompositeOperation = state.tool === 'erase' ? 'destination-out' : 'source-over';
  selectionCtx.strokeStyle = '#ec7952'; selectionCtx.fillStyle = '#ec7952'; selectionCtx.lineWidth = Number($('brush-size').value); selectionCtx.lineCap = 'round'; selectionCtx.lineJoin = 'round';
  selectionCtx.beginPath(); selectionCtx.moveTo(from.x, from.y); selectionCtx.lineTo(to.x, to.y); selectionCtx.stroke();
  selectionCtx.beginPath(); selectionCtx.arc(to.x, to.y, selectionCtx.lineWidth / 2, 0, Math.PI * 2); selectionCtx.fill(); selectionCtx.restore();
}
function updateBrushCursor(){
 const ring=$('brush-cursor'),brush=['paint','mask','brush','erase'].includes(state.tool),input=['paint','mask'].includes(state.tool)?$('paint-size'):$('brush-size');
 const visible=brush&&state.viewMode==='edit'&&state.show!=='original'&&!state.before&&!state.loading&&!state.creating&&!state.pointer?.pan&&!$('annotation-dialog').open&&!$('generated-viewer').open&&!!state.cursorPoint&&(state.cursorInside||document.activeElement===input);
 ring.hidden=!visible;let resize=state.pointer?.mode==='section-resize';
 if(!resize&&layers.active?.type==='section'&&state.selectionTarget==='layer'&&state.cursorPoint&&state.tool==='layer-move'){const segment=sectionSegments(editorSections()).find(item=>item.id===layers.active.id),box=view.getBoundingClientRect(),t=transform();resize=!!segment&&Math.abs(state.cursorPoint.y-box.top-t.y-(segment.outputStart+layers.active.height)*state.zoom)<12;}
 const region=activeRegion(),handle=region&&state.frame&&state.cursorPoint&&['select','rect','frame-move'].includes(state.tool)?selectionHandleAt(point({clientX:state.cursorPoint.x,clientY:state.cursorPoint.y}),state.frame,state.zoom):null;
 view.style.cursor=state.pointer?.mode==='frame-resize'?selectionResizeCursor(state.pointer.handle):handle?(canEditRegion(region,chosenRegionLayer(region,layers.layers))?selectionResizeCursor(handle.name):'not-allowed'):['image-resize','text-resize'].includes(state.pointer?.mode)?state.pointer.cursor:editorCursor(state.tool,{display:state.viewMode==='display',dragging:!!state.pointer?.pan,resize});
 if(!visible)return;const bounds=ring.offsetParent?.getBoundingClientRect()||{left:0,top:0},diameter=Number(input.value)*state.zoom;ring.style.width=diameter+'px';ring.style.height=diameter+'px';ring.style.left=(state.cursorPoint.x-bounds.left)+'px';ring.style.top=(state.cursorPoint.y-bounds.top)+'px';ring.classList.toggle('soft',['paint','mask'].includes(state.tool)&&$('paint-edge').value==='soft');
}
view.addEventListener('pointerenter',event=>{state.cursorInside=true;state.cursorPoint={x:event.clientX,y:event.clientY};updateBrushCursor();});
view.addEventListener('pointerleave',()=>{state.cursorInside=false;updateBrushCursor();});
for(const id of ['paint-size','brush-size'])for(const event of ['input','focus','blur'])$(id).addEventListener(event,updateBrushCursor);
$('paint-edge').addEventListener('change',updateBrushCursor);
view.addEventListener('pointerdown', event => {
  if(state.loading||state.creating||state.selectingRegion||state.versionSelecting)return;
  if(event.button===0&&state.frame&&activeRegion()&&['select','rect','frame-move'].includes(state.tool)){const p=point(event),handle=selectionHandleAt(p,state.frame,state.zoom);if(handle){event.preventDefault();if(!canEditRegion(activeRegion(),chosenRegionLayer(activeRegion(),layers.layers)))return centerStatus('选区已锁定，请按 F 解锁');stage.focus({preventScroll:true});view.setPointerCapture(event.pointerId);state.pointer={mode:'frame-resize',before:editorSnapshot(),handle:handle.name,frame:{...state.frame},regionSource:frameMoveSource(activeRegion())};return;}}
  if(event.button===0&&state.width&&state.tool!=='pan'&&!insideOutput(event)){event.preventDefault();clearObjectSelection();setTool('select',{reveal:false});stage.focus({preventScroll:true});return;}
  if(event.button===0&&state.tool==='extract'){if(!state.width||!state.page)return;event.preventDefault();stage.focus({preventScroll:true});view.setPointerCapture(event.pointerId);const start=point(event);state.pointer={mode:'extract',start};state.extractBox={x:start.x,y:start.y,width:0,height:0};render();return;}
  if(event.button===0&&state.tool==='select'){
    event.preventDefault();stage.focus({preventScroll:true});if(!insideOutput(event))return;const output={x:point(event).x,y:rawDisplayPoint(event)},mapped=sourcePoint(output.y),source=mapped.inGap?null:{x:output.x,y:mapped.y},region=repairAtPoint(source,output,state.regions,layers.layers,layer=>layers.bounds(layer));
    const hit=canvasLayerAtPoint(source,output,layers.layers,layer=>layers.bounds(layer));if(hit)void selectCanvasObject(layerSelectionKey(hit),event);else if(region)void selectCanvasObject('region:'+region.id,event);else if(!event.ctrlKey&&!event.metaKey&&!event.shiftKey)clearListSelection();return;
  }
  if(event.button===0&&layers.active?.type==='section'&&state.show!=='original'){
    const layer=layers.active,segment=sectionSegments(editorSections()).find(item=>item.id===layer.id),raw=rawDisplayPoint(event);
    if(segment&&Math.abs((raw-segment.outputStart-layer.height)*state.zoom)<=12){if(layer.locked)return toast('图层已锁定，请按 F 解锁',true);event.preventDefault();view.setPointerCapture(event.pointerId);state.pointer={mode:'section-resize',before:editorSnapshot(),layerId:layer.id,startY:event.clientY,height:layer.height};return;}
  }
  if(event.button===0&&layerSelection.size>1&&state.viewMode==='edit'&&!['pan','layer-move'].includes(state.tool)){layerSelection.single(currentLayerSelectionKey());syncLayerSelection();}

  if(event.button===1&&state.viewMode!=='edit'){event.preventDefault();view.setPointerCapture(event.pointerId);state.pointer={pan:true,before:null,clientX:event.clientX,clientY:event.clientY,panX:state.panX,panY:state.panY};view.style.cursor='grabbing';return;}
  if(event.button===1){event.preventDefault();if(!state.frame||!canEditRegion(activeRegion(),chosenRegionLayer(activeRegion(),layers.layers))||autoRunning(state.tasks.get(activeRegion()?.jobId)||null))return;view.setPointerCapture(event.pointerId);state.pointer={before:editorSnapshot(),mode:'frame-move',clientX:event.clientX,clientY:event.clientY,frame:{...state.frame},start:point(event),origin:{...state.selectionOrigin},bounds:state.bounds?{...state.bounds}:null,regionSource:activeRegion()?frameMoveSource(activeRegion()):null};return;}
  if(event.button!==0)return;
  if(state.viewMode==='edit'&&state.tool==='frame-move'){
    const region=activeRegion();if(!region||!state.frame)return centerStatus('请先选择选框');
    if(!canEditRegion(region,chosenRegionLayer(region,layers.layers)))return centerStatus('选框或链接图片已锁定，请按 F 解锁');
    event.preventDefault();stage.focus({preventScroll:true});view.setPointerCapture(event.pointerId);
    state.pointer={before:editorSnapshot(),mode:'frame-move',clientX:event.clientX,clientY:event.clientY,frame:{...state.frame},origin:{...state.selectionOrigin},bounds:state.bounds?{...state.bounds}:null,start:point(event),regionSource:frameMoveSource(region)};return;
  }
  if(state.viewMode==='edit'&&state.tool==='mask'){stage.focus({preventScroll:true});if(!canEditLayer(layers.active,contentRegion(layers.active,state.regions)))return centerStatus('请选择图片并按 F 解锁');event.preventDefault();if(!layers.active.canvas){void layers.ensureLayer(layers.active).catch(error=>toast(error.message,true));return centerStatus('正在读取图片，请稍候');}const p=point(event),before=editorSnapshot();try{layers.beginMaskStroke({size:Number($('paint-size').value),opacity:Number($('paint-opacity').value)/100,edge:$('paint-edge').value,mode:state.maskMode});view.setPointerCapture(event.pointerId);state.pointer={mode:'mask',last:p,before};layers.paintMask(p,p);}catch(error){toast(error.message,true);}return;}
  if(state.viewMode==='edit'&&state.tool==='paint'){stage.focus({preventScroll:true});event.preventDefault();view.setPointerCapture(event.pointerId);const p=point(event),before=editorSnapshot();try{state.selectionTarget='layer';layers.beginStroke({size:Number($('paint-size').value),opacity:Number($('paint-opacity').value)/100,color:$('paint-color').value,edge:$('paint-edge').value});layerSelection.single(layerSelectionKey(layers.active));syncLayerSelection();state.pointer={mode:'paint',last:p,before};layers.paint(p,p);}catch(error){toast(error.message,true);}return;}
  if(state.viewMode==='edit'&&state.tool==='layer-move'&&layers.active?.type==='background')return centerStatus('底色铺满画布，可在底色属性中调整颜色和透明度');
  if(state.viewMode==='edit'&&state.tool==='layer-move'&&layers.active?.type==='section'){return centerStatus('拖动图层底部横线调整透明长度；左右排序在图层属性中');}
  if(state.viewMode==='edit'&&state.tool==='layer-move'&&layers.active){const members=operationMembers();if(!members.length)return centerStatus('请选择可以移动的图片、文字或绘画图层');if(members.some(layer=>!canEditLayer(layer,contentRegion(layer,state.regions))))return centerStatus('所选或链接图层已锁定，请先解锁所选');event.preventDefault();stage.focus({preventScroll:true});view.setPointerCapture(event.pointerId);state.pointer={before:editorSnapshot(),mode:'layer-move',clientX:event.clientX,clientY:event.clientY,members:members.map(layer=>({id:layer.id,x:layer.x,y:layer.y}))};return;}
  const pan = state.viewMode==='display' || state.tool === 'pan';
  if (!pan && (state.show === 'original' || !inside(event))) return;
  if(!pan&&['brush','erase'].includes(state.tool)&&activeRegion()&&!canEditRegion(activeRegion(),chosenRegionLayer(activeRegion(),layers.layers)))return toast('选区已锁定，请先解锁',true);
  if(!pan&&state.tool!=='rect'&&!state.frame)return toast('先按 D 画比例框，再涂抹或擦除。');
  stage.focus({ preventScroll: true }); view.setPointerCapture(event.pointerId);
  const p = point(event); state.pointer = { before:pan?null:editorSnapshot(), start: p, last: p, clientX: event.clientX, clientY: event.clientY, pan, panX: state.panX, panY: state.panY };
  if (pan) { view.style.cursor = 'grabbing'; return; }
  if (state.tool === 'rect') {state.selectionSpace='output';state.pointer.newRegion=true;state.activeRegionId=null;selection.width=1;selection.height=1;state.frame=null;state.bounds=null;}
  else brush(p, p);
  render();
});
view.addEventListener('pointermove', event => {
  state.cursorPoint={x:event.clientX,y:event.clientY};state.cursorInside=inside(event);updateBrushCursor();
  if (!state.pointer) return;
  if(state.pointer.mode==='image-resize'){moveImageResize(event);return;}
  if(state.pointer.mode==='text-resize'){moveTextResize(event);return;}
  if(state.pointer.mode==='extract'){state.extractBox=freeSelectionRect(state.pointer.start,point(event),state.width,displayHeight());updateExtractPreview();return;}
  if(state.pointer.mode==='section-resize'){const pointer=state.pointer,layer=layers.layers.find(item=>item.id===pointer.layerId);if(layer)setSectionLength(layer,Math.round(pointer.height+(event.clientY-pointer.startY)/state.zoom));return;}
  const p = point(event), pointer = state.pointer;
  if(pointer.mode==='frame-resize'){const box=resizeSelectionFrame(pointer.frame,pointer.handle,p,activeRegion().ratio||'1:1',state.width,selectionHeight());if(box.width&&box.height){try{applyRegionFrame(activeRegion(),pointer.regionSource,box);}catch(error){toast(error.message,true);}}return;}
  if(pointer.mode==='frame-move'){const moved=moveFixedFrame(pointer.frame,(event.clientX-pointer.clientX)/state.zoom,(pointer.start?p.y-pointer.start.y:(event.clientY-pointer.clientY)/state.zoom),state.width,selectionHeight()),{x,y}=moved;if(pointer.regionSource&&activeRegion()){applyRegionFrame(activeRegion(),pointer.regionSource,moved);return;}state.frame=moved;state.selectionOrigin={x:pointer.origin.x+x-pointer.frame.x,y:pointer.origin.y+y-pointer.frame.y};if(pointer.bounds)state.bounds={...pointer.bounds,x:pointer.bounds.x+x-pointer.frame.x,y:pointer.bounds.y+y-pointer.frame.y};$('selection-info').textContent=`${state.frame.width} × ${state.frame.height} px · 位置 ${x}, ${y}`;render();return;}
  if(pointer.mode==='mask'){layers.paintMask(pointer.last,p);pointer.last=p;return;}
  if(pointer.mode==='paint'){layers.paint(pointer.last,p);pointer.last=p;return;}
  if(pointer.mode==='layer-move'){const dx=(event.clientX-pointer.clientX)/state.zoom,dy=(event.clientY-pointer.clientY)/state.zoom;for(const saved of pointer.members){const layer=layers.layers.find(layer=>layer.id===saved.id);if(layer){layer.x=saved.x+dx;layer.y=saved.y+dy;}}layers.update();return;}
  if (pointer.pan) { state.panX = pointer.panX + event.clientX - pointer.clientX; state.panY = pointer.panY + event.clientY - pointer.clientY; render(); return; }
  if (state.tool === 'rect') {
    const rect=fixedRatioRect(pointer.start,p,$('selection-ratio').value,state.width,selectionHeight());
    if(rect.width&&rect.height){invalidateSelectionEncoding();selection.width=rect.width;selection.height=rect.height;state.frame=rect;state.selectionOrigin={x:rect.x,y:rect.y};selectionCtx.fillStyle='#ec7952';selectionCtx.fillRect(0,0,rect.width,rect.height);}
  } else brush(pointer.last, p);
  pointer.last = p; render();
});
function endPointer(event) {
  if (!state.pointer) return;
  if(state.pointer.mode==='text-resize'){
   const pointer=state.pointer,layer=layers.layers.find(item=>item.id===pointer.layerId);
   if(event?.type==='pointercancel'&&layer){for(const key of ['x','y','textBoxWidth','textBoxHeight','textMode','textWrap'])if(pointer.base[key]===undefined)delete layer[key];else layer[key]=pointer.base[key];}
   else if(event?.type==='pointerup')moveTextResize(event);
   state.pointer=null;updateBrushCursor();if(layer)writeTextLayoutControls(layer);
   if(pointer.changed&&event?.type!=='pointercancel'){state.revision++;rememberStep(pointer.before,'调整文本框大小');scheduleProjectSave();}layers.update();return;
  }
  if(state.pointer.mode==='image-resize'){
   const pointer=state.pointer,layer=layers.layers.find(item=>item.id===pointer.layerId);
   if(event?.type==='pointercancel'&&layer)Object.assign(layer,pointer.cancelPose);
   else if(event?.type==='pointerup')moveImageResize(event);
   state.pointer=null;updateBrushCursor();
   if(pointer.changed&&event?.type!=='pointercancel'){state.revision++;rememberStep(pointer.before,'缩放图片图层');}
   layers.update();return;
  }
  const mode=state.pointer.mode,pan=state.pointer.pan,before=state.pointer.before,newRegion=state.pointer.newRegion,oldFrame=state.pointer.frame; state.pointer = null;
  if(mode==='frame-move'&&oldFrame&&!state.regionMaskCache.has(state.activeRegionId)){const region=activeRegion(),dx=state.frame.x-oldFrame.x,dy=state.frame.y-oldFrame.y;for(const mark of region?.annotations||[]){if(mark.points)for(const point of mark.points){point.x+=dx;point.y+=dy;}else{mark.x+=dx;mark.y+=dy;}}}
  if(mode==='extract'){const rect=state.extractBox;if(event?.type==='pointercancel'||!rect||rect.width<2||rect.height<2)state.extractBox=null;updateExtractPreview();return;}
  if(mode==='section-resize'){state.revision++;rememberStep(before,'调整漫画图层透明长度');scheduleProjectSave();render();return;}
  if(mode==='mask'){layers.endMaskStroke();state.revision++;rememberStep(before,state.maskMode==='hide'?'蒙版隐藏':'蒙版显示');return;}
  if(mode==='paint'){layers.endStroke();state.revision++;rememberStep(before,'画笔涂抹');return;}
  if(mode==='layer-move'){if(event?.type==='pointercancel'){layers.restoreSnapshot(before.layers);return;}state.revision++;rememberStep(before,'移动所选图层');scheduleProjectSave();return;}
  updateBrushCursor();
  if(!pan){boundsChanged();if(newRegion&&state.frame&&state.bounds)addRegionFromSelection();else saveActiveRegion();rememberStep(before,mode==='frame-move'?'移动选区图层':mode==='frame-resize'?'缩放选区图层':'修改选区图层');}render();
}
view.addEventListener('pointerup', endPointer); view.addEventListener('pointercancel', endPointer); view.addEventListener('lostpointercapture', endPointer);
view.addEventListener('auxclick',event=>{if(event.button===1)event.preventDefault();});
bindWheelNavigation(view,{blocked:()=>state.loading||state.creating||!!state.pointer,onPan:(x,y)=>{state.panX-=x;state.panY-=y;render();},onZoom:(multiplier,event)=>{const bounds=view.getBoundingClientRect();zoom(multiplier,{x:event.clientX-bounds.left,y:event.clientY-bounds.top});}});
function zoom(multiplier,anchor={x:stage.clientWidth/2,y:stage.clientHeight/2}){const old=transform(),x=(anchor.x-old.x)/state.zoom,y=(anchor.y-old.y)/state.zoom;state.zoom=Math.max(.00001,Math.min(6,state.zoom*multiplier));state.panX=anchor.x-x*state.zoom-(stage.clientWidth-state.width*state.zoom)/2;state.panY=anchor.y-y*state.zoom-(stage.clientHeight-displayHeight()*state.zoom)/2;render();}

async function decodeImage(url) {
  const image = new Image(); image.src = url; await image.decode();
  if (!image.naturalWidth || image.naturalWidth * image.naturalHeight > 16_000_000 || image.naturalWidth > 12000 || image.naturalHeight > 12000) throw new Error('当前版本支持不超过 1600 万像素、单边不超过 12000 px 的图片');
  return image;
}
async function loadImage(url, name) {
  if(state.creating||state.loading)return;
  await flushProject();
  state.loading = true; busy(true, '打开图片…'); updateButtons();
  try {
    const image = await decodeImage(url);
    layers.reset();state.aiLayerId=null;
    state.page?.dispose();state.page=null;resetTasks(`legacy:${crypto.randomUUID()}`);
    state.width = image.naturalWidth; state.height = image.naturalHeight; state.name = name;
    for (const target of [current, original]) { target.width = state.width; target.height = state.height; }selection.width=1;selection.height=1;state.frame=null;state.selectionOrigin={x:0,y:0};
    current.getContext('2d').drawImage(image, 0, 0); original.getContext('2d').drawImage(image, 0, 0);
    state.history = []; state.revision = 0; state.exportedRevision = 0; state.preview = null; state.bounds = null; state.show = 'current';
    $('source-name').textContent = name; $('source-size').textContent = `${state.width} × ${state.height} px`;
    // Keep a small thumbnail rather than another full resolution data URL.
    const thumb = canvas(180, Math.round(180 * state.height / state.width)); thumb.getContext('2d').drawImage(current, 0, 0, thumb.width, thumb.height); $('source-thumb').src = thumb.toDataURL('image/png');
    $('image-info').textContent = `${name} · ${state.width} × ${state.height} px`;
    updateHistory(); boundsChanged(); setShow('current'); setTool('pan'); fit();
    return true;
  } catch (error) { toast(error.message || '图片无法打开', true); return false; }
  finally { state.loading = false; busy(false); updateButtons(); }
}
async function loadFile(file) {
  if (!file || !/^image\/(png|jpeg|webp)$/.test(file.type)) return toast('请选择 PNG、JPG 或 WebP 图片', true);
  if(state.creating)return;await flushProject();
  state.loading=true;busy(true,'正在分段读取漫画原图…');updateButtons();
  try{const response=await fetch('/repair/api/sources',{method:'POST',headers:{'Content-Type':file.type,'X-Source-Name':encodeURIComponent(file.name)},body:file});const meta=await response.json();if(!response.ok)throw new Error(meta.error);await loadPage(meta);if(meta.reused)toast('已打开已有漫画项目，未创建重复文件夹。');}
  catch(error){toast(error.message||'漫画导入失败',true);}finally{state.loading=false;busy(false);updateButtons();}
}
async function loadPage(meta,revision=meta.revision){
  if(state.page&&state.page.metadata.id!==meta.id)await flushProject();
  const page=new PageView(meta,render,loading=>{$('page-detail-loading').hidden=!loading;});await page.load(revision);
  clearTimeout(projectTimer);state.page?.dispose();state.page=page;
  resetTasks(`source:${meta.id}`);layers.reset();
  state.width=meta.width;state.height=meta.height;state.name=meta.name;
  current.width=original.width=selection.width=1;current.height=original.height=selection.height=1;
  state.frame=null;state.bounds=null;state.selectionOrigin={x:0,y:0};state.history=[];state.preview=null;state.revision=0;state.exportedRevision=0;
  $('source-name').textContent=meta.name;$('source-size').textContent=`${meta.width} × ${meta.height} px`;$('source-thumb').src=page.url('thumb.png');$('image-info').textContent=`${meta.name} · ${meta.width} × ${meta.height} px · 原尺寸保留`;
  setShow('current');setTool('pan',{reveal:false});boundsChanged();updateHistory();fit();if(new URL(location.href).searchParams.get('demo')!=='1')localStorage.setItem('patch-last-page',meta.id);
  try{const response=await fetch(`/repair/api/sources/${meta.id}/project`);if(response.ok){const saved=await response.json();resetTasks(`source:${meta.id}`,saved.tasks);state.fontAssets=saved.fontAssets||[];setProjectFontAssets(state.fontAssets);state.pageGaps=normalizePageGaps(saved.pageGaps||[],state.height);state.sectionMode=!!saved.sectionMode;if(saved.layers?.length)await layers.restore(saved.layers,{renderedLayers:saved.renderedLayers||[]});migratePageGaps();migrateLooseLayers();state.projectVersion=saved.version||0;state.regions=saved.regions||[];state.regionNumbers=saved.regionNumbers||{};state.deletedRegionIds=saved.deletedRegionIds||{};state.restoredRegionIds=saved.restoredRegionIds||{};syncRegionNumbers();normalizeRepairVersions(state.regions,layers.layers);updateLayers(layers);for(const region of state.regions){const layer=chosenRegionLayer(region,layers.layers);if(layer)region.locked=layer.locked=!!(region.locked||layer.locked);}await restoreLinkCaches();if(saved.activeLayerId&&layers.layers.some(layer=>layer.id===saved.activeLayerId)){layers.select(saved.activeLayerId);state.selectionTarget='layer';layerSelection.single(layerSelectionKey(layers.active));}if(saved.activeRegionId&&state.regions.some(region=>region.id===saved.activeRegionId))await selectRegion(saved.activeRegionId);renderRegions();render();}}catch{}
}
function setViewMode(mode){
 selectionMenu.close();
  if(mode==='edit'&&state.show==='original'&&state.width){const next=compareViewport({current:state.show,next:'current',height:state.height,sections:state.sectionMode?editorSections():null,gaps:state.pageGaps,zoom:state.zoom,panX:state.panX,panY:state.panY,bookmark:state.compareBookmark});state.panY=next.panY;state.compareBookmark=next.bookmark;}
  state.viewMode=mode;if(mode==='display')state.tool='pan';syncToolUI();document.body.dataset.viewMode=mode;$('mode-display').classList.toggle('active',mode==='display');$('mode-edit').classList.toggle('active',mode==='edit');$('mode-display').setAttribute('aria-pressed',String(mode==='display'));$('mode-edit').setAttribute('aria-pressed',String(mode==='edit'));if(mode==='edit'){state.show='current';state.before=false;syncViewButtons();}render();
}
function syncViewButtons(){for(const name of ['current','original']){$(`show-${name}`).classList.toggle('active',state.show===name);$(`show-${name}`).setAttribute('aria-pressed',String(state.show===name));}}
function setShow(value){
 if(value!==state.show&&state.width){const next=compareViewport({current:state.show,next:value,height:state.height,sections:state.sectionMode?editorSections():null,gaps:state.pageGaps,zoom:state.zoom,panX:state.panX,panY:state.panY,bookmark:state.compareBookmark});state.panY=next.panY;state.compareBookmark=next.bookmark;}
 state.show=value;state.before=false;state.extractBox=null;setViewMode('display');syncViewButtons();render();
}
function cleanCompare(){if(state.pointer)return;setShow(state.show==='original'?'current':'original');}
function promptText(crop,bounds,instruction=$('prompt').value.trim(),target=state.target) {
  // Background Codex turns only receive crop.png (plus references/annotation), never guide.png.
  const guideNote=target==='auto'?'':'如有 guide.png，橙色标记为需要修改的位置。guide.png 仅作位置参考，输出不能含橙色标记。';
  return `请修改随附的局部图片。\n\n修改要求：${instruction}\n\n输入图是从原图裁出的完整局部，尺寸 ${crop.width} × ${crop.height} 像素。需要修改的区域位于局部图中的 (${bounds.x - crop.x}, ${bounds.y - crop.y})，外接矩形约为 ${bounds.width} × ${bounds.height} 像素。${guideNote}\n\n只修正指定问题；保持人物身份、姿态、比例、透视、漫画线条、配色与光影。保留手腕、衣袖和附近物体的衔接。不要改变画面的构图，不要裁切、旋转、加边框、加文字或水印。返回整张输入局部图（包含周边参照），保持 ${crop.width}:${crop.height} 的宽高比，尽量保持原尺寸。工具会按原图坐标，仅在人工选区内拼回。`;
}

async function createJob(){const region=activeRegion();if(region)await submitRegion(region);}
async function ensurePageProject(){
  if(state.page)return;
  if(!state.demoImport){state.demoImport=(async()=>{const blob=await new Promise(resolve=>original.toBlob(resolve,'image/png')),response=await fetch('/repair/api/sources',{method:'POST',headers:{'Content-Type':'image/png','X-Source-Name':encodeURIComponent(state.name+'.png')},body:blob}),meta=await response.json();if(!response.ok)throw new Error(meta.error);const page=new PageView(meta,render);await page.load(0);state.page=page;state.editorKey=`source:${meta.id}`;state.pageEpoch++;state.compareBookmark=null;state.name=meta.name;if(new URL(location.href).searchParams.get('demo')!=='1')localStorage.setItem('patch-last-page',meta.id);await flushProject();void refreshProjects();})().finally(()=>{state.demoImport=null;});}await state.demoImport;
}
async function submitRegion(region,options={}){
  try{await ensurePageProject();}catch(error){return toast(error.message||'项目保存失败',true);}
  if(region.submitting||region.referenceLoading||!!regionBusy(region))return;
  const saved=structuredClone(region),instruction=saved.prompt?.trim()||(saved.separateBubble?(saved.autoText?'将选区内气泡拆成干净背景、透明无字气泡框与可编辑文字图层。':'将选区内气泡拆成干净背景与透明无字气泡框。'):saved.autoText?'去掉选区内气泡的原文字，保留空白气泡。':'');if(!instruction)return toast(`${region.name} 尚未填写修改要求`,true);
  const context=options.context||{sourceId:state.page.metadata.id,sourceRevision:state.page.revision,editorKey:state.editorKey,width:state.width,height:regionSpaceHeight(saved,state.height,displayHeight()),sourceName:state.name,epoch:state.pageEpoch,target:state.target};
  region.submitting=true;renderRegions();updateButtons();
  try{
    await ensureLayerFonts(layers.layers);
    context.height=regionSpaceHeight(saved,state.height,displayHeight());const crop=fixedRatioCrop(saved.frame,Math.max(saved.padding||0,Math.ceil((saved.feather||0)*3)),saved.ratio||'1:1',context.width,context.height),mask=canvas(crop.width,crop.height),mctx=mask.getContext('2d',{willReadFrequently:true});
    if(saved.maskImage){const image=await decodeImage(saved.maskImage),origin=saved.origin||saved.frame;mctx.drawImage(image,origin.x-crop.x,origin.y-crop.y);}else{mctx.fillStyle='#ec7952';mctx.fillRect(saved.frame.x-crop.x,saved.frame.y-crop.y,saved.frame.width,saved.frame.height);}
    const values=maskValues(mask),data=mctx.createImageData(crop.width,crop.height);for(let i=0;i<values.length;i++)data.data.set([255,255,255,255-values[i]],i*4);mctx.putImageData(data,0,0);
    if(context.epoch!==state.pageEpoch)throw new Error('提交的漫画已切换');
    const output=saved.coordinateSpace==='output',segments=visibleSegments().map(item=>({...item,width:context.width})),windows=output?{output:[crop],source:segments.flatMap(segment=>{const top=Math.max(crop.y,segment.start+segment.offset),bottom=Math.min(crop.y+crop.height,segment.end+segment.offset);return top<bottom?[{x:crop.x,y:top-segment.offset,width:crop.width,height:bottom-top}]:[];})}:{source:[crop]};if(output)await layers.ensureForSerialization({windows});else await layers.ensureForSourceSerialization(segments,{windows});
    if(context.epoch!==state.pageEpoch)throw new Error('提交的漫画已切换');
    context.layers=output?layers.serialize({windows}):context.layers||layers.serializeForSource(segments,{windows});
    const payload={generationMode:saved.generationMode==='configured'?'configured':'low',separateBubble:saved.separateBubble===true,autoText:saved.autoText===true,coordinateSpace:output?'output':'source',sectionMode:output&&state.sectionMode,pageSections:output?editorSections():[],pageGaps:output?state.pageGaps:[],sourceId:context.sourceId,sourceRevision:context.sourceRevision,editorKey:context.editorKey,original:{width:context.width,height:context.height},sourceName:context.sourceName,crop,frame:saved.frame,aspectRatio:saved.ratio,featherMode:'gaussian',feather:saved.feather||0,prompt:promptText(crop,saved.frame,instruction,context.target),label:saved.prompt?.trim()||'',mode:context.target,references:(saved.references||[]).map(image=>image.id),layers:context.layers,mask:mask.toDataURL('image/png'),regionId:saved.id,region:saved,annotationMarks:saved.annotations||[],submittedAt:(context.submittedAt||Date.now())+(context.regionOrder?.indexOf(saved.id)||0)};
    const response=await fetch('/repair/api/jobs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}),request=await response.json();if(!response.ok)throw new Error(request.error);
    region.jobId=request.id;region.locked=true;region.modifiedAt=Date.now();
    if(context.epoch===state.pageEpoch){const task=mergeTask(state.tasks,request,state.taskNotes);task.baseRevision=context.sourceRevision;rememberTask(task);if(state.activeRegionId===region.id)focusTaskPanel(task);scheduleProjectSave();renderTasks();toast(`${region.name} 已提交，可继续其他选区或下一张漫画。`);}
    return request;
  }catch(error){region.submitError=error.message;if(context.epoch===state.pageEpoch)toast(error.message||`${region.name} 提交失败`,true);}
  finally{region.submitting=false;if(context.epoch===state.pageEpoch){renderRegions();updateButtons();void refreshProjects();}}
}
function connectionErrorMessage(message){
  if(/timed?\s*out|timeout|超时/i.test(message||''))return 'Codex 连接检查超时，请重新连接。';
  if(/failed to fetch|network|网络|连接失败/i.test(message||''))return 'Codex 连接暂时不可用，请重新连接。';
  return message||'Codex 尚未连接，请重新检查连接。';
}
function updateSubmitFeedback(){
  const region=activeRegion();let reason='';
  if(!region)reason='先新建选区或选择一个选区。';
  else if(state.loading||state.creating||state.versionSelecting)reason='正在处理，请稍候。';
  else if(region.submitting)reason='正在提交此选区，请稍候。';
  else if(region.referenceLoading)reason='参考图正在上传，请稍候。';
  else if(!regionHasPrompt(region))reason='请先填写修改要求。';
  else if(!!regionBusy(region))reason=isTextReviewTask(regionBusy(region))?(taskStatus(regionBusy(region))==='awaiting_text_review'?'此选区等待校对原文，请点“校对原文”继续。':'此选区正在识字或复核，请等待草稿就绪。'):'此选区正在处理，请等待当前任务完成。';
  else if(state.target==='auto'&&!state.codexReady)reason=state.codexChecking?'正在连接 Codex…':state.codexRetryTimer?'Codex 连接暂时超时，正在自动重试…':connectionErrorMessage(state.codexError);
  $('submit-status').textContent=reason;$('submit-status').hidden=!reason;$('create-job').title=reason||'提交当前选区到后台修图';
  $('submit-reconnect').hidden=!region||state.target!=='auto'||state.codexReady;$('submit-reconnect').disabled=state.codexChecking;
}
async function checkCodex(fresh=false,retry=false){
  if(state.codexChecking)return;
  clearTimeout(state.codexRetryTimer);state.codexRetryTimer=null;if(fresh&&!retry)state.codexRetries=0;
  state.codexChecking=true;updateButtons();
  if(state.target==='auto')$('target-note').textContent='正在检查 Codex 登录与修图能力…';
  try{
    const response=await fetch(`/repair/api/codex/status${fresh?'?fresh=1':''}`),status=await response.json();if(!response.ok)throw new Error(status.error||'连接检查失败');
    state.codexReady=status.ready===true;
    state.codexError=status.ready?'':status.error||(!status.loggedIn?'本地 Codex 未检测到 ChatGPT 登录，请登录后重新连接。':'当前 Codex 未启用生图能力，可使用当前对话方式。');
    if(status.ready)state.codexRetries=0;
    if(state.target==='auto')$('target-note').textContent=status.ready?'Codex 已连接。提交后可继续圈选，后台修图完成会自动接回图层，无需 API Key。':connectionErrorMessage(state.codexError);
  }catch(error){state.codexReady=false;state.codexError=error.message||'Codex 连接不可用';if(state.target==='auto')$('target-note').textContent=connectionErrorMessage(state.codexError);}
  finally{
    state.codexChecking=false;
    if(!state.codexReady&&state.target==='auto'&&/timed?\s*out|timeout|超时|failed to fetch|network|网络|连接失败/i.test(state.codexError)&&state.codexRetries<2){
      state.codexRetries++;state.codexRetryTimer=setTimeout(()=>{state.codexRetryTimer=null;if(state.target==='auto')void checkCodex(true,true);},2500*state.codexRetries);
    }
    renderRegions();updateButtons();
  }
}
async function startAutomation(task=state.job) {
  if(!task||task.starting||taskHasPendingWork(task))return;
  const epoch=state.pageEpoch;task.starting=true;task.automatic=true;task.mode='auto';task.decision=undefined;rememberTask(task);renderTasks();updateButtons();
  try{
    const response=await fetch(`/repair/api/jobs/${task.id}/repair`,{method:'POST'}),result=await response.json();if(!response.ok)throw new Error(result.error);
    task.automation=result.automation;
    if(task.cancelRequested){const cancelled=await fetch(`/repair/api/jobs/${task.id}/cancel`,{method:'POST'});if(!cancelled.ok)throw new Error('取消请求未送达');task.cancelRequested=false;}
    if(epoch===state.pageEpoch)toast('已加入后台任务，可继续框选下一处。');
  }catch(error){task.automation={status:'failed',message:error.message};if(epoch===state.pageEpoch)toast(error.message||'自动修图提交失败',true);}
  finally{task.starting=false;if(epoch===state.pageEpoch){rememberTask(task);renderTasks();refreshTaskPanel();updateButtons();}}
}

// The review session owns its job ID; async requests never follow state.job to a different task.
const textReviewState={request:0,jobId:null,epoch:0,draft:null,selected:new Set(),busy:false,polling:false,dirty:false,refinePending:false,localConflict:null,zoom:1};
function textReviewLocalKey(id){return `patch-text-review-v2:${id}`;}
function textReviewMessage(message,error=false){$('text-review-status').textContent=message;$('text-review-status').classList.toggle('warning',error);}
function persistTextReviewLocal(){
  const review=textReviewState;if(!review.draft||!review.dirty)return;
  try{localStorage.setItem(textReviewLocalKey(review.jobId),JSON.stringify({baseRevision:review.draft.revision,draft:review.draft,savedAt:Date.now()}));}catch{textReviewMessage('本机草稿暂存失败，请点击“保存校对草稿”保存到任务目录。',true);}
}
function textReviewChanged(){textReviewState.dirty=true;persistTextReviewLocal();renderTextReviewOverlay();updateTextReviewButtons();textReviewMessage('已在本机暂存修改。校对完成后点击“确认原文并生成”；也可先保存草稿。');}
function updateTextReviewButtons(){
  const review=textReviewState,task=state.tasks.get(review.jobId),refining=review.refinePending||task?.automation?.status==='refining_text',readonly=review.draft?.status!=='draft',disabled=review.busy||refining||readonly||!review.draft;
  for(const id of ['text-review-add','text-review-save','text-review-refine','text-review-confirm'])$(id).disabled=disabled;
  $('text-review-merge').disabled=disabled||review.selected.size<2;$('text-review-close').disabled=review.busy;$('text-review-reload').disabled=review.busy||refining;
  $('text-review-restore-local').hidden=!review.localConflict;$('text-review-restore-local').disabled=disabled;
  for(const input of $('text-review-bubbles').querySelectorAll('input,select,textarea,button'))input.disabled=disabled;
}
function renderTextReviewOverlay(){
  const overlay=$('text-review-overlay');overlay.replaceChildren();const review=textReviewState;
  for(const [index,bubble] of (review.draft?.bubbles||[]).entries()){
    const group=document.createElementNS('http://www.w3.org/2000/svg','g');group.dataset.bubbleId=bubble.id;group.classList.toggle('selected',review.selected.has(bubble.id));
    for(const field of ['bubbleBox','box']){const box=bubble[field];if(!Array.isArray(box)||!box.every(Number.isFinite))continue;const rect=document.createElementNS('http://www.w3.org/2000/svg','rect');for(const [attribute,value] of [['x',box[0]],['y',box[1]],['width',box[2]],['height',box[3]]])rect.setAttribute(attribute,String(value));if(field==='box')rect.classList.add('text-box');group.append(rect);}
    const label=document.createElementNS('http://www.w3.org/2000/svg','text');label.setAttribute('x',String(bubble.bubbleBox?.[0]||0));label.setAttribute('y',String(Math.max(28,bubble.bubbleBox?.[1]||0)));label.textContent=String(index+1);group.append(label);
    group.addEventListener('click',()=>{if(review.selected.has(bubble.id))review.selected.delete(bubble.id);else review.selected.add(bubble.id);renderTextReviewBubbles();renderTextReviewOverlay();$('text-review-bubbles').querySelector(`[data-bubble-id="${CSS.escape(bubble.id)}"]`)?.scrollIntoView({block:'nearest'});});overlay.append(group);
  }
}
function renderTextReviewBubbles(){
  const list=$('text-review-bubbles'),review=textReviewState;list.replaceChildren();
  if(!review.draft?.bubbles.length){const empty=document.createElement('p');empty.textContent='没有保留的气泡。可添加漏识气泡；没有文字的普通修图请关闭此任务并重新提交普通修图。';list.append(empty);}
  for(const [index,bubble] of (review.draft?.bubbles||[]).entries()){
    const card=document.createElement('article');card.className='text-review-bubble';card.classList.toggle('selected',review.selected.has(bubble.id));card.dataset.bubbleId=bubble.id;
    const heading=document.createElement('div');heading.className='text-review-bubble-heading';const selectLabel=document.createElement('label'),select=document.createElement('input');select.type='checkbox';select.checked=review.selected.has(bubble.id);select.setAttribute('aria-label',`勾选气泡 ${index+1} 用于合并`);select.addEventListener('change',()=>{if(select.checked)review.selected.add(bubble.id);else review.selected.delete(bubble.id);card.classList.toggle('selected',select.checked);renderTextReviewOverlay();updateTextReviewButtons();});selectLabel.append(select,`气泡 ${index+1}`);heading.append(selectLabel);
    const remove=document.createElement('button');remove.type='button';remove.textContent='删除假识别';remove.addEventListener('click',()=>{review.draft.bubbles=review.draft.bubbles.filter(row=>row.id!==bubble.id);review.selected.delete(bubble.id);textReviewChanged();renderTextReviewBubbles();});heading.append(remove);
    const next=review.draft.bubbles[index+1];if(next){const merge=document.createElement('button');merge.type='button';merge.textContent='合并下一段';merge.title='仅在下一段属于同一气泡时使用';merge.addEventListener('click',()=>mergeTextReviewSelection([bubble.id,next.id]));heading.append(merge);}card.append(heading);
    const text=document.createElement('textarea');text.rows=4;text.value=bubble.text||'';text.setAttribute('aria-label',`气泡 ${index+1} 原文`);text.addEventListener('input',()=>{bubble.text=text.value;textReviewChanged();});card.append(text);
    if(bubble.uncertain?.length){const hint=document.createElement('p');hint.className='text-review-uncertain';hint.textContent='需复核：'+bubble.uncertain.map(item=>typeof item==='string'?item:JSON.stringify(item)).join('；');card.append(hint);}
    const format=document.createElement('div');format.className='text-review-format';
    for(const [field,name,values] of [['direction','方向',[['horizontal','横排'],['vertical-rl','竖排（从右到左）'],['vertical-lr','竖排（从左到右）']]],['align','对齐',[['center','居中'],['left','左对齐'],['right','右对齐']]]]){const label=document.createElement('label');label.append(name);const input=document.createElement('select');for(const [value,title] of values){const option=document.createElement('option');option.value=value;option.textContent=title;input.append(option);}input.value=bubble[field]||(field==='direction'?'horizontal':'center');bubble[field]=input.value;input.addEventListener('change',()=>{bubble[field]=input.value;textReviewChanged();});label.append(input);format.append(label);}
    const sizeLabel=document.createElement('label');sizeLabel.append('字号');const size=document.createElement('input');size.type='number';size.min='6';size.max='512';size.step='0.5';size.value=String(bubble.fontSize||28);bubble.fontSize=Number(size.value);size.setAttribute('aria-label',`气泡 ${index+1} 字号`);size.addEventListener('input',()=>{bubble.fontSize=Number(size.value);textReviewChanged();});sizeLabel.append(size);format.append(sizeLabel);card.append(format);
    const details=document.createElement('details');details.className='text-review-box-details';const summary=document.createElement('summary');summary.textContent='调整文字框／气泡框位置';details.append(summary);const help=document.createElement('p');help.textContent='相对原始局部图的 0–1000 坐标：X、Y 是左上角，W、H 是宽高。气泡框包含完整边缘和尾巴，文字框须位于气泡框内。';details.append(help);
    for(const [field,title] of [['box','文字框'],['bubbleBox','气泡框']]){const caption=document.createElement('strong');caption.textContent=title;details.append(caption);const fields=document.createElement('div');fields.className='text-review-coordinates';for(const [at,name] of ['X','Y','W','H'].entries()){const label=document.createElement('label');label.append(name);const input=document.createElement('input');input.type='number';input.min=at<2?'0':'1';input.max='1000';input.step='1';input.value=String(bubble[field]?.[at]??0);input.setAttribute('aria-label',`气泡 ${index+1} ${title} ${name}`);input.addEventListener('input',()=>{bubble[field][at]=input.value===''?NaN:Number(input.value);textReviewChanged();});label.append(input);fields.append(label);}details.append(fields);}card.append(details);list.append(card);
  }
  updateTextReviewButtons();
}
function mergeTextReviewSelection(ids=[...textReviewState.selected]){
  try{textReviewState.draft.bubbles=mergeTextReviewBubbles(textReviewState.draft.bubbles,ids);textReviewState.selected=new Set([ids[0]]);textReviewChanged();renderTextReviewBubbles();}catch(error){textReviewMessage(error.message,true);}
}
function adoptTextReviewDraft(draft){textReviewState.draft=copyTextReviewDraft(draft);textReviewState.dirty=false;textReviewState.selected=new Set();renderTextReviewBubbles();renderTextReviewOverlay();}
async function textReviewJSON(jobId,suffix='',body){
  const response=await fetch(`/repair/api/jobs/${encodeURIComponent(jobId)}/text-review${suffix}`,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),data=await response.json();
  if(!response.ok)throw new Error(data.error||'识字草稿操作失败');return data;
}
async function openTextReview(task=state.job){
  if(!task||textReviewState.busy)return;persistTextReviewLocal();const review=textReviewState,request=++review.request;Object.assign(review,{jobId:task.id,epoch:state.pageEpoch,draft:null,dirty:false,selected:new Set(),localConflict:null,refinePending:task.automation?.status==='refining_text',zoom:1,busy:true});
  $('text-review-title').textContent=`${taskRegionName(task)} · 校对原文`;$('text-review-bubbles').replaceChildren();$('text-review-overlay').replaceChildren();$('text-review-image').src=`/repair/jobs/${encodeURIComponent(task.id)}/crop.png`;$('text-review-image-space').style.width='100%';$('text-review-zoom').textContent='100%';if(!$('text-review-dialog').open)$('text-review-dialog').showModal();syncQuickRepair();textReviewMessage('正在读取原始局部图和识字草稿…');updateTextReviewButtons();
  try{const draft=await textReviewJSON(task.id);if(request!==review.request||review.jobId!==task.id||!$('text-review-dialog').open)return;adoptTextReviewDraft(draft);let saved;try{saved=localTextReviewDraft(JSON.parse(localStorage.getItem(textReviewLocalKey(task.id))||'null'),draft);}catch{}
    if(saved?.sameRevision){review.draft=saved.draft;review.dirty=true;renderTextReviewBubbles();renderTextReviewOverlay();textReviewMessage('已恢复本机未保存的校对内容。请对照原图确认后再生成。');}
    else if(saved){review.localConflict=saved.draft;textReviewMessage('服务端草稿已更新；可以查看新结果，或点击“恢复本机未保存草稿”保留之前的修改。',true);}
    else textReviewMessage(draft.status!=='draft'?'本任务的原文已确认。此处显示已确认内容，图片生成进度请查看任务列表。':review.refinePending?'Codex 正在查看原图复核疑字，请等待结果。':`识字草稿已就绪（${draft.engine?.name||draft.engine?.id||draft.engine||'识字引擎'}）。请逐字核对，删除假识别，并检查气泡框。`);
  }catch(error){if(request===review.request)textReviewMessage(error.message,true);}finally{if(request===review.request){review.busy=false;updateTextReviewButtons();}}
}
async function saveTextReviewDraft(){
  const review=textReviewState,error=validateTextReviewBubbles(review.draft?.bubbles);if(error)throw new Error(error);const draft=await textReviewJSON(review.jobId,'/draft',{revision:review.draft.revision,bubbles:review.draft.bubbles});
  review.localConflict=null;adoptTextReviewDraft(draft);try{localStorage.removeItem(textReviewLocalKey(review.jobId));}catch{}return draft;
}
async function performTextReviewAction(action){
  const review=textReviewState;if(review.busy||!review.draft||review.refinePending)return;const error=validateTextReviewBubbles(review.draft.bubbles);if(error)return textReviewMessage(error,true);const request=review.request,id=review.jobId;review.busy=true;updateTextReviewButtons();
  try{
    if(action==='save'){await saveTextReviewDraft();textReviewMessage('校对草稿已保存到本地任务目录，重新打开可继续编辑。');return;}
    if(action==='refine'){
      if(review.dirty)await saveTextReviewDraft();const result=await textReviewJSON(id,'/refine',{revision:review.draft.revision});if(request!==review.request||id!==review.jobId)return;const task=state.tasks.get(id);if(task&&result.automation)task.automation=result.automation;review.refinePending=true;textReviewMessage('已提交 Codex 复核。正在读取原始局部图，可能需要等待；结果返回后请继续校对。');
    }else if(action==='confirm'){
      const result=await textReviewJSON(id,'/confirm',{revision:review.draft.revision,bubbles:review.draft.bubbles});if(request!==review.request||id!==review.jobId)return;const task=state.tasks.get(id);if(task&&result.automation)task.automation=result.automation;review.dirty=false;try{localStorage.removeItem(textReviewLocalKey(id));}catch{}$('text-review-dialog').close();toast('原文已确认，已加入图片生成队列。');
    }
    renderTasks();refreshTaskPanel();updateButtons();void poll();
  }catch(error){if(request===review.request)textReviewMessage(error.message+' 校对内容已保留，请检查后重试。',true);persistTextReviewLocal();}
  finally{if(request===review.request){review.busy=false;updateTextReviewButtons();}}
}
async function pollTextReview(){
  const review=textReviewState;if(!$('text-review-dialog').open||!review.draft||review.busy||review.polling)return;if(review.epoch!==state.pageEpoch){persistTextReviewLocal();$('text-review-dialog').close();return;}
  const task=state.tasks.get(review.jobId);if(!review.refinePending&&task?.automation?.status!=='refining_text')return;review.polling=true;const request=review.request,id=review.jobId;
  try{const draft=await textReviewJSON(id);if(request!==review.request||id!==review.jobId||!$('text-review-dialog').open)return;
    if(draft.revision!==review.draft.revision){if(review.dirty){review.localConflict=copyTextReviewDraft(review.draft);persistTextReviewLocal();}adoptTextReviewDraft(draft);review.refinePending=false;textReviewMessage('Codex 复核结果已返回。请再次对照原图检查，确认后再生成。');}
    else if(task?.automation?.status!=='refining_text'){review.refinePending=false;textReviewMessage(task?.automation?.message||'复核已结束，原草稿保留。请检查文字或重新复核。',task?.automation?.status==='failed');}
  }catch(error){if(request===review.request)textReviewMessage(error.message+' 本机草稿保留，正在等待重新连接。',true);}finally{review.polling=false;updateTextReviewButtons();}
}
const statusLabels={recognition_queued:'等待识字',recognizing_text:'识字中',awaiting_text_review:'待校对原文',refining_text:'复核疑字中',waiting:'待返回',queued:'排队中',running:'处理中',ready:'接回中',receiving:'接回中',review:'待确认',awaiting_result_review:'待确认',accepted:'已采用',receive_failed:'生成完成，接回失败',failed:'失败',cancelled:'已取消',discarded:'已放弃',archived:'历史任务',completed:'接回中'};
function renderTasks(){renderRegions();}
function locateFrame(box,outputSpace=false){
  if(!box||!state.width)return;let left=0,right=stage.clientWidth;const bounds=stage.getBoundingClientRect(),inspector=$('repair-inspector'),tools=$('floating-tools');
  for(const panel of [inspector,tools]){if(panel.hidden)continue;const b=panel.getBoundingClientRect();if(b.bottom<bounds.top||b.top>bounds.bottom)continue;if((b.left+b.right)/2>bounds.left+bounds.width/2)right=Math.min(right,b.left-bounds.left-16);else left=Math.max(left,b.right-bounds.left+16);}
  if(right-left<160){left=0;right=stage.clientWidth;}const anchorX=(left+right)/2,anchorY=stage.clientHeight/2;
  state.zoom=Math.max(.00001,Math.min(state.zoom,(right-left-48)/box.width,(stage.clientHeight-64)/box.height));state.panX=anchorX-(box.x+box.width/2)*state.zoom-(stage.clientWidth-state.width*state.zoom)/2;state.panY=anchorY-(outputSpace?box.y+box.height/2:sourceY(box.y+box.height/2))*state.zoom-(stage.clientHeight-displayHeight()*state.zoom)/2;render();
}

function locateTask(task){
  locateFrame(task.frame||task.crop);if(task.layerId&&!state.pointer)layers.select(task.layerId);render();
}
function focusTaskPanel(task){
  state.job=task;state.result=task.resultImage||null;state.preview=task.layerId?true:null;state.aiLayerId=task.layerId||null;state.invalidAlignment=false;state.resultVersion=task.resultVersion||'';
  $('job-panel').hidden=false;$('result-panel').hidden=false;$('current-task-status').textContent=statusLabels[taskStatus(task)]||'';$('job-id').textContent=task.id;$('job-folder').textContent=task.folder;$('guide-download').href=`/repair/jobs/${task.id}/guide.png`;
  const alignment=task.alignment||{x:0,y:0,scale:100,scope:'crop',feather:task.feather||0};
  for(const [id,key] of [['offset-x','x'],['offset-y','y'],['patch-scale','scale'],['result-scope','scope'],['result-feather','feather']])$(id).value=String(alignment[key]);
  $('generated-preview').hidden=!task.result; if(task.result)$('generated-preview-image').src=`/repair/jobs/${task.id}/${task.result.name}?v=${encodeURIComponent(task.result.version)}`;
  $('alignment').hidden=!task.resultImage||task.decision==='discarded';refreshTaskPanel();updateButtons();
}
function refreshTaskPanel(){
  const task=state.job;if(!task)return;
  const status=taskStatus(task);$('current-task-status').textContent=statusLabels[status]||status;$('job-state').textContent=`${taskRegionName(task)} · ${statusLabels[status]||status} · ${task.label?.slice(0,32)||'局部修复'}`;
  const visualReview=task.automation?.requiresVisualReview&&status!=='accepted';$('result-notice').classList.toggle('warning',!!task.receiveError||['failed','cancelled','awaiting_result_review'].includes(status)||visualReview);
  $('result-notice').textContent=task.receiveError||(isTextReviewTask(task)?task.automation?.message||(status==='awaiting_text_review'?'识字草稿已就绪。请校对原文和定位框，确认后才生成图片。':'正在读取原图建立识字草稿，完成后请先校对。'):status==='review'?'此任务已接回独立图层，可检查后采用；继续框选不会影响它。':status==='accepted'?'此任务已采用，可在图层中继续调整。':autoRunning(task)?(task.earlyTextReceived?'原文文字层已就绪，可在图层列表编辑；等待图片返回时暂时隐藏。'+(task.automation?.message||''):task.automation?.message||'后台正在处理此任务，可以继续圈选并提交下一处。'):task.automation?.message||'等待此任务的返回图。可拖入、粘贴，或保存到对应任务目录。');
  $('open-text-review').hidden=!canOpenTextReview(task);
  // A review-flagged result is kept unpublished; the person may still take it without a new generation.
  $('accept-attempt').hidden=!hasReviewableAttempt(task);$('accept-attempt').disabled=!!task.accepting;$('open-text-review').textContent=status==='refining_text'?'查看复核进度／校对原文':'校对原文';
  $('attempt-preview-links').hidden=$('accept-attempt').hidden;
  const attemptQuery=`?attempt=${encodeURIComponent(task.automation?.attemptId||'')}`;
  $('attempt-preview-background').href=`/repair/api/jobs/${task.id}/attempt-preview/repaired${attemptQuery}`;
  $('attempt-preview-background').textContent=task.separateBubble?'查看这次背景':'查看去字结果';
  $('attempt-preview-bubbles').href=`/repair/api/jobs/${task.id}/attempt-preview/bubbles${attemptQuery}`;
  $('attempt-preview-bubbles').hidden=!task.separateBubble;
  if(status==='receive_failed')$('result-notice').textContent=`生成已完成，接回图层失败：${task.receiveError}。原生图片保留，可重新读取或接回，无需重新生图。`;
  if(visualReview&&!task.receiveError&&!['failed','cancelled','awaiting_result_review'].includes(status))$('result-notice').textContent=task.automation?.reviewNotice||'两张原生图已返回，需要检查背景是否干净、透明气泡的底色与边缘是否完整；确认后再采用。'+(task.automation?.needsTextReview?' 本轮原文未能可靠读取，请手工添加文字。':'');
  if(status==='awaiting_result_review')$('result-notice').textContent=reviewAttemptNotice(task);
  $('result-notice').title=task.automation?.message||'';
  $('download-page').hidden=task.automation?.status!=='completed'||!!task.regionId;$('download-page').href=`/repair/jobs/${task.id}/repaired_page.png`;$('download-patch').hidden=!task.automation?.savedPath;$('download-patch').href=`/repair/jobs/${task.id}/patch.png`;
}
function releaseTaskAssets(){
 const keep=new Set([state.job?.id,layers.active?.jobId]);for(const task of state.tasks.values())if(!keep.has(task.id)&&!task.receiving&&!task.assetsPending){if(task.cropImage){task.cropImage.width=task.cropImage.height=1;}delete task.cropImage;delete task.rawMask;delete task.resultImage;taskMaskCache.delete(task);}
}
async function loadTaskAssets(task,{crop=false}={}){
 if(task.rawMask&&(!crop||task.cropImage))return;
 if(task.assetsPending){await task.assetsPending;if(task.rawMask&&(!crop||task.cropImage))return;}
 task.assetsPending=(async()=>{
  if(!task.rawMask){const maskImage=await decodeImage(`/repair/jobs/${task.id}/mask.png`),box=task.crop;if(maskImage.naturalWidth!==box.width||maskImage.naturalHeight!==box.height)throw new Error('任务选区尺寸不一致');const maskCanvas=canvas(box.width,box.height),c=maskCanvas.getContext('2d',{willReadFrequently:true});c.drawImage(maskImage,0,0);const pixels=c.getImageData(0,0,box.width,box.height);task.rawMask=new Uint8ClampedArray(box.width*box.height);for(let i=0;i<task.rawMask.length;i++)task.rawMask[i]=255-pixels.data[i*4+3];maskCanvas.width=maskCanvas.height=1;}
  if(crop&&!task.cropImage){const image=await decodeImage(`/repair/jobs/${task.id}/crop.png`);task.cropImage=canvas(task.crop.width,task.crop.height);task.cropImage.getContext('2d').drawImage(image,0,0);}
 })();try{await task.assetsPending;}finally{delete task.assetsPending;}
}
async function focusTask(id){
  const task=state.tasks.get(id);if(!task)return;
  const request=(state.taskFocusRequest||0)+1;state.taskFocusRequest=request;const epoch=state.pageEpoch;focusTaskPanel(task);releaseTaskAssets();renderTasks();
  try{await layers.ensureLayer(layers.layers.find(layer=>layer.id===task.layerId));await loadTaskAssets(task,{crop:true});if(epoch!==state.pageEpoch||request!==state.taskFocusRequest){releaseTaskAssets();return;}focusTaskPanel(task);if(task.layerId&&!task.resultImage&&task.result){task.resultImage=await decodeImage(`/repair/jobs/${task.id}/${task.result.name}?v=${encodeURIComponent(task.result.version)}`);if(epoch!==state.pageEpoch||request!==state.taskFocusRequest||state.job?.id!==id){releaseTaskAssets();return;}state.result=task.resultImage;}renderTasks();render();}
  catch(error){if(epoch===state.pageEpoch&&request===state.taskFocusRequest)toast(error.message||'任务读取失败',true);}
}
async function cancelTask(task){
  if(task.starting){task.cancelRequested=true;toast('此任务提交完成后会立即取消，其他任务继续处理。');return;}
  try{const response=await fetch(`/repair/api/jobs/${task.id}/cancel`,{method:'POST'});if(!response.ok)throw new Error('取消请求未送达');toast('已请求取消此任务，其他任务继续处理。');}
  catch(error){toast(error.message,true);}
}
function acceptTask(task){
  if(!task.layerId||task.decision==='discarded')return;
  task.decision='accepted';state.revision++;if(!state.history.some(item=>item.id===task.id))state.history.push({layerId:task.layerId,label:task.label?.slice(0,30)||'AI 修复图层',id:task.id,time:new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})});rememberTask(task);updateHistory();renderTasks();refreshTaskPanel();toast('已采用此任务，保留为独立 AI 图层。');
}
async function discardTask(task){
  if(layers.layers.find(layer=>layer.id===task.layerId)?.locked)return toast('图层已锁定，请先解锁',true);
  const before=task.layerId?editorSnapshot():null;
  const layer=layers.layers.find(item=>item.id===task.layerId),region=state.regions.find(item=>item.id===task.regionId||item.jobId===task.id),wasChosen=!!region&&chosenRegionLayer(region,layers.layers)?.jobId===task.id;if(layer)task.layerBackup=layerBackup(layer,task.decision);
  if(taskHasPendingWork(task))await cancelTask(task);
  task.textLayerBackup=layers.layers.filter(layer=>layer.originJobId===task.id).map(layer=>layers.projectLayer(layer));task.decision='discarded';layers.layers=layers.layers.filter(layer=>layer.originJobId!==task.id);task.autoTextReceived=false;if(task.layerId)layers.remove(task.layerId,true);task.layerId=null;state.history=state.history.filter(item=>item.id!==task.id);state.revision++;rememberTask(task);
  if(wasChosen){const previous=restorePreviousVersion(region,layers.layers,state.tasks.values(),task.id);normalizeRepairVersions(state.regions,layers.layers);if(previous&&state.activeRegionId===region.id){layers.select(previous.id);const previousTask=state.tasks.get(previous.jobId);if(previousTask)focusTaskPanel(previousTask);}}if(state.job?.id===task.id)closeJob();updateHistory();renderTasks();if(before)rememberStep(before,'移除 AI 修复图层');toast('已放弃此处修改，其他任务不受影响。');
}
async function restoreTask(task){
  if(!task.result)return toast('此任务尚未保存返回图',true);if(regionDeleted(task.regionId,regionMarkers()))return toast('请先在已删除选区中恢复这个选区',true);
  task.decision=undefined;task.resultVersion='';rememberTask(task);
  if(await receiveTaskResult(task)){
    const layer=layers.layers.find(item=>item.id===task.layerId),backup=task.layerBackup;
    if(layer&&backup){for(const key of ['x','y','scale','scaleX','scaleY','scaleMode','angle','skewX','opacity','visible','locked','userMaskModified','feather'])if(backup[key]!==undefined)layer[key]=backup[key];for(const [key,encoded] of [['maskCanvas',backup.mask],['baseMaskCanvas',backup.baseMask],['maskEditsCanvas',backup.maskEdits]])if(encoded)layer[key]=copyCanvas(await decodeImage(encoded));delete layer.maskedCache;task.decision=backup.decision==='accepted'?'accepted':undefined;const region=contentRegion(layer,state.regions);if(region)region.locked=!!layer.locked;layers.update();}
    rememberTask(task);renderTasks();refreshTaskPanel();toast('已从保存的返回图恢复修改，无需重新生成。');
  }
}
function taskMessage() {
  const pictures=['crop.png（未标注的原始局部）',...(state.job.referenceFiles||[]).map(file=>`${file}（物体外观参考图）`),...(state.job.annotationFile?['annotation.png（标注图片，圈画和文字说明需要修改哪里）']:['guide.png（圈选位置图片）'])];
  return `请处理这个本地局部修图任务：\n${state.job.folder}\n\n读取 prompt.txt，并查看这些图片：\n${pictures.join('\n')}\n\n按要求修图，保留原始局部的构图与宽高比，不把标注线条、文字或圈选标记画到结果中。将修改后的完整局部图保存为这个目录中的 repaired.png。我的补图工作台正在等待，会自动按原坐标与人工选区拼回预览。`;
}

async function restoreRecentJob(){
  if(state.loading||state.creating)return;
  try{
  const response=await fetch('/repair/api/jobs'),jobs=await response.json();if(!response.ok)throw new Error('本地任务读取失败');const request=jobs[0];if(!request)throw new Error('还没有保存过本地修图任务');
    if(!belongsToEditor(request,state.editorKey,state.page?.metadata.id)){
      if(request.sourceId){state.loading=true;busy(true,'恢复漫画与后台任务…');const res=await fetch(`/repair/api/sources/${request.sourceId}`);if(!res.ok)throw new Error('原漫画读取失败');await loadPage(await res.json());}
      else{await loadImage(`/repair/jobs/${request.id}/base.png`,request.sourceName);resetTasks(request.editorKey||`legacy:${request.id}`);}
    }
    mergeTask(state.tasks,request,state.taskNotes);await focusTask(request.id);renderTasks();toast('已恢复任务，仍可继续框选新的修改区域。');
  }catch(error){toast(error.message||'任务恢复失败',true);}finally{state.loading=false;busy(false);updateButtons();}
}
async function copyText(text, success) {
  try { await navigator.clipboard.writeText(text); toast(success); }
  catch { toast('剪贴板不可用，请从任务文件中复制。', true); }
}
function download(url, name) { const link = document.createElement('a'); link.href = url; link.download = name; link.click(); }
async function copyCrop() {
  if (!state.job) return;
  try { await loadTaskAssets(state.job,{crop:true});const blob = await new Promise(resolve => state.job.cropImage.toBlob(resolve, 'image/png')); await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]); toast('局部图已复制，可以粘贴到 GPT。'); }
  catch { download(`/repair/jobs/${state.job.id}/crop.png`, `${state.job.id}-crop.png`); toast('浏览器未允许复制图片，已改为下载局部图。'); }
}
async function receiveEarlyTaskText(task){
  if(!canReceiveEarlyText(task)||regionDeleted(task.regionId,regionMarkers())||!state.regions.some(region=>region.id===task.regionId)||state.loading||state.creating||state.pointer)return false;
  const epoch=state.pageEpoch;
  await ensureLayerFonts(task.earlyText.layers);
  if(epoch!==state.pageEpoch||state.loading||state.creating||state.pointer||regionDeleted(task.regionId,regionMarkers())||!canReceiveEarlyText(task))return false;
  const region=state.regions.find(item=>item.id===task.regionId),offsetY=task.coordinateSpace==='output'&&task.earlyText.frame&&region?region.frame.y-task.earlyText.frame.y:taskLayoutOffset(task);
  const before=editorSnapshot(),receipt=addEarlyTextLayers(layers.layers,task,task,{offsetY});
  if(!receipt.received)return false;
  Object.assign(task,receipt.note);rememberTask(task);
  if(receipt.added.length){state.revision++;layers.update();rememberStep(before,'识别原文并建立文字图层');toast('原文文字层已建立，可在图层列表编辑；图片仍在生成中。');}
  return true;
}

async function receiveTaskResult(task,url,version=task.result?.version||'',{record=true}={}){
  if(task.receiving||task.decision==='discarded'||regionDeleted(task.regionId,regionMarkers())||state.loading||state.creating||state.pointer)return false;
  const epoch=state.pageEpoch;task.receiving=true;renderTasks();
  try{
    await loadTaskAssets(task);const image=await decodeImage(url||`/repair/jobs/${task.id}/${task.result.name}?v=${encodeURIComponent(version)}`);
    if(epoch!==state.pageEpoch||task.decision==='discarded'||regionDeleted(task.regionId,regionMarkers()))return false;
    // A mouse stroke may have started while the files were being read. Defer attachment.
    if(state.pointer||state.loading||state.creating)return false;
    await layers.ensureLayer(layers.layers.find(layer=>layer.id===task.layerId));if(epoch!==state.pageEpoch||task.decision==='discarded'||regionDeleted(task.regionId,regionMarkers())||state.pointer||state.loading||state.creating)return false;task.resultImage=image;task.alignment=task.alignment||{x:0,y:0,scale:100,scope:image.naturalWidth===state.width&&image.naturalHeight===state.height?'original':'crop',feather:task.feather||0};
    const companions=task.textLayerBackup||[...(task.result?.bubbleLayers||[]).map(l=>({...l,image:`/repair/jobs/${task.id}/${l.imageFile}?v=${encodeURIComponent(version)}`})),...(task.result?.editableText||[])];
    const textResult=task.result?.editableText||[];await ensureLayerFonts(companions);
    const prepared=await Promise.all(companions.map(async settings=>({settings,bitmap:settings.type==='image'?copyCanvas(await decodeImage(settings.image)):null})));task.preparedCompanions=prepared;if(epoch!==state.pageEpoch||state.pointer||state.loading||state.creating||task.decision==='discarded')return false;
    applyTaskPatch(task,record);task.resultVersion=version;task.receiveError='';rememberTask(task);
    if(state.job?.id===task.id)focusTaskPanel(task);
    toast(`“${task.label?.slice(0,20)||'局部修复'}”已接回图层，可继续编辑。`);return true;
  }catch(error){if(epoch===state.pageEpoch){task.receiveError=error.message||'返回图片接回失败';task.resultVersion=version;rememberTask(task);toast(task.receiveError,true);}return false;}
  finally{delete task.preparedCompanions;task.receiving=false;releaseTaskAssets();if(epoch===state.pageEpoch){renderTasks();refreshTaskPanel();updateButtons();}}
}
function taskMask(task,feather){
 const cached=taskMaskCache.get(task),key=String(feather)+':'+(task.featherMode||'');if(cached?.raw===task.rawMask&&cached.key===key)return cached.mask;
 const soften=task.featherMode==='gaussian'?gaussianMask:featherMask,data=soften(task.rawMask,task.crop.width,task.crop.height,feather),mask=canvas(task.crop.width,task.crop.height),ctx=mask.getContext('2d'),pixels=ctx.createImageData(mask.width,mask.height);for(let i=0;i<data.length;i++)pixels.data.set([255,255,255,data[i]],i*4);ctx.putImageData(pixels,0,0);taskMaskCache.set(task,{raw:task.rawMask,key,mask});return mask;
}
function featherTarget(){
  const selected=state.selectionTarget==='layer'?layers.active:null;
  const region=selected?state.regions.find(item=>item.id===selected.regionId||(selected.jobId&&item.jobId===selected.jobId)):activeRegion();
  const layer=selected||(region?chosenRegionLayer(region,layers.layers):null);
  return{region,layer,task:layer?.jobId?state.tasks.get(layer.jobId):null,key:layer?`layer:${layer.id}`:region?`region:${region.id}`:''};
}
function updateFeatherControls(){
  const {region,layer,task}=featherTarget(),input=$('feather'),generated=layer?.type==='image'&&!!layer.jobId;
  input.disabled=state.loading||state.creating||!generated||!canEditLayer(layer,region);
  const value=generated?(layer.feather??task?.alignment?.feather??region?.feather??task?.feather??0):0;
  if(document.activeElement!==input){input.value=String(value);$('feather-value').textContent=`${input.value} px`;}
  $('feather-status').textContent=generated?`${region?.name||layer.name} · 生成图层边缘羽化${layer.locked?'，请先解锁':'，调节后自动显示当前效果'}。0 为硬边。`:'选中已生成的图片图层后，可调整边缘羽化。';
}
async function updateGeneratedFeather(){
  const target=featherTarget(),{region,layer,task,key}=target;if(!layer)return false;
  if(!canEditLayer(layer,region))throw new Error('生成图层或链接选框已锁定，请先解锁');
  if(!task)throw new Error('正在读取生成图层的任务，请稍后再调整羽化');
  const value=Number($('feather').value),epoch=state.pageEpoch,request=Symbol();state.featherRequest=request;
  const valid=()=>epoch===state.pageEpoch&&state.featherRequest===request&&featherTarget().key===key&&layers.layers.includes(layer)&&canEditLayer(layer,region);
  await layers.ensureLayer(layer);await loadTaskAssets(task);if(!valid())return false;
  if(!layer.maskCanvas){if(!task.resultImage)task.resultImage=await decodeImage(`/repair/jobs/${task.id}/${task.result?.name||'repaired.png'}`);if(!valid())return false;task.alignment=task.alignment||{x:0,y:0,scale:100,scope:'crop',feather:task.feather||0};applyTaskPatch(task,false);}
  const old=layer.baseMaskCanvas||taskMask(task,layer.feather??task.alignment?.feather??task.feather??0);
  layers.replaceMaskBase(layer,taskMask(task,value),old);layer.feather=value;task.alignment={x:0,y:0,scale:100,scope:'crop',...task.alignment,feather:value};
  if(region)region.feather=value;if(state.job?.id===task.id)$('result-feather').value=String(value);
  state.before=false;setShow('current');rememberTask(task);layers.update();state.revision++;return true;
}

function taskLayoutOffset(task){const region=state.regions.find(r=>r.id===task.regionId);return task.coordinateSpace==='output'&&region&&task.frame?region.frame.y-task.frame.y:0;}
function applyTaskPatch(task,record=true){
  const before=record?editorSnapshot():null;
  const {crop,rawMask,resultImage:image}=task,settings=task.alignment;
  if(!image)return;
  const {scale,x:dx,y:dy,feather}=settings;
  if(!Number.isFinite(scale)||scale<10||scale>400||!Number.isFinite(dx)||!Number.isFinite(dy)||Math.abs(dx)>2400||Math.abs(dy)>2400||!Number.isFinite(feather)||feather<0||feather>64)throw new Error('微调值超出范围');
  const full=settings.scope==='original',desired=full?task.original:crop;
  if(aspectMismatch(image.naturalWidth,image.naturalHeight,desired))throw new Error(`返回图 ${image.naturalWidth} × ${image.naturalHeight} 的比例不一致，请微调后接回或重新生成`);
  const patch=canvas(crop.width,crop.height),pctx=patch.getContext('2d'),ratio=Math.min(desired.width/image.naturalWidth,desired.height/image.naturalHeight)*scale/100,drawWidth=image.naturalWidth*ratio,drawHeight=image.naturalHeight*ratio;
  pctx.drawImage(image,(desired.width-drawWidth)/2+dx-(full?crop.x:0),(desired.height-drawHeight)/2+dy-(full?crop.y:0),drawWidth,drawHeight);

  const soften=task.featherMode==='gaussian'?gaussianMask:featherMask,feathered=soften(rawMask,crop.width,crop.height,feather),maskCanvas=canvas(crop.width,crop.height),maskContext=maskCanvas.getContext('2d'),maskData=maskContext.createImageData(crop.width,crop.height);
  for(let i=0;i<feathered.length;i++)maskData.data.set([255,255,255,feathered[i]],i*4);maskContext.putImageData(maskData,0,0);
  const prior=layers.layers.find(layer=>layer.id===task.layerId),priorY=prior?.y,preserveMask=prior?.userMaskModified&&prior.maskCanvas,oldMask=prior?.baseMaskCanvas||taskMask(task,prior?.feather??task.feather??0);
  const number=[...state.tasks.keys()].sort().indexOf(task.id)+1,layer=layers.addImage(patch,crop.x,crop.y,task.region?.name||`AI 修复 ${number} · ${task.label?.slice(0,20)||'局部修复'}`,task.layerId||(task.regionId?`ai-${task.id}`:null),{select:false,jobId:task.id,jobOrder:task.orderAt||task.createdAt,mask:preserveMask||maskCanvas});layer.y=priorY??crop.y+taskLayoutOffset(task);layer.layoutVersion=2;if(task.coordinateSpace==='output')layer.coordinateSpace='output';layers.replaceMaskBase(layer,maskCanvas,oldMask);layer.feather=feather;layer.regionId=task.regionId;const linkedRegion=state.regions.find(item=>item.id===task.regionId||item.jobId===task.id);if(linkedRegion){linkedRegion.feather=feather;if(shouldActivateReceivedVersion(linkedRegion,task)){linkedRegion.versionPinned=false;linkedRegion.selectedVersionJobId=task.id;}}task.layerId=layer.id;completeCompanions(layers.layers,task.preparedCompanions||[],task,layer,{offsetY:taskLayoutOffset(task),fromBackup:!!task.textLayerBackup});if(task.preparedCompanions?.length)task.autoTextReceived=true;task.baseRevision=task.sourceRevision;state.revision++;layers.update();if(record){layer.locked=true;const region=state.regions.find(region=>region.id===task.regionId);if(region)region.locked=true;rememberStep(before,'接回并锁定 AI 修复图层');}

}
function renderPreview(){
  const task=state.job;if(!task?.resultImage)return;if(layers.layers.find(layer=>layer.id===task.layerId)?.locked)return;
  beginPropertyEdit('alignment');task.alignment={x:Number($('offset-x').value),y:Number($('offset-y').value),scale:Number($('patch-scale').value),scope:$('result-scope').value,feather:Number($('result-feather').value)};
  try{applyTaskPatch(task,false);state.invalidAlignment=false;state.preview=true;state.aiLayerId=task.layerId;rememberTask(task);renderTasks();refreshTaskPanel();render();}
  catch(error){state.invalidAlignment=true;toast(error.message,true);refreshTaskPanel();}
}
async function importResult(file){
  const task=state.job;if(!task)return toast('从上方选区列表选择要接回的一项',true);
  if(taskHasPendingWork(task))return toast('此任务正在处理或等待原文校对，请完成当前任务或先取消',true);
  if(task.decision==='discarded')return toast('此任务已放弃，请创建新任务',true);
  if(!file||!/^image\/(png|jpeg|webp)$/.test(file.type))return toast('返回图支持 PNG、JPG 或 WebP',true);
  const epoch=state.pageEpoch,url=URL.createObjectURL(file);
  const received=await receiveTaskResult(task,url);URL.revokeObjectURL(url);if(!received||epoch!==state.pageEpoch)return;
  try{const c=canvas(task.resultImage.naturalWidth,task.resultImage.naturalHeight);c.getContext('2d').drawImage(task.resultImage,0,0);const response=await fetch(`/repair/api/jobs/${task.id}/result`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({image:c.toDataURL('image/png')})}),saved=await response.json();if(!response.ok)throw new Error(saved.error);task.resultVersion=saved.version;rememberTask(task);}
  catch(error){toast(`图层已接回，但返回图保存失败：${error.message}`,true);}
}
function closeJob(){
  state.taskFocusRequest=(state.taskFocusRequest||0)+1;state.job=null;state.preview=null;state.result=null;state.resultVersion='';state.before=false;state.aiLayerId=null;state.invalidAlignment=false;
  $('job-panel').hidden=true;$('result-panel').hidden=true;$('download-page').hidden=true;$('download-patch').hidden=true;releaseTaskAssets();renderTasks();updateButtons();render();
}
function updateHistory(){
  $('history-count').textContent=String(editHistory.past.length);$('history-list').replaceChildren();
  for(const [index,step] of [...editHistory.past.entries()].reverse()){const row=document.createElement('div');row.className='history-item';const label=document.createElement('strong'),time=document.createElement('span');label.textContent=step.label;time.textContent=`第 ${index+1} 步 · 可撤销`;row.append(label,time);$('history-list').append(row);}updateButtons();
}
async function sourceHistory(direction){
 if(state.loading||state.creating||state.pointer||state.localProcessing)return;
 for(const key of [...propertyEdits.keys()])finishPropertyEdit(key,'调整图层');
 const step=(direction==='undo'?editHistory.past:editHistory.future).at(-1);if(!step)return;
 const currentSnapshot=editorSnapshot();let rebound;
 state.localProcessing=true;updateButtons();
 try{
  if(step.snapshot.workspaceOperationId){
   currentSnapshot.workspaceOperationId=step.snapshot.workspaceOperationId;
   const response=await requestEmbedded({type:'comic:repair-history',sessionId:embeddedSession?.id,direction,operationId:step.snapshot.workspaceOperationId,panelId:step.snapshot.source?.session?.panelId});rebound=response.session;
  }
  const restored=editHistory[direction](currentSnapshot),past=editHistory.past,future=editHistory.future;
  if(restored.snapshot.source&&restored.snapshot.source.metadata.id!==state.page?.metadata.id){await flushProject();await loadPage(restored.snapshot.source.metadata,restored.snapshot.source.revision);editHistory.past=past;editHistory.future=future;}
  if(rebound){embeddedSession=rebound;configureEmbeddedTarget();}
  restoreEditor(restored.snapshot);setViewMode('edit');scheduleProjectSave();toast(`${direction==='undo'?'已撤销':'已恢复'}：${restored.label}`);
 }catch(error){toast(error.message,true);}finally{state.localProcessing=false;updateButtons();}
}
function undo(){return sourceHistory('undo');}
function redo(){return sourceHistory('redo');}
function setTarget(target) {
  state.target = target;
  for (const id of ['auto','codex','web']) { $(`target-${id}`).classList.toggle('active', id === target); $(`target-${id}`).setAttribute('aria-pressed', String(id === target)); }
  $('target-note').textContent = target === 'auto' ? '提交后继续圈选，后台完成后自动接回图层。' : target === 'codex' ? '生成本地任务后，把任务消息复制到此对话，我可以读取局部图进行修改。' : '复制局部图和修图要求到网页 GPT。生成后将图片粘贴或拖回这里，工具自动拼接。';
  $('copy-job-message').textContent = target === 'codex' ? '复制任务消息' : '复制网页 GPT 修图要求';
  renderRegions();updateButtons(); if (target === 'auto') checkCodex();
}

let online=false;
async function poll(){
  if(state.polling||state.loading)return;state.polling=true;
  const epoch=state.pageEpoch,key=state.editorKey,sourceId=state.page?.metadata.id;
  let serverResponded=false,listReceived=false;
  try{
    const query=sourceId?`sourceId=${sourceId}`:`editorKey=${encodeURIComponent(key||'')}`;
    const response=await fetch(`/repair/api/jobs?${query}`,{signal:AbortSignal.timeout(5000)});serverResponded=true;
    online=true;$('connection-status').textContent='本地服务已连接';$('connection-dot').style.background='#5d9467';
    if(!response.ok){const issue=await response.json().catch(()=>({}));throw new Error(issue.error||`任务列表读取失败（HTTP ${response.status}）`);}
    const data=await response.json();if(!Array.isArray(data))throw new Error('任务列表格式无效');listReceived=true;state.pollingError='';
    if(epoch!==state.pageEpoch||state.loading)return;
    for(const request of data){
      let task;
      try{
      if(!belongsToEditor(request,key,sourceId))continue;
      task=mergeTask(state.tasks,request,state.taskNotes);
      const region=request.regionId&&state.regions.find(region=>region.id===request.regionId);if(region&&region.locked===undefined)region.locked=!!request.automation;
      const legacy=!task.editorKey&&!task.mode;
      const existing=layers.layers.find(layer=>layer.jobId===task.id)||layers.layers.find(layer=>layer.id===task.layerId)||(legacy&&layers.layers.find(layer=>layer.type==='image'&&!layer.jobId&&layer.x===task.crop.x&&layer.y===task.crop.y&&(layer.canvas?.width||layer.imageWidth)===task.crop.width&&(layer.canvas?.height||layer.imageHeight)===task.crop.height));
      if(existing){task.layerId=existing.id;task.baseRevision=task.sourceRevision;if(task.result?.editableText?.length&&[...(task.result?.bubbleLayers||[]),...(task.result?.editableText||[])].every(settings=>layers.layers.some(layer=>layer.id===settings.id&&!layer.autoTextPending))){task.autoTextReceived=true;state.taskNotes[task.id]={...state.taskNotes[task.id],autoTextReceived:true};}if(task.result&&!task.resultVersion&&!task.receiveError){task.resultVersion=task.result.version;state.taskNotes[task.id]={...state.taskNotes[task.id],layerId:existing.id,resultVersion:task.result.version};}}
      else if(task.layerId){task.layerId=null;task.resultVersion='';state.taskNotes[task.id]={...state.taskNotes[task.id],layerId:null,resultVersion:''};}
      if(legacy&&!task.decision&&task.result){if(existing){existing.jobId=task.id;existing.jobOrder=task.createdAt;task.decision='accepted';}else task.decision='archived';rememberTask(task);}
      if(existing&&task.decision==='accepted'&&!state.history.some(item=>item.id===task.id))state.history.push({layerId:existing.id,label:task.label?.slice(0,30)||'AI 修复图层',id:task.id,time:new Date(task.createdAt).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})});
      // A submit saved before a browser refresh still gets dispatched exactly once by the server.
      if(task.mode==='auto'&&!task.automation&&!task.starting&&task.decision!=='discarded'&&!regionDeleted(task.regionId,regionMarkers()))void startAutomation(task);
      if(state.sectionMode&&!state.pointer&&!state.loading&&recoverUntrackedTaskLayout(task,layers.layers,state.regions,editorSections(),state.height)){syncLayoutSelection();layers.update();scheduleProjectSave();}
      if(canReceiveEarlyText(task)&&!state.creating&&!state.pointer)await receiveEarlyTaskText(task);
      if(canReceive(task)&&(!task.regionId||state.regions.some(region=>region.id===task.regionId))&&!regionDeleted(task.regionId,regionMarkers())&&!state.creating&&!state.pointer)await receiveTaskResult(task);
      }catch(error){
        if(task){task.receiveError=error.message||'任务结果接回失败';if(task.result?.version)task.resultVersion=task.result.version;rememberTask(task);}
        toast(`任务结果处理失败：${error.message||'请重新读取结果'}，本地服务仍已连接。`,true);
      }
    }
    for(const region of state.regions){const task=currentRegionTask(region,state.tasks.values());if(task)region.jobId=task.id;}
    updateHistory();renderTasks();renderRegions();refreshTaskPanel();updateButtons();void pollTextReview();
  }catch(error){
    if(serverResponded){
      if(epoch!==state.pageEpoch||state.loading)return;
      const message=error.message||'任务状态处理失败';if(state.pollingError!==message)toast(`任务状态读取失败：${message}。本地服务仍已连接。`,true);state.pollingError=message;
      if(!listReceived&&state.job){$('current-task-status').textContent='进度更新失败';$('result-notice').classList.toggle('warning',true);$('result-notice').textContent=`任务进度暂时无法更新：${message}。目前显示上次读取的状态，请重新读取任务；已生成图片仍保存在本机。`;}
    }else{if(online){online=false;toast('本地服务断开，请保持启动窗口运行。',true);}$('connection-status').textContent='本地服务未连接';$('connection-dot').style.background='#d78c62';}
  }
  finally{state.polling=false;void refreshProjects();}
}
let customPrompts=[];
function renderCustomPrompts(){const list=$('custom-prompt-buttons');list.replaceChildren();for(const [index,preset] of customPrompts.entries()){const button=document.createElement('button');button.dataset.customPrompt=String(index);button.textContent=preset.name;button.title=preset.prompt||'尚未填写，点击编辑提示词';button.addEventListener('click',()=>{const region=activeRegion();if(!canEditRepairInstructions(region,state))return;edit('载入自定义提示词',()=>{$('prompt').value=preset.prompt;saveActiveRegion();});updateButtons();});list.append(button);}updateButtons();}
async function loadCustomPrompts(){try{const response=await fetch('/repair/api/prompt-presets'),body=await response.json();if(!response.ok)throw new Error(body.error);customPrompts=body.presets;renderCustomPrompts();}catch(error){toast(error.message||'自定义提示词读取失败',true);}}
$('auto-text').addEventListener('change',()=>setAutoText($('auto-text').checked));
$('generation-mode').addEventListener('change',()=>{if(!canEditQuickRegion())return;const region=activeRegion();region.generationMode=$('generation-mode').value;region.modifiedAt=Date.now();saveActiveRegion();});
$('separate-bubble').addEventListener('change',()=>setSeparateBubble($('separate-bubble').checked));
$('open-text-review').addEventListener('click',()=>void openTextReview());
function openAttemptPreview(event){
  if(event.button>0||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;
  const task=state.job;if(!hasReviewableAttempt(task))return;event.preventDefault();
  const dialog=$('attempt-preview-dialog'),query=`?attempt=${encodeURIComponent(task.automation.attemptId||'')}`;
  $('attempt-preview-title').textContent=`${taskRegionName(task)} · 对照这次生成结果`;$('attempt-preview-status').textContent='';
  const background=`/repair/api/jobs/${task.id}/attempt-preview/repaired${query}`,bubbles=`/repair/api/jobs/${task.id}/attempt-preview/bubbles${query}`;
  for(const [id,url] of [['attempt-compare-original',`/repair/jobs/${task.id}/crop.png`],['attempt-compare-background',background],['attempt-compare-light',bubbles],['attempt-compare-dark',bubbles]]){
    const image=$(id);image.onerror=()=>{$('attempt-preview-status').textContent='图片暂时无法读取；如果已采用或重新生成，请关闭后查看当前结果。';};
    if(id==='attempt-compare-original'||id==='attempt-compare-background'||task.separateBubble)image.src=url;else image.removeAttribute('src');
  }
  for(const figure of dialog.querySelectorAll('[data-bubble-view]'))figure.hidden=!task.separateBubble;
  if(!dialog.open)dialog.showModal();
}
$('attempt-preview-background').addEventListener('click',openAttemptPreview);
$('attempt-preview-bubbles').addEventListener('click',openAttemptPreview);
$('attempt-preview-close').addEventListener('click',()=>$('attempt-preview-dialog').close());
$('attempt-preview-dialog').addEventListener('paste',event=>event.stopPropagation());
$('accept-attempt').addEventListener('click',()=>void acceptFlaggedAttempt());
async function acceptFlaggedAttempt(task=state.job){
  if(!task||task.accepting)return;const epoch=state.pageEpoch;task.accepting=true;refreshTaskPanel();renderRegions();
  try{const response=await fetch(`/repair/api/jobs/${task.id}/accept-attempt`,{method:'POST'}),result=await response.json();if(!response.ok)throw new Error(result.error||'采用失败');task.automation=result.automation;rememberTask(task);if(epoch===state.pageEpoch)toast('已采用这次结果，正在接回图层。');}
  catch(error){if(epoch===state.pageEpoch)toast(error.message||'采用失败',true);}
  finally{task.accepting=false;if(epoch===state.pageEpoch){renderTasks();refreshTaskPanel();updateButtons();}}
}
$('text-review-save').addEventListener('click',()=>void performTextReviewAction('save'));
$('text-review-refine').addEventListener('click',()=>void performTextReviewAction('refine'));
$('text-review-confirm').addEventListener('click',()=>void performTextReviewAction('confirm'));
$('text-review-merge').addEventListener('click',()=>mergeTextReviewSelection());
$('text-review-add').addEventListener('click',()=>{const review=textReviewState;if(!review.draft||review.busy||review.refinePending)return;const id=`bubble-manual-${crypto.randomUUID()}`;review.draft.bubbles.push({id,text:'',box:[300,350,400,300],bubbleBox:[250,250,500,500],fontSize:28,direction:'horizontal',align:'center',uncertain:[]});review.selected=new Set([id]);textReviewChanged();renderTextReviewBubbles();});
$('text-review-restore-local').addEventListener('click',()=>{const review=textReviewState;if(!review.localConflict||review.busy||review.refinePending)return;review.draft.bubbles=structuredClone(review.localConflict.bubbles);review.localConflict=null;textReviewChanged();renderTextReviewBubbles();});
$('text-review-close').addEventListener('click',()=>{if(!textReviewState.busy)$('text-review-dialog').close();});
$('text-review-reload').addEventListener('click',()=>void openTextReview(state.tasks.get(textReviewState.jobId)));
$('text-review-dialog').addEventListener('cancel',event=>{if(textReviewState.busy)event.preventDefault();});
$('text-review-dialog').addEventListener('close',()=>{persistTextReviewLocal();textReviewState.request++;textReviewState.jobId=null;textReviewState.draft=null;textReviewState.refinePending=false;textReviewState.busy=false;syncQuickRepair();});
function setTextReviewZoom(value){textReviewState.zoom=Math.max(.5,Math.min(4,value));$('text-review-image-space').style.width=`${textReviewState.zoom*100}%`;$('text-review-zoom').textContent=`${Math.round(textReviewState.zoom*100)}%`;}
$('text-review-zoom-out').addEventListener('click',()=>setTextReviewZoom(textReviewState.zoom/1.25));
$('text-review-zoom-in').addEventListener('click',()=>setTextReviewZoom(textReviewState.zoom*1.25));
$('text-review-zoom-fit').addEventListener('click',()=>setTextReviewZoom(1));
$('edit-prompt-templates').addEventListener('click',async()=>{if(!customPrompts.length)await loadCustomPrompts();if(customPrompts.length!==4)return;const container=$('prompt-template-fields');container.replaceChildren();for(const [index,preset] of customPrompts.entries()){const field=document.createElement('section');field.className='prompt-template-slot';const label=document.createElement('label');label.textContent=`提示词 ${index+1} · 名称`;const name=document.createElement('input');name.type='text';name.maxLength=20;name.value=preset.name;name.dataset.templateName=String(index);name.setAttribute('aria-label',`提示词${index+1}名称`);label.append(name);const text=document.createElement('textarea');text.rows=3;text.maxLength=12000;text.value=preset.prompt;text.dataset.templatePrompt=String(index);text.setAttribute('aria-label',`提示词${index+1}内容`);field.append(label,text);container.append(field);}$('prompt-template-dialog').showModal();syncQuickRepair();});
$('close-prompt-templates').addEventListener('click',()=>$('prompt-template-dialog').close());
$('save-prompt-templates').addEventListener('click',async()=>{const presets=Array.from({length:4},(_,index)=>({name:document.querySelector(`[data-template-name="${index}"]`).value,prompt:document.querySelector(`[data-template-prompt="${index}"]`).value}));$('save-prompt-templates').disabled=true;try{const response=await fetch('/repair/api/prompt-presets',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({presets})}),body=await response.json();if(!response.ok)throw new Error(body.error);customPrompts=body.presets;renderCustomPrompts();$('prompt-template-dialog').close();toast('四个自定义提示词已保存，点击即可载入修改要求。');}catch(error){toast(error.message||'提示词保存失败',true);}finally{$('save-prompt-templates').disabled=false;}});
document.querySelectorAll('[data-tool]').forEach(button=>button.addEventListener('click',()=>setTool(button.dataset.tool)));
$('prompt').addEventListener('input',saveActiveRegion);
for (const name of ['brush-size', 'context-padding', 'feather']) {
  $(name).addEventListener('input', () => {if(name==='feather')beginPropertyEdit('feather');$({ 'brush-size':'brush-value', 'context-padding':'padding-value', feather:'feather-value' }[name]).textContent = `${$(name).value} px`;if(name==='feather'){if(featherTarget().layer)state.featherPending=updateGeneratedFeather().catch(error=>{updateFeatherControls();toast(error.message,true);});}else if(name!=='brush-size')saveActiveRegion();render();});
}
$('feather').addEventListener('change',async()=>{await state.featherPending;finishPropertyEdit('feather','调整图层边缘羽化');});
for (const id of ['open-image','source-card','welcome-import']) $(id).addEventListener('click', () => $('image-input').click());
$('image-input').addEventListener('change', async event => { await loadFile(event.target.files[0]); event.target.value = ''; });
$('result-input').addEventListener('change', async event => { await importResult(event.target.files[0]); event.target.value = ''; });
$('restore-job').addEventListener('click', restoreRecentJob);
$('clear-selection').addEventListener('click',()=>{state.activeRegionId=null;clearSelection();writeRegionFields(null);renderRegions();});
function applySelectionRatio(ratio,before=editorSnapshot()){
  if(state.pointer||state.selectingRegion)return;const region=activeRegion();if(region&&(!canEditRegion(region,chosenRegionLayer(region,layers.layers))||autoRunning(state.tasks.get(region.jobId)))){$('selection-ratio').value=region.ratio||'1:1';toast('选区已锁定或正在处理，请先解锁后再切换比例',true);return;}
  $('selection-ratio').value=ratio;
  if(region){const box=ratioFrameAtCenter(region.frame,ratio,state.width,selectionHeight());const source=frameMoveSource(region);try{applyRegionFrame(region,source,box);}catch(error){$('selection-ratio').value=region.ratio||'1:1';toast(error.message,true);return;}setViewMode('edit');boundsChanged();saveActiveRegion();state.revision++;rememberStep(before,'切换选框比例');}
  else {$('current-ratio').textContent=ratio;render();}
  state.ratioBefore=null;renderRegions();render();
}
function cycleSelectionRatio(){const ratios=['1:1','16:9','9:16'],value=ratios[(ratios.indexOf($('selection-ratio').value)+1)%ratios.length];applySelectionRatio(value);}
$('selection-ratio').addEventListener('focus',()=>{state.ratioBefore=editorSnapshot();});$('selection-ratio').addEventListener('change',()=>applySelectionRatio($('selection-ratio').value,state.ratioBefore));
$('page-position').addEventListener('input',()=>jumpToPage(Number($('page-position').value)));$('page-top').addEventListener('click',()=>jumpToPage(0));$('page-bottom').addEventListener('click',()=>jumpToPage(Number($('page-position').max)));

// Imported files become ordinary editable image layers in the current project.
$('add-image-layer').addEventListener('click',()=>$('image-layer-file').click());
$('image-layer-file').addEventListener('change',async event=>{
  const files=[...event.target.files];event.target.value='';if(!files.length||!state.width||state.loading||state.creating||state.exporting)return;
  const epoch=state.pageEpoch;state.loading=true;busy(true,'正在导入图片图层…');updateButtons();let added=0;
  try{
    for(const file of files){
      const image=await decodeLayerFile(file);if(epoch!==state.pageEpoch)break;
      const placement=imagePlacement(image.naturalWidth,image.naturalHeight,state.width,displayHeight(),viewCenter()),bitmap=canvas(image.naturalWidth,image.naturalHeight);bitmap.getContext('2d').drawImage(image,0,0);
      edit('导入图片图层',()=>{saveActiveRegion();state.activeRegionId=null;clearSelection();writeRegionFields(null);const layer=layers.addImage(bitmap,placement.x,placement.y,file.name||'导入图片');Object.assign(layer,{scale:placement.scale,imported:true,locked:false});state.selectionTarget='layer';layerSelection.single('layer:'+layer.id);layers.update();});added++;
    }
    if(added){setTool('layer-move');await selectContentLayer(layers.activeId,{locate:true});toast('已导入 '+added+' 个图片图层，可移动、缩放和绘制蒙版');}
  }catch(error){toast(error.message||'图片图层导入失败',true);}
  finally{state.loading=false;busy(false);scheduleProjectSave();updateButtons();render();}
});

const checker=canvas(16,16),checkerContext=checker.getContext('2d');checkerContext.fillStyle='#fafafa';checkerContext.fillRect(0,0,16,16);checkerContext.fillStyle='#dfe2e0';checkerContext.fillRect(0,0,8,8);checkerContext.fillRect(8,8,8,8);const transparentPattern=ctx.createPattern(checker,'repeat');
function makeSection(start,height,length=height){return{id:crypto.randomUUID(),name:'漫画图层',type:'section',sourceStart:start,sourceHeight:height,height:length,width:state.width,x:0,y:0,scale:1,angle:0,opacity:1,visible:true,locked:false};}
function renumberSections(){layers.layers.filter(layer=>layer.type==='section').forEach((layer,index)=>layer.name='漫画图层 '+(index+1));}
function migratePageGaps(){
 if(!state.pageGaps.length)return;
 const sections=pageSegments(state.height,state.pageGaps).map((item,index)=>makeSection(item.start,item.end-item.start,item.end-item.start+(state.pageGaps[index]?.gap||0)));
 layers.layers.unshift(...sections);state.pageGaps=[];state.sectionMode=true;renumberSections();layers.update();
}
function insideOutput(event){const b=view.getBoundingClientRect(),t=transform(),x=event.clientX-b.left,y=rawDisplayPoint(event);return x>=t.x&&x<=t.x+state.width*state.zoom&&y>=0&&y<=displayHeight();}
function rawDisplayPoint(event){const bounds=view.getBoundingClientRect(),t=transform();return (event.clientY-bounds.top-t.y)/state.zoom;}
function locateSection(layer){
 const segment=sectionSegments(editorSections()).find(item=>item.id===layer.id);if(!segment)return;
 jumpToPage(Math.max(0,segment.outputStart+layer.height-(stage.clientHeight-160)/state.zoom));
}
function syncLayoutSelection(){state.linkCache.clear();const region=activeRegion();if(region){state.frame={...region.frame};state.selectionOrigin={...(region.origin||region.frame)};invalidateSelectionEncoding();}state.revision++;}
function setSectionLength(layer,height){
 if(!layer||layer.type!=='section'||layer.locked)return;
 const priorSections=editorSections();
 const next=Math.max(Math.max(1,layer.sourceHeight),Math.min(1000000,Math.round(height))),oldHeight=displayHeight(),before=layer.height;layer.height=next;
 try{normalizeSections(editorSections(),state.height);}catch(error){layer.height=before;toast(error.message,true);return;}
 reflowOutputObjects(layers.layers,state.regions,priorSections,editorSections());syncLayoutSelection();
 state.panY+=(displayHeight()-oldHeight)*state.zoom/2;layers.update();render();
}
function drawSectionControls(t){
 if(state.show==='original')return;
 const layer=layers.active,segment=!['extract'].includes(state.tool)&&layer?.type==='section'&&state.selectionTarget==='layer'&&sectionSegments(editorSections()).find(item=>item.id===layer.id);
 if(segment){const top=t.y+segment.outputStart*state.zoom,bottom=top+layer.height*state.zoom;ctx.save();ctx.strokeStyle=layer.locked?'#809087':'#dc6947';ctx.lineWidth=2;ctx.strokeRect(t.x,top,state.width*state.zoom,layer.height*state.zoom);ctx.beginPath();ctx.moveTo(t.x,bottom);ctx.lineTo(t.x+state.width*state.zoom,bottom);ctx.stroke();ctx.fillStyle=ctx.strokeStyle;ctx.fillRect(t.x+state.width*state.zoom/2-26,bottom-5,52,10);ctx.font='600 12px sans-serif';ctx.fillText(layer.name+' · 拖动底边调整透明长度',t.x+10,Math.max(18,Math.min(stage.clientHeight-20,bottom-12)));ctx.restore();}
}
for(const [id,delta] of [['section-grow',100],['section-shrink',-100]])$(id).addEventListener('click',()=>{const layer=layers.active;if(layer?.type==='section'&&!layer.locked){edit('调整漫画图层透明长度',()=>setSectionLength(layer,layer.height+delta));scheduleProjectSave();}});
$('section-reset').addEventListener('click',()=>{const layer=layers.active;if(layer?.type==='section'&&!layer.locked){edit('还原漫画图层长度',()=>setSectionLength(layer,Math.max(1,layer.sourceHeight)));scheduleProjectSave();}});
$('section-up').addEventListener('click',()=>{edit('漫画图层上移',()=>{const priorSections=editorSections();layers.reorder(1);renumberSections();reflowOutputObjects(layers.layers,state.regions,priorSections,editorSections());syncLayoutSelection();layers.update();});scheduleProjectSave();});
$('section-down').addEventListener('click',()=>{edit('漫画图层下移',()=>{const priorSections=editorSections();layers.reorder(-1);renumberSections();reflowOutputObjects(layers.layers,state.regions,priorSections,editorSections());syncLayoutSelection();layers.update();});scheduleProjectSave();});
$('section-delete').addEventListener('click',()=>{state.selectionTarget='layer';deleteSelected();scheduleProjectSave();});


function syncBackgroundDimensions(){for(const layer of layers.layers)if(layer.type==='background'){layer.width=state.width;layer.height=displayHeight();}}
function sourceLayerTiles(){return layers.serializeForSource(visibleSegments().map(item=>({...item,width:state.width})));}
function migrateLooseLayers(){
 let changed=false;const segments=visibleSegments().map(item=>({...item,width:state.width}));
 for(const layer of layers.layers){if(!['image','paint','text'].includes(layer.type)||layer.coordinateSpace)continue;
  if(layer.jobId||layer.regionId){layer.coordinateSpace='source';changed=true;continue;}
  if(layer.type==='paint'&&state.sectionMode)layers.migratePaintToOutput(layer,segments);else{if(state.sectionMode)layer.y=sectionSourceY(layer.y,editorSections());layer.coordinateSpace='output';}changed=true;
 }
 if(changed){state.didMigrate=state.page?.metadata.id;layers.update();}
}
$('add-background-layer').addEventListener('click',()=>{
 edit('新建底色图层',()=>{saveActiveRegion();state.activeRegionId=null;clearSelection();writeRegionFields(null);const layer={id:crypto.randomUUID(),name:'底色图层',type:'background',coordinateSpace:'background',color:'#ffffff',width:state.width,height:displayHeight(),x:0,y:0,scale:1,angle:0,opacity:1,visible:true,locked:false};layers.layers.unshift(layer);layers.activeId=layer.id;state.selectionTarget='layer';layerSelection.single('layer:'+layer.id);layers.update();});
 setViewMode('edit');revealProperties(['background-details']);scheduleProjectSave();
});

function syncBackgroundControls(layer){
 const g=layer.gradient||{},type=g.type||'solid',values={'background-fill':type,'background-color':layer.color||'#ffffff','background-end-color':g.endColor||'#000000','background-angle':g.angle??90,'background-start-opacity':Math.round((g.startOpacity??1)*100),'background-end-opacity':Math.round((g.endOpacity??1)*100),'background-opacity':Math.round(layer.opacity*100)};
 for(const [id,value] of Object.entries(values)){if(document.activeElement!==$(id))$(id).value=String(value);$(id).disabled=!!layer.locked;}$('background-delete').disabled=!!layer.locked;$('background-gradient-controls').hidden=type==='solid';$('background-angle-field').hidden=type!=='linear';
 const preview=$('background-preview'),color=layer.color||'#ffffff',end=g.endColor||'#000000';preview.style.opacity=String(layer.opacity);preview.style.background=type==='solid'?color:type==='radial'?`radial-gradient(circle,${color},${end})`:`linear-gradient(${(Number(g.angle??90)+90)%360}deg,${color},${end})`;
}
for(const id of ['background-fill','background-color','background-end-color','background-angle','background-start-opacity','background-end-opacity','background-opacity'])$(id).addEventListener('input',()=>{
 const layer=layers.active;if(layer?.type!=='background'||layer.locked)return;beginPropertyEdit('background');layer.color=$('background-color').value;layer.opacity=Number($('background-opacity').value)/100;const type=$('background-fill').value;
 if(type==='solid')delete layer.gradient;else layer.gradient={type,endColor:$('background-end-color').value,angle:Math.max(0,Math.min(360,Number($('background-angle').value)||0)),startOpacity:Number($('background-start-opacity').value)/100,endOpacity:Number($('background-end-opacity').value)/100};layers.update();state.revision++;
});
for(const id of ['background-fill','background-color','background-end-color','background-angle','background-start-opacity','background-end-opacity','background-opacity'])for(const type of ['change','blur'])$(id).addEventListener(type,()=>finishPropertyEdit('background','调整底色与渐变'));

$('background-delete').addEventListener('click',()=>{state.selectionTarget='layer';void deleteSelected();});


function updateExtractPreview(){
 const preview=$('extract-preview'),actions=$('extract-actions'),box=state.extractBox,visible=!!box&&!!state.width&&state.tool==='extract';preview.hidden=!visible;actions.hidden=!visible||state.pointer?.mode==='extract'||box.width<2||box.height<2||state.loading;if(!visible)return;
 const t=transform(),left=t.x+box.x*state.zoom,top=t.y+box.y*state.zoom;
 Object.assign(preview.style,{left:left+'px',top:top+'px',width:box.width*state.zoom+'px',height:box.height*state.zoom+'px'});
 $('extract-size').textContent=box.width+' × '+box.height+' px';const width=actions.offsetWidth||360;
 actions.style.left=Math.max(10,Math.min(stage.clientWidth-width-10,left))+'px';actions.style.top=Math.max(10,Math.min(stage.clientHeight-78,top+box.height*state.zoom+10))+'px';
}
function cancelExtraction(){state.extractBox=null;updateExtractPreview();stage.focus({preventScroll:true});}
function confirmExtraction(){const rect=state.extractBox;if(rect?.width>=2&&rect.height>=2&&!state.pointer&&!state.loading)void extractPicture({...rect});}
$('extract-confirm').addEventListener('click',confirmExtraction);$('extract-cancel').addEventListener('click',cancelExtraction);
async function extractPicture(rect){
 if(!state.page||state.loading||state.creating)return;const epoch=state.pageEpoch,before=editorSnapshot();state.loading=true;busy(true,'正在剪切画面为独立图层…');updateButtons();
 try{
  await ensureLayerFonts(layers.layers);await layers.ensureForSerialization({windows:layers.extractionWindows(rect,visibleSegments())});syncBackgroundDimensions();
  const response=await fetch('/repair/api/sources/'+state.page.metadata.id+'/extract-layer',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sourceRevision:state.page.revision,rect,layers:layers.serializeForExtraction(rect,visibleSegments()),sectionMode:state.sectionMode,pageSections:editorSections(),pageGaps:state.pageGaps})}),result=await response.json();if(!response.ok)throw new Error(result.error||'画面剪切失败');if(epoch!==state.pageEpoch)return;
  const image=await decodeImage(result.image),bitmap=canvas(image.naturalWidth,image.naturalHeight);bitmap.getContext('2d').drawImage(image,0,0);
  if(!state.sectionMode){layers.layers.unshift(makeSection(0,state.height));state.sectionMode=true;state.pageGaps=[];renumberSections();}
  for(const segment of sectionSegments(editorSections())){
   const begin=Math.max(rect.y,segment.outputStart),end=Math.min(rect.y+rect.height,segment.outputStart+segment.end-segment.start);if(begin>=end)continue;
   const layer=layers.layers.find(item=>item.id===segment.id),hole={x:rect.x,y:begin-segment.offset,width:rect.width,height:end-begin};layer.sourceCutouts=[...(layer.sourceCutouts||[]),hole];
  }
  for(const layer of layers.layers){if(layer.coordinateSpace!=='output'||layer.type==='section'||layer.type==='background'||!layer.visible)continue;const b=layers.bounds(layer);if(!b||b.x>=rect.x+rect.width||b.x+b.width<=rect.x||b.y>=rect.y+rect.height||b.y+b.height<=rect.y)continue;const inverse=invertMatrix(layerMatrix(layer)),polygon=[[rect.x,rect.y],[rect.x+rect.width,rect.y],[rect.x+rect.width,rect.y+rect.height],[rect.x,rect.y+rect.height]].map(([x,y])=>mapPoint(inverse,{x,y}));layer.cutoutPolygons=[...(layer.cutoutPolygons||[]),polygon];}
  saveActiveRegion();state.activeRegionId=null;clearSelection();writeRegionFields(null);const layer=layers.addImage(bitmap,rect.x,rect.y,'剪切画面 '+(layers.layers.filter(item=>item.extracted).length+1),null,{imageRef:result.image});Object.assign(layer,{coordinateSpace:'output',extracted:true,strokeWidth:0,strokeColor:'#111111',locked:false});state.selectionTarget='layer';layerSelection.single('layer:'+layer.id);state.extractBox=null;state.revision++;rememberStep(before,'自由选框剪切画面');setTool('layer-move',{reveal:false});await selectContentLayer(layer.id,{locate:false});toast('已剪切成独立图层，可移动、缩放、调透明度和描边');
 }catch(error){toast(error.message||'画面剪切失败',true);}finally{state.loading=false;busy(false);scheduleProjectSave();updateButtons();render();}
}
for(const [id,key] of [['image-stroke-width','strokeWidth'],['image-stroke-color','strokeColor']])$(id).addEventListener('input',()=>{
 const layer=layers.active;if(layer?.type!=='image'||layer.locked)return;const value=key==='strokeWidth'?Number($(id).value):$(id).value;if(key==='strokeWidth'&&(!Number.isFinite(value)||value<0||value>200))return;beginPropertyEdit('stroke');layer[key]=value;layers.update();state.revision++;
});
for(const id of ['image-stroke-width','image-stroke-color'])for(const event of ['change','blur'])$(id).addEventListener(event,()=>finishPropertyEdit('stroke','调整图片描边'));

setFontWeightSelection($('text-weight'),$('text-font').value,400);
$('add-paint-layer').addEventListener('click',()=>edit('新建透明图层',()=>{const layer=layers.addPaint();layerSelection.single(layerSelectionKey(layer));state.selectionTarget='layer';setTool('paint');}));
$('layer-up').addEventListener('click',()=>{try{edit('图层上移',()=>layers.reorder(1));}catch(error){toast(error.message,true);}});$('layer-down').addEventListener('click',()=>{try{edit('图层下移',()=>layers.reorder(-1));}catch(error){toast(error.message,true);}});$('layer-delete').addEventListener('click',()=>{state.selectionTarget='layer';deleteSelected();});
for(const [id,key,factor] of [['layer-opacity','opacity',.01],['layer-x','x',1],['layer-y','y',1],['layer-scale','scale',.01],['layer-angle','angle',1]])$(id).addEventListener('input',()=>{if(!canEditLayer(layers.active,contentRegion(layers.active,state.regions)))return;beginPropertyEdit('layer-properties');let value=Number($(id).value);if(!Number.isFinite(value))return;if(key==='opacity')value=Math.max(0,Math.min(100,value));if(key==='scale'){value=Math.max(10,Math.min(400,value));const image=layers.active.type==='text'?layers.textCanvas(layers.active):layers.active.canvas;scaleLayerAtCenter(layers.active,value,image?.width||layers.active.imageWidth||512,image?.height||layers.active.imageHeight||512);}else layers.active[key]=value*factor;layers.update();state.revision++;});
for(const id of textControlIDs)$(id).addEventListener('input',()=>{if(id==='text-font')setFontWeightSelection($('text-weight'),$('text-font').value,$('text-weight').value);updateTextFontPreview();if(layers.active?.type==='text'&&canEditLayer(layers.active,contentRegion(layers.active,state.regions))){beginPropertyEdit('text');const settings=textSettings();try{renderTextCanvas(settings,canvas);Object.assign(layers.active,settings);layers.update();state.revision++;}catch(error){toast(error.message,true);}}});
for(const id of ['paint-size','paint-opacity'])$(id).addEventListener('input',()=>{$(id+'-value').textContent=$(id).value+(id==='paint-size'?' px':'%');});

for(const id of ['layer-opacity','layer-x','layer-y','layer-scale','layer-angle'])$(id).addEventListener('change',()=>finishPropertyEdit('layer-properties','调整图层'));
for(const id of textControlIDs)$(id).addEventListener('change',()=>finishPropertyEdit('text','修改文字样式'));
function showReferences(persist=true){$('reference-list').replaceChildren();for(const reference of state.references){const card=document.createElement('div');card.className='reference-card';const image=document.createElement('img');image.src=reference.url;image.alt=reference.name||'修图参考图';const remove=document.createElement('button');remove.textContent='×';remove.title='从本次修图移除，保留在图库';remove.disabled=!canEditRepairInstructions(activeRegion(),state);remove.addEventListener('click',()=>{if(!canEditRepairInstructions(activeRegion(),state))return;state.references=state.references.filter(item=>item.id!==reference.id);showReferences();});card.append(image,remove);$('reference-list').append(card);}localStorage.setItem('patch-selected-references',JSON.stringify(state.references));if(persist)saveActiveRegion();syncQuickRepair();}
async function uploadReference(file){
  if(activeRegion()?.submitting)return toast('此选区正在提交，请稍候',true);if(state.creating||state.loading)return toast('图片正在打开，请稍候');const region=activeRegion(),epoch=state.pageEpoch,source=state.page?.metadata.id;if(region)region.referenceLoading=(region.referenceLoading||0)+1;updateButtons();renderRegions();
  try{const response=await fetch('/repair/api/references',{method:'POST',headers:{'Content-Type':file.type||'image/png','X-Source-Name':encodeURIComponent(file.name||'粘贴参考图')},body:file}),data=await response.json();if(!response.ok)throw new Error(data.error);
    if(region){region.references=[...(region.references||[]),data];region.modifiedAt=Date.now();if(epoch===state.pageEpoch){if(state.activeRegionId===region.id){state.references=structuredClone(region.references);showReferences(false);}scheduleProjectSave();}else if(source){const res=await fetch(`/repair/api/sources/${source}/project`),saved=await res.json(),target=saved.regions?.find(item=>item.id===region.id);if(target){target.references=region.references;target.modifiedAt=region.modifiedAt;await fetch(`/repair/api/sources/${source}/project`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(saved)});}}}
    else if(epoch===state.pageEpoch){state.references.push(data);showReferences(false);}if(epoch===state.pageEpoch)toast('参考图已保存到所选选区，可从图库复用。');
  }finally{if(region)region.referenceLoading=Math.max(0,(region.referenceLoading||1)-1);if(epoch===state.pageEpoch){renderRegions();updateButtons();}}
}
$('unified-layer-list').addEventListener('pointerdown',()=>{state.referencePasteFocus=false;state.resultPasteFocus=false;});
$('reference-area').addEventListener('pointerdown',()=>{state.referencePasteFocus=true;});stage.addEventListener('pointerdown',()=>{state.referencePasteFocus=false;});
$('reference-area').addEventListener('pointerdown',()=>{state.resultPasteFocus=false;});stage.addEventListener('pointerdown',()=>{state.resultPasteFocus=false;});$('import-result').addEventListener('pointerdown',()=>{state.referencePasteFocus=false;state.resultPasteFocus=true;});
async function pasteReference(target=$('reference-area')){target.focus();state.referencePasteFocus=true;state.resultPasteFocus=false;try{const items=await navigator.clipboard.read();let found=false;for(const item of items){const type=item.types.find(type=>type.startsWith('image/'));if(type){await uploadReference(await item.getType(type));found=true;}}if(!found)toast('剪贴板里没有图片。复制图片后在此处按 Ctrl+V。');}catch{toast('在参考图区按 Ctrl+V，即可粘贴图片。');}}
$('paste-reference').addEventListener('click',()=>pasteReference());
let referenceLibraryCache=[],libraryDeletedMode=false,libraryManagementMode=false,libraryDeleteChecked=new Set(),libraryMutating=false,librarySignature='';
async function openReferenceLibrary(){parent.postMessage({type:'comic:open-library',target:'repair'},location.origin);}
function toggleLibraryManagementSelection(id){if(libraryDeleteChecked.has(id))libraryDeleteChecked.delete(id);else libraryDeleteChecked.add(id);renderReferenceLibrary();}
function chooseReference(reference){
  if(!canEditRepairInstructions(activeRegion(),state))return;
  const chosen=state.references.some(item=>item.id===reference.id);
  if(chosen)state.references=state.references.filter(item=>item.id!==reference.id);
  else if(state.librarySelectionMode==='single')state.references=[reference];
  else state.references.push(reference);
  showReferences();renderReferenceLibrary();
}
async function mutateLibrary(ids,restore=libraryDeletedMode){
  if(!ids.length||libraryMutating)return;libraryMutating=true;renderReferenceLibrary();
  try{const response=await fetch(`/repair/api/references/${restore?'restore':'delete'}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ids})}),result=await response.json();if(!response.ok)throw new Error(result.error||'图库修改失败');for(const id of ids)libraryDeleteChecked.delete(id);toast(restore?`已恢复 ${ids.length} 张图库图片`:`已从参考图库删除 ${ids.length} 张图片，可恢复。`);await openReferenceLibrary(libraryDeletedMode,true);}
  catch(error){toast(error.message,true);}finally{libraryMutating=false;renderReferenceLibrary();}
}
function renderReferenceLibrary(){
  syncQuickRepair();
  const managing=libraryManagementMode||libraryDeletedMode,locked=!!activeRegion()&&!canEditRepairInstructions(activeRegion(),state);
  const signature=JSON.stringify([referenceLibraryCache.map(ref=>ref.id),libraryDeletedMode,managing,[...libraryDeleteChecked],state.references.map(ref=>ref.id),state.librarySelectionMode,locked,libraryMutating,state.loading,state.creating]);if(librarySignature===signature)return;librarySignature=signature;
  $('library-tools').hidden=false;$('reference-library').replaceChildren();$('reference-library').hidden=false;
  $('reference-selection-mode').hidden=managing;$('reference-selection-mode').disabled=locked||libraryMutating;
  $('reference-manage-library').textContent=managing?'完成管理':'管理图库';$('reference-manage-library').hidden=libraryDeletedMode;$('reference-manage-library').disabled=libraryMutating;
  $('reference-show-deleted').textContent=libraryDeletedMode?'返回参考图库':'已删除／恢复';$('reference-show-deleted').disabled=libraryMutating;
  $('reference-selection-count').textContent=managing?`已勾选 ${libraryDeleteChecked.size} 张图库图片`:`已选用 ${state.references.length} 张`;
  $('reference-delete-selected').hidden=!managing;$('reference-delete-selected').textContent=libraryDeletedMode?'恢复勾选图片':'删除勾选图片';$('reference-delete-selected').disabled=!libraryDeleteChecked.size||libraryMutating;
  $('reference-library-help').textContent=managing?'勾选要管理的图库图片；管理图库不改动各图层已选用的参考图。':locked?'此选区正在提交，请稍后选用参考图。':'点击图片选用；每张图片下方的“删除”用于清理参考图库。';
  if(!referenceLibraryCache.length)$('reference-library').textContent=libraryDeletedMode?'没有已删除参考图':'没有参考图，粘贴或上传一次后可重复使用。';
  for(const reference of referenceLibraryCache){
    const card=document.createElement('div');card.className='reference-library-card';card.dataset.referenceId=reference.id;
    const button=document.createElement('button');button.className='reference-use';const selected=managing?libraryDeleteChecked.has(reference.id):state.references.some(ref=>ref.id===reference.id);button.classList.toggle('selected',selected);button.disabled=libraryMutating||(!managing&&(locked||state.loading||state.creating));button.setAttribute('aria-label',`${managing?'管理图库图片':'选用参考图'}：${reference.name}`);button.setAttribute('aria-pressed',String(selected));
    const image=document.createElement('img');image.src=reference.url;image.alt=reference.name;const name=document.createElement('span');name.textContent=reference.name;name.title=reference.name;const check=document.createElement('span');check.className='library-check';check.textContent=selected?'✓':'';button.append(image,name,check);button.addEventListener('click',()=>managing?toggleLibraryManagementSelection(reference.id):chooseReference(reference));card.append(button);
    if(managing){const checkbox=document.createElement('input');checkbox.className='library-manage-check';checkbox.type='checkbox';checkbox.checked=libraryDeleteChecked.has(reference.id);checkbox.disabled=libraryMutating;checkbox.setAttribute('aria-label',`勾选图库图片：${reference.name}`);checkbox.addEventListener('change',()=>toggleLibraryManagementSelection(reference.id));card.append(checkbox);}
    const action=document.createElement('button');action.className='reference-library-action';action.textContent=libraryDeletedMode?'恢复':'删除';action.setAttribute('aria-label',`${libraryDeletedMode?'恢复图库图片':'从图库删除'}：${reference.name}`);action.disabled=libraryMutating;action.addEventListener('click',()=>mutateLibrary([reference.id]));card.append(action);$('reference-library').append(card);
  }
}
$('reference-library-button').addEventListener('click',()=>openReferenceLibrary(false));$('reference-show-deleted').addEventListener('click',()=>openReferenceLibrary(!libraryDeletedMode));$('reference-manage-library').addEventListener('click',()=>{libraryManagementMode=!libraryManagementMode;libraryDeleteChecked.clear();renderReferenceLibrary();});
$('reference-selection-mode').addEventListener('change',()=>{if(!canEditRepairInstructions(activeRegion(),state))return;state.librarySelectionMode=$('reference-selection-mode').value;if(state.librarySelectionMode==='single'&&state.references.length>1){state.references=state.references.slice(0,1);showReferences();}renderReferenceLibrary();});
$('reference-delete-selected').addEventListener('click',()=>mutateLibrary([...libraryDeleteChecked]));

$('add-reference').addEventListener('click',()=>$('reference-input').click());
$('reference-input').addEventListener('change',async event=>{for(const file of [...event.target.files]){try{await uploadReference(file);}catch(error){toast(error.message,true);}}event.target.value='';});
$('zoom-out').addEventListener('click', () => zoom(1 / 1.2)); $('zoom-in').addEventListener('click', () => zoom(1.2)); $('fit-image').addEventListener('click', fit);
$('show-original').addEventListener('click', () => setShow('original')); $('show-current').addEventListener('click', () => setShow('current'));
$('hold-before').addEventListener('pointerdown', event => { $('hold-before').setPointerCapture(event.pointerId); state.before = true; if (!state.job) setShow('original');else render(); });
for (const type of ['pointerup','pointercancel','lostpointercapture']) $('hold-before').addEventListener(type, () => { state.before = false; setShow('current'); });
$('create-job').addEventListener('click', createJob); $('target-auto').addEventListener('click', () => setTarget('auto')); $('target-codex').addEventListener('click', () => setTarget('codex')); $('target-web').addEventListener('click', () => setTarget('web'));
$('check-codex').addEventListener('click',()=>checkCodex(true));$('submit-reconnect').addEventListener('click',()=>checkCodex(true)); $('retry-auto').addEventListener('click',()=>startAutomation());
$('copy-job-message').addEventListener('click', () => state.job && copyText(state.job.mode === 'codex' ? taskMessage() : state.job.prompt, '修图任务已复制'));
$('copy-folder').addEventListener('click', () => state.job && copyText(state.job.folder, '任务目录已复制'));
$('copy-prompt').addEventListener('click', () => state.job && copyText(state.job.prompt, '修图要求已复制'));
$('copy-crop').addEventListener('click', copyCrop); $('download-crop').addEventListener('click', () => state.job && download(`/repair/jobs/${state.job.id}/crop.png`, `${state.job.id}-crop.png`));
$('import-result').addEventListener('click', () => $('result-input').click());
for(const id of ['offset-x','offset-y','patch-scale','result-scope','result-feather'])$(id).addEventListener('input',renderPreview);
for(const id of ['offset-x','offset-y','patch-scale','result-scope','result-feather'])$(id).addEventListener('change',()=>finishPropertyEdit('alignment','调整 AI 接回位置')); 
$('reset-alignment').addEventListener('click',()=>{$('offset-x').value='0';$('offset-y').value='0';$('patch-scale').value='100';$('result-feather').value=String(state.job?.feather||0);renderPreview();});
$('undo').addEventListener('click',undo);$('redo').addEventListener('click',redo);
function regionEditable(){return canEditRegion(activeRegion(),activeRegion()&&chosenRegionLayer(activeRegion(),layers.layers));}
function selectedRegionControls(){
 const region=activeRegion(),geometryLocked=!!region&&!canEditRegion(region,chosenRegionLayer(region,layers.layers)),instructionBlocked=!!region&&!canEditRepairInstructions(region,state),busy=state.loading||state.creating;
 for(const id of ['prompt','context-padding','open-annotation','add-reference','paste-reference'])$(id).disabled=busy||instructionBlocked;
 $('selection-ratio').disabled=busy||geometryLocked||!!region?.submitting;
 $('open-annotation').disabled=!region||busy||instructionBlocked||!!state.annotationOpening;$('delete-annotation').disabled=!region||busy||instructionBlocked||!!state.annotationOpening;
 $('delete-annotation').title='清空当前选区的标注，可用 Ctrl+Z 撤销';$('annotation-summary').textContent=region?.annotations?.length?'已保存标注图，修改时自动和原始局部图一起发给 AI。':'保存标注后，标注图片会和原始局部图一起发给 AI。';
 $('annotation-preview').hidden=!region?.annotations?.length||!region?.annotationImage;if(region?.annotationImage&&$('annotation-preview-image').getAttribute('src')!==region.annotationImage)$('annotation-preview-image').src=region.annotationImage;
 for(const id of ['offset-x','offset-y','patch-scale','result-scope','result-feather','reset-alignment'])$(id).disabled=!!layers.layers.find(layer=>layer.id===state.job?.layerId)?.locked;selectedLayerControls();if(!$('reference-library').hidden)renderReferenceLibrary();
}
async function viewGenerated(task){
  if(!task)return;try{let url=`/repair/jobs/${task.id}/patch.png`;const response=await fetch(url,{method:'HEAD'});if(!response.ok)url=`/repair/jobs/${task.id}/${task.result?.name||'repaired.png'}`;$('generated-title').textContent=`生成原图 · ${taskRegionName(task)}`;const image=$('generated-image');image.classList.remove('actual-size');image.src=url;$('generated-viewer').showModal();syncQuickRepair();await image.decode();$('generated-size').textContent=`${image.naturalWidth} × ${image.naturalHeight} px · AI 原始返回，未缩放、未羽化、未绘制蒙版`;}catch(error){toast(error.message||'生成原图暂时无法查看',true);}
}
$('generated-viewer').addEventListener('close',()=>syncQuickRepair());$('prompt-template-dialog').addEventListener('close',()=>syncQuickRepair());
$('generated-close').addEventListener('click',()=>$('generated-viewer').close());$('generated-fit').addEventListener('click',()=>$('generated-image').classList.remove('actual-size'));$('generated-actual').addEventListener('click',()=>$('generated-image').classList.add('actual-size'));$('download-patch').addEventListener('click',()=>viewGenerated(state.job));
$('view-annotation').addEventListener('click',async()=>{const region=activeRegion();if(!region?.annotationImage)return;try{$('generated-title').textContent=`标注图 · ${region.name}`;const image=$('generated-image');image.classList.remove('actual-size');image.src=region.annotationImage;$('generated-viewer').showModal();syncQuickRepair();await image.decode();$('generated-size').textContent=`${image.naturalWidth} × ${image.naturalHeight} px · 修改时自动附给 AI，圈画和文字不写入成品`;}catch(error){toast(error.message,true);}});
$('delete-annotation').addEventListener('click',()=>{
  const region=activeRegion();if(!canEditRepairInstructions(region,state)||state.annotationOpening)return;
  edit('删除标注图',()=>{region.annotations=[];delete region.annotationImage;delete region.useAnnotation;region.modifiedAt=Date.now();});scheduleProjectSave();selectedRegionControls();toast('标注图已删除，可以重新圈画；Ctrl+Z 可恢复。');
});
const annotationEditor=new AnnotationEditor({cursor:$('annotation-brush-cursor'),canvas:$('annotation-view'),dialog:$('annotation-dialog'),viewport:$('annotation-viewport'),space:$('annotation-canvas-space'),zoomOut:$('annotation-zoom-out'),zoomFit:$('annotation-zoom-fit'),zoomIn:$('annotation-zoom-in'),toolbar:$('annotation-toolbar'),saveButton:$('annotation-save'),loadingPanel:$('annotation-loading'),loadingText:$('annotation-loading-text'),retryButton:$('annotation-retry'),tool:$('annotation-tool'),color:$('annotation-color'),size:$('annotation-size'),text:$('annotation-text'),fontSize:$('annotation-font-size'),undoButton:$('annotation-undo'),onSave:(marks,image)=>{const region=state.regions.find(item=>item.id===state.annotationRegionId);if(!canEditRepairInstructions(region,state))return;edit('修改位置标注',()=>{region.annotations=marks;region.annotationImage=image;delete region.useAnnotation;region.modifiedAt=Date.now();});scheduleProjectSave();selectedRegionControls();}});
let annotationOpenRequest=0;
async function openAnnotation(){
  const region=activeRegion();if(!canEditRepairInstructions(region,state)||state.annotationOpening)return;
  const epoch=state.pageEpoch,request=++annotationOpenRequest;state.annotationOpening=true;
  annotationEditor.beginLoading();updateButtons();
  const valid=()=>request===annotationOpenRequest&&epoch===state.pageEpoch&&$('annotation-dialog').open&&state.activeRegionId===region.id&&canEditRepairInstructions(region,state);
  try{
    const crop=fixedRatioCrop(region.frame,Math.max(region.padding||0,(region.feather||0)*3),region.ratio,state.width,regionSpaceHeight(region,state.height,displayHeight())),base=canvas(crop.width,crop.height);
    if(state.page&&region.coordinateSpace==='output'){const segments=operationSegments(),windows={output:[crop],source:segments.flatMap(segment=>{const begin=Math.max(crop.y,segment.start+segment.offset),end=Math.min(crop.y+crop.height,segment.end+segment.offset);return begin<end?[{x:crop.x,y:begin-segment.offset,width:crop.width,height:end-begin}]:[];})};await ensureLayerFonts(layers.layers);await layers.ensureForWindows(windows);if(!valid())return;const response=await fetch('/repair/api/sources/'+state.page.metadata.id+'/extract-layer',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sourceRevision:state.page.revision,rect:crop,layers:layers.serializeForExtraction(crop,segments),sectionMode:state.sectionMode,pageSections:editorSections(),pageGaps:state.pageGaps})}),result=await response.json();if(!response.ok)throw new Error(result.error);const image=await decodeImage(result.image);if(!valid())return;base.getContext('2d').drawImage(image,0,0);state.annotationRegionId=region.id;annotationEditor.open(base,crop,region.annotations||[]);return;}
    if(state.page){const page=state.page,image=await page.image(`/repair/api/sources/${page.metadata.id}/region?revision=${page.revision}&x=${crop.x}&y=${crop.y}&width=${crop.width}&height=${crop.height}`);if(!valid())return;base.getContext('2d').drawImage(image,0,0);}
    else base.getContext('2d').drawImage(current,crop.x,crop.y,crop.width,crop.height,0,0,crop.width,crop.height);
    const segments=visibleSegments().map(item=>({...item,width:state.width})),windows={source:[crop],output:segments.map(item=>({x:crop.x,y:Math.max(crop.y,item.start)+item.offset,width:crop.width,height:Math.max(0,Math.min(crop.y+crop.height,item.end)-Math.max(crop.y,item.start))})).filter(item=>item.height>0)};await layers.ensureForWindows(windows);if(!valid())return;layers.drawForSource(base.getContext('2d'),{x:-crop.x,y:-crop.y},1,visibleSegments().map(item=>({...item,width:state.width})));state.annotationRegionId=region.id;annotationEditor.open(base,crop,region.annotations||[]);
  }catch(error){if(valid())annotationEditor.showError(`标注画面读取失败：${error.message||'请重试'}`);}
  finally{if(request===annotationOpenRequest){state.annotationOpening=false;updateButtons();}}
}
$('open-annotation').addEventListener('click',openAnnotation);$('annotation-retry').addEventListener('click',openAnnotation);
$('annotation-dialog').addEventListener('close',()=>{annotationOpenRequest++;state.annotationOpening=false;updateButtons();});

$('annotation-close').addEventListener('click',()=>$('annotation-dialog').close());$('annotation-save').addEventListener('click',()=>annotationEditor.save());$('annotation-undo').addEventListener('click',()=>annotationEditor.undo());$('annotation-clear').addEventListener('click',()=>annotationEditor.clear());
$('layer-scale-mode').addEventListener('change',()=>{if(!canEditLayer(layers.active,contentRegion(layers.active,state.regions)))return;edit('切换缩放方式',()=>{const layer=layers.active;layer.scaleMode=$('layer-scale-mode').value;if(layer.scaleMode==='uniform'){const image=layer.type==='text'?layers.textCanvas(layer):layer.canvas;scaleLayerAtCenter(layer,layerScales(layer).x*100,image?.width||layer.imageWidth||512,image?.height||layer.imageHeight||512);}layers.update();});});
for(const id of ['layer-scale-x','layer-scale-y']){$(id).addEventListener('input',()=>{const layer=layers.active;if(!canEditLayer(layer,contentRegion(layer,state.regions)))return;const x=Number($('layer-scale-x').value),y=Number($('layer-scale-y').value);if(!Number.isFinite(x)||!Number.isFinite(y)||x<10||y<10||x>400||y>400)return;beginPropertyEdit('layer-properties');const image=layer.type==='text'?layers.textCanvas(layer):layer.canvas;resizeLayerAtCenter(layer,x,y,image?.width||layer.imageWidth||512,image?.height||layer.imageHeight||512);layers.update();state.revision++;});$(id).addEventListener('change',()=>finishPropertyEdit('layer-properties','调整独立宽高'));}
$('toggle-layer-lock').addEventListener('click',()=>toggleLayerLock());
async function useMask(mode){const layer=layers.active;if(!layer||layer.type!=='image')return toast('请选择生成的图片图层',true);if(!canEditLayer(layer,contentRegion(layer,state.regions)))return centerStatus('图片或链接选框已锁定，请按 F 解锁');try{await layers.ensureLayer(layer);if(!layer.maskCanvas&&layer.jobId){const task=state.tasks.get(layer.jobId);if(task){await loadTaskAssets(task);if(!task.resultImage){task.resultImage=await decodeImage(`/repair/jobs/${task.id}/${task.result.name}`);task.alignment=task.alignment||{x:0,y:0,scale:100,scope:'crop',feather:task.feather||0};}applyTaskPatch(task,false);}}state.maskMode=mode;state.selectionTarget='layer';setTool('mask',{reveal:false});selectedLayerControls();}catch(error){toast(error.message,true);}}
$('mask-hide').addEventListener('click',()=>useMask('hide'));$('mask-show').addEventListener('click',()=>useMask('show'));$('mask-reset').addEventListener('click',async()=>{try{await layers.ensureLayer(layers.active);edit('蒙版全部显示',()=>layers.resetMask());}catch(error){toast(error.message,true);}});
async function deleteSelected(){
 if(state.loading||state.creating||state.pointer||state.deleting)return;
 const keys=layerSelection.size?layerSelection.keys:[currentLayerSelectionKey()].filter(Boolean),plan=planLayerDeletion(keys,state.regions,layers.layers);
 if(!plan.removed.length)return centerStatus(plan.skipped.length?'所选图层已锁定，先点“解锁所选”再删除':'请先选择图层');
 const before=editorSnapshot(),regionIds=new Set(plan.regionIds),layerIds=new Set(plan.layerIds),tasks=[...state.tasks.values()].filter(task=>regionIds.has(task.regionId)||state.regions.some(region=>regionIds.has(region.id)&&region.jobId===task.id)||layerIds.has(task.layerId));
 state.deleting=true;
 try{
  for(const id of regionIds)markRegionDeleted(id);
  for(const task of tasks){const layer=layers.layers.find(item=>item.id===task.layerId);if(layer)task.layerBackup=layerBackup(layer,task.decision);if(autoRunning(task))await cancelTask(task);task.decision='discarded';task.layerId=null;rememberTask(task);}
  for(const id of regionIds)state.regionMaskCache.delete(id);state.regions=state.regions.filter(region=>!regionIds.has(region.id));const priorSections=editorSections();layers.layers=layers.layers.filter(layer=>!layerIds.has(layer.id)&&!regionIds.has(layer.regionId||layer.originRegionId)&&!tasks.some(task=>task.id===layer.originJobId));if(state.sectionMode){reflowOutputObjects(layers.layers,state.regions,priorSections,editorSections());syncLayoutSelection();}layers.activeId=null;state.activeRegionId=null;layerSelection.clear();clearSelection();writeRegionFields(null);
  if(state.job&&tasks.includes(state.job))closeJob();state.revision++;layers.update();rememberStep(before,'删除所选 '+plan.removed.length+' 个图层');scheduleProjectSave();renderRegions();render();toast('已删除 '+plan.removed.length+' 个所选图层'+(plan.skipped.length?'，'+plan.skipped.length+' 个锁定项保留':'')+'，Ctrl+Z 一次恢复');
 }catch(error){toast(error.message||'所选图层删除失败',true);}finally{state.deleting=false;updateButtons();}
}

$('empty-project').addEventListener('dragover',event=>{event.preventDefault();event.stopPropagation();$('empty-project').classList.add('dragover');});
$('empty-project').addEventListener('dragleave',event=>{if(!$('empty-project').contains(event.relatedTarget))$('empty-project').classList.remove('dragover');});
$('empty-project').addEventListener('drop',event=>{event.preventDefault();event.stopPropagation();$('empty-project').classList.remove('dragover');const file=event.dataTransfer.files[0];if(file)void loadFile(file);});
$('add-project').addEventListener('click',()=>$('image-input').click());
$('import-project-file').addEventListener('click',()=>$('project-file-input').click());
async function saveProjectFile(){
  if(!state.page||state.loading||state.creating||state.exporting||state.pointer)return;
  const sourceId=state.page.metadata.id,epoch=state.pageEpoch;
  state.exporting=true;updateButtons();busy(true,'正在保存可编辑工程…');
  try{
    await flushProject();if(epoch!==state.pageEpoch)throw new Error('项目已切换，请重新保存工程');
    const saved=await requestJSON(`/repair/api/sources/${sourceId}/project-file`,{method:'POST'},{timeoutMs:300000});
    showExportSuccess({...saved,file:saved.path||saved.file},`工程已保存：${saved.path||saved.name}`);
  }catch(error){toast('工程保存失败：'+error.message,true);}
  finally{state.exporting=false;busy(false);updateButtons();}
}
$('save-project-file').addEventListener('click',()=>void saveProjectFile());
async function importProjectFile(file){
  if(!file||state.loading||state.creating||state.exporting||state.pointer)return;
  if(file.size>512*1024*1024)return toast('工程文件超过 512 MB，请减少不需要的任务版本后重新保存',true);
  try{
    await flushProject();
    const response=await fetch('/repair/api/project-files',{method:'POST',headers:{'Content-Type':'application/octet-stream','X-Project-Name':encodeURIComponent(file.name)},body:file}),saved=await response.json();
    if(!response.ok)throw new Error(saved.error||'工程文件无法导入');
    const meta=await requestJSON(`/repair/api/sources/${saved.sourceId}`);await loadPage(meta);await refreshProjects();
    $('project-drawer').hidden=true;$('toggle-projects').setAttribute('aria-expanded','false');toast('工程已导入为新项目，原项目保留。');
  }catch(error){toast('工程导入失败：'+error.message,true);}
  finally{state.creating=false;busy(false);updateButtons();void poll();}
}
$('project-file-input').addEventListener('change',event=>{const file=event.target.files[0];event.target.value='';void importProjectFile(file);});

async function deleteProject(id){try{if(state.page?.metadata.id===id)clearTimeout(projectTimer);const response=await fetch(`/repair/api/sources/${id}/delete`,{method:'POST'}),result=await response.json();if(!response.ok)throw new Error(result.error||'项目删除失败');if(state.page?.metadata.id===id){clearTimeout(projectTimer);state.page.dispose();state.page=null;state.width=0;state.height=0;state.name='';state.extractBox=null;current.width=original.width=selection.width=1;current.height=original.height=selection.height=1;layers.reset();editHistory.clear();propertyEdits.clear();resetTasks(`empty:${crypto.randomUUID()}`);clearSelection();writeRegionFields(null);ctx.clearRect(0,0,view.width,view.height);$('source-name').textContent='未打开漫画';$('source-size').textContent='点击新增项目';$('source-thumb').removeAttribute('src');$('image-info').textContent='点击新增项目';localStorage.removeItem('patch-last-page');}await refreshProjects();const next=state.projects[0];if(!state.width&&next)await openProject(next.id);localStorage.removeItem('patch-tasks:source:'+id);toast('项目已删除，相关文件已清理。');}catch(error){toast(error.message||'项目删除失败',true);}}


function displayStorage(settings){state.storage=settings;$('storage-base').value=settings.baseFolder;$('archive-name').value=settings.folderName;$('storage-path').textContent=settings.directory;$('archive-status').textContent=settings.lastError||'自动保存已开启';}
async function loadStorage(){try{const response=await fetch('/repair/api/storage');if(response.ok)displayStorage(await response.json());}catch{}}
async function storageAction(action){
  if(state.storageBusy)return;state.storageBusy=true;for(const id of ['choose-storage','save-storage','archive-page'])$(id).disabled=true;
  try{await action();}catch(error){$('archive-status').textContent=error.message;toast(error.message||'目录设置未完成',true);}
  finally{state.storageBusy=false;for(const id of ['choose-storage','save-storage','archive-page'])$(id).disabled=false;}
}
const folderPicker=new FolderPicker($('folder-picker-dialog'),{onClose:()=>{$('choose-storage').disabled=!!state.storageBusy;}});
async function saveStorageDirectory(baseFolder){
  $('archive-status').textContent='正在保存目录设置…';
  const settings=await requestJSON('/repair/api/storage',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({baseFolder,folderName:$('archive-name').value.trim()})});
  displayStorage(settings);$('archive-status').textContent='目录已设置，后续结果自动归档。已有工程可点击“归档当前漫画”保存。';toast('保存目录已设置。');
}
$('choose-storage').addEventListener('click',async()=>{
  if(state.storageBusy||$('folder-picker-dialog').open)return;
  $('choose-storage').disabled=true;
  try{const folder=await folderPicker.open($('storage-base').value.trim()||state.storage?.baseFolder||'');if(folder)await storageAction(()=>saveStorageDirectory(folder));else $('archive-status').textContent='已取消选择，原保存目录未改变';}
  catch(error){$('archive-status').textContent=error.message;toast(error.message,true);}
  finally{$('choose-storage').disabled=!!state.storageBusy;}
});
$('save-storage').addEventListener('click',()=>storageAction(()=>saveStorageDirectory($('storage-base').value.trim())));
$('archive-page').addEventListener('click',()=>storageAction(async()=>{
  if(!state.page)throw new Error('请先打开你的漫画图片');$('archive-status').textContent='正在保存工程并归档…';await flushProject();const response=await fetch('/repair/api/storage/archive',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sourceId:state.page.metadata.id})}),saved=await response.json();if(!response.ok)throw new Error(saved.error);$('archive-status').textContent=`已归档：${saved.folder}`;toast('原图、图层工程、任务与修图结果已归档。');
}));
async function exportImage(mode='repaired'){
  if(state.loading||state.creating||state.exporting)return;state.exporting=true;updateButtons();
  const exportedRevision=state.revision,originalExport=mode==='original';$('export-options').open=false;
  try {
    if(!originalExport){await ensureLayerFonts(layers.layers);await layers.ensureForSerialization();}
    const payload=state.page?{sourceId:state.page.metadata.id,sourceRevision:originalExport?0:state.page.revision}:{image:(originalExport?original:current).toDataURL('image/png'),sourceName:state.name};
    payload.sectionMode=!originalExport&&state.sectionMode;payload.pageSections=originalExport?[]:editorSections();payload.pageGaps=originalExport?[]:state.pageGaps;payload.exportMode=mode;payload.layers=originalExport?[]:layers.serialize();
    const response=await fetch('/repair/api/exports',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
    const saved=await response.json();if(!response.ok)throw new Error(saved.error);
    if(!originalExport)state.exportedRevision=exportedRevision;
    if(originalExport){showExportSuccess(saved,'原图已无损保存');return;}
    const pending=[...state.tasks.values()].filter(task=>['queued','running','waiting','receiving','ready'].includes(taskStatus(task))).length;
    showExportSuccess(saved,pending?`已保存成品；还有 ${pending} 项后台任务尚未完成。`:'成品已保存');
  }catch(error){toast(`导出失败：${error.message}`,true);}
  finally{state.exporting=false;updateButtons();}
}
$('export-image').addEventListener('click',()=>exportImage());
$('export-repaired').addEventListener('click',()=>exportImage());
$('export-original').addEventListener('click',()=>exportImage('original'));
for (const element of [stage, $('import-result')]) {
  element.addEventListener('dragover', event => { event.preventDefault(); $('import-result').classList.add('dragover'); });
  element.addEventListener('dragleave', () => $('import-result').classList.remove('dragover'));
  element.addEventListener('drop', async event => { event.preventDefault(); $('import-result').classList.remove('dragover'); const file = event.dataTransfer.files[0]; if (file) { if (state.job) await importResult(file); else await loadFile(file); } });
}
document.addEventListener('paste', async event => {
  if(!state.width)return;
  const destination=clipboardDestination(document.activeElement);if(destination==='text')return;
  const data=event.clipboardData,text=data?.getData('text/plain')||'';
  if(destination==='editor'&&text.startsWith(layerClipboardPrefix)){event.preventDefault();try{layerClipboard=JSON.parse(text.slice(layerClipboardPrefix.length));await pasteSelectedLayers();}catch(error){toast(error.message,true);}return;}
  if(destination==='editor'&&layerClipboard?.length){event.preventDefault();await pasteSelectedLayers();return;}
  const item=[...(data?.items||[])].find(item=>item.type.startsWith('image/'));if(!item)return;
  event.preventDefault();try{if(destination==='result'&&state.job)await importResult(item.getAsFile());else await uploadReference(item.getAsFile());}catch(error){toast(error.message,true);}
});
document.addEventListener('keydown', event => {
  if(!state.width)return;
  if(event.isComposing||state.loading||state.creating||state.versionSelecting||blocksEditorShortcuts(document.activeElement,event))return;
  if($('annotation-dialog').open||$('generated-viewer').open||$('prompt-template-dialog').open||$('folder-picker-dialog').open||$('text-review-dialog').open||$('attempt-preview-dialog').open)return;
  const shortcut=editorToolShortcut(event);
  if(document.activeElement.closest?.('#repair-inspector')&&(shortcut||['f','q','x',' '].includes(event.key.toLowerCase())||((event.ctrlKey||event.metaKey)&&['a','z','y'].includes(event.key.toLowerCase()))||['Delete','Backspace','Escape'].includes(event.key)))stage.focus({preventScroll:true});
  if(state.tool==='extract'&&state.extractBox&&['Enter','Escape'].includes(event.key)){event.preventDefault();if(event.key==='Enter')confirmExtraction();else cancelExtraction();return;}
  if(handleLayerPasteKey(event,document.activeElement,!!layerClipboard?.length,()=>{if(state.layerOperation)return toast('图层复制中，请稍候再粘贴');void pasteSelectedLayers();}))return;
  if((event.ctrlKey||event.metaKey)&&!event.altKey&&event.key.toLowerCase()==='c'&&clipboardDestination(document.activeElement)==='editor'){event.preventDefault();if(!event.repeat)void copySelectedLayers();return;}
  if((event.ctrlKey||event.metaKey)&&!event.altKey&&event.key.toLowerCase()==='e'){event.preventDefault();if(!event.repeat)void mergeSelectedLayers();return;}
  if((event.ctrlKey||event.metaKey)&&!event.altKey&&event.key.toLowerCase()==='a'&&!$('repair-inspector').hidden){event.preventDefault();selectAllLayers();return;}
  if(event.key==='Escape'&&layerSelection.size>1){event.preventDefault();clearListSelection();return;}
  if(!event.ctrlKey&&!event.metaKey&&!event.altKey&&event.key.toLowerCase()==='f'){event.preventDefault();if(!event.repeat)toggleSelectedLock();return;}
  if(!event.ctrlKey&&!event.metaKey&&!event.altKey&&event.key.toLowerCase()==='x'&&state.tool==='mask'){event.preventDefault();if(!event.repeat){state.maskMode=state.maskMode==='hide'?'show':'hide';selectedLayerControls();centerStatus(state.maskMode==='hide'?'黑笔 · 隐藏':'白笔 · 显示');}return;}
  if(!event.ctrlKey&&!event.metaKey&&!event.altKey&&event.key.toLowerCase()==='q'){event.preventDefault();if(!event.repeat)cycleSelectionRatio();return;}
  if(event.key===' '&&!event.ctrlKey&&!event.metaKey&&!event.altKey){event.preventDefault();if(!event.repeat)cleanCompare();return;}
  if(['Delete','Backspace'].includes(event.key)){event.preventDefault();deleteSelected();return;}
  if((event.ctrlKey||event.metaKey)&&['z','y'].includes(event.key.toLowerCase())){event.preventDefault();if(event.shiftKey||event.key.toLowerCase()==='y')redo();else undo();return;}
  
  if(shortcut){event.preventDefault();setTool(shortcut);}
});
document.addEventListener('keyup', event => { if (event.key === ' ') { state.space = false; view.style.cursor=editorCursor(state.tool,{display:state.viewMode==='display'}); } });
window.addEventListener('blur', () => { state.space = false; state.before = false; endPointer(); render(); });
window.addEventListener('beforeunload', event => { if(state.creating||state.revision!==state.exportedRevision) { event.preventDefault(); event.returnValue = ''; } });
$('selected-unlock').addEventListener('click',toggleSelectedLock);
$('fit-reset').addEventListener('click',()=>fit());
$('mode-display').addEventListener('click',()=>setShow('current'));$('mode-edit').addEventListener('click',()=>{setViewMode('edit');if(state.tool==='pan')setTool('rect');});
$('generated-preview').addEventListener('click',()=>viewGenerated(state.job));
function togglePanel(id,button){const panel=$(id);panel.hidden=!panel.hidden;button.setAttribute('aria-expanded',String(!panel.hidden));}
$('toggle-projects').addEventListener('click',()=>togglePanel('project-drawer',$('toggle-projects')));
$('toggle-inspector').addEventListener('click',()=>togglePanel('repair-inspector',$('toggle-inspector')));
$('collapse-inspector').addEventListener('click',()=>{const panel=$('repair-inspector');if(document.body.classList.contains('integrated-repair')){panel.hidden=true;$('toggle-inspector').setAttribute('aria-expanded','false');return;}panel.classList.toggle('collapsed');$('collapse-inspector').setAttribute('aria-expanded',String(!panel.classList.contains('collapsed')));});
$('close-projects').addEventListener('click',()=>{$('project-drawer').hidden=true;$('toggle-projects').setAttribute('aria-expanded','false');});
for(const [panelId,handleId] of document.body.classList.contains('integrated-repair')?[]:[['repair-inspector','inspector-handle'],['floating-tools','tools-handle']]){
  const panel=$(panelId),handle=$(handleId);let drag=null;
  handle.addEventListener('pointerdown',event=>{if(event.button!==0||event.target.closest('button'))return;event.preventDefault();handle.setPointerCapture(event.pointerId);const box=panel.getBoundingClientRect();drag={x:event.clientX,y:event.clientY,left:box.left,top:box.top};});
  handle.addEventListener('pointermove',event=>{if(!drag)return;panel.style.left=`${Math.max(4,Math.min(innerWidth-panel.offsetWidth-4,drag.left+event.clientX-drag.x))}px`;panel.style.top=`${Math.max(60,Math.min(innerHeight-panel.offsetHeight-12,drag.top+event.clientY-drag.y))}px`;panel.style.right='auto';});
  for(const event of ['pointerup','pointercancel','lostpointercapture'])handle.addEventListener(event,()=>{drag=null;});
}

function layerSelectionKey(layer){const region=contentRegion(layer,state.regions);return region?'region:'+region.id:'layer:'+layer.id;}
function currentLayerSelectionKey(){return state.selectionTarget==='region'&&activeRegion()?'region:'+state.activeRegionId:layers.active?layerSelectionKey(layers.active):activeRegion()?'region:'+state.activeRegionId:null;}
function ordinaryLayers(){return [...layers.layers].reverse().filter(layer=>!contentRegion(layer,state.regions));}
function layerListKeys(items=buildRepairItems(state.regions,state.tasks.values(),state.regionNumbers).items){return [...items.map(item=>'region:'+item.region.id),...ordinaryLayers().map(layer=>'layer:'+layer.id)];}
function selectionCheck(key,name){
  const button=document.createElement('button');button.className='layer-selection-check';button.dataset.selectionCheck=key;button.setAttribute('role','checkbox');button.setAttribute('aria-label','选择'+name);
  button.addEventListener('click',event=>{event.stopPropagation();void selectListItem(key,{shiftKey:event.shiftKey,ctrlKey:!event.shiftKey||event.ctrlKey,metaKey:event.metaKey});});return button;
}
function syncLayerSelection(){
  const count=layerSelection.size,multiple=count>1;
  $('repair-inspector').classList.toggle('multiselect',multiple);
  for(const row of $('unified-layer-list').querySelectorAll('[data-selection-key]')){
    const selected=layerSelection.has(row.dataset.selectionKey);row.classList.toggle('active',selected&&row.dataset.selectionKey===currentLayerSelectionKey());row.classList.toggle('multi-selected',selected);row.dataset.selected=String(selected);
    const name=row.querySelector('.region-select');if(name)name.setAttribute('aria-pressed',String(selected));
  }
  for(const check of $('unified-layer-list').querySelectorAll('[data-selection-check]')){const selected=layerSelection.has(check.dataset.selectionCheck);check.textContent=selected?'✓':'';check.setAttribute('aria-checked',String(selected));}
  $('layer-selection-count').textContent=count?'已选 '+count+' / '+layerSelection.order.length:'共 '+layerSelection.order.length+' 个图层';
  $('select-all-layers').disabled=!layerSelection.order.length||state.loading;
  $('select-all-layers').setAttribute('aria-pressed',String(!!count&&count===layerSelection.order.length));
  $('clear-layer-selection').disabled=!count;$('layer-batch-controls').hidden=!count&&!layerClipboard;syncLayerOperationButtons();
  for(const id of ['batch-lock-layers','batch-unlock-layers','batch-delete-layers'])$(id).disabled=state.loading||state.creating||!!state.selectingRegion;
  if(multiple)$('frame-link').hidden=true;
  syncQuickRepair();
}
async function focusListKey(key){
  if(key?.startsWith('region:')){const region=state.regions.find(item=>item.id===key.slice(7));if(region)await chooseRepairRegion(region,{preserveListSelection:true});}
  else if(key?.startsWith('layer:'))await selectContentLayer(key.slice(6),{preserveListSelection:true});
}
async function selectListItem(key,event={}){
  if(state.loading||state.creating||state.versionSelecting||state.pointer||state.selectingRegion)return;
  layerSelection.reconcile(layerListKeys());layerSelection.select(key,event);syncLayerSelection();
  const primary=layerSelection.has(key)?key:layerSelection.keys.at(-1);
  if(primary)await focusListKey(primary);else clearObjectSelection();syncLayerSelection();$('unified-layer-list').focus({preventScroll:true});
}
function selectAllLayers(){
  if(state.loading||state.creating||state.pointer||state.selectingRegion)return;
  layerSelection.reconcile(layerListKeys());layerSelection.all();syncLayerSelection();
  if(!layerSelection.has(currentLayerSelectionKey())&&layerSelection.size)void focusListKey(layerSelection.keys[0]);
  $('unified-layer-list').focus({preventScroll:true});
}
function clearObjectSelection(){
 state.contentFocusRequest=(state.contentFocusRequest||0)+1;
 state.activeRegionId=null;layers.activeId=null;layerSelection.clear();state.selectionTarget='layer';
 clearSelection();writeRegionFields(null);selectedLayerControls();syncLayerSelection();renderRegions();render();scheduleProjectSave();
}
function clearListSelection(){clearObjectSelection();$('unified-layer-list').focus({preventScroll:true});}
function selectedListObjects(){
  return layerSelection.keys.map(key=>{if(key.startsWith('region:')){const region=state.regions.find(item=>item.id===key.slice(7));return{region,layer:region&&chosenRegionLayer(region,layers.layers)};}return{region:null,layer:layers.layers.find(item=>item.id===key.slice(6))};}).filter(item=>item.region||item.layer);
}
function setSelectedLocks(locked){
  if(state.loading||state.creating||state.pointer||state.selectingRegion)return;
  const objects=selectedListObjects();if(!objects.length)return;
  const busy=objects.some(({region})=>region?.submitting||region?.linking);if(busy)return centerStatus('选中图层正在提交或链接，请稍候');
  if(locked===undefined)locked=!objects.some(({region,layer})=>region?.locked||layer?.locked);
  edit(locked?'批量锁定图层':'批量解锁图层',()=>{for(const {region,layer} of objects){if(region){region.locked=locked;region.modifiedAt=Date.now();}if(layer)layer.locked=locked;}layers.update();});
  centerStatus('已'+(locked?'锁定':'解锁')+' '+objects.length+' 个图层 · 选框与图片同步');renderRegions();updateButtons();
}

function selectedVisualLayerIds(){return (selectedListObjects().length?selectedListObjects().map(item=>item.layer?.id):[layers.activeId]).filter(Boolean);}
function operationMembers(){return linkedMembers(layers.layers,selectedVisualLayerIds());}
function operationSegments(){return visibleSegments().map(segment=>({...segment,width:state.width}));}
function syncLayerOperationButtons(){
 const chosen=visualLayers(layers.layers,selectedVisualLayerIds()),blocked=state.loading||state.creating||state.exporting||!!state.pointer||!!state.layerOperation;
 $('copy-layers').disabled=blocked||!chosen.length;$('paste-layers').disabled=blocked||!state.width;
 $('link-layers').disabled=blocked||chosen.length<2;$('unlink-layers').disabled=blocked||!chosen.some(layer=>layer.linkGroupId);$('merge-layers').disabled=blocked||chosen.length<2;
}
async function selectCanvasObject(key,event){
 layerSelection.reconcile(layerListKeys());layerSelection.select(key,event);const primary=layerSelection.has(key)?key:layerSelection.keys.at(-1);if(!primary){clearObjectSelection();return;}
 if(primary.startsWith('layer:'))await selectContentLayer(primary.slice(6),{preserveListSelection:true,locate:false});else{await selectRegion(primary.slice(7),{preserveListSelection:true,locate:false,focus:false});revealProperties(['repair-details']);}
 syncLayerSelection();render();
}
async function copySelectedLayers(){
 if(state.layerOperation||state.pointer)return;const ids=selectedVisualLayerIds();state.layerOperation=true;syncLayerOperationButtons();
 try{layerClipboard=await layers.copyLayers(ids,{segments:operationSegments()});state.referencePasteFocus=false;state.resultPasteFocus=false;try{await navigator.clipboard.writeText(layerClipboardPrefix+JSON.stringify(layerClipboard));}catch{}toast('已复制 '+layerClipboard.length+' 个图层 · Ctrl+V 粘贴');}
 catch(error){toast(error.message,true);}finally{state.layerOperation=false;syncLayerSelection();}
}
async function pasteSelectedLayers({readClipboard=false}={}){
 if(state.layerOperation||state.pointer||!state.width)return;if(readClipboard)try{const text=await navigator.clipboard.readText();if(text.startsWith(layerClipboardPrefix))layerClipboard=JSON.parse(text.slice(layerClipboardPrefix.length));}catch{}
 if(!layerClipboard?.length)return toast('请先复制图层，再粘贴',true);const before=editorSnapshot(),epoch=state.pageEpoch;state.layerOperation=true;syncLayerOperationButtons();
 try{const added=await layers.pasteLayers(layerClipboard);if(epoch!==state.pageEpoch)return;saveActiveRegion();state.activeRegionId=null;clearSelection();writeRegionFields(null);state.selectionTarget='layer';layerSelection.reconcile(layerListKeys());layerSelection.ids=new Set(added.map(layer=>layerSelectionKey(layer)));layerSelection.anchor=layerSelectionKey(added[0]);setTool('layer-move',{reveal:false});rememberStep(before,'粘贴 '+added.length+' 个图层');state.revision++;scheduleProjectSave();renderRegions();toast('已粘贴 '+added.length+' 个独立图层，可一起移动');}
 catch(error){toast(error.message,true);}finally{state.layerOperation=false;syncLayerSelection();}
}
function linkSelectedLayers(remove=false){if(state.layerOperation||state.pointer)return;try{edit(remove?'解除图层链接':'链接所选图层',()=>{const members=remove?unlinkLayers(layers.layers,selectedVisualLayerIds()):linkLayers(layers.layers,selectedVisualLayerIds());if(!members.length)throw new Error('没有已链接图层');layers.update();});scheduleProjectSave();renderRegions();toast(remove?'已解除链接':'已链接，拖动其中一个会一起移动；锁定项需先解锁');}catch(error){toast(error.message,true);}}
async function mergeSelectedLayers(){
 if(state.layerOperation||state.pointer)return;const ids=selectedVisualLayerIds(),chosen=visualLayers(layers.layers,ids),regions=chosen.map(layer=>contentRegion(layer,state.regions)).filter(Boolean);
 if(chosen.some(layer=>!canEditLayer(layer,contentRegion(layer,state.regions))))return toast('请先点击「解锁所选」再合并',true);if(regions.some(region=>regionBusy(region)))return toast('请等待所选修复任务完成后再合并',true);
 const before=editorSnapshot(),epoch=state.pageEpoch,backups=new Map(chosen.filter(layer=>layer.jobId).map(layer=>[layer.jobId,layerBackup(layer,state.tasks.get(layer.jobId)?.decision)]));state.layerOperation=true;syncLayerOperationButtons();
 try{const merged=await layers.mergeLayers(ids,{segments:operationSegments()});if(epoch!==state.pageEpoch)return;const regionIds=new Set(regions.map(region=>region.id));for(const id of regionIds){markRegionDeleted(id);state.regionMaskCache.delete(id);}for(const task of state.tasks.values())if(regionIds.has(task.regionId)||backups.has(task.id)){task.layerBackup=backups.get(task.id)||task.layerBackup;task.decision='discarded';task.layerId=null;rememberTask(task);}state.regions=state.regions.filter(region=>!regionIds.has(region.id));layers.layers=layers.layers.filter(layer=>!regionIds.has(layer.regionId));state.activeRegionId=null;clearSelection();writeRegionFields(null);state.selectionTarget='layer';layerSelection.single('layer:'+merged.id);setTool('layer-move',{reveal:false});layers.update();rememberStep(before,'合并 '+chosen.length+' 个图层');state.revision++;scheduleProjectSave();renderRegions();toast('已合并为一个图层，Ctrl+Z 可恢复原图层');}
 catch(error){toast(error.message,true);}finally{state.layerOperation=false;syncLayerSelection();}
}
$('copy-layers').addEventListener('click',()=>void copySelectedLayers());$('paste-layers').addEventListener('click',()=>void pasteSelectedLayers({readClipboard:true}));
$('link-layers').addEventListener('click',()=>linkSelectedLayers());$('unlink-layers').addEventListener('click',()=>linkSelectedLayers(true));$('merge-layers').addEventListener('click',()=>void mergeSelectedLayers());

$('select-all-layers').addEventListener('click',selectAllLayers);
$('clear-layer-selection').addEventListener('click',clearListSelection);
$('batch-lock-layers').addEventListener('click',()=>setSelectedLocks(true));
$('batch-unlock-layers').addEventListener('click',()=>setSelectedLocks(false));
$('batch-delete-layers').addEventListener('click',()=>void deleteSelected());
if(!document.body.classList.contains('integrated-repair'))bindInspectorResize($('repair-inspector'),{content:document.querySelector('.inspector-content'),list:$('region-panel'),splitter:$('layer-list-splitter'),onChange:()=>syncQuickRepair()});

new ResizeObserver(() => { if (!state.pointer){if(document.body.classList.contains('integrated-repair')&&embeddedAutoFit)fit();else render();} }).observe(stage);

$('frame-link').addEventListener('pointerdown',event=>event.stopPropagation());
$('frame-link').addEventListener('click',event=>{event.stopPropagation();const region=activeRegion();if(region&&!state.loading&&!state.creating&&!state.versionSelecting&&!state.selectingRegion&&!state.pointer)void toggleRepairLink(region).then(syncInspector);});
$('object-link').addEventListener('click',()=>{const region=activeRegion();if(region)void toggleRepairLink(region).then(syncInspector);});
for(const id of ['selection-x','selection-y','selection-width','selection-height']){
  $(id).addEventListener('input',()=>{
    const region=activeRegion();if(!region||!canEditRegion(region,chosenRegionLayer(region,layers.layers)))return;
    const value=Number($(id).value);if(!Number.isFinite(value)){syncInspector();return;}
    beginPropertyEdit('selection-geometry');const source=frameMoveSource(region),current=region.frame;let frame;
    if(id==='selection-x'||id==='selection-y')frame=moveFixedFrame(current,id==='selection-x'?value-current.x:0,id==='selection-y'?value-current.y:0,state.width,state.height);
    else {const [rw,rh]=(region.ratio||'1:1').split(':').map(Number),units=Math.max(1,Math.round(value/(id==='selection-width'?rw:rh))),width=units*rw,height=units*rh;if(current.x+width>state.width||current.y+height>selectionHeight()){toast('选框尺寸超出原图范围',true);syncInspector();return;}frame={...current,width,height};}
    try{applyRegionFrame(region,source,frame);boundsChanged();saveActiveRegion();state.revision++;}catch(error){toast(error.message,true);}syncInspector();
  });
  for(const type of ['change','blur'])$(id).addEventListener(type,()=>finishPropertyEdit('selection-geometry','调整选框位置与尺寸'));
}
for(const id of ['layer-opacity','layer-x','layer-y','layer-scale','layer-angle','layer-scale-x','layer-scale-y'])$(id).addEventListener('blur',()=>finishPropertyEdit('layer-properties','调整图层'));
for(const id of textControlIDs)$(id).addEventListener('blur',()=>finishPropertyEdit('text','修改文字样式'));
$('view-fit').addEventListener('click',fit);$('view-top').addEventListener('click',()=>jumpToPage(0));
$('view-zoom').addEventListener('change',()=>{const value=Number($('view-zoom').value);if(Number.isFinite(value)&&value>0&&value<=600)zoom(value/100/state.zoom);else syncInspector();});

setViewMode('display');
const demoMode=new URL(location.href).searchParams.get('demo')==='1';
if(demoMode)await loadImage('/repair/demo.svg', '手部修复 · 演示画面');
else {try{state.loading=true;busy(true,'恢复漫画工程…');updateButtons();let meta=null;const remembered=localStorage.getItem('patch-last-page');if(remembered){const response=await fetch(`/repair/api/sources/${remembered}`);if(response.ok){const saved=await response.json();if(!saved.deletedAt)meta=saved;}}if(!meta){const response=await fetch('/repair/api/projects');if(response.ok){const saved=await response.json();meta=saved.projects?.[0]||null;}}if(meta)await loadPage(meta);}catch{toast('暂时无法恢复项目，可在“项目”中重新打开。',true);}finally{state.loading=false;busy(false);}}
state.initializing=false;updateButtons();render();

try{if(!activeRegion())state.references=JSON.parse(localStorage.getItem('patch-selected-references')||'[]');showReferences(false);}catch{}
await poll(); setInterval(poll, 2000);
setInterval(()=>{if(!document.hidden)updateGenerationTimerLabels();},1000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)updateGenerationTimerLabels();});
checkCodex();
loadStorage();
loadCustomPrompts();
refreshProjects();setInterval(refreshProjects,3000);


// Bridge only the original source image and editable repair layers.
globalThis.comicStudioRepair={
  async open(sourceId){
    if(!/^[a-f0-9]{32}$/.test(sourceId))throw new Error('返修原图编号无效');
    const response=await fetch(`/repair/api/sources/${sourceId}`),meta=await response.json();if(!response.ok||meta.deletedAt)throw new Error(meta.error||'返修原图已删除');
    state.loading=true;busy(true,'打开漫画格子原图…');updateButtons();
    try{await loadPage(meta);await refreshProjects();}finally{state.loading=false;busy(false);updateButtons();}
    await poll();
  },
  async export(sourceId){
    if(state.page?.metadata.id!==sourceId)throw new Error('请回到当前格子的返修图片再返回候选');
    if(state.loading||state.creating||state.exporting)throw new Error('图片正在处理，请稍候再返回');
    const epoch=state.pageEpoch,deadline=Date.now()+30*60*1000;
    while(true){
      if(epoch!==state.pageEpoch||state.page?.metadata.id!==sourceId)throw new Error('当前图片已切换，返修没有回填到其他格子');
      const response=await fetch(`/repair/api/jobs?sourceId=${sourceId}`),jobs=await response.json();if(!response.ok)throw new Error(jobs.error||'后台任务读取失败');
      if(!jobs.some(job=>['queued','running'].includes(job.automation?.status)||(job.automation?.status==='completed'&&!job.result)))break;
      if(Date.now()>deadline)throw new Error('后台任务仍未完成，请稍后再返回候选');
      await new Promise(resolve=>setTimeout(resolve,1000));
    }
    while(state.polling)await new Promise(resolve=>setTimeout(resolve,50));
    await poll();state.exporting=true;updateButtons();
    try{await ensureLayerFonts(layers.layers);await flushProject();if(epoch!==state.pageEpoch||state.page?.metadata.id!==sourceId)throw new Error('返修原图已切换');return {sourceId,sourceRevision:state.page.revision,projectVersion:state.projectVersion};}
    finally{state.exporting=false;updateButtons();}
  }
};


// Embedded editor bridge. Only the owning same-origin canvas may switch its source.
document.body.classList.add('integrated-repair');

const embeddedBar=document.createElement('div');embeddedBar.id='embedded-toolbar';embeddedBar.innerHTML='<button id="repair-library">墨库素材</button><button id="repair-native-cutout">整图自动抠图</button><button id="repair-selected-cutout">选框抠人物 / 元素</button><button id="repair-local-bubble">去框并替换气泡</button><select id="repair-upscale-scale" aria-label="放大倍率"><option value="2">2 倍</option></select><select id="repair-upscale-model" aria-label="高清模型"><option value="illustrationjanai-v3-detail">IllustrationJaNai V3 Detail（FDAT-M）</option></select><button id="repair-native-upscale">高清放大</button><button id="repair-return" class="primary">回填左侧画格</button><span id="repair-native-status" role="status"></span>';
document.querySelector('.header').after(embeddedBar);
window.addEventListener('message',async event=>{
 if(event.origin!==location.origin||event.source!==parent)return;
 if(['comic:repair-applied','comic:repair-history-result','comic:repair-apply-error'].includes(event.data?.type)){const waiting=embeddedApplies.get(event.data.requestId);if(waiting){clearTimeout(waiting.timer);embeddedApplies.delete(event.data.requestId);if(event.data.type==='comic:repair-apply-error')waiting.reject(Error(event.data.message));else{if(event.data.applied&&event.data.session&&event.data.sessionId===embeddedSession?.id){embeddedSession=event.data.session;configureEmbeddedTarget();}if(event.data.applied&&event.data.metadata&&event.data.sessionId===embeddedSession?.id){try{const past=editHistory.past,future=editHistory.future,epoch=state.pageEpoch;await flushProject();if(epoch===state.pageEpoch&&event.data.sessionId===embeddedSession?.id){await loadPage(event.data.metadata);editHistory.past=past;editHistory.future=future;updateHistory();setViewMode('edit');}}catch(error){waiting.reject(error);return;}}waiting.resolve(event.data);}}return;}
 try{if(event.data?.type==='comic:repair-bind-session'){embeddedSession=event.data.session;configureEmbeddedTarget();}if(event.data?.type==='comic:repair-source'){await flushProject();embeddedSession=event.data.session;embeddedUpscaleModel='';configureEmbeddedTarget();await loadPage(event.data.metadata);setViewMode('edit');parent.postMessage({type:'comic:repair-loaded',sessionId:embeddedSession.id},location.origin);}
 if(event.data?.type==='comic:repair-font'){const font=event.data.font;const registeredFont=registerLibraryFont(font);const option=document.createElement('option');option.value=font.family;option.textContent=registeredFont.label;document.querySelector('#text-font').append(option);if(layers.active?.type==='text'){layers.active.fontFamily=font.family;await ensureTextFont(layers.active);scheduleProjectSave();render();}toast('已加入墨库字体');}
 if(event.data?.type==='comic:repair-reference'){const response=await fetch('/repair/api/references',{method:'POST',headers:{'X-Source-Name':encodeURIComponent(event.data.name||'墨库参考')},body:await(await fetch(event.data.url)).blob()}),reference=await response.json();if(!response.ok)throw Error(reference.error);state.references=[...(state.references||[]),reference];showReferences(false);toast('已加入墨库参考素材');}
 if(event.data?.type==='comic:repair-flush'){await flushProject();parent.postMessage({type:'comic:repair-flushed',requestId:event.data.requestId},location.origin);}
 }catch(error){toast(error.message,true);parent.postMessage({type:'comic:repair-error',message:error.message},location.origin);}
});
async function embeddedExport(){const sourceAtStart=state.page?.metadata.id;if(!state.page)throw Error('先从左侧选择有图片的画格');await ensureLayerFonts(layers.layers);await layers.ensureForSerialization();await flushProject();if(state.page?.metadata.id!==sourceAtStart)throw Error('修图来源已切换，请重新回填');const response=await fetch('/repair/api/exports',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sourceId:state.page.metadata.id,sourceRevision:state.page.revision,sectionMode:state.sectionMode,pageSections:editorSections(),pageGaps:state.pageGaps,layers:layers.serialize(),exportMode:'repaired'})}),result=await response.json();if(!response.ok)throw Error(result.error);return result;}
const applyOptions=document.createElement('div');applyOptions.className='repair-apply-options';applyOptions.innerHTML='<select id="repair-apply-mode" aria-label="图像应用方式"><option value="replace">自动合并到画格</option><option value="layer">原位新增图层</option><option value="upscale">高清子图层（保留原图）</option></select><select id="repair-layer-position" aria-label="子图层叠放位置" hidden><option value="above">原图上方</option><option value="below">原图下方</option></select>';embeddedBar.append(applyOptions);
document.querySelector('#repair-apply-mode').onchange=()=>document.querySelector('#repair-layer-position').hidden=document.querySelector('#repair-apply-mode').value!=='layer';
function configureEmbeddedTarget(){const hd=embeddedSession?.targetKind==='upscale',composition=embeddedSession?.targetKind==='composition',select=document.querySelector('#repair-apply-mode');if(!select)return;select.querySelector('[value="replace"]').textContent=hd?'更新当前高清图层':'自动合并到画格';for(const mode of ['layer','upscale'])select.querySelector('[value="'+mode+'"]').disabled=hd;select.value='replace';document.querySelector('#repair-layer-position').hidden=true;document.querySelector('#repair-return').textContent=hd?'应用到高清图层':'应用并合并';}
function requestEmbedded(message){
 const requestId=crypto.randomUUID();return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{embeddedApplies.delete(requestId);reject(Error('左侧操作回执超时，请先核对左侧状态'));},60000);embeddedApplies.set(requestId,{resolve,reject,timer});parent.postMessage({...message,requestId},location.origin);});
}
async function applyEmbeddedResult(mode,position='above',{sessionId=embeddedSession?.id,model=embeddedUpscaleModel}={}){
 if(!sessionId)throw Error('请先点击左侧“修改画面”');const result=await embeddedExport();if(embeddedSession?.id!==sessionId)throw Error('修图会话已切换，结果仍保留');
 const requestId=crypto.randomUUID();return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{embeddedApplies.delete(requestId);reject(Error('左侧应用回执超时，结果已保留，可重试应用'));},60000);embeddedApplies.set(requestId,{resolve,reject,timer});parent.postMessage({type:'comic:repair-result',requestId,sessionId,resultUrl:result.url,mode,position,model},location.origin);});
}
document.querySelector('#repair-return').onclick=async()=>{const button=document.querySelector('#repair-return');try{button.disabled=true;const result=await applyEmbeddedResult(document.querySelector('#repair-apply-mode').value,document.querySelector('#repair-layer-position').value);toast(result.message);}catch(e){toast(e.message,true);}finally{button.disabled=false;}};
document.querySelector('#repair-library').onclick=()=>parent.postMessage({type:'comic:open-library',target:'repair'},location.origin);
async function runLocal(operation){
 const sourceAtStart=state.page?.metadata.id,sessionAtStart=embeddedSession?.id,upscaleScale=Number(document.querySelector('#repair-upscale-scale').value),upscaleModel=document.querySelector('#repair-upscale-model').value,label=document.querySelector('#repair-native-status'),buttons=[document.querySelector('#repair-native-upscale'),document.querySelector('#repair-native-cutout')],key='comic-local-tool-pending';let task,pending;
 const json=async(url,input)=>{const res=await fetch(url,input?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)}:undefined),value=await res.json();if(!res.ok)throw Error(value.error||'本地处理请求失败');return value;};
 try{
  if(!state.page)throw Error('先打开需要处理的画格');state.localProcessing=true;updateButtons();buttons.forEach(b=>b.disabled=true);try{pending=JSON.parse(sessionStorage.getItem(key)||'null');}catch{}
  const resume=pending&&[pending.sourceId,pending.resultSourceId].includes(sourceAtStart)&&pending.sessionId===sessionAtStart&&pending.operation===operation&&pending.scale===upscaleScale&&pending.model===upscaleModel;
  if(resume){label.textContent='正在取回上次本地处理任务…';task=await json('/repair/api/local-tools/'+pending.id);}
  else{label.textContent='准备当前图层…';await ensureLayerFonts(layers.layers);await layers.ensureForSerialization();if(state.page?.metadata.id!==sourceAtStart)throw Error('修图来源已切换，未提交本地处理');task=await json('/repair/api/local-tools',{sourceId:sourceAtStart,sourceRevision:state.page.revision,layers:layers.serialize(),sectionMode:state.sectionMode,pageSections:editorSections(),pageGaps:state.pageGaps,operation,scale:upscaleScale,model:upscaleModel});pending={id:task.id,sourceId:sourceAtStart,sessionId:sessionAtStart,operation,scale:upscaleScale,model:upscaleModel};sessionStorage.setItem(key,JSON.stringify(pending));}
  while(['queued','running'].includes(task.status)){label.textContent=operation==='cutout'?'U²-Net CPU 抠图中…':'IllustrationJaNai FDAT-M 2倍放大中…';await new Promise(r=>setTimeout(r,800));task=await json('/repair/api/local-tools/'+task.id);}
  if(task.status!=='done'){sessionStorage.removeItem(key);throw Error(task.message);}
  label.textContent='本地处理已完成，正在接回结果…';const meta=await json('/repair/api/local-tools/'+task.id+'/open',{name:state.name+(operation==='cutout'?' · 抠图':' · 高清')});
  if(state.page?.metadata.id!==sourceAtStart||embeddedSession?.id!==sessionAtStart){label.textContent='处理结果已保存；原修图会话已切换，未替换当前图片';return;}
  const before=editorSnapshot(),past=editHistory.past.slice();await flushProject();await loadPage(meta);editHistory.past=past;rememberStep(before,operation==='upscale'?'高清放大':'整图抠图');pending.resultSourceId=meta.id;sessionStorage.setItem(key,JSON.stringify(pending));setViewMode('edit');
  if(operation==='upscale'){embeddedUpscaleModel=upscaleModel;document.querySelector('#repair-apply-mode').value='upscale';document.querySelector('#repair-layer-position').hidden=true;if(sessionAtStart){label.textContent='高清图片已就绪；正在新增高清子图层…';const applied=await applyEmbeddedResult('upscale','above',{sessionId:sessionAtStart,model:upscaleModel});if(applied.applied&&applied.operationId)before.workspaceOperationId=applied.operationId;label.textContent=applied.mergedLayers?.length?applied.message:applied.applied?(applied.updatedLayer?'高清图片已就绪；已更新当前高清子图层，原图保留':'高清图片已就绪；已新增高清子图层，原图保留'):applied.message;}else label.textContent='高清图片已就绪；原图保留';}
  else{if(document.querySelector('#repair-apply-mode').value==='upscale')document.querySelector('#repair-apply-mode').value='replace';label.textContent='已生成透明 PNG；原图保留';}sessionStorage.removeItem(key);
 }catch(e){const message=pending?.id&&/fetch|network|连接|回执超时/i.test(e.message)?(task?.status==='done'?'图片已处理完成，接回失败':'连接中断，本地任务已保留')+'；再次点击可取回同一任务，或在“更多 → 本地处理记录”打开结果。':e.message;label.textContent=message;toast(message,true);}finally{state.localProcessing=false;buttons.forEach(b=>b.disabled=false);updateButtons();}
}
document.querySelector('#repair-native-cutout').onclick=()=>runLocal('cutout');document.querySelector('#repair-native-upscale').onclick=()=>runLocal('upscale');
parent.postMessage({type:'comic:repair-ready'},location.origin);

try{const result=await(await fetch('/api/library/fonts')).json();for(const font of result.items||[])registerLibraryFont(font);render();}catch{}

for(const [label,id]of [['打开修图工程','import-project-file'],['导入图片','open-image'],['修图记录','toggle-projects']]){const button=document.createElement('button');button.textContent=label;button.onclick=()=>document.getElementById(id).click();document.querySelector('#embedded-toolbar').insertBefore(button,document.querySelector('#repair-native-status'));}

document.querySelector('#repair-upscale-scale').disabled=true;

// Dock controls outside the canvas. Wait until the history control below is mounted.
queueMicrotask(()=>{
 const repairMenus=[];
 function repairMenu(label,id){
  const root=document.createElement('details');root.className='repair-menu';root.id=id;
  root.innerHTML='<summary role="button" aria-expanded="false"></summary><div class="repair-menu-panel"></div>';root.firstElementChild.textContent=label;embeddedBar.append(root);repairMenus.push(root);
  root.addEventListener('toggle',()=>{root.firstElementChild.setAttribute('aria-expanded',String(root.open));if(!root.open)return;for(const other of repairMenus)if(other!==root)other.open=false;const panel=root.lastElementChild,b=root.firstElementChild.getBoundingClientRect(),w=Math.min(282,innerWidth-20);panel.style.width=w+'px';panel.style.left=Math.max(10,Math.min(innerWidth-w-10,b.left))+'px';panel.style.top=b.bottom+7+'px';});
  return root.lastElementChild;
 }
 const fileControls=[...embeddedBar.querySelectorAll('button')].filter(b=>!b.id),filePanel=repairMenu('更多','repair-file-menu'),processPanel=document.createElement('div');
 processPanel.id='repair-image-tools';processPanel.className='repair-image-tools';processPanel.setAttribute('role','group');processPanel.setAttribute('aria-label','图像处理工具');embeddedBar.append(processPanel);
 const scaleField=document.createElement('label');scaleField.textContent='放大倍率';scaleField.append($('repair-upscale-scale'));
 const modelField=document.createElement('label');modelField.textContent='画面类型';modelField.append($('repair-upscale-model'));
 processPanel.append(scaleField,modelField,$('repair-native-upscale'),$('repair-selected-cutout'),$('repair-local-bubble'),$('repair-native-cutout'));
 for(const [id,operation] of [['repair-selected-cutout','cutout'],['repair-local-bubble','inpaint']]){$(id).hidden=window.parent===window;$(id).onclick=()=>{if(!embeddedSession)return toast('请先从左侧画格加载修图');window.parent.postMessage({type:'comic:local-region',operation,sessionId:embeddedSession.id},location.origin);};}
 for(const button of [...fileControls,$('save-project-file'),$('export-image')])filePanel.append(button);
 filePanel.append($('export-options'));
 embeddedBar.prepend($('undo'),$('redo'),$('repair-library'));embeddedBar.append($('toggle-inspector'),$('repair-return'));
 $('repair-return').textContent='应用到画格';$('toggle-inspector').lastChild.textContent='图层 / 属性';$('toggle-inspector').title='图层与对象属性';
 for(const id of ['undo','redo']){const button=$(id);button.classList.add('compact-action');for(const node of [...button.childNodes])if(node.nodeType===Node.TEXT_NODE)node.remove();}
 const nativeStatus=$('repair-native-status');document.querySelector('.workspace').append(nativeStatus);
 const shell=document.querySelector('.canvas-shell');shell.append(document.querySelector('.view-controls'));$('view-details').append($('mode-display'),$('mode-edit'));
 stage.addEventListener('wheel',()=>{embeddedAutoFit=false;},{passive:true});
 stage.addEventListener('pointerdown',()=>{if(state.tool==='pan')embeddedAutoFit=false;},{capture:true});
 for(const id of ['zoom-in','zoom-out'])$(id).addEventListener('click',()=>{embeddedAutoFit=false;});
 const inspector=$('repair-inspector');inspector.hidden=true;inspector.classList.remove('collapsed');
 inspector.querySelector('.inspector-heading strong').textContent='图层与属性';$('collapse-inspector').innerHTML='×';$('collapse-inspector').title='关闭图层与属性';$('collapse-inspector').setAttribute('aria-label','关闭图层与属性');
 const tabs=document.createElement('div');tabs.className='repair-inspector-tabs';tabs.innerHTML='<button data-repair-tab="layers" class="active">图层</button><button data-repair-tab="properties">属性</button>';
 inspector.querySelector('.inspector-heading').after(tabs);inspector.dataset.tab='layers';
 function inspectorTab(value){inspector.dataset.tab=value;tabs.querySelectorAll('button').forEach(b=>b.classList.toggle('active',b.dataset.repairTab===value));}
 tabs.onclick=event=>{const button=event.target.closest('[data-repair-tab]');if(button)inspectorTab(button.dataset.repairTab);};
 function syncDock(){document.body.classList.toggle('repair-properties-open',!inspector.hidden);requestAnimationFrame(()=>{render();syncQuickRepair();});}
 new MutationObserver(syncDock).observe(inspector,{attributes:true,attributeFilter:['hidden']});syncDock();
 for(const id of ['add-paint-layer','add-image-layer','add-background-layer'])$(id).addEventListener('click',()=>{inspector.hidden=false;inspectorTab('properties');$('toggle-inspector').setAttribute('aria-expanded','true');});
 $('unified-layer-list').addEventListener('dblclick',()=>inspectorTab('properties'));
 document.addEventListener('pointerdown',event=>{for(const root of repairMenus)if(!root.contains(event.target))root.open=false;});
 document.addEventListener('keydown',event=>{if(event.key==='Escape'){for(const root of repairMenus)root.open=false;if(!document.querySelector('dialog[open]')){inspector.hidden=true;$('toggle-inspector').setAttribute('aria-expanded','false');}}});
 filePanel.addEventListener('click',event=>{if(event.target.closest('button'))filePanel.parentElement.open=false;});
 $('welcome-import').textContent='或导入一张图片';syncEditorShell();
});

const localHistoryButton=document.createElement('button');localHistoryButton.textContent='本地处理记录';localHistoryButton.onclick=async()=>{try{const response=await fetch('/repair/api/local-tools/history'),value=await response.json();if(!response.ok)throw Error(value.error);const dialog=document.createElement('dialog');dialog.className='local-tool-history';const heading=document.createElement('h3');heading.textContent='本地处理记录';dialog.append(heading);for(const task of value.items){const row=document.createElement('p'),label=document.createElement('span');label.textContent=(task.operation==='upscale'?'高清放大':task.operation==='inpaint'?'气泡补图':task.regionSelection?'选区抠图':'本地抠图')+' · '+(task.status==='done'?'已完成':task.status==='failed'?task.message:'处理中')+' · '+task.createdAt;row.append(label);if(task.status==='done'){const download=document.createElement('a');download.href='/repair/api/local-tools/'+task.id+'/result';download.download='本地处理.png';download.textContent='下载 PNG';const open=document.createElement('button');open.textContent='打开到右侧';open.onclick=async()=>{const res=await fetch('/repair/api/local-tools/'+task.id+'/open',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'本地处理 · '+task.id.slice(0,8)})}),meta=await res.json();if(!res.ok)return toast(meta.error,true);await flushProject();await loadPage(meta);setViewMode('edit');dialog.close();};if(task.regionSelection)row.append(' ',download);else row.append(' ',download,' ',open);}dialog.append(row);}if(!value.items.length){const note=document.createElement('p');note.textContent='暂无本地处理记录';dialog.append(note);}const close=document.createElement('button');close.textContent='关闭';close.onclick=()=>dialog.close();dialog.append(close);dialog.onclose=()=>dialog.remove();document.body.append(dialog);dialog.showModal();}catch(error){toast(error.message,true);}};document.querySelector('#embedded-toolbar').insertBefore(localHistoryButton,document.querySelector('#repair-native-status'));
