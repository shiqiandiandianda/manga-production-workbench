import {assetUnavailable} from './asset-availability.js';
import {assetNameKey} from "./asset-metadata.js";
import {panelReferenceIds,setPanelReferences} from './panel-references.js';
import {stateFor,stateKey,unknownState,parseNamedStates,sourceStateFields} from './character-states.js';
import {stateReferenceMetadata,stateReferenceMatches} from './character-state-references.js';
const copy=value=>structuredClone(value),normal=value=>String(value||'').normalize('NFKC').trim().toLowerCase();
const parts=value=>Array.isArray(value)?value:String(value||'').split(/[、，,；;\n]+/).map(s=>s.trim()).filter(Boolean);
const empty=value=>/^(?:无|暂无|没有|空镜|none|n\/a|—|-)?$/i.test(String(value??'').trim());
const roleFor=value=>({角色:'character',灵虫:'character',场景:'scene',道具:'prop',画风:'style',character:'character',scene:'scene',prop:'prop',style:'style'})[value]||'character';
export function assetNeeds(project){
 const identities=new Map(),needs=new Map(),panelNeeds=new Map();
 const add=(context,set,id,name,role,aliases=[],value)=>{
  if(!id||empty(name))return;
  const hasState=role==='character'&&value!==undefined,state=hasState?(stateFor(value,name,parts(aliases))||'未知（待确认）'):'',key=hasState?id+'@'+stateKey(state):id,old=identities.get(key);
  if(old&&(normal(old.name)!==normal(name)||old.role!==role)){old.conflict=true;return;}
  if(!old)identities.set(key,{id:key,baseAssetId:id,name,role,aliases:parts(aliases),hasState,state,shotCodes:[]});
  if(set)set.add(key);const target=identities.get(key);if(context?.code&&!target.shotCodes.includes(context.code))target.shotCodes.push(context.code);
 };
 
 const collect=(shot,set,valueOverride,visibleOverride)=>{const value=valueOverride!==undefined?valueOverride:sourceStateFields(shot).characterStates;if(shot){const names=Array.isArray(visibleOverride)?visibleOverride:parts(shot.participants||shot.sourceFields?.['出现角色']).length?parts(shot.participants||shot.sourceFields?.['出现角色']):parseNamedStates(value).entries.map(entry=>entry.name);for(const name of names)add(shot,set,'name:character:'+normal(name),name,'character',[],value);for(const scene of parts(shot.location||shot.sourceFields?.['当前场景']||shot.sceneId))add(shot,set,'name:scene:'+normal(scene),scene,'scene');for(const name of parts(shot.propNames||shot.props||shot.sourceFields?.['出现道具']||shot.storyboard?.clientFields?.['道具']))add(shot,set,'name:prop:'+normal(name),name,'prop');}else if(value!==undefined)for(const entry of parseNamedStates(value).entries)add(null,set,'name:character:'+normal(entry.name),entry.name,'character',[],value);};
 for(const shot of project.shots){const set=new Set();needs.set(shot.id,set);collect(shot,set);}
 for(const page of project.pages||[])for(const panel of page.panels||[]){if(panel.breakoutForeground||panel.sfxImage||panel.designDecoration)continue;const set=new Set(),shot=project.shots.find(s=>s.id===panel.shotId);collect(shot,set,panel.generation?.characterStates,panel.artDirection?.visibleCharacters??panel.generation?.artDirection?.visibleCharacters);panelNeeds.set(panel.id,set);}
 
 return {identities,needs,panelNeeds};
}
function candidateScore(identity,asset,project={}){
 if(assetUnavailable(asset))return null;
 const meta=stateReferenceMetadata(project,asset);if(meta.role!=='other'&&meta.role!==identity.role||identity.hasState&&meta.identityOnly)return null;
 const keys=[identity.baseAssetId||identity.id,identity.name,...identity.aliases].map(assetNameKey).filter(Boolean),name=assetNameKey(meta.name),legacy=String(asset.name||'').replace(/\.(png|jpe?g|webp)$/i,'').split(/[_\s·（）()\-|｜]+/).map(assetNameKey);
 if(keys.some(k=>meta.keys.some(key=>assetNameKey(key)===k)||identity.role!=='scene'&&legacy.includes(k))){
  if(identity.hasState){if(unknownState(identity.state))return {asset,meta,score:40,reason:'本格服装/状态待确认，不按人物同名自动套图'};
   if(stateReferenceMatches(identity.state,meta))return {asset,meta,score:100,reason:'人物身份与本格服装/状态一致'};
   return {asset,meta,score:40,reason:meta.state?'同名人物的参考状态“'+meta.state+'”与本格“'+identity.state+'”不符':'人物名称一致，参考尚未标注本格服装/状态'};
  }
  if(identity.role==='scene'&&meta.kind==='细节')return {asset,meta,score:90,reason:'场景细节参考，请确认所需角度；主景优先'};
  return {asset,meta,score:100,reason:meta.state?'名称一致，请确认人物或道具状态':'名称一致'};
 }
 const withoutFloor=value=>value.replace(/第?[一二三四五六七八九十百\d]+层/gu,'');
 if(identity.role==='scene'&&keys.some(k=>withoutFloor(k).length>=3&&withoutFloor(k)===withoutFloor(name)))return {asset,meta,score:90,reason:'场所与用途一致，请核对楼层'};
 if(identity.role==='scene'&&keys.some(k=>k.length>=3&&name.length>=3&&(name.includes(k)||k.includes(name))))return {asset,meta,score:80,reason:'场景名称相近，请核对楼层、区域和用途'};
 if(identity.role==='scene'&&meta.parts.some(p=>assetNameKey(p).length>=3&&keys.some(k=>k.includes(assetNameKey(p)))))return {asset,meta,score:55,reason:'地点用语相近，需要看图确认'};
 return null;
}
/** Match separately for each identity + declared state; review does not modify project data. */
export function inspectAssetBindings(project,assets,{choices={}}={}){
 const {identities,needs,panelNeeds}=assetNeeds(project),byId=new Map(assets.map(a=>[a.id,a])),nameOwners=new Map();
 
 const rows=[...identities.values()].map(identity=>{
  const ranked=assets.map(asset=>candidateScore(identity,asset,project)).filter(Boolean).sort((a,b)=>b.score-a.score||a.meta.file.localeCompare(b.meta.file,'zh-CN',{numeric:true})),exact=ranked.filter(c=>c.score===100),explicit=Object.hasOwn(choices,identity.id);
  const compatible=(id,binding)=>{const image=byId.get(id);if(!image||['candidate','stale'].includes(image.productionStatus))return false;if(!identity.hasState)return true;const meta=stateReferenceMetadata(project,image);return stateReferenceMatches(identity.state,meta)||!unknownState(identity.state)&&!meta.stateLabels.length&&binding?.source==='manual'&&stateKey(binding.state)===stateKey(identity.state);};
  const fixed=(project.references||[]).filter(r=>r.sourceAssetId===identity.baseAssetId&&compatible(r.assetId,r)),saved=project.assetBindings?.[identity.id]||(!identity.hasState?Object.values(project.assetBindings||{}).find(b=>b.role===identity.role&&b.names?.some(n=>assetNameKey(n)===assetNameKey(identity.name))):null);
  let assetId=explicit?choices[identity.id]:saved&&compatible(saved.assetId,saved)?saved.assetId:fixed.length===1?fixed[0].assetId:null,source=explicit?'manual':assetId?'saved':'auto';
  const ambiguous=[identity.baseAssetId,identity.name,...identity.aliases].some(name=>(nameOwners.get(identity.role+':'+assetNameKey(name))?.size||0)>1);
  if(!assetId&&!explicit&&!ambiguous&&exact.length===1&&(!exact[0].meta.state||identity.hasState&&!unknownState(identity.state)))assetId=exact[0].asset.id;
  if(explicit&&assetId&&!byId.has(assetId))throw Error('所选资产已不存在，请重新选择');
  if(explicit&&assetId&&identity.hasState&&!unknownState(identity.state)){const meta=stateReferenceMetadata(project,byId.get(assetId));if(meta.stateLabels.length&&!meta.identityOnly&&!stateReferenceMatches(identity.state,meta))throw Error(identity.name+' 需要“'+identity.state+'”，所选参考是“'+meta.state+'”，请确认本格状态后重新选择');}
  const conflict=identity.conflict||fixed.length>1||ambiguous;if(conflict&&!explicit)assetId=null;
  const reason=assetId?(source==='saved'?'复用当前人物与状态的已确认绑定':source==='manual'?'已看图选择，等待应用':identity.hasState?'人物与服装/状态一致，等待应用':'名称一致，等待应用'):explicit?'本次跳过，素材仍保留在库中':conflict?'同身份同状态有多张图片或已有绑定冲突，请看图确认':identity.hasState&&unknownState(identity.state)?'本格服装/状态待确认，不自动借用其他状态':exact.length>1?'同一人物与状态有多张图片，请选择当前版本':ranked.length?ranked[0].reason:'没有当前人物与状态的对应图片，可补角色卡或手动登记';
  return {...identity,candidates:ranked.map(c=>c.asset),candidateDetails:ranked,assetId,source,status:assetId?'matched':explicit?'skipped':conflict?'conflict':ranked.length?'review':'missing',reason};
 });
 return {needs:rows,shotNeeds:needs,panelNeeds,matched:rows.filter(r=>r.assetId).length,review:rows.filter(r=>['review','conflict'].includes(r.status)).length,missing:rows.filter(r=>r.status==='missing').length};
}
export function planAssetBindings(input,assets,{choices={},replaceManual=false,sourceShotIds,sourcePageIds,libraryOnly=false}={}){
 const project=copy(input),shotScope=sourceShotIds&&new Set(sourceShotIds),pageScope=sourcePageIds&&new Set(sourcePageIds),scoped={...project,shots:project.shots.filter(shot=>!shotScope||shotScope.has(shot.id)),pages:project.pages.filter(page=>!pageScope||pageScope.has(page.id))},preview=inspectAssetBindings(scoped,assets,{choices}),byId=new Map(assets.map(a=>[a.id,a])),bound=new Map(preview.needs.filter(n=>n.assetId).map(n=>[n.id,n.assetId])),originalPanelIds=new Map(input.pages.flatMap(p=>p.panels.map(f=>[f.id,panelReferenceIds(input,f)]))),identities=new Map(preview.needs.map(n=>[n.id,n]));
 project.assetBindings||={};let added=0,manualShotsPreserved=0,panelsSynced=0,manualPanelsPreserved=0,lockedPanels=0,shotsComplete=0;
 for(const need of preview.needs){if(!need.assetId)continue;const selected=byId.get(need.assetId),meta=stateReferenceMetadata(project,selected);let ref=project.references.find(r=>r.assetId===selected.id);
  if(!ref&&!libraryOnly){ref={assetId:selected.id,name:need.name,role:need.role,sourceAssetId:need.baseAssetId,...(need.hasState?{characterState:need.state}:{})};project.references.push(ref);added++;}else if(ref&&!ref.sourceAssetId){ref.sourceAssetId=need.baseAssetId;ref.name=need.name;ref.role=need.role;}
  project.assetBindings[need.id]={assetId:selected.id,name:need.name,role:need.role,names:[...new Set([need.name,...need.aliases,meta.name])],state:need.hasState?need.state:meta.state,source:need.source==='manual'?'manual':project.assetBindings[need.id]?.source||'auto'};
 }
 for(const need of preview.needs.filter(n=>n.status==='skipped')){const prior=project.assetBindings[need.id]?.assetId;if(prior&&byId.has(prior)&&(!need.hasState||stateReferenceMatches(need.state,stateReferenceMetadata(project,byId.get(prior)))))bound.set(need.id,prior);}
 for(const shot of project.shots){
  if(shotScope&&!shotScope.has(shot.id))continue;
  const required=[...(preview.shotNeeds.get(shot.id)||[])],desired=[...new Set(required.map(id=>bound.get(id)).filter(Boolean))],old=shot.assetAutoBinding?.managedIds||(shot.assetAutoBinding?input.references.filter(r=>shot.assetAutoBinding.sourceAssetIds?.includes(r.sourceAssetId)).map(r=>r.assetId):[]);
  if(shot.referenceIds?.length&&!shot.assetAutoBinding)manualShotsPreserved++;
  shot.referenceIds=[...new Set([...(shot.referenceIds||[]).filter(id=>!old.includes(id)),...desired])];if(shot.referenceIds.length>10)throw Error('镜头 '+shot.code+' 的参考超过10张，请减少补充参考');
  shot.assetAutoBinding={version:3,sourceAssetIds:[...new Set(required.map(id=>identities.get(id)?.baseAssetId).filter(Boolean))],requirementIds:required,managedIds:desired,reviewRequired:required.some(id=>!bound.has(id))};if(required.length&&!shot.assetAutoBinding.reviewRequired)shotsComplete++;
 }
 for(const page of project.pages)for(const panel of page.panels){
  if(pageScope&&!pageScope.has(page.id))continue;
  const required=preview.panelNeeds.get(panel.id);if(!required)continue;if(panel.locked||page.locked){lockedPanels++;continue;}
  const current=originalPanelIds.get(panel.id)||[],record=panel.assetReferenceBinding,manualPanel=record?.mode==='manual'||!record&&current.length>0;
  if(manualPanel&&!replaceManual){manualPanelsPreserved++;continue;}
  const desired=[...new Set([...required].map(id=>bound.get(id)).filter(Boolean))],retained=manualPanel&&replaceManual?[]:current.filter(id=>!(record?.managedIds||[]).includes(id)),ids=[...new Set([...retained,...desired])];
  setPanelReferences(panel,ids,{project,assets,source:'asset-import'});panel.assetReferenceBinding={mode:'auto',managedIds:desired,sourceAssetIds:[...new Set([...required].map(id=>identities.get(id)?.baseAssetId).filter(Boolean))],requirementIds:[...required],reviewRequired:[...required].some(id=>!bound.has(id))};panelsSynced++;
 }
 const requiredIds=new Set([...bound.values(),...project.shots.flatMap(s=>s.referenceIds),...project.pages.flatMap(p=>p.panels.flatMap(f=>panelReferenceIds(project,f)))]);
 project.references=project.references.filter(r=>!r.sourceAssetId||requiredIds.has(r.assetId));if(project.references.length>60)throw Error('本话参考超过60张；素材已入库，请先移除不用的本话参考');
 const issues=preview.needs.filter(n=>!n.assetId).map(n=>({...n}));
 return {project,needs:preview.needs,issues,changed:JSON.stringify(project)!==JSON.stringify(input),identified:bound.size,added,shotsBound:project.shots.filter(s=>(!shotScope||shotScope.has(s.id))&&s.referenceIds.length).length,shotsComplete,panelsSynced,manualShotsPreserved,manualPanelsPreserved,lockedPanels,summary:`已确认 ${bound.size} / ${preview.needs.length} 项人物与状态资产；${shotsComplete} 个镜头参考齐全，已同步 ${panelsSynced} 个实际画格；保留 ${manualPanelsPreserved} 个手动参考画格${lockedPanels?'，跳过 '+lockedPanels+' 个锁定画格':''}；剩余 ${issues.length} 项可稍后补齐。`};
}
export function automaticAssetBindingChoices(project,assets,{choices={}}={}){
 const preview=inspectAssetBindings(project,assets,{choices}),next={...choices};
 for(const need of preview.needs){if(Object.hasOwn(next,need.id)||need.assetId||need.status==='conflict'||need.hasState&&unknownState(need.state))continue;const exact=need.candidateDetails.filter(c=>c.score===100);if(exact.length===1)next[need.id]=exact[0].asset.id;}
 return {choices:next,preview:inspectAssetBindings(project,assets,{choices:next})};
}

