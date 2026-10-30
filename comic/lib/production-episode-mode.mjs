import {productionFrame} from '../public/production-package-model.js';
import {productionPanelPrompts} from '../public/production-panel-prompts.js';
import {productionPanelSource} from '../public/production-panel-generation.js';
import {generationPromptSelection} from '../public/prompt-source.js';
import {check} from './store.mjs';

/** Validate the whole episode before changing settings. Never create frames or lettering. */
export function applyProductionEpisodeMode(project,episodeNumber,mode){
 check(['clean','empty'].includes(mode),'请选择空泡或无泡');
 const episode=project.productionPackage?.episodes.find(e=>e.episode===episodeNumber);
 check(Number.isInteger(episodeNumber)&&episode?.segments.length,'请选择有效的话数');
 check(!['single-mode-20261027','post-lettering-20261027'].includes(project.productionPackage.sourceFormat),'本资料包使用固定出字方式');
 const source=mode==='clean'?'post-lettering':'imported',label=mode==='clean'?'无框无字':'空泡',issues=[],targets=new Set(),preferences=[];
 const pages=project.pages,frames=pages.flatMap(p=>p.panels);
 for(const segment of episode.segments){
  const root=productionFrame(project,segment.id),name=segment.localId||segment.id;
  if(!root){issues.push(name+'：屏段画板不存在');continue;}
  if(segment.pendingSourceFields)issues.push(name+'：请先处理提示词更新');
  const choice=generationPromptSelection({...root,generation:{...root.generation,promptSource:source}},project);
  if(!choice.text?.trim())issues.push(name+'：'+(choice.scopeError||'缺少'+label+'提示词'));
  targets.add(root);
  for(const gridId of segment.panelIds){
   const record=episode.panelRecords.find(r=>r.id===gridId&&r.segmentId===segment.id),prompts=productionPanelPrompts(record);
   if(!record||!(mode==='clean'?prompts.clean:prompts.empty).text?.trim())issues.push(gridId+'：缺少'+label+'提示词');
   preferences.push({segment,gridId});
   for(const frame of frames){const binding=productionPanelSource(frame);if(binding?.segmentId===segment.id&&binding.panelId===gridId&&!frame.productionSupersededBy)targets.add(frame);}
  }
 }
 for(const frame of targets)if(frame.locked||pages.find(p=>p.panels.includes(frame))?.locked)issues.push((frame.name||frame.id)+'：请先解锁画格和画板');
 check(!issues.length,'整话出字方式未更改：\n'+issues.join('\n'),409);
 for(const {segment,gridId} of preferences)segment.panelPromptSources={...segment.panelPromptSources,[gridId]:source};
 for(const frame of targets)frame.generation={...frame.generation,promptSource:source};
 return {episode:episodeNumber,source,segments:episode.segments.length,panels:preferences.length};
}
