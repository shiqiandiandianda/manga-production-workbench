import {panelTextAssets} from '../public/panel-text-assets.js';
import {prepareProductionFrame,productionJobSignature,productionSourceAsset,productionSegment} from '../public/production-package-model.js';
import {panelProductionShot,panelContentKey} from '../public/panel-generation.js';
import {panelReferenceKey} from '../public/panel-references.js';
import {verifyProductionReferenceFiles,productionReferenceVersions} from './production-reference-files.mjs';
/** Compare derived screen references against the authoritative package, not a stale editor cache. */
export function packageResultView(project,frame,assets,signature){
 if(!signature||!frame||!frame.productionSegment&&!frame.productionBackground)return {project,frame,signatureUnchanged:true};
 if(productionJobSignature(project,frame)!==signature)return {project,frame,signatureUnchanged:false};
 const canonical=structuredClone(project),target=canonical.pages.flatMap(p=>p.panels).find(p=>p.id===frame.id);
 prepareProductionFrame(canonical,target,assets);return {project:canonical,frame:target,signatureUnchanged:true};
}
export function preparePackageJob(project,frame,assets,panelIds,jobs){
 const plan=prepareProductionFrame(project,frame,assets,{deferPanelIds:panelIds,jobs});if(!plan)return null;
 verifyProductionReferenceFiles(plan,assets);
 for(const dep of plan.dependencies)if(!panelIds.includes(dep)&&!jobs.some(j=>j.projectId===project.id&&j.panelId===dep&&['queued','running','awaiting_confirmation','recoverable'].includes(j.status)))throw Object.assign(Error('接续前段尚无成图：请同时选前段生成，或在资料面板跳过可选接续参考'),{status:409});return plan;
}
export function packageJobReady(job,store){
 if(!job.productionDependencies?.length)return true;const project=store.db.projects.find(p=>p.id===job.projectId&&!p.deletedAt);return !!project&&job.productionDependencies.every(id=>{const current=productionSourceAsset(project.pages.flatMap(p=>p.panels).find(f=>f.id===id));if(!current)return false;const latest=store.db.jobs.filter(j=>j.projectId===job.projectId&&j.panelId===id).at(-1);return !latest||latest.status==='done'&&latest.assetId===current;});
}
export function packageJobWait(job,store){
 if(job.status!=='queued'||!job.productionDependencies?.length)return null;
 const project=store.db.projects.find(p=>p.id===job.projectId&&!p.deletedAt);if(!project)return null;
 for(const panelId of job.productionDependencies){
  const frame=project.pages.flatMap(p=>p.panels).find(f=>f.id===panelId),current=productionSourceAsset(frame),latest=store.db.jobs.filter(j=>j.projectId===job.projectId&&j.panelId===panelId).at(-1);
  if(current&&(!latest||latest.status==='done'&&latest.assetId===current))continue;
  const segment=productionSegment(project,frame?.productionSegment),name=segment?.id||frame?.name||'前段',active=latest&&['queued','running','awaiting_confirmation','recoverable','delegated'].includes(latest.status),candidate=latest?.status==='done'&&latest.assetId;
  return {code:active?'upstream-active':candidate?'adopt-result':latest?.status==='failed'||latest?.status==='cancelled'?'upstream-failed':'missing-result',panelId,jobId:latest?.id||null,assetId:candidate||null,message:active?'等待 '+name+' 成图（前段'+(latest.status==='queued'?'排队中':'处理中')+'，本段尚未提交生图）':candidate?name+' 已生成，等待采用候选图后接续':'等待 '+name+' 已采用成图'+(latest?.status==='failed'?'（前段生成失败）':latest?.status==='cancelled'?'（前段已取消）':'')+'；本段尚未提交生图'};
 }return null;
}
export function refreshPackageJob(job,store){
 if(!job.productionSignature)return;const project=store.project(job.projectId),frame=project.pages.flatMap(p=>p.panels).find(f=>f.id===job.panelId);if(!frame||productionJobSignature(project,frame)!==job.productionSignature)throw Error('排队期间资料版本、提示词或附图绑定已改变，未执行旧任务');const plan=prepareProductionFrame(project,frame,store.db.assets);if(plan.dependencies.length)throw Error('接续前段尚未完成');job.input.referenceRoles=plan.refs;job.input.textAssetReferences=panelTextAssets(project,frame,store.db.assets);job.input.shot=panelProductionShot(project,frame,store.db.assets);job.panelContentKey=panelContentKey(project,frame,store.db.assets);job.referenceKey=panelReferenceKey(project,frame,store.db.assets);
 verifyProductionReferenceFiles(plan,store.db.assets);
 job.input.productionSource={packageId:project.productionPackage.id,packageHash:project.productionPackage.hash,segmentId:plan.segment.id,source:plan.segment.source,promptSource:frame.generation?.promptSource||'imported',originalPrompt:job.input.shot.description,textAssetReferences:job.input.textAssetReferences,referenceVersions:productionReferenceVersions(project,frame,plan.refs,store.db.assets),referenceOrder:plan.refs.map(r=>r.assetId)};
}
