import {check,validateProject} from './store.mjs';
import {assetWorkspaceInventory} from '../public/asset-workspace-model.js';
import {panelOutfitEpisode,effectiveCharacterStates,validOutfitOverrides} from '../public/episode-outfit.js';
import {stateKey,parseNamedStates} from '../public/character-states.js';
import {stateReferenceMetadata,stateReferenceMatches} from '../public/character-state-references.js';
import {ensureProjectPanelGeneration} from '../public/panel-generation.js';
const active=new Set(['queued','preparing','running','recoverable','delegated','awaiting_confirmation']);
/** An episode override is deliberately skipped when that episode has plot-specific variants. */
export function correctionPreview(store,project,input){
 check(typeof input.name==='string'&&input.name.trim()&&input.name.length<=100&&!['__proto__','constructor','prototype'].includes(input.name),'人物名称无效');
 check(typeof input.fromState==='string'&&input.fromState.trim()&&input.fromState.length<=120&&typeof input.state==='string'&&input.state.trim()&&input.state.length<=120&&stateKey(input.fromState)!==stateKey(input.state),'请填写不同的新旧服装');
 check(['episode','work'].includes(input.scope),'请选择本话或全作品');
 const rows=assetWorkspaceInventory(project,store.db.assets,{scope:'work'}).filter(r=>r.role==='character'&&stateKey(r.name)===stateKey(input.name));
 const episodes=[...new Set(rows.flatMap(r=>r.uses.map(u=>u.episode)))].filter(e=>input.scope==='work'||e===input.episode).sort((a,b)=>a-b);
 return {items:episodes.map(episode=>{
  const variants=rows.filter(r=>r.uses.some(u=>u.episode===episode)),matching=variants.filter(r=>stateKey(r.state)===stateKey(input.fromState)),uses=matching.flatMap(r=>r.uses.filter(u=>u.episode===episode));
  const ids=new Set(uses.map(u=>u.panelId));
  let reason=!uses.length?'本话采用其他服装，保留剧情版本':uses.some(u=>u.locked)?'画格已锁定':store.db.jobs.some(j=>j.projectId===project.id&&ids.has(j.panelId)&&active.has(j.status))?'本话有生成任务，完成后再采用':'';
  return {episode,uses:uses.length,states:variants.map(r=>r.state),eligible:!reason,reason,preservesOtherCostumes:variants.some(r=>stateKey(r.state)!==stateKey(input.fromState))};
 })};
}
export function prepareAssetCorrection(store,project,input){
 check(project.revision===input.expectedRevision,'工程已改变，请重新预览修正范围',409);
 const preview=correctionPreview(store,project,input),eligible=preview.items.filter(i=>i.eligible).map(i=>i.episode),chosen=input.episodes;
 check(Array.isArray(chosen)&&chosen.length>0&&chosen.length<=1000&&new Set(chosen).size===chosen.length&&chosen.every(e=>eligible.includes(e)),'修正范围已变化，请重新预览；锁定、生成中和剧情例外会保留',409);
 check(typeof input.reason==='string'&&input.reason.trim()&&input.reason.length<=1000,'请填写修正原因');
 if(input.correction)check(/^[a-f0-9]{64}$/.test(input.correction.id||'')&&Number.isSafeInteger(input.correction.version)&&input.correction.version>0&&typeof input.correction.author==='string'&&input.correction.author.length<=100,'团队修正来源无效');
 let asset;if(input.referenceAssetId){asset=store.db.assets.find(a=>a.id===input.referenceAssetId);const meta=asset&&stateReferenceMetadata(project,asset);check(asset?.library?.revisionId&&stateKey(meta.name)===stateKey(input.name)&&stateReferenceMatches(input.state,meta),'参考卡与修正后的人物或服装不一致',409);}
 const next=structuredClone(project),now=new Date().toISOString();next.characterOutfitOverrides||={};
 for(const episode of chosen){
  const prior=next.characterOutfitOverrides[episode]?.[input.name],history=[...(prior?.history||[]),...(prior?[{state:prior.state,updatedAt:prior.updatedAt,reason:prior.reason||'',correctionId:prior.correctionId||''}]:[])].slice(-20);
  const priorRules=prior?[prior,...(prior.variants||[])].map(({variants,...r})=>r):[],continued=priorRules.filter(r=>stateKey(r.state)===stateKey(input.fromState)),matchStates=[...new Set([input.fromState,...continued.flatMap(r=>r.matchStates||r.previousStates)])].slice(-20),variants=priorRules.filter(r=>stateKey(r.state)!==stateKey(input.fromState)&&r.matchStates).map(r=>({...r,matchStates:r.matchStates.filter(v=>!matchStates.some(m=>stateKey(m)===stateKey(v)))})).filter(r=>r.matchStates.length);check(variants.length<=20,'本话服装修正版本过多，请先核对历史版本');const previousStates=[...new Set([input.fromState,...matchStates])].slice(-20);
  next.characterOutfitOverrides[episode]={...next.characterOutfitOverrides[episode],[input.name]:{state:input.state.trim(),previousStates,matchStates,variants,source:'user-confirmed',updatedAt:now,reason:input.reason.trim(),history,...(input.correction?{correctionId:input.correction.id,correctionVersion:input.correction.version,author:input.correction.author}:{}),...(asset?{referenceAssetId:asset.id,referenceRevisionId:asset.library.revisionId}:{})}};
 }
 for(const page of next.pages)for(const panel of page.panels){if(!chosen.includes(panelOutfitEpisode(next,panel)))continue;const shot=next.shots.find(s=>s.id===panel.shotId)||panel.generation?.sourceSnapshot?.original,states=panel.generation?.characterStates||shot?.characterStates||shot?.sourceFields?.['角色状态（服装/形态）']||'';if(!parseNamedStates(states).entries.some(e=>stateKey(e.name)===stateKey(input.name)))continue;const effective=effectiveCharacterStates(next,panel,states);if(effective===states)continue;check(!page.locked&&!panel.locked,'画格锁定状态已变化，请重新预览',409);panel.generation||={version:1,referenceRoles:[]};panel.generation.characterStates=effective;delete panel.referenceRequirements;}
 check(validOutfitOverrides(next.characterOutfitOverrides),'修正记录无效');ensureProjectPanelGeneration(next,store.db.assets);validateProject(next);return {project:next,preview,episodes:chosen};
}
