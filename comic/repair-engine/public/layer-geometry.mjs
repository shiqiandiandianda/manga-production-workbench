import {layerMatrix,invertMatrix,mapPoint} from './affine-links.mjs';
export function layerScales(layer){return{x:layer.scaleX??layer.scale,y:layer.scaleY??layer.scale};}
export function localLayerPoint(layer,point){return mapPoint(invertMatrix(layerMatrix(layer)),point);}
export function resizeLayerAtCenter(layer,xPercent,yPercent,width,height){if([xPercent,yPercent].some(value=>!Number.isFinite(value)||value<10||value>400))throw new Error('缩放范围为 10–400%');const nextX=xPercent/100,nextY=yPercent/100,previous=layerScales(layer),dx=(width/2+(layer.skewX||0)*height/2)*(previous.x-nextX),dy=height/2*(previous.y-nextY),a=layer.angle*Math.PI/180;layer.x+=dx*Math.cos(a)-dy*Math.sin(a);layer.y+=dx*Math.sin(a)+dy*Math.cos(a);layer.scaleX=nextX;layer.scaleY=nextY;layer.scale=nextX;}
export function scaleLayerAtCenter(layer,percent,width,height){resizeLayerAtCenter(layer,percent,percent,width,height);}
export function formatDecimal(value){return String(Number(Number(value).toFixed(3)));}
