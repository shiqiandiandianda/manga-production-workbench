import {auditPanelReferences} from '../public/panel-reference-audit.js';
import {assetNameKey} from '../public/asset-metadata.js';
import {assetProvenance} from '../public/asset-provenance.js';
import {savedAssetRequirementSettings} from '../public/asset-workspace-model.js';
import {assetWorkspaceSettings} from '../public/asset-workspace-settings.js';
import {createReferenceAuditContext} from '../public/reference-audit-context.js';
import {assetUnavailable} from '../public/asset-availability.js';
import {blockingGroupsForPanel} from '../public/scene-blocking.js';
import {sceneBlockingPrompt,SCENE_BLOCKING_PROMPT_VERSION} from './scene-blocking-prompt.mjs';
const key=assetNameKey;
export function blockingAssetGenerationRequest(project,input,assets,need,panel,{preview=false}={}){
 const group=need.blockingContext;if(!group)throw Error('缺少此场景的分镜站位描述，请补充分镜资料');
 if(!group.sceneReady&&!preview)throw Object.assign(Error('请先选用场景参考图，再生成该图片的人物站位图'),{status:409});
 if(!group.characters.length&&!preview)throw Error('本场景尚未提供出场人物，请先补充分镜人物信息');
 const settings={...assetWorkspaceSettings({...savedAssetRequirementSettings(project,need),...input.settings}),sceneOutputMode:'front'},context=createReferenceAuditContext(project,assets),needs=[];
 for(const page of project.pages)for(const target of page.panels)if(blockingGroupsForPanel(project,target,context).some(g=>g.id===group.id))needs.push(...auditPanelReferences(project,target,assets,{referenceContext:context}).needs.filter(n=>n.purpose!=='blocking'));
 const referenceIds=[],references=[],missing=[];
 for(const expected of group.references){
  const same=needs.filter(n=>n.role===expected.role&&key(n.workspaceIdentity?.name||n.name)===key(expected.name));
  let matching=same.filter(n=>expected.role!=='character'||!expected.state||key(n.workspaceIdentity?.state||n.state)===key(expected.state));
  if(!matching.length&&expected.sourceId)matching=same.filter(n=>n.assetSourceId===expected.sourceId);
  const sceneAsset=expected.role==='scene'&&expected.assetId&&context.byId.get(expected.assetId),sceneBinding=group.sceneBinding,sceneValid=sceneAsset&&!assetUnavailable(sceneAsset)&&(!sceneBinding.sha256||sceneAsset.library?.sha256===sceneBinding.sha256)&&(!sceneBinding.revisionId||sceneAsset.library?.revisionId===sceneBinding.revisionId);
  const selected=expected.role==='scene'?(sceneValid?[sceneAsset.id]:[]):[...new Set(matching.flatMap(n=>n.selectedIds))];
  if(selected.length!==1){missing.push(expected.name+(expected.state?' · '+expected.state:'')+(selected.length>1?'（已采用多个版本，请明确本场景版本）':''));continue;}
  const id=selected[0];if(!referenceIds.includes(id))referenceIds.push(id);references.push({...expected,assetId:id,index:referenceIds.indexOf(id)+1});
 }
 if(missing.length&&!preview)throw Object.assign(Error('生成站位图前，请先为本场景选用参考图：'+missing.join('、')),{status:409});
 if(settings.generationReferenceAssetId){if(!assets.some(a=>a.id===settings.generationReferenceAssetId))throw Error('补充生成参考已不存在');if(!referenceIds.includes(settings.generationReferenceAssetId)){referenceIds.push(settings.generationReferenceAssetId);references.push({assetId:settings.generationReferenceAssetId,index:referenceIds.length,name:'补充空间参考',role:'scene'});}}
 const blocking={id:group.id,planId:group.plan?.id||'',scene:group.scene,characters:group.characters,references,description:[group.initialDescription,settings.assetBrief&&'本场景站位补充：'+settings.assetBrief].filter(Boolean).join('\n')};
 const prompt=sceneBlockingPrompt({name:need.name,blocking}),provenance=assetProvenance(project,panel,need),scene={location:group.scene,kind:'field'},sceneMeta={camera:'正上方俯视 · 姓名标注',time:group.plan?.time||'',weather:group.plan?.weather||''};
 return {need,panel,referenceIds,scene,sceneMeta,payload:{role:'scene',purpose:'blocking',blockingId:group.id,blocking,blockingTemplateVersion:SCENE_BLOCKING_PROMPT_VERSION,name:need.name,state:need.state,prompt,settings,provenance,originalPrompt:group.initialDescription,referencePreparation:{missing},newCandidate:true,episode:group.episode,scene,sceneMeta,clientRequestId:'reference-'+project.id+'-'+input.requestId,usages:[{tool:'comic',episode:group.episode,unitId:panel.name||panel.id,targetId:panel.id}]}};
}
