import {coverView,coverSettings} from './artwork-framing.mjs';
import {ensureReflowZoom,reflowCoverViewFromTransform} from './reflow-image-zoom.mjs';
import {scaleReflowLettering} from './reflow-lettering.mjs';
import {assertNativeAspect} from './unified-layout-rules.js';
import {buildLayoutProject} from './auto-layout-adapter.mjs';
import {id,clone} from './model.js';
import {frameRegionOnSource} from './panel-slices.js';
import {pageEpisode} from './episode-boards.js';
import {normalizeLayerOrder} from './layers.js';
import {splitProductionScreenBoards} from './production-screen-boards.js';

/** Replace only this episode's boards while retaining their original layers hidden. */
export function mergeReflowIntoOriginal(original,derived,episode){
 const target=original.pages.filter(p=>pageEpisode(original,p)===Number(episode));if(!target.length)throw Error('原工程没有对应话的画板');
 const ids=new Set(target.map(p=>p.id)),pages=derived.pages.filter(p=>pageEpisode(derived,p)===Number(episode)).map(clone);if(!pages.length)throw Error('重排结果没有对应话的画板');
 for(const page of pages){page.panels=page.panels.filter(p=>!p.autoLayoutOriginalPageId||ids.has(p.autoLayoutOriginalPageId));page.bubbles=page.bubbles.filter(b=>!b.autoLayoutOriginalPageId||ids.has(b.autoLayoutOriginalPageId));}
 const page=pages[0],next=clone(original),first=next.pages.findIndex(p=>ids.has(p.id));next.pages=next.pages.filter(p=>!ids.has(p.id));next.pages.splice(first,0,...pages);
 next.shots=clone(derived.shots);const existing=new Set((original.gradients||[]).map(g=>g.id));
 next.gradients=[...(original.gradients||[]).map(g=>({...clone(g),...(g.stripSpace&&ids.has(g.stripSpace.pageId)?{stripSpace:{...g.stripSpace,pageId:page.id}}:{})})),...(derived.gradients||[]).filter(g=>!existing.has(g.id)).map(clone)];
 next.episodeReflows={...(next.episodeReflows||{}),[episode]:clone(derived.autoLayoutSource)};
 next.productionScreenBoards=1;next.editorLayoutVersion=2;next.layerSchema=1;next.layerGroupsVersion=1;const restored=splitProductionScreenBoards(next).project;normalizeLayerOrder(restored);return restored;
}

