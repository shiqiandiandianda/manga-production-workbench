import {referenceSource,referenceInputStamp,deriveReferenceRequirements} from './reference-requirements.js';
import {generationPromptSelection} from './prompt-source.js';
import {projectLibraryAssets} from './project-asset-library.js';
import {stateReferenceMetadata,stateReferenceMatches} from './character-state-references.js';
import {unknownState,sourceStateFields} from './character-states.js';
import {auditPanelReferences} from './panel-reference-audit.js';
import {inspectAssetBindings} from './asset-auto-bind.js';
import {panelReferenceIds,WORKSPACE_REFERENCE_LIMIT} from './panel-references.js';
import {declaredScene,deriveSceneReference} from './reference-scene-source.js';
import {libraryProjectScopes} from './library-project-scope.js';
import {planProductionReferences} from './production-reference-audit.js';
import {createMokuReferenceSearch,mokuCandidate} from './moku-reference-search.js';
const split=value=>(Array.isArray(value)?value:String(value||'').split(/[、，,；;\n]+/u)).map(s=>String(s).trim()).filter(s=>s&&!/^(无|空镜|—|-)$/u.test(s));
const unique=values=>[...new Set(values)];
export function planPanelReferenceProcessing(project,panel,assets,{extraAssetIds=[]}={}){
 if(panel.locked||project.pages.find(p=>p.panels.some(f=>f.id===panel.id))?.locked)throw Error('请先解锁画格和画板');
 if(panel.cutoutLayer||panel.sfxImage||panel.breakoutForeground)throw Error('请在原画格处理参考图');
 if(panel.productionSegment)return planProductionReferences(project,panel,assets);
 const {source,text,existing,sourceIds,allowed,pool,catalog,sceneEvidence,requirements,characterStates}=deriveReferenceRequirements(project,panel,assets,{extraAssetIds});
 const virtualSource={...source,...requirements,id:panel.shotId},virtualPanel={...panel,referenceRequirements:undefined,generation:{...panel.generation,characterStates}},scoped={...project,shots:[virtualSource],pages:[{panels:[virtualPanel]}],assetLibrary:{...project.assetLibrary,assetIds:unique([...allowed])}},audit=auditPanelReferences(scoped,virtualPanel,assets,{sourceOverride:virtualSource}),ranked=inspectAssetBindings(scoped,pool),ids=[...existing],issues=[],matches=[];
 for(const need of audit.needs){
  if(need.status==='text')continue;
  const row=ranked.needs.find(r=>r.id===need.id),isCurrent=need.selectedIds.length>0;let assetId=need.recommendedId,reason='按人物状态或唯一名称匹配';
  if(need.status==='conflict'){issues.push({name:need.name,role:need.role,status:'conflict',message:'已有参考的服装状态冲突，请确认'});continue;}
  if(isCurrent){matches.push({name:need.name,role:need.role,assetId:need.selectedIds[0],reason:'保留已有参考'});if(need.role==='character'&&unknownState(need.state))issues.push({name:need.name,role:need.role,status:'state',message:'已保留现有参考，服装状态仍待确认'});continue;}
  if(!assetId){const imported=(row?.candidateDetails||[]).filter(c=>sourceIds.includes(c.asset.id)&&(need.role!=='character'||unknownState(need.state)||stateReferenceMatches(need.state,c.meta)));if(imported.length===1){assetId=imported[0].asset.id;reason='沿用本格分镜已带的参考';}}
  if(assetId){if(!ids.includes(assetId))ids.push(assetId);matches.push({name:need.name,role:need.role,assetId,reason});if(need.role==='character'&&unknownState(need.state))issues.push({name:need.name,role:need.role,status:'state',message:'已沿用表内参考，服装状态仍待确认'});}
  else issues.push({name:need.name,role:need.role,status:row?.candidates.length?'review':'missing',message:row?.candidates.length?'有多个版本或状态未明确，请选图确认':'没有找到可用参考图'});
 }
 if(!audit.needs.length)issues.push({name:'本格需求',status:'undefined',message:'没有识别到已登记名称，请补充分镜人物、场景、道具或手动选图'});
 for(const assetId of audit.unknown)issues.push({name:'已选参考',status:'missing',message:'原参考已失效，需重新选图',assetId});
 if(ids.length>WORKSPACE_REFERENCE_LIMIT)throw Error('处理后超过60张参考上限，请先减少选择');
 return {requirements,ids,matches,issues,added:ids.filter(id=>!existing.includes(id)).length,needs:audit.needs,summary:'已匹配 '+matches.length+' 项 · 新增 '+ids.filter(id=>!existing.includes(id)).length+' 张 · 待处理 '+issues.length+' 项'};
}
/** Runs only on an explicit click. Missing production images are not generated here. */
export async function processPanelReferences({project,panel,getAssets,api,onAssets,verify=()=>{},onProgress=()=>{}}){
 if(panel.productionSegment)return processProductionMokuReferences({project,panel,getAssets,api,onAssets,verify,onProgress});
 const extraAssetIds=[],notes=[];let plan=planPanelReferenceProcessing(project,panel,getAssets()),missing=plan.issues.filter(i=>i.status==='missing'&&i.name!=='已选参考');
 if(missing.length){
  try{
   onProgress('检查墨库…');verify();const status=await api('/api/library/status');verify();
   if(!status.connected)notes.push('墨库未连接；已处理工程内参考，可登录墨库后重试。');
   else{
    let scope=libraryProjectScopes(project,getAssets());
    if(scope.source==='public'){const result=await api('/api/library/projects');verify();scope=libraryProjectScopes(project,getAssets(),result.items||[]);}
    const scopes=scope.ids;if(scope.note)notes.push(scope.note);
    for(const issue of missing.slice(0,60)){
     verify();onProgress('查找 '+issue.name+'…');const remote=[];
     for(const projectId of scopes){const params=new URLSearchParams({projectId,kind:'image',q:issue.name,limit:'40',offset:'0'}),result=await api('/api/library/assets?'+params);verify();if(result.more||result.items?.length>=40){notes.push(issue.name+' 的墨库结果较多，请手动筛选版本。');continue;}remote.push(...(result.items||[]).filter(a=>/^[a-f0-9-]{36}$/i.test(a.id)&&/^[a-f0-9-]{36}$/i.test(a.recommendedRevisionId)));}
     const candidates=[...new Map(remote.map(a=>[a.id,a])).values()].map(a=>({...a,id:'remote_'+a.id,filePath:'remote:'+a.id,library:{assetId:a.id,revisionId:a.recommendedRevisionId,category:a.category}}));
     const test=planPanelReferenceProcessing(project,panel,[...getAssets(),...candidates],{extraAssetIds:[...extraAssetIds,...candidates.map(a=>a.id)]}),chosen=test.matches.find(m=>m.name===issue.name&&m.role===issue.role&&m.assetId.startsWith('remote_'));
     if(chosen){const item=candidates.find(a=>a.id===chosen.assetId);verify();const imported=await api('/api/library/import','POST',{assetId:item.library.assetId,revisionId:item.library.revisionId});if(!imported.asset)throw Error('墨库没有返回图片');onAssets([imported.asset]);extraAssetIds.push(imported.asset.id);verify();}
    }
   }
  }catch(error){verify();notes.push('墨库查找未完成：'+error.message);}
 }
 verify();plan=planPanelReferenceProcessing(project,panel,getAssets(),{extraAssetIds});
 const additions=plan.ids.filter(id=>!panelReferenceIds(project,panel).includes(id));
 if(additions.length){onProgress('校验参考原图…');const resolved=await api('/api/assets/resolve','POST',{assetIds:additions});onAssets(resolved.assets||[]);verify();if(resolved.failed?.length){const failed=new Set(resolved.failed.map(a=>a.assetId));plan=planPanelReferenceProcessing(project,panel,getAssets().filter(a=>!failed.has(a.id)),{extraAssetIds:extraAssetIds.filter(id=>!failed.has(id))});notes.push(resolved.failed.length+' 张原图无法读取，未自动加入。');}}
 return {...plan,notes};
}

