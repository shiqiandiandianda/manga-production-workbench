/** Read-only preview sources. A returned project's frozen geometry wins over a later draft. */
export function episodePreviewSource(project,episode,scriptId=null){
 const number=Number(episode),returned=project.autoLayoutSource;
 if(returned?.mode==='screen-crop-reflow'&&Number(returned.episode)===number)return {kind:'artwork',episode:number,scriptId:returned.scriptId};
 const binding=project.layoutRuleBindings?.[number],source=project.layoutPlanningSource;
 if(binding?.targetPanels?.length){
  const panels=structuredClone(binding.targetPanels);
  return {kind:'frozen',episode:number,scriptId:binding.scriptId||(Number(source?.episode)===number?source.scriptId:null),binding,geometry:binding.geometry?structuredClone(binding.geometry):{canvas:{width:1280,height:Math.ceil(Math.max(...panels.map(p=>p.y+p.h))+80)},panels,backgrounds:[]}};
 }
 return {kind:'draft',episode:number,scriptId};
}
export function acceptsPreviewPacket(source,project,script,packet){
 if(!script||!packet||script.id!==source.scriptId||Number(script.episode)!==source.episode||packet.canvas?.width!==1280||!Array.isArray(packet.panels)||!packet.panels.length)return false;
 if(source.kind==='frozen')return script.layoutRuleContract?.digest===source.binding.contract.digest&&JSON.stringify(packet.panels)===JSON.stringify(source.binding.targetPanels)&&(!source.binding.geometry||JSON.stringify(packet)===JSON.stringify(source.binding.geometry));
 return source.kind==='draft'&&script.studioSource?.projectId===project.id&&script.studioSource?.revision===project.revision;
}
export function previewRows(project,episode){
 const ep=project.productionPackage?.episodes.find(e=>Number(e.episode)===Number(episode));
 return (ep?.panelRecords||[]).map(r=>{
  const shot=project.shots.find(s=>s.productionGridId===r.id)||{},raw=r.original||{},production=r.production||{};
  return {key:r.id,description:shot.description||raw['画面内容']||production['画面内容']||'',shotSize:shot.shotSize||raw['景别']||production['景别']||''};
 });
}
