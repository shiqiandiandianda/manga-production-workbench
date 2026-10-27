import {assetUnavailable} from './asset-availability.js';
import {assetMetadata,assetNameKey} from './asset-metadata.js';
import {unknownState,libraryStatePlaceholder} from './character-states.js';
import {mokuCandidate,mokuRevision,usableMokuImage} from './moku-reference-search.js';

// Automatic adoption is deliberately narrower than the visual search results.
// Similar names, another production and unspecified costumes stay selectable.
export function exactGalleryAsset(row,asset){
 if(!asset||row.removedAssetIds?.includes(asset.id)||row.removedRevisionIds?.includes(asset.library?.revisionId)||assetUnavailable(asset))return false;
 const meta=assetMetadata(asset),same=meta.role===row.role&&[meta.name,...meta.aliases].some(n=>assetNameKey(n)===assetNameKey(row.name));
 return same&&(row.role!=='character'||!unknownState(row.state)&&assetNameKey(meta.state)===assetNameKey(row.state));
}
export function automaticGalleryMatch(row,items,{projectIds=[],complete=true}={}){
 const exact=items.filter(i=>usableMokuImage(i)&&projectIds.includes(i.projectId)&&exactGalleryAsset(row,mokuCandidate(i)));
 const unique=[...new Map(exact.map(i=>[i.id+'@'+mokuRevision(i),i])).values()];
 return complete&&unique.length===1?unique[0]:null;
}
export function galleryGenerationState(row,records=[],{candidateCount=0}={}){
 if(row.status==='text')return 'text';
 if(records.some(r=>['queued','running','claimed','recoverable','delegated','awaiting_confirmation'].includes(r.status)))return 'active';
 if(row.assetIds.length||row.availableIds.length||candidateCount)return 'image';
 if(records.some(r=>r.available))return 'result';
 return 'missing';
}

/** A same-project scene result is visible on every exact scene requirement card. */
export function galleryRecordAssignments(rows,record,{projectId}={}){
 if(record.context?.projectId!==projectId||record.source?.projectId&&record.source.projectId!==projectId)return [];
 const exact=record.role==='scene'&&record.source?.projectId===projectId?rows.filter(row=>row.role==='scene'&&assetNameKey(row.name)===assetNameKey(record.name)):[];
 const candidates=exact.length?exact:rows.filter(row=>row.uses.some(u=>u.panelId===record.context.panelId&&u.needId===record.context.needId));
 return candidates.map(row=>{const use=row.uses.find(u=>u.panelId===record.source?.panelId&&u.needId===record.source?.needId)||row.uses.find(u=>u.panelId===record.context.panelId&&u.needId===record.context.needId)||row.uses[0];return {row,record:{...record,context:{projectId,panelId:use.panelId,needId:use.needId},...(exact.length&&record.matchNote==='场景名称相近，请核对后采用'?{matchNote:''}:{})}};});
}

/** Only fill missing, editable uses with one complete and unambiguous result. */
export function galleryReturnDecision(row,records=[],{projectId}={}){
 const targets=row.uses.filter(u=>u.missing&&!u.locked&&!u.skipped&&!u.text).map(u=>({panelId:u.panelId,needId:u.needId}));
 if(!targets.length)return {status:'skip',reason:'已有图片、文生，或使用位置不可编辑'};
 const relevant=records.filter(r=>!r.deletedAt&&!row.removedRecordIds?.includes(r.id)&&r.context?.projectId===projectId&&(!r.source?.projectId||r.source.projectId===projectId)&&r.role===row.role&&assetNameKey(r.name)===assetNameKey(row.name));
 if(relevant.some(r=>['queued','running','claimed','recoverable','delegated','awaiting_confirmation'].includes(r.status)))return {status:'skip',reason:'已有任务进行中，完成后可再次接回'};
 const available=relevant.filter(r=>r.available);
 const generatedForRequirement=r=>libraryStatePlaceholder(row.state)&&r.source?.projectId===projectId&&row.uses.some(u=>u.panelId===r.source.panelId&&u.needId===r.source.needId);
 const complete=[...new Map(available.filter(r=>['completed','legacy'].includes(r.status)&&r.partial===false&&r.imageUrl&&!r.matchNote&&(row.role!=='character'||generatedForRequirement(r)||!unknownState(row.state)&&assetNameKey(r.state)===assetNameKey(row.state))).map(r=>[r.id,r])).values()];
 if(complete.length===1&&new Set(available.map(r=>r.id)).size===1)return {status:'ready',record:complete[0],targets};
 if(available.length||records.some(r=>r.available&&r.context?.projectId===projectId))return {status:'review',reason:available.length>1?'有多份结果，请在生成记录中选定':'部分结果或身份、服装需核对，请在生成记录中选定'};
 return {status:'skip',reason:'暂无可接回的完整结果'};
}
