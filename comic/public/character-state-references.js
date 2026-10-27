import {assetUnavailable} from './asset-availability.js';
import {assetMetadata} from './asset-metadata.js';
import {parseNamedStates,stateKey,unknownState} from "./character-states.js";

/** Enrich image metadata from a confirmed production card, including imported existing images. */
export function stateReferenceMetadata(project,asset){
 const meta=assetMetadata(asset),ref=(project.references||[]).find(r=>r.assetId===asset.id),identity=(project.productionAssets||[]).find(a=>a.id===(asset.productionAssetId||ref?.sourceAssetId)||a.stages?.some(s=>s.confirmedAssetId===asset.id));
 const stage=identity?.stages?.find(s=>s.confirmedAssetId===asset.id&&s.status==='confirmed');
 if(stage){
  meta.name=identity.name;meta.aliases=[...new Set([...meta.aliases,...(identity.aliases||[])])];meta.keys=[identity.id,meta.name,...meta.aliases].map(stateKey);meta.role=['character','crowd'].includes(identity.type)?'character':meta.role;
  meta.identityOnly=['face','body','hands'].includes(stage.id);
  if(!meta.identityOnly){meta.state=stage.outfitDescription??identity.workflow?.outfitDescription??meta.state;meta.stateExplicit=true;meta.stateLabels=[meta.state,...(!/^(剧情角色卡|普通人物角色卡)/u.test(stage.label||'')?[stage.label]:[])].filter(Boolean);}
 }
 meta.stateLabels||=[meta.state,...(!meta.stateExplicit?[ref?.characterState]:[]),...(Array.isArray(asset.libraryStateAliases)?asset.libraryStateAliases:[])].filter(Boolean);return meta;
}
export function stateReferenceMatches(state,meta){
 return !unknownState(state)&&!meta.identityOnly&&[...meta.stateLabels,...(!meta.stateExplicit?(meta.parts||[]):[])].some(label=>stateKey(label)===stateKey(state));
}
/** A naming exception belongs to one need and one immutable image version, never a global alias. */
export function characterIdentityMatches(need,meta,asset){
 const stem=String(asset.name||'').replace(/\.(png|jpe?g|webp|avif)$/i,'');
 return !meta.identityOnly&&['character','other'].includes(meta.role)&&[meta.name,...(meta.aliases||[]),...stem.split(/[_\s·|]+/u)].some(n=>stateKey(n)===stateKey(need.name));
}
export function manualStateReferenceConfirmed(panel,need,asset,meta){
 const b=panel?.referenceNeedBindings?.[need.id],c=b?.manualStateConfirmation;
 return !!(need.role==='character'&&c?.version===1&&b.role===need.role&&b.assetId===asset.id&&stateKey(b.name)===stateKey(need.name)&&stateKey(b.state)===stateKey(need.state)&&b.revisionId===asset.library?.revisionId&&/^[a-f0-9]{64}$/.test(b.sha256||'')&&b.sha256===asset.library?.sha256&&stateKey(c.selectedState)===stateKey(meta.state)&&characterIdentityMatches(need,meta,asset)&&!['candidate','stale'].includes(asset.productionStatus)&&!assetUnavailable(asset));
}
export function characterReferenceIssues(project,shot,assets,ids,panel){
 const result=[],byId=new Map(assets.map(a=>[a.id,a])),entries=parseNamedStates(shot.characterStates).entries;
 for(const entry of entries){
  if(unknownState(entry.state)){result.push({kind:'STATE_UNKNOWN',name:entry.name,message:entry.name+'：服装/状态待确认'});continue;}
  const matches=(ids||[]).map(id=>byId.get(id)).filter(Boolean).map(asset=>({asset,meta:stateReferenceMetadata(project,asset)})).filter(({meta})=>meta.role==='character'&&(stateKey(meta.name)===stateKey(entry.name)||meta.aliases.some(alias=>stateKey(alias)===stateKey(entry.name))));
  const confirmed=({asset,meta})=>Object.entries(panel?.referenceNeedBindings||{}).some(([id,b])=>b.role==='character'&&stateKey(b.name)===stateKey(entry.name)&&stateKey(b.state)===stateKey(entry.state)&&manualStateReferenceConfirmed(panel,{id,role:'character',name:entry.name,state:entry.state},asset,meta));
  for(const match of matches)if(!match.meta.identityOnly&&match.meta.stateLabels.length&&!stateReferenceMatches(entry.state,match.meta)&&!confirmed(match))result.push({kind:'STATE_REFERENCE_CONFLICT',name:entry.name,message:entry.name+' 本格需要“'+entry.state+'”，所选参考却是“'+match.meta.state+'”'});
  if(!matches.some(match=>stateReferenceMatches(entry.state,match.meta)||confirmed(match)))result.push({kind:'STATE_REFERENCE_MISSING',name:entry.name,message:entry.name+'：尚未匹配到“'+entry.state+'”的服装参考；身份图不能当作该服装已确认'});
 }
 return result;
}
export function assertCharacterReferences(project,shot,assets,ids,panel){
 const conflicts=characterReferenceIssues(project,shot,assets,ids,panel).filter(issue=>issue.kind==='STATE_REFERENCE_CONFLICT');
 if(conflicts.length)throw Object.assign(Error(conflicts.map(issue=>issue.message).join('；')+'。请换成当前服装参考，或确认并修改本格角色状态。'),{status:409,code:'character_state_reference_conflict'});
}
