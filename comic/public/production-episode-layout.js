import {rectangle,id} from './model.js';
import {ensureProductionScreenLettering} from './production-screen-lettering.js';
import {generationPlans} from './unified-layout-rules.js';
import {validateAssistantGeometry} from './assistant-layout-geometry.js';
import {validateLayoutDesign} from './layout-design.js';
import {prepareProductionPanel,productionPanelSource,ensureProductionSegmentLettering} from './production-panel-generation.js';
import {productionFrame} from './production-package-model.js';

const fail=message=>{throw Object.assign(Error(message),{status:409});};
export const productionEpisodeUnit=(project,episode)=>project?.productionEpisodeViews?.[episode]?.unit||project?.productionPackage?.generationUnit||'screen';
const episodePages=(project,episode)=>project.pages.filter(p=>p.storyboard?.episode===episode&&!p.designEpisodeRole);

/**
 * 生成单位是每个屏段自己的状态：新选中的屏段默认整屏，用户为该屏段选择
 * 单格后才转换。旧工程没有逐段记录时，已有单格画格的屏段保持单格，其余整屏。
 */
export function productionSegmentUnit(project,episode,segmentId){
 const view=project?.productionEpisodeViews?.[episode],explicit=view?.segments?.[segmentId];
 if(explicit==='panel'||explicit==='screen')return explicit;
 const page=project?.pages.find(p=>p.storyboard?.segmentId===segmentId&&!p.designEpisodeRole);
 if(page?.productionUnit==='panel'||page?.productionUnit==='screen')return page.productionUnit;
 const hasPanel=project?.pages.some(p=>p.storyboard?.segmentId===segmentId&&!p.designEpisodeRole&&p.panels.some(f=>productionPanelSource(f)));
 return hasPanel?'panel':'screen';
}
function pagePriorUnit(project,page){
 if(page?.productionUnit==='panel'||page?.productionUnit==='screen')return page.productionUnit;
 const episode=page?.storyboard?.episode,segment=page?.storyboard?.segmentId;
 return episode!==undefined&&segment?productionSegmentUnit(project,episode,segment):'screen';
}
function switchPageUnit(project,page,unit,previousOverride=null){
 const previous=previousOverride||pagePriorUnit(project,page);
 const views=page.productionLayoutViews||=( {version:1,[previous]:{height:page.height,background:page.background}} );
 if(views){
  views[previous]||={height:page.height,background:page.background};
  views[unit]||={height:page.height,background:page.background};
  views[previous].height=page.height;views[previous].background=page.background;
  page.height=views[unit].height;page.background=views[unit].background||page.background;
 }
 // Older crops hid their source without recording a mode flag. A deliberate
 // switch back to screen restores that source; never replace its image.
 if(unit==='screen'&&previous==='panel')for(const root of page.panels){
  if(root.productionSegment&&root.imageAssetId&&root.visible===false&&page.panels.some(f=>f.panelSlice?.rootPanelId===root.id)){if(root.productionModeHidden===true)root.productionModeVisible=true;else root.visible=true;}
 }
 const frames=new Map(page.panels.map(f=>[f.id,f]));
 const family=(item,seen=new Set())=>{
  if(!item||seen.has(item.id))return null;seen.add(item.id);
  if(productionPanelSource(item))return 'panel';
  const parent=item.cutoutLayer?.parentPanelId||item.parentPanelId||item.breakoutForeground?.backgroundPanelId;
  if(parent)return family(frames.get(parent),seen);
  if(item.productionGridId)return 'panel';
  if(item.productionSegment||item.productionBackground||item.productionBackgroundInstance)return unit==='panel'&&!page.panels.some(f=>productionPanelSource(f))?null:'screen';
  return null;
 };
 for(const item of [...page.panels,...page.bubbles]){
  if(item.productionSupersededBy)continue;const mode=family(item);if(!mode)continue;
  if(mode!==unit){if(item.productionModeHidden!==true){item.productionModeVisible=item.visible!==false;item.productionModeHidden=true;}item.visible=false;}
  else if(item.productionModeHidden===true){item.visible=item.productionModeVisible!==false;delete item.productionModeHidden;delete item.productionModeVisible;}
 }
 page.productionUnit=unit;
}
function switchGradients(project,episode,unit){
 for(const g of project.gradients||[])if(g.assistantLayoutAnchor?.episode===episode){if(unit==='screen'){if(!g.productionModeHidden){g.productionModeVisible=g.visible;g.productionModeHidden=true;}g.visible=false;}else if(g.productionModeHidden){g.visible=g.productionModeVisible!==false;delete g.productionModeHidden;delete g.productionModeVisible;}}
}
/** Switch one screen segment only. This is what the "生成单位" select uses. */
export function switchProductionSegmentUnit(project,segmentId,unit,{ensureLettering=true,previousUnit=null}={}){
 if(!['screen','panel'].includes(unit))fail('请选择屏段或单格');
 const pages=project.pages.filter(p=>p.storyboard?.segmentId===segmentId&&!p.designEpisodeRole);
 if(!pages.length)fail('屏段不存在或尚未生成画板');
 for(const page of pages)switchPageUnit(project,page,unit,previousUnit);
 if(ensureLettering){if(unit==='panel')ensureProductionSegmentLettering(project,segmentId);else ensureProductionScreenLettering(project,segmentId);}
 const episode=pages[0].storyboard?.episode;
 if(Number.isInteger(episode)){
  const view=project.productionEpisodeViews?.[episode]||{};
  project.productionEpisodeViews||={};
  project.productionEpisodeViews[episode]={...view,unit,segments:{...(view.segments||{}),[segmentId]:unit}};
 }
 return project;
}
/** Bulk switch kept for layout import/reflow, where every segment becomes single panels. */
export function switchProductionEpisodeUnit(project,episode,unit,{previousUnits=null}={}){
 if(!['screen','panel'].includes(unit))fail('请选择屏段或单格');
 const pages=episodePages(project,episode);
 for(const page of pages)switchPageUnit(project,page,unit,previousUnits?.get(page.storyboard?.segmentId));
 switchGradients(project,episode,unit);
 const episodeData=project.productionPackage?.episodes.find(e=>e.episode===episode);
 const view={...(project.productionEpisodeViews?.[episode]||{}),unit,segments:{}};
 for(const segment of episodeData?.segments||[])view.segments[segment.id]=unit;
 for(const segment of episodeData?.segments||[])(unit==='panel'?ensureProductionSegmentLettering:ensureProductionScreenLettering)(project,segment.id);
 project.productionEpisodeViews||={};project.productionEpisodeViews[episode]=view;
 return project;
}

