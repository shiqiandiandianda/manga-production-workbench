
import {episodeExportLayout} from './episode-board-export.js';
import {exportCompleteStrip} from './complete-strip-export.js';
import {isCircleFrame} from './frame-primitives.js';
import {paintEpisodeBoard} from './episode-boards.js';
import {isSfxImage,sfxImageRotation,sfxImageBounds} from './sfx-image-layer.js';
import {paintArtworkImage} from './artwork-transform.js';
import {sceneLayers} from "./layers.js";
import {hasNewEffects,paintGradient,applyFeather,paintBrushMask} from './panel-effects.js';
import {bounds,fitImage,COMIC_PAGE_WIDTH,layoutLongStrip} from "./model.js";
import {paintBubble,wrapText,FONT_FAMILIES} from './lettering.js';
import {isOpaqueStripBackground,backgroundPaintRegion,stripBackgroundGaps} from './strip-background.js';
import {assetUrl,refreshAssetUrl} from './asset-url.js';
import {currentVisualStyle} from './comic-styles.js';
import {createComicEffectRouting} from './comic-effect-routing.js';
import {createAsyncCache} from './bounded-cache.js';
export {wrapText} from './lettering.js';

export const MAX_EXPORT_SEGMENT_HEIGHT=8192;
export const MAX_CANVAS_DIMENSION=16384;
export const MAX_CANVAS_PIXELS=32*1024*1024;
export const MAX_EXPORT_ARCHIVE_BYTES=512*1024*1024;
const images=createAsyncCache({name:'decoded-original-images',maxEntries:24,maxBytes:96*1024*1024,ttl:120000,maxPending:4,weight:image=>Math.max(1,image.naturalWidth||image.width)*Math.max(1,image.naturalHeight||image.height)*4});
async function paintStyledBubble(context,bubble,imageLoader){const options={};if(bubble.styleTextureId)options.textureImage=await imageLoader(bubble.styleTextureAssetId||'comic:'+bubble.styleTextureId);const visual=currentVisualStyle(bubble);if(visual)options.visualImage=await imageLoader(bubble.visualAssetId||'comic:'+visual);return paintBubble(context,bubble,options);}
export function clearImageCache(assetId){if(assetId)images.delete(assetId);else images.clear();refreshAssetUrl(assetId);}
export function loadImage(assetId){
  return images.load(assetId,()=>new Promise((resolve,reject)=>{
    const image=new Image();const cleanup=()=>{image.onload=null;image.onerror=null;};image.onload=()=>{cleanup();resolve(image);};image.onerror=()=>{cleanup();reject(new Error('图片路径无法读取，请重新指定这张图片的路径'));};image.src=assetUrl(assetId);
  }));
}
const defaultCanvasFactory=()=>document.createElement('canvas');
export function createSafeCanvas(width,height,canvasFactory=defaultCanvasFactory) {
  width=Math.ceil(width);height=Math.ceil(height);
  if(!Number.isSafeInteger(width)||!Number.isSafeInteger(height)||width<=0||height<=0||width>MAX_CANVAS_DIMENSION||height>MAX_CANVAS_DIMENSION||width*height>MAX_CANVAS_PIXELS)throw new Error('页面超过单画布安全范围，请使用分段 PNG 导出，或指定裁切区域');
  const canvas=canvasFactory();canvas.width=width;canvas.height=height;
  if(!canvas.getContext('2d'))throw new Error('浏览器无法创建绘图画布');
  return canvas;
}
export function intersectRegion(a,b) {
  const x=Math.max(a.x,b.x),y=Math.max(a.y,b.y),right=Math.min(a.x+a.w,b.x+b.w),bottom=Math.min(a.y+a.h,b.y+b.h);
  return right>x&&bottom>y?{x,y,w:right-x,h:bottom-y}:null;
}
function checkedRegion(page,region) {
  const value=region||{x:0,y:0,w:page.width,h:page.height};
  if(![value.x,value.y,value.w,value.h].every(Number.isFinite)||value.w<=0||value.h<=0)throw new Error('裁切区域无效');
  return intersectRegion(value,{x:0,y:0,w:page.width,h:page.height});
}
function shape(context,panel){
  context.beginPath();if(isCircleFrame(panel.points))context.ellipse(panel.w/2,panel.h/2,panel.w/2,panel.h/2,0,0,Math.PI*2);else panel.points.forEach((p,i)=>{const x=p.x*panel.w,y=p.y*panel.h;if(i)context.lineTo(x,y);else context.moveTo(x,y);});context.closePath();
}
async function paintPanel(context,panel,{draft=false,label='',description='',region,renderScale=1,imageLoader=loadImage,canvasFactory=defaultCanvasFactory}={}){
  if(!panel.visible)return;
  if(isSfxImage(panel)){
   if(region&&!intersectRegion(region,sfxImageBounds(panel)))return;
   if(!panel.imageAssetId)return;let timer;const image=await Promise.race([imageLoader(panel.imageAssetId),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('冲刺线原图读取超时，请检查共享盘连接后重试')),7000);})]).finally(()=>clearTimeout(timer));
   context.save();try{context.translate(panel.x,panel.y);context.translate(panel.w/2,panel.h/2);context.rotate(sfxImageRotation(panel)*Math.PI/180);context.translate(-panel.w/2,-panel.h/2);shape(context,panel);context.clip();paintArtworkImage(context,panel,image,panel.imageTransform||fitImage(panel,{width:image.naturalWidth,height:image.naturalHeight}));}finally{context.restore();}return;
  }
  const b=bounds(panel),edge=Math.max(0,panel.border||0)/2;
  const visible=intersectRegion(region,{x:panel.x+b.x-edge,y:panel.y+b.y-edge,w:b.w+edge*2,h:b.h+edge*2});
  if(!visible)return;
  if(!draft&&isOpaqueStripBackground(panel)){context.save();try{context.translate(panel.x,panel.y);paintGradient(context,panel,backgroundPaintRegion(panel,{x:region.x-panel.x,y:region.y-panel.y,w:region.w,h:region.h},1/renderScale));}finally{context.restore();}return;}
  context.save();
  try {
    context.translate(panel.x,panel.y);shape(context,panel);context.clip();
    if(draft){
      const intent=panel.layoutIntent||{};
      context.fillStyle=({splash:'#c8b59b',large:'#cbd8cf',medium:'#d3deea',small:'#e1d8e5'})[intent.sizeTier]||(panel.kind==='background'?'#d8e0e7':'#dfe6ed');context.fill();
      context.fillStyle='#34484d';context.font='600 44px '+FONT_FAMILIES['source-han-sans'];context.textAlign='center';context.textBaseline='middle';
      context.fillText((label||'镜头')+(intent.sizeTierLabel?' · '+intent.sizeTierLabel:''),b.x+b.w/2,b.y+b.h/2-60);
      context.font='32px '+FONT_FAMILIES['source-han-sans'];
      const lines=wrapText(context,description||'画面内容',Math.max(180,b.w-100)).slice(0,3);
      lines.forEach((line,i)=>context.fillText(line,b.x+b.w/2,b.y+b.h/2+i*43));
      context.font='28px '+FONT_FAMILIES['source-han-sans'];context.fillStyle='#627477';
      context.fillText(Math.round(panel.w)+' × '+Math.round(panel.h)+' px',b.x+b.w/2,b.y+b.h/2+lines.length*43+12);
    } else if(hasNewEffects(panel)){
      const crop=intersectRegion({x:region.x-panel.x,y:region.y-panel.y,w:region.w,h:region.h},b);
      if(crop){
        const layer=createSafeCanvas(crop.w*renderScale,crop.h*renderScale,canvasFactory),c=layer.getContext('2d');let mask=null;
        try{
          c.scale(renderScale,renderScale);c.translate(-crop.x,-crop.y);
          if(panel.imageAssetId){const image=await imageLoader(panel.imageAssetId),t=panel.imageTransform||fitImage(panel,{width:image.naturalWidth,height:image.naturalHeight});paintArtworkImage(c,panel,image,t);}
          if(!panel.imageAssetId){}
          paintGradient(c,panel,crop);applyFeather(c,panel,crop);
          if(panel.mask?.enabled&&panel.mask.strokes.length){mask=createSafeCanvas(crop.w*renderScale,crop.h*renderScale,canvasFactory);const m=mask.getContext('2d');paintBrushMask(m,panel,crop,renderScale);c.globalCompositeOperation='destination-in';c.drawImage(mask,crop.x,crop.y,mask.width/renderScale,mask.height/renderScale);c.globalCompositeOperation='source-over';}
          context.drawImage(layer,crop.x,crop.y,layer.width/renderScale,layer.height/renderScale);
        }finally{layer.width=1;layer.height=1;if(mask){mask.width=1;mask.height=1;}}
      }
    } else if(!panel.imageAssetId&&panel.coordinatePlaceholder){
      {}
    } else if(panel.imageAssetId){
      const image=await imageLoader(panel.imageAssetId),transform=panel.imageTransform||fitImage(panel,{width:image.naturalWidth,height:image.naturalHeight});
      if(panel.feather>0){
        // Restrict the temporary mask to this output segment, preserving the full-panel fade coordinates.
        const crop=intersectRegion({x:region.x-panel.x,y:region.y-panel.y,w:region.w,h:region.h},b);
        if(crop){
          const layer=createSafeCanvas(crop.w*renderScale,crop.h*renderScale,canvasFactory),c=layer.getContext('2d');
          c.scale(renderScale,renderScale);c.translate(-crop.x,-crop.y);
          paintArtworkImage(c,panel,image,transform);
          c.globalCompositeOperation='destination-in';
          const f=Math.min(.49,panel.feather/b.h),gradient=c.createLinearGradient(0,b.y,0,b.y+b.h);
          gradient.addColorStop(0,'rgba(0,0,0,0)');gradient.addColorStop(f,'rgba(0,0,0,1)');gradient.addColorStop(1-f,'rgba(0,0,0,1)');gradient.addColorStop(1,'rgba(0,0,0,0)');
          c.fillStyle=gradient;c.fillRect(crop.x,crop.y,layer.width/renderScale,layer.height/renderScale);
          context.drawImage(layer,crop.x,crop.y,layer.width/renderScale,layer.height/renderScale);
          layer.width=1;layer.height=1;
        }
      } else paintArtworkImage(context,panel,image,transform);
    }
  } finally {context.restore();}
  if(panel.border){
    context.save();context.translate(panel.x,panel.y);shape(context,panel);context.strokeStyle=panel.borderColor;context.lineWidth=panel.border;context.stroke();context.restore();
  }
}
/** All backgrounds are painted first, followed by one mixed stack; page edges never clip artwork. */
export async function paintSceneRegion(context,project,{layout=layoutLongStrip(project.pages),region={x:0,y:0,w:1280,h:1},draft=false,shots=project.shots||[],renderScale=1,imageLoader=loadImage,canvasFactory=defaultCanvasFactory}={}){
 const visible=intersectRegion(region,{x:0,y:0,w:layout.width,h:layout.height});if(!visible)return;context.save();try{context.beginPath();context.rect(visible.x,visible.y,visible.w,visible.h);context.clip();
 for(const e of layout.pages){const area=intersectRegion(visible,{x:0,y:e.y,w:layout.width,h:e.height});if(area){context.fillStyle=e.page.background;context.fillRect(area.x,area.y,area.w,area.h);}}
 if(!draft)for(const gap of stripBackgroundGaps(project,layout)){const area=intersectRegion(visible,{x:gap.x,y:gap.y,w:gap.w,h:gap.h});if(!area)continue;context.save();try{context.translate(gap.x,gap.y);paintGradient(context,gap,backgroundPaintRegion(gap,{x:visible.x-gap.x,y:visible.y-gap.y,w:visible.w,h:visible.h},1/renderScale));}finally{context.restore();}}
 for(const d of sceneLayers(project,layout)){if(!d.frame.visible)continue;context.save();try{context.translate(0,d.offsetY);context.scale(d.scale,d.scale);const local={x:visible.x/d.scale,y:(visible.y-d.offsetY)/d.scale,w:visible.w/d.scale,h:visible.h/d.scale};if(d.type==='bubble')await paintStyledBubble(context,d.frame,imageLoader);else{if(d.type==='gradient'&&draft)continue;const shot=shots.find(s=>s.id===d.frame.shotId);await paintPanel(context,d.frame,{draft,label:shot?shot.code+(shot.title&&shot.title!==shot.code?' · '+shot.title:''):'镜头',description:shot?.description||'',region:local,renderScale:renderScale*d.scale,imageLoader,canvasFactory});}}finally{context.restore();}}
 }finally{context.restore();}
}
/** Region coordinates are local to the page; every bubble uses the shared painter and crosses segments intact. */
export async function paintPage(context,page,{offsetY=0,draft=false,shots=[],region=null,renderScale=1,imageLoader=loadImage,canvasFactory=defaultCanvasFactory}={}){
  const visible=checkedRegion(page,region);if(!visible)return;
  const effects=createComicEffectRouting(page.panels);
  if(!Number.isFinite(renderScale)||renderScale<=0)throw new Error('绘制比例无效');
  context.save();
  try {
    context.translate(0,offsetY);context.beginPath();context.rect(visible.x,visible.y,visible.w,visible.h);context.clip();
    context.fillStyle=page.background;context.fillRect(visible.x,visible.y,visible.w,visible.h);
    for(const panel of page.panels){
      if(!effects.shouldRender(panel))continue;
      const shot=shots.find(s=>s.id===panel.shotId);
      await paintPanel(context,panel,{draft,label:shot?shot.code+(shot.title&&shot.title!==shot.code?' · '+shot.title:''):'镜头',description:shot?.description||'',region:visible,renderScale,imageLoader,canvasFactory});
    }
    // Do not cull on the stored bubble rectangle: expanded text boxes and tail tips may be outside it.
    for(const bubble of page.bubbles)if(effects.shouldRender(bubble))await paintStyledBubble(context,bubble,imageLoader);
  } finally {context.restore();}
}
export async function pageCanvas(page,options={}){
  clearImageCache();
  const region=checkedRegion(page,options.region);if(!region)throw new Error('裁切区域不在页面内');
  const scale=options.scale||1,canvas=createSafeCanvas(region.w*scale,region.h*scale,options.canvasFactory);
  const context=canvas.getContext('2d');context.scale(scale,scale);context.translate(-region.x,-region.y);
  await paintPage(context,page,{...options,region,renderScale:scale});return canvas;
}
export const pngBlob=canvas=>new Promise((resolve,reject)=>{
  try {canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('页面尺寸过大，PNG 导出失败')),'image/png');}catch(error){reject(new Error('PNG 导出失败：'+error.message));}
});
export function download(blob,name){
  const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
}
const crcTable=Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=(n&1)?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function crc32(bytes){let crc=0xffffffff;for(const byte of bytes)crc=crcTable[(crc^byte)&255]^(crc>>>8);return (crc^0xffffffff)>>>0;}
function header(size){const bytes=new Uint8Array(size);return {bytes,view:new DataView(bytes.buffer)};}
export function zipStore(files){
  if(!Array.isArray(files)||files.length>65535)throw new Error('分段数量超过 ZIP 格式容量，请按页导出');
  const local=[],central=[];let offset=0,centralSize=0;
  for(const {name,bytes} of files){
    const nameBytes=new TextEncoder().encode(name);
    if(!(bytes instanceof Uint8Array)||bytes.length>0xffffffff||nameBytes.length>65535||offset+30+nameBytes.length+bytes.length>0xffffffff)throw new Error('导出包超过 ZIP 格式容量，请按页导出');
    const crc=crc32(bytes),l=header(30);l.view.setUint32(0,0x04034b50,true);l.view.setUint16(4,20,true);l.view.setUint16(6,0x800,true);l.view.setUint32(14,crc,true);l.view.setUint32(18,bytes.length,true);l.view.setUint32(22,bytes.length,true);l.view.setUint16(26,nameBytes.length,true);local.push(l.bytes,nameBytes,bytes);
    const c=header(46);c.view.setUint32(0,0x02014b50,true);c.view.setUint16(4,20,true);c.view.setUint16(6,20,true);c.view.setUint16(8,0x800,true);c.view.setUint32(16,crc,true);c.view.setUint32(20,bytes.length,true);c.view.setUint32(24,bytes.length,true);c.view.setUint16(28,nameBytes.length,true);c.view.setUint32(42,offset,true);central.push(c.bytes,nameBytes);
    offset+=30+nameBytes.length+bytes.length;centralSize+=46+nameBytes.length;
  }
  if(offset+centralSize+22>0xffffffff)throw new Error('导出包超过 ZIP 格式容量，请按页导出');
  const end=header(22);end.view.setUint32(0,0x06054b50,true);end.view.setUint16(8,files.length,true);end.view.setUint16(10,files.length,true);end.view.setUint32(12,centralSize,true);end.view.setUint32(16,offset,true);
  return new Blob([...local,...central,end.bytes],{type:'application/zip'});
}
export async function renderStripSegment(layout,segment,{draft=false,shots=[],project=null,canvasFactory=defaultCanvasFactory,imageLoader=loadImage}={}){
 const canvas=createSafeCanvas(layout.width,segment.height,canvasFactory),context=canvas.getContext('2d');context.translate(0,-segment.y);const document=project||{pages:layout.pages.map(e=>e.page),shots};
 if(layout.episodeBoardParts){for(const part of layout.episodeBoardParts){const area=intersectRegion({x:0,y:segment.y,w:layout.width,h:segment.height},{x:0,y:part.y,w:layout.width,h:part.height});if(!area)continue;context.save();try{context.beginPath();context.rect(area.x,area.y,area.w,area.h);context.clip();if(part.kind==='comic'){context.translate(0,part.y-part.sourceY);await paintSceneRegion(context,document,{layout:layout.originalLayout,region:{x:0,y:part.sourceY+area.y-part.y,w:layout.width,h:area.h},draft,shots,canvasFactory,imageLoader});}else{context.translate(0,part.y);await paintEpisodeBoard(context,part.board,{imageLoader});}}finally{context.restore();}}return canvas;}
 await paintSceneRegion(context,document,{layout,region:{x:0,y:segment.y,w:layout.width,h:segment.height},draft,shots,canvasFactory,imageLoader});return canvas;
}

