import {assetUnavailable} from './asset-availability.js';
import {withRemovedReference} from './asset-workspace-removal.js';
import {withTextAssetReference} from './asset-text-references.js';
import {assetNameKey} from './asset-metadata.js';
import {setPanelReferences} from './panel-references.js';
const list=v=>(Array.isArray(v)?v:String(v||'').split(/[、，,；;\n]+/u)).map(v=>String(v).trim()).filter(v=>v&&!/^(无|暂无|none|—|-)$/iu.test(v));
const normal=v=>String(v||'').normalize('NFKC').trim().toLowerCase();
export function productionReferenceSubject(ref){
 if(ref['人物'])return ref['人物'];
 return ref['场景']||ref['道具']||ref['名称']||String(ref['说明']||'').match(/[^\s（）()]+\.(?:png|jpe?g|webp)/i)?.[0]?.replace(/\.[^.]+$/,'')||ref['说明']||ref['类型'];
}
/** Supplemental choices come only from declared storyboard scenes/props, never an arbitrary first character slot. */
export function productionExtraNeeds(project,panel,assets=[],referenceContext){
 const segmentId=panel.productionSegment;if(!segmentId)return [];
 const segment=referenceContext?referenceContext.segments.get(segmentId):project.productionPackage?.episodes.flatMap(e=>e.segments).find(s=>s.id===segmentId),rows=referenceContext?(referenceContext.records.get(segmentId)||[]):project.productionPackage?.episodes.flatMap(e=>e.panelRecords).filter(r=>r.segmentId===segmentId)||[],needs=new Map();
 for(const record of rows){const raw={...record.production,...record.original};for(const [role,field]of [['scene','当前场景'],['prop','出现道具']])for(const name of list(raw[field])){
  if(segment?.references.some(r=>(role==='scene'?/场景/.test(r['类型']):/道具/.test(r['类型']))&&assetNameKey(productionReferenceSubject(r))===assetNameKey(name)))continue;
  const id='name:'+role+':'+normal(name);if(needs.has(id))continue;
  const binding=panel.referenceNeedBindings?.[id],asset=binding&&binding.role===role&&assetNameKey(binding.name)===assetNameKey(name)&&assets.find(a=>a.id===binding.assetId),bad=asset&&(assetUnavailable(asset));
  needs.set(id,{id,slot:id,name,role,state:'',supplemental:true,required:false,optional:true,selectedIds:asset&&!bad?[asset.id]:[],recommendedId:null,candidates:[],status:bad?'conflict':asset?'ready':'missing',blocking:false,reason:'分镜表声明的'+(role==='scene'?'场景':'道具')+'，可明确选图补充'});
 }}return [...needs.values()].map(need=>withTextAssetReference(panel,withRemovedReference(project,panel,need)));
}
export function productionExtraReferenceRoles(project,panel,assets=[]){
 return productionExtraNeeds(project,panel,assets).flatMap(need=>{if(need.status==='conflict')throw Error('所选参考已被标记为不能使用：'+need.name);return need.selectedIds.map(assetId=>{const b=panel.referenceNeedBindings[need.id],a=assets.find(a=>a.id===assetId);if(b.revisionId&&a.library?.revisionId!==b.revisionId||b.sha256&&a.library?.sha256!==b.sha256)throw Error('参考素材固定版本发生变化，请重新选择：'+need.name);return {assetId,name:need.name,role:need.role};});});
}
export function bindProductionExtraReference(project,panel,choice,assets){
 const need=productionExtraNeeds(project,panel,assets).find(n=>n.id===choice.id&&n.role===choice.role&&n.name===choice.name);if(!need)throw Error('本屏段的场景或道具需求已改变，请重新选图');
 const asset=assets.find(a=>a.id===choice.assetId);if(!asset?.library?.revisionId||!/^[a-f0-9]{64}$/.test(asset.library.sha256||''))throw Error('请从墨库采用固定版本图片');
 if(assetUnavailable(asset))throw Error('该素材尚未确认或已被标记为不能使用');
 if(project.productionPackage.episodes.flatMap(e=>e.segments).find(s=>s.id===panel.productionSegment)?.references.some(r=>r.binding?.assetId===asset.id)||Object.entries(panel.referenceNeedBindings||{}).some(([key,b])=>key!==need.id&&b.assetId===asset.id))throw Error('该图已用于另一参考，请选择当前场景或道具对应的图片');
 const old=panel.referenceNeedBindings?.[need.id]?.assetId,retained=(panel.referenceIds||[]).filter(id=>id!==old||Object.entries(panel.referenceNeedBindings||{}).some(([key,b])=>key!==need.id&&b.assetId===id)||project.productionPackage.episodes.flatMap(e=>e.segments).find(s=>s.id===panel.productionSegment)?.references.some(r=>r.binding?.assetId===id));
 panel.referenceNeedBindings={...panel.referenceNeedBindings,[need.id]:{assetId:asset.id,name:need.name,role:need.role,revisionId:asset.library.revisionId,sha256:asset.library.sha256}};
 setPanelReferences(panel,[...new Set([...retained,asset.id])],{project,assets});
}
