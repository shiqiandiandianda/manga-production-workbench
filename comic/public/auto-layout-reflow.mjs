import {assertNativeAspect} from './unified-layout-rules.js';
import {buildLayoutProject} from './auto-layout-adapter.mjs';
import {id,clone} from './model.js';
import {frameRegionOnSource} from './panel-slices.js';

/** Reuse confirmed crops. Target geometry and native-pixel crop provenance remain separate. */
export function buildReflowProject({original,script,geometry,items,batchId}){
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
  const s=base.shots[index],scale=Math.min(f.w/item.width,f.h/item.height);
  s.productionGridId=item.key;s.productionSliceSegment=item.segmentId;
  Object.assign(f,{imageAssetId:item.asset.id,candidates:[],generationToken:null,imageTransform:{x:(f.w-item.width*scale)/2,y:(f.h-item.height*scale)/2,scale,rotation:0,flipX:false,flipY:false},referenceIds:clone(s.referenceIds||[]),coordinateSource:{generation:'不生成'},assetReferenceBinding:{mode:'manual'},panelSlice:{version:1,sourceBindingVersion:1,rootPanelId:item.rootPanelId,segmentId:item.segmentId,panelId:item.key,sourceAssetId:item.sourceAssetId,sourceHash:item.sourceHash,sourceLocation:clone(s.sourceLocation||{}),region:clone(item.region),pixels:clone(item.pixels),batchId:item.recordId,key:item.cropKey},autoLayoutCrop:{version:1,batchId,recordId:item.recordId,sourceWidth:item.sourceWidth,sourceHeight:item.sourceHeight,cropRect:clone(item.pixels),imageSha256:item.sha256,fit:'contain'}});
  const root=original.pages.flatMap(p=>p.panels).find(p=>p.id===item.rootPanelId),source=original.pages.flatMap(p=>p.panels).find(p=>p.id===item.sourcePanelId);
  const originals=original.pages.flatMap(p=>p.bubbles).filter(b=>b.visible!==false&&(b.productionGridId||b.productionOriginal?.['格ID']||original.shots.find(s=>s.id===b.shotId)?.productionGridId)===item.key);
  const nativeIds=new Set();
  for(const b of originals){
   const native=frameRegionOnSource(source,root,{width:item.sourceWidth,height:item.sourceHeight},{x:(b.x-root.x)/root.w,y:(b.y-root.y)/root.h,w:b.w/root.w,h:b.h/root.h});
   const left=native.x*item.sourceWidth-item.pixels.x,top=native.y*item.sourceHeight-item.pixels.y,width=native.w*item.sourceWidth,height=native.h*item.sourceHeight;
   if(left<-.5||top<-.5||left+width>item.width+.5||top+height>item.height+.5){pendingText.push({gridId:item.key,textId:b.productionTextId||b.id,text:b.text,speaker:b.speaker||'',reason:'原文字框跨出裁区；已在隐藏原件中保留，未猜测位置'});continue;}
   const moved=clone(b);Object.assign(moved,{id:id('bubble'),parentPanelId:f.id,shotId:s.id,x:f.x+f.imageTransform.x+left*scale,y:f.y+f.imageTransform.y+top*scale,w:Math.max(30,width*scale),h:Math.max(20,height*scale),visible:true,autoLayoutSourceBubbleId:b.id});
   const ratio=scale/(source.imageTransform?.scale||source.w/item.sourceWidth);
   for(const key of ['fontSize','padding','letterSpacing','outlineWidth'])if(Number.isFinite(moved[key]))moved[key]*=ratio;
   moved.fontSize=Math.max(10,Math.min(2048,moved.fontSize));if(moved.padding!==undefined)moved.padding=Math.min(4096,moved.padding);if(moved.outlineWidth!==undefined)moved.outlineWidth=Math.min(256,moved.outlineWidth);if(moved.letterSpacing!==undefined)moved.letterSpacing=Math.max(-128,Math.min(256,moved.letterSpacing));
   if(moved.textBox)for(const key of ['x','y','w','h'])moved.textBox[key]*=ratio;
   if(moved.tail?.mode!=='normalized'&&Number.isFinite(moved.tail?.x)&&Number.isFinite(moved.tail?.y)){moved.tail.visible=false;unscaledText.push(b.id);}
   page.bubbles.push(moved);if(b.productionTextId)nativeIds.add(b.productionTextId);
  }
  const declared=original.productionPackage.episodes.find(e=>e.episode===episode).texts.filter(t=>t['格ID']===item.key&&t['渲染']==='工具');
  for(const t of declared)if(!nativeIds.has(t['文字ID'])&&!pendingText.some(p=>p.textId===t['文字ID']))pendingText.push({gridId:item.key,textId:t['文字ID'],text:t['文本'],speaker:t['说话人']||'',reason:'来源工程尚无可复用的已定位文字框；原文保留在制作资料中'});
 }
 page.panels=[...archivePanels,...page.panels];page.bubbles=[...archiveBubbles,...page.bubbles];
 if(project.layoutHistory){project.autoLayoutOriginalHistory=project.layoutHistory;delete project.layoutHistory;}
 if(project.episodeBoards)project.episodeBoards.sharedKey=newId;
 Object.assign(project,{id:newId,title:(original.title+' · 第'+episode+'话成图重排').slice(0,180),revision:0,created:new Date().toISOString(),updated:new Date().toISOString(),productionScreenBoards:1,editorLayoutVersion:2,layerSchema:1,layerGroupsVersion:1,autoLayoutSource:{version:2,mode:'screen-crop-reflow',sourceProjectId:original.id,sourceRevision:original.revision,episode,batchId,scriptId:script.id,profileVersion:geometry.profileVersion,source:clone(script.source),generator:clone(geometry.generator||{}),imageGenerationDisabled:true,fit:'contain',layoutRuleContract:clone(script.layoutRuleContract||null),cropCount:items.length,pendingText,tailReview:unscaledText,sourcePages:original.pages.map(p=>({id:p.id,name:p.name,width:p.width,height:p.height,storyboard:clone(p.storyboard||{})}))}});
 delete project.deletedAt;project.layerOrder=[...project.gradients,...page.panels,...page.bubbles].map(l=>l.id);
 return project;
}
