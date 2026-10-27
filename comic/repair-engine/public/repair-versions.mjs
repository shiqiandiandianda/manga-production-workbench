const order=layer=>String(layer.jobOrder||layer.jobId||'');
export function regionLayers(region,layers){return layers.filter(layer=>layer.type==='image'&&(layer.regionId===region.id||(!!region.jobId&&layer.jobId===region.jobId)));}
export function chosenRegionLayer(region,layers){
 const list=regionLayers(region,layers);return (region.versionPinned&&list.find(layer=>layer.jobId===region.selectedVersionJobId))||[...list].sort((a,b)=>order(b).localeCompare(order(a)))[0]||null;
}
export function normalizeRepairVersions(regions,layers){
 const selected=new Map();for(const layer of layers)if(layer.type==='image'&&!layer.jobId&&!layer.regionId&&!regions.some(region=>regionLayers(region,[layer]).length))delete layer.versionHidden;for(const region of regions){const list=regionLayers(region,layers),chosen=chosenRegionLayer(region,layers);if(chosen)selected.set(region.id,chosen);for(const layer of list)layer.versionHidden=layer!==chosen;}
 for(const layer of layers)if(layer.originJobId){const chosen=selected.get(layer.originRegionId);layer.versionHidden=!!chosen&&chosen.jobId!==layer.originJobId;}
 return selected;
}
export function repairVersionTasks(region,tasks){return [...tasks].filter(task=>task.regionId===region.id||task.id===region.jobId||task.id===region.selectedVersionJobId).filter(task=>!!task.result&&(!task.automation||task.automation.status==='completed')).sort((a,b)=>String(a.orderAt||a.createdAt||a.id).localeCompare(String(b.orderAt||b.createdAt||b.id)));}

export function restorePreviousVersion(region,layers,tasks,discardedJobId){
 const candidates=regionLayers(region,layers).filter(layer=>layer.jobId!==discardedJobId&&![...tasks].some(task=>task.id===layer.jobId&&task.decision==='discarded'));
 const previous=[...candidates].sort((a,b)=>order(b).localeCompare(order(a)))[0]||null;
 region.selectedVersionJobId=previous?.jobId||null;region.versionPinned=!!previous;region.selectedVersionUpdatedAt=Date.now();
 if(previous){previous.visible=true;region.locked=!!previous.locked;}return previous;
}
