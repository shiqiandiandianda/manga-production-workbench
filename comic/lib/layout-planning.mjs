import {episodeRuleRequest} from '../public/layout-rule-choice.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {buildPreplannedProject,assertNativeAspect,generationPlans} from '../public/unified-layout-rules.js';
const sha=v=>createHash('sha256').update(v).digest('hex');
const fail=(message,status=409)=>{throw Object.assign(Error(message),{status});};
export function createLayoutPlanning({store,dataDir,body,json,request,validateProject,checkAssets}){
 const folder=path.join(dataDir,'auto-layout-planning');let busy=false;
 function epFor(p,input){if(p.revision!==input.expectedRevision)fail('原工程已有修改，请刷新');const ep=p.productionPackage?.episodes.find(e=>e.episode===Number(input.episode));if(!ep)fail('请选择制作资料工程及话数',400);return ep;}
 function fixedShots(p,ep){return ep.panelRecords.map(r=>{const raw=r.original||{},prod=r.production||{},old=p.shots.find(s=>s.productionGridId===r.id)||{};return {...structuredClone(old),key:r.id,code:r.id,title:r.id,description:old.description??String(raw['画面内容']||prod['画面内容']||''),productionPrompt:old.productionPrompt??String(raw['生图提示词']||prod['生图提示词']||''),dialogue:old.dialogue||ep.texts.filter(t=>t['格ID']===r.id).map(t=>t['文本']).join('\n'),shotSize:old.shotSize||raw['景别']||prod['景别']||'',cameraAngle:old.cameraAngle||raw['机位角度']||prod['机位角度']||'',characters:raw['出现角色']||prod['出现角色']||[],location:old.location||raw['当前场景']||prod['当前场景']||'',time:old.time||raw['当前时间']||prod['当前时间']||'',sourceFields:structuredClone(raw)};});}
 function load(id){if(!/^[a-f0-9-]{36}$/.test(id))fail('规划批次无效',400);return JSON.parse(fs.readFileSync(path.join(folder,id+'.json'),'utf8'));}
 async function importResult(script,geometry){
  const batch=load(script.studioSource.planningBatchId),original=store.project(batch.project.id);
  if(batch.projectHash!==sha(JSON.stringify(original))||script.id!==batch.scriptId||JSON.stringify(batch.shots)!==JSON.stringify(script.shots)||JSON.stringify(batch.contract)!==JSON.stringify(script.layoutRuleContract))fail('来源或规则快照已变化，请重新送入');
  assertNativeAspect(script,geometry);generationPlans(original.productionPackage.episodes.find(e=>e.episode===Number(script.episode)),geometry);
  const key=sha(JSON.stringify(geometry)),prior=store.db.projects.find(p=>p.id===batch.results?.[key]&&!p.deletedAt);if(prior)return prior;
  const project=buildPreplannedProject(original,script,geometry);validateProject(project);checkAssets(project);store.db.projects.push(project);store.save();
  batch.results||={};batch.results[key]=project.id;fs.writeFileSync(path.join(folder,batch.id+'.json'),JSON.stringify(batch));return project;
 }
 return {importResult,async handle(req,res,{pathname,method}){
  if(method==='GET'&&pathname==='/api/auto-layout/rules'){json(res,200,await request('/api/integration/rules'));return true;}
  if(method!=='POST'||!['/api/auto-layout/planning/source','/api/auto-layout/planning/export','/api/auto-layout/rules/resolve'].includes(pathname))return false;
  if(busy)fail('正在处理统一版式规划');busy=true;
  try{
   const input=await body(req);if(input.forceNew!==undefined&&typeof input.forceNew!=='boolean')fail('重新排版标记无效',400);
   if(pathname.endsWith('/rules/resolve')){json(res,200,await request('/api/integration/rules/resolve',input));return true;}
   if(pathname.endsWith('/export')){
    const p=store.project(input.projectId),ep=epFor(p,input),binding=p.layoutRuleBindings?.[ep.episode];if(!binding)fail('本话尚无已接回的统一版式规划',400);
    json(res,200,{format:'comic-unified-layout-preproduction',version:1,episode:ep.episode,...structuredClone(binding),instructions:'前期版式及屏段提示词共用本规则快照。目标格型与生成框比例一致，计划矩形不是实际裁区。不得重写剧情台词或在已有图片上重新生图。'});return true;
   }
   const p=store.project(input.projectId),ep=epFor(p,input),panelIds=new Set(ep.segments.map(s=>s.panelId));
   if(p.autoLayoutSource?.mode==='screen-crop-reflow'||p.pages.flatMap(p=>p.panels).some(f=>panelIds.has(f.id)&&f.imageAssetId))fail('本话已有成图，请直接确认裁格后按原比例重排；不会重新生成');
   if(store.db.jobs.some(j=>j.projectId===p.id&&panelIds.has(j.panelId)&&['queued','preparing','running','recoverable','delegated','awaiting_confirmation'].includes(j.status)))fail('本话仍有制作任务，请完成后再规划');
   const contract=await request('/api/integration/rules/resolve',episodeRuleRequest(p.layoutRuleBindings?.[ep.episode],input.learningProjectId)),shots=fixedShots(p,ep),hash=sha(JSON.stringify(p)),batchKey=sha(JSON.stringify([hash,contract.digest,shots]));
   fs.mkdirSync(folder,{recursive:true});
   if(!input.forceNew)for(const f of fs.readdirSync(folder).filter(n=>n.endsWith('.json')).sort((a,b)=>fs.statSync(path.join(folder,b)).mtimeMs-fs.statSync(path.join(folder,a)).mtimeMs)){
    try{const old=JSON.parse(fs.readFileSync(path.join(folder,f),'utf8'));if(old.batchKey!==batchKey||!old.scriptId)continue;
     const script=await request('/api/scripts/'+old.scriptId);
     if(script.studioSource?.planningBatchId!==old.id||JSON.stringify(script.shots)!==JSON.stringify(old.shots)||JSON.stringify(script.layoutRuleContract)!==JSON.stringify(contract))continue;
     json(res,200,{scriptId:old.scriptId,contract,reused:true,mode:'preproduction-layout'});return true;
    }catch{}
   }
   const id=randomUUID(),batch={id,batchKey,project:structuredClone(p),projectHash:hash,shots,contract};
   fs.writeFileSync(path.join(folder,id+'.json'),JSON.stringify(batch));
   const result=await request('/api/integration/import',{projectId:p.id,revision:p.revision,title:p.title+' · 第'+ep.episode+'话前期统一版式',episode:ep.episode,shots,learningProjectId:contract.id,layoutRuleContract:contract,planningBatchId:id});
   batch.scriptId=result.id;fs.writeFileSync(path.join(folder,id+'.json'),JSON.stringify(batch));json(res,200,{scriptId:result.id,contract,mode:'preproduction-layout',noImageGeneration:true});return true;
  }finally{busy=false;}
 }};
}
