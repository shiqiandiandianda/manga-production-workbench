import {id,clone,rectangle,bounds,validPolygon,layoutLongStrip,validatePageHeight} from './model.js';
import {normalizeLayerOrder,gradientFrame} from './layers.js';
import {featherEdges,rebasePanelEffects,validPanelEffects} from './panel-effects.js';
import {applyBubbleEdit} from './bubble-editor.js';
import {repairGapBackgrounds,preservedGapBackgrounds} from './gap-background.js';

export const DEFAULT_SPACE_HEIGHT=240;
export const MAX_SPACE_HEIGHT=10000;
const epsilon=.001;
const hex=value=>typeof value==='string'&&/^#[0-9a-f]{6}$/i.test(value);
const safeSum=(a,b)=>{const n=a+b;if(!Number.isSafeInteger(n))throw Error('长条长度超出支持范围');return n;};
function heightValue(value,allowZero=false){const h=Number(value);if(!Number.isSafeInteger(h)||h<(allowZero?0:1)||h>MAX_SPACE_HEIGHT)throw Error('底图高度请输入 '+(allowZero?'0':'1')+'—10000 像素');return h;}
export function insertionPage(project,y){
 const layout=layoutLongStrip(project.pages),cut=Math.round(Number(y));
 if(!Number.isSafeInteger(cut)||cut<0||cut>layout.height)throw Error('请在长条内画线');
 if(project.pages.some(p=>p.width!==1280))throw Error('请先使用1280宽的整话画板');
 const entry=layout.pages.find(p=>cut>=p.y&&cut<p.endY)||layout.pages.at(-1);
 return {layout,entry,y:cut,localY:cut-entry.y};
}
/** A spacing cut never splits artwork or text. Hidden layers retain their relative coordinates. */
export function spaceCutBlockers(project,y,{bubbleSizes={}}={}){
 const {layout,y:cut}=insertionPage(project,y),out=[];
 for(const entry of layout.pages){
  for(const f of entry.page.panels){if(!f.visible)continue;const b=bounds(f),top=entry.y+f.y+b.y,bottom=top+b.h;
   if(cut>top+epsilon&&cut<bottom-epsilon)out.push({type:'panel',id:f.id,top,bottom});}
  for(const b of entry.page.bubbles){if(b.visible===false)continue;const size=bubbleSizes[b.id]||b,top=entry.y+b.y,bottom=top+size.h;
   if(cut>top+epsilon&&cut<bottom-epsilon)out.push({type:'bubble',id:b.id,top,bottom});}
 }
 return out;
}
function clipHorizontal(points,y,upper){
 const result=[],inside=p=>upper?p.y<=y+1e-10:p.y>=y-1e-10;
 for(let i=0;i<points.length;i++){
  const a=points[i],b=points[(i+1)%points.length],ia=inside(a),ib=inside(b);
  if(ia)result.push({...a});
  if(ia!==ib){const t=(y-a.y)/(b.y-a.y);result.push({x:a.x+(b.x-a.x)*t,y});}
 }
 return result.filter((p,i)=>{const before=result[(i+result.length-1)%result.length];return Math.hypot(p.x-before.x,p.y-before.y)>1e-9;});
}
function gradientPiece(layer,points,{dy=0,key=layer.id,cutTop=false,cutBottom=false}={}){
 if(points.length<3)return null;
 const part=clone(layer),oldW=part.w,oldH=part.h,edges=featherEdges(part);
 const box=bounds({...part,points});if(box.w<.0001||box.h<.0001)return null;
 const frameBox={...box,w:Math.max(1,box.w),h:Math.max(1,box.h)};
 rebasePanelEffects(part,frameBox);
 part.x+=box.x;part.y+=box.y+dy;part.w=frameBox.w;part.h=frameBox.h;
 part.points=points.map(p=>({x:(p.x*oldW-box.x)/part.w,y:(p.y*oldH-box.y)/part.h}));
 part.coverage='area';part.id=key;part.feather=0;
 part.featherEdges={...edges,top:cutTop?0:edges.top,bottom:cutBottom?0:edges.bottom};
 // A split old space becomes an ordinary background; the new inserted band has its own controls.
 delete part.stripSpace;
 if(!validPolygon(part.points)||!validPanelEffects(part))throw Error('这层底图的轮廓或蒙版无法在这里拆开，请换一个位置画线');
 return part;
}
function mapGradients(project,layout,from,to,delta,excludeId){
 const gradients=[],replacements=new Map();
 for(const source of project.gradients||[]){
  if(source.id===excludeId){gradients.push(source);replacements.set(source.id,[source.id]);continue;}
  const g=clone(source.coverage==='document'?gradientFrame(source,layout):source);g.coverage='area';
  const b=bounds(g),top=g.y+b.y,bottom=top+b.h,parts=[];
  if(bottom<=from+epsilon){parts.push(g);}
  else if(top>=to-epsilon){g.y+=delta;parts.push(g);}
  else{
   if(top<from-epsilon){const part=gradientPiece(g,clipHorizontal(g.points,(from-g.y)/g.h,true),{cutBottom:true});if(part)parts.push(part);}
   if(bottom>to+epsilon){const part=gradientPiece(g,clipHorizontal(g.points,(to-g.y)/g.h,false),{dy:delta,key:parts.length?id('gradient'):g.id,cutTop:true});if(part){if(parts.length)part.name=(part.name+' · 下段').slice(0,120);parts.push(part);}}
  }
  gradients.push(...parts);replacements.set(source.id,parts.map(p=>p.id));
 }
 project.gradients=gradients;
 project.layerOrder=(project.layerOrder||[]).flatMap(key=>replacements.get(key)||[key]);
}
function metadataAfterShift(project,from,to,delta){
 const shift=y=>Number.isFinite(y)?y>=to-epsilon?y+delta:y>from?from:y:y;
 
 
 
 for(const page of project.pages)for(const f of page.panels){if(!f.layoutIntent)continue;
  f.layoutIntent.letteringZones=page.bubbles.filter(b=>b.shotId===f.shotId).map(b=>({x:b.x-f.x,y:b.y-f.y,w:b.w,h:b.h,type:b.type}));}
}
function moveContent(project,{pageId,from,to,delta,excludeId}){
 const layout=layoutLongStrip(project.pages),entry=layout.pages.find(p=>p.pageId===pageId);
 if(!entry)throw Error('插入位置所属画板不存在');
 const page=entry.page,localCut=to-entry.y;
 validatePageHeight(safeSum(page.height,delta));
 for(const f of page.panels){const b=bounds(f);if(f.y+b.y>=localCut-epsilon)f.y+=delta;}
 page.bubbles=page.bubbles.map(b=>b.y>=localCut-epsilon?applyBubbleEdit(b,{type:'move',dx:0,dy:delta}):b);
 mapGradients(project,layout,from,to,delta,excludeId);
 page.height+=delta;metadataAfterShift(project,from,to,delta);
}
function finish(project,operation){
 if(project.gradients.length>200)throw Error('底图层已达到200层上限，请先合并或删除多余底图');
 normalizeLayerOrder(project);
 project.spacingEdits=[...(project.spacingEdits||[]).slice(-199),{...operation,at:new Date().toISOString()}];
 return project;
}
/** Adjust an already empty gap; reject any cut through artwork, text or locked content. */
export function resizeEmptyGap(source,{from,to,height,bubbleSizes={}}){
 source=repairGapBackgrounds(source).project;
 const h=heightValue(height,true),start=Math.ceil(from),end=Math.floor(to);if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||end<start)throw Error('画格之间没有可调整的空隙');
 const {entry}=insertionPage(source,start),layout=layoutLongStrip(source.pages);if(end>entry.endY)throw Error('请分别调整两个画板的留白');
 for(const e of layout.pages){for(const f of e.page.panels){const b=bounds(f),top=e.y+f.y+b.y,bottom=top+b.h;if(top<end-.001&&bottom>start+.001)throw Error('留白内已有画格，请使用插入底图');if(e.pageId===entry.pageId&&f.locked&&top>=end-.001&&h!==end-start)throw Error('下方有锁定画格，请先解锁');}
  for(const b of e.page.bubbles){const size=bubbleSizes[b.id]||b,top=e.y+b.y,bottom=top+size.h;if(top<end-.001&&bottom>start+.001)throw Error('留白内已有文字，请先移动文字');if(e.pageId===entry.pageId&&b.locked&&top>=end-.001&&h!==end-start)throw Error('下方有锁定文字，请先解锁');}}
 for(const g of source.gradients||[])if(g.locked&&g.y+g.h>start&&h!==end-start)throw Error('下方有锁定底图，请先解锁');
 const project=clone(source),delta=h-(end-start);if(!delta)return {project,pageId:entry.pageId,height:h};normalizeLayerOrder(project);const bands=preservedGapBackgrounds(source,{from:start,to:end,height:h,pageId:entry.pageId});moveContent(project,{pageId:entry.pageId,from:start,to:end,delta});
 for(const layer of bands){project.gradients.push(layer);project.layerOrder.unshift(layer.id);}
 finish(project,{kind:'gap',y:start,height:h,delta});return {project,pageId:entry.pageId,height:h};
}
/** Pure atomic edit: originals, artwork sizes, image transforms and dialogue remain unchanged. */
export function insertStripSpace(source,{y,height=DEFAULT_SPACE_HEIGHT,color,bubbleSizes={}}){
 const h=heightValue(height);if(!hex(color))throw Error('请选择有效的底图颜色');
 const {entry,y:cut}=insertionPage(source,y);
 if(spaceCutBlockers(source,cut,{bubbleSizes}).length)throw Error('这条线穿过图片或文字，请画在格子之间的底色空隙');
 const existing=(source.gradients||[]).find(g=>g.stripSpace&&g.y<=cut&&cut<g.y+g.h&&g.gradient.startColor.toLowerCase()===color.toLowerCase()&&g.gradient.endColor.toLowerCase()===color.toLowerCase());
 if(existing)return resizeStripSpace(source,existing.id,existing.h+h,{color,bubbleSizes});
 const project=clone(source);normalizeLayerOrder(project);
 moveContent(project,{pageId:entry.pageId,from:cut,to:cut,delta:h});
 const layer={id:id('gradient'),name:'插入底图 · '+h+' px',coverage:'area',visible:true,locked:false,x:0,y:cut,w:1280,h,
  points:rectangle(),border:0,borderColor:'#111111',feather:0,
  gradient:{enabled:true,mode:'color',startColor:color,endColor:color,opacity:1,start:{x:.5,y:0},end:{x:.5,y:1}},
  stripSpace:{version:1,pageId:entry.pageId,colorSource:'line-position'}};
 project.gradients.push(layer);project.layerOrder.unshift(layer.id);
 finish(project,{kind:'insert',layerId:layer.id,y:cut,height:h,color});
 return {project,layerId:layer.id,pageId:entry.pageId,height:h};
}
/** Growing/shrinking a persisted spacer moves the following content by the same amount. */
export function resizeStripSpace(source,layerId,height,{color,bubbleSizes={}}={}){
 const h=heightValue(height,true),project=clone(source);normalizeLayerOrder(project);
 const layer=project.gradients.find(g=>g.id===layerId&&g.stripSpace);
 if(!layer)throw Error('插入底图不存在');if(color!==undefined&&!hex(color))throw Error('底图颜色无效');
 const oldEnd=layer.y+layer.h,delta=h-layer.h,newEnd=layer.y+h;
 if(delta<0){
  const layout=layoutLongStrip(project.pages);
  for(const entry of layout.pages){for(const f of entry.page.panels){const b=bounds(f),top=entry.y+f.y+b.y;if(top<oldEnd-epsilon&&top+b.h>newEnd+epsilon)throw Error('要收起的留白内已有格子，请先移出格子');}
   for(const b of entry.page.bubbles){const size=bubbleSizes[b.id]||b,top=entry.y+b.y;if(top<oldEnd-epsilon&&top+size.h>newEnd+epsilon)throw Error('要收起的留白内已有对白，请先移出对白');}}
 }
 if(delta)moveContent(project,{pageId:layer.stripSpace.pageId,from:delta>0?oldEnd:newEnd,to:oldEnd,delta,excludeId:layerId});
 if(h===0){project.gradients=project.gradients.filter(g=>g.id!==layerId);project.layerOrder=project.layerOrder.filter(key=>key!==layerId);}
 else{layer.h=h;layer.name='插入底图 · '+h+' px';if(color)layer.gradient.startColor=layer.gradient.endColor=color;}
 finish(project,{kind:h?'resize':'remove',layerId,y:layer.y,height:h,delta,color:color||layer.gradient.startColor});
 return {project,layerId:h?layerId:null,pageId:layer.stripSpace.pageId,height:h};
}
