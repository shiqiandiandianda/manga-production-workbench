import {filterTextAssetImages,textAssetSignature} from './asset-text-references.js';
import {stateKey,parseNamedStates,sourceStateFields} from './character-states.js';
import {assetLibraryRole} from './asset-metadata.js';
import {isBlockingAsset,inheritedBlockingReferenceIds} from './scene-blocking.js';
// Use the existing workspace reference ceiling, independently of provider limits.
export const WORKSPACE_REFERENCE_LIMIT=60;
export const referenceRole=asset=>assetLibraryRole(asset)||'character';
const names=value=>Array.isArray(value)?value:String(value||'').split(/[、，,；;\n]+/u).map(v=>v.trim()).filter(v=>v&&!/^(无|空镜|暂无|none|—|-)$/iu.test(v));
function initialProjectReferences(project,shot){
 if(!shot)return project.references.map(r=>r.assetId);
 const characters=names(shot.participants||shot.sourceFields?.['出现角色']),cast=characters.length?characters:parseNamedStates(sourceStateFields(shot).characterStates).entries.map(e=>e.name),scene=shot.location||shot.sourceFields?.['当前场景'],props=names(shot.propNames||shot.props||shot.sourceFields?.['出现道具']);
 if(!cast.length&&!scene&&!props.length)return project.references.map(r=>r.assetId);
 return project.references.filter(ref=>{if(ref.role==='style')return true;const aliases=Object.values(project.assetBindings||{}).filter(b=>b.assetId===ref.assetId).flatMap(b=>b.names||[]),keys=[ref.name,...aliases].map(stateKey);return (ref.role==='character'?cast:ref.role==='scene'?[scene]:ref.role==='prop'?props:[]).some(name=>keys.includes(stateKey(name)));}).map(r=>r.assetId);
}
export function panelReferenceIds(project,panel){return filterTextAssetImages(panel,[...new Set([...rawPanelReferenceIds(project,panel),...inheritedBlockingReferenceIds(project,panel)])]);}
function rawPanelReferenceIds(project,panel){
 if(Array.isArray(panel.referenceIds))return [...panel.referenceIds];
 if(panel.generation?.version===1)return panel.generation.referenceRoles.map(ref=>ref.assetId);
 const shot=project.shots.find(s=>s.id===panel.shotId);
 return shot?.referenceIds?.length?[...shot.referenceIds]:initialProjectReferences(project,shot);
}
export function referencesForPanel(project,panel,assets){
 const byId=assets instanceof Map?assets:new Map(assets.map(a=>[a.id,a]));
 return filterTextAssetImages(panel,panelReferenceIds(project,panel)).map(assetId=>{
  const asset=byId.get(assetId),ref=panel.generation?.version===1?panel.generation.referenceRoles.find(r=>r.assetId===assetId):project.references.find(r=>r.assetId===assetId);
  if(!asset)throw new Error(`参考资产不存在：${ref?.name||assetId}；请重新选择或定位原图`);
  const binding=Object.values(panel.referenceNeedBindings||{}).find(b=>b.assetId===assetId&&['character','scene','prop','style'].includes(b.role));let name=binding?.name||ref?.name||asset.name;if((binding?.purpose==='blocking'||isBlockingAsset(asset))&&!name.includes('姓名标注不绘入漫画'))name+='（只参考空间，姓名标注不绘入漫画）';return {assetId,name,role:binding?.role||ref?.role||referenceRole(asset)};
 });
}
export function panelReferenceKey(project,panel,assets){
 return JSON.stringify({binding:Array.isArray(panel.referenceIds)?panel.referenceIds:null,references:referencesForPanel(project,panel,assets),...(textAssetSignature(panel).length?{textAssets:textAssetSignature(panel)}:{})});
}
export function setPanelReferences(panel,ids,{project,assets,source='manual'}={}){
 if(ids===null){if(panel.generation?.version===1&&project){const shot=project.shots.find(s=>s.id===panel.shotId);ids=shot?.referenceIds?.length?[...shot.referenceIds]:initialProjectReferences(project,shot);}else{delete panel.referenceIds;return;}}
 if(!Array.isArray(ids)||ids.length>WORKSPACE_REFERENCE_LIMIT||new Set(ids).size!==ids.length)throw new Error('本格参考数据无效或超过工作台 60 张参考上限');
 panel.referenceIds=[...ids];
 panel.assetReferenceBinding={mode:source==='asset-import'?'auto':'manual',managedIds:source==='asset-import'?[...ids]:[]};
 if(panel.generation?.version===1&&project&&assets){const current={...panel,generation:undefined};panel.generation.referenceRoles=referencesForPanel(project,current,assets);}
}
export function referenceCountError(model,mode,count,{edit=false}={}){
 const actual=count+(edit?1:0),selected=model?.modes?.find(m=>m.name===mode);
 if(mode==='t2i'&&actual)return '已选择参考资产，请在生图设置中选择图生图。';
 if(mode==='i2i'&&!actual)return '图生图需要至少一张参考资产，请选择资产或改为文生图。';
 const specs=selected?.references;
 if(!specs)return '';
 const image=specs.types?.find(t=>t.mediaType==='image');
 const min=Math.max(specs.min??0,image?.min??0),max=Math.min(specs.max??Infinity,image?.max??Infinity);
 if(actual<min||actual>max)return `所选官方模型允许 ${min}—${Number.isFinite(max)?max:'不限'} 张图片参考；当前 ${actual} 张${edit?'（含重绘底图）':''}。请调整选择或更换模型。`;
 return '';
}
