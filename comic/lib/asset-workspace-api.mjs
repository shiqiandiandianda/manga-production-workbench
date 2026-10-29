import {exportEpisodeSelections,previewEpisodeSelections,importEpisodeSelections} from './episode-asset-reuse.mjs';
import {removeWorkspaceReference,restoreWorkspaceReference} from './asset-workspace-removal.mjs';
import {auditPanelReferences} from '../public/panel-reference-audit.js';
import {assetRequirementKey} from '../public/asset-workspace-model.js';
import {assetWorkspaceSettings} from '../public/asset-workspace-settings.js';
import {bindWorkspaceAsset} from './asset-workspace-binding.mjs';
import {check,validateProject} from './store.mjs';
import {TEXT_ASSET_MAX_LENGTH} from '../public/asset-text-references.js';
import {setPanelReferences} from '../public/panel-references.js';
import {prepareEpisodeOutfit} from './episode-outfit.mjs';
import {rememberWorkspaceChoice,reuseWorkspaceChoices} from './asset-workspace-choices.mjs';
import {correctionPreview,prepareAssetCorrection} from './asset-corrections.mjs';
export function workspaceTarget(store,project,t){
 const page=project.pages.find(p=>p.panels.some(f=>f.id===t.panelId)),panel=page?.panels.find(f=>f.id===t.panelId);
 check(panel&&!panel.locked&&!page.locked,'画格或画板已删除或锁定',409);
 check(!store.db.jobs.some(j=>j.projectId===project.id&&j.panelId===panel.id&&['queued','running','recoverable','delegated','awaiting_confirmation'].includes(j.status)),'目标画格正在生成，请完成后再换参考',409);
 const need=auditPanelReferences(project,panel,store.db.assets).needs.find(n=>n.id===t.needId);check(need&&!need.predecessor&&['character','scene','prop'].includes(need.role),'资产需求已变化',409);return {page,panel,need};
}
export function prepareWorkspaceBinding(store,old,input,asset,expectedNeed){
 check(old.revision===input.expectedRevision,'工程已改变，请刷新资产后重试',409);
 check(Array.isArray(input.targets)&&input.targets.length>0&&input.targets.length<=1000,'请选择资产应用范围');
 check(new Set(input.targets.map(t=>t.panelId+':'+t.needId)).size===input.targets.length,'重复的资产目标');
 const next=structuredClone(old),contexts=input.targets.map(t=>workspaceTarget(store,next,t)),key=assetRequirementKey(contexts[0].need);
 if(expectedNeed)check(key===assetRequirementKey(expectedNeed),'接回结果与所选应用资产不一致',409);
 check(contexts.every(c=>assetRequirementKey(c.need)===key),'一次只能应用同身份、同服装的同一资产',409);
 for(const c of contexts)bindWorkspaceAsset(next,c.panel,c.need,asset,store,{stateConfirmation:input.stateConfirmation,userSelected:input.userSelected===true});
 next.assetLibrary||={version:1,assetIds:[],directories:[],recursive:true};next.assetLibrary.assetIds=[...new Set([...next.assetLibrary.assetIds,asset.id])];
 // A direct pick applies only to the range the user selected. Do not silently propagate it.
 if(input.userSelected===true){validateProject(next);return next;}
 for(const c of contexts)rememberWorkspaceChoice(next,c.panel,c.need,asset);const reused=reuseWorkspaceChoices(store,next);validateProject(reused.project);return reused.project;
}
export function createAssetWorkspaceAPI({store,body,json,saveProject,library}){
 return async(req,res,{pathname,method})=>{const m=/^\/api\/projects\/([a-z]+_[a-f0-9-]{36})\/asset-workspace\/(bind|settings|text|outfit|remove|restore|reuse|reuse-export|reuse-preview|reuse-import|correction-preview|correction)$/.exec(pathname);if(!m)return false;check(method==='POST','资产操作不存在',404);const input=await body(req),old=store.project(m[1]);check(old.revision===input.expectedRevision,'工程已改变，请刷新资产后重试',409);
  if(m[2]==='reuse-export'){json(res,200,exportEpisodeSelections(old,store.db.assets,input.pageId));return true;}
  if(m[2]==='reuse-preview'){json(res,200,previewEpisodeSelections(store,old,input));return true;}
  if(m[2]==='reuse-import'){const result=await importEpisodeSelections(store,old,input,library);store.db.projects[store.db.projects.indexOf(old)]=result.project;json(res,200,{...result,project:saveProject(result.project,{editor:true})});return true;}
  if(m[2]==='reuse'){const result=reuseWorkspaceChoices(store,old);if(!result.changed){json(res,200,{summary:result.summary,changed:false});return true;}store.db.projects[store.db.projects.indexOf(old)]=result.project;json(res,200,{project:saveProject(result.project,{editor:true}),summary:result.summary,changed:true});return true;}
  if(m[2]==='correction-preview'){json(res,200,correctionPreview(store,old,input));return true;}
  if(m[2]==='correction'){const result=prepareAssetCorrection(store,old,input);store.db.projects[store.db.projects.indexOf(old)]=result.project;json(res,200,{project:saveProject(result.project,{editor:true}),episodes:result.episodes});return true;}
  if(m[2]==='remove'||m[2]==='restore'){const next=m[2]==='remove'?removeWorkspaceReference(store,old,input):restoreWorkspaceReference(store,old,input);store.db.projects[store.db.projects.indexOf(old)]=next;json(res,200,{project:saveProject(next,{editor:true})});return true;}
  if(m[2]==='outfit'){check(!store.db.jobs.some(j=>j.projectId===old.id&&['queued','preparing','running','recoverable','delegated','awaiting_confirmation'].includes(j.status)),'当前作品有生成任务，请结束后统一服装',409);const next=prepareEpisodeOutfit(old,input,store.db.assets);store.db.projects[store.db.projects.indexOf(old)]=next;json(res,200,{project:saveProject(next,{editor:true})});return true;}
  let next;if(m[2]==='settings'){const {need}=workspaceTarget(store,old,input);next=structuredClone(old);next.assetWorkspaceSettings={...next.assetWorkspaceSettings,[assetRequirementKey(need)]:assetWorkspaceSettings(input.settings)};const selected=Object.values({reference:input.settings?.generationReferenceAssetId,identity:input.settings?.identityAssetId,costume:input.settings?.costumeAssetId,prop:input.settings?.propAssetId}).filter(Boolean);selected.forEach(id=>store.asset(id));if(selected.length){next.assetLibrary||={version:1,assetIds:[],directories:[],recursive:true};next.assetLibrary.assetIds=[...new Set([...next.assetLibrary.assetIds,...selected])];}}else if(m[2]==='text')next=prepareWorkspaceText(store,old,input);else next=prepareWorkspaceBinding(store,old,input,store.asset(input.assetId));
  store.db.projects[store.db.projects.indexOf(old)]=next;json(res,200,{project:saveProject(next,{editor:true})});return true;
 };
}
export function prepareWorkspaceText(store,old,input){
 check(old.revision===input.expectedRevision,'工程已改变，请刷新资产后重试',409);
 check(['text','image'].includes(input.mode),'资产参考方式无效');
 check(input.mode!=='text'||typeof input.description==='string'&&!!input.description.trim()&&input.description.length<=TEXT_ASSET_MAX_LENGTH,'请填写1—2000字的简短资产描述');
 check(Array.isArray(input.targets)&&input.targets.length>0&&input.targets.length<=1000,'请选择资产应用范围');
 check(new Set(input.targets.map(t=>t.panelId+':'+t.needId)).size===input.targets.length,'重复的资产目标');
 const next=structuredClone(old),contexts=input.targets.map(t=>workspaceTarget(store,next,t)),key=assetRequirementKey(contexts[0].need);
 check(contexts.every(c=>assetRequirementKey(c.need)===key),'一次只能应用同身份、同服装的同一资产',409);
 for(const {panel,need} of contexts){
  const previous=panel.referenceTextBindings?.[need.id];
  if(input.mode==='image'&&!previous)continue;
  const audit=auditPanelReferences(next,panel,store.db.assets),shared=new Set(audit.needs.filter(n=>n.id!==need.id&&n.status!=='text').flatMap(n=>n.selectedIds));
  const imageIds=[...new Set([...(previous?.imageIds||[]),...need.selectedIds])].filter(id=>!shared.has(id));
  panel.referenceTextBindings={...panel.referenceTextBindings,[need.id]:{version:1,mode:input.mode,role:need.role,name:need.name,state:need.state||'',description:input.mode==='text'?input.description.trim():previous.description,imageIds}};
  const ids=input.mode==='text'?audit.ids.filter(id=>!imageIds.includes(id)):[...new Set([...audit.ids,...imageIds.filter(id=>store.db.assets.some(a=>a.id===id))])];
  setPanelReferences(panel,ids,{project:next,assets:store.db.assets});
 }
 validateProject(next);return next;
}
