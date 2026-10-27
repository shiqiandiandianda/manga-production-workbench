import {assetNameKey} from './asset-metadata.js';
import {characterRequirementState} from './character-preparation.js';
import {unknownState} from './character-states.js';
import {productionReferenceOutfit} from './episode-outfit.js';

// Resolve identities from the declared source asset, never by splitting a person's name
// or borrowing an unspecified costume from a neighbouring screen.
export function withWorkspaceRequirementIdentity(project,panel,need,referenceContext){
 if(need.role!=='character')return need;
 const segmentId=panel.productionSegment||panel.productionGrid?.segmentId||panel.panelSlice?.segmentId;
 const segment=referenceContext?.segments.get(segmentId)||project.productionPackage?.episodes.flatMap(e=>e.segments).find(s=>s.id===segmentId);
 if(!segment)return need;
 let ref;
 if(panel.productionSegment)ref=segment.references.find(r=>r.slot===need.slot&&r['类型']==='设定卡');
 else {
  const grid=panel.productionGrid||panel.panelSlice,records=referenceContext?.records.get(segmentId)||project.productionPackage?.episodes.flatMap(e=>e.panelRecords)||[];
  const record=records.find(r=>r.id===grid?.panelId&&r.segmentId===segmentId),raw={...record?.production,...record?.original};
  const sourceId=raw['当前状态']?.[need.name]?.['参考资产'];
  if(sourceId){const refs=segment.references.filter(r=>r['类型']==='设定卡'&&r.assetSourceId===sourceId);if(refs.length===1)ref=refs[0];}
 }
 if(!ref)return need;
 const name=ref.sourceReference?.['显示名称']||ref['人物'];
 if(!name)return need;
 // Explicit source costumes stay separate even when the asset number is shared.
 const referenceState=(referenceContext?.outfit(ref)??productionReferenceOutfit(project,ref))||ref['说明']||'';
 const state=panel.productionSegment||unknownState(need.state)?referenceState:need.state;
 return {...need,workspaceIdentity:{name,state:characterRequirementState(state)},workspaceLegacyKey:JSON.stringify([need.role,assetNameKey(need.name),assetNameKey(need.state||'')])};
}
