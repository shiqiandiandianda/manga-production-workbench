import {layerMatrix,invertMatrix,mapPoint} from './affine-links.mjs';
import {selectionHandles} from './selection-resize.mjs';
import {imageResizeCursor} from './image-resize.mjs';

export function textFrameHandles(layer,frame){
 const matrix=layerMatrix(layer);
 return selectionHandles(frame).map(handle=>({...handle,...mapPoint(matrix,handle),cursor:imageResizeCursor(mapPoint({...matrix,e:0,f:0},{x:handle.name.includes('w')?-1:handle.name.includes('e')?1:0,y:handle.name.includes('n')?-1:handle.name.includes('s')?1:0}))}));
}

// Reflow the text in local coordinates; preserve font, scale, rotation and the opposite edge.
export function resizeTextFrame(base,frame,handle,delta){
 if(!['nw','n','ne','e','se','s','sw','w'].includes(handle))throw new Error('文本框缩放点无效');
 if(![frame.width,frame.height,delta.x,delta.y].every(Number.isFinite)||frame.width<=0||frame.height<=0)throw new Error('文本框尺寸无效');
 const matrix=layerMatrix(base),local=mapPoint(invertMatrix({...matrix,e:0,f:0}),delta);
 const width=Math.max(1,Math.min(4096,Math.round(frame.width+(handle.includes('e')?local.x:handle.includes('w')?-local.x:0))));
 const height=Math.max(1,Math.min(8192,Math.round(frame.height+(handle.includes('s')?local.y:handle.includes('n')?-local.y:0))));
 const shift=mapPoint({...matrix,e:0,f:0},{x:handle.includes('w')?frame.width-width:0,y:handle.includes('n')?frame.height-height:0});
 return{x:base.x+shift.x,y:base.y+shift.y,textBoxWidth:width,textBoxHeight:height,textMode:'paragraph',textWrap:true};
}
