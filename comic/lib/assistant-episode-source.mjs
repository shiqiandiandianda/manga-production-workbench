import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import {createHash} from 'node:crypto';
import {episodePreviewSource} from '../public/episode-preview-model.js';
import {validateAssistantGeometry} from '../public/assistant-layout-geometry.js';
const installationRoot=fileURLToPath(new URL('../../',import.meta.url)),defaultPlanning=path.join(process.env.COMIC_DATA_DIR||path.join(installationRoot,'runtime-data/comic'),'auto-layout-planning');
/** The managed launcher records the actual directory, including an adopted legacy service. */
export function assistantDataDirectory({root=installationRoot,environment=process.env}={}){
 if(environment.AUTO_LAYOUT_DATA_DIR)return path.resolve(environment.AUTO_LAYOUT_DATA_DIR);
 const runtimeRoot=environment.WORKBENCH_RELEASE_DATA_ROOT||path.join(root,'runtime-data'),marker=path.join(runtimeRoot,'auto-layout/active-service.local.json');
 if(!fs.existsSync(marker))return path.join(runtimeRoot,'auto-layout/learning-workbench/data');
 let active;try{active=JSON.parse(fs.readFileSync(marker,'utf8'));}catch{throw Object.assign(Error('排版服务数据目录登记无法读取，请重新连接排版服务；现有结果保留'),{status:409});}
 if(active?.format!=='comic-layout-active-service-v1'||typeof active.root!=='string'||path.resolve(active.root)!==path.resolve(root,'auto-layout/learning-workbench')||typeof active.dataRoot!=='string'||!path.isAbsolute(active.dataRoot))throw Object.assign(Error('排版服务数据目录身份不一致，请重新连接排版服务；现有结果保留'),{status:409});
 return active.dataRoot;
}
const read=file=>{try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return null;}};
const fail=message=>{throw Object.assign(Error(message),{status:409});},safe=id=>typeof id==='string'&&/^[\w-]{1,90}$/.test(id),canonical=value=>JSON.stringify(value,(_key,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
function validateNativeBook(geometry){
 if(geometry?.generator?.mode!=='native-style-rules')return;
 const version=geometry.generator.styleBookVersion;if(!/^dazhou-native-v\d+$/.test(version||''))fail('助手固有规则版本无效');
 const book=read(path.join(installationRoot,'auto-layout/styles/dazhou',version+'.json')),policy=read(path.join(installationRoot,'auto-layout/native-style-policy.json'));
 if(!book||geometry.generator.styleBookDigest!==policy?.nativeBookDigests?.[version]||canonical(geometry.nativeUserConstraints)!==canonical(book.runtime?.userConstraints))fail('助手固有规则来源、版本或尺寸约束与安装登记不符');
}
function episodeContent(project,number){const ep=project.productionPackage?.episodes.find(e=>e.episode===number);if(!ep)return null;return {records:ep.panelRecords.map(r=>({id:r.id,segmentId:r.segmentId,original:r.original,production:r.production})),texts:ep.texts,segments:ep.segments.map(s=>({id:s.id,localId:s.localId,panelIds:s.panelIds})),shots:ep.panelRecords.map(r=>{const old=project.shots.find(s=>s.productionGridId===r.id)||{},raw=r.original||{},prod=r.production||{};return {key:r.id,description:old.description??String(raw['画面内容']||prod['画面内容']||''),dialogue:old.dialogue||ep.texts.filter(t=>t['格ID']===r.id).map(t=>t['文本']).join('\n'),shotSize:old.shotSize||raw['景别']||prod['景别']||'',cameraAngle:old.cameraAngle||raw['机位角度']||prod['机位角度']||'',characters:raw['出现角色']||prod['出现角色']||[],location:old.location||raw['当前场景']||prod['当前场景']||'',time:old.time||raw['当前时间']||prod['当前时间']||'',weather:old.weather??'',note:old.note??'',sfx:old.sfx??'',productionPrompt:old.productionPrompt??String(raw['生图提示词']||prod['生图提示词']||''),existingArtwork:old.existingArtwork??null};})};}
/** Read latest completed preview on explicit apply, never alter a project during preview. */
const acceptableMode=g=>g?.generator?.mode==='model-generated'||g?.generator?.mode==='native-style-rules'&&g.generator.engine==='dazhou-native-style-v1'&&g.generator.provider==='local-native-styles'&&g.generator.modelCalls===0&&/^[a-f0-9]{64}$/.test(g.generator.styleBookDigest||'')&&Array.isArray(g.nativeStyleTrace);
export function resolveAssistantEpisode(project,number,{dataDir=assistantDataDirectory(),planningDir=defaultPlanning,scriptId,expectedPacketHash}={}){
 const ep=project.productionPackage?.episodes.find(e=>e.episode===number);if(!ep)throw Object.assign(Error('本话制作资料不存在'),{status:400});
 const source=episodePreviewSource(project,number),binding=source.binding;
 if(source.kind==='artwork')throw Object.assign(Error('带图重排工程已保留助手版式，请直接编辑当前画格'),{status:409});
 const readPair=id=>safe(id)?{script:read(path.join(dataDir,'scripts',id+'.json')),geometry:read(path.join(dataDir,'drafts',id+'.json'))}:{};
 if(scriptId!==undefined&&!safe(scriptId))fail('接回预览编号无效');
 if(expectedPacketHash!==undefined&&!/^[a-f0-9]{64}$/.test(expectedPacketHash))fail('预览校验值无效，请重新打开预览');
 function approved(id,script,geometry){
  if(!script||!geometry||script.id!==id||Number(script.episode)!==number||script.studioSource?.mode!=='preproduction-layout')fail('所选预览不属于当前话的前期排版');
  if(binding&&script.layoutRuleContract?.digest!==binding.contract.digest)fail('新预览与本话冻结规则版本不同，不能混用；当前画布保留');
  if(geometry.layoutRuleDigest!==script.layoutRuleContract?.digest||canonical(geometry.source)!==canonical(script.source)||canonical(geometry.sourcePanelKeys)!==canonical(ep.panelRecords.map(r=>r.id))||!acceptableMode(geometry))fail('所选预览的来源或规则不符，请重新打开已完成结果');
  if(expectedPacketHash&&createHash('sha256').update(JSON.stringify(geometry)).digest('hex')!==expectedPacketHash)fail('预览已更新，请重新打开最新预览后接回；当前画布未改变');
  const batchId=script.studioSource.planningBatchId,batch=typeof batchId==='string'&&/^[a-f0-9-]{36}$/.test(batchId)?read(path.join(planningDir,batchId+'.json')):null;
  if(!batch||batch.scriptId!==id||canonical(batch.shots)!==canonical(script.shots)||canonical(batch.contract)!==canonical(script.layoutRuleContract))fail('新预览的原始分镜或冻结规则快照不符，当前画布保留');
  // Revision may advance through unrelated edits; retain strict checks on this episode.
  if(canonical(episodeContent(project,number))!==canonical(episodeContent(batch.project,number)))fail('本话分镜原文、镜号或顺序已改变，请从当前话重新送入；现有画布保留');
  validateNativeBook(geometry);validateAssistantGeometry(geometry,ep,script.shots);return {geometry,contract:script.layoutRuleContract,scriptId:id,validatedSource:true,updatedPreview:!!binding&&canonical(geometry)!==canonical(binding.geometry||{panels:binding.targetPanels})};
 }
 function sourceFamily(script){
  if(script?.studioSource?.projectId===project.id||script?.studioSource?.projectId===project.layoutPlanningSource?.sourceProjectId)return true;
  const id=script?.studioSource?.planningBatchId;if(typeof id!=='string'||!/^[a-f0-9-]{36}$/.test(id))return false;
  const batch=read(path.join(planningDir,id+'.json')),original=batch?.project?.productionPackage?.episodes.find(e=>e.episode===number);
  // Internal root panel IDs are preserved through explicit project copies. Shared
  // source roots plus the content checks below link a preview without guessing by title.
  return !!original&&canonical(original.segments.map(s=>[s.id,s.panelId,s.panelIds]))===canonical(ep.segments.map(s=>[s.id,s.panelId,s.panelIds]));
 }
 const completedCandidates=[],archive=read(path.join(dataDir,'script-archive.json'))||{},scriptsFolder=path.join(dataDir,'scripts');
 if(!scriptId&&fs.existsSync(scriptsFolder))for(const name of fs.readdirSync(scriptsFolder).filter(n=>n.endsWith('.json'))){const id=name.slice(0,-5),{script,geometry}=readPair(id);if(archive[id]||!script||!geometry||Number(script.episode)!==number||script.studioSource?.mode!=='preproduction-layout'||!acceptableMode(geometry)||!sourceFamily(script)||binding&&script.layoutRuleContract?.digest!==binding.contract.digest)continue;completedCandidates.push({id,modified:fs.statSync(path.join(dataDir,'drafts',id+'.json')).mtimeMs});}
 completedCandidates.sort((a,b)=>b.modified-a.modified);
 if(!scriptId&&completedCandidates.length){
  let rejected;
  for(const candidate of completedCandidates){const pair=readPair(candidate.id);try{return approved(candidate.id,pair.script,pair.geometry);}catch(error){rejected=error;}}
  if(rejected)throw rejected;
 }
 const selected=scriptId||source.scriptId;
 if(selected){const {script,geometry}=readPair(selected),linked=selected===source.scriptId||script?.studioSource?.projectId===project.id||script?.studioSource?.projectId===project.layoutPlanningSource?.sourceProjectId||sourceFamily(script);
  if(script&&geometry&&linked)return approved(selected,script,geometry);
  if(scriptId)fail('找不到所选预览与当前工程的来源关联，当前画布保留');
 }
 if(binding?.geometry){validateNativeBook(binding.geometry);validateAssistantGeometry(binding.geometry,ep);if(canonical(binding.geometry.panels)!==canonical(binding.targetPanels))fail('已保存的助手预览与冻结画格不一致');return {geometry:structuredClone(binding.geometry),contract:binding.contract,scriptId:source.scriptId};}
 if(binding){
  const ids=source.scriptId?[source.scriptId]:fs.existsSync(path.join(dataDir,'scripts'))?fs.readdirSync(path.join(dataDir,'scripts')).filter(n=>n.endsWith('.json')).map(n=>n.slice(0,-5)):[];
  for(const id of ids){const {script,geometry}=readPair(id);if(script?.layoutRuleContract?.digest===binding.contract.digest&&canonical(geometry?.panels)===canonical(binding.targetPanels)){validateNativeBook(geometry);validateAssistantGeometry(geometry,ep,script.shots);return {geometry,contract:binding.contract,scriptId:id};}}
  // The read-only preview uses this same frozen fallback if its original draft is unavailable.
  validateNativeBook(source.geometry);validateAssistantGeometry(source.geometry,ep);return {geometry:source.geometry,contract:binding.contract,scriptId:source.scriptId};
 }
 return null;
}
