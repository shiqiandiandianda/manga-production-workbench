import {auditPanelReferences} from '../public/panel-reference-audit.js';
import {savedAssetRequirementSettings} from '../public/asset-workspace-model.js';
import {assetWorkspaceSettings} from '../public/asset-workspace-settings.js';
import {automaticCharacterIdentity} from '../public/character-identity-reference.js';
import {libraryProjectScopes} from '../public/library-project-scope.js';
import {mokuCandidate,usableMokuImage,mokuRevision} from '../public/moku-reference-search.js';
import {check} from './store.mjs';

/** Read the project's library and materialize only the chosen immutable reference.
 * This never adopts an image, edits a project, uploads, or creates a generation job. */
export async function discoverGenerationIdentity(store,library,input){
 const project=store.project(input.projectId);check(project.revision===input.expectedRevision,'工程已变化，请保存后重试',409);
 const panel=project.pages.flatMap(p=>p.panels).find(p=>p.id===input.panelId),need=panel&&auditPanelReferences(project,panel,store.db.assets).needs.find(n=>n.id===input.needId);check(need,'人物需求已变化，请重新打开',409);
 const settings=assetWorkspaceSettings({...savedAssetRequirementSettings(project,need),...input.settings}),mode=settings.identityReferenceMode||'auto';
 if(settings.generationReferenceMode||need.role!=='character'||mode==='none'||mode==='selected'||settings.identityAssetId&&mode!=='auto')return {status:'manual',assetId:settings.identityAssetId||null,reason:'保留已指定的身份来源。'};
 const verify=()=>{check(store.project(input.projectId).revision===input.expectedRevision,'工程已变化，请重新检查人物参考',409);};
 const options={defaultIds:[...(need.selectedIds||[]),need.recommendedId].filter(Boolean),appearanceNotes:settings.appearanceNotes},local=automaticCharacterIdentity(project,store.db.assets,need,options);
 if(local.assetId)return {...local,asset:store.asset(local.assetId)};
 if(local.status==='ambiguous'||!library?.read||!library?.importAsset)return local;
 const catalogue=await library.read('/api/projects');verify();const scopes=libraryProjectScopes(project,store.db.assets,catalogue.items||[]),projectIds=scopes.ids.filter(id=>id!=='public');
 if(!projectIds.length)return {...local,reason:scopes.note||'尚未找到本项目的素材库，保留手动选图入口。'};
 const remote=[];
 for(const projectId of projectIds){for(let offset=0;offset<2000;offset+=200){const page=await library.read('/api/assets?'+new URLSearchParams({projectId,q:need.name,limit:'200',offset:String(offset)}));verify();const items=page.items||[];remote.push(...items.filter(usableMokuImage).filter(a=>/^image\//.test(a.mime||'')||/\.(png|jpe?g|webp|avif)$/i.test(a.name||'')).filter(a=>!a.projectId||a.projectId===projectId).map(a=>({...a,projectId})));if(page.more===false||items.length<200)break;if(offset===1800)return {status:'ambiguous',assetId:null,reason:'同名素材过多，暂未自动采用，请缩小项目素材范围。'};}}
 const decision=automaticCharacterIdentity(project,remote.map(mokuCandidate),need,{...options,remote:true});if(!decision.assetId)return decision;
 const item=remote.find(a=>'remote_'+a.id===decision.assetId),imported=await library.importAsset({assetId:item.id,revisionId:mokuRevision(item)});verify();check(imported.kind==='image'&&imported.asset,'自动识别的身份参考不是有效图片',409);
 // Re-evaluate after fixed-version metadata/hash verification.
 const confirmed=automaticCharacterIdentity(project,[imported.asset],need,{...options,remote:true});check(confirmed.assetId,'参考的身份、年龄或形态已变化，请重新检查',409);
 imported.asset.automaticIdentitySources=[...(imported.asset.automaticIdentitySources||[]).filter(s=>s.projectId!==project.id),{projectId:project.id,revisionId:imported.asset.library.revisionId,sha256:imported.asset.library.sha256}].slice(-60);store.save();
 return {...confirmed,source:'project-library',asset:imported.asset,reason:'已自动识别本项目人物参考：'+imported.asset.name};
}
