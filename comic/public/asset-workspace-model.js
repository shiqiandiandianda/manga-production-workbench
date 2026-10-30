import {auditPanelReferences} from './panel-reference-audit.js';
import {assetMetadata,assetNameKey} from './asset-metadata.js';
import {pageEpisode} from './episode-boards.js';
import {assetProvenance} from './asset-provenance.js';
import {createReferenceAuditContext} from './reference-audit-context.js';
import {characterRequirementState,characterPreparationNote} from './character-preparation.js';
import {isBlockingAsset} from './scene-blocking.js';
export const assetRequirementKey=need=>JSON.stringify([need.role,assetNameKey(need.workspaceIdentity?.name||need.name),need.purpose==='blocking'?'blocking:'+need.blockingId:need.role==='character'?assetNameKey(characterRequirementState(need.workspaceIdentity?.state??need.state)):'']);
export function savedAssetRequirementSettings(project,need){
 const settings=project.assetWorkspaceSettings||{},key=assetRequirementKey(need),rawKey=JSON.stringify([need.role,assetNameKey(need.name),assetNameKey(need.state||'')]);
 if(need.purpose==='blocking')return settings[key]||{};
 if(settings[key])return settings[key];if(settings[rawKey])return settings[rawKey];
 for(const legacyKey of need.requirementKeys||[])if(settings[legacyKey])return settings[legacyKey];
 for(const [oldKey,value]of Object.entries(settings)){try{const [role,name,state]=JSON.parse(oldKey);if(assetRequirementKey({role,name,state})===key)return value;}catch{}}
 return {};
}
/** Every screen, grid and UI entry uses the same audited requirement identities. */
export function assetWorkspaceInventory(project,assets=[],{scope='episode',pageId,panelId,referenceContext,includeSources=true,audits}={}){
 if(!project)return [];
 const ctx=referenceContext||createReferenceAuditContext(project,assets),current=project.pages.find(p=>p.id===pageId)||project.pages.find(p=>p.panels.some(f=>f.id===panelId))||project.pages[0],episode=pageEpisode(project,current),rows=new Map(),availableByName=new Map();
 for(const asset of assets){if(['candidate','stale'].includes(asset.productionStatus))continue;const m=assetMetadata(asset),key=m.role+'\0'+assetNameKey(m.name),entry={asset,state:assetNameKey(m.state)};let items=availableByName.get(key);if(!items)availableByName.set(key,items=[]);items.push(entry);}
 for(const page of project.pages){
  const ep=pageEpisode(project,page);if(scope==='episode'&&ep!==episode)continue;
  for(const panel of page.panels){
   if(scope==='panel'&&panel.id!==panelId||panel.cutoutLayer||panel.sfxImage||panel.designDecoration||panel.breakoutForeground||panel.productionBackground||panel.productionBackgroundInstance)continue;
   const audit=audits?.get(panel.id)||auditPanelReferences(project,panel,assets,{referenceContext:ctx});audits?.set(panel.id,audit);
   for(const need of audit.needs){
    if(need.predecessor||!['character','scene','prop'].includes(need.role)||need.purpose==='blocking'&&!need.blockingReady&&!need.selectedIds.length)continue;
    const identity=need.workspaceIdentity||need,key=assetRequirementKey(need),row=rows.get(key)||{key,name:identity.name,role:need.role,purpose:need.purpose,blockingId:need.blockingId,sceneName:need.sceneName,blockingPlanId:need.blockingPlanId,state:need.role==='character'?characterRequirementState(identity.state):need.state||'',uses:[],sources:[],assetIds:[],availableIds:[],textDescriptions:[],preparationNotes:[],requirementKeys:[],required:false};
    const legacyKey=need.workspaceLegacyKey||JSON.stringify([need.role,assetNameKey(need.name),assetNameKey(need.state||'')]);if(!row.requirementKeys.includes(legacyKey))row.requirementKeys.push(legacyKey);
    const note=need.role==='character'&&(need.preparationNote||characterPreparationNote(need.state));if(note&&!row.preparationNotes.includes(note))row.preparationNotes.push(note);
    row.required||=!!need.required;
    if(!row.uses.some(u=>u.panelId===panel.id&&u.needId===need.id))row.uses.push({panelId:panel.id,pageId:page.id,needId:need.id,episode:ep,code:panel.name||panel.id,locked:!!(page.locked||panel.locked),skipped:!!need.skipped,text:need.status==='text',missing:!['ready','text'].includes(need.status)});
    if(need.status==='text'&&!row.textDescriptions.includes(need.description))row.textDescriptions.push(need.description);
    if(includeSources)row.sources.push(...assetProvenance(project,panel,need,ctx));
    for(const id of need.selectedIds)if(!row.assetIds.includes(id))row.assetIds.push(id);
    if(need.recommendedId&&!row.availableIds.includes(need.recommendedId))row.availableIds.push(need.recommendedId);
    rows.set(key,row);
   }
  }
 }
 return [...rows.values()].map(row=>{
  const state=assetNameKey(row.state);for(const {asset:a,state:assetState} of availableByName.get(row.role+'\0'+assetNameKey(row.name))||[])if((row.purpose==='blocking'?a.referenceGeneration?.blockingId===row.blockingId:!isBlockingAsset(a))&&(row.role!=='character'||!row.state||assetState===state)&&!row.assetIds.includes(a.id)&&!row.availableIds.includes(a.id))row.availableIds.push(a.id);
  const uses=new Set(row.uses.map(u=>u.panelId+'\0'+u.needId)),removedAssetIds=[...new Set((project.assetWorkspaceTrash||[]).flatMap(e=>(e.activeTargets||[]).filter(t=>uses.has(t.panelId+'\0'+t.needId)).flatMap(t=>t.assetIds||[])))],removed=removedAssetIds.map(id=>ctx.byId.get(id)).filter(Boolean);
  row.availableIds=row.availableIds.filter(id=>!removedAssetIds.includes(id));
  return {...row,removedAssetIds,removedRevisionIds:removed.map(a=>a.library?.revisionId).filter(Boolean),removedRecordIds:removed.map(a=>a.referenceGeneration?.recordId).filter(Boolean),sources:[...new Map(row.sources.map(s=>[[s.episode,s.code,s.source.file,s.source.row].join(':'),s])).values()],status:row.uses.every(u=>u.text)?'text':row.uses.some(u=>u.text)?'mixed':row.assetIds.length?'ready':row.availableIds.length?'available':'missing'};
 });
}
