import {assetNameKey} from './asset-metadata.js';
import {assetUnavailable} from './asset-availability.js';
import {withRemovedReference,removedReferenceIds} from './asset-workspace-removal.js';
const text=v=>typeof v==='string'?v.trim():'';
export const blockingSceneName=value=>text(value).replace(/[·\s_]*(?:人物)?站位(?:关系)?图$/u,'').trim();
const original=ref=>({...ref?.sourceReference,...ref});
export function isBlockingReference(value){const r=original(value);return !!(r.purpose==='blocking'||r['站位计划编号']||/站位图|人物站位/u.test([r['用途'],r['变体'],r['名称'],r['说明']].filter(Boolean).join(' '))||/待绑定-B\d{3}-\d+/u.test(String(r.slot||'')));}
export function isBlockingAsset(value){return !!(value?.purpose==='blocking'||value?.source?.purpose==='blocking'||value?.referenceGeneration?.purpose==='blocking'||/站位(?:关系)?图/u.test(value?.name||value?.libraryName||''));}
const planId=ref=>{const r=original(ref);return r['站位计划编号']||r.blockingPlanId||/B\d{3}-\d+/u.exec(String(r.slot||'')+' '+text(r['说明']))?.[0];};
export const sourceAssetId=ref=>{const r=original(ref);return String(r['源资产编号']||r.assetSourceId||r['内部需求编号']||String(r.slot||'').replace(/^待绑定-/u,''));};
const list=v=>(Array.isArray(v)?v:String(v||'').split(/[、，,；;\n]+/u)).map(text).filter(v=>v&&!/^(?:无|空镜|未知|—|-)$/u.test(v));