async function exportStrip(pages,{width,name,partName,draft=false,shots=[],onProgress=()=>{},segmentHeight=MAX_EXPORT_SEGMENT_HEIGHT,canvasFactory=defaultCanvasFactory,imageLoader=loadImage,download:save=download,maxArchiveBytes=MAX_EXPORT_ARCHIVE_BYTES,project=null,region=null,includeEpisodeBoards=false,episode=null,assets=project?.assets||[]}={}){
  if(typeof document!=='undefined')await document.fonts?.ready;
  clearImageCache();
  const layout=includeEpisodeBoards&&project?episodeExportLayout(project,{episode,assets}):layoutLongStrip(project?.pages||pages,{width});
  if(!layout.pages.length)throw new Error('没有可导出的页面');
  if(!Number.isSafeInteger(segmentHeight)||segmentHeight<1||segmentHeight>MAX_EXPORT_SEGMENT_HEIGHT)throw new Error('导出分段高度无效');
  if(Math.ceil((region?.h??layout.height)/segmentHeight)>65535)throw new Error('分段数量超过 ZIP 格式容量，请按页导出；工程数据保持完整');
  const parts=[];let bytesTotal=0;
  const range=region||{y:0,h:layout.height};
  const segments=function*(){for(let y=range.y,index=0;y<range.y+range.h;){const height=Math.min(segmentHeight,range.y+range.h-y);yield {index:index++,y,height};y+=height;}};
  for(const segment of segments()){
    onProgress('正在导出第 '+(segment.index+1)+' 段长图');
    const canvas=await renderStripSegment(layout,segment,{draft,shots,project,canvasFactory,imageLoader});
    try {
      const blob=await pngBlob(canvas);bytesTotal+=blob.size;
      if(bytesTotal>maxArchiveBytes)throw new Error('当前导出超过浏览器内存预算，请按页导出；没有截断页面');
      parts.push({name:partName+'_'+String(segment.index+1).padStart(2,'0')+'.png',bytes:new Uint8Array(await blob.arrayBuffer())});
    } finally {canvas.width=1;canvas.height=1;}
  }
  if(parts.length===1)save(new Blob([parts[0].bytes],{type:'image/png'}),name+'.png');else save(zipStore(parts),name+'_分段.zip');
  return {parts:parts.length,height:range.h,width:layout.width};
}
export async function exportLayoutPage(page,shots,options={}){
  return exportStrip([page],{width:page.width,name:page.name+'_版式草稿',partName:'版式草稿',draft:true,shots,...options});
}
export async function exportPage(page,options={}){
  
  const layout=options.project?layoutLongStrip(options.project.pages):null,entry=layout?.pages.find(e=>e.pageId===page.id);return exportStrip([page],{width:entry?1280:page.width,name:page.name,partName:'长图',...options,region:entry?{y:entry.y,h:entry.height}:null});
}
export async function exportEpisode(project,onProgress=()=>{},options={}){
  if(typeof document!=='undefined')await document.fonts?.ready;
  clearImageCache();
  const layout=episodeExportLayout(project,{episode:options.episode??null,assets:options.assets||project.assets||[]});
  return exportCompleteStrip({project,layout,episode:options.episode??null,onProgress,request:options.request,downloadURL:options.downloadURL,segmentHeight:options.segmentHeight,renderSegment:async segment=>{
    const canvas=await renderStripSegment(layout,segment,{project,canvasFactory:options.canvasFactory,imageLoader:options.imageLoader});
    try{return await pngBlob(canvas);}finally{canvas.width=1;canvas.height=1;}
  }});
}

