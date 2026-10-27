import {productionSegmentUnit} from './production-episode-layout.js';
import {productionScreenLetteringPending,ensureProductionScreenLettering} from './production-screen-lettering.js';
import {productionPanelLetteringPending,ensureProductionSegmentLettering} from './production-panel-generation.js';
function pendingSegments(project,episode){
 return (project?.productionPackage?.episodes.find(e=>e.episode===episode)?.segments||[]).filter(s=>(productionSegmentUnit(project,episode,s.id)==='panel'?productionPanelLetteringPending:productionScreenLetteringPending)(project,s.id));
}
export function episodeLetteringPending(project,episode){return pendingSegments(project,episode).length>0;}
// Initialize only the active unit in every segment; no mode switch or new frames.
// Versioned helpers preserve manual changes/deletions and locked content.
export function ensureEpisodeLettering(project,episode){
 const result={created:0,skipped:0,segments:0};
 for(const s of pendingSegments(project,episode)){
  const added=(productionSegmentUnit(project,episode,s.id)==='panel'?ensureProductionSegmentLettering:ensureProductionScreenLettering)(project,s.id);
  result.created+=added.created;result.skipped+=added.skipped;result.segments++;
 }
 return result;
}
