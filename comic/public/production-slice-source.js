import {assetUnavailable} from './asset-availability.js';
import {stateReferenceMetadata,stateReferenceMatches,manualStateReferenceConfirmed,characterIdentityMatches} from './character-state-references.js';
import {removedReferenceIds} from './asset-workspace-removal.js';
import {textAssetBinding} from './asset-text-references.js';
import {WORKSPACE_REFERENCE_LIMIT} from './panel-references.js';
import {productionReferenceOutfit} from './episode-outfit.js';
import {id,clone} from './model.js';
import {inspectAssetBindings} from './asset-auto-bind.js';
import {projectLibraryAssets} from './project-asset-library.js';
import {stateKey} from './character-states.js';
import {productionPanelPromptFields,productionPanelPrompts} from './production-panel-prompts.js';
import {SHOT_SIZES,CAMERA_ANGLES,normalizeCameraAngle} from './shot-settings.js';
import {migrateLegacyPanelPrompt} from './prompt-source.js';
const gridSource=panel=>panel.productionGrid||panel.panelSlice;
const list=value=>(Array.isArray(value)?value:String(value||'').split(/[、，,；;\n]+/u)).map(v=>String(v).trim()).filter(v=>v&&!/^(无|空镜|暂无|—|-)$/u.test(v));
const outfitKey=value=>stateKey(String(value||'').replace(/[（(][^）)]*[）)]/gu,''));
export function sliceSourceRecord(project,panel){const source=gridSource(panel);return project.productionPackage?.episodes.flatMap(e=>e.panelRecords).find(r=>r.id===source?.panelId&&r.segmentId===source?.segmentId);}
function sourceShot(project,panel,record){
 const raw=record.original||{},fields={...clone(record.production||{}),...clone(raw)};for(const [key,value] of Object.entries(fields))if(Array.isArray(value))fields[key]=value.map(v=>typeof v==='string'?v:JSON.stringify(v)).join('、');
 const states=raw['服装'];if(states&&typeof states==='object'&&!fields['角色状态（服装/形态）'])fields['角色状态（服装/形态）']=Object.entries(states).map(([n,s])=>n+':'+s).join('；');
 const variants=panel.productionGrid?productionPanelPrompts(record):null,prompt=String(raw['生图提示词']||record.production?.['生图提示词']||variants?.empty.text||variants?.clean.text||'');fields['生图提示词']=prompt;
 if(variants)Object.assign(fields,productionPanelPromptFields(record));
 const episode=project.productionPackage.episodes.find(e=>e.panelRecords.some(r=>r.id===record.id));
 const shotSizeRaw=String(raw['景别']||fields['景别']||''),cameraAngleRaw=String(raw['机位角度']||fields['机位角度']||''),cameraAngle=normalizeCameraAngle(cameraAngleRaw);
 // Freeform source directions stay verbatim in the prompt and provenance; only recognized choices populate inspector enums.
 return {id:id('shot'),episode:episode.episode,code:record.id,title:record.id,description:String(raw['画面内容']||fields['画面内容']||''),productionPrompt:prompt,...(variants?{productionPromptVariants:1}:{}),participants:list(raw['出现角色']||fields['出现角色']),location:String(raw['当前场景']||fields['当前场景']||''),propNames:list(raw['出现道具']||fields['出现道具']),shotSize:SHOT_SIZES.includes(shotSizeRaw)?shotSizeRaw:'',shotSizeRaw,cameraAngle:CAMERA_ANGLES.includes(cameraAngle)?cameraAngle:'',cameraAngleRaw,dialogue:'',referenceIds:[],sourceFields:fields,sourceLocation:[record.source?.file,record.source?.pointer].filter(Boolean).join(' '),productionSourceRecord:clone(record.source),productionGridId:record.id,productionSliceSegment:record.segmentId};
}
/** Carry a user's fixed-version choice across screen/grid need IDs, only for
 * the same source character and outfit. Never turn an image label into an alias. */
