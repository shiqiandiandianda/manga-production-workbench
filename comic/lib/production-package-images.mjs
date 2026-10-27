import {compatibleCanvas} from './canvas-image-compat.mjs';
import {createRequire} from 'node:module';
const canvas=()=>compatibleCanvas(createRequire(import.meta.url)(process.env.COMIC_CANVAS_MODULE||'@napi-rs/canvas'));
export async function detectProductionRegions(file,expected){
 const {loadImage,createCanvas}=canvas(),image=await loadImage(file),scale=Math.min(1,600/image.width),w=Math.round(image.width*scale),h=Math.round(image.height*scale),c=createCanvas(w,h),ctx=c.getContext('2d');ctx.drawImage(image,0,0,w,h);const pixels=ctx.getImageData(0,0,w,h).data;
 const dark=(x,y)=>{const at=(y*w+x)*4;return pixels[at+3]>20&&Math.min(pixels[at],pixels[at+1],pixels[at+2])<242;};
 const bands=(length,occupied,min)=>{const result=[];let from=-1;for(let i=0;i<=length;i++){if(i<length&&occupied(i)){if(from<0)from=i;}else if(from>=0){if(i-from>=min)result.push([from,i]);from=-1;}}return result;};
 const rows=bands(h,y=>{let n=0;for(let x=Math.ceil(w*.02);x<w*.98;x++)if(dark(x,y))n++;return n>w*.015;},Math.max(8,h*.025));
 const groups=[...new Set(expected.map(p=>p['排']))],regions={};let good=rows.length===groups.length;
 if(good)for(const [i,number] of groups.entries()){const cells=expected.filter(p=>p['排']===number),[top,bottom]=rows[i];let columns=bands(w,x=>{let n=0;for(let y=top;y<bottom;y++)if(dark(x,y))n++;return n>(bottom-top)*.04;},w*.08);if(columns.length!==cells.length){good=false;break;}for(const [j,p] of cells.entries()){const [left,right]=columns[j];regions[p['格ID']]={x:left/w,y:top/h,w:(right-left)/w,h:(bottom-top)/h};}}
 return {regions:good?regions:{},matched:good,observedRows:rows.length,expectedRows:groups.length,width:image.width,height:image.height,notice:good?'已找到与源排数、格数一致的候选格区，仍需看图确认。':'自动识别数量与资料不一致，请在图上逐格框定。'};
}
export async function removeConnectedWhite(file,{threshold=248}={}){
 const {loadImage,createCanvas}=canvas(),image=await loadImage(file);if(image.width*image.height>40000000)throw Error('整段图超过4000万像素，请先缩小副本');const c=createCanvas(image.width,image.height),ctx=c.getContext('2d');ctx.drawImage(image,0,0);const pixels=ctx.getImageData(0,0,image.width,image.height),data=pixels.data,n=image.width*image.height,seen=new Uint8Array(n),queue=new Int32Array(n);let head=0,tail=0;
 const add=i=>{if(seen[i])return;seen[i]=1;const at=i*4;if(data[at+3]===0||Math.min(data[at],data[at+1],data[at+2])>=threshold)queue[tail++]=i;};
 for(let x=0;x<image.width;x++){add(x);add(n-image.width+x);}for(let y=0;y<image.height;y++){add(y*image.width);add(y*image.width+image.width-1);}
 while(head<tail){const i=queue[head++];data[i*4+3]=0;if(i%image.width)add(i-1);if(i%image.width<image.width-1)add(i+1);if(i>=image.width)add(i-image.width);if(i<n-image.width)add(i+image.width);}
 if(!tail)throw Error('没有识别到外部连通白区，原图未改变');ctx.putImageData(pixels,0,0);return {bytes:c.toBuffer('image/png'),removedPixels:tail,totalPixels:n};
}
export async function stretchAtmosphere(file,width,height){
 if(width*height>40000000)throw Error('底图覆盖范围超过4000万像素，请分组制作');const {loadImage,createCanvas}=canvas(),image=await loadImage(file),c=createCanvas(width,height);c.getContext('2d').drawImage(image,0,0,width,height);return c.toBuffer('image/png');
}
