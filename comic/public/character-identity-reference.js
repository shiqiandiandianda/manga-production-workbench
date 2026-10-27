import {assetUnavailable} from './asset-availability.js';
import {assetNameKey} from './asset-metadata.js';
import {stateReferenceMetadata} from './character-state-references.js';
import {projectLibraryAssetIds} from './project-asset-library.js';
import {stateKey} from './character-states.js';

const unique=values=>[...new Set(values.filter(Boolean))];
const identityName=value=>assetNameKey(value).replace(/^(?:幼年|童年|少年|青年|成年|中年|老年|幼童|儿童)/u,'');
export function characterIdentityProfile(value=''){
 const text=String(value),age=/幼年|童年|幼童|儿童|孩童|小孩/u.test(text)?'child':/少年|少女|年少|青少年/u.test(text)?'teen':/老年|老者|老人|老学正|老妪/u.test(text)?'elder':/成年|中年|青年|成人/u.test(text)?'adult':'';
 return {chibi:/q\s*版|chibi|大头娃娃/iu.test(text),age};
}
function trustedIds(project,need,assets){
 const discovered=assets.filter(a=>a.automaticIdentitySources?.some(s=>s.projectId===project.id&&s.revisionId===a.library?.revisionId&&s.sha256===a.library?.sha256)).map(a=>a.id);
 return new Set(unique([...projectLibraryAssetIds(project),...discovered,...(need.selectedIds||[]),...(need.conflictingIds||[]),...Object.values(project.assetWorkspaceSettings||{}).map(s=>s.identityAssetId),...(project.productionAssets||[]).flatMap(a=>(a.stages||[]).filter(s=>s.status==='confirmed').map(s=>s.confirmedAssetId))]));
}
function samePerson(need,meta,asset){
 const names=[meta.name,...(meta.aliases||[])],wanted=assetNameKey(need.name),stem=String(asset.name||'').replace(/\.(png|jpe?g|webp|avif)$/i,'');
 return names.some(n=>assetNameKey(n)===wanted||identityName(n)===identityName(need.name))||stem.split(/[_\s·｜|]+/u).some(n=>assetNameKey(n)===wanted||identityName(n)===identityName(need.name));
}
/** Identity matching deliberately ignores clothing. It never changes wardrobe bindings. */
export function characterIdentityCandidates(project,assets,need,{remote=false}={}){
 const ids=trustedIds(project,need,assets),linked=new Set(unique([project.assetLibrary?.mokuProjectId,...assets.filter(a=>ids.has(a.id)).map(a=>a.library?.projectId)]));
 return assets.filter(a=>{
  if(!remote&&!ids.has(a.id)&&!linked.has(a.library?.projectId))return false;
  if(['crowd','群像'].includes(a.library?.category)||a.libraryRole==='crowd'||a.type==='crowd'||a.deletedAt||a.trashedAt||['candidate','stale'].includes(a.productionStatus)||assetUnavailable(a)||/群像|合集|表情组|道具|武器设定|手部|四手|配饰细节/u.test(a.name||''))return false;
  const meta=stateReferenceMetadata(project,a),production=(project.productionAssets||[]).find(p=>p.id===a.productionAssetId);
  return ['character','other'].includes(meta.role)&&production?.type!=='crowd'&&samePerson(need,meta,a);
 });
}
export function automaticCharacterIdentity(project,assets,need,{defaultIds=[],appearanceNotes='',remote=false}={}){
 const target=characterIdentityProfile([need.name,need.state,appearanceNotes].filter(Boolean).join(' ')),all=characterIdentityCandidates(project,assets,need,{remote}),profile=a=>{const meta=stateReferenceMetadata(project,a);return characterIdentityProfile([a.name,meta.name,meta.state].join(' '));};
 const candidates=all.filter(a=>{const p=profile(a);if(p.chibi!==target.chibi)return false;if(target.age)return !p.age||p.age===target.age;return !['child','teen'].includes(p.age);});
 if(!candidates.length)return {status:all.length?'incompatible':'missing',assetId:null,candidateIds:[],reason:all.length?'已找到同人物，但年龄或Q版形态不同，不自动混用。':'本项目尚未找到这个人物的身份参考。'};
 const usage=new Map(),mark=(id,weight=1)=>{if(id)usage.set(id,(usage.get(id)||0)+weight);};
 for(const p of project.pages||[])for(const panel of p.panels||[]){for(const r of panel.generation?.referenceRoles||[])if(r.role==='character'&&identityName(r.name)===identityName(need.name))mark(r.assetId,2);for(const b of Object.values(panel.referenceNeedBindings||{}))if(b.role==='character'&&identityName(b.name)===identityName(need.name))mark(b.assetId,3);}
 for(const e of project.productionPackage?.episodes||[])for(const s of e.segments||[])for(const r of s.references||[])if(identityName(r['人物'])===identityName(need.name))mark(r.binding?.assetId,2);
 const defaults=new Set(defaultIds),score=a=>{const m=stateReferenceMetadata(project,a);return (defaults.has(a.id)?10000:0)+Math.min(usage.get(a.id)||0,100)*100+(target.age&&profile(a).age===target.age?200:0)+(stateKey(m.state)===stateKey(need.state)?50:0)+(m.identityOnly&&/脸|face|身份/iu.test(a.name||'')?20:0)+(a.productionStatus==='confirmed'?10:0)-(/蒙面|遮脸|面罩|受伤/u.test(a.name||'')?80:0);};
 const sorted=[...candidates].sort((a,b)=>score(b)-score(a)||String(a.library?.assetId||a.id).localeCompare(String(b.library?.assetId||b.id))||String(a.library?.revisionId||a.id).localeCompare(String(b.library?.revisionId||b.id)));
 // Several outfits of one person are expected. Distinct explicit ages need evidence.
 const top=score(sorted[0]),ties=sorted.filter(a=>score(a)===top),ages=unique(ties.map(a=>profile(a).age));
 if(!target.age&&ages.length>1&&!ties.some(a=>defaults.has(a.id)||usage.has(a.id)))return {status:'ambiguous',assetId:null,candidateIds:sorted.map(a=>a.id),reason:'同人物有不同年龄版本，暂不能确定本次年龄；可补充年龄或手动指定一次。'};
 const selected=sorted[0];return {status:'resolved',assetId:selected.id,candidateIds:sorted.map(a=>a.id),source:defaults.has(selected.id)?'current':usage.has(selected.id)?'project-adopted':'project-library',reason:'已自动识别本项目人物参考：'+selected.name};
}

