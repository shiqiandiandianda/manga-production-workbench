import {unifiedGenerationInstructions} from './unified-layout-rules.js';
import {stripObsoleteProductionReferences} from './production-reference-policy.js';
import {hydrateProductionSlices} from './production-slice-source.js';
import {generationPromptSelection,migrateLegacyPanelPrompt} from './prompt-source.js';
import {referencesForPanel,panelReferenceIds} from './panel-references.js';
import {sourceStateFields} from './character-states.js';
import {effectiveCharacterStates} from './episode-outfit.js';
const copy=value=>value===undefined?undefined:structuredClone(value);
export function resolvePanelGeneration(project,panel,assets=[]){
 const source=project.shots.find(shot=>shot.id===panel.shotId),generation=copy(panel.generation||{}),original=source||generation.sourceSnapshot?.original||{};
 migrateLegacyPanelPrompt(generation);
 return {...generation,version:1,prompt:original.productionPrompt||original.description||generation.prompt||'',negativePrompt:'',shotSize:original.shotSize||generation.shotSize||'',cameraAngle:original.cameraAngle||generation.cameraAngle||'',dialogue:original.dialogue??generation.dialogue??'',embeddedTexts:copy(original.embeddedTexts||generation.embeddedTexts||[]),...(original.assetVisualContract?{assetVisualContract:copy(original.assetVisualContract)}:{}),...Object.fromEntries(Object.entries(sourceStateFields(original)).filter(([key])=>!Object.hasOwn(generation,key))),sourceSnapshot:{...generation.sourceSnapshot,projectId:project.id,shotId:panel.shotId||'',code:original.code||generation.sourceSnapshot?.code||'',title:original.title||generation.sourceSnapshot?.title||'',original:copy(original)},referenceRoles:copy(referencesForPanel(project,panel,assets))};
}
export function ensurePanelGeneration(project,panel,assets=[]){
 const generation=resolvePanelGeneration(project,panel,assets);generation.characterStates=effectiveCharacterStates(project,panel,generation.characterStates);panel.generation=generation;
 if(!Array.isArray(panel.referenceIds))panel.referenceIds=(generation.referenceRoles||[]).map(reference=>reference.assetId);
 return panel.generation;
}
export function ensureProjectPanelGeneration(project,assets=[]){stripObsoleteProductionReferences(project);hydrateProductionSlices(project,assets);for(const page of project.pages)for(const panel of page.panels)if(!panel.breakoutForeground&&!panel.cutoutLayer)ensurePanelGeneration(project,panel,assets);return project;}
export function panelProductionShot(project,panel,assets=[]){
 if(panel.cutoutLayer)throw Object.assign(Error('抠图层不单独生图，请选择原画格'),{status:400});const generation=resolvePanelGeneration(project,panel,assets),choice=generationPromptSelection({...panel,generation},project);if(!choice.text.trim())throw Object.assign(Error('本格缺少分镜表提示词'),{status:400});
 const layoutInstructions=unifiedGenerationInstructions(project,panel),effectivePrompt=layoutInstructions+choice.text;
 return {...generation,characterStates:effectiveCharacterStates(project,panel,generation.characterStates),...(layoutInstructions?{originalProductionPrompt:choice.text,layoutRuleDigest:project.layoutRuleBindings?.[project.productionPackage.episodes.find(e=>e.segments.some(s=>s.id===panel.productionSegment))?.episode]?.contract.digest}:{}),id:panel.id,code:panel.name||generation.sourceSnapshot.code||'画格',title:generation.sourceSnapshot.title||'画格',description:effectivePrompt,productionPrompt:effectivePrompt,promptSource:choice.source,promptColumn:choice.column,referenceIds:panelReferenceIds(project,panel),...(panel.productionSegment?{productionSegment:panel.productionSegment}:{}),...(panel.productionBackground?{productionBackground:panel.productionBackground}:{})};
}
export function generationLayoutInstructions(panel){return '目标画格宽 '+Math.round(panel.w)+' px、高 '+Math.round(panel.h)+' px；按此宽高比例构图。';}
export function panelContentKey(project,panel,assets=[]){const shot=panelProductionShot(project,panel,assets);return JSON.stringify({style:project.style,shot,referenceIds:panelReferenceIds(project,panel)});}
export function panelProductionSnapshot(panel){return copy({id:panel.id,x:panel.x,y:panel.y,w:panel.w,h:panel.productionBackground?panel.w*3:panel.h,points:panel.points,kind:panel.kind,imageAssetId:panel.imageAssetId,imageTransform:panel.imageTransform,nativeSizing:panel.nativeSizing});}
