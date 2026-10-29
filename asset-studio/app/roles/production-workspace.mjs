import {createAssetEditorRevisionClient} from './asset-editor-revisions.mjs';
import {createProductionTrash} from './production-trash.mjs';
import {createCharacterComponentPipeline,CHARACTER_COMPONENT_ORDER} from './character-component-pipeline.mjs';
import {productionReferenceInputs} from './production-reference-inputs.mjs';
import {createProductionRevisions} from './asset-revisions.mjs';
import {createProductionCoordination} from './production-coordination.mjs';
import {createWorkspaceProject} from './workspace-project.mjs';
import fs from 'node:fs';import path from 'node:path';import {randomUUID,createHash} from 'node:crypto';import {createRequire} from 'node:module';import {spawn} from 'node:child_process';
import {sceneFrontPrompt,sceneReversePrompt,sceneAssetSpec,propAssetPrompt,asset2DStyle,ASSET_VISUAL_PROMPT_VERSION} from '../../../comic/lib/scene-asset-prompts.mjs';
import {assessSceneReverse,SCENE_SIGNATURE} from './scene-image-review.mjs';
import {characterAppearancePrompt,characterAppearanceSettings,characterRole,characterGenerationMode,CHARACTER_APPEARANCE_VERSION} from '../../../comic/lib/character-appearance.mjs';
import {assetStagePrompt} from '../../../comic/lib/asset-production.mjs';
import {CHARACTER_CARD_FRAMES,CHARACTER_CARD_SIZE} from '../../../comic/public/hand-card-rules.js';
export {sceneFrontPrompt,sceneReversePrompt};
export const CARD_FRAMES=CHARACTER_CARD_FRAMES;
// 场景可选择正视图单张，或正视图与反打上下拼版。
export const SCENE_IMAGE={width:1536,height:864};
export const SCENE_FRAMES=[{id:'scene-front',label:'正视图',index:0},{id:'scene-reverse',label:'反打',index:1}];
export const SCENE_COMPONENTS=SCENE_FRAMES.map(frame=>frame.id);
export const sceneComponents=record=>record.sceneOutputMode==='front'?['scene-front']:(record.components||SCENE_COMPONENTS);
export function sceneReverseSettings(input){const result={};for(const [key,max] of [['reverseCamera',600],['reverseDescription',6000],['reverseDetails',6000]])if(input[key]!==undefined){if(typeof input[key]!=='string'||input[key].length>max)throw Error('反打描述格式无效或过长');result[key]=input[key].trim();}return result;}
const copy=structuredClone,hash=b=>createHash('sha256').update(b).digest('hex');
export function createProductionWorkspace({root,dataDir=path.join(root,'data'),origin=()=> 'http://127.0.0.1:8796',editorJson,readBody,sendJson,studioFile,generationClient}){
 editorJson=createAssetEditorRevisionClient(editorJson);
 const workspaceProject=createWorkspaceProject({studioFile,editorJson});
 const folder=path.join(dataDir,'production-records'),index=path.join(folder,'index.json');fs.mkdirSync(folder,{recursive:true});let records=[];try{records=JSON.parse(fs.readFileSync(index,'utf8'));}catch{}
 const native=createRequire(import.meta.url)(process.env.ASSET_CANVAS_MODULE||path.resolve(root,'../../runtime/node/node_modules/@napi-rs/canvas'));
 const load=async bytes=>{if(typeof bytes==='string')bytes=fs.readFileSync(bytes);try{return await native.loadImage(bytes);}catch(original){if(!Buffer.isBuffer(bytes))throw original;const python=process.env.COMIC_PYTHON_BIN||path.resolve(root,'../../runtime/python/python.exe'),code='import sys,io\nfrom PIL import Image\nim=Image.open(io.BytesIO(sys.stdin.buffer.read())).convert("RGBA")\nim.save(sys.stdout.buffer,format="PNG")';const normalized=await new Promise((resolve,reject)=>{const child=spawn(python,['-B','-c',code],{windowsHide:true,stdio:['pipe','pipe','pipe']}),out=[];let error='';const timeout=setTimeout(()=>{child.kill();reject(Error('图片解码超时'));},30000);child.stdout.on('data',b=>out.push(b));child.stderr.on('data',b=>error=(error+b).slice(-1000));child.once('error',reject);child.once('close',code=>{clearTimeout(timeout);if(code)reject(Error('图片无法解码：'+error));else resolve(Buffer.concat(out));});child.stdin.on('error',()=>{});child.stdin.end(bytes);});return native.loadImage(normalized);}};
 const save=()=>{fs.writeFileSync(index+'.tmp',JSON.stringify(records,null,2));fs.renameSync(index+'.tmp',index);};
 const coordination=createProductionCoordination({root,dataDir,records,save,editorJson,refresh:(r,state)=>refresh(r,state),...(generationClient?{client:generationClient}:{})});
 // Copies and mirrors, including minor relighting, are rejected before replacing a component.
 const SIGNATURE=SCENE_SIGNATURE;
 async function signatureOf(bytes){
  const image=await load(bytes),canvas=native.createCanvas(SIGNATURE.width,SIGNATURE.height),ctx=canvas.getContext('2d');ctx.drawImage(image,0,0,SIGNATURE.width,SIGNATURE.height);
  const data=ctx.getImageData(0,0,SIGNATURE.width,SIGNATURE.height).data,out=new Float32Array(SIGNATURE.width*SIGNATURE.height);
  for(let i=0;i<out.length;i++){const o=i*4;out[i]=data[o]*0.299+data[o+1]*0.587+data[o+2]*0.114;}
  return out;
 }
 async function sceneReverseFault(r,bytes){
  const frontSlot=r.slots?.['scene-front']?'scene-front':r.slots?.scene?'scene':null;
  if(!frontSlot||!fs.existsSync(file(r,frontSlot)))return '';
  const front=await signatureOf(fs.readFileSync(file(r,frontSlot))),reverse=await signatureOf(bytes);
  r.sceneReverseReview=assessSceneReverse(front,reverse);
  return r.sceneReverseReview.reason;
 }
 const archiveRejected=(r,slot,bytes)=>{const archive=path.join(folder,r.id,'history');fs.mkdirSync(archive,{recursive:true});fs.writeFileSync(path.join(archive,slot+'-rejected-'+hash(bytes)+'.png'),bytes);};
 const find=id=>{const r=records.find(r=>r.id===id);if(!r)throw Error('生成记录不存在');return r;};
 const file=(r,slot)=>path.join(folder,r.id,slot+'.png');
 function image(r,slot,bytes){fs.mkdirSync(path.dirname(file(r,slot)),{recursive:true});if(fs.existsSync(file(r,slot))){const old=fs.readFileSync(file(r,slot)),archive=path.join(folder,r.id,'history');fs.mkdirSync(archive,{recursive:true});fs.writeFileSync(path.join(archive,slot+'-'+hash(old)+'.png'),old);}fs.writeFileSync(file(r,slot),bytes);r.slots[slot]={zoom:1,ox:0,oy:0,sha256:hash(bytes)};}
 const singleCard=r=>r.type==='character'&&r.characterOutputMode==='card';
 const stageId=(r,component)=>component==='role-card'?'role-card':'component-'+component;
 async function composeSingleCard(r){
  if(!r.slots['role-card']||!fs.existsSync(file(r,'role-card')))return;
  const bytes=fs.readFileSync(file(r,'role-card')),img=await load(bytes),slot=r.slots['role-card'];let output=bytes;
  if(slot.zoom!==1||slot.ox||slot.oy){const c=native.createCanvas(img.width,img.height),ctx=c.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,c.width,c.height);const scale=slot.zoom||1,w=img.width*scale,h=img.height*scale;ctx.drawImage(img,(img.width-w)/2+(slot.ox||0),(img.height-h)/2+(slot.oy||0),w,h);output=c.toBuffer('image/png');}
  if(fs.existsSync(file(r,'card'))&&hash(fs.readFileSync(file(r,'card')))!==hash(output))archiveRejected(r,'card',fs.readFileSync(file(r,'card')));
  fs.writeFileSync(file(r,'card'),output);r.width=img.width;r.height=img.height;r.sha256=hash(output);r.updatedAt=new Date().toISOString();
 }
 async function compose(r){
  // Failed records may have no component folder yet. Saving their configuration
  // must not attempt to publish an empty card or overwrite a previous preview.
  if(!CARD_FRAMES.some(frame=>r.slots?.[frame.id]&&fs.existsSync(file(r,frame.id))))return;
  const canvas=native.createCanvas(CHARACTER_CARD_SIZE.width,CHARACTER_CARD_SIZE.height),ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.fillStyle='#1c2a3a';ctx.font='700 56px "Microsoft YaHei"';ctx.textBaseline='top';ctx.fillText(r.boardTitle||r.name+'｜'+r.outfit,48,18);
  for(const frame of CARD_FRAMES){const state=r.slots[frame.id];if(!state||!fs.existsSync(file(r,frame.id)))continue;const img=await load(file(r,frame.id)),scale=Math.min(frame.w/img.width,frame.h/img.height)*state.zoom,w=img.width*scale,h=img.height*scale;ctx.save();ctx.beginPath();ctx.rect(frame.x,frame.y,frame.w,frame.h);ctx.clip();ctx.drawImage(img,frame.x+(frame.w-w)/2+state.ox,frame.y+(frame.h-h)/2+state.oy,w,h);ctx.restore();}
  ctx.fillStyle='#3c464e';ctx.font='34px "Microsoft YaHei"';ctx.textAlign='center';for(const [id,label]of [['front','正面'],['side','四分之三侧面'],['back','背面']]){const frame=CARD_FRAMES.find(f=>f.id===id);ctx.fillText(label,frame.x+frame.w/2,1800);}
  fs.writeFileSync(file(r,'card'),canvas.toBuffer('image/png'));r.width=3840;r.height=1890;r.sha256=hash(fs.readFileSync(file(r,'card')));r.updatedAt=new Date().toISOString();
 }
 // User-selected front-only output has no empty reverse area. Source component files remain intact.
 async function composeScene(r){
  const frames=r.sceneOutputMode==='front'?SCENE_FRAMES.slice(0,1):SCENE_FRAMES,ready=frames.filter(frame=>r.slots?.[frame.id]&&fs.existsSync(file(r,frame.id)));
  if(ready.length<frames.length)return;
  const width=SCENE_IMAGE.width,height=SCENE_IMAGE.height,canvas=native.createCanvas(width,height*frames.length),ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,width,canvas.height);
  for(const frame of ready){const state=r.slots[frame.id]||{},img=await load(file(r,frame.id)),base=Math.max(width/img.width,height/img.height),zoom=base*(state.zoom||1),w=img.width*zoom,h=img.height*zoom,top=frame.index*height;ctx.save();ctx.beginPath();ctx.rect(0,top,width,height);ctx.clip();ctx.drawImage(img,(width-w)/2+(state.ox||0),top+(height-h)/2+(state.oy||0),w,h);ctx.restore();}
  const bytes=canvas.toBuffer('image/png'),card=file(r,'card');if(fs.existsSync(card)){const old=fs.readFileSync(card);if(hash(old)!==hash(bytes))archiveRejected(r,'card',old);}fs.writeFileSync(card,bytes);r.width=width;r.height=height*frames.length;r.sha256=hash(bytes);r.updatedAt=new Date().toISOString();
 }
 function sceneStatus(r){const required=sceneComponents(r),phases=Object.entries(r.phases||{}).filter(([id])=>required.includes(id)),pending=phases.some(([,p])=>activeStatuses.has(p.status)),failures=phases.filter(([,p])=>['failed','cancelled'].includes(p.status));r.status=pending?'running':failures.length?'failed':required.every(id=>r.slots[id]||r.finished.includes(id))?'completed':'editing';r.error=failures.map(([id,p])=>componentLabels[id]+'：'+p.message).join('；')||null;}
 // 场景按“两幅 16:9”提交：正视图走普通画格任务，反打以本版正视图为唯一参考再提交一次。
 async function submitSceneImage(r,slot,prompt,referenceIds){
  const project=await editorJson('/api/projects/'+r.projectId),stamp=new Date().toISOString().replace(/[-:T]/g,'').slice(0,14),shotId='shot_'+randomUUID(),panelId='panel_'+randomUUID(),pageId='page_'+randomUUID(),width=SCENE_IMAGE.width,height=SCENE_IMAGE.height,refs=(referenceIds||[]).filter(Boolean),label=slot==='scene-front'?'正视图':'反打';
  const assetVisualContract={role:'scene',view:slot,version:ASSET_VISUAL_PROMPT_VERSION};
  project.shots.push({id:shotId,code:'SCENE-'+stamp,title:r.name+' · '+label,description:prompt,dialogue:'',referenceIds:refs,assetVisualContract});
  project.pages.push({id:pageId,name:'场景 · '+r.name+' · '+label+' · '+stamp,width:project.layerSchema===1?1280:width,height,background:'#ffffff',layoutPreset:'custom',storyboard:{episode:0,projection:'asset'},panels:[{id:panelId,shotId,name:'scene:'+r.name+':'+slot,x:0,y:0,w:width,h:height,points:[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}],kind:'panel',border:0,borderColor:'#242830',feather:0,visible:true,locked:false,candidates:[],referenceIds:refs}],bubbles:[]});
  await editorJson('/api/projects/'+r.projectId,{method:'PUT',body:project,timeout:60000});
  let jobs;
  try{jobs=await coordination.submit(r,slot,'/api/jobs',{method:'POST',body:{projectId:r.projectId,panelIds:[panelId],provider:'codex',action:'generate'},timeout:60000},{panelId});}
  catch(error){
   // 任务没排上（如 Codex 路由超时）：撤回刚加的空场景页，别在工程里留孤儿页。
   try{const current=await editorJson('/api/projects/'+r.projectId);current.pages=current.pages.filter(page=>page.id!==pageId);current.shots=current.shots.filter(shot=>shot.id!==shotId);await editorJson('/api/projects/'+r.projectId,{method:'PUT',body:current,timeout:60000});}catch{}
   throw error;
  }
  r.jobs[slot]=jobs[0].id;save();
  r.promptVersion=ASSET_VISUAL_PROMPT_VERSION;if(slot==='scene-front')r.scenePlan=sceneAssetSpec(r).plan;r.generatedPrompts||={};r.generatedPrompts[slot]={prompt,referenceIds:refs,frontAssetId:slot==='scene-reverse'?refs[0]:undefined,createdAt:new Date().toISOString(),version:ASSET_VISUAL_PROMPT_VERSION};
  return {jobId:jobs[0].id,pageId,panelId};
 }
 const activeStatuses=new Set(['queued','running','awaiting_confirmation','recoverable','delegated']);
 const componentLabels={'role-card':'整张角色卡',face:'脸部',views:'三视图',hands:'手部',prop:'道具配饰',scene:'场景','scene-front':'场景正视图','scene-reverse':'场景反打'};
 const refreshing=new Map(),submissions=new Map();
 async function saveCharacterSettings(r,input){
  const settings=characterAppearanceSettings(input),changed=Object.entries(settings).some(([key,value])=>(r[key]||(key==='characterRole'?'auto':''))!==value),promptChanged=input.prompt!==undefined&&input.prompt!==r.prompt;
  if(input.prompt!==undefined&&(typeof input.prompt!=='string'||input.prompt.length>100000))throw Error('人物描述过长或格式无效');
  if(!changed&&!promptChanged)return;
  const p=await editorJson('/api/projects/'+r.projectId),asset=(p.productionAssets||[]).find(a=>a.id===r.assetId);if(!asset)throw Error('人物资产记录不存在，请重新打开记录');
  const state=await editorJson('/api/state');if(state.jobs.some(j=>Object.values(r.jobs||{}).includes(j.id)&&activeStatuses.has(j.status)))throw Error('人物组件仍在生成，请完成或取消后再修改人物定位');
  await editorJson('/api/projects/'+r.projectId+'/asset-production/action',{method:'POST',body:{revision:p.revision,assetId:r.assetId,type:'configure',...settings,...(promptChanged?{description:input.prompt}:{})}});
  Object.assign(r,settings);if(promptChanged){r.originalPrompt??=r.prompt;r.prompt=input.prompt;}
 }
 async function refreshRecord(r,state){
  if(!Object.keys(r.jobs).length)return r;if(r.revisionOf)r.revisionOf.submissionState='submitted';
  state||=await editorJson('/api/state');const before=JSON.stringify(r);let changedImage=false;
  // 旧记录的单张场景主景也能当正视图用：记下它的图片编号，反打才能以它为唯一参考。
  if(r.type==='scene'&&!r.sceneAssets?.front&&r.jobs?.scene){const legacy=state.jobs.find(j=>j.id===r.jobs.scene);if(legacy?.status==='done'&&legacy.assetId)r.sceneAssets={...(r.sceneAssets||{}),front:legacy.assetId};}
  for(const [component,id]of Object.entries(r.jobs)){
   if(component==='scene-reverse'&&(r.sceneOutputMode==='front'||r.dismissedSceneReverseJobId===id&&!r.manualComponents?.[component])){r.phases[component]={jobId:id,status:'omitted',message:'已移除反打，按选定场景输出'};continue;}
   if(r.manualComponents?.[component]){r.phases[component]={status:'done',message:'已采用上传的组件'};continue;}
   const job=state.jobs.find(j=>j.id===id);
   if(!job){if(!r.finished.includes(component))r.phases[component]={jobId:id,status:'failed',message:'任务记录已清理，可重新生成；已有图片保留'};continue;}
   r.phases[component]={jobId:id,status:job.status,message:job.message,updated:job.updated};
   if(r.rejectedComponents?.[component]?.jobId===id){r.phases[component]={...r.phases[component],status:'failed',message:r.rejectedComponents[component].message};continue;}
   if(job.status!=='done'||r.finished.includes(component))continue;
   const response=await fetch((process.env.ASSET_EDITOR||'http://127.0.0.1:18909')+'/assets/'+job.assetId);if(!response.ok)throw Error('组件原图暂不可读');const bytes=Buffer.from(await response.arrayBuffer());
   if(component==='scene-reverse'){
    const fault=await sceneReverseFault(r,bytes);
    if(fault){
     archiveRejected(r,'scene-reverse',bytes);
     const message=fault+'，已退回：反打必须从另一侧机位重新画同一空间，不能镜像或复用正视图。';
     r.rejectedComponents||={};r.rejectedComponents[component]={jobId:id,message,rejectedAt:new Date().toISOString()};
     r.phases[component]={...r.phases[component],status:'failed',message};continue;
    }
   }
   if(await revisions.applyResult(r,component,bytes)){}else if(component==='views'){
    const img=await load(bytes);
    if(img.width/img.height<1.2){const message='三视图返回了竖图，已保留原图，请重新生成三视图';image(r,'views-original',bytes);r.rejectedComponents||={};r.rejectedComponents[component]={jobId:id,message};r.phases[component]={...r.phases[component],status:'failed',message};continue;}
    for(const [i,name]of ['front','side','back'].entries()){const w=Math.floor(img.width/3),c=native.createCanvas(w,img.height);c.getContext('2d').drawImage(img,i*w,0,w,img.height,0,0,w,img.height);image(r,name,c.toBuffer('image/png'));}
   }else image(r,component,bytes);
   if(r.type==='scene'){if(component==='scene-front')r.sceneAssets={...(r.sceneAssets||{}),front:job.assetId};else if(component==='scene-reverse')r.sceneAssets={...(r.sceneAssets||{}),reverse:job.assetId};}
   r.finished.push(component);changedImage=true;
  }
  // 正视图完成后自动以它为唯一参考排队反打；失败不阻塞正视图，可在组件上重试。
  // 只对已经升级成两幅 16:9 的场景生效；旧单图记录等用户点“重新生成正视图”再升级。
  if(r.type==='scene'&&r.sceneOutputMode!=='front'&&(r.components||[]).includes('scene-front')&&r.finished.includes('scene-front')&&r.sceneAssets?.front&&!r.jobs['scene-reverse']&&!r.finished.includes('scene-reverse')&&!r.sceneReverseSubmitted){
   r.sceneReverseSubmitted=true;save();
   try{const project=await editorJson('/api/projects/'+r.projectId),job=await coordination.run(r,()=>submitSceneImage(r,'scene-reverse',sceneReversePrompt(r,project),[r.sceneAssets.front]));r.jobs['scene-reverse']=job.jobId;r.phases['scene-reverse']={jobId:job.jobId,status:'queued',message:'正视图完成，已自动排队反打'};r.status='running';}
   catch(error){r.sceneReverseSubmitted=false;r.phases['scene-reverse']={status:'failed',message:'反打提交失败：'+error.message};}
   save();
  }
  await characterPipeline.advance(r,state);
  const phases=Object.entries(r.phases),pending=phases.some(([,p])=>activeStatuses.has(p.status)),failures=phases.filter(([,p])=>['failed','cancelled'].includes(p.status));
  r.status=pending?'running':failures.length?'failed':r.finished.length===(r.components?.length||Object.keys(r.jobs).length)?'completed':'running';
  r.error=failures.map(([id,p])=>componentLabels[id]+'：'+p.message).join('；')||null;
  if(r.type==='scene')sceneStatus(r);
  if(changedImage){if(singleCard(r))await composeSingleCard(r);else if(r.type==='character')await compose(r);else if(r.type==='scene')await composeScene(r);else{fs.copyFileSync(file(r,r.type),file(r,'card'));const img=await load(file(r,r.type));r.width=img.width;r.height=img.height;r.updatedAt=new Date().toISOString();}}
  delete r.connectionError;if(JSON.stringify(r)!==before)save();return r;
 }
 async function refresh(r,state){if(refreshing.has(r.id))return refreshing.get(r.id);const operation=refreshRecord(r,state);refreshing.set(r.id,operation);try{return await operation;}finally{refreshing.delete(r.id);}}
 async function submitComponent(r,input){if(r.revisionOf){if(input.action!=='cancel')throw Error('请用修改意见继续修改这张图片');const ownJobs=Object.values(r.jobs);if(input.jobId&&!ownJobs.includes(input.jobId))throw Error('修改任务已改变，请刷新后重试');const jobId=input.jobId||ownJobs[0];if(jobId)await editorJson('/api/jobs/'+jobId+'/cancel',{method:'POST',body:{}});return view(await refresh(r));}return input.action==='cancel'?submitComponentInner(r,input):coordination.run(r,()=>submitComponentInner(r,input),input.requestId);}
 async function submitComponentInner(r,input){
  const component=['front','side','back'].includes(input.component)?'views':input.component;
   if(SCENE_COMPONENTS.includes(component)){
    const key=r.id+':'+component;if(submissions.has(key)){await submissions.get(key);return {...view(r),reusedJob:true};}
    const operation=submitSceneComponent(r,component,input);submissions.set(key,operation);try{return await operation;}finally{submissions.delete(key);}
   }
  if(!(r.components||[]).includes(component))throw Error('组件不存在');if(r.type==='character'&&characterGenerationMode(r)==='card'&&!singleCard(r)&&input.action!=='cancel')throw Error('普通人物请点击“生成整张角色卡”，旧组件记录保留');
  const key=r.id+':'+component;
  if(submissions.has(key)){await submissions.get(key);return {...view(r),reusedJob:true};}
  const operation=(async()=>{
   const state=await editorJson('/api/state');await refresh(r,state);
   const active=state.jobs.find(j=>j.projectId===r.projectId&&j.assetProductionRequest?.stageSnapshot?.assetId===r.assetId&&j.assetProductionRequest?.stageSnapshot?.stageId===stageId(r,component)&&activeStatuses.has(j.status));
   if(input.action==='cancel'){
    characterPipeline.cancel(r);
    if(!active)return view(r);
    if(input.jobId&&input.jobId!==active.id)throw Error('组件任务已改变，请刷新后重试');
    await editorJson('/api/jobs/'+active.id+'/cancel',{method:'POST',body:{}});await refresh(r);return view(r);
   }
   if(active){r.jobs[component]=active.id;r.phases[component]={jobId:active.id,status:active.status,message:active.message};r.status='running';save();return {...view(r),reusedJob:true};}
   if(input.requestId&&r.componentRequests?.[component]?.requestId===input.requestId)return {...view(r),reusedJob:true};
   const previousJob=r.jobs[component],previousPhase=copy(r.phases[component]);const p=await editorJson('/api/projects/'+r.projectId),result=r.type==='character'&&!singleCard(r)&&CHARACTER_COMPONENT_ORDER.includes(component)?await characterPipeline.submit(r,component,{manual:true}):await coordination.submit(r,component,'/api/projects/'+r.projectId+'/asset-production/generate',{method:'POST',body:{revision:p.revision,assetId:r.assetId,stageId:stageId(r,component),provider:'codex'}},{assetId:r.assetId,stageId:stageId(r,component)});
   r.jobHistory||=[];if(previousJob)r.jobHistory.push({component,jobId:previousJob,phase:previousPhase,replacedAt:new Date().toISOString()});
   r.jobs[component]=result.job.id;r.phases[component]={jobId:result.job.id,status:result.job.status||'queued',message:result.job.message||'已排队'};r.finished=r.finished.filter(c=>c!==component);r.status='running';
   r.componentRequests||={};r.componentRequests[component]={requestId:input.requestId,jobId:result.job.id};delete r.rejectedComponents?.[component];save();return view(r);
  })();submissions.set(key,operation);try{return await operation;}finally{submissions.delete(key);}
 }
 function view(r){const result=copy(r);if(result.teamClaim)delete result.teamClaim.token;delete result.teamRequestId;if(r.type==='character'){result.effectiveCharacterRole=characterRole(r);result.appearanceRuleVersion=CHARACTER_APPEARANCE_VERSION;result.characterOutputMode=r.characterOutputMode||'components';result.recommendedCharacterOutputMode=characterGenerationMode(r);}if(r.type==='scene'){const allowed=sceneComponents(r);result.sceneOutputMode=r.sceneOutputMode||'both';result.components=allowed;result.phases=Object.fromEntries(Object.entries(result.phases||{}).filter(([id,p])=>allowed.includes(id)&&p.status!=='omitted'));result.finished=(result.finished||[]).filter(id=>allowed.includes(id));if(r.sceneOutputMode==='front')delete result.slots['scene-reverse'];}return {...result,imageUrl:fs.existsSync(file(r,'card'))?'/api/production-records/'+r.id+'/image?slot=card':r.legacy?'/api/production-records/'+r.id+'/image?slot=free':null,url:origin()+'/?record='+r.id,references:(r.referenceIds||[]).map((id,i)=>'/api/production-records/'+r.id+'/image?slot=reference'+i),slots:Object.fromEntries(Object.entries(result.slots).map(([id,slot])=>[id,{...slot,url:'/api/production-records/'+r.id+'/image?slot='+id}]))};}

 async function submitSceneComponent(r,component,input){
  if(input.action==='cancel'){
   const jobId=r.jobs[component];
   if(jobId){try{await editorJson('/api/jobs/'+jobId+'/cancel',{method:'POST',body:{}});}catch{}}
    delete r.jobs[component];r.phases[component]={status:'cancelled',message:'已取消，可重新生成'};if(component==='scene-reverse')r.sceneReverseSubmitted=true;save();return view(await refresh(r));
  }
   const state=await editorJson('/api/state'),active=state.jobs.find(j=>j.id===r.jobs[component]&&activeStatuses.has(j.status));
   if(active){r.phases[component]={jobId:active.id,status:active.status,message:active.message};return {...view(r),reusedJob:true};}
   if(input.requestId&&r.componentRequests?.[component]?.requestId===input.requestId)return {...view(r),reusedJob:true};
  const project=await editorJson('/api/projects/'+r.projectId);
  let front=r.sceneAssets?.front;if(component==='scene-reverse'&&!front&&r.slots['scene-front']&&fs.existsSync(file(r,'scene-front'))){const bytes=fs.readFileSync(file(r,'scene-front')),snapshot=path.join(path.dirname(file(r,'scene-front')),'front-reference-'+hash(bytes)+'.png');if(!fs.existsSync(snapshot))fs.writeFileSync(snapshot,bytes);const asset=await editorJson('/api/assets',{method:'POST',body:{filePath:snapshot,name:r.name+' · 上传正视图参考'}});front=asset.id;r.sceneAssets={...(r.sceneAssets||{}),front};save();}
   if(component==='scene-reverse'&&(!front||activeStatuses.has(r.phases['scene-front']?.status)))throw Error('请先完成本版正视图；反打只能以本版正视图为唯一参考');
  // 先提交任务，成功后再改记录：提交失败时记录保持原样，旧图不动。
  const job=await submitSceneImage(r,component,component==='scene-front'?sceneFrontPrompt(r,project):sceneReversePrompt(r,project),component==='scene-front'?r.referenceIds:[front]);
  if(component==='scene-reverse'){r.sceneOutputMode='both';delete r.dismissedSceneReverseJobId;}if(r.manualComponents)delete r.manualComponents[component];
  // 旧记录只有一张 3:2 场景主景（components=['scene']）；第一次重生成时升级成两幅 16:9。
  r.components=[...SCENE_COMPONENTS];
  r.finished=(r.finished||[]).filter(id=>id!=='scene');
  delete r.jobs['scene'];delete r.phases['scene'];
  if(component==='scene-front'){
   // 新正视图 = 新空间锚点，旧反打与旧拼版一起作废，避免拼出两个空间。
   r.finished=r.finished.filter(id=>id!=='scene-front'&&id!=='scene-reverse');
   delete r.jobs['scene-reverse'];delete r.phases['scene-reverse'];delete r.slots['scene-reverse'];
   if(r.sceneAssets){delete r.sceneAssets.reverse;delete r.sceneAssets.front;}r.sceneReverseSubmitted=false;
   try{fs.rmSync(file(r,'card'));}catch{}
  }else r.finished=r.finished.filter(id=>id!=='scene-reverse');
   r.jobs[component]=job.jobId;r.phases[component]={jobId:job.jobId,status:'queued',message:'已排队'};r.componentRequests||={};r.componentRequests[component]={requestId:input.requestId,jobId:job.jobId};delete r.rejectedComponents?.[component];r.status='running';save();return view(r);
 }
 const pending=new Map();
 async function create(input){
  if(!input.requestId||!/^[\w-]{8,180}$/.test(input.requestId))throw Error('生成请求编号无效');if(pending.has(input.requestId))return pending.get(input.requestId);const prior=records.find(r=>r.requestId===input.requestId);if(prior)return view(await refresh(prior));
  const operation=(async()=>{const type=['character','scene','prop'].includes(input.type)?input.type:'character',name=String(input.name||'').trim(),prompt=String(input.prompt||'').trim();if(!name||!prompt)throw Error('请填写资产名称和要求');const projectId=await workspaceProject.ensure();
   const referenceInputs=productionReferenceInputs(input);const r={id:'production_'+randomUUID(),requestId:input.requestId,name,type,outfit:String(input.outfit||''),prompt,referenceIds:referenceInputs.referenceIds,source:input.source||null,projectId,status:'queued',createdAt:new Date().toISOString(),jobs:{},phases:{},finished:[],slots:{}};if(type==='character')Object.assign(r,characterAppearanceSettings(input));if(type==='character')r.characterOutputMode=characterGenerationMode(r);r.components=type==='character'?(singleCard(r)?['role-card']:['face','views','hands','prop']):type==='scene'?[...SCENE_COMPONENTS]:[type];r.assetId='card_'+r.id;records.push(r);save();return coordination.run(r,async()=>{for(const value of referenceInputs.uploadReferences){if(r.referenceIds.length>=3)break;const m=/^data:image\/(?:png|jpeg|webp);base64,([\w+/=\r\n]+)$/.exec(value);if(!m)throw Error('参考图无效');const bytes=Buffer.from(m[1],'base64'),img=await load(bytes),target=path.join(folder,'reference-'+hash(bytes)+'.png'),c=native.createCanvas(img.width,img.height);c.getContext('2d').drawImage(img,0,0);fs.writeFileSync(target,c.toBuffer('image/png'));const registered=await editorJson('/api/assets',{method:'POST',body:{filePath:target,name:name+' · 身份服装参考'}});if(!r.referenceIds.includes(registered.id))r.referenceIds.push(registered.id);}for(const id of referenceInputs.extraReferenceIds)if(!r.referenceIds.includes(id))r.referenceIds.push(id);save();
   for(const [i,id]of r.referenceIds.entries()){const res=await fetch((process.env.ASSET_EDITOR||'http://127.0.0.1:18909')+'/assets/'+id);if(!res.ok)throw Error('身份参考不可读');fs.mkdirSync(path.dirname(file(r,'reference'+i)),{recursive:true});fs.writeFileSync(file(r,'reference'+i),Buffer.from(await res.arrayBuffer()));}
   if(type==='scene'){if(input.sceneOutputMode!==undefined&&!['front','both'].includes(input.sceneOutputMode))throw Error('场景输出方式无效');r.sceneOutputMode=input.sceneOutputMode||'both';r.components=r.sceneOutputMode==='front'?['scene-front']:[...SCENE_COMPONENTS];Object.assign(r,sceneReverseSettings(input));const meta=input.sceneMeta||{},clean={camera:String(meta.camera||'').trim().slice(0,80),time:String(meta.time||'').trim().slice(0,80),weather:String(meta.weather||'').trim().slice(0,80)};if(clean.camera||clean.time||clean.weather){r.sceneMeta=clean;save();}}
   if(type==='scene'){
    // 场景不再出一张“场景主景”：先生成 16:9 正视图，完成后再自动以它为唯一参考出反打，最后本机拼成 8:9 竖版。
    const project=await editorJson('/api/projects/'+projectId),job=await submitSceneImage(r,'scene-front',sceneFrontPrompt(r,project),r.referenceIds);
    r.jobs['scene-front']=job.jobId;r.phases['scene-front']={jobId:job.jobId,status:'queued',message:'已排队'};save();return view(r);
   }
   let p=await editorJson('/api/projects/'+projectId);await editorJson('/api/projects/'+projectId+'/asset-production/action',{method:'POST',body:{revision:p.revision,type:'create-editable-card',assetId:r.assetId,name,role:type,description:type==='prop'?propAssetPrompt(r,p):prompt,prompt:type==='character'&&r.outfit?'服装与状态：'+r.outfit:'',referenceIds:r.referenceIds,...(type==='character'?{...characterAppearanceSettings(r),characterOutputMode:r.characterOutputMode}:{})}});
   if(type==='character'&&!singleCard(r)){characterPipeline.initialize(r);save();await characterPipeline.submit(r,'face');return view(r);}
   for(const component of r.components){p=await editorJson('/api/projects/'+projectId);const result=await coordination.submit(r,component,'/api/projects/'+projectId+'/asset-production/generate',{method:'POST',body:{revision:p.revision,assetId:r.assetId,stageId:stageId(r,component),provider:'codex'}},{assetId:r.assetId,stageId:stageId(r,component)});r.jobs[component]=result.job.id;save();}return view(r);},input.requestId);
  })();pending.set(input.requestId,operation);try{return await operation;}catch(error){const r=records.find(r=>r.requestId===input.requestId);if(r){if(error.code==='asset_generation_occupied'&&!r.teamClaim&&!Object.keys(r.jobs).length)records.splice(records.indexOf(r),1);else{r.status='failed';r.error=error.message;}save();}throw error;}finally{pending.delete(input.requestId);}
 }
 const revisions=createProductionRevisions({records,folder,file,load,native,editorJson,coordination,view,refresh,save,image});
 const characterPipeline=createCharacterComponentPipeline({folder,file,sourceBytes:revisions.sourceBytes,editorJson,coordination,save});
 const trash=createProductionTrash({editorJson,save,view});
 return {create,refresh,records,composeScene,coordination,forceStop(){coordination.close();for(const r of records)if(Object.values(r.phases||{}).some(p=>activeStatuses.has(p.status))){r.status='cancelled';r.sceneReverseSubmitted=true;r.error='主机强制升级，已停止本机任务';for(const p of Object.values(r.phases||{}))if(activeStatuses.has(p.status)){p.status='cancelled';p.message=r.error;}}save();},close:()=>coordination.close(),async handle(req,res,url){
  if(!url.pathname.startsWith('/api/production-records'))return false;
   if(url.pathname==='/api/production-records/prompt-preview'&&req.method==='POST'){
    const input=await readBody(req);if(!['character','scene','prop'].includes(input.type)||typeof input.prompt!=='string'||input.prompt.length>100000||typeof input.name!=='string'||input.name.length>180)throw Error('资产提示词预览参数无效');
    const config=JSON.parse(fs.readFileSync(studioFile,'utf8')),project=await editorJson('/api/projects/'+config.projectId),stored=records.find(r=>r.id===input.recordId),record={...stored,...input,...sceneReverseSettings(input),...characterAppearanceSettings(input)};
    if(input.type==='character'){const asset={type:'character',name:record.name,description:record.prompt,prompt:record.outfit?'服装与状态：'+record.outfit:'',...characterAppearanceSettings(record),workflow:{kind:'simple'}};sendJson(res,200,{version:CHARACTER_APPEARANCE_VERSION,effectiveCharacterRole:characterRole(asset),appearance:characterAppearancePrompt(asset),characterOutputMode:characterGenerationMode(record),components:characterGenerationMode(record)==='card'?{'role-card':assetStagePrompt(project,asset,{id:'role-card'})}:Object.fromEntries(['face','views','hands','prop'].map(component=>[component,assetStagePrompt(project,asset,{component})]))});return true;}
    sendJson(res,200,{version:ASSET_VISUAL_PROMPT_VERSION,style:asset2DStyle(project.style),...(input.type==='scene'?{front:sceneFrontPrompt(record,project),reverse:sceneReversePrompt(record,project),spec:sceneAssetSpec(record)}:{prop:propAssetPrompt(record,project)})});return true;
   }
  if(url.pathname==='/api/production-records/import-legacy'&&req.method==='POST'){const input=await readBody(req),bytes=Buffer.from(input.imageBase64||'','base64');await load(bytes);const existing=records.find(r=>r.source?.taskId===input.source?.taskId);if(existing){sendJson(res,200,view(existing));return true;}const r={id:'production_'+randomUUID(),requestId:'legacy-'+input.source.taskId,name:input.name,outfit:input.outfit||'',prompt:input.prompt||'',referenceIds:input.referenceIds||[],type:'character',legacy:true,status:'legacy',source:input.source,createdAt:new Date().toISOString(),jobs:{},phases:{},finished:[],slots:{}};image(r,'free',bytes);for(const [i,id]of r.referenceIds.entries()){const response=await fetch((process.env.ASSET_EDITOR||'http://127.0.0.1:18909')+'/assets/'+id);if(!response.ok)throw Error('旧身份参考不可读');fs.writeFileSync(file(r,'reference'+i),Buffer.from(await response.arrayBuffer()));}records.push(r);save();sendJson(res,201,view(r));return true;}
  const match=/^\/api\/production-records(?:\/(production_[a-f0-9-]{36})(?:\/(image|board|component|source|revise|trash|restore))?)?$/.exec(url.pathname);if(!match)throw Error('生成记录地址无效');
  if(req.method==='GET'&&!match[1]){let state;try{if(records.some(r=>Object.keys(r.jobs).length))state=await editorJson('/api/state');for(const r of records.filter(r=>!r.deletedAt))await refresh(r,state);}catch(e){for(const r of records)r.connectionError=e.message;}sendJson(res,200,{items:records.filter(r=>url.searchParams.get('includeTrashed')==='1'||!r.deletedAt).slice().sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))).map(view)});return true;}
  if(req.method==='POST'&&!match[1]){sendJson(res,202,await create(await readBody(req)));return true;}
  const r=find(match[1]);
  if(req.method==='POST'&&match[2]==='trash'){sendJson(res,200,await trash.trash(r,await readBody(req)));return true;}
  if(req.method==='POST'&&match[2]==='restore'){sendJson(res,200,trash.restore(r));return true;}
  if(r.deletedAt&&['POST','PUT'].includes(req.method))throw Error('该版本在回收站，请先恢复后编辑');
  if(req.method==='POST'&&match[2]==='revise'){sendJson(res,202,await revisions.revise(r,await readBody(req)));return true;}
  if(req.method==='GET'&&match[2]==='image'){const slot=url.searchParams.get('slot')||'card';if(!/^reference[0-2]$/.test(slot)&&!['card','role-card','face','front','side','back','hands','prop','scene','scene-front','scene-reverse','free','injury','handprop','views','views-original'].includes(slot))throw Error('组件不存在');const bytes=slot==='views'||url.searchParams.get('cell')?await revisions.sourceBytes(r,slot,url.searchParams.get('cell')||''):fs.readFileSync(file(r,slot));res.writeHead(200,{'Content-Type':'image/png','Cache-Control':'no-store'});res.end(bytes);return true;}
  if(req.method==='POST'&&match[2]==='component'){sendJson(res,202,await submitComponent(r,await readBody(req)));return true;}
  if(req.method==='POST'&&match[2]==='source'){
   const input=await readBody(req);
   if(input.sceneConfirmed!==true&&!input.scene)throw Error('场景来源确认值无效');
   if(input.scene){const s=input.scene;r.source={...(r.source||{}),scene:{location:String(s.location||'').slice(0,80),kind:String(s.kind||'').slice(0,20),sourceCode:String(s.sourceCode||'').slice(0,40),quote:String(s.quote||'').slice(0,200),note:String(s.note||'').slice(0,200)}};}
   if(input.sceneConfirmed===true)r.source={...(r.source||{}),sceneConfirmed:true,sceneConfirmedAt:new Date().toISOString()};
   save();sendJson(res,200,view(r));return true;
  }
  if(req.method==='PUT'&&match[2]==='board'){
   const input=await readBody(req),reverse=r.type==='scene'?sceneReverseSettings(input):{};
    if(r.type==='character')await saveCharacterSettings(r,input);
   if(r.type==='scene'&&input.prompt!==undefined&&(typeof input.prompt!=='string'||input.prompt.length>100000))throw Error('场景描述过长或格式无效');
   if(input.sceneOutputMode!==undefined&&(r.type!=='scene'||!['front','both'].includes(input.sceneOutputMode)))throw Error('场景输出模式无效');
   const prepared=new Map();for(const [id,slot]of Object.entries(input.slots||{})){if(!CARD_FRAMES.some(f=>f.id===id)&&!SCENE_COMPONENTS.includes(id)&&!['free','injury','handprop','role-card'].includes(id))continue;if(!slot||typeof slot!=='object')throw Error('组件数据无效');if(slot.remove===true)continue;for(const key of ['zoom','ox','oy'])if(!Number.isFinite(slot[key])||Math.abs(slot[key])>10000||key==='zoom'&&slot[key]<=0)throw Error('组件取景无效');if(slot.data){const data=/^data:image\/(?:png|jpeg|webp);base64,([\w+/=\r\n]+)$/.exec(slot.data);if(!data)throw Error('组件图片无效');const bytes=Buffer.from(data[1],'base64');await load(bytes);prepared.set(id,bytes);}}
   const nextMode=r.type==='scene'?(input.slots?.['scene-reverse']?.remove===true?'front':input.sceneOutputMode||(input.slots?.['scene-reverse']?.data?'both':r.sceneOutputMode||'both')):null;
   // Omission is a durable choice. Old completed jobs cannot restore the discarded view on refresh.
   if(nextMode==='front'){
    if(r.slots['scene-reverse'])r.omittedSceneReverse={slot:copy(r.slots['scene-reverse']),removedAt:new Date().toISOString()};
    const jobId=r.jobs['scene-reverse'];if(jobId){r.dismissedSceneReverseJobId=jobId;if(activeStatuses.has(r.phases['scene-reverse']?.status))try{await editorJson('/api/jobs/'+jobId+'/cancel',{method:'POST',body:{}});}catch{}}
    delete r.slots['scene-reverse'];r.finished=r.finished.filter(id=>id!=='scene-reverse');r.sceneReverseSubmitted=true;
   }
   if(r.type==='scene'){if(r.sceneOutputMode==='front'&&nextMode==='both')r.sceneReverseSubmitted=true;r.sceneOutputMode=nextMode;}
   for(const [id,slot]of Object.entries(input.slots||{})){
    if(!CARD_FRAMES.some(f=>f.id===id)&&!SCENE_COMPONENTS.includes(id)&&!['free','injury','handprop','role-card'].includes(id))continue;
    if(slot.remove===true){delete r.slots[id];continue;}if(id==='scene-reverse'&&nextMode==='front')continue;
    if(slot.data){image(r,id,prepared.get(id));
     if(slot.manual===true){r.manualComponents||={};r.manualComponents[id]=true;r.phases[id]={status:'done',message:'已采用上传的组件'};if(!r.finished.includes(id))r.finished.push(id);if(id==='scene-front'&&r.sceneAssets)delete r.sceneAssets.front;}
    }
    if(r.slots[id])for(const key of ['zoom','ox','oy']){if(!Number.isFinite(slot[key])||Math.abs(slot[key])>10000||key==='zoom'&&slot[key]<=0)throw Error('组件取景无效');r.slots[id][key]=slot[key];}
   }
   Object.assign(r,reverse);if(r.type==='scene'){if(input.prompt!==undefined)r.prompt=input.prompt;if(input.sceneMeta){const meta=input.sceneMeta;r.sceneMeta={camera:String(meta.camera||'').trim().slice(0,80),time:String(meta.time||'').trim().slice(0,80),weather:String(meta.weather||'').trim().slice(0,80)};}}
   if(input.title!==undefined)r.boardTitle=String(input.title);
   if(singleCard(r))await composeSingleCard(r);else if(r.type==='character')await compose(r);else if(r.type==='scene'){const required=r.sceneOutputMode==='front'?['scene-front']:SCENE_COMPONENTS;if(required.every(id=>r.slots[id]&&fs.existsSync(file(r,id))))await composeScene(r);else try{fs.rmSync(file(r,'card'));}catch{}sceneStatus(r);}
   save();sendJson(res,200,view(r));return true;
  }
  if(req.method==='GET'){await refresh(r);sendJson(res,200,view(r));return true;}
  throw Error('生成记录操作无效');
 },async importLegacy({id,name,outfit,prompt,referenceIds,source,bytes}){if(records.some(r=>r.source?.taskId===source.taskId))return;const r={id:'production_'+randomUUID(),requestId:'legacy-'+id,name,outfit,prompt,referenceIds,type:'character',status:'legacy',legacy:true,source,createdAt:new Date().toISOString(),jobs:{},phases:{},finished:[],slots:{}};image(r,'free',bytes);records.push(r);save();return view(r);}};
}