/** Reuse confirmed crops. Target geometry and native-pixel crop provenance remain separate. */
export function buildReflowProject({original,script,geometry,items,batchId,views={}}){
 assertNativeAspect(script,geometry);
 const base=buildLayoutProject(script,geometry),project=clone(original),newId=id('project'),episode=Number(script.episode),mapping=new Map(items.map(i=>[i.key,i]));
 if(items.length!==script.shots.length||mapping.size!==items.length)throw Error('裁图与固定格号未一一对应');
 const archivePanels=project.pages.flatMap(page=>page.panels.map(f=>({...f,visible:false,generationToken:null,autoLayoutOriginalPageId:page.id,coordinateSource:{...f.coordinateSource,generation:'不生成'}})));
 const archiveBubbles=project.pages.flatMap(page=>page.bubbles.map(b=>({...b,visible:false,autoLayoutOriginalPageId:page.id})));
 const page=base.pages[0],pendingText=[],unscaledText=[];page.name='第'+episode+'话 · 已有成图重排';page.bubbles=[];
 project.shots=[...base.shots,...project.shots];project.pages=[page];
 const oldGradients=(project.gradients||[]).map(g=>({...g,visible:false,...(g.stripSpace?{stripSpace:{...g.stripSpace,pageId:page.id}}:{})}));project.gradients=[...oldGradients,...base.gradients];
 for(const [index,f]of page.panels.entries()){
  const item=mapping.get(script.shots[index].key);if(!item?.asset||item.asset.width!==item.width||item.asset.height!==item.height)throw Error('裁图尺寸不一致：'+f.name);
  const s=base.shots[index],existing=item.existingPanelId&&original.pages.flatMap(p=>p.panels).find(p=>p.id===item.existingPanelId),preserve=!!item.preserveCurrentView&&!!existing,cover=item.artworkLayout?.fit==='cover';
  const factor=preserve?f.w/existing.w:1,scale=cover?coverView(f,item).scale:Math.min(f.w/item.width,f.h/item.height);
  s.productionGridId=item.key;s.productionSliceSegment=item.segmentId;
  Object.assign(f,{imageAssetId:item.asset.id,candidates:[],generationToken:null,imageTransform:{x:(f.w-item.width*scale)/2,y:(f.h-item.height*scale)/2,scale,rotation:0,flipX:false,flipY:false},referenceIds:clone(s.referenceIds||[]),coordinateSource:{generation:'不生成'},assetReferenceBinding:{mode:'manual'},panelSlice:{version:1,sourceBindingVersion:1,rootPanelId:item.rootPanelId,segmentId:item.segmentId,panelId:item.key,sourceAssetId:item.sourceAssetId,sourceHash:item.sourceHash,sourceLocation:clone(s.sourceLocation||{}),region:clone(item.region),pixels:clone(item.pixels),batchId:item.recordId,key:item.cropKey},autoLayoutCrop:{version:1,batchId,recordId:item.recordId,sourceWidth:item.sourceWidth,sourceHeight:item.sourceHeight,cropRect:clone(item.pixels),imageSha256:item.sha256,fit:'contain'}});
  const root=original.pages.flatMap(p=>p.panels).find(p=>p.id===item.rootPanelId),source=original.pages.flatMap(p=>p.panels).find(p=>p.id===item.sourcePanelId);
  const originals=original.pages.flatMap(p=>p.bubbles).filter(b=>b.visible!==false&&(b.productionGridId||b.productionOriginal?.['格ID']||original.shots.find(s=>s.id===b.shotId)?.productionGridId)===item.key);
  if(preserve){
   f.imageTransform=clone(existing.imageTransform||{x:0,y:0,scale:existing.w/item.width});
   for(const key of ['x','y','scale'])if(Number.isFinite(f.imageTransform[key]))f.imageTransform[key]*=factor;
   for(const key of ['points','mask','featherEdges','borderColor','locked','assetReferenceBinding','referenceIds'])if(existing[key]!==undefined)f[key]=clone(existing[key]);
   for(const key of ['border','feather'])if(Number.isFinite(existing[key]))f[key]=existing[key]*factor;
   f.autoLayoutCrop.fit='preserve-current-view';
  }else if(cover){f.imageTransform=coverView(f,item,views[item.key]);f.autoLayoutCrop.fit='cover';f.autoLayoutCrop.view=coverSettings(f,item,views[item.key]);}
  if(cover&&(existing?.imageTransform?.rotation||existing?.imageTransform?.flipX||existing?.imageTransform?.flipY))throw Error('旋转或翻转画格须保留当前取景：'+item.key);
  if(existing?.imageFraming)f.imageFraming=clone(existing.imageFraming);
  f.imageFraming={version:1,fit:f.autoLayoutCrop.fit,nativeWidth:item.width,nativeHeight:item.height,nativeSha256:item.sha256,originalFileRetained:true,uniformScale:true};
  const textTransform=cover?coverView(f,item):f.imageTransform;
  const nativeIds=new Set();
  for(const b of originals){
   if(existing&&b.parentPanelId===existing.id){
    const t=existing.imageTransform||{x:0,y:0,scale:existing.w/item.width};
    if(!preserve&&(t.rotation||t.flipX||t.flipY))throw Error('已有裁格带旋转或翻转，文字需先核对：'+item.key);
    const ratio=preserve?factor:cover?f.w/existing.w:textTransform.scale/t.scale,move=(x,y)=>preserve||cover?{x:f.x+(x-existing.x)*ratio,y:f.y+(y-existing.y)*ratio}:{x:f.x+textTransform.x+(x-existing.x-t.x)*ratio,y:f.y+textTransform.y+(y-existing.y-t.y)*ratio};
    const moved=mapBubble(b,move,ratio,f,s,cover,page);
    page.bubbles.push(moved);if(b.productionTextId)nativeIds.add(b.productionTextId);continue;
   }
   const native=frameRegionOnSource(source,root,{width:item.sourceWidth,height:item.sourceHeight},{x:(b.x-root.x)/root.w,y:(b.y-root.y)/root.h,w:b.w/root.w,h:b.h/root.h});
   const left=native.x*item.sourceWidth-item.pixels.x,top=native.y*item.sourceHeight-item.pixels.y,width=native.w*item.sourceWidth,height=native.h*item.sourceHeight;
   if(left<-.5||top<-.5||left+width>item.width+.5||top+height>item.height+.5){pendingText.push({gridId:item.key,textId:b.productionTextId||b.id,text:b.text,speaker:b.speaker||'',reason:'原文字框跨出裁区；已在隐藏原件中保留，未猜测位置'});continue;}
   const ratio=scale/(source.imageTransform?.scale||source.w/item.sourceWidth),origin={x:f.x+textTransform.x+left*scale,y:f.y+textTransform.y+top*scale};
   const moved=mapBubble(b,(x,y)=>({x:origin.x+(x-b.x)*ratio,y:origin.y+(y-b.y)*ratio}),ratio,f,s,cover,page);
   moved.w=width*scale;moved.h=height*scale;
   if(cover)keepTextOnPage(moved,page,f);
   if(moved.tail?.mode!=='normalized'&&Number.isFinite(moved.tail?.x)&&Number.isFinite(moved.tail?.y)){moved.tail.visible=false;unscaledText.push(b.id);}
   page.bubbles.push(moved);if(b.productionTextId)nativeIds.add(b.productionTextId);
  }
  const declared=original.productionPackage.episodes.find(e=>e.episode===episode).texts.filter(t=>t['格ID']===item.key&&t['渲染']==='工具');
  for(const t of declared)if(!nativeIds.has(t['文字ID'])&&!pendingText.some(p=>p.textId===t['文字ID']))pendingText.push({gridId:item.key,textId:t['文字ID'],text:t['文本'],speaker:t['说话人']||'',reason:'来源工程尚无可复用的已定位文字框；原文保留在制作资料中'});
  // This is the same 100% fill as the editor control; lettering geometry stays fixed.
  if(ensureReflowZoom(f,item.asset)&&cover)f.autoLayoutCrop.view=reflowCoverViewFromTransform(f,item.asset);
 }
 page.panels=[...archivePanels,...page.panels];page.bubbles=[...archiveBubbles,...page.bubbles];
 if(project.layoutHistory){project.autoLayoutOriginalHistory=project.layoutHistory;delete project.layoutHistory;}
 if(project.episodeBoards)project.episodeBoards.sharedKey=newId;
 Object.assign(project,{id:newId,title:(original.title+' · 第'+episode+'话成图重排').slice(0,180),revision:0,created:new Date().toISOString(),updated:new Date().toISOString(),productionScreenBoards:1,editorLayoutVersion:2,layerSchema:1,layerGroupsVersion:1,autoLayoutSource:{version:2,mode:'screen-crop-reflow',sourceProjectId:original.id,sourceRevision:original.revision,episode,batchId,scriptId:script.id,profileVersion:geometry.profileVersion,source:clone(script.source),generator:clone(geometry.generator||{}),imageGenerationDisabled:true,fit:items.some(i=>i.artworkLayout?.fit==='cover')?'uniform-framing':'preserve-current-view',layoutRuleContract:clone(script.layoutRuleContract||null),cropCount:items.length,pendingText,tailReview:unscaledText,sourcePages:original.pages.map(p=>({id:p.id,name:p.name,width:p.width,height:p.height,storyboard:clone(p.storyboard||{})}))}});
 delete project.deletedAt;project.layerOrder=[...project.gradients,...page.panels,...page.bubbles].map(l=>l.id);
 return project;
}

