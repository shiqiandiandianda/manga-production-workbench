import {assetMetadata} from './asset-metadata.js';

const roles={character:'character',人物:'character',角色:'character',scene:'scene',场景:'scene',prop:'prop',道具:'prop',pet:'pet',灵宠:'pet',bubble:'bubble',气泡:'bubble',nameplate:'nameplate',人物铭牌:'nameplate',sfx_text:'sfx_text',特效字:'sfx_text',font:'font',字体:'font',style:'style',画风:'style'};
export function candidateAssetRole(item){
 // A modern Moku classification is authoritative even when it is a type the
 // picker does not use (for example a comic panel or episode strip).
 const explicit=item.assetType||item.library?.assetType;
 if(explicit)return roles[explicit]||String(explicit);
 for(const value of [item.category,item.library?.category,item.libraryRole])if(roles[value])return roles[value];
 if(item.characterGroupId||item.library?.characterGroupId||item.characterName||item.library?.characterName)return 'character';
 const tagged=(item.tags||item.library?.tags||[]).map(tag=>roles[typeof tag==='string'?tag:tag?.name]).filter(Boolean);
 if(new Set(tagged).size===1)return tagged[0];
 return assetMetadata(item).role;
}
export function filterAssetCandidateTypes(items,role,{allTypes=false}={}){
 if(allTypes||!['character','scene','prop'].includes(role))return items;
 return items.filter(item=>candidateAssetRole(item)===role);
}
