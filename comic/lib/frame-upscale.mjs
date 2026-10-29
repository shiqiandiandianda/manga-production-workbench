import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createHash,randomUUID} from 'node:crypto';
import {bounds,clone,id} from '../public/model.js';
import {pageCanvas} from '../public/render.js';
import {check} from './store.mjs';
import {readableRaster} from './readable-raster.mjs';
import {orderedLayers} from '../public/layers.js';
import {generationTargetStamp} from './generation-autofill.mjs';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const artworkMembers=(project,panel)=>orderedLayers(project).filter(e=>e.type==='panel'&&e.item.visible!==false&&(e.item.id===panel.id||!panel.cutoutLayer&&e.item.cutoutLayer?.parentPanelId===panel.id)).map(e=>e.item);
export const FRAME_UPSCALE_PROMPT='将所附画格截图高清放大至宽高各 2 倍。严格保持截图的构图、可见范围、人物身份、姿态、服装、物件、颜色和二维画风，只提升线条清晰度与细节。不要恢复裁掉的原图内容，不扩图、不改变镜头、不添加人物、文字或水印。保留已有文字和透明区域。';

// Render artwork with the editor's own painter at document resolution. Viewport
// zoom, selection handles, other panels and editable lettering are not pixels.
export async function captureFrameUpscale(project,panel,store,cacheDir){
 const page=project.pages.find(p=>p.panels.includes(panel));
 check(page&&panel.imageAssetId&&panel.visible!==false,'请选择可见且已有图片的画格');
 check(!panel.cutoutLayer||panel.cutoutLayer.kind==='upscale','请选择原画格或高清图层');
 const b=bounds(panel),left=Math.max(0,Math.floor(panel.x+b.x)),top=Math.max(0,Math.floor(panel.y+b.y)),right=Math.min(page.width,Math.ceil(panel.x+b.x+b.w)),bottom=Math.min(page.height,Math.ceil(panel.y+b.y+b.h));
 check(right>left&&bottom>top,'画格不在画板内');
 const region={x:left,y:top,w:right-left,h:bottom-top};
 const lib=createRequire(import.meta.url)(process.env.COMIC_CANVAS_MODULE||process.env.COMIC_TEST_CANVAS_MODULE||'@napi-rs/canvas');
 const file=store.assetPath(panel.imageAssetId),source=fs.readFileSync(file),image=await readableRaster(lib,source,{file,cacheDir});
 const snapshot=clone(page),members=artworkMembers(project,panel),images=new Map([[panel.imageAssetId,image]]),appearanceStamp=frameUpscaleStamp(project,panel,store);
 snapshot.panels=members.map(member=>{const frame=clone(member);frame.border=0;delete frame.productionBackgroundInstance;delete frame.productionBackgroundResource;return frame;});snapshot.bubbles=[];
 const canvas=await pageCanvas(snapshot,{region,imageLoader:async key=>{if(!images.has(key)){check(members.some(m=>m.imageAssetId===key),'截图包含未知图片');const file=store.assetPath(key);images.set(key,await readableRaster(lib,fs.readFileSync(file),{file,cacheDir}));}return images.get(key);},canvasFactory:()=>lib.createCanvas(1,1)});
 check(appearanceStamp===frameUpscaleStamp(project,panel,store),'截图期间画格显示已改变，请重试',409);
 const bytes=canvas.toBuffer('image/png');
 return {bytes,source:{assetId:panel.imageAssetId,width:canvas.width,height:canvas.height,sha256:hash(source),snapshotSha256:hash(bytes),region,transform:{x:left-panel.x,y:top-panel.y,scale:1},frameUpscale:true,requestedScale:2,appearanceStamp}};
}

export function frameUpscaleStamp(project,panel,store){
 const page=project.pages.find(p=>p.panels.includes(panel));
 return JSON.stringify({background:page?.background,pageWidth:page?.width,pageHeight:page?.height,visible:panel.visible,members:artworkMembers(project,panel).map(p=>({id:p.id,stamp:generationTargetStamp(p,'edit',id=>store.assetPath(id)),featherEdges:p.featherEdges,gradient:p.gradient,borderColor:p.borderColor,cutoutLayer:p.cutoutLayer}))});
}

export function frameUpscaleResultError(source,asset){
 if(Math.abs(asset.width/asset.height-source.width/source.height)>.001)return '截图高清结果比例改变，已保留候选';
 if(asset.width<source.width*2||asset.height<source.height*2)return `截图高清结果未达到 2 倍尺寸（要求 ${source.width*2} × ${source.height*2}，实际 ${asset.width} × ${asset.height}），已保留候选`;
 return null;
}

export function applyFrameUpscale(project,parent,asset,source,jobId){
 const page=project.pages.find(p=>p.panels.includes(parent));
 check(page&&!page.locked&&!parent.locked,'请先解锁画格和画板',409);
 check(!frameUpscaleResultError(source,asset),frameUpscaleResultError(source,asset),409);
 const updating=parent.cutoutLayer?.kind==='upscale';
 check(updating||page.panels.length<1000,'当前画板图层数量已达上限');
 const layer=updating?parent:{...clone(parent),id:id('panel'),referenceIds:[],candidates:[],generationToken:null};
 if(!updating){
  // The child is artwork, not another production/generation unit.
  for(const key of ['generation','productionSegment','productionGrid','productionBackground','panelSlice','nativeSizing','imageEffects','breakoutCandidates'])delete layer[key];
  layer.cutoutLayer={version:1,parentPanelId:parent.id,sourceAssetId:parent.imageAssetId,kind:'upscale',sessionId:randomUUID()};
 }
 layer.name='Codex 截图高清 · '+(parent.name||'画格').slice(0,80);
 layer.imageAssetId=asset.id;layer.candidates=[...new Set([...layer.candidates,asset.id])].slice(-40);
 layer.imageTransform={...source.transform,scale:source.width/asset.width};
 // These effects are baked into the snapshot; do not apply them twice.
 layer.feather=0;delete layer.featherEdges;delete layer.mask;delete layer.gradient;delete layer.imageEffects;
 Object.assign(layer.cutoutLayer,{scale:asset.width/source.width,width:asset.width,height:asset.height,model:'codex-frame-upscale',taskId:jobId});
 layer.frameUpscaleSource={version:1,jobId,...clone(source)};
 if(!updating){page.panels.push(layer);const order=[...new Set([...(project.layerOrder||[]),...project.pages.flatMap(p=>[...p.panels,...p.bubbles].map(f=>f.id)),...(project.gradients||[]).map(g=>g.id)])].filter(key=>key!==layer.id);const at=Math.max(order.indexOf(parent.id),...page.panels.filter(p=>p.cutoutLayer?.parentPanelId===parent.id).map(p=>order.indexOf(p.id)));order.splice(at+1,0,layer.id);project.layerOrder=order;}
 return layer;
}
