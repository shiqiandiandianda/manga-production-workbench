import {episodeRuleRequest} from '../public/layout-rule-choice.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {productionFrame,productionSourceAsset} from '../public/production-package-model.js';
import {assertNativeAspect} from '../public/unified-layout-rules.js';
import {buildReflowProject} from '../public/auto-layout-reflow.mjs';

const sha=v=>createHash('sha256').update(v).digest('hex');
const stamp=f=>JSON.stringify([f.x,f.y,f.w,f.h,f.points,f.imageAssetId,f.imageTransform,f.packageCutout]);
const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const active=new Set(['queued','preparing','running','recoverable','awaiting_confirmation','delegated']);
const fail=(message,status=409)=>{throw Object.assign(Error(message),{status});};

export function createScreenReflow({store,dataDir,body,json,request,addAsset,validateProject,checkAssets}){
 const slices=path.join(dataDir,'panel-slices'),directory=path.join(dataDir,'auto-layout-reflow');let busy=false;
 const batchPath=id=>{if(!uuid.test(id))fail('重排批次编号无效',400);return path.join(directory,id+'.json');};
 const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
 function context(project,episode,revision){
  if(project.autoLayoutSource?.mode==='screen-crop-reflow')fail('这是已接回的重排结果，请打开原工程继续裁格或制作新图',400);
  if(project.revision!==revision)fail('原工程已有修改，请刷新成图裁格清单');
  const ep=project.productionPackage?.episodes.find(e=>e.episode===Number(episode));if(!ep)fail('请选择已有整屏成图的制作资料工程与话数',400);
  const panelIds=new Set(ep.segments.flatMap(s=>[s.panelId,...project.pages.flatMap(p=>p.panels).filter(f=>f.cutoutLayer?.parentPanelId===s.panelId).map(f=>f.id)]));
  if(store.db.jobs.some(j=>j.projectId===project.id&&panelIds.has(j.panelId)&&active.has(j.status)))fail('本话仍有生成任务，请完成后再裁格重排');
  return ep;
 }
 function recordFor(project,ep,segment,id,{verifyFiles=false}={}){
  if(!uuid.test(id))fail('裁格记录编号无效',400);
  const folder=path.join(slices,id),file=path.join(folder,'manifest.json');if(!fs.existsSync(file))fail('裁格记录已不存在，请重新确认');const r=read(file);
  const root=productionFrame(project,segment.id),source=project.pages.flatMap(p=>p.panels).find(f=>f.id===r.sourcePanelId),expected=ep.panelRecords.filter(p=>p.segmentId===segment.id).map(p=>p.id);
  if(!root||!source||r.projectId!==project.id||r.segmentId!==segment.id||r.packageHash!==project.productionPackage.hash||r.originalAssetId!==productionSourceAsset(root)||r.rootStamp!==stamp(root)||r.frameStamp!==stamp(source)||r.sourceAssetId!==(source.id===root.id?productionSourceAsset(root):source.imageAssetId)||!Array.isArray(r.files)||JSON.stringify(r.expected)!==JSON.stringify(expected)||JSON.stringify(r.files.map(f=>f.panelId))!==JSON.stringify(expected))fail('裁格来源或格号已改变，请重新确认 '+segment.localId);
  if(source.id!==root.id&&!(source.cutoutLayer?.kind==='upscale'&&source.cutoutLayer.parentPanelId===root.id&&source.cutoutLayer.sourceAssetId===productionSourceAsset(root)))fail('高清图已不属于当前整屏原图');
  const sourceFile=store.assetPath(r.sourceAssetId);if(!fs.existsSync(sourceFile))fail('整屏来源图片无法读取');
  if(verifyFiles&&sha(fs.readFileSync(sourceFile))!==r.sourceHash)fail('整屏来源图片内容发生变化，请重新裁格');
  for(const f of r.files){
   if(path.basename(f.name)!==f.name||!/^[-\w]+\.png$/.test(f.name)||!Number.isInteger(f.width)||!Number.isInteger(f.height)||f.width<2||f.height<2)fail('裁格文件记录无效');
   const p=path.join(folder,f.name);if(!fs.existsSync(p)||verifyFiles&&sha(fs.readFileSync(p))!==f.sha256)fail('裁格图片已改变或缺失，请重新确认 '+f.panelId);
  }
  return r;
 }
 function latestRecords(project,ep){
  const found=new Map();if(!fs.existsSync(slices))return found;
  const candidates=fs.readdirSync(slices).filter(id=>uuid.test(id)).map(id=>{try{const r=read(path.join(slices,id,'manifest.json'));return r.files&&r.projectId===project.id?r:null;}catch{return null;}}).filter(Boolean).sort((a,b)=>b.created.localeCompare(a.created)||b.id.localeCompare(a.id));
  for(const r of candidates){const segment=ep.segments.find(s=>s.id===r.segmentId);if(!segment||found.has(segment.id))continue;try{recordFor(project,ep,segment,r.id,{verifyFiles:true});found.set(segment.id,r.id);}catch{}}
  return found;
 }
 async function plan(project,input){
  const ep=context(project,input.episode,input.expectedRevision),records=latestRecords(project,ep);let learning={projects:[]},library={projects:[]};try{learning=await request('/api/state');library=await request('/api/library');}catch{}
  const rules=await request('/api/integration/rules');
  return {binding:project.layoutRuleBindings?.[ep.episode]||null,rules:rules.entries,projectId:project.id,revision:project.revision,episode:ep.episode,episodes:project.productionPackage.episodes.map(e=>({episode:e.episode,title:e.title})),segments:ep.segments.map(s=>{const f=productionFrame(project,s.id),raw=productionSourceAsset(f),count=ep.panelRecords.filter(p=>p.segmentId===s.id).length;return {id:s.id,label:s.localId,scene:s.scene,count,hasImage:!!raw,assetId:raw,recordId:records.get(s.id)||null};}),learningProjects:(learning.projects||[]).map(p=>({id:p.id,name:p.name,aliases:p.aliases||[],activeVersion:library.projects.find(l=>l.id===p.id)?.activeVersion||null})),noImageGeneration:true};
 }
 async function source(project,input){
  const ep=context(project,input.episode,input.expectedRevision),binding=project.layoutRuleBindings?.[ep.episode],ruleRequest=episodeRuleRequest(binding,input.learningProjectId);
  if(!Array.isArray(input.records)||input.records.length!==ep.segments.length||new Set(input.records.map(r=>r.segmentId)).size!==ep.segments.length)fail('请先完成本话所有整屏的裁格确认',400);
  const selected=new Map(input.records.map(r=>[r.segmentId,r.recordId])),records=ep.segments.map(s=>{if(!selected.has(s.id))fail('缺少裁格确认：'+s.localId,400);return recordFor(project,ep,s,selected.get(s.id),{verifyFiles:true});});
  const items=ep.panelRecords.map(record=>{const r=records.find(r=>r.segmentId===record.segmentId),f=r.files.find(f=>f.panelId===record.id);if(!f)fail('裁图与源格号无法一一对应：'+record.id);return {...f,cropKey:f.key,key:record.id,segmentId:record.segmentId,recordId:r.id,filePath:path.join(slices,r.id,f.name),sourceAssetId:r.sourceAssetId,sourceHash:r.sourceHash,sourcePanelId:r.sourcePanelId,rootPanelId:r.rootPanelId,sourceWidth:r.width,sourceHeight:r.height};});
  if(!items.length||items.length>800||new Set(items.map(i=>i.key)).size!==items.length)fail('本话源格ID重复或格数超过800',400);
  const contract=await request('/api/integration/rules/resolve',ruleRequest);
  const batchKey=sha(JSON.stringify({project:sha(JSON.stringify(project)),style:contract.digest,records:records.map(r=>[r.segmentId,r.sourceHash,r.sourcePanelId,r.rootStamp,r.frameStamp]),images:items.map(i=>[i.key,i.sha256,i.pixels,i.region])}));
  if(fs.existsSync(directory))for(const name of fs.readdirSync(directory).filter(n=>n.endsWith('.json'))){let cached;try{cached=read(path.join(directory,name));if(cached.batchKey!==batchKey||!cached.scriptId)continue;const script=await request('/api/scripts/'+cached.scriptId);if(script.studioSource?.reflowBatchId===cached.id)return {id:cached.id,scriptId:cached.scriptId,count:cached.items.length,episode:cached.episode,noImageGeneration:true,reused:true};}catch{}}
  const id=randomUUID(),snapshot=structuredClone(project),shots=ep.panelRecords.map((r,i)=>{
   const existing=project.shots.find(s=>s.productionGridId===r.id&&s.productionSliceSegment===r.segmentId),raw=r.original||{},p=r.production||{},texts=ep.texts.filter(t=>t['格ID']===r.id);
   return {...(existing?structuredClone(existing):{}),key:r.id,code:r.id,title:r.id,description:existing?.description??String(raw['画面内容']||p['画面内容']||''),productionPrompt:existing?.productionPrompt??String(raw['生图提示词']||p['生图提示词']||''),dialogue:existing?.dialogue||texts.map(t=>t['文本']).join('\n'),characters:raw['出现角色']||p['出现角色']||[],location:existing?.location||raw['当前场景']||p['当前场景']||'',time:existing?.time||raw['当前时间']||p['当前时间']||'',shotSize:existing?.shotSize||raw['景别']||p['景别']||'',cameraAngle:existing?.cameraAngle||raw['机位角度']||p['机位角度']||'',sourceFields:structuredClone(raw),productionGridId:r.id,productionSliceSegment:r.segmentId,existingArtwork:{width:items[i].width,height:items[i].height,sha256:items[i].sha256,aspectRatio:items[i].width/items[i].height,policy:'reuse-cropped-image-contain-no-regeneration'},sourceLocation:existing?.sourceLocation||[r.source?.file,r.source?.pointer].filter(Boolean).join(' '),productionSourceRecord:structuredClone(r.source||{})};
  });
  const batch={version:2,contract,id,batchKey,projectId:project.id,revision:project.revision,episode:ep.episode,projectHash:sha(JSON.stringify(project)),project:snapshot,items,shots,created:new Date().toISOString()};fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(batchPath(id),JSON.stringify(batch));
  try{const result=await request('/api/integration/import',{projectId:project.id,revision:project.revision,title:project.title+' · 第'+ep.episode+'话成图重排',episode:ep.episode,shots,learningProjectId:contract.id,layoutRuleContract:contract,reflowBatchId:id});batch.scriptId=result.id;fs.writeFileSync(batchPath(id),JSON.stringify(batch));return {id,scriptId:result.id,count:items.length,episode:ep.episode,noImageGeneration:true};}catch(e){batch.error=e.message;fs.writeFileSync(batchPath(id),JSON.stringify(batch));throw e;}
 }
 async function importResult(script,packet){
  const batch=read(batchPath(script.studioSource.reflowBatchId)),original=store.project(batch.projectId);context(original,batch.episode,batch.revision);
  if(batch.scriptId!==script.id||batch.projectHash!==sha(JSON.stringify(original))||JSON.stringify(batch.shots)!==JSON.stringify(script.shots))fail('原工程或固定分镜快照发生变化，请重新送入裁图');
  const ep=original.productionPackage.episodes.find(e=>e.episode===batch.episode);for(const r of new Map(batch.items.map(i=>[i.segmentId,i.recordId])).entries())recordFor(original,ep,ep.segments.find(s=>s.id===r[0]),r[1],{verifyFiles:true});
  if(batch.contract&&JSON.stringify(batch.contract)!==JSON.stringify(script.layoutRuleContract))fail('排版规则快照已改变');
  assertNativeAspect(script,packet);
  const digest=sha(JSON.stringify(packet));const old=store.db.projects.find(p=>p.id===batch.results?.[digest]&&!p.deletedAt);if(old)return old;
  const before=new Set(store.db.assets.map(a=>a.id));let addedProject;
  try{
   const items=batch.items.map(item=>({...item,asset:addAsset(item.filePath,item.key+' · 成图裁格重排','auto-layout-crop')}));
   const next=buildReflowProject({original:batch.project,script,geometry:packet,items,batchId:batch.id});validateProject(next);checkAssets(next);store.db.projects.push(next);addedProject=next;store.save();
   batch.results||={};batch.results[digest]=next.id;fs.writeFileSync(batchPath(batch.id)+'.tmp',JSON.stringify(batch));fs.renameSync(batchPath(batch.id)+'.tmp',batchPath(batch.id));return next;
  }catch(e){if(addedProject)store.db.projects=store.db.projects.filter(p=>p!==addedProject);store.db.assets=store.db.assets.filter(a=>before.has(a.id));store.save();throw e;}
 }
 return {importResult,async handle(req,res,{pathname,method}){
  if(method!=='POST'||!['/api/auto-layout/reflow/plan','/api/auto-layout/reflow/source'].includes(pathname))return false;
  if(busy)fail('正在处理成图重排，请稍候');busy=true;
  try{const input=await body(req),project=store.project(input.projectId);const result=pathname.endsWith('/plan')?await plan(project,input):await source(project,input);json(res,200,result);return true;}finally{busy=false;}
 }};
}