async function processProductionMokuReferences({project,panel,getAssets,api,onAssets,verify,onProgress}){
 // Retain explicit bindings. The drive is the only source of new automatic selections.
 const before=panelReferenceIds(project,panel),kept=new Set(before),bound=()=>getAssets().filter(a=>kept.has(a.id));
 const initial=planPanelReferenceProcessing(project,panel,bound()),search=createMokuReferenceSearch({api,project,assets:getAssets(),verify}),queries=new Map(),notes=[],candidates=[];
 for(const need of initial.needs.filter(n=>n.status!=='text'&&!n.predecessor&&!n.skipped&&!n.selectedIds.length)){
  const query=need.role==='character'?need.name:need.state.match(/[^\s（）()]+\.(?:png|jpe?g|webp)/i)?.[0]||need.name;
  if(!queries.has(query)){onProgress('搜索墨库 · '+need.name);let result;try{result=await search.search(query,{onProgress});}catch(error){verify();result={items:[],complete:false,notes:['墨库搜索未完成：'+error.message]};}queries.set(query,result);notes.push(...result.notes);}
  const result=queries.get(query);if(result.complete)candidates.push(...result.items.map(mokuCandidate));
 }
 verify();const unique=[...new Map(candidates.map(a=>[a.id,a])).values()],trial=planPanelReferenceProcessing(project,panel,[...bound(),...unique]);
 const imported=[];
 for(const assetId of [...new Set(trial.ids.filter(id=>id.startsWith('remote_')))]){
  const candidate=unique.find(a=>a.id===assetId);verify();onProgress('取用墨库 · '+candidate.name);
  const result=await api('/api/library/import','POST',{assetId:candidate.library.assetId,revisionId:candidate.library.revisionId});verify();
  if(!result.asset?.library?.revisionId)throw Error('墨库没有返回固定版本图片');onAssets([result.asset]);imported.push(result.asset.id);
 }
 const pool=()=>getAssets().filter(a=>kept.has(a.id)||imported.includes(a.id));let plan=planPanelReferenceProcessing(project,panel,pool());
 const additions=plan.ids.filter(id=>!kept.has(id));if(additions.length){const resolved=await api('/api/assets/resolve','POST',{assetIds:additions});verify();onAssets(resolved.assets||[]);if(resolved.failed?.length){const failed=new Set(resolved.failed.map(a=>a.assetId));plan=planPanelReferenceProcessing(project,panel,pool().filter(a=>!failed.has(a.id)));notes.push(resolved.failed.length+' 张墨库原图无法读取，未加入参考');}}
 plan.issues=plan.issues.map(issue=>trial.issues.find(i=>i.slot===issue.slot&&i.status==='review')||issue);
 return {...plan,notes:[...new Set(notes)]};
}
