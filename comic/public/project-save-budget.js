import {HISTORY_LIMITS,ensureLayoutHistory,historyJsonBytes,evictOldestLayoutHalf} from './layout-history.js';

export const EDITOR_SAVE_BYTE_LIMIT=HISTORY_LIMITS.bytes;
// Accept an old open editor's oversized request so it can save before reloading.
// This compatibility ceiling applies only to project PUT, never other upload routes.
export const EDITOR_SAVE_COMPATIBILITY_LIMIT=32*1024*1024;
export const EDITOR_SERVER_FIELDS=Object.freeze(['productionAssets','sourceOriginalFiles','assetLibrary','productionPackage','teamwork','characterOutfitOverrides','internalAssetWorkspace']);

/** Only audit records are evicted; current art, text, source data and baseline are protected. */
export function rotateProjectHistory(project,{byteLimit=EDITOR_SAVE_BYTE_LIMIT}={}){
 const before=project.layoutHistory?.evictedRecords||0;
 if(!project.layoutHistory)return {removed:0,bytes:historyJsonBytes(project)};
 const history=ensureLayoutHistory(project);let bytes=historyJsonBytes(project);
 while(bytes>=byteLimit&&history.records.length){evictOldestLayoutHalf(history);bytes=historyJsonBytes(project);}
 return {removed:history.evictedRecords-before,bytes};
}

export function prepareProjectSave(project,options={}){
 const rotation=rotateProjectHistory(project,options),snapshot=JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(project).filter(([key])=>!EDITOR_SERVER_FIELDS.includes(key))))),bytes=historyJsonBytes(snapshot);
 if(bytes>EDITOR_SAVE_COMPATIBILITY_LIMIT)throw Error('当前工程正文超过保存请求上限；画面和图片仍保留，请先导出工程备份。');
 return {snapshot,bytes,removed:rotation.removed,totalBytes:rotation.bytes};
}

/** A save acknowledgement must not discard edits completed while the request was in flight. */
export function mergeSavedHistory(current,sent,saved){
 if(current?.id!==saved?.id||!current.layoutHistory||!sent.layoutHistory||!saved.layoutHistory)return 0;
 const retained=new Set(saved.layoutHistory.records.map(r=>r.id)),expired=new Set(sent.layoutHistory.records.filter(r=>!retained.has(r.id)).map(r=>r.id)),history=current.layoutHistory,before=history.records.length;
 history.records=history.records.filter(r=>!expired.has(r.id));const removed=before-history.records.length;
 history.evictedRecords=Math.max((history.evictedRecords||0)+removed,saved.layoutHistory.evictedRecords||0);history.pruneCycles=Math.max(history.pruneCycles||0,saved.layoutHistory.pruneCycles||0);
 history.bytePolicy=saved.layoutHistory.bytePolicy;history.limits={...saved.layoutHistory.limits};return removed;
}
