import {assetUnavailable} from './asset-availability.js';
import {unknownState} from './character-states.js';
import {characterPreparationNote} from './character-preparation.js';
import {withRemovedReference} from './asset-workspace-removal.js';
import {withTextAssetReference,filterTextAssetImages} from './asset-text-references.js';
import {productionExtraNeeds,productionReferenceSubject} from './production-extra-references.js';
import {productionSegment,productionFrame,productionSourceAsset} from './production-package-model.js';
import {stateReferenceMetadata,manualStateReferenceConfirmed} from './character-state-references.js';
import {assetNameKey} from './asset-metadata.js';
import {productionReferenceOutfit} from './episode-outfit.js';
import {createReferenceAuditContext} from './reference-audit-context.js';
import {withWorkspaceRequirementIdentity} from './asset-requirement-identity.js';
import {isBlockingReference,withBlockingIdentity,sceneBlockingExtraNeeds,isBlockingAsset} from './scene-blocking.js';
const forbidden=a=>assetUnavailable(a);
export function productionAssetMatch(project,ref,asset,referenceContext){
 if(!asset||forbidden(asset))return {identity:false,exact:false};
 if(isBlockingReference(ref)!==isBlockingAsset(asset))return {identity:false,exact:false};
 const key=assetNameKey;
 if(ref['类型']==='设定卡'){
  const cached=referenceContext?.assetInfo(asset),meta=cached?.meta||stateReferenceMetadata(project,asset);
  const stem=String(asset.name||'').replace(/\.(png|jpe?g|webp|avif)$/i,'');
  const identity=!meta.identityOnly&&(cached?cached.identityKeys.has(key(ref['人物'])):[meta.name,...meta.aliases,...stem.split(/[_\s·|]+/u)].some(n=>key(n)===key(ref['人物'])));
  const outfit=referenceContext?referenceContext.outfit(ref):productionReferenceOutfit(project,ref),states=[...(meta.stateLabels||[]),...meta.parts],exact=identity&&!!outfit&&(cached?cached.stateKeys.has(key(outfit)):states.some(n=>key(n)===key(outfit)));
  return {identity,exact,stateConflict:identity&&!unknownState(outfit)&&!!meta.stateLabels?.length&&!exact};
 }
 const expected=referenceContext?referenceContext.expectedFile(ref):String(ref['说明']||'').match(/[^\s（）()]+\.(?:png|jpe?g|webp)/i)?.[0];
 const filenameMatch=!!expected&&[asset.name,asset.sourceName,asset.library?.sourceName].filter(Boolean).some(name=>key(name)===key(expected));
 return {identity:filenameMatch,exact:filenameMatch};
}
export function productionBindingDraft(project,panel,referenceContext){
 const s=referenceContext?referenceContext.segments.get(panel.productionSegment):productionSegment(project,panel.productionSegment);return s?s.references.map(r=>({slot:r.slot,assetId:r.binding?.assetId||null,skip:r.skipped===true})):[];
}
export function auditProductionReferences(project,panel,assets,{referenceContext=createReferenceAuditContext(project,assets),bindings=productionBindingDraft(project,panel,referenceContext)}={}){
 const segment=referenceContext.segments.get(panel.productionSegment),byId=referenceContext.byId;
 if(!segment)return {panelId:panel.id,needs:[],ids:[],additions:[],missing:[],unknown:[],coverageEnforced:false,ready:true,summary:'共用底图仅采用整段成图的色调参考'};
 const needs=segment.references.map(ref=>{
  const choice=bindings.find(r=>r.slot===ref.slot),optional=!ref['必须'];let assetId=choice?.assetId;
  if(ref['类型']==='上一段成图'){
   const episode=referenceContext.episodes.get(segment.episode),prior=episode.segments.find(s=>s.localId===ref['段ID']);assetId=choice?.skip?null:productionSourceAsset(referenceContext.frames.get(prior?.id));
  }
  const asset=byId.get(assetId),outfit=referenceContext.outfit(ref),candidates=ref['类型']==='上一段成图'?[]:ref['类型']==='设定卡'?referenceContext.characterCandidates(ref['人物']):referenceContext.expectedFile(ref)?assets.filter(a=>productionAssetMatch(project,ref,a,referenceContext).identity):[],exact=candidates.filter(a=>productionAssetMatch(project,ref,a,referenceContext).exact),existing=exact.filter(a=>panel.referenceIds?.includes(a.id)),recommendedId=existing.length===1?existing[0].id:exact.length===1?exact[0].id:null;
  const confirmationNeed={id:segment.id+'@'+ref.slot,name:productionReferenceSubject(ref),role:ref['类型']==='设定卡'?'character':'other',state:outfit||''},manuallyConfirmed=asset&&manualStateReferenceConfirmed(panel,confirmationNeed,asset,referenceContext.meta(asset));
  const bad=asset&&(forbidden(asset)||productionAssetMatch(project,ref,asset,referenceContext).stateConflict&&!manuallyConfirmed),status=bad?'conflict':asset?'ready':recommendedId?'available':'missing';
  return {id:segment.id+'@'+ref.slot,slot:ref.slot,production:true,name:productionReferenceSubject(ref),role:ref['类型']==='设定卡'?'character':ref['类型'].includes('场景')?'scene':/道具/.test(ref['类型'])?'prop':'style',state:outfit||ref['说明']||ref['段ID']||'',required:!optional,optional,skipped:choice?.skip===true,predecessor:ref['类型']==='上一段成图',assetSourceId:ref.assetSourceId,assetSourceVersion:ref.assetSourceVersion,selectedIds:asset&&!bad?[asset.id]:[],conflictingIds:bad?[asset.id]:[],recommendedId,candidates,status,blocking:!!bad||!optional&&(status!=='ready'),manualStateConfirmed:!!manuallyConfirmed,reason:bad?'参考服装与本格需求冲突':manuallyConfirmed?'服装名称不同，已人工核对固定版本':exact.length>1?'同服装有多个版本，请看图指定':'按人物和服装核对'};
 }).map(need=>{const ref=segment.references.find(r=>r.slot===need.slot);return withTextAssetReference(panel,withRemovedReference(project,panel,withBlockingIdentity(project,panel,{...need,preparationNote:need.role==='character'?(ref?.preparationNote||characterPreparationNote(ref?.['服装'])):''},ref,referenceContext)));});
 needs.push(...productionExtraNeeds(project,panel,assets,referenceContext));
 needs.push(...sceneBlockingExtraNeeds(project,panel,assets,referenceContext));
 for(let i=0;i<needs.length;i++)needs[i]=withWorkspaceRequirementIdentity(project,panel,needs[i],referenceContext);
 const ids=[...new Set(needs.flatMap(n=>n.selectedIds))],missing=needs.filter(n=>n.blocking),unknown=bindings.filter(r=>r.assetId&&!byId.has(r.assetId)&&!needs.some(n=>n.slot===r.slot&&n.status==='text')).map(r=>r.assetId),additions=[...new Set(needs.filter(n=>n.status==='available').map(n=>n.recommendedId))];
 return {panelId:panel.id,needs,ids,additions,missing,unknown,coverageEnforced:true,ready:!missing.length&&!unknown.length,summary:'屏段附图：'+needs.filter(n=>n.role==='character').length+' 位人物；已绑定 '+needs.filter(n=>['ready','text'].includes(n.status)).length+'/'+needs.length+' 项'};
}
export function planProductionReferences(project,panel,assets){
 const bindings=productionBindingDraft(project,panel),audit=auditProductionReferences(project,panel,assets),matches=[],issues=[];
 for(const need of audit.needs){
  if(need.status==='text')continue;
  if(need.supplemental){if(need.selectedIds.length)matches.push({name:need.name,role:need.role,assetId:need.selectedIds[0],needId:need.id,reason:'保留已确认的'+(need.role==='scene'?'场景':'道具')+'参考'});continue;}
  const assetId=need.selectedIds[0]||need.recommendedId;
  if(assetId&&!need.predecessor&&!need.skipped){const choice=bindings.find(r=>r.slot===need.slot);choice.assetId=assetId;choice.skip=false;matches.push({name:need.name,role:need.role,assetId,slot:need.slot,needId:need.id,reason:need.selectedIds.length?'保留已确认附图':'人物与服装唯一匹配'});}
  else if(!need.predecessor&&!need.skipped&&need.status!=='ready')issues.push({name:need.name,role:need.role,state:need.state,slot:need.slot,needId:need.id,optional:need.optional,status:need.candidates.length?'review':'missing',message:need.candidates.length?'同名人物有多个版本或服装待确认，点换图选择':need.optional?'可选附图，可直接跳过':'未找到对应人物服装的设定卡'});
 }
 const ids=filterTextAssetImages(panel,[...new Set([...bindings.map(r=>r.assetId).filter(Boolean),...audit.needs.filter(n=>n.supplemental).flatMap(n=>n.selectedIds)])]),before=new Set(audit.ids);
 return {productionBindings:bindings,requirements:{version:1,participants:audit.needs.filter(n=>n.role==='character').map(n=>n.name).join('、')},ids,matches,issues,needs:audit.needs,added:ids.filter(id=>!before.has(id)).length,summary:'已匹配 '+matches.length+' 项 · 新增 '+ids.filter(id=>!before.has(id)).length+' 张 · 待确认 '+issues.filter(i=>!i.optional).length+' 项'+(issues.some(i=>i.optional)?' · 可选 '+issues.filter(i=>i.optional).length+' 项':'')};
}