export function inheritedSliceReferenceBinding(project,panel,need,asset){
 const source=gridSource(panel);if(!source||need.role!=='character'||!asset||assetUnavailable(asset))return null;
 const record=sliceSourceRecord(project,panel),segment=project.productionPackage?.episodes.flatMap(e=>e.segments).find(s=>s.id===source.segmentId),parent=project.pages.flatMap(p=>p.panels).find(p=>p.id===source.rootPanelId);
 if(!record||!segment||parent?.productionSegment!==segment.id||!parent.referenceIds?.includes(asset.id))return null;
 for(const ref of segment.references){
  if(ref.skipped||ref['类型']!=='设定卡'||ref.binding?.assetId!==asset.id||stateKey(ref['人物'])!==stateKey(need.name))continue;
  const state=productionReferenceOutfit(project,ref),outfit=need.state||record.original?.['服装']?.[need.name];
  if(!outfitKey(outfit)||outfitKey(outfit)!==outfitKey(state))continue;
  if(ref.binding.revisionId&&ref.binding.revisionId!==asset.library?.revisionId||ref.binding.sha256&&ref.binding.sha256!==asset.library?.sha256)continue;
  const sourceNeed={id:segment.id+'@'+ref.slot,role:'character',name:ref['人物'],state};
  if(!manualStateReferenceConfirmed(parent,sourceNeed,asset,stateReferenceMetadata(project,asset)))continue;
  return {...clone(parent.referenceNeedBindings[sourceNeed.id]),name:need.name,state:need.state||outfit,role:need.role,inheritedFrom:{version:1,segmentId:segment.id,slot:ref.slot}};
 }
 return null;
}
/** A confirmed screen binding can be reused only for the same named subject and outfit. */
export function confirmedSliceReference(project,panel,need,asset){
 const source=gridSource(panel);if(!source||!asset||assetUnavailable(asset))return false;
 if(inheritedSliceReferenceBinding(project,panel,need,asset))return true;
 const record=sliceSourceRecord(project,panel),segment=project.productionPackage?.episodes.flatMap(e=>e.segments).find(s=>s.id===source.segmentId);if(!record||!segment)return false;
 const parent=project.pages.flatMap(p=>p.panels).find(f=>f.id===source.rootPanelId);if(need.role!=='character'&&parent?.referenceIds?.includes(asset.id)){const ref=parent.generation?.referenceRoles?.find(r=>r.assetId===asset.id),meta=stateReferenceMetadata(project,asset),role=ref?.role||meta.role,expected=outfitKey(need.name),keys=[ref?.name,meta.name,...meta.aliases,...meta.parts].map(outfitKey).filter(Boolean);if(role===need.role&&keys.some(k=>k.length>=2&&(k===expected||k.length>=3&&expected.includes(k))))return true;}
 return segment.references.some(ref=>{if(ref.skipped||ref.binding?.assetId!==asset.id)return false;if(need.role==='character'){if(ref['类型']!=='设定卡'||stateKey(ref['人物'])!==stateKey(need.name))return false;const outfit=need.state||record.original?.['服装']?.[need.name],meta=stateReferenceMetadata(project,asset);return !!outfitKey(outfit)&&outfitKey(outfit)===outfitKey(productionReferenceOutfit(project,ref))&&(!meta.stateLabels.length||stateReferenceMatches(outfit,meta));}return false;});
}
/** Bind by source grid ID, never by image order, inferred pixels or a screen prompt. */
export function hydrateProductionSlices(project,assets=[]){
 let changed=false;const library=projectLibraryAssets(project,assets),byId=new Map(assets.map(a=>[a.id,a]));
 for(const page of project.pages)for(const frame of page.panels){const source=gridSource(frame);if(!source)continue;const record=sliceSourceRecord(project,frame);if(!record)continue;let shot=project.shots.find(s=>s.id===frame.shotId);
  if(!shot||shot.productionGridId!==record.id){if(frame.generation)migrateLegacyPanelPrompt(frame.generation);shot=sourceShot(project,frame,record);project.shots.push(shot);frame.shotId=shot.id;frame.generation={version:1,promptSource:frame.generation?.promptSource||'imported',...(frame.generation?.promptOverrides?{promptOverrides:clone(frame.generation.promptOverrides)}:{}),referenceRoles:[]};changed=true;}
  if(frame.productionGrid){const incoming=sourceShot(project,frame,record);if(JSON.stringify(incoming.sourceFields)!==JSON.stringify(shot.sourceFields)||shot.productionPromptVariants!==1){Object.assign(shot,{...incoming,id:shot.id});changed=true;}}
  if(source.sourceBindingVersion!==1){if(frame.coordinateSource?.generation==='不生成')delete frame.coordinateSource.generation;source.sourceBindingVersion=1;source.sourceLocation=clone(record.source);changed=true;}
  const scoped={...project,shots:[shot],pages:[{...page,panels:[frame]}]},preview=inspectAssetBindings(scoped,library),wanted=preview.panelNeeds.get(frame.id)||new Set(),roles=[];
  const parent=project.pages.flatMap(p=>p.panels).find(p=>p.id===source.rootPanelId),sourceAssets=(parent?.referenceIds||[]).map(key=>byId.get(key)).filter(Boolean);
  // A manual scene/prop choice must not erase the screen's confirmed character.
  // A grid's own choice, text substitute, removal or different selected version
  // remains authoritative, including an intentional deselection after migration.
  for(const need of preview.needs.filter(n=>wanted.has(n.id)&&n.role==='character')){
   if(frame.referenceNeedBindings?.[need.id]||textAssetBinding(frame,need))continue;
   const inherited=sourceAssets.map(asset=>({asset,binding:inheritedSliceReferenceBinding(project,frame,need,asset)})).filter(item=>item.binding&&!removedReferenceIds(project,frame.id,need.id).includes(item.asset.id));
   if(inherited.length!==1)continue;const {asset,binding}=inherited[0];
   if((frame.referenceIds||[]).some(key=>key!==asset.id&&assets.some(a=>a.id===key&&characterIdentityMatches(need,stateReferenceMetadata(project,a),a))))continue;
   if(!frame.referenceIds?.includes(asset.id)&&(frame.referenceIds?.length||0)>=WORKSPACE_REFERENCE_LIMIT||Object.keys(frame.referenceNeedBindings||{}).length>=WORKSPACE_REFERENCE_LIMIT)continue;
   frame.referenceNeedBindings={...frame.referenceNeedBindings,[need.id]:binding};frame.referenceIds=[...new Set([...(frame.referenceIds||[]),asset.id])];frame.generation||={version:1,referenceRoles:[]};frame.generation.referenceRoles=[...(frame.generation.referenceRoles||[]).filter(r=>r.assetId!==asset.id),{assetId:asset.id,name:need.name,role:need.role}];changed=true;
  }
  if(frame.assetReferenceBinding?.mode==='manual')continue;
  for(const need of preview.needs.filter(n=>wanted.has(n.id))){const confirmed=assets.filter(a=>confirmedSliceReference(project,frame,need,a)),asset=confirmed.length===1?confirmed[0]:library.find(a=>a.id===need.assetId);if(asset)roles.push({assetId:asset.id,name:need.name,role:need.role});}
  const refs=new Map((frame.generation?.referenceRoles||[]).map(r=>[r.assetId,r]));for(const r of roles)refs.set(r.assetId,r);const ids=[...new Set([...(frame.referenceIds||[]),...roles.map(r=>r.assetId)])];
  if(JSON.stringify(ids)!==JSON.stringify(frame.referenceIds||[])){frame.referenceIds=ids;frame.generation||={version:1,referenceRoles:[]};frame.generation.referenceRoles=[...refs.values()];changed=true;}
 }
 return changed;
}
