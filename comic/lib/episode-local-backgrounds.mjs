import {layoutLongStrip} from '../public/model.js';
import {artworkBackgroundGeometry} from '../public/artwork-backgrounds.mjs';
import {buildStoryBackgroundLayers} from '../public/story-background-layers.mjs';
import {addSceneReferencePalettes,reflowTextObstacles} from './reflow-background-context.mjs';
import {sampleArtworkPalette} from './artwork-palette.mjs';

/** Apply local color decisions after final editable lettering exists, without changing the frozen source contract. */
export async function applyEpisodeLocalBackgrounds(project,number,source,{store}={}){
 const ep=project.productionPackage.episodes.find(e=>e.episode===number),pages=project.pages.filter(p=>p.storyboard?.episode===number&&!p.designEpisodeRole),layout=layoutLongStrip(pages),shots=source.shots||ep.panelRecords.map(r=>{const old=project.shots.find(s=>s.productionGridId===r.id&&s.productionSliceSegment===r.segmentId),raw=r.original||r.production||{};return {...old,key:r.id,description:old?.description||raw['画面内容']||'',location:old?.location||raw['当前场景']||'',time:old?.time||raw['当前时间']||'',sourceFields:raw};});
 const items=[];
 for(const r of ep.panelRecords){const root=project.pages.flatMap(p=>p.panels).find(f=>f.productionSegment===r.segmentId),frame=project.pages.flatMap(p=>p.panels).find(f=>f.productionGrid?.panelId===r.id||f.panelSlice?.panelId===r.id),item={key:r.id,rootPanelId:root?.id,existingPanelId:frame?.id,...((frame?.imageAssetId||root?.imageAssetId)?{asset:frame?.imageAssetId||root?.imageAssetId}:{})};
  if(store)await addSceneReferencePalettes(project,item,shots.find(s=>s.key===r.id),store,sampleArtworkPalette);items.push(item);
 }
 const bubbles=layout.pages.flatMap(e=>e.page.bubbles.map(b=>{const moved=structuredClone(b);moved.y+=e.y;if(moved.tail?.mode!=='normalized'&&Number.isFinite(moved.tail?.y))moved.tail.y+=e.y;return moved;})),geometry=artworkBackgroundGeometry(source.geometry,items,shots,{obstacles:reflowTextObstacles({pages:[{bubbles}]})});
 const old=new Set((project.gradients||[]).filter(g=>g.assistantLayoutAnchor?.episode===number).map(g=>g.id));project.gradients=project.gradients.filter(g=>!old.has(g.id));
 const backgrounds=buildStoryBackgroundLayers(geometry,{episode:number,anchorPageId:pages[0].id});
 project.gradients.push(...backgrounds);project.layerOrder=[...backgrounds.map(g=>g.id),...(project.layerOrder||[]).filter(k=>!old.has(k))];
 const binding=project.layoutRuleBindings[number];binding.sourceGeometry=structuredClone(source.geometry);binding.geometry=geometry;binding.localBackgroundPolicy=geometry.localBackgroundPolicy;binding.backgroundDecisions=geometry.artworkPaletteDecisions;return geometry;
}