function mapBubble(b,move,ratio,f,s,cover,page){
 const moved=clone(b);Object.assign(moved,{id:id('bubble'),parentPanelId:f.id,shotId:s.id,...move(b.x,b.y),w:b.w*ratio,h:b.h*ratio,visible:true,autoLayoutSourceBubbleId:b.id});
 scaleReflowLettering(moved,ratio);
 if(moved.tail?.mode!=='normalized'&&Number.isFinite(moved.tail?.x)&&Number.isFinite(moved.tail?.y))Object.assign(moved.tail,move(moved.tail.x,moved.tail.y));
 if(cover)keepTextOnPage(moved,page,f);
 return moved;
}
function keepTextOnPage(b,page,f){
 // Tool lettering stays editable and visible when the image's outer edges are hidden.
 const dx=Math.max(8,Math.min(page.width-b.w-8,b.x))-b.x,dy=Math.max(Math.max(8,f.y),Math.min(page.height-b.h-8,Math.min(f.y+f.h-b.h,b.y)))-b.y;
 b.x+=dx;b.y+=dy;
 if(b.tail?.mode!=='normalized'&&Number.isFinite(b.tail?.x)&&Number.isFinite(b.tail?.y)){b.tail.x+=dx;b.tail.y+=dy;}
 if(dx||dy)b.autoLayoutTextRepositioned={x:dx,y:dy,reason:'保持等比取景后的工具对白可见；原文字位置保留在来源工程'};
}