/** Uploaded materials attach to asset identities as design references, never as
 * approved face/body/hand stage results. This also works before any panels exist. */
export function inspectProductionAssetReferences(project,assets){
 const catalog=project.productionAssets||[],owners=new Map(),role=a=>a.type==='crowd'?'character':['character','scene','prop','style'].includes(a.type)?a.type:'other';
 for(const identity of catalog)for(const name of [identity.name,...parts(identity.aliases)]){const k=role(identity)+':'+assetNameKey(name);if(!owners.has(k))owners.set(k,new Set());owners.get(k).add(identity.id);}
 const uploaded=assets.filter(a=>!['candidate','stale'].includes(a.productionStatus)&&!a.productionAssetId&&!a.productionStageId);
 const rows=catalog.map(identity=>{
  const r=role(identity),keys=[identity.name,...parts(identity.aliases)].map(assetNameKey),manualIds=[...new Set([...(identity.workflow?.extraReferenceIds||[]),...(identity.stages||[]).filter(s=>s.status==='confirmed'&&s.confirmedAssetId).map(s=>s.confirmedAssetId),...(project.references||[]).filter(ref=>ref.sourceAssetId===identity.id||ref.role===r&&keys.includes(assetNameKey(ref.name))).map(ref=>ref.assetId)])];
  const ranked=uploaded.map(a=>candidateScore({id:identity.id,name:identity.name,aliases:parts(identity.aliases),role:r},a)).filter(Boolean).sort((a,b)=>b.score-a.score||a.meta.file.localeCompare(b.meta.file,'zh-CN',{numeric:true})),exact=ranked.filter(c=>c.score===100),ambiguous=keys.some(k=>(owners.get(r+':'+k)?.size||0)>1);
  let status,assetId=null,reason;if(manualIds.length){status='preserved';reason='保留已有人工或素材参考';}else if(ambiguous){status='review';reason='名称或别名对应多个拆解资产，需要人工确认';}else if(exact.length===1){status='matched';assetId=exact[0].asset.id;reason='唯一名称或别名匹配，仅登记为上传素材参考';}else if(ranked.length){status='review';reason=exact.length>1?'同名有多张或多状态素材，请看图选择':'名称或场景区域相近，需要确认';}else{status='missing';reason='尚未找到名称匹配的上传素材';}
  return {id:identity.id,name:identity.name,role:r,status,assetId,existingReferenceIds:manualIds,candidates:ranked.map(c=>c.asset),candidateDetails:ranked,reason};
 });
 const counts={matched:rows.filter(r=>r.status==='matched').length,preserved:rows.filter(r=>r.status==='preserved').length,review:rows.filter(r=>r.status==='review').length,missing:rows.filter(r=>r.status==='missing').length};
 return {rows,...counts,actions:rows.filter(r=>r.status==='matched').map(r=>({assetId:r.id,extraReferenceIds:[r.assetId]})),summary:`上传素材参考：唯一匹配 ${counts.matched} 项，保留已有参考 ${counts.preserved} 项，需确认 ${counts.review} 项，缺素材 ${counts.missing} 项。基础图与正式角色卡仍需按步骤看图确认。`};
}
