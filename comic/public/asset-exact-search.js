import {assetMetadata,assetNameKey} from './asset-metadata.js';
import {canonicalSubjectName,canonicalVariantName,sceneIdentityName} from './asset-naming.js';
import {candidateAssetRole} from './asset-candidate-types.js';
import {unknownState} from './character-states.js';
import {isBlockingAsset} from './scene-blocking.js';

// Compare complete canonical identities. Tags, aliases, substrings and shared
// characters cannot broaden a search when a canonical name has no match.
export function exactAssetIdentity(asset){
 const role=candidateAssetRole(asset),meta=assetMetadata({...asset,libraryRole:role}),lib=asset.library||{},workName=lib.projectName||asset.projectName||'';
 const subject=canonicalSubjectName(lib.subjectName||asset.subjectName||meta.name,{workName});
 const state=canonicalVariantName(asset.libraryState??lib.canonicalVariantName??asset.canonicalVariantName??meta.state,{workName,subjectName:subject});
 const named=asset.libraryName||lib.canonicalName||asset.canonicalName||meta.name;
 const name=canonicalSubjectName(role==='scene'?sceneIdentityName(named,state):named,{workName});
 return {role,name,state,fullName:[subject,state].filter(Boolean).join('__'),blocking:isBlockingAsset(asset)};
}
export function exactAssetMatch(asset,query,{role,state='',purpose,blockingId,allTypes=false}={}){
 const text=String(query||'').trim();if(!text)return false;
 const meta=exactAssetIdentity(asset),q=assetNameKey(canonicalSubjectName(text,{workName:asset.library?.projectName||asset.projectName||''}));
 if(role&&!allTypes&&meta.role!==role)return false;
 const blocking=purpose==='blocking'||/站位(?:关系)?图/u.test(text);
 if((purpose||role==='scene'||meta.role==='scene')&&meta.blocking!==blocking)return false;
 if(blockingId&&asset.referenceGeneration?.blockingId&&asset.referenceGeneration.blockingId!==blockingId)return false;
 const parts=text.split(/__|[|｜]/u),explicitState=parts.length>1;
 if(![meta.name,meta.fullName].some(name=>assetNameKey(name)===q))return false;
 return explicitState||meta.role!=='character'||unknownState(state)||assetNameKey(meta.state)===assetNameKey(canonicalVariantName(state,{subjectName:meta.name}));
}
export const exactAssetCandidates=(items,query,options={})=>items.filter(item=>exactAssetMatch(item,query,options));

// A manually entered complete name can select another subject or variant;
// opening a requirement keeps its known costume and scene-image identity.
export function assetRequirementSearch(row,query=row.name,{allTypes=false}={}){
 const same=assetNameKey(query)===assetNameKey(row.name);
 return {role:row.role,purpose:row.purpose||'asset',state:same?row.state:'',blockingId:same?row.blockingId:undefined,allTypes};
}
