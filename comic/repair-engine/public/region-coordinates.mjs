export function displayRegionFrame(region,toDisplay){return{...region.frame,y:region.coordinateSpace==='output'?region.frame.y:toDisplay(region.frame.y)};}
export function regionSpaceHeight(region,sourceHeight,outputHeight){return region?.coordinateSpace==='output'?outputHeight:sourceHeight;}
