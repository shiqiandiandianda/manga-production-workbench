import {readableRaster} from './readable-raster.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {check} from './store.mjs';
import {comicStyleFile} from './comic-style-library.mjs';
import {paintSceneRegion} from '../public/render.js';
import {clone,id,rectangle,layoutLongStrip} from '../public/model.js';
import {orderedLayers,normalizeLayerOrder} from '../public/layers.js';
import {layerDocumentBox} from '../public/multi-selection.js';
import {applyLayerMerge} from '../public/layer-merge.js';

const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const native=()=>createRequire(import.meta.url)(process.env.COMIC_CANVAS_MODULE||process.env.COMIC_TEST_CANVAS_MODULE||'@napi-rs/canvas');
const sourceFile=(store,key)=>key.startsWith('comic:')?comicStyleFile(key.slice(6)):store.assetPath(key);

export function repairCompositionPlan(project,panelId,assets=[],measurement=native().createCanvas(1,1).getContext('2d')){
 const page=project.pages.find(p=>p.panels.some(f=>f.id===panelId)),panel=page?.panels.find(f=>f.id===panelId);
 if(!panel||panel.cutoutLayer)return null;
 // Editable lettering never belongs to an image repair. Only earlier repair
 // patches join their parent; cutouts and HD layers retain their own workflow.
 const children=page.panels.filter(f=>f.cutoutLayer?.parentPanelId===panel.id&&f.cutoutLayer.kind==='repair-patch'&&f.visible!==false);
 if(!children.length)return null;
 const members=[panel,...children],wanted=new Set(members.filter(f=>f.visible!==false).map(f=>f.id)),entries=orderedLayers(project).filter(e=>e.pageId===page.id&&wanted.has(e.item.id));
 const layout=layoutLongStrip(project.pages),pageEntry=layout.pages.find(p=>p.pageId===page.id),ratio=pageEntry.scale;
 const boxes=entries.map(e=>{const box=layerDocumentBox(project,e.item.id,measurement);if(!box)return null;const pad=(e.item.border||0)/2;return {x:box.x/ratio-pad,y:(box.y-pageEntry.y)/ratio-pad,w:box.w/ratio+pad*2,h:box.h/ratio+pad*2};}).filter(Boolean);
 check(boxes.length,'当前画面没有可见图层',409);
 const left=Math.floor(Math.min(...boxes.map(b=>b.x))),top=Math.floor(Math.min(...boxes.map(b=>b.y))),right=Math.ceil(Math.max(...boxes.map(b=>b.x+b.w))),bottom=Math.ceil(Math.max(...boxes.map(b=>b.y+b.h))),region={x:left,y:top,w:right-left,h:bottom-top};
 const assetMap=new Map(assets.map(a=>[a.id,a])),scale=Math.max(1,...entries.filter(e=>e.type==='panel'&&e.item.imageAssetId).map(e=>1/(e.item.imageTransform?.scale||Math.min(e.item.w/(assetMap.get(e.item.imageAssetId)?.width||e.item.w),e.item.h/(assetMap.get(e.item.imageAssetId)?.height||e.item.h)))));
 const isolated={...clone(project),pages:[{...clone(page),width:region.w,height:region.h,background:'rgba(0,0,0,0)',panels:[],bubbles:[]}],gradients:[],layerOrder:entries.map(e=>e.item.id)};
 for(const entry of entries){const item=clone(entry.item);item.x-=left;item.y-=top;delete item.productionBackgroundInstance;delete item.productionBackgroundResource;isolated.pages[0].panels.push(item);}
 return {pageId:page.id,panelId:panel.id,region,scale,isolated,layerIds:entries.map(e=>e.item.id),bubbles:[],stamp:digest(JSON.stringify({pageId:page.id,members,order:entries.map(e=>e.item.id)}))};
}

export async function captureRepairComposition(project,panelId,store,folder){
 const lib=native(),plan=repairCompositionPlan(project,panelId,store.db.assets,lib.createCanvas(1,1).getContext('2d'));if(!plan)return null;
 const width=Math.ceil(plan.region.w*plan.scale),height=Math.ceil(plan.region.h*plan.scale);check(width<=16384&&height<=16384&&width*height<=100000000,'当前组合画面过大，请选择单个图层修图');
 const canvas=lib.createCanvas(width,height),context=canvas.getContext('2d'),images=new Map(),sources=new Map(),load=async key=>{if(!images.has(key)){const bytes=fs.readFileSync(sourceFile(store,key));sources.set(key,digest(bytes));images.set(key,readableRaster(lib,bytes,{file:sourceFile(store,key),cacheDir:path.join(folder,'decode-cache')}));}return images.get(key);};
 context.scale(plan.scale,plan.scale);await paintSceneRegion(context,plan.isolated,{layout:layoutLongStrip(plan.isolated.pages,{width:plan.region.w}),region:{x:0,y:0,w:plan.region.w,h:plan.region.h},renderScale:plan.scale,imageLoader:load,canvasFactory:()=>lib.createCanvas(1,1)});
 const bytes=canvas.toBuffer('image/png'),sha256=digest(bytes),file=path.join(folder,sha256+'.png');fs.mkdirSync(folder,{recursive:true});if(!fs.existsSync(file))fs.writeFileSync(file,bytes);
 return {version:2,panelId,pageId:plan.pageId,region:plan.region,scale:plan.scale,width,height,stamp:plan.stamp,layerIds:plan.layerIds,bubbles:[],sources:[...sources].map(([key,sha256])=>({key,sha256})),file,sha256};
}

