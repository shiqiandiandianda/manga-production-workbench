export function activeRemovalTargets(entry){return entry.activeTargets||[];}
/** Gallery deletion always uses the current episode, even in whole-work browsing. */
export function galleryRemovalTargets(row,episode){
 if(!row?.assetIds?.length)throw Error('这项资产尚未选用图片');
 const uses=row.uses.filter(use=>use.episode===episode&&!use.text&&!use.skipped);
 if(!uses.length)throw Error('本话没有这项资产的用图位置，请切换到对应话');
 if(uses.some(use=>use.locked))throw Error('本话有使用位置已锁定，请先解锁，或在详情中调整删除范围');
 return [...new Map(uses.map(({panelId,needId})=>[panelId+':'+needId,{panelId,needId}])).values()];
}
export function removedReferenceIds(project,panelId,needId){return [...new Set((project.assetWorkspaceTrash||[]).flatMap(entry=>activeRemovalTargets(entry).filter(t=>t.panelId===panelId&&t.needId===needId).flatMap(t=>t.assetIds||[])))];}
export function acknowledgeReferenceSelection(project,panelId,needId){for(const entry of project.assetWorkspaceTrash||[])entry.activeTargets=activeRemovalTargets(entry).filter(t=>t.panelId!==panelId||t.needId!==needId);}
export function withRemovedReference(project,panel,need){const ids=new Set(removedReferenceIds(project,panel.id,need.id));if(!ids.size)return need;const selectedIds=need.selectedIds.filter(id=>!ids.has(id)),conflictingIds=(need.conflictingIds||[]).filter(id=>!ids.has(id)),recommendedId=ids.has(need.recommendedId)?null:need.recommendedId;return {...need,selectedIds,conflictingIds,recommendedId,status:conflictingIds.length?'conflict':selectedIds.length?'ready':recommendedId?'available':'missing',blocking:!!conflictingIds.length||!need.optional&&!selectedIds.length,removed:true};}

 export function remapWorkspaceRemovals(project,assetMap,panelMap){for(const choice of Object.values(project.assetWorkspaceChoices?.items||{}))if(choice.assetId)choice.assetId=assetMap.get(choice.assetId)||choice.assetId;for(const entry of project.assetWorkspaceTrash||[])for(const item of entry.activeTargets||[]){item.panelId=panelMap.get(item.panelId)||item.panelId;item.assetIds=(item.assetIds||[]).map(id=>assetMap.get(id)||id);if(item.needBinding?.assetId)item.needBinding.assetId=assetMap.get(item.needBinding.assetId)||item.needBinding.assetId;if(item.production?.binding?.assetId)item.production.binding.assetId=assetMap.get(item.production.binding.assetId)||item.production.binding.assetId;}return project;}
