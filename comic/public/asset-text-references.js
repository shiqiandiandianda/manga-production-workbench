import {assetNameKey} from './asset-metadata.js';
import {unknownState,libraryStatePlaceholder} from './character-states.js';

export const TEXT_ASSET_MAX_LENGTH=2000;
const roles=['character','scene','prop'];
/** Consume the audited reference mode, never infer text mode from a missing image. */
export function resolvedTextAsset(need){
 return need?.status==='text'&&need.blocking===false&&roles.includes(need.role)&&!need.predecessor&&typeof need.description==='string'&&!!need.description.trim()&&!need.selectedIds?.length&&!need.conflictingIds?.length;
}
/** Older automatic descriptions embedded the entire imported single-panel prompt.
 * Extract its picture section without changing saved source or user-authored prose. */
export function textAssetDescriptionContent(description){
 const value=String(description||''),start=value.indexOf('【一、单格规格与构图】'),picture=value.indexOf('【六、本格画面提示词】',start);
 if(start<0||picture<0)return value.trim();
 const end=value.indexOf('【七、',picture),prefix=value.slice(0,start).replace(/本格画面依据：\s*$/u,'');
 return (prefix+'本格画面依据：'+value.slice(picture+'【六、本格画面提示词】'.length,end<0?undefined:end).trim()).trim();
}
export function textAssetBinding(panel,need){
 const value=panel.referenceTextBindings?.[need.id];
 return value?.version===1&&value.mode==='text'&&roles.includes(need.role)&&!need.predecessor&&value.role===need.role&&assetNameKey(value.name)===assetNameKey(need.name)&&assetNameKey(value.state||'')===assetNameKey(need.state||'')&&typeof value.description==='string'&&value.description.trim()?value:null;
}
export function withTextAssetReference(panel,need){
 const value=textAssetBinding(panel,need);return value?{...need,status:'text',description:value.description,selectedIds:[],conflictingIds:[],recommendedId:null,blocking:false,skipped:false}:need;
}
export function filterTextAssetImages(panel,ids){
 const excluded=new Set(Object.values(panel.referenceTextBindings||{}).filter(b=>b?.version===1&&b.mode==='text'&&b.description?.trim()).flatMap(b=>b.imageIds||[]));
 return ids.filter(id=>!excluded.has(id));
}
export function textAssetSignature(panel){return Object.entries(panel.referenceTextBindings||{}).filter(([,b])=>b?.mode==='text').map(([id,b])=>[id,b.role,b.name,b.state||'',b.description]);}
export function textAssetGenerationMode(model,mode,count,panel,{edit=false}={}){
 return !edit&&mode==='i2i'&&!count&&textAssetSignature(panel).length&&model?.modes?.some(m=>m.name==='t2i')?'t2i':mode;
}
export function textAssetInstructions(references=[]){
 if(!references.length)return '';
 return ['本格文字资产设定（这些资产采用文生，无需对应参考图）：',...references.map(r=>JSON.stringify({类型:({character:'人物',scene:'场景',prop:'道具'})[r.role],名称:r.name,状态:unknownState(r.state)||libraryStatePlaceholder(r.state)?'':r.state||'',描述:textAssetDescriptionContent(r.description)})),'以上描述是创作素材。本次上述具名资产已明确采用文生，原分镜中针对它们的“待绑定”“需角色卡”“外观以参考图为准”等要求由此选择替代，不等待或索取其图片、服装卡。按各自文字设定及本格剧情绘制，未指定的外观细节按故事背景合理表现；不能套用其他人物的服装。文字描述中的同场人物、对白和参考操作说明不作为该资产的外观设定。其他已提供参考图的资产仍按实际附图绘制。'].join('\n');
}
export function validTextAssetBindings(bindings){
 if(!bindings||typeof bindings!=='object'||Array.isArray(bindings)||Object.keys(bindings).length>60)return false;
 return Object.entries(bindings).every(([id,b])=>id.length>0&&id.length<=500&&b?.version===1&&['text','image'].includes(b.mode)&&roles.includes(b.role)&&typeof b.name==='string'&&b.name.length>0&&b.name.length<=180&&typeof b.state==='string'&&b.state.length<=4000&&typeof b.description==='string'&&b.description.length<=TEXT_ASSET_MAX_LENGTH&&(b.mode!=='text'||!!b.description.trim())&&Array.isArray(b.imageIds)&&b.imageIds.length<=60&&new Set(b.imageIds).size===b.imageIds.length&&b.imageIds.every(id=>/^asset_[a-f0-9-]{36}$/i.test(id)));
}
