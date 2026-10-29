import {assetNameKey} from '../public/asset-metadata.js';
import {characterRole} from '../public/character-role.js';
/** Delivery hints only: preserve original selections, order and content stamps. */
export function referencePackingRoles(roles,{project={},assets=[],panelId}={}){
 const byId=new Map(assets.map(a=>[a.id,a]));
 return roles.map(ref=>{
  const asset=byId.get(ref.assetId)||{},name=ref.name||asset.libraryName||asset.name||'',key=assetNameKey(name);
  const binding=Object.values(project.assetBindings||{}).find(b=>b.assetId===ref.assetId)||{};
  const settings=Object.entries(project.assetWorkspaceSettings||{}).find(([k])=>{try{const parts=JSON.parse(k);return parts[0]===ref.role&&parts[1]===key;}catch{return false;}})?.[1]||{};
  const panel=panelId&&project.pages?.flatMap(p=>p.panels).find(p=>p.id===panelId);
  const raw=panel?.generation?.referencePacking?.assets?.[ref.assetId],hint={};
  if(raw?.keepSeparate===true)hint.keepSeparate=true;
  if(['auto','lead','background'].includes(raw?.characterRole))hint.characterRole=raw.characterRole;
  if(['minor','major'].includes(raw?.importance))hint.importance=raw.importance;
  const records=[hint,ref,settings,binding,asset,asset.library||{}];
  const get=(...keys)=>{for(const r of records)for(const k of keys)if(r[k]!==undefined&&r[k]!==null&&r[k]!=='')return r[k];};
  const explicit=get('characterRole'),tier=explicit&&explicit!=='auto'?explicit:characterRole({...asset,name});
  return {...ref,characterRole:tier,faction:String(get('faction','camp','阵营')||'').slice(0,100),importance:get('importance','priority','重要性'),keepSeparate:get('keepSeparate')===true||ref.role==='continuity'||/^(接续|前段成图|已确认背景主图)/u.test(name)};
 });
}
