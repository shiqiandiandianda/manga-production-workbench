import {blockingReferencePlan} from '../public/scene-blocking-references.js';
import {assetProvenance} from '../public/asset-provenance.js';
import {savedAssetRequirementSettings} from '../public/asset-workspace-model.js';
import {assetWorkspaceSettings} from '../public/asset-workspace-settings.js';
import {sceneBlockingPrompt,SCENE_BLOCKING_PROMPT_VERSION} from './scene-blocking-prompt.mjs';
export function blockingAssetGenerationRequest(project,input,assets,need,panel,{preview=false}={}){
 const group=need.blockingContext;if(!group)throw Error('缺少此场景的分镜站位描述，请补充分镜资料');
 if(!group.sceneReady&&!preview)throw Object.assign(Error('请先选用场景参考图，再生成该图片的人物站位图'),{status:409});
 if(!group.characters.length&&!preview)throw Error('本场景尚未提供出场人物，请先补充分镜人物信息');
 const settings={...assetWorkspaceSettings({...savedAssetRequirementSettings(project,need),...input.settings}),sceneOutputMode:'front'},plan=blockingReferencePlan(project,need,assets,settings),{referenceIds,references,missing}=plan;
 if(missing.length&&!preview)throw Object.assign(Error('生成站位图前，请先为本场景选用参考图：'+missing.join('、')),{status:409});
 const blocking={id:group.id,planId:group.plan?.id||'',scene:group.scene,characters:group.characters,references,description:[group.initialDescription,settings.assetBrief&&'本场景站位补充：'+settings.assetBrief].filter(Boolean).join('\n')};
 const prompt=sceneBlockingPrompt({name:need.name,blocking}),provenance=assetProvenance(project,panel,need),scene={location:group.scene,kind:'field'},sceneMeta={camera:'正上方俯视 · 姓名标注',time:group.plan?.time||'',weather:group.plan?.weather||''};
 return {need,panel,referenceIds,scene,sceneMeta,payload:{role:'scene',purpose:'blocking',blockingId:group.id,blocking,blockingTemplateVersion:SCENE_BLOCKING_PROMPT_VERSION,name:need.name,state:need.state,prompt,settings,provenance,originalPrompt:group.initialDescription,referencePreparation:{missing,items:plan.items},newCandidate:true,episode:group.episode,scene,sceneMeta,clientRequestId:'reference-'+project.id+'-'+input.requestId,usages:[{tool:'comic',episode:group.episode,unitId:panel.name||panel.id,targetId:panel.id}]}};
}
