import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {bubbleLayout} from '../public/lettering.js';
import {frameRegionOnSource} from '../public/panel-slices.js';
import {buildReflowProject} from '../public/auto-layout-reflow.mjs';
import {artworkBackgroundGeometry} from '../public/artwork-backgrounds.mjs';
import {buildStoryBackgroundLayers} from '../public/story-background-layers.mjs';
const require=createRequire(import.meta.url),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const validRect=r=>r&&['x','y','w','h'].every(k=>Number.isFinite(r[k]))&&r.w>0&&r.h>0;
let measurementContext;

/** Known tool text is removed from sampling. Unpositioned/baked-in text never becomes semantic evidence. */
export function addReflowPaletteExclusions(project,item){
 const frames=project.pages.flatMap(p=>p.panels),bubbles=project.pages.flatMap(p=>p.bubbles).filter(b=>b.visible!==false),existing=frames.find(f=>f.id===item.existingPanelId),root=frames.find(f=>f.id===item.rootPanelId),source=frames.find(f=>f.id===item.sourcePanelId),rects=[];
 for(const bubble of bubbles)for(const r of reflowTextObstacles({pages:[{bubbles:[bubble]}]})){
  const b={...bubble,...r};
  if(existing&&b.parentPanelId===existing.id){const t=existing.imageTransform;if(!t?.scale||t.rotation||t.flipX||t.flipY){item.paletteUnsafeText=true;continue;}rects.push({x:(b.x-existing.x-t.x)/t.scale/item.width,y:(b.y-existing.y-t.y)/t.scale/item.height,w:b.w/t.scale/item.width,h:b.h/t.scale/item.height});}
  else if(root&&source&&(b.parentPanelId===root.id||b.parentPanelId===source.id)){
   const r=frameRegionOnSource(source,root,{width:item.sourceWidth,height:item.sourceHeight},{x:(b.x-root.x)/root.w,y:(b.y-root.y)/root.h,w:b.w/root.w,h:b.h/root.h});
   rects.push({x:(r.x*item.sourceWidth-item.pixels.x)/item.width,y:(r.y*item.sourceHeight-item.pixels.y)/item.height,w:r.w*item.sourceWidth/item.width,h:r.h*item.sourceHeight/item.height});
  }
 }
 item.paletteExclusions=rects.filter(validRect);
 item.paletteRegions=(existing?.backgroundColorRegions||[]).filter(r=>r.confirmed===true&&r.sourceSha256===item.sha256&&validRect(r.rect));
 return item;
}

/** Read only fixed, explicitly annotated scene references already bound to this source frame. */
export async function addSceneReferencePalettes(project,item,shot,store,sample){
 const frame=project.pages.flatMap(p=>p.panels).find(f=>f.id===item.existingPanelId)||project.pages.flatMap(p=>p.panels).find(f=>f.id===item.rootPanelId),roles=frame?.generation?.referenceRoles||[];item.referencePalettes=[];
 for(const role of roles.filter(r=>r.role==='scene')){
  const asset=store.db.assets.find(a=>a.id===role.assetId),e=asset?.backgroundPalette;if(!asset||!shot.location||e?.scene!==shot.location||!Array.isArray(e.regions))continue;
  const filePath=store.assetPath(asset.id),hash=sha(fs.readFileSync(filePath));if(hash!==e.sourceSha256)continue;
  const palette=await sample({filePath,sha256:hash,paletteRegions:e.regions.filter(r=>r.confirmed===true&&r.sourceSha256===hash)});
  item.referencePalettes.push({assetId:asset.id,scene:e.scene,sha256:hash,verifiedLocal:true,regionObservations:palette.regionObservations||[]});
 }
}

/** Use the same text measurements as the real renderer, including overflow glyphs and bubble tails. */
export function reflowTextObstacles(project){
 const {createCanvas,GlobalFonts}=require(process.env.COMIC_CANVAS_MODULE||'@napi-rs/canvas');
 if(!measurementContext){for(const name of ['SourceHanSansSC-Regular.otf','SourceHanSansSC-Bold.otf']){const font=fileURLToPath(new URL('../public/fonts/'+name,import.meta.url));if(fs.existsSync(font))GlobalFonts.registerFromPath(font,'Source Han Sans SC');}measurementContext=createCanvas(8,8).getContext('2d');}
 const measure=measurementContext,rects=[];
 for(const b of project.pages.flatMap(p=>p.bubbles).filter(b=>b.visible!==false)){
  rects.push({x:b.x,y:b.y,w:b.w,h:b.h});const layout=bubbleLayout(measure,b),points=[];
  for(const part of layout.dialogueLayouts||[layout])for(const line of part.lines||[])for(const glyph of line.glyphs||[{x:line.x,y:line.y,width:line.width}]){const width=glyph.width||part.fontSize,align=line.glyphs?'center':part.textAlign,dx=align==='center'?width/2:align==='right'?width:0;points.push({x:b.x+glyph.x-dx,y:b.y+glyph.y-part.fontSize},{x:b.x+glyph.x-dx+width,y:b.y+glyph.y+part.fontSize});}
  if(layout.tail?.tip)points.push({x:b.x+layout.tail.tip.x,y:b.y+layout.tail.tip.y});
  if(points.length)rects.push({x:Math.min(...points.map(p=>p.x)),y:Math.min(...points.map(p=>p.y)),w:Math.max(...points.map(p=>p.x))-Math.min(...points.map(p=>p.x)),h:Math.max(...points.map(p=>p.y))-Math.min(...points.map(p=>p.y))});
 }
 return rects;
}

export function replaceLocalBackgroundLayers(project,geometry,originalIds){
 const removed=new Set(project.gradients.filter(g=>!originalIds.has(g.id)).map(g=>g.id));project.gradients=project.gradients.filter(g=>!removed.has(g.id));
 const layers=buildStoryBackgroundLayers(geometry);
 project.gradients.push(...layers);project.layerOrder=[...layers.map(l=>l.id),...(project.layerOrder||[]).filter(key=>!removed.has(key))];project.autoLayoutSource.generator=structuredClone(geometry.generator);project.autoLayoutSource.localBackgroundPolicy=geometry.localBackgroundPolicy;project.autoLayoutSource.backgroundDecisions=geometry.artworkPaletteDecisions;
}
export function buildReflowWithLocalBackgrounds({original,script,packet,items,batchId,views}){
 const rendered=buildReflowProject({original,script,geometry:packet,items,batchId,views}),geometry=artworkBackgroundGeometry(packet,items,script.shots,{obstacles:reflowTextObstacles(rendered)});
 replaceLocalBackgroundLayers(rendered,geometry,new Set((original.gradients||[]).map(g=>g.id)));return {geometry,rendered};
}
