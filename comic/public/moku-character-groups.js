/** Each outfit remains its own immutable asset/version; a group is identity metadata. */
export function mokuCharacterMetadata(detail,assetId=detail?.id){
 const naming=Object.fromEntries(['sourceName','projectName','subjectName','canonicalName','canonicalVariantName','namingVersion','sceneName','propName'].filter(key=>detail?.[key]!==undefined).map(key=>[key,detail[key]]));
 const group=detail?.characterGroup;if(!group?.id||group.dissolvedAt)return {...naming,...(detail?.assetType==='character'?Object.fromEntries(['characterGroupId','characterName','outfitName'].filter(key=>detail[key]!==undefined).map(key=>[key,detail[key]])): {})};
 const outfit=group.outfits?.find(item=>item.id===assetId||item.id===detail.id);
 return {...naming,characterGroupId:group.id,characterName:group.name,characterGroupVersion:group.objectVersion,...(outfit?.outfitName?{outfitName:outfit.outfitName}:{})};
}
export function expandMokuAssets(items=[]){
 const result=new Map();for(const item of items){const group=item.characterGroup;
  const outfits=Array.isArray(group?.outfits)&&!group.dissolvedAt?group.outfits:[item];
  for(const outfit of outfits){if(outfit.deletedAt)continue;const {characterGroup,...leaf}=outfit,metadata=group&&!group.dissolvedAt?{characterGroupId:group.id,characterName:group.name,characterGroupVersion:group.objectVersion,outfitName:outfit.outfitName||item.outfitName}:{};
   const value={...leaf,...metadata,projectId:outfit.projectId??group?.projectId??item.projectId,category:outfit.category||(group?'character':item.category)};
   result.set(value.id+'@'+(value.displayRevisionId||value.recommendedRevisionId||''),value);
  }
 }return [...result.values()];
}
