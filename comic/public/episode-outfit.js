import {parseNamedStates,stateKey} from './character-states.js';
export function panelOutfitEpisode(project,panel){
 const source=project.shots.find(s=>s.id===panel.shotId)||panel.generation?.sourceSnapshot?.original;
 if(Number.isInteger(source?.episode))return source.episode;
 const segmentId=panel.productionSegment||panel.productionGrid?.segmentId||panel.panelSlice?.segmentId;
 return project.productionPackage?.episodes.find(e=>e.segments.some(s=>s.id===segmentId))?.episode;
}
export function episodeOutfit(project,episode,name,fallback){const rule=project.characterOutfitOverrides?.[episode]?.[name];if(!rule)return fallback;const matched=[rule,...(rule.variants||[])].find(r=>!r.matchStates||r.matchStates.some(s=>stateKey(s)===stateKey(fallback)));return matched?.state||fallback;}
export function productionReferenceOutfit(project,ref){
 const episode=project.productionPackage?.episodes.find(e=>e.segments.some(s=>s.references.includes(ref)))?.episode;
 return episodeOutfit(project,episode,ref['人物'],ref['服装']);
}
export function effectiveCharacterStates(project,panel,states){
 if(!project)return states;
 const rules=project.characterOutfitOverrides?.[panelOutfitEpisode(project,panel)];if(!rules)return states;
 const parsed=parseNamedStates(states);if(!parsed.entries.some(e=>rules[e.name]))return states;
 return parsed.entries.map(e=>e.name+':'+episodeOutfit(project,panelOutfitEpisode(project,panel),e.name,e.state)).join('；');
}
const escape=value=>String(value).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
export function effectiveOutfitPrompt(project,panel,text){
 if(!project)return text;
 const rules=project.characterOutfitOverrides?.[panelOutfitEpisode(project,panel)];if(!rules)return text;
 let value=text;for(const [name,group]of Object.entries(rules))for(const rule of [group,...(group.variants||[])])for(const previous of rule.previousStates||[]){
  if(rule.matchStates&&!rule.matchStates.some(s=>stateKey(s)===stateKey(previous)))continue;
  if(previous===rule.state)continue;
  value=value.replace(new RegExp('('+escape(name)+'(?:设定卡)?[（(：:]\\s*)'+escape(previous)+'(?=[）)；;，,\\s]|$)','gu'),'$1'+rule.state);
 }
 return value;
}
const validRule=r=>r&&typeof r.state==='string'&&r.state.length>0&&r.state.length<=120&&Array.isArray(r.previousStates)&&r.previousStates.length<=20&&r.previousStates.every(s=>typeof s==='string'&&s.length<=120)&&(r.matchStates===undefined||Array.isArray(r.matchStates)&&r.matchStates.length>0&&r.matchStates.length<=20&&r.matchStates.every(s=>typeof s==='string'&&s.length>0&&s.length<=120));
export function validOutfitOverrides(value){return value===undefined||value&&typeof value==='object'&&!Array.isArray(value)&&Object.entries(value).length<=1000&&Object.entries(value).every(([episode,rules])=>/^\d{1,4}$/.test(episode)&&rules&&typeof rules==='object'&&!Array.isArray(rules)&&Object.entries(rules).length<=100&&Object.entries(rules).every(([name,r])=>name.length>0&&name.length<=100&&validRule(r)&&(r.variants===undefined||Array.isArray(r.variants)&&r.variants.length<=20&&r.variants.every(v=>validRule(v)&&v.variants===undefined))));}