/** A stance belongs to the chosen scene image, independently of shot order or scene wording. */
function scenePicture(project,panel,scene,context){
 const segment=project.productionPackage?.episodes.flatMap(e=>e.segments).find(s=>s.id===panel?.productionSegment),choices=[];
 const add=(binding,name)=>{if(!binding?.assetId)return;if(name&&assetNameKey(blockingSceneName(name))!==assetNameKey(scene))return;const a=context?.byId?.get(binding.assetId);if(isBlockingAsset(a))return;const fingerprint=binding.sha256||binding.revisionId||binding.assetId;choices.push({...binding,pictureKey:'scene-image:'+fingerprint});};
 const sceneRefs=(segment?.references||[]).filter(r=>!isBlockingReference(r)&&/场景/u.test(r['类型']||''));
 for(const ref of sceneRefs){const r=original(ref);add(r.binding,sceneRefs.length===1?'':r['场景']||r['名称']||r['场景图']);}
 for(const b of Object.values(panel?.referenceNeedBindings||{}))if(b.role==='scene'&&b.purpose!=='blocking'&&!/站位图/u.test(b.name||''))add(b,b.name);
 if(!choices.length)for(const r of panel?.generation?.referenceRoles||project.references||[])if(r.role==='scene'&&!/站位图/u.test(r.name||'')&&(panel.referenceIds||[]).includes(r.assetId))add({assetId:r.assetId},'');
 const unique=[...new Map(choices.map(b=>[b.pictureKey,b])).values()];return unique.length===1?unique[0]:null;
}
export function sceneBlockingGroups(project,context){
 if(context?.sceneBlockingGroups)return context.sceneBlockingGroups;
 const groups=[],byImage=new Map(),plans=project.productionPackage?.blockingPlans||[],frames=project.pages.flatMap(p=>p.panels);
 const append=(episode,scene,record,panel,segmentId)=>{const picture=scenePicture(project,panel,scene,context),id=picture?.pictureKey||'pending-scene:'+assetNameKey(scene);let group=byImage.get(id);
  if(!group){group={id,episode,scene,sceneBinding:picture,sceneReady:!!picture,records:[],segmentIds:[],panelIds:[],planIds:[]};byImage.set(id,group);groups.push(group);}
  group.records.push(record);if(segmentId&&!group.segmentIds.includes(segmentId))group.segmentIds.push(segmentId);if(panel&&!group.panelIds.includes(panel.id))group.panelIds.push(panel.id);
 };
 for(const episode of project.productionPackage?.episodes||[])for(const record of episode.panelRecords||[]){const raw={...record.production,...record.original},scene=blockingSceneName(raw['当前场景']);if(!scene)continue;append(episode.episode,scene,record,frames.find(p=>p.productionSegment===record.segmentId),record.segmentId);}
 if(!project.productionPackage)for(const page of project.pages||[])for(const panel of page.panels||[]){if(panel.cutoutLayer||panel.sfxImage||panel.designDecoration)continue;const shot=project.shots.find(s=>s.id===panel.shotId);if(!shot)continue;const scene=blockingSceneName(shot.location||shot.sourceFields?.['当前场景']);if(!scene)continue;append(shot.episode||page.storyboard?.episode||1,scene,{id:shot.code||shot.id,original:{...shot.sourceFields,'画面内容':shot.sourceFields?.['画面内容']||shot.description,'出现角色':shot.participants,'出现道具':shot.propNames||shot.props||shot.sourceFields?.['出现道具'],'服装':{},'当前场景':scene},source:shot.source,shot},panel);}
 for(const group of groups){const ids=new Set(group.records.map(r=>r.id)),related=plans.filter(p=>(p.appliesTo||[]).some(id=>ids.has(id)));related.sort((a,b)=>Math.min(...a.appliesTo.map(id=>group.records.findIndex(r=>r.id===id)).filter(n=>n>=0))-Math.min(...b.appliesTo.map(id=>group.records.findIndex(r=>r.id===id)).filter(n=>n>=0)));group.planIds=related.map(p=>p.id);group.plan=related[0]||null;
  const first=group.records.find(r=>list(r.original?.['出现角色']).length)||group.records[0],raw={...first?.production,...first?.original};group.initialDescription=group.plan?.prompt||text(raw['画面内容']);group.characters=(list(raw['出现角色']).length?list(raw['出现角色']):Object.keys(raw['服装']||{})).map(name=>({name,state:text(raw['服装']?.[name])}));
  const references=[...group.records.flatMap(r=>r.production?.referenceRequirements||[]),...(project.productionPackage?.episodes||[]).flatMap(e=>e.segments.filter(s=>group.segmentIds.includes(s.id)).flatMap(s=>s.references))];
  group.references=(group.plan?.referenceIds||[]).map(id=>references.find(r=>sourceAssetId(r)===String(id)&&!isBlockingReference(r))).filter(Boolean).map(ref=>{const r=original(ref),role=r.role||(r['类型']==='设定卡'?'character':/场景/u.test(r['类型'])?'scene':'prop');return {role,name:r['人物']||r['场景图']||r['道具']||r['名称']||r['场景'],state:text(r['服装']),sourceId:sourceAssetId(ref)};});
  if(group.references.length){const people=group.references.filter(r=>r.role==='character');if(people.length)group.characters=people.map(({name,state})=>({name,state}));}
  for(const ref of group.references)if(ref.role==='scene'){ref.name=group.scene;ref.assetId=group.sceneBinding?.assetId;}
  if(!group.references.some(r=>r.role==='scene'))group.references.push({role:'scene',name:group.scene,state:'',assetId:group.sceneBinding?.assetId});
  if(!group.plan)group.references.push(...list(raw['出现道具']).map(name=>({role:'prop',name,state:''})));
  if(!group.references.some(r=>r.role==='character'))group.references.unshift(...group.characters.map(p=>({...p,role:'character'})));
 }
 if(context)context.sceneBlockingGroups=groups;return groups;
}
export function blockingGroupsForPanel(project,panel,context){const segmentId=panel.productionSegment||panel.productionGrid?.segmentId||panel.panelSlice?.segmentId,sourceId=panel.productionGrid?.panelId||panel.panelSlice?.panelId;return sceneBlockingGroups(project,context).filter(g=>segmentId?g.segmentIds.includes(segmentId)&&(!sourceId||g.records.some(r=>r.id===sourceId)):g.panelIds?.includes(panel.id));}
export function withBlockingIdentity(project,panel,need,ref,context){
 if(!isBlockingReference(ref))return need;const id=planId(ref),groups=blockingGroupsForPanel(project,panel,context),raw=original(ref),scene=blockingSceneName(raw['场景']||raw['名称']||need.name),group=groups.find(g=>g.planIds.includes(id))||groups.find(g=>assetNameKey(g.scene)===assetNameKey(scene))||(groups.length===1?groups[0]:null);
 const binding=ref.binding||group?.sceneReady&&sharedBlockingBinding(project,group,context),selected=binding&&context?.byId?.get(binding.assetId),stale=binding?.blockingId&&binding.blockingId!==group?.id||selected?.referenceGeneration?.blockingId&&selected.referenceGeneration.blockingId!==group?.id;
 const inherited=!ref.binding&&selected&&!assetUnavailable(selected)&&(!binding.sha256||selected.library?.sha256===binding.sha256)&&(!binding.revisionId||selected.library?.revisionId===binding.revisionId);
 return {...need,...(inherited?{selectedIds:[selected.id],status:'ready',blocking:false}:{}),...(stale?{selectedIds:[],conflictingIds:[binding.assetId],status:'conflict',blocking:true,reason:'场景参考图已更换，请为当前图片重新生成或选用站位图'}:{}),purpose:'blocking',sceneName:group?.scene||scene,name:(group?.scene||scene)+'·人物站位图',state:'正俯视 · 姓名标注',blockingReady:!!group?.sceneReady,blockingId:group?.id||id||scene,blockingPlanId:group?.plan?.id||id||'',blockingContext:group,blockingBinding:binding||null};
}
function sharedBlockingBinding(project,group,context){
 const choices=[];for(const page of project.pages)for(const panel of page.panels){
  const direct=panel.referenceNeedBindings?.['blocking:'+group.id];if(direct)choices.push(direct);
  if(!group.segmentIds.includes(panel.productionSegment))continue;
  const segment=project.productionPackage?.episodes.flatMap(e=>e.segments).find(s=>s.id===panel.productionSegment);
  for(const ref of segment?.references||[])if(isBlockingReference(ref)&&ref.binding&&(group.planIds.includes(planId(ref))||assetNameKey(blockingSceneName(original(ref)['场景']||original(ref)['名称']))===assetNameKey(group.scene)))choices.push(ref.binding);
 }
 const valid=choices.filter(b=>{const a=context?.byId?.get(b.assetId);return (!b.blockingId||b.blockingId===group.id)&&(!a?.referenceGeneration?.blockingId||a.referenceGeneration.blockingId===group.id);});
 return valid.length&&new Set(valid.map(b=>b.assetId)).size===1?valid[0]:null;
}
function inheritedBlockingBinding(project,panel,group){
 const source=panel.productionGrid||panel.panelSlice;if(!source)return null;
 const parent=project.pages.flatMap(p=>p.panels).find(f=>f.productionSegment===source.segmentId),segment=project.productionPackage?.episodes.flatMap(e=>e.segments).find(s=>s.id===source.segmentId);if(!parent)return null;
 const direct=parent.referenceNeedBindings?.['blocking:'+group.id];if(direct)return direct;
 const choices=(segment?.references||[]).filter(r=>isBlockingReference(r)&&r.binding?.assetId&&withBlockingIdentity(project,parent,{name:group.scene},r).blockingId===group.id).map(r=>r.binding);
 return choices.length&&new Set(choices.map(b=>b.assetId)).size===1?choices[0]:null;
}
export function inheritedBlockingReferenceIds(project,panel){if(!panel.productionGrid&&!panel.panelSlice)return [];return blockingGroupsForPanel(project,panel).flatMap(group=>{const id='blocking:'+group.id;if(panel.referenceNeedBindings?.[id])return [];const b=inheritedBlockingBinding(project,panel,group);return b&&!removedReferenceIds(project,panel.id,id).includes(b.assetId)?[b.assetId]:[];});}
export function sceneBlockingExtraNeeds(project,panel,assets,context){
 if(panel.productionBackground||panel.cutoutLayer||panel.sfxImage||panel.designDecoration)return [];
 const segment=(project.productionPackage?.episodes||[]).flatMap(e=>e.segments).find(s=>s.id===panel.productionSegment);
 return blockingGroupsForPanel(project,panel,context).filter(group=>group.sceneReady&&!segment?.references.some(r=>isBlockingReference(r)&&(group.planIds.includes(planId(r))||assetNameKey(blockingSceneName(original(r)['场景']||original(r)['名称']))===assetNameKey(group.scene)))).map(group=>{
  const id='blocking:'+group.id,b=panel.referenceNeedBindings?.[id]||inheritedBlockingBinding(project,panel,group)||sharedBlockingBinding(project,group,context),asset=assets.find(a=>a.id===b?.assetId),bad=asset&&(assetUnavailable(asset)||b.revisionId&&asset.library?.revisionId!==b.revisionId||b.sha256&&asset.library?.sha256!==b.sha256||asset.referenceGeneration?.blockingId&&asset.referenceGeneration.blockingId!==group.id);
  return withRemovedReference(project,panel,{id,slot:id,name:group.scene+'·人物站位图',sceneName:group.scene,purpose:'blocking',blockingReady:true,blockingId:group.id,blockingPlanId:group.plan?.id||'',blockingContext:group,role:'scene',state:'正俯视 · 姓名标注',supplemental:true,blockingSupplement:true,optional:true,required:false,selectedIds:asset&&!bad?[asset.id]:[],conflictingIds:bad?[asset.id]:[],recommendedId:null,candidates:[],status:bad?'conflict':asset?'ready':'missing',blocking:!!bad,reason:'同一张场景参考图共用一张正俯视、带姓名的人物站位图'});
 });
}
export function blockingExtraReferenceRoles(project,panel,assets){return sceneBlockingExtraNeeds(project,panel,assets).flatMap(need=>{if(need.status==='conflict')throw Error('站位图固定版本已变化，请重新采用：'+need.name);return need.selectedIds.map(assetId=>({assetId,name:need.name+'（只参考空间，姓名标注不绘入漫画）',role:'scene',purpose:'blocking'}));});}