function placeGroup(page,frame,rect,{uniformChildren=false}={}){
 const before={x:frame.x,y:frame.y,w:frame.w,h:frame.h},sx=rect.w/before.w,sy=rect.h/before.h,scale=Math.min(sx,sy),owned=new Set([frame.id]);
 let added;do{added=false;for(const f of page.panels)if(!owned.has(f.id)&&owned.has(f.cutoutLayer?.parentPanelId||f.breakoutForeground?.backgroundPanelId)){owned.add(f.id);added=true;}}while(added);
 const members=[...page.panels.filter(f=>owned.has(f.id)),...page.bubbles.filter(b=>owned.has(b.parentPanelId))];
 if(members.some(f=>f.locked))fail('请先解锁本格及关联图层：'+(frame.name||frame.id));
 for(const item of members){
  const oldW=item.w,oldH=item.h;
  const rx=uniformChildren&&item!==frame?scale:sx,ry=uniformChildren&&item!==frame?scale:sy,padX=uniformChildren&&item!==frame?(rect.w-before.w*scale)/2:0,padY=uniformChildren&&item!==frame?(rect.h-before.h*scale)/2:0;
  item.x=rect.x+padX+(item.x-before.x)*rx;item.y=rect.y+padY+(item.y-before.y)*ry;item.w*=rx;item.h*=ry;
  if(item.imageTransform){const t=item.imageTransform;t.x=t.x*scale+(item.w-oldW*scale)/2;t.y=t.y*scale+(item.h-oldH*scale)/2;t.scale*=scale;}
  if(item!==frame){for(const key of ['fontSize','padding','outlineWidth','letterSpacing'])if(Number.isFinite(item[key]))item[key]*=scale;}
  if(item.textBox)for(const k of ['x','y','w','h'])if(Number.isFinite(item.textBox[k]))item.textBox[k]*=['x','w'].includes(k)?rx:ry;
  if(item.tail?.mode!=='normalized'&&Number.isFinite(item.tail?.x)&&Number.isFinite(item.tail?.y)){item.tail.x=rect.x+padX+(item.tail.x-before.x)*rx;item.tail.y=rect.y+padY+(item.tail.y-before.y)*ry;}
 }
 Object.assign(frame,rect);return owned;
}