export function repairCompositionMatches(composition,project,store){
 if(composition.version!==2)return false;
 const plan=repairCompositionPlan(project,composition.panelId,store.db.assets);if(!plan||plan.stamp!==composition.stamp)return false;
 try{return digest(fs.readFileSync(composition.file))===composition.sha256&&composition.sources.every(({key,sha256})=>digest(fs.readFileSync(sourceFile(store,key)))===sha256);}catch{return false;}
}

/** Compare artwork pixels; separate patches are cropped, auto merge may erase pixels. */
export async function compositionDifference(beforeFile,resultFile,{region,protectedRegions=[],crop=false,allowErase=false}={}){
 const lib=native(),before=await lib.loadImage(beforeFile),result=await lib.loadImage(resultFile),width=result.width,height=result.height;check(width*height<=100000000,'修图结果超过一亿像素');
 const original=lib.createCanvas(width,height),a=original.getContext('2d'),output=lib.createCanvas(width,height),b=output.getContext('2d');if(before.width===width&&before.height===height)a.drawImage(before,0,0);else{a.imageSmoothingQuality='high';a.drawImage(before,0,0,width,height);}b.drawImage(result,0,0);
 const protectedPixels=region?protectedRegions.map(r=>({x:(r.x-region.x)*width/region.w,y:(r.y-region.y)*height/region.h,right:(r.x+r.w-region.x)*width/region.w,bottom:(r.y+r.h-region.y)*height/region.h})):[];
 let changed=0,minX=width,minY=height,maxX=-1,maxY=-1;const band=Math.max(1,Math.floor(4000000/width));
 for(let top=0;top<height;top+=band){const rows=Math.min(band,height-top),source=a.getImageData(0,top,width,rows).data,pixels=b.getImageData(0,top,width,rows),data=pixels.data;
 for(let i=0;i<data.length;i+=4){const x=(i/4)%width,y=top+Math.floor(i/4/width);if(protectedPixels.some(r=>x>=r.x&&x<r.right&&y>=r.y&&y<r.bottom)){data[i]=data[i+1]=data[i+2]=data[i+3]=0;continue;}const sa=source[i+3],da=data[i+3],same=(!sa&&!da)||Math.max(Math.abs(source[i]-data[i]),Math.abs(source[i+1]-data[i+1]),Math.abs(source[i+2]-data[i+2]),Math.abs(sa-da))<=2;if(same){data[i]=data[i+1]=data[i+2]=data[i+3]=0;continue;}
  check(allowErase||da>=sa,'独立补片无法擦除原图，请选择“自动合并到画格”保留透明结果',409);
  if(!allowErase&&sa&&sa<255&&da<255){const alpha=(da-sa)/(255-sa);check(alpha>0,'请使用“自动合并到画格”修改透明边缘',409);for(let k=0;k<3;k++)data[i+k]=Math.max(0,Math.min(255,Math.round((data[i+k]*da-source[i+k]*sa*(1-alpha))/(alpha*255))));data[i+3]=Math.round(alpha*255);}
  changed++;minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);
 }b.putImageData(pixels,0,top);await new Promise(resolve=>setImmediate(resolve));}
 if(!changed)return {changed:0,width,height};
 const bounds={x:minX,y:minY,w:maxX-minX+1,h:maxY-minY+1};
 if(crop){const tile=lib.createCanvas(bounds.w,bounds.h);tile.getContext('2d').drawImage(output,minX,minY,bounds.w,bounds.h,0,0,bounds.w,bounds.h);return {changed,width,height,crop:bounds,bytes:tile.toBuffer('image/png')};}
 return {changed,width,height,bytes:output.toBuffer('image/png')};
}

export function mergeCompositionResult(project,parent,asset,composition){
 const wanted=new Set(composition.layerIds),entries=orderedLayers(project).filter(e=>wanted.has(e.item.id));
 check(entries.length===wanted.size&&entries.every(e=>e.type==='panel'&&!e.item.locked),'请先解锁需要合并的画面和补图层',409);
 return applyLayerMerge(project,{keys:[...wanted],entries,pageId:composition.pageId,anchorId:parent.id,region:composition.region,scale:asset.width/composition.region.w},asset);
}

export function addCompositionPatch(project,parent,asset,composition,{sessionId,mode='replace',model=''}){
 const page=project.pages.find(p=>p.id===composition.pageId);check(page&&!page.locked&&!parent.locked,'请先解锁画板和来源画格',409);check(page.panels.length<1000,'当前画板图层数量已达上限');
 const layer={id:id('panel'),shotId:parent.shotId,name:mode==='upscale'?'高清修图补图层':'修图补图层',...composition.region,w:Math.max(20,composition.region.w),h:Math.max(20,composition.region.h),kind:'panel',points:rectangle(),border:0,borderColor:'#111111',feather:0,visible:true,locked:false,imageAssetId:asset.id,imageTransform:{x:0,y:0,scale:composition.region.w/asset.width},candidates:[asset.id],referenceIds:[],generationToken:null,cutoutLayer:{version:1,parentPanelId:parent.id,sourceAssetId:parent.imageAssetId,sessionId,kind:'repair-patch',taskId:randomUUID()}};
 layer.compositionRepair={version:1,mode,model:String(model).slice(0,160),sourcePanelId:parent.id,scale:asset.width/composition.width};
 page.panels.push(layer);normalizeLayerOrder(project);project.layerOrder=project.layerOrder.filter(key=>key!==layer.id);project.layerOrder.push(layer.id);return layer;
}