// Keep browser canvases bounded; the existing server joins the verified strips
// into a single PNG without a 38400px browser canvas or a misleading .png ZIP.


export async function exportEpisodeBoard(board,options={}){
 if(typeof document!=='undefined')await document.fonts?.ready;
 const name='第'+board.context.displayNumber+'话_'+(board.kind==='cover'?'封面':'尾图'),parts=[];let bytes=0;
 // Match regular strip exports: draw tall images sequentially with bounded canvases.
 for(let y=0;y<board.height;y+=MAX_EXPORT_SEGMENT_HEIGHT){const height=Math.min(MAX_EXPORT_SEGMENT_HEIGHT,board.height-y),canvas=createSafeCanvas(1280,height,options.canvasFactory);try{const context=canvas.getContext('2d');context.translate(0,-y);await paintEpisodeBoard(context,board,{imageLoader:options.imageLoader||loadImage});const blob=await pngBlob(canvas);bytes+=blob.size;if(bytes>(options.maxArchiveBytes??MAX_EXPORT_ARCHIVE_BYTES))throw new Error('封面 / 尾图导出超过浏览器内存预算；原图和工程保持完整');parts.push({name:name+'_'+String(parts.length+1).padStart(2,'0')+'.png',bytes:new Uint8Array(await blob.arrayBuffer())});}finally{canvas.width=1;canvas.height=1;}}
 const save=options.download||download;if(parts.length===1)save(new Blob([parts[0].bytes],{type:'image/png'}),name+'.png');else save(zipStore(parts),name+'_分段.zip');return {parts:parts.length,width:1280,height:board.height};
}
