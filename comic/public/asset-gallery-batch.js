import {assetUnavailable} from './asset-availability.js';
import {assetNameKey} from './asset-metadata.js';
import {exactAssetMatch,assetRequirementSearch} from './asset-exact-search.js';
import {unknownState,libraryStatePlaceholder} from './character-states.js';
import {mokuCandidate,mokuRevision,usableMokuImage} from './moku-reference-search.js';
import {isBlockingAsset} from './scene-blocking.js';
import {automaticCharacterIdentity} from './character-identity-reference.js';

// Automatic adoption additionally requires the current production, a complete
// search and a uniquely identified fixed version. An unspecified costume does
// not prevent use of the sole exact character card, or alter source wording.
export function exactGalleryAsset(row,asset){
 if(!asset||row.removedAssetIds?.includes(asset.id)||row.removedRevisionIds?.includes(asset.library?.revisionId)||assetUnavailable(asset))return false;
 if(row.purpose==='blocking'?asset.referenceGeneration?.blockingId!==row.blockingId:isBlockingAsset(asset))return false;
 if(!exactAssetMatch(asset,row.name,assetRequirementSearch(row)))return false;
 return row.role!=='character'||!unknownState(row.state)||!!automaticCharacterIdentity({},[asset],row,{remote:true}).assetId;
}
/** Reuse an already adopted version; a cached search/identity image is not a selection. */
export function adoptedGalleryAsset(row,assets){
 const exact=assets.filter(a=>row.assetIds.includes(a.id));
 if(exact.length!==new Set(row.assetIds).size||exact.some(a=>!a.library?.revisionId||!/^[a-f0-9]{64}$/.test(a.library.sha256||'')||!exactGalleryAsset(row,a)))return null;
 const unique=[...new Map(exact.map(a=>[(a.library.assetId||a.id)+'@'+a.library.revisionId,a])).values()];
 return unique.length===1?unique[0]:null;
}
export function automaticGalleryMatch(row,items,{projectIds=[],complete=true}={}){
 const exact=items.filter(i=>usableMokuImage(i)&&projectIds.includes(i.projectId)&&exactGalleryAsset(row,mokuCandidate(i)));
 const unique=[...new Map(exact.map(i=>[i.id+'@'+mokuRevision(i),i])).values()];
 return complete&&unique.length===1?unique[0]:null;
}
export function galleryGenerationState(row,records=[],{candidateCount=0}={}){
 if(records.some(r=>['queued','running','claimed','recoverable','delegated','awaiting_confirmation'].includes(r.status)))return 'active';
 if(row.assetIds.length)return 'image';
 if(records.some(r=>r.available))return 'result';
 if(row.status==='text')return 'text';
 if(row.availableIds.length||candidateCount)return 'image';
 return 'missing';
}

/** A same-project scene result is visible on every exact scene requirement card. */
export function galleryRecordAssignments(rows,record,{projectId}={}){
 if(record.context?.projectId!==projectId||record.source?.projectId&&record.source.projectId!==projectId)return [];
 const exact=record.role==='scene'&&record.source?.projectId===projectId?rows.filter(row=>row.role==='scene'&&(row.purpose==='blocking'?record.source?.purpose==='blocking'&&record.source.blockingId===row.blockingId:!isBlockingAsset(record))&&assetNameKey(row.name)===assetNameKey(record.name)):[];
 const candidates=exact.length?exact:rows.filter(row=>row.uses.some(u=>u.panelId===record.context.panelId&&u.needId===record.context.needId));
 return candidates.map(row=>{const use=row.uses.find(u=>u.panelId===record.source?.panelId&&u.needId===record.source?.needId)||row.uses.find(u=>u.panelId===record.context.panelId&&u.needId===record.context.needId)||row.uses[0];return {row,record:{...record,requirementKey:row.key,context:{projectId,panelId:use.panelId,needId:use.needId},...(exact.length&&record.matchNote==='场景名称相近，请核对后采用'?{matchNote:''}:{})}};});
}

/** Explicit result return may replace text-only references; ordinary background checks preserve them. */
export function galleryReturnDecision(row,records=[],{projectId,includeText=false}={}){
 const targets=row.uses.filter(u=>!u.locked&&!u.skipped&&(u.text?includeText:u.missing)).map(u=>({panelId:u.panelId,needId:u.needId}));
 if(!targets.length)return {status:'skip',reason:'已有图片、文生，或使用位置不可编辑'};
 const nameKey=assetNameKey(row.name),relevant=records.filter(r=>!r.deletedAt&&!row.removedRecordIds?.includes(r.id)&&r.context?.projectId===projectId&&(!r.source?.projectId||r.source.projectId===projectId)&&r.role===row.role&&(row.purpose==='blocking'?r.source?.purpose==='blocking'&&r.source.blockingId===row.blockingId:!isBlockingAsset(r))&&((row.key&&r.requirementKey===row.key)||(nameKey&&assetNameKey(r.name)===nameKey)));
 if(relevant.some(r=>['queued','running','claimed','recoverable','delegated','awaiting_confirmation'].includes(r.status)))return {status:'skip',reason:'已有任务进行中，完成后可再次接回'};
 const available=relevant.filter(r=>r.available);
 const generatedForRequirement=r=>libraryStatePlaceholder(row.state)&&r.source?.projectId===projectId&&row.uses.some(u=>u.panelId===r.source.panelId&&u.needId===r.source.needId);
 const complete=[...new Map(available.filter(r=>['completed','legacy'].includes(r.status)&&r.partial===false&&r.imageUrl&&!r.matchNote&&(row.role!=='character'||generatedForRequirement(r)||!unknownState(row.state)&&assetNameKey(r.state)===assetNameKey(row.state))).map(r=>[r.id,r])).values()];
 if(complete.length===1&&new Set(available.map(r=>r.id)).size===1)return {status:'ready',record:complete[0],targets};
 if(available.length||records.some(r=>r.available&&r.context?.projectId===projectId))return {status:'review',reason:available.length>1?'有多份结果，请在生成记录中选定':'部分结果或身份、服装需核对，请在生成记录中选定'};
 return {status:'skip',reason:'暂无可接回的完整结果'};
}
