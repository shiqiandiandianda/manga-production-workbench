import {check,validateProject} from './store.mjs';
import {stateReferenceMetadata,stateReferenceMatches} from '../public/character-state-references.js';
import {panelOutfitEpisode,effectiveCharacterStates,validOutfitOverrides} from '../public/episode-outfit.js';
import {parseNamedStates,stateKey} from '../public/character-states.js';
import {ensureProjectPanelGeneration} from '../public/panel-generation.js';
export function prepareEpisodeOutfit(project,input,assets){
 check(project.revision===input.expectedRevision,'工程已改变，请保存后重新核对服装',409);
 const episode=project.productionPackage?.episodes.find(e=>e.episode===input.episode);check(episode,'请选择当前作品中的明确话数');
 const {name,state}=input;check(typeof name==='string'&&name.trim()&&name.length<=100&&typeof state==='string'&&state.trim()&&state.length<=120,'人物或服装无效');
 const refs=episode.segments.flatMap(s=>s.references).filter(r=>r['类型']==='设定卡'&&r['人物']===name),records=episode.panelRecords.filter(r=>r.original?.['服装']?.[name]);check(refs.length||records.length,'本话没有该人物的服装需求');
 const asset=assets.find(a=>a.id===input.referenceAssetId);check(asset?.library?.revisionId,'请选择已采用的墨库设定卡');const meta=stateReferenceMetadata(project,asset);check(stateKey(meta.name)===stateKey(name)&&stateReferenceMatches(state,meta),'设定卡人物或服装与确认要求不符',409);
 const next=structuredClone(project),prior=next.characterOutfitOverrides?.[input.episode]?.[name],previousStates=[...new Set([...(prior?.previousStates||[]),prior?.state,...refs.map(r=>r['服装']),...records.map(r=>r.original['服装'][name])].filter(Boolean))];
 next.characterOutfitOverrides={...next.characterOutfitOverrides,[input.episode]:{...next.characterOutfitOverrides?.[input.episode],[name]:{state,previousStates,referenceAssetId:asset.id,referenceRevisionId:asset.library.revisionId,source:'user-confirmed',updatedAt:new Date().toISOString()}}};check(validOutfitOverrides(next.characterOutfitOverrides),'服装覆盖记录无效');
 for(const page of next.pages)for(const panel of page.panels){if(panelOutfitEpisode(next,panel)!==input.episode)continue;const original=next.shots.find(s=>s.id===panel.shotId)||panel.generation?.sourceSnapshot?.original,states=panel.generation?.characterStates||original?.characterStates||original?.sourceFields?.['角色状态（服装/形态）']||'';if(!parseNamedStates(states).entries.some(e=>e.name===name))continue;check(!page.locked&&!panel.locked,'本话人物所在画格已锁定，请解锁后统一服装',409);panel.generation||={version:1,referenceRoles:[]};panel.generation.characterStates=effectiveCharacterStates(next,panel,states);delete panel.referenceRequirements;}
 ensureProjectPanelGeneration(next,assets);validateProject(next);return next;
}
