import {bounds,fitImage} from './model.js';
export const artworkAngle=t=>Number.isFinite(t?.rotation)?Math.max(-180,Math.min(180,t.rotation)):0;
/** Apply artwork-only transforms about the crop frame. Lettering and masks stay fixed. */
export function artworkMirrorSvg(panel){
 const t=panel.imageTransform||{},angle=artworkAngle(t),fx=t.flipX===true?-1:1,fy=t.flipY===true?-1:1;if(!angle&&fx===1&&fy===1)return '';
 const b=bounds(panel),cx=b.x+b.w/2,cy=b.y+b.h/2;
 if(!angle&&fy===1)return `translate(${2*cx} 0) scale(-1 1)`;
 return `translate(${cx} ${cy}) scale(${fx} ${fy}) rotate(${angle}) translate(${-cx} ${-cy})`;
}
export function paintArtworkImage(context,panel,image,transform){
 context.save();try{const angle=artworkAngle(transform);if(angle||transform.flipX===true||transform.flipY===true){const b=bounds(panel),cx=b.x+b.w/2,cy=b.y+b.h/2;context.translate(cx,cy);if(transform.flipX===true||transform.flipY===true)context.scale(transform.flipX===true?-1:1,transform.flipY===true?-1:1);if(angle)context.rotate(angle*Math.PI/180);context.translate(-cx,-cy);}
 context.drawImage(image,transform.x,transform.y,image.naturalWidth*transform.scale,image.naturalHeight*transform.scale);}finally{context.restore();}
}
export function toggleArtworkMirror(panel,fallback,axis='horizontal'){
 const transform=panel.imageTransform||fallback;if(!transform)return false;const key=axis==='vertical'?'flipY':'flipX';panel.imageTransform={...transform,[key]:transform[key]!==true};return true;
}
/** Inverse display transform keeps crop dragging in the pointer's screen direction. */
export function artworkDelta(transform,dx,dy){const angle=artworkAngle(transform)*Math.PI/180,x=dx*(transform?.flipX===true?-1:1),y=dy*(transform?.flipY===true?-1:1);return {x:x*Math.cos(angle)+y*Math.sin(angle),y:-x*Math.sin(angle)+y*Math.cos(angle)};}
export function fitArtwork(panel,asset,{reset=false}={}){
 if(!(asset?.width>0&&asset?.height>0))throw Error('图片尺寸尚未读取');const t=reset?{}:panel.imageTransform||{},angle=artworkAngle(t)*Math.PI/180,b=bounds(panel),c=Math.abs(Math.cos(angle)),s=Math.abs(Math.sin(angle));
 const scale=Math.max((b.w*c+b.h*s)/asset.width,(b.w*s+b.h*c)/asset.height)*1.08;
 return {...t,x:b.x+(b.w-asset.width*scale)/2,y:b.y+(b.h-asset.height*scale)/2,scale};
}
export function artworkZoomPercent(panel,asset){const t=panel.imageTransform||fitImage(panel,asset);return t.scale/fitImage(panel,asset).scale*100;}
/** Initial canvas framing only. The generated file retains its actual native pixels. */
export function fitGeneratedArtwork(panel,asset){const b=bounds(panel),scale=fitImage(panel,asset).scale*.95;return {x:b.x+(b.w-asset.width*scale)/2,y:b.y+(b.h-asset.height*scale)/2,scale};}
export function scaleArtwork(panel,asset,percent){
 if(!Number.isFinite(percent)||percent<10||percent>10000)throw Error('图片缩放请输入 10%—10000%');const t=panel.imageTransform||fitImage(panel,asset),b=bounds(panel),cx=b.x+b.w/2,cy=b.y+b.h/2,scale=fitImage(panel,asset).scale*percent/100,factor=scale/t.scale;
 panel.imageTransform={...t,x:cx+(t.x-cx)*factor,y:cy+(t.y-cy)*factor,scale};return panel.imageTransform;
}
/** Scale only the image about its opposite displayed corner, including mirrors/rotation. */
export function resizeArtworkCorner(panel,asset,index,{dx,dy}){
 const result=structuredClone(panel);if(!asset||!(asset.width>0&&asset.height>0)||!Number.isInteger(index)||index<0||index>3||![dx,dy].every(Number.isFinite))return result;
 const t=panel.imageTransform||fitImage(panel,asset),delta=artworkDelta(t,dx,dy),w=asset.width*t.scale,h=asset.height*t.scale,sx=[-1,1,1,-1][index],sy=[-1,-1,1,1][index],base=fitImage(panel,asset).scale;
 const requested=t.scale*(1+(delta.x*sx*w+delta.y*sy*h)/(w*w+h*h)),scale=Math.max(base*.1,Math.min(base*100,requested)),factor=scale/t.scale,ax=t.x+(sx<0?w:0),ay=t.y+(sy<0?h:0);
 result.imageTransform={...t,x:ax+(t.x-ax)*factor,y:ay+(t.y-ay)*factor,scale};return result;
}
