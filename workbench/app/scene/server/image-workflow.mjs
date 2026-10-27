import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {imageFailurePolicy} from './image-failure-policy.mjs';
import {atomicJson,readJson} from './storage.mjs';
import {repairSource} from '../src/lib/source-repair.ts';
import {parseScript} from '../src/lib/script-structure.ts';
import {segments,merge,promptFor,reversePromptFor,chaptersFrom} from '../src/lib/scenes.ts';
import {applySegment,imageJobs} from '../src/lib/batch-assets.ts';
import {IMAGE_CONCURRENCY} from '../src/lib/image-policy.ts';
import {readGate,blockGate} from '../../../../distribution/generation-gate.mjs';

export function batchPipeline({dataDir,store,analyze,image}){
  const file=path.join(dataDir,'pipeline.json');
  const state={projectId:'',running:false,phase:'idle',batch:0,part:0,parts:0,startedAt:0,updatedAt:0,projectRevision:0,analysisDone:false,analysisRunning:false,analysisPaused:true,analysisCode:'',analysisMessage:'',automaticImages:false,imagesPaused:false,pauseReason:'',pauseCode:'',imageActive:0,imageConcurrency:IMAGE_CONCURRENCY,jobs:[],message:'',code:''};
  let controller=null,stopAnalysis=true,changes=Promise.resolve(),writes=Promise.resolve(),pumping=false,retryTimer=null;
  const gateFile=process.env.COMIC_GENERATION_GATE||'';
  function scheduleGateResume(until){
    if(!gateFile)return;
    if(retryTimer){clearTimeout(retryTimer);retryTimer=null;}
    retryTimer=setTimeout(()=>{
      retryTimer=null;
      if(state.pauseReason!=='quota')return;
      const gate=readGate(gateFile);
      if(gate.until>Date.now()){scheduleGateResume(gate.until);return;}
      state.imagesPaused=false;state.pauseReason='';state.pauseCode='';state.code='';state.message='限流冷却结束，继续出图';
      for(const job of state.jobs)if(job.status==='paused'&&job.pauseReason==='quota'){job.status='pending';job.pauseReason=undefined;}
      updateActivity();void persist();schedulePump();
    },Math.max(250,until-Date.now()+100));
    retryTimer.unref?.();
  }
  const active=new Map();
  function persist(){state.updatedAt=Date.now();const snapshot=structuredClone(state);const write=writes.catch(()=>{}).then(()=>atomicJson(file,snapshot));writes=write;return write;}
  function mutate(operation){const change=changes.catch(()=>{}).then(async()=>{for(let attempt=0;attempt<3;attempt++){const project=await store.load();if(project.id!==state.projectId)throw Error('项目已切换，任务已停止。');const next=operation(project);try{await store.save(next);state.projectRevision++;return next;}catch(error){if(error.code!=='project_conflict'||attempt===2)throw error;}}});changes=change;return change;}
  async function ensureProject(requireFormat=true){const loaded=await store.load();if(!loaded?.text?.trim())throw Error('请先导入包含正文的完整小说。');const result=repairSource(loaded);if(result.repaired)await store.save(result.project);const project=result.project;
    if(state.projectId!==project.id){if(state.running)throw Error('另一个项目的图片正在保存，请稍后重试。');Object.assign(state,{projectId:project.id,jobs:[],code:'',analysisCode:'',analysisMessage:'',phase:'idle',projectRevision:Date.now(),analysisPaused:true,analysisDone:false,analysisRunning:false,batch:0,part:0,parts:0,startedAt:0,automaticImages:false,imagesPaused:false,pauseReason:'',pauseCode:''});}
    if(requireFormat&&!project.format.confirmed)throw Error('请先保存场景图排版格式。');return project;
  }
  function eligible(){return !state.imagesPaused&&state.jobs.some(job=>job.status==='pending'&&(job.origin==='manual'||state.automaticImages)&&(!job.retryAt||job.retryAt<=Date.now()));}
  function updateActivity(){state.imageActive=active.size;state.running=state.analysisRunning||active.size>0||(!state.imagesPaused&&state.jobs.some(job=>job.status==='pending'&&(job.origin==='manual'||state.automaticImages)));
    if(state.running)state.phase='running';else if(state.code){state.phase='error';if(!state.imagesPaused)state.message='本轮出图队列已处理结束，失败版本可单独重试；已完成图片已保存。';}else if(state.analysisDone&&!state.jobs.some(job=>job.status!=='done')){state.phase='done';state.message='拆解和场景候选版本生成已完成。';}else state.phase='paused';
  }
  function enqueueJobs(jobs,origin){const selectionId=randomUUID(),queuedAt=Date.now();for(const job of jobs){const existing=state.jobs.find(item=>item.id===job.id);if(active.has(job.id))continue;if(existing){Object.assign(existing,{selectionId,queuedAt,pauseReason:undefined,errorCode:undefined,diagnosticId:undefined,regenerate:!!job.regenerate,status:'pending',error:undefined,retryAt:undefined,stage:undefined,startedAt:undefined,finishedAt:undefined,durationMs:undefined,stageStartedAt:undefined,stageDurations:undefined,origin:existing.origin==='manual'?'manual':origin});}else state.jobs.push({...job,origin,selectionId,queuedAt});}}
  async function produce(oneBatch=false){
    try{let project=await store.load();for(let index=0;index<project.batches.length&&!stopAnalysis;index++){
      project=await store.load();if(project.batches[index].status==='done'){if(state.automaticImages){enqueueJobs(imageJobs(project,undefined,project.batches[index].id),'automatic');schedulePump();}continue;}
      const parts=segments(project.batches[index]);state.batch=index;state.parts=parts.length;
      for(let part=project.batches[index].completedParts;part<parts.length&&!stopAnalysis;part++){
        state.part=part;state.message='正在拆解第 '+(index+1)+' 批正文；已完成批次自动出图。';await persist();
        project=await mutate(current=>({...current,batches:current.batches.map((batch,i)=>i===index?{...batch,status:'running'}:batch)}));
        const result=await analyze({chapters:parts[part],known:project.scenes.map(scene=>({name:scene.name,canonicalKey:scene.canonicalKey,time:scene.time,interior:scene.interior}))},controller.signal);
        if(stopAnalysis)break;project=await mutate(current=>applySegment(current,index,part,result.scenes,merge));await persist();
      }
      if(stopAnalysis)break;
      project=await mutate(current=>({...current,batches:current.batches.map((batch,i)=>i===index?{...batch,status:'done'}:batch)}));if(state.automaticImages){enqueueJobs(imageJobs(project,undefined,project.batches[index].id),'automatic');schedulePump();}await persist();if(oneBatch){state.analysisPaused=true;stopAnalysis=true;break;}
    }state.analysisDone=(await store.load()).batches.every(batch=>batch.status==='done');
    }catch(error){if(!stopAnalysis){state.message=error.message;state.code=error.code||'pipeline_analysis_failed';state.analysisCode=state.code;state.analysisMessage=error.message;state.analysisPaused=true;}}
    finally{await mutate(current=>({...current,batches:current.batches.map(batch=>batch.status==='running'?{...batch,status:'pending'}:batch)})).catch(()=>{});state.analysisRunning=false;updateActivity();await persist();schedulePump();}
  }
  async function generateJob(job){
    try{await persist();const project=await store.load(),scene=project.scenes.find(scene=>scene.id===job.sceneId);if(!scene)throw Error('所选场景已不存在。');
      if(scene.images[job.index]&&!job.regenerate){job.status='done';return;}
      const prompt=promptFor(scene,project.format,job.index,chaptersFrom(project.text))+(job.regenerate?'\n本轮为重新生成：保持同一场景、原文事实与排版规则，给出新的取景构图和细节呈现，不复用之前的成图。':'');
      const result=await image({sceneName:scene.name,prompt,size:project.format.size,references:project.format.referenceImages,layout:project.format.layout,reversePrompt:reversePromptFor(scene,project.format),onProgress:async stage=>{const now=Date.now();if(job.stage&&job.stageStartedAt)job.stageDurations={...job.stageDurations,[job.stage]:Math.max(0,now-job.stageStartedAt)};job.stage=stage;job.stageStartedAt=now;await persist();}});
      job.finishedAt=Date.now();job.durationMs=Math.max(0,job.finishedAt-job.startedAt);if(job.stage&&job.stageStartedAt)job.stageDurations={...job.stageDurations,[job.stage]:Math.max(0,job.finishedAt-job.stageStartedAt)};
      const timing={startedAt:job.startedAt,finishedAt:job.finishedAt,durationMs:job.durationMs,stages:job.stageDurations};
      await mutate(current=>({...current,scenes:current.scenes.map(scene=>{
        if(scene.id!==job.sceneId)return scene;const previous=scene.images[job.index];
        return {...scene,imageTimings:[0,1].map(index=>index===job.index?timing:scene.imageTimings?.[index]||null),images:scene.images.map((value,index)=>index===job.index?result.image:value),...(previous&&previous!==result.image?{imageHistory:[...(scene.imageHistory||[]),{index:job.index,image:previous,replacedAt:Date.now(),...(scene.imageTimings?.[job.index]?{timing:scene.imageTimings[job.index]}:{})}].slice(-200),preferredVersion:scene.preferredVersion===job.index?undefined:scene.preferredVersion}:{})};
      })}));job.status='done';
    }catch(error){if(error.code==='image_queue_full'){job.status='pending';job.retryAt=Date.now()+2000;}
      else{job.status='failed';job.error=error.message;const policy=imageFailurePolicy(error);job.errorCode=policy.code;job.diagnosticId=error.diagnosticId;
        if(policy.pauseReason){state.code=policy.code;state.pauseCode=policy.code;state.pauseReason=policy.pauseReason;state.message='出图已暂停：'+error.message;state.imagesPaused=true;state.automaticImages=false;for(const queued of state.jobs)if(queued.status==='pending'){queued.status='paused';queued.pauseReason=policy.pauseReason;}stopAnalysis=true;state.analysisPaused=true;controller?.abort();if(policy.pauseReason==='quota'&&gateFile)blockGate(gateFile,Date.now()+10*60*1000,policy.code);}
        else if(!state.imagesPaused){state.code=policy.code;state.message='此候选版本失败，剩余已选图片继续排队；失败版本可单独重试。';}
      }}
    finally{if(job.startedAt&&!job.finishedAt){job.finishedAt=Date.now();job.durationMs=Math.max(0,job.finishedAt-job.startedAt);}active.delete(job.id);updateActivity();await persist();schedulePump();}
  }
  function schedulePump(){queueMicrotask(()=>{void pump().catch(async error=>{state.code='pipeline_failed';state.pauseCode=state.code;state.pauseReason='storage';state.message=error.message;state.imagesPaused=true;for(const job of state.jobs)if(job.status==='pending'){job.status='paused';job.pauseReason='storage';}updateActivity();await persist();});});}
  async function pump(){if(pumping)return;pumping=true;try{
    if(retryTimer){clearTimeout(retryTimer);retryTimer=null;}
    // Another local channel (the comic editor) may have hit a Codex 429. Pause
    // instead of generating in parallel against the same account.
    const sharedUntil=gateFile?readGate(gateFile).until:0;
    if(sharedUntil>Date.now()){
      if(!state.imagesPaused){
        state.imagesPaused=true;state.automaticImages=false;state.code='codex_usage_limit';state.pauseCode='codex_usage_limit';state.pauseReason='quota';
        state.message='另一个生图通道触发 Codex 限流，出图已暂停到 '+new Date(sharedUntil).toLocaleTimeString('zh-CN',{hour12:false})+' 后自动继续';
        for(const queued of state.jobs)if(queued.status==='pending'){queued.status='paused';queued.pauseReason='quota';}
      }
      scheduleGateResume(sharedUntil);updateActivity();await persist();return;
    }
    while(!state.imagesPaused&&active.size<IMAGE_CONCURRENCY){
      const ready=state.jobs.filter(job=>job.status==='pending'&&(job.origin==='manual'||state.automaticImages)&&(!job.retryAt||job.retryAt<=Date.now()));
      const job=ready.find(job=>job.origin==='manual')||ready[0];if(!job)break;
      job.status='running';job.startedAt=Date.now();job.finishedAt=undefined;job.durationMs=undefined;job.stage=undefined;job.stageStartedAt=undefined;job.stageDurations=undefined;active.set(job.id,null);state.running=true;state.phase='running';state.imageActive=active.size;const promise=generateJob(job);active.set(job.id,promise);
    }
    const delayed=state.jobs.some(job=>job.status==='pending'&&(job.origin==='manual'||state.automaticImages)&&job.retryAt>Date.now());
    if(delayed&&!state.imagesPaused){retryTimer=setTimeout(schedulePump,2100);retryTimer.unref?.();}
    updateActivity();await persist();
  }finally{pumping=false;if(eligible()&&active.size<IMAGE_CONCURRENCY)schedulePump();}}
  return {state,async restore(){const saved=await readJson(file,null);if(saved)Object.assign(state,saved,{running:false,analysisRunning:false,analysisPaused:true,automaticImages:false,imagesPaused:true,pauseReason:saved.pauseReason||'restart',pauseCode:saved.pauseCode||'',imageActive:0,imageConcurrency:IMAGE_CONCURRENCY,phase:saved.running?'paused':saved.phase,jobs:(saved.jobs||[]).map(job=>({...job,...(job.status==='running'&&job.startedAt?{finishedAt:saved.updatedAt,durationMs:Math.max(0,saved.updatedAt-job.startedAt)}:{}),pauseReason:['running','pending'].includes(job.status)?'restart':job.pauseReason,origin:job.origin||'automatic',status:['running','pending'].includes(job.status)?'paused':job.status}))});},async start({automaticImages=true,oneBatch=false}={}){
    const project=await ensureProject(automaticImages);if(state.analysisRunning)return state;if(parseScript(project.text).headingOnly)throw Error('当前文件只有目录，缺少剧情正文。');
    Object.assign(state,{running:true,phase:'running',startedAt:state.startedAt||Date.now(),analysisDone:false,analysisRunning:true,analysisPaused:false,analysisCode:'',analysisMessage:'',automaticImages,imagesPaused:false,pauseReason:'',pauseCode:'',message:'整部任务已启动：每个场景生成 A/B 两版，最多八张图片并发。',code:''});stopAnalysis=false;controller=new AbortController();
    if(automaticImages)for(const batch of project.batches.filter(batch=>batch.status==='done'))enqueueJobs(imageJobs(project,undefined,batch.id),'automatic');
    await persist();void produce(oneBatch);schedulePump();return state;
  },async enqueue({sceneIds,batchId,versions=[0,1],regenerate=false}={}){
    const project=await ensureProject(),jobs=imageJobs(project,sceneIds,batchId,versions,regenerate);if(!jobs.length)return {...state,requestedJobs:0,message:'所选版本已有图片，可以直接挑选使用。'};enqueueJobs(jobs,'manual');state.imagesPaused=false;state.pauseReason='';state.pauseCode='';state.code='';state.message=regenerate?'已安排重新生成 '+jobs.length+' 张候选图；旧图保留，新图成功后替换。':'所选 '+jobs.length+' 个候选版本已加入优先出图队列。';updateActivity();await persist();schedulePump();return {...state,requestedJobs:jobs.length};
  },async resumeImages({jobIds}={}){
    const project=await ensureProject();const selected=jobIds?new Set(jobIds):null;let resumed=0;
    for(const job of state.jobs){if(job.status!=='paused'||selected&&!selected.has(job.id)||!selected&&job.origin!=='manual')continue;const scene=project.scenes.find(scene=>scene.id===job.sceneId);if(!scene)continue;if(scene.images[job.index]&&!job.regenerate){job.status='done';continue;}job.status='pending';job.origin='manual';job.pauseReason=undefined;job.retryAt=undefined;resumed++;}
    if(!resumed){updateActivity();await persist();return {...state,resumedJobs:0,message:'没有需要恢复的已选图片。'};}
    state.imagesPaused=false;state.pauseReason='';state.pauseCode='';state.code='';state.message='已恢复 '+resumed+' 张已选图片；按最多八张并发继续，不启动剧本拆解。';updateActivity();await persist();schedulePump();return {...state,resumedJobs:resumed};
  },async reconcileImages(project){if(project?.id!==state.projectId)return;let changed=false;for(const job of state.jobs)if(job.status==='failed'&&!job.regenerate&&project.scenes.find(scene=>scene.id===job.sceneId)?.images[job.index]){job.status='done';job.error=undefined;job.errorCode=undefined;changed=true;}if(changed){updateActivity();await persist();}
  },async prefer(sceneId,version){const project=await ensureProject(false);const scene=project.scenes.find(scene=>scene.id===sceneId);if(!scene)throw Error('场景不存在。');if(!scene.images[version])throw Error('此版本尚未生成，请先生成图片。');
    await mutate(project=>({...project,scenes:project.scenes.map(scene=>scene.id===sceneId?{...scene,preferredVersion:version}:scene)}));await persist();return {sceneId,preferredVersion:version,projectRevision:state.projectRevision};
  },async pause(mode='all'){
    if(mode!=='images'){stopAnalysis=true;state.analysisPaused=true;controller?.abort();state.automaticImages=false;}
    if(mode==='all'||mode==='images'){state.imagesPaused=true;state.pauseReason='user';state.pauseCode='';state.automaticImages=false;for(const job of state.jobs)if(job.status==='pending'){job.status='paused';job.pauseReason='user';}}
    state.message=mode==='analysis'?'拆解和待启动的自动出图已暂停。你可以选择场景或 A/B 版本优先出图；已开始的图片继续保存。':mode==='images'?'后续出图已暂停，拆解可继续；已开始的图片继续保存。':'整部自动任务已暂停。你可以自行选择场景和候选版本出图。';updateActivity();await persist();schedulePump();return state;
  }};
}
