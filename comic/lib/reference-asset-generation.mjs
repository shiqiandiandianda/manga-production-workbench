import {removedReferenceIds} from '../public/asset-workspace-removal.js';
import {generationReferencePlan} from '../public/asset-generation-references.js';
import {auditPanelReferences} from '../public/panel-reference-audit.js';
import {assetMetadata} from '../public/asset-metadata.js';
import {generationPromptSelection} from '../public/prompt-source.js';
import {pageEpisode} from '../public/episode-boards.js';
import {unknownState} from '../public/character-states.js';
import {deriveSceneReference,sceneSpaceEvidence} from '../public/reference-scene-source.js';
import {sceneFrontPrompt,sceneAssetSpec,propAssetPrompt} from './scene-asset-prompts.mjs';
import {assetProvenance} from '../public/asset-provenance.js';
import {savedAssetRequirementSettings} from '../public/asset-workspace-model.js';
import {assetWorkspaceSettings} from '../public/asset-workspace-settings.js';
import {characterAppearancePrompt} from './character-appearance.mjs';
import {CHARACTER_CARD_LAYOUT_RULES} from '../public/hand-card-rules.js';
import {buildCharacterAssetPrompt} from './character-asset-prompt.mjs';
const check=(condition,message,status=400)=>{if(!condition)throw Object.assign(Error(message),{status});};
const text=value=>typeof value==='string'?value.trim():'';

// Build one explicit candidate request, independently of whether a usable image exists.
export function referenceAssetGenerationRequest(project,input,assets){
 check(input.expectedRevision===project.revision,'工程已变化，请保存并重试',409);
 check(typeof input.requestId==='string'&&/^[a-zA-Z0-9-]{8,100}$/.test(input.requestId),'生成请求编号无效');
 const page=project.pages.find(p=>p.panels.some(f=>f.id===input.panelId)),panel=page?.panels.find(f=>f.id===input.panelId);
 check(panel,'画格已删除',404);check(!page.locked&&!panel.locked,'请先解锁画板和画格',409);
 const need=auditPanelReferences(project,panel,assets).needs.find(n=>n.id===input.needId);
 check(need&&['character','scene','prop'].includes(need.role),'本格参考需求已变化，请重新打开参考窗口',409);
 const defaultReferenceIds=[...new Set([...need.selectedIds,...(!panel.productionSegment?[need.recommendedId]:[])].filter(id=>id&&!removedReferenceIds(project,panel.id,need.id).includes(id)))];
 // Never silently choose one of several identity/state variants.
 if(need.role!=='character'&&!input.settings?.generationReferenceMode)check(defaultReferenceIds.length<=1,'此项已有多个参考版本，请先明确选用一个版本再重新生成',409);
 const settings=assetWorkspaceSettings({...savedAssetRequirementSettings(project,need),...input.settings}),referencePlan=generationReferencePlan(project,assets,need,settings,defaultReferenceIds),referenceIds=referencePlan.referenceIds;
 const image=assets.find(a=>a.id===referenceIds[0]),meta=image&&assetMetadata(image),unspecified=!need.state||unknownState(need.state);
 const state=need.role==='scene'?'':unspecified?(meta?.state||'未指定（原创候选，待确认）'):need.state;
 const provenance=assetProvenance(project,panel,need),evidence=provenance[0];
 const shot=project.shots.find(s=>s.id===panel.shotId)||{},fields=shot.sourceFields||{};
 const pick=(...keys)=>keys.map(key=>text(fields[key])).find(Boolean)||'';
 const scene=need.role==='scene'?{location:need.name,kind:'field',sourceCode:evidence?.code||'',quote:evidence?.scene||need.name}:null;
 const space=need.role==='scene'?sceneSpaceEvidence(project,panel):null;
 const sceneMeta=need.role==='scene'?{camera:settings.camera||evidence?.camera||text(shot.cameraAngle)||pick('机位','机位角度','cameraAngle'),time:settings.time||evidence?.time||text(shot.time)||pick('时间','时段','time'),weather:settings.weather||evidence?.weather||text(shot.weather)||pick('天气','weather')}:null;
 const sceneMetaLine=sceneMeta&&[sceneMeta.camera&&'机位 '+sceneMeta.camera,sceneMeta.time&&'时间 '+sceneMeta.time,sceneMeta.weather&&'天气 '+sceneMeta.weather].filter(Boolean).join('；');
 const originalPrompt=generationPromptSelection(panel,project).text;
 const sourcePrompt=provenance.some(s=>s.description)?provenance.map(s=>[s.code,s.description,s.notes,s.state].filter(Boolean).join('：')).join('\n'):originalPrompt;
 const sceneRecord=need.role==='scene'?{name:need.name,prompt:[space?.text,sourcePrompt].filter(Boolean).join('\n'),sceneMeta,referenceIds}:null;
 if(sceneRecord){const spec=sceneAssetSpec(sceneRecord);sceneMeta.time=spec.time;sceneMeta.weather=spec.weather;}
 const prompt=need.role==='scene'?sceneFrontPrompt(sceneRecord,project):need.role==='prop'?propAssetPrompt({name:need.name,prompt:sourcePrompt,referenceIds},project):'';
 const episode=pageEpisode(project,page);
 const characterPrompt=need.role==='character'?buildCharacterAssetPrompt({project,need,settings,referencePlan,provenance,sourceDescription:sourcePrompt}):null;
 return {need,panel,referenceIds,scene,sceneMeta,payload:{identityReference:referencePlan.identitySelection||null,role:need.role,name:need.name,state,prompt:characterPrompt?.prompt||[prompt,referencePlan.guidance,settings.assetBrief&&'本资产补充要求：'+settings.assetBrief].filter(Boolean).join('\n'),...(characterPrompt?{originalAssetPrompt:characterPrompt.originalPrompt,assetPromptSource:characterPrompt.baseSource,assetPromptSha256:characterPrompt.baseSha256,promptFrameworkVersion:characterPrompt.version}:{}),settings,provenance,originalPrompt,newCandidate:true,clientRequestId:'reference-'+project.id+'-'+input.requestId,requester:'漫画工作台 · 本格参考',episode,scene,sceneMeta,usages:[{tool:'comic',episode,unitId:panel.name||shot.code||panel.id,shotId:panel.shotId,targetId:panel.id}]}};
}
