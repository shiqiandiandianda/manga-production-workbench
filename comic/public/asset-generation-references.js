import {assetMetadata,assetNameKey} from './asset-metadata.js';
import {automaticCharacterIdentity,characterIdentityCandidates} from './character-identity-reference.js';
export const generationReferenceFields={identityAssetId:'人物身份',costumeAssetId:'服装',propAssetId:'道具'};
export function characterIdentityChoices(project,assets,need){return characterIdentityCandidates(project,assets,need);}
/** Selection changes generation inputs only; it never binds a panel or chooses an arbitrary outfit. */
export function generationReferencePlan(project,assets,need,settings,defaultIds=[]){
 const get=id=>{const a=assets.find(a=>a.id===id);if(!a)throw Error('参考图已不存在，请重新选择');return a;},refs=[],ids=[];
 const add=(id,role)=>{if(!id)return;const a=get(id);if(!ids.includes(id))ids.push(id);refs.push({assetId:id,role,name:a.name||role,index:ids.indexOf(id)+1});};
 if(need.role!=='character'){for(const id of defaultIds)add(id,'原资产');return {referenceIds:ids,references:refs,guidance:''};}
 let identity=settings.identityReferenceMode==='auto'?'':settings.identityAssetId||'',identitySelection={status:'manual',assetId:identity};
 if(settings.identityReferenceMode==='none')identity='';
 else if(!identity&&settings.identityReferenceMode!=='selected'){
  identitySelection=automaticCharacterIdentity(project,assets,need,{defaultIds,appearanceNotes:settings.appearanceNotes});
  if(['ambiguous','incompatible'].includes(identitySelection.status))throw Error(identitySelection.reason);
  identity=identitySelection.assetId||'';
 }
 if(settings.identityReferenceMode==='selected'&&!identity)throw Error('请选择人物身份参考图');
 if(settings.propAssetId&&!settings.propPlacement?.trim())throw Error('已选择道具参考，请填写佩戴或持握位置，例如“连鞘佩于人物左腰”');
 if(settings.propAssetId&&settings.propAssetId===identity)throw Error('人物身份图和道具图请分别选择');
 add(identity,'人物身份');add(settings.costumeAssetId,'本次服装');add(settings.propAssetId,'道具');
 const guidance=[...refs.map(r=>`第${r.index}张参考【${r.role}】：${r.name}。`),identity?'人物身份参考只约束同一人的脸型、五官、年龄、胡须、肤色、发型基础、身高、骨架与高矮胖瘦；换装不得换脸，不强行套统一头身比。原身份图的旧衣服和旧武器不自动继承。':'没有指定人物身份图，本次是待确认原创候选，不宣称与已有角色一致。',settings.costumeAssetId?'本次服装参考约束衣服、帽子、衣领、颜色、纹样和穿法；不得复制服装图中其他人的脸、年龄或体型。':'只按本次服装名称及文字要求设计新服装，保留身份参考中的本人外貌与体型。',settings.propAssetId?'只使用所选道具参考中的武器结构、材质、颜色、纹样与剑鞘，不复制道具图中的人物。道具佩戴 / 持握要求：'+settings.propPlacement+'。正侧背视图保持同一把武器、同一位置，左右以人物自身为准；头部特写仅画可见局部，不把整把剑塞进头像。独立道具栏展示完整武器和配套剑鞘，护手、握柄、柄首连续连接，不拆断。':''];
 return {referenceIds:ids,references:refs,identitySelection:{...identitySelection,assetId:identity||null},guidance:guidance.filter(Boolean).join('\n')};
}
