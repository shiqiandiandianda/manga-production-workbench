import {sectionSegments,sectionAt} from './page-sections.mjs';

export function outputLayoutDelta(y,before,after){
 const old=sectionAt(y,before);if(!old)return 0;
 const next=sectionSegments(after).find(item=>item.id===old.id);
 if(next)return next.outputStart-old.outputStart;
 const sourceY=old.start+y-old.outputStart,match=sectionSegments(after).find(item=>sourceY>=item.start&&sourceY<item.end);
 return match?match.outputStart+sourceY-match.start-y:0;
}
function moveRegion(region,dy){
 if(!dy)return;region.frame={...region.frame,y:region.frame.y+dy};if(region.origin)region.origin={...region.origin,y:region.origin.y+dy};
 for(const mark of region.annotations||[])if(mark.points)for(const point of mark.points)point.y+=dy;else if(Number.isFinite(mark.y))mark.y+=dy;
 if(region.link){if(region.link.frame)region.link.frame={...region.link.frame,y:region.link.frame.y+dy};if(region.link.origin)region.link.origin={...region.link.origin,y:region.link.origin.y+dy};if(region.link.pose)region.link.pose={...region.link.pose,y:region.link.pose.y+dy};for(const mark of region.link.marks||[])if(mark.points)for(const point of mark.points)point.y+=dy;else if(Number.isFinite(mark.y))mark.y+=dy;region.linkUpdatedAt=Date.now();}
 region.modifiedAt=Date.now();
}
export function reflowOutputObjects(layers,regions,before,after){
 const deltas=new Map(regions.filter(r=>r.coordinateSpace==='output').map(r=>[r.id,outputLayoutDelta(r.frame.y,before,after)]));
 for(const layer of layers){if(layer.coordinateSpace!=='output'||['background','section'].includes(layer.type))continue;const dy=deltas.get(layer.regionId||layer.originRegionId)??outputLayoutDelta(layer.y,before,after);layer.y+=dy;layer.layoutVersion=2;}
 for(const region of regions)if(region.coordinateSpace==='output'){moveRegion(region,deltas.get(region.id)||0);region.layoutVersion=2;}
 return [...deltas.values()].some(Boolean);
}
// Old versions saved output pixels without following later section extensions.
// Only correct provably untouched submission positions; manually moved layers retain their pose.
export function recoverUntrackedTaskLayout(task,layers,regions,currentSections,sourceHeight){
 if(task.coordinateSpace!=='output')return false;const region=regions.find(r=>r.id===task.regionId),layer=layers.find(l=>l.jobId===task.id);
 if(!region||!layer||region.layoutVersion===2||!task.frame)return false;
 const before=task.submission?.pageSections?.length?task.submission.pageSections:[{id:'original',start:0,end:sourceHeight,height:sourceHeight}];
 const untouched=region.frame.y===task.frame.y&&layer.y===task.crop.y;
 const dy=untouched?outputLayoutDelta(task.frame.y,before,currentSections):0;
 if(dy){moveRegion(region,dy);layer.y+=dy;for(const companion of layers)if(companion.originJobId===task.id)companion.y+=dy;}
 layer.layoutVersion=region.layoutVersion=2;return !!dy;
}
