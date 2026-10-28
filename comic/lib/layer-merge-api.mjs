import {readableRaster} from './readable-raster.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createHash,randomUUID} from 'node:crypto';
import {check,validateProject} from './store.mjs';
import {comicStyleFile} from './comic-style-library.mjs';
import {planLayerMerge,applyLayerMerge} from '../public/layer-merge.js';
import {paintSceneRegion} from '../public/render.js';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export function createLayerMergeAPI({store,dataDir,body,json,saveProject,addAsset}){
 const busy=new Set();
 const historyFile=path.join(dataDir,'merged-layers','history.json');let history=[];try{history=JSON.parse(fs.readFileSync(historyFile,'utf8'));}catch{}
 const saveHistory=()=>{fs.mkdirSync(path.dirname(historyFile),{recursive:true});fs.writeFileSync(historyFile+'.tmp',JSON.stringify(history));fs.renameSync(historyFile+'.tmp',historyFile);};
 function restorableImages(old,next){const allowed=new Set();for(const page of next.pages||[])for(const layer of page.panels||[]){const current=old.pages.flatMap(p=>p.panels).find(f=>f.id===layer.id);if(!current||current.imageAssetId===layer.imageAssetId)continue;const edges=history.filter(r=>r.projectId===old.id&&r.layerId===layer.id),seen=new Set([current.imageAssetId]);let changed=true;while(changed){changed=false;for(const edge of edges)if(seen.has(edge.from)||seen.has(edge.to))for(const key of [edge.from,edge.to])if(!seen.has(key)){seen.add(key);changed=true;}}if(seen.has(layer.imageAssetId)&&store.db.assets.some(a=>a.id===layer.imageAssetId))allowed.add(layer.id);}return allowed;}
 async function handle(req,res,{pathname,method}){
  const match=pathname.match(/^\/api\/projects\/(project_[a-f0-9-]{36})\/merge-layers$/);if(!match)return false;check(method==='POST','请使用POST',405);
  const input=await body(req),project=store.project(match[1]),snapshot=JSON.stringify(project);
  const guard=()=>{check(store.project(project.id).revision===input.expectedRevision&&JSON.stringify(store.project(project.id))===snapshot,'工程已变化，请保存后重新合并',409);const ids=new Set(input.layerIds||[]);for(const p of project.pages)for(const f of p.panels)if(ids.has(f.id)&&f.cutoutLayer)ids.add(f.cutoutLayer.parentPanelId);check(!store.db.jobs.some(j=>j.projectId===project.id&&ids.has(j.panelId)&&['queued','running','recoverable','awaiting_confirmation'].includes(j.status)),'所选图层还有生成任务，请完成或取消后合并',409);};
  guard();check(!busy.has(project.id),'正在合并所选图层，请稍候',409);busy.add(project.id);let output,asset,committed=false,next;
  try{
   const native=createRequire(import.meta.url)(process.env.COMIC_CANVAS_MODULE||process.env.COMIC_TEST_CANVAS_MODULE||'@napi-rs/canvas'),measurement=native.createCanvas(1,1).getContext('2d'),plan=planLayerMerge(project,input.layerIds,measurement,new Map(store.db.assets.map(a=>[a.id,a]))),width=Math.ceil(plan.region.w*plan.scale),height=Math.ceil(plan.region.h*plan.scale);
   check(width<=16384&&height<=16384&&width*height<=100000000,'合并结果超过一亿像素或16384px边长，请分批合并');
   const images=new Map(),sources=new Map(),load=async id=>{if(!images.has(id)){const file=id.startsWith('comic:')?comicStyleFile(id.slice(6)):store.assetPath(id),bytes=fs.readFileSync(file);sources.set(file,hash(bytes));images.set(id,readableRaster(native,bytes,{file,cacheDir:path.join(dataDir,'image-decode-cache')}));}return images.get(id);},canvas=native.createCanvas(width,height),context=canvas.getContext('2d'),tileHeight=Math.max(1,Math.min(height,Math.floor(16*1024*1024/width)));
   for(let y=0;y<height;y+=tileHeight){const h=Math.min(tileHeight,height-y),tile=native.createCanvas(width,h),ctx=tile.getContext('2d');ctx.scale(plan.scale,plan.scale);ctx.translate(0,-y/plan.scale);await paintSceneRegion(ctx,plan.isolated,{layout:plan.layout,region:{x:0,y:y/plan.scale,w:plan.region.w,h:h/plan.scale},renderScale:plan.scale,canvasFactory:()=>native.createCanvas(1,1),imageLoader:load});context.drawImage(tile,0,y);tile.width=1;tile.height=1;}
   guard();for(const [file,digest] of sources)check(hash(fs.readFileSync(file))===digest,'来源图片已改变，请重新合并',409);
   const folder=path.join(dataDir,'merged-layers');fs.mkdirSync(folder,{recursive:true});output=path.join(folder,randomUUID()+'.png');fs.writeFileSync(output,canvas.toBuffer('image/png'));asset=addAsset(output,'合并图层','layer-merge');const applied=applyLayerMerge(project,plan,asset);next=applied.project;validateProject(next);guard();const source=plan.entries.find(e=>e.item.id===plan.anchorId)?.item;if(source?.imageAssetId){history.push({projectId:project.id,layerId:plan.anchorId,from:source.imageAssetId,to:asset.id});saveHistory();}store.db.projects[store.db.projects.indexOf(project)]=next;const saved=saveProject(next,{editor:true});committed=true;json(res,200,{project:saved,asset,layerId:applied.layerId,mergedIds:plan.keys});return true;
  }catch(error){if(!committed){if(next&&store.db.projects.includes(next))store.db.projects[store.db.projects.indexOf(next)]=project;if(asset)store.db.assets=store.db.assets.filter(a=>a.id!==asset.id);if(output)fs.rmSync(output,{force:true});}throw error;}finally{busy.delete(project.id);}
 }
 return {handle,restorableImages,running:()=>busy.size};
}
