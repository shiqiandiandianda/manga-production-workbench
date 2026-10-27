import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {buildLayoutProject} from '../public/auto-layout-adapter.mjs';
import {createLayoutPlanning} from './layout-planning.mjs';
import {createScreenReflow} from './screen-reflow.mjs';
import {resolveAssistantEpisode} from './assistant-episode-source.mjs';
import {episodeRuleRequest} from '../public/layout-rule-choice.mjs';
import {productionFrame,productionSourceAsset} from '../public/production-package-model.js';

export function createAutoLayoutAPI({store,dataDir,body,json,validateProject,checkAssets,addAsset,saveProject,resolvePreview=resolveAssistantEpisode}){
 const origin=process.env.AUTO_LAYOUT_ORIGIN||'http://127.0.0.1:19848',receipts=path.join(dataDir,'auto-layout-receipts.json');let importing=false;
 const request=async(route,input)=>{const r=await fetch(origin+route,{signal:AbortSignal.timeout(15000),...(input?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)}:{})});const v=await r.json();if(!r.ok)throw Error(v.error||'自动排版服务请求失败');return v;};
 const reflow=createScreenReflow({store,dataDir,body,json,request,addAsset,validateProject,checkAssets,saveProject});
 const planning=createLayoutPlanning({store,dataDir,body,json,request,validateProject,checkAssets});
 return {async handle(req,res,{pathname,method}){
  if(method==='POST'&&['/api/auto-layout/task/resolve','/api/auto-layout/task/start'].includes(pathname)){
   const input=await body(req),safe=value=>typeof value==='string'&&/^[-\w]{1,90}$/.test(value);
   if(!safe(input.scriptId)||!safe(input.runToken)||!Number.isInteger(input.episode))throw Object.assign(Error('排版任务来源参数无效'),{status:400});
   if(input.jobId!==undefined&&!safe(input.jobId))throw Object.assign(Error('原排版任务编号无效'),{status:400});
   const p=store.project(input.projectId),script=await request('/api/scripts/'+encodeURIComponent(input.scriptId));
   if(Number(script.episode)!==input.episode||!['preproduction-layout','screen-crop-reflow'].includes(script.studioSource?.mode)||
      ![p.id,p.layoutPlanningSource?.sourceProjectId].filter(Boolean).includes(script.studioSource?.projectId)||
      script.layoutRuleContract?.id!==input.learningProjectId||script.layoutRuleContract?.version!==input.ruleVersion)
    throw Object.assign(Error('排版任务与当前工程、话数或风格不符，未启动或接回'),{status:409});
   if(pathname.endsWith('/start')){
    if(p.revision!==input.expectedRevision||script.studioSource.projectId!==p.id)throw Object.assign(Error('工程已修改，请从当前话重新送入；未启动任务'),{status:409});
    const value=await request('/api/model/generate',{id:script.id,styleVersion:script.layoutRuleContract.version,requestId:input.runToken});json(res,200,value);return true;
   }
   const value=await request('/api/model/resolve',{id:script.id,requestId:input.runToken,allowPreview:true,...(input.jobId?{resumeJob:input.jobId}:{})});
   let status=value.previewAvailable?'done':value.status;
   if(status==='done'&&!value.previewAvailable)status='failed';
   if(value.jobId&&status==='done'){
    const job=await request('/api/jobs/'+encodeURIComponent(value.jobId));json(res,200,{status:'done',jobId:value.jobId,sourceMatch:value.sourceMatch,message:job.message,timing:job.timing});return true;
   }
   json(res,200,{status,jobId:value.jobId,sourceMatch:value.sourceMatch,message:value.message});return true;
  }
  if(pathname==='/api/auto-layout/learning-scope'){
   if(method==='GET'){const state=await request('/api/state');json(res,200,{projects:state.projects.filter(p=>p.id!=='studio-original-rules'),references:state.references});return true;}
   if(method==='POST'){const input=await body(req);if(input.projectId==='studio-original-rules')throw Object.assign(Error('内置固定规则不参与参考学习，请选择自己的作品项目'),{status:400});json(res,200,await request('/api/library/select',{projectId:input.projectId,referenceIds:input.referenceIds}));return true;}
  }
  if(method==='POST'&&pathname==='/api/auto-layout/preview-state'){
   const input=await body(req),p=store.project(input.projectId);
   if(p.revision!==input.expectedRevision)throw Object.assign(Error('工程已修改，请保存后重新读取预览'),{status:409});
   const ep=p.productionPackage?.episodes.find(e=>Number(e.episode)===Number(input.episode));
   if(!ep)throw Object.assign(Error('本话制作资料不存在'),{status:400});
   if(ep.segments.some(s=>productionSourceAsset(productionFrame(p,s.id)))){json(res,200,{available:false});return true;}
   const contract=await request('/api/integration/rules/resolve',episodeRuleRequest(p.layoutRuleBindings?.[Number(input.episode)],input.learningProjectId));
   const execution=(await request('/api/integration/status')).layoutExecution;
   const bound=p.layoutRuleBindings?.[Number(input.episode)]?.geometry?.generator;
   if(input.learningProjectId==='dazhou'&&execution?.enabled&&bound&&(bound.mode!=='native-style-rules'||bound.styleBookVersion!==execution.styleBookVersion)){
    json(res,200,{available:false,migrateNative:true,message:'旧版排版保留；按当前固有规则另建来源快照'});return true;
   }
   const source=resolvePreview(p,Number(input.episode));
   if(!source){json(res,200,{available:false});return true;}
   if(input.learningProjectId==='dazhou'&&execution?.enabled&&execution.engine==='dazhou-native-style-v1'&&(source.geometry?.generator?.mode!=='native-style-rules'||source.geometry?.generator?.styleBookVersion!==execution.styleBookVersion)){
    json(res,200,{available:false,migrateNative:true,message:'旧版预览保留；本次按当前大周固有款式另建排版，不覆盖旧稿'});return true;
   }
   if(source.contract.digest!==contract.digest){json(res,200,{available:false,existingInvalid:true,message:'现有预览与当前冻结规则不一致，请明确重新排版；旧稿保留'});return true;}
   if(!source.validatedSource||!source.scriptId){json(res,200,{available:false,existingInvalid:true,message:'现有冻结预览仅可查看，缺少完整来源证明；重新排版会另建稿件'});return true;}
   const checked=await request('/api/model/resolve',{id:source.scriptId,allowPreview:true});
   if(checked.jobId&&checked.status!=='done'){json(res,200,{available:false,active:true,scriptId:source.scriptId,jobId:checked.jobId,status:checked.status});return true;}
   if(!checked.previewAvailable){json(res,200,{available:false,existingInvalid:true,message:checked.message||'现有预览未通过完整校验，旧稿保留；请明确重新排版'});return true;}
   const packetHash=createHash('sha256').update(JSON.stringify(checked.packet)).digest('hex');
   if(packetHash!==createHash('sha256').update(JSON.stringify(source.geometry)).digest('hex'))throw Object.assign(Error('预览在读取期间更新，请重新读取；未启动模型'),{status:409});
   json(res,200,{available:true,scriptId:source.scriptId,contract,packetHash,planningMode:true,noModelCall:true});return true;
  }
  if(await planning.handle(req,res,{pathname,method}))return true;
  if(await reflow.handle(req,res,{pathname,method}))return true;
  if(method==='GET'&&pathname==='/api/auto-layout/status'){try{const health=await request('/api/integration/status');json(res,200,{ready:true,origin,...health});}catch(e){json(res,200,{ready:false,origin,error:e.message});}return true;}
  if(method!=='POST'||pathname!=='/api/auto-layout/import')return false;
  if(importing){json(res,409,{error:'正在接回工程，请稍候'});return true;}importing=true;
  try{
   const {scriptId,expectedScript,expectedPacket,reflowView}=await body(req);if(typeof scriptId!=='string'||!/^[-\w]{1,90}$/.test(scriptId))throw Error('分镜ID无效');
   const script=await request('/api/scripts/'+scriptId),draft=await request('/api/drafts/'+scriptId);if(expectedScript&&JSON.stringify(script)!==JSON.stringify(expectedScript)||expectedPacket&&JSON.stringify(draft)!==JSON.stringify(expectedPacket))throw Object.assign(Error('分镜或排版结果已有更新，请重新打开后再接回'),{status:409});const {packet}=await request('/api/export',{id:scriptId,packet:draft});
   if(script.studioSource?.planningBatchId){const project=await planning.importResult(script,packet);json(res,201,project);return true;}
   if(script.studioSource?.reflowBatchId){const project=await reflow.importResult(script,packet,reflowView);json(res,201,project);return true;}
   let originalProject=null;
   if(script.studioSource){originalProject=store.project(script.studioSource.projectId);if(originalProject.productionPackage)throw Error('不能将屏段工程作为逐格工程重新排版');if(originalProject.revision!==script.studioSource.revision)throw Error('原工程已有新版本，请重新送入分镜后排版');}
   const digest=createHash('sha256').update(JSON.stringify({script,packet})).digest('hex');let saved={};if(fs.existsSync(receipts))saved=JSON.parse(fs.readFileSync(receipts,'utf8'));
   const existing=store.db.projects.find(p=>p.id===saved[digest]&&!p.deletedAt);if(existing){json(res,200,existing);return true;}
   const project=buildLayoutProject(script,packet,{originalProject});validateProject(project);checkAssets(project);store.db.projects.push(project);store.save();
   saved[digest]=project.id;fs.writeFileSync(receipts+'.tmp',JSON.stringify(saved));fs.renameSync(receipts+'.tmp',receipts);json(res,201,project);return true;
  }finally{importing=false;}
 }};
}
