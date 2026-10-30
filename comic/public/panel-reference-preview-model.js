import {auditPanelReferences} from './panel-reference-audit.js';
import {panelReferenceIds} from './panel-references.js';
import {assetMetadata} from './asset-metadata.js';
import {candidateAssetRole} from './asset-candidate-types.js';
import {isBlockingAsset} from './scene-blocking.js';

/** View only the selected frame's adopted images; never promote recommendations. */
export function panelReferencePreview(project,panel,assets=[]){
 if(!project||!panel)return [];
 const audit=auditPanelReferences(project,panel,assets),byId=new Map(assets.map(a=>[a.id,a])),items=new Map();
 const add=(id,ref={})=>{
  const asset=byId.get(id);if(!asset||asset.deletedAt||asset.trashedAt)return;
  const role=ref.role||candidateAssetRole(asset);if(!['character','scene'].includes(role))return;
  const key=role+':'+id;if(items.has(key))return;
  const meta=assetMetadata(asset),name=ref.workspaceIdentity?.name||ref.name||meta.name||asset.name,state=role==='character'?(ref.workspaceIdentity?.state??ref.state??meta.state):'';
  items.set(key,{key,assetId:id,role,name,state,purpose:ref.purpose|| (isBlockingAsset(asset)?'blocking':''),revisionId:asset.library?.revisionId||'',assetName:asset.name});
 };
 for(const need of audit.needs){if(need.skipped||need.status==='text'||need.predecessor)continue;for(const id of need.selectedIds||[])add(id,need);}
 // Screen bindings are authoritative; old frame.referenceIds may contain an
 // obsolete screen or costume. Ordinary frames also allow explicit references.
 for(const id of panel.productionSegment||panel.productionBackground?[]:panelReferenceIds(project,panel)){
  const binding=Object.values(panel.referenceNeedBindings||{}).find(b=>b.assetId===id),ref=binding||panel.generation?.referenceRoles?.find(r=>r.assetId===id)||project.references?.find(r=>r.assetId===id);
  add(id,ref);
 }
 return [...items.values()];
}
