import {assetMetadata} from './asset-metadata.js';

const roles={character:'character',人物:'character',角色:'character',scene:'scene',场景:'scene',prop:'prop',道具:'prop',style:'style',画风:'style'};
export function candidateAssetRole(item){
 for(const value of [item.libraryRole,item.assetType,item.library?.assetType,item.category,item.library?.category])if(roles[value])return roles[value];
 if(item.characterGroupId||item.library?.characterGroupId||item.characterName||item.library?.characterName)return 'character';
 const tagged=(item.tags||item.library?.tags||[]).map(tag=>roles[typeof tag==='string'?tag:tag?.name]).filter(Boolean);
 if(new Set(tagged).size===1)return tagged[0];
 return assetMetadata(item).role;
}
export function filterAssetCandidateTypes(items,role,{allTypes=false}={}){
 if(allTypes||!['character','scene','prop'].includes(role))return items;
 return items.filter(item=>candidateAssetRole(item)===role);
}
