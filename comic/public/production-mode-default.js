import {generationPromptChoices} from './prompt-source.js';
import {productionPanelPrompts} from './production-panel-prompts.js';

export const PRODUCTION_MODE_DEFAULT_KEY='comic-production-default-prompt-source';
export const PRODUCTION_MODE_LABELS={'post-lettering':'无框无字：工具加气泡和台词',imported:'自带空泡：工具填字'};
export function readProductionModeDefault(){try{const value=localStorage.getItem(PRODUCTION_MODE_DEFAULT_KEY);return Object.hasOwn(PRODUCTION_MODE_LABELS,value)?value:'';}catch{return '';}}
export function saveProductionModeDefault(value){
 if(value&&!Object.hasOwn(PRODUCTION_MODE_LABELS,value))throw Error('默认出字方式无效');
 if(value)localStorage.setItem(PRODUCTION_MODE_DEFAULT_KEY,value);else localStorage.removeItem(PRODUCTION_MODE_DEFAULT_KEY);
}
/** Only new source units inherit the preference; existing decisions stay intact. */
export function applyProductionModeDefault(project,source,previous){
 if(!source)return project;
 if(!Object.hasOwn(PRODUCTION_MODE_LABELS,source))throw Object.assign(Error('默认出字方式无效'),{status:400});
 if(['single-mode-20261027','post-lettering-20261027'].includes(project.productionPackage?.sourceFormat))return project;
 const oldSegments=new Set(previous?.productionPackage?.episodes.flatMap(e=>e.segments.map(s=>s.id))||[]);
 const oldRecords=new Set(previous?.productionPackage?.episodes.flatMap(e=>e.panelRecords.map(r=>r.id))||[]);
 for(const episode of project.productionPackage?.episodes||[])for(const segment of episode.segments){
  const frame=project.pages.flatMap(p=>p.panels).find(f=>f.id===segment.panelId);
  if(!oldSegments.has(segment.id)&&frame&&generationPromptChoices(frame,project).find(c=>c.value===source)?.text.trim()){
   frame.generation={...frame.generation,promptSource:source};
  }
  for(const record of episode.panelRecords.filter(r=>r.segmentId===segment.id&&!oldRecords.has(r.id))){
   const prompts=productionPanelPrompts(record);
   if((source==='post-lettering'?prompts.clean:prompts.empty).text.trim())segment.panelPromptSources={...segment.panelPromptSources,[record.id]:source};
  }
 }
 return project;
}