/** Apply the supplied FINAL document coordinates, never planned image crop coordinates. */
export function layoutProductionEpisode(project,episodeNumber){
 const episode=project.productionPackage?.episodes.find(e=>e.episode===episodeNumber);
 if(!episode?.layoutDesign?.data)fail('本话缺少已定稿的排版设计，请先导入设计文件');
 const design=validateLayoutDesign(episode.layoutDesign.data),pages=episodePages(project,episodeNumber),records=episode.panelRecords;
 if(design.episode!==episodeNumber||JSON.stringify(records.map(r=>r.id))!==JSON.stringify(design.finalLayout.panels.map(r=>r.panelId)))fail('设计版式与本话源格不一致，请核对后重新导入');
 const plans=design.generationSegments.map((s,i)=>{
  const root=productionFrame(project,s.segmentId),page=pages.find(p=>p.panels.includes(root));
  if(!page||page.storyboard?.segmentId!==s.segmentId||page.width!==design.finalLayout.canvas.width)fail('请先将制作资料升级为一屏一画板');
  if(page.locked)fail('请先解锁本话画板：'+page.name);
  const start=i===0?0:design.finalLayout.panels.find(p=>p.panelId===s.panels[0].panelId).rect.y;
  return {s,page,start};
 });
 if(plans.length!==pages.length||plans.some((p,i)=>pages[i]!==p.page))fail('本话画板顺序与设计屏段不一致，请先核对画板');
 // Capture every segment's mode before preparing panels: preparing a panel can
 // itself make an older screen appear to be in panel mode.
 const previousUnits=new Map(plans.map(({s,page})=>[s.segmentId,pagePriorUnit(project,page)])),groups=[];
 for(let i=0;i<plans.length;i++){
  const {s,page,start}=plans[i],prior=previousUnits.get(s.segmentId),end=plans[i+1]?.start??design.finalLayout.canvas.height,height=end-start;
  if(height<20)fail('设计屏段高度无效：'+s.segmentId);
  page.productionLayoutViews||={version:1,screen:{height:page.height},panel:{height:page.height}};
  page.productionLayoutViews[prior].height=page.height;page.productionLayoutViews.panel.height=height;
  // Switch helper records the outgoing height, so keep it current until then.
  if(prior==='panel')page.height=height;
  page.productionLayoutViews.designVersion=design.layoutVersion;
  for(const p of s.panels){
   const final=design.finalLayout.panels.find(f=>f.panelId===p.panelId),frame=prepareProductionPanel(project,s.segmentId,p.panelId).panel;
   const owned=placeGroup(page,frame,{...final.rect,y:final.rect.y-start});
   frame.productionGrid.placementSource='final-layout-design';frame.productionGrid.layoutVersion=design.layoutVersion;
   groups.push({frame,keys:new Set([...owned,...page.bubbles.filter(b=>owned.has(b.parentPanelId)).map(b=>b.id)]),layer:final.layerOrder});
  }
 }
 const selected=new Set(groups.flatMap(g=>[...g.keys])),order=project.layerOrder||[],at=order.findIndex(k=>selected.has(k)),remaining=order.filter(k=>!selected.has(k));
 const sorted=groups.sort((a,b)=>a.layer-b.layer).flatMap(g=>[g.frame.id,...order.filter(k=>g.keys.has(k)&&k!==g.frame.id)]);
 remaining.splice(at<0?remaining.length:Math.min(at,remaining.length),0,...sorted);project.layerOrder=remaining;
 switchProductionEpisodeUnit(project,episodeNumber,'panel',{previousUnits});
 return {panels:groups.length,boards:plans.length,layoutVersion:design.layoutVersion};
}

