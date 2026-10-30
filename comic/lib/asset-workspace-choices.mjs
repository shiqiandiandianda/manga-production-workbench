import {assetUnavailable} from '../public/asset-availability.js';
import {auditPanelReferences} from '../public/panel-reference-audit.js';
import {assetRequirementKey} from '../public/asset-workspace-model.js';
import {stateReferenceMetadata,stateReferenceMatches,characterIdentityMatches} from '../public/character-state-references.js';
import {unknownState,stateKey} from '../public/character-states.js';
import {productionSegment} from '../public/production-package-model.js';
import {bindWorkspaceAsset} from './asset-workspace-binding.mjs';
import {validateProject} from './store.mjs';
import {createReferenceAuditContext} from '../public/reference-audit-context.js';

const active=new Set(['queued','preparing','running','recoverable','delegated','awaiting_confirmation']);
const eligible=need=>!need.predecessor&&!need.skipped&&!need.removed&&need.status!=='text'&&['character','scene','prop'].includes(need.role)&&(need.role!=='character'||need.state&&!unknownState(need.state));
function validChoice(project,need,choice,asset){
 if(!choice||!asset||asset.deletedAt||asset.trashedAt||['candidate','stale'].includes(asset.productionStatus)||assetUnavailable(asset)||assetRequirementKey(choice)!==assetRequirementKey(need)||!choice.revisionId||choice.revisionId!==asset.library?.revisionId||!/^[a-f0-9]{64}$/.test(choice.sha256||'')||choice.sha256!==asset.library?.sha256)return false;
 if(need.role!=='character')return true;
 const meta=stateReferenceMetadata(project,asset);if(!characterIdentityMatches(need,meta,asset))return false;
 return stateReferenceMatches(need.state,meta)||choice.manualStateConfirmation?.version===1&&stateKey(choice.manualStateConfirmation.selectedState)===stateKey(meta.state);
}
export function rememberWorkspaceChoice(project,panel,need,asset){
 if(!eligible({...need,removed:false,skipped:false,status:'ready'}))return;
 const b=panel.referenceNeedBindings?.[need.id],choice={assetId:asset.id,name:need.name,role:need.role,state:need.state||'',...(need.purpose==='blocking'?{purpose:'blocking',blockingId:need.blockingId}:{}),revisionId:asset.library?.revisionId,sha256:asset.library?.sha256,...(b?.manualStateConfirmation?{manualStateConfirmation:structuredClone(b.manualStateConfirmation)}:{}),selectedAt:new Date().toISOString()};
 if(!validChoice(project,need,choice,asset))return;
 project.assetWorkspaceChoices={version:1,items:{...project.assetWorkspaceChoices?.items,[assetRequirementKey(need)]:choice}};
}
/** Migrate existing explicit selections without treating a catalogue candidate as approved. */
export function knownWorkspaceChoices(project,assets,contexts){
 const byId=new Map(assets.map(a=>[a.id,a])),choices=new Map(),seen=new Map();
 for(const [key,choice]of Object.entries(project.assetWorkspaceChoices?.version===1?project.assetWorkspaceChoices.items||{}:{}))if(validChoice(project,choice,choice,byId.get(choice.assetId)))choices.set(key,choice);
 for(const {panel,need}of contexts){if(!eligible(need)||need.status!=='ready'||need.selectedIds.length!==1)continue;const asset=byId.get(need.selectedIds[0]),b=panel.referenceNeedBindings?.[need.id],choice=asset&&{assetId:asset.id,name:need.name,role:need.role,state:need.state||'',...(need.purpose==='blocking'?{purpose:'blocking',blockingId:need.blockingId}:{}),revisionId:asset.library?.revisionId,sha256:asset.library?.sha256,...(b?.manualStateConfirmation?{manualStateConfirmation:structuredClone(b.manualStateConfirmation)}:{})};if(!validChoice(project,need,choice,asset))continue;const key=assetRequirementKey(need),versions=seen.get(key)||new Map();versions.set(choice.assetId+'@'+choice.revisionId,choice);seen.set(key,versions);}
 for(const [key,versions]of seen)if(!choices.has(key)&&versions.size===1)choices.set(key,[...versions.values()][0]);return choices;
}
export function reuseWorkspaceChoices(store,old){
 const next=structuredClone(old),contexts=[],referenceContext=createReferenceAuditContext(next,store.db.assets);for(const page of next.pages)for(const panel of page.panels){if(panel.cutoutLayer||panel.productionBackground||panel.productionBackgroundInstance)continue;for(const need of auditPanelReferences(next,panel,store.db.assets,{referenceContext}).needs)contexts.push({page,panel,need});}
 const choices=knownWorkspaceChoices(next,store.db.assets,contexts),summary={reused:0,remembered:choices.size,locked:0,active:0,issues:[]};
 for(const [key,choice]of choices){next.assetWorkspaceChoices||={version:1,items:{}};next.assetWorkspaceChoices.items[key]=choice;}
 for(const {page,panel,need}of contexts){if(!eligible(need)||need.status==='ready'||need.selectedIds.length||need.conflictingIds?.length)continue;const choice=choices.get(assetRequirementKey(need)),asset=choice&&store.db.assets.find(a=>a.id===choice.assetId);if(!validChoice(next,need,choice,asset))continue;if(page.locked||panel.locked){summary.locked++;continue;}if(store.db.jobs.some(j=>j.projectId===next.id&&j.panelId===panel.id&&active.has(j.status))){summary.active++;continue;}
  const stateConfirmation=choice.manualStateConfirmation?{assetId:asset.id,revisionId:choice.revisionId,sha256:choice.sha256,name:need.name,state:need.state,selectedState:choice.manualStateConfirmation.selectedState}:undefined;
  const panelBefore=structuredClone(panel),ref=panel.productionSegment&&productionSegment(next,panel.productionSegment)?.references.find(r=>r.slot===need.slot),refBefore=ref&&structuredClone(ref);
  try{bindWorkspaceAsset(next,panel,need,asset,store,{stateConfirmation});summary.reused++;}catch(error){for(const key of Object.keys(panel))delete panel[key];Object.assign(panel,panelBefore);if(ref){for(const key of Object.keys(ref))delete ref[key];Object.assign(ref,refBefore);}summary.issues.push({panelId:panel.id,needId:need.id,message:error.message});}
 }
 validateProject(next);return {project:next,summary,changed:JSON.stringify(next)!==JSON.stringify(old)};
}
