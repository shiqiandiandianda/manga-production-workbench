import {assetUnavailable} from '../public/asset-availability.js';
import {acknowledgeReferenceSelection} from '../public/asset-workspace-removal.js';
import {auditPanelReferences} from '../public/panel-reference-audit.js';
import {bindProductionExtraReference} from '../public/production-extra-references.js';
import {productionSegment} from '../public/production-package-model.js';
import {setPanelReferences,panelReferenceIds} from '../public/panel-references.js';
import {productionAssetBinding} from './production-reference-files.mjs';
import {check} from './store.mjs';
import {stateReferenceMetadata,stateReferenceMatches,characterIdentityMatches} from '../public/character-state-references.js';
import {stateKey} from '../public/character-states.js';
import {unknownState} from '../public/character-states.js';
import {isBlockingReference,withBlockingIdentity} from '../public/scene-blocking.js';
export function bindWorkspaceAsset(project,panel,need,asset,store,{stateConfirmation,userSelected=false}={}){
 acknowledgeReferenceSelection(project,panel.id,need.id);
 check(asset?.library?.revisionId&&/^[a-f0-9]{64}$/.test(asset.library.sha256||''),'新选图片必须来自墨库固定版本');check(!assetUnavailable(asset),'该素材尚未确认或已禁用');
 if(need.blockingSupplement){
  const prior=need.selectedIds;panel.referenceNeedBindings={...panel.referenceNeedBindings,[need.id]:{assetId:asset.id,name:need.name,role:'scene',state:need.state,purpose:'blocking',blockingId:need.blockingId,revisionId:asset.library.revisionId,sha256:asset.library.sha256}};
  const audit=auditPanelReferences(project,panel,store.db.assets),shared=new Set(audit.needs.filter(n=>n.id!==need.id).flatMap(n=>n.selectedIds));
  setPanelReferences(panel,[...new Set([...panelReferenceIds(project,panel).filter(id=>!prior.includes(id)||shared.has(id)),asset.id])],{project,assets:store.db.assets});return;
 }
 let manualStateConfirmation;
 if(!userSelected&&need.role==='character'&&need.state&&!unknownState(need.state)){
  const meta=stateReferenceMetadata(project,asset),mismatch=meta.stateLabels.length&&!stateReferenceMatches(need.state,meta);
  if(mismatch){
   check(characterIdentityMatches(need,meta,asset),'所选图片的人物身份或资产类型不一致，不能仅确认服装名称后采用',409);
   check(stateConfirmation&&stateConfirmation.assetId===asset.id&&stateConfirmation.revisionId===asset.library.revisionId&&stateConfirmation.sha256===asset.library.sha256&&stateKey(stateConfirmation.name)===stateKey(need.name)&&stateKey(stateConfirmation.state)===stateKey(need.state)&&stateKey(stateConfirmation.selectedState)===stateKey(meta.state),'人物服装冲突：'+need.name+'需要“'+need.state+'”，所选参考为“'+meta.state+'”。若只是名称不同，请看图后人工确认采用',409);
   manualStateConfirmation={version:1,selectedState:meta.state,confirmedAt:new Date().toISOString()};
  }
 }
 // Replacing an image clears any previous naming exception for this need.
 if(panel.referenceNeedBindings?.[need.id]?.manualStateConfirmation)delete panel.referenceNeedBindings[need.id];
 if(manualStateConfirmation||userSelected)panel.referenceNeedBindings={...panel.referenceNeedBindings,[need.id]:{assetId:asset.id,name:need.name,role:need.role,state:need.state||'',revisionId:asset.library.revisionId,sha256:asset.library.sha256,...(manualStateConfirmation?{manualStateConfirmation}:{}),...(userSelected?{userSelection:{version:1,selectedAt:new Date().toISOString()}}:{})}};
 if(panel.referenceTextBindings?.[need.id])panel.referenceTextBindings[need.id]={...panel.referenceTextBindings[need.id],mode:'image',imageIds:[asset.id]};
 if(panel.productionSegment){if(need.supplemental)bindProductionExtraReference(project,panel,{id:need.id,name:need.name,role:need.role,assetId:asset.id},store.db.assets);else{const segment=productionSegment(project,panel.productionSegment),ref=segment.references.find(r=>r.slot===need.slot);check(ref&&ref['类型']!=='上一段成图','附图需求已变化',409);check(!segment.references.some(r=>r!==ref&&r.binding?.assetId===asset.id&&!(need.purpose==='blocking'&&isBlockingReference(r)&&withBlockingIdentity(project,panel,{name:need.name},r).blockingId===need.blockingId)),'该图已经用于其他资产，请核对身份');ref.binding={...productionAssetBinding(store,asset.id),...(need.purpose==='blocking'?{purpose:'blocking',blockingId:need.blockingId}:{})};ref.skipped=false;}
  const audit=auditPanelReferences(project,panel,store.db.assets);panel.referenceIds=audit.ids;panel.generation.referenceRoles=[...new Map(audit.needs.flatMap(n=>n.selectedIds.map(assetId=>[assetId,{assetId,name:n.name,role:n.role}]))).values()];delete panel.referenceRequirements;
 }else{panel.referenceNeedBindings={...panel.referenceNeedBindings,[need.id]:{assetId:asset.id,name:need.name,role:need.role,state:need.state||'',revisionId:asset.library.revisionId,sha256:asset.library.sha256,...(manualStateConfirmation?{manualStateConfirmation}:{}),...(userSelected?{userSelection:{version:1,selectedAt:new Date().toISOString()}}:{})}};const retained=panelReferenceIds(project,panel).filter(id=>!need.selectedIds.includes(id)||auditPanelReferences(project,panel,store.db.assets).needs.some(n=>n.id!==need.id&&n.selectedIds.includes(id)));setPanelReferences(panel,[...new Set([...retained,asset.id])],{project,assets:store.db.assets});}
}