/** Adapt the exact assistant preview into existing screen boards and editable panel families. */
export function layoutAssistantEpisode(project,episodeNumber,source,{assets=[]}={}){
 const episode=project.productionPackage?.episodes.find(e=>e.episode===episodeNumber),g=validateAssistantGeometry(source.geometry,episode),pages=episodePages(project,episodeNumber),byKey=new Map(g.panels.map(p=>[p.key,p])),newBinding=!project.layoutRuleBindings?.[episodeNumber],refreshPlan=newBinding||source.updatedPreview===true,generation=refreshPlan?generationPlans(episode,g):project.layoutRuleBindings[episodeNumber].generationSegments||generationPlans(episode,g);
 const plans=episode.segments.map((s,i)=>{const root=productionFrame(project,s.id),page=pages.find(p=>p.panels.includes(root)),first=byKey.get(s.panelIds[0]);if(!page||page.width!==1280||page.storyboard?.segmentId!==s.id||!first)fail('请先核对本话一屏一画板与源格关联');if(page.locked)fail('请先解锁本话画板：'+page.name);return {s,page,start:i===0?0:Math.floor(first.y)};});
 if(plans.length!==pages.length||plans.some((p,i)=>pages[i]!==p.page))fail('本话画板顺序与屏段不一致，请先核对');
 const previousUnits=new Map(plans.map(({s,page})=>[s.id,pagePriorUnit(project,page)])),groups=[],oldBackgrounds=new Set((project.gradients||[]).filter(b=>b.assistantLayoutAnchor?.episode===episodeNumber).map(b=>b.id));
 if((project.gradients||[]).some(b=>oldBackgrounds.has(b.id)&&b.locked))fail('请先解锁本话助手底色图层');
 for(let i=0;i<plans.length;i++){
  const {s,page,start}=plans[i],prior=previousUnits.get(s.id),height=(plans[i+1]?.start??g.canvas.height)-start;if(height<1)fail('助手预览跨屏阅读顺序无效，请先核对');
  page.productionLayoutViews||={version:1,screen:{height:page.height,background:page.background},panel:{height:page.height,background:page.background}};
  page.productionLayoutViews[prior].height=page.height;page.productionLayoutViews[prior].background=page.background;page.productionLayoutViews.panel={height,background:'#ffffff'};
  if(refreshPlan){const plan=generation.find(p=>p.segmentId===s.id),root=productionFrame(project,s.id);if(newBinding&&root.imageAssetId)fail('已有整屏图片请先在排版助手确认实际裁格');if(!root.imageAssetId){const h=root.w*plan.imagePlan.height/1280,delta=h-root.h;page.productionLayoutViews.screen.height=Math.ceil(Math.max(h+root.y,page.productionLayoutViews.screen.height+delta));root.h=h;}s.plannedRegions=Object.fromEntries(plan.panels.map(p=>[p.panelId,structuredClone(p.rect)]));s.imagePlan=structuredClone(plan.imagePlan);s.unifiedLayoutRuleDigest=source.contract.digest;s.layoutDesignVersion='unified-'+source.contract.digest.slice(0,16);}
  if(prior==='panel'){page.height=height;page.background='#ffffff';}
  else if(refreshPlan)page.height=page.productionLayoutViews.screen.height;
  page.productionLayoutViews.designVersion='assistant-'+(source.contract?.digest||'preview').slice(0,16);
  for(const key of s.panelIds){
   const target=byKey.get(key);if(!target)fail('助手预览缺少源格：'+key);
   const frame=prepareProductionPanel(project,s.id,key).panel;if(!page.panels.includes(frame))fail('已有单格不在来源屏段画板中：'+key);
   const owned=placeGroup(page,frame,{x:target.x,y:target.y-start,w:target.w,h:target.h},{uniformChildren:true});
   // Keep the asset and rotation/flip, and fit the full native image uniformly.
   if(frame.imageAssetId){const asset=assets.find(a=>a.id===frame.imageAssetId);if(!asset?.width||!asset?.height)fail('本格图片尺寸尚未就绪：'+key);const t=frame.imageTransform||{},angle=(t.rotation||0)*Math.PI/180,c=Math.abs(Math.cos(angle)),sine=Math.abs(Math.sin(angle)),scale=Math.min(frame.w/(asset.width*c+asset.height*sine),frame.h/(asset.width*sine+asset.height*c));frame.imageTransform={...t,x:(frame.w-asset.width*scale)/2,y:(frame.h-asset.height*scale)/2,scale};}
   frame.points=rectangle();if(target.border!==undefined)frame.border=target.border;if(target.feather!==undefined)frame.feather=target.feather;
   frame.productionGrid.placementSource='assistant-preview';frame.productionGrid.layoutVersion=page.productionLayoutViews.designVersion;
   groups.push({frame,keys:new Set([...owned,...page.bubbles.filter(b=>owned.has(b.parentPanelId)).map(b=>b.id)]),layer:g.panels.indexOf(target)});
  }
 }
 project.gradients=(project.gradients||[]).filter(b=>!oldBackgrounds.has(b.id));const backgrounds=[];
 for(const b of g.backgrounds||[]){const layer={id:id('gradient'),name:b.name||'排版助手底色',coverage:'area',x:b.x,y:b.y,w:b.w,h:b.h,points:rectangle(),border:0,borderColor:'#111111',feather:0,visible:true,locked:false,designEpisode:episodeNumber,assistantLayoutAnchor:{episode:episodeNumber,pageId:pages[0].id,y:b.y},gradient:{enabled:true,mode:'color',startColor:b.color,endColor:b.mode==='linear'?b.endColor||b.color:b.color,opacity:1,start:{x:0,y:0},end:{x:0,y:1}}};project.gradients.push(layer);backgrounds.push(layer.id);}
 const selected=new Set(groups.flatMap(g=>[...g.keys])),order=project.layerOrder||[],at=order.findIndex(k=>selected.has(k)),remaining=order.filter(k=>!selected.has(k)&&!oldBackgrounds.has(k));
 const sorted=groups.sort((a,b)=>a.layer-b.layer).flatMap(g=>[g.frame.id,...order.filter(k=>g.keys.has(k)&&k!==g.frame.id)]);remaining.splice(at<0?remaining.length:Math.min(at,remaining.length),0,...sorted);project.layerOrder=[...backgrounds,...remaining];
 project.layoutRuleBindings||={};project.layoutRuleBindings[episodeNumber]={...project.layoutRuleBindings[episodeNumber],contract:structuredClone(source.contract),scriptId:source.scriptId,geometry:structuredClone(g),targetPanels:structuredClone(g.panels),generationSegments:generation,appliedToCurrentProject:true};
 switchProductionEpisodeUnit(project,episodeNumber,'panel',{previousUnits});
 return {panels:groups.length,boards:plans.length,layoutVersion:'排版助手预览'};
}
