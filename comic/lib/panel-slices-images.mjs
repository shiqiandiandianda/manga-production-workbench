import {createRequire} from 'node:module';
import {slicePixels,slicePolygon} from '../public/panel-slices.js';
const canvas=()=>createRequire(import.meta.url)(process.env.COMIC_CANVAS_MODULE||'@napi-rs/canvas');
export async function detectSliceRegions(file,expected){
 const {loadImage,createCanvas}=canvas(),image=await loadImage(file);if(image.width*image.height>100000000)throw Error('原图超过一亿像素，请选择较低倍率的图片');
 const scale=Math.min(1,800/image.width,10000/image.height),w=Math.round(image.width*scale),h=Math.round(image.height*scale),c=createCanvas(w,h),ctx=c.getContext('2d');ctx.drawImage(image,0,0,w,h);const px=ctx.getImageData(0,0,w,h).data,groups=[...new Set(expected.map(p=>p['排']))];
 function bands(length,count,threshold,min){const raw=[];let start=-1;for(let i=0;i<=length;i++){if(i<length&&count(i)>threshold){if(start<0)start=i;}else if(start>=0){if(i-start>=min)raw.push([start,i]);start=-1;}}return raw;}
 let best=null;
 for(const white of [242,250,232])for(const occupancy of [.012,.025,.045]){
  const dark=(x,y)=>{const i=(y*w+x)*4;return px[i+3]>30&&Math.min(px[i],px[i+1],px[i+2])<white;};
  const rows=bands(h,y=>{let n=0;for(let x=0;x<w;x++)if(dark(x,y))n++;return n;},w*occupancy,Math.max(6,h*.015)),candidates=[],regions={};let matched=rows.length===groups.length;
  for(let i=0;i<rows.length;i++){const [top,bottom]=rows[i],columns=bands(w,x=>{let n=0;for(let y=top;y<bottom;y++)if(dark(x,y))n++;return n;},(bottom-top)*.035,Math.max(6,w*.045)),cells=expected.filter(p=>p['排']===groups[i]);if(columns.length!==cells.length)matched=false;
   for(let j=0;j<columns.length;j++){const [left,right]=columns[j],r={x:left/w,y:top/h,w:(right-left)/w,h:(bottom-top)/h};candidates.push(r);if(cells[j])regions[cells[j]['格ID']]=r;}
  }
  const result={regions:matched?regions:{},candidates,matched,observedRows:rows.length,expectedRows:groups.length,width:image.width,height:image.height,notice:matched?'已按白缝识别格区，请检查边缘和阅读顺序后裁切。':'识别数量与分镜不一致，请逐格框选。不会按数量平均切图。'};if(matched)return result;if(!best||Math.abs(candidates.length-expected.length)<Math.abs(best.candidates.length-expected.length))best=result;
 }return best;
}
export async function cropSliceImages(file,regions){
 const {loadImage,createCanvas}=canvas(),image=await loadImage(file);if(image.width*image.height>100000000)throw Error('原图超过一亿像素');const result=[];
 for(const [panelId,r] of Object.entries(regions)){const crop=slicePixels(r,image.width,image.height);if(crop.w<2||crop.h<2)throw Error('裁切区域过小');const c=createCanvas(crop.w,crop.h),ctx=c.getContext('2d');if(r.points){ctx.beginPath();slicePolygon(r).forEach((p,i)=>ctx[i?'lineTo':'moveTo'](p.x*image.width-crop.x,p.y*image.height-crop.y));ctx.closePath();ctx.clip();}ctx.drawImage(image,-crop.x,-crop.y);result.push({panelId,region:r,crop,bytes:c.toBuffer('image/png')});}return result;
}
