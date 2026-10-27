import {chosenRegionLayer} from './repair-versions.mjs';
export function contentRegion(layer,regions){return layer&&regions.find(region=>region.id===layer.regionId||(layer.jobId&&region.jobId===layer.jobId))||null;}
export function linkedPair(region,layer){return !!region?.link&&!!layer&&region.link.layerId===layer.id;}
export function repairPair(region,layer){return !!region&&!!layer&&(layer.regionId===region.id||(!!layer.jobId&&layer.jobId===region.jobId)||linkedPair(region,layer));}
export function canEditRegion(region,layer){return !!region&&!region.locked&&!(repairPair(region,layer)&&layer.locked);}
export function canEditLayer(layer,region){return !!layer&&!layer.locked&&!(repairPair(region,layer)&&region.locked);}
export function toggleObjectLock(target,region,layer){const object=target==='region'?region:layer;if(!object)return null;const paired=repairPair(region,layer),locked=!(object.locked||(paired&&(target==='region'?layer.locked:region.locked)));object.locked=locked;if(paired){region.locked=locked;layer.locked=locked;}return locked;}
export function toolProperties(tool){return {select:['repair-details'],rect:['selection-settings'],'frame-move':['selection-settings'],'layer-move':['layer-edit-details'],mask:['layer-edit-details','layer-mask-details'],paint:['paint-details'],pan:['view-details']}[tool]||[];}

// Tool letters apply only without command modifiers; Ctrl/Cmd+V is paste.
export function editorToolShortcut(event){
 if(event.ctrlKey||event.metaKey||event.altKey)return null;
 const key=event.key.toLowerCase();
 if(event.shiftKey&&key==='d')return 'pan';
 return {a:'select',r:'extract',d:'rect',v:'layer-move',p:'paint',m:'mask'}[key]||null;
}

export function freeSelectionRect(a,b,width,height){
 const left=Math.max(0,Math.min(width,Math.floor(Math.min(a.x,b.x)))),top=Math.max(0,Math.min(height,Math.floor(Math.min(a.y,b.y)))),right=Math.max(0,Math.min(width,Math.ceil(Math.max(a.x,b.x)))),bottom=Math.max(0,Math.min(height,Math.ceil(Math.max(a.y,b.y))));
 return{x:left,y:top,width:Math.max(0,right-left),height:Math.max(0,bottom-top)};
}
export function editorCursor(tool,{display=false,dragging=false,resize=false}={}){
 if(dragging)return 'grabbing';if(resize)return 'ns-resize';if(display||tool==='pan')return 'grab';if(tool==='select')return 'url("/repair/icons/cursor-pointer.svg") 4 3, default';
 const icon={rect:'select','frame-move':'frame-move','layer-move':'image-move',paint:'brush',brush:'brush',mask:'mask',erase:'erase',extract:'crop'}[tool]||'select';
 return 'url("/repair/icons/cursor-'+icon+'.svg") '+(icon==='brush'?'4 28':icon==='frame-move'||icon==='image-move'||icon==='mask'?'16 16':'8 8')+', '+(icon.includes('move')?'move':'crosshair');
}

export function repairAtPoint(source,output,regions,layers,bounds){
 const contains=(box,point)=>box&&point&&point.x>=box.x&&point.x<box.x+box.width&&point.y>=box.y&&point.y<box.y+box.height;
 const chosen=new Map(regions.map(region=>[chosenRegionLayer(region,layers)?.id,region]));
 for(const layer of [...layers].reverse()){const region=chosen.get(layer.id);if(region&&layer.visible!==false&&!layer.versionHidden&&layer.opacity!==0&&contains(bounds(layer),layer.coordinateSpace==='output'?output:source))return region;}
 return [...regions].reverse().find(region=>contains(region.frame,region.coordinateSpace==='output'?output:source))||null;
}
