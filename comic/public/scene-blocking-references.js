import {auditPanelReferences} from './panel-reference-audit.js';
import {assetNameKey} from './asset-metadata.js';
import {assetUnavailable} from './asset-availability.js';
import {createReferenceAuditContext} from './reference-audit-context.js';
import {blockingGroupsForPanel,sceneBlockingGroups} from './scene-blocking.js';
import {characterIdentityMatches,stateReferenceMetadata} from './character-state-references.js';

export const blockingReferenceKey=ref=>JSON.stringify([ref.role,assetNameKey(ref.name),assetNameKey(ref.state||'')]);
/** The dialog and submission resolve exactly the same fixed image versions. */
export function blockingReferencePlan(project,need,assets,settings={}){
 const context=createReferenceAuditContext(project,assets),group=need.blockingContext||sceneBlockingGroups(project,context).find(g=>g.id===need.blockingId);
 if(!group)return {group:null,items:[],references:[],referenceIds:[],missing:['缺少此场景的分镜站位描述'],sceneTargets:[]};
 const needs=[];
 for(const page of project.pages)for(const panel of page.panels)if(blockingGroupsForPanel(project,panel,context).some(g=>g.id===group.id))for(const n of auditPanelReferences(project,panel,assets,{referenceContext:context}).needs)if(n.purpose!=='blocking')needs.push({...n,panelId:panel.id,episode:page.storyboard?.episode||group.episode});
 const items=[],referenceIds=[],references=[],missing=[],seen=new Set();
 for(const expected of group.references){
  const key=blockingReferenceKey(expected);if(seen.has(key))continue;seen.add(key);
  const same=needs.filter(n=>n.role===expected.role&&assetNameKey(n.workspaceIdentity?.name||n.name)===assetNameKey(expected.name));
  let matching=same.filter(n=>expected.role!=='character'||!expected.state||assetNameKey(n.workspaceIdentity?.state||n.state)===assetNameKey(expected.state));
  if(!matching.length&&expected.sourceId)matching=same.filter(n=>n.assetSourceId===expected.sourceId);
  const ids=expected.role==='scene'?[group.sceneBinding?.assetId].filter(Boolean):[...new Set(matching.flatMap(n=>n.selectedIds))],defaultAssetId=ids.length===1?ids[0]:null;
  const override=expected.role!=='scene'&&settings.blockingReferenceOverrides?.[key],binding=override||(expected.role==='scene'?group.sceneBinding:null),assetId=override?.assetId||defaultAssetId,asset=context.byId.get(assetId);
  let reason=!asset?(ids.length>1?'已选多个版本，请指定这一张站位图使用的版本':'尚未选用参考图'):assetUnavailable(asset)?'图片尚未确认或已禁用':binding&&(binding.sha256&&asset.library?.sha256!==binding.sha256||binding.revisionId&&asset.library?.revisionId!==binding.revisionId)?'图片固定版本已变化，请重新选择':'';
  if(override&&expected.role==='character'&&asset&&!characterIdentityMatches(expected,stateReferenceMetadata(project,asset),asset))reason='所选图片的人物身份不符，请重新选择'+expected.name;
  const item={...expected,key,assetId:reason?null:assetId,defaultAssetId,overridden:!!override,reason};items.push(item);
  if(reason){missing.push(expected.name+(expected.state?' · '+expected.state:'')+'（'+reason+'）');continue;}
  if(!referenceIds.includes(assetId))referenceIds.push(assetId);references.push({...expected,assetId,index:referenceIds.indexOf(assetId)+1});
 }
 const sceneTargets=needs.filter(n=>n.role==='scene'&&n.selectedIds.some(id=>id===group.sceneBinding?.assetId||context.byId.get(id)?.library?.sha256&&context.byId.get(id).library.sha256===group.sceneBinding?.sha256)).map(n=>({panelId:n.panelId,needId:n.id}));
 return {group,items,referenceIds,references,missing,sceneTargets};
}
