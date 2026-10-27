import fs from'node:fs';import path from'node:path';import {createHash}from'node:crypto';
export const CHARACTER_COMPONENT_ORDER=['face','views','hands','prop'];
const dependencies={face:[],views:['face'],hands:['face','views'],prop:['views','hands']},labels={face:'脸部与发型',views:'全身与服装三视图',hands:'手部',prop:'配饰与武器细节'},active=new Set(['queued','running','recoverable','delegated','awaiting_confirmation']);
const digest=b=>createHash('sha256').update(b).digest('hex');
export function createCharacterComponentPipeline({folder,file,sourceBytes,editorJson,coordination,save}){
 const inFlight=new Map();
 function initialize(r){r.characterPipeline={version:1,order:[...CHARACTER_COMPONENT_ORDER],autoContinue:true};r.phases||={};for(const c of CHARACTER_COMPONENT_ORDER)r.phases[c]={status:'waiting',message:c==='face'?'准备生成脸与发型':'等待'+dependencies[c].map(d=>labels[d]).join('、')+'完成后，使用实际结果生成'};}
 async function snapshot(r,component){if(!r.finished.includes(component))throw Error('请先完成'+labels[component]+'，后续组件必须使用本次已完成图片');const bytes=await sourceBytes(r,component),sha256=digest(bytes);r.componentDependencyAssets||={};const cached=r.componentDependencyAssets[component];if(cached?.sha256===sha256)return cached;const dir=path.join(folder,r.id),target=path.join(dir,'dependency-'+component+'-'+sha256+'.png');fs.mkdirSync(dir,{recursive:true});if(!fs.existsSync(target))fs.writeFileSync(target,bytes);const asset=await editorJson('/api/assets',{method:'POST',body:{filePath:target,name:r.name+' · 本次已完成'+labels[component]}});const result={component,assetId:asset.id,sha256,createdAt:new Date().toISOString()};r.componentDependencyAssets[component]=result;save();return result;}
 async function submit(r,component,{manual=false}={}){
  if(!Object.hasOwn(dependencies,component))throw Error('人物组件无效');const key=r.id+':'+component;if(inFlight.has(key))return inFlight.get(key);
  const operation=(async()=>{
   if(r.characterPipeline?.pendingSubmission){const p=r.characterPipeline.pendingSubmission;if(!r.jobs?.[p.component]||p.previousIds.includes(r.jobs[p.component]))throw Error('上次组件提交状态待核实，请查看已有任务，不要重复生成');delete r.characterPipeline.pendingSubmission;}
   if(manual){const state=await editorJson('/api/state');if(state.jobs.some(j=>Object.values(r.jobs||{}).includes(j.id)&&active.has(j.status)))throw Error('其他组件仍在生成，请完成或取消后再重做组件，避免混用前后版本');}
   const refs=[];for(const dep of dependencies[component])refs.push(await snapshot(r,dep));
   const guidance=[...refs.map((ref,i)=>'第'+(i+1)+'张参考是【本次已完成'+labels[ref.component]+'】。'),component==='face'?'先确定同一人物的脸、年龄、发型和本次服装对应的头饰；已有本人参考时沿用身份，不重新设计脸。':component==='views'?'全身必须沿用本次已完成脸图的五官、年龄、胡须、发型和头饰；依据原身份资料保持此人的身高、骨架、胖瘦与体态，服装按当前换装要求。':component==='hands'?'手部的袖口、袖子颜色、纹样、材质、宽窄、层次与长度，及手套、护腕覆盖，以本次已完成全身三视图为唯一当前服装依据。不能沿用旧服装或自行换袖子。脸图仅用于保持肤色和年龄，不复制头部。':'从本次已完成全身与手图中提取实际出现的配饰、衣物附属物和武器细节；已有指定武器参考时精确保留其结构与剑鞘，不另造一把。只画脱离人体的真实物品，不画人物，剑柄连续完整。',refs.length?'已完成上游组件优先确定本次身份与服装，原始素材仅补充未显示的细节；不要把上游参考直接拼入输出。':''].filter(Boolean).join('\n');
   let project=await editorJson('/api/projects/'+r.projectId),stage=project.productionAssets?.find(a=>a.id===r.assetId)?.stages?.find(s=>s.id==='component-'+component);if(!stage)throw Error('人物组件步骤不存在');
   const ids=refs.map(r=>r.assetId);if(JSON.stringify(stage.componentReferenceIds||[])!==JSON.stringify(ids)||stage.componentReferenceNotes!==guidance){await editorJson('/api/projects/'+r.projectId+'/asset-production/action',{method:'POST',body:{revision:project.revision,type:'configure-component-references',assetId:r.assetId,stageId:'component-'+component,componentReferenceIds:ids,componentReferenceNotes:guidance}});project=await editorJson('/api/projects/'+r.projectId);}
   r.componentInputSnapshots||={};r.componentInputSnapshots[component]={references:refs,notes:guidance,createdAt:new Date().toISOString()};
   const marker={component,previousIds:[...Object.values(r.jobs||{}),...(r.jobHistory||[]).map(j=>j.jobId)],createdAt:new Date().toISOString()};if(r.characterPipeline)r.characterPipeline.pendingSubmission=marker;save();
   try{const result=await coordination.submit(r,component,'/api/projects/'+r.projectId+'/asset-production/generate',{method:'POST',body:{revision:project.revision,assetId:r.assetId,stageId:'component-'+component,provider:'codex'}},{assetId:r.assetId,stageId:'component-'+component});if(!result.job?.id)throw Error('组件提交结果待核实');r.jobs[component]=result.job.id;r.phases[component]={jobId:result.job.id,status:result.job.status||'queued',message:labels[component]+'已排队'+(refs.length?'，已附本次上游组件图片':'')};r.finished=r.finished.filter(c=>c!==component);if(r.characterPipeline){delete r.characterPipeline.pendingSubmission;if(manual&&!r.characterPipeline.completedAt)r.characterPipeline.autoContinue=true;}save();return result;}
   catch(error){if(r.characterPipeline&&error.status>=400&&error.status<500)delete r.characterPipeline.pendingSubmission;save();throw error;}
  })();inFlight.set(key,operation);try{return await operation;}finally{inFlight.delete(key);}
 }
 async function advance(r,state){const pipeline=r.characterPipeline;if(!pipeline||r.deletedAt||r.trashPending||r.revisionOf||!pipeline.autoContinue)return;
  if(pipeline.pendingSubmission){const p=pipeline.pendingSubmission,found=state.jobs.find(j=>j.projectId===r.projectId&&j.assetProductionRequest?.stageSnapshot?.assetId===r.assetId&&j.assetProductionRequest?.stageSnapshot?.stageId==='component-'+p.component&&!p.previousIds.includes(j.id));if(found){r.jobs[p.component]=found.id;delete pipeline.pendingSubmission;save();}else return;}
  if(CHARACTER_COMPONENT_ORDER.some(c=>['failed','cancelled'].includes(r.phases?.[c]?.status)))return;
  const next=CHARACTER_COMPONENT_ORDER.find(c=>!r.finished.includes(c));if(!next){pipeline.autoContinue=false;pipeline.completedAt=new Date().toISOString();save();return;}if(r.jobs[next])return;
  try{await coordination.run(r,()=>submit(r,next));}catch(error){const uncertain=!!pipeline.pendingSubmission;r.phases[next]={status:uncertain?'awaiting_confirmation':'failed',message:error.message};if(!uncertain)pipeline.autoContinue=false;save();}
 }
 function cancel(r){if(r.characterPipeline){r.characterPipeline.autoContinue=false;save();}}
 return {initialize,submit,advance,cancel};
}
