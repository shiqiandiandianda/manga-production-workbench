import path from 'node:path';
import {readFile,writeFile,mkdir,copyFile,rm} from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {RepairQueue} from './repair-queue.mjs';
import {replaceFile} from './safe-files.mjs';

export const TEXT_REVIEW_STATUSES=new Set(['recognition_queued','recognizing_text','refining_text','awaiting_text_review']);
export const reviewWorkflowVersion=request=>request.separateBubble===true?3:request.autoText===true?2:request.workflowVersion;
export const requiresTextReview=request=>request.autoText===true&&request.separateBubble!==true&&request.workflowVersion===2;
const RECOGNITION_STATUSES=new Set(['recognition_queued','recognizing_text','refining_text']);
const error=(message,code=400)=>Object.assign(new Error(message),{statusCode:code});
const plain=value=>!!value&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
const sha=value=>createHash('sha256').update(value).digest('hex');
export const reviewFrameHash=request=>sha(JSON.stringify(request.frame||request.crop));
async function json(file,fallback){try{return JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT'&&arguments.length>1)return fallback;throw e;}}
async function atomic(file,value){const temporary=file+'.'+randomUUID()+'.tmp';await writeFile(temporary,JSON.stringify(value,null,2),'utf8');await replaceFile(temporary,file);}
const inside=(a,b,tolerance=.05)=>a[0]>=b[0]-tolerance&&a[1]>=b[1]-tolerance&&a[0]+a[2]<=b[0]+b[2]+tolerance&&a[1]+a[3]<=b[1]+b[3]+tolerance;
const overlap=(a,b)=>Math.max(0,Math.min(a[0]+a[2],b[0]+b[2])-Math.max(a[0],b[0]))*Math.max(0,Math.min(a[1]+a[3],b[1]+b[3])-Math.max(a[1],b[1]));
export function selectionReviewBox(request){
 const crop=request.crop,frame=request.frame||crop;
 if(!crop||!frame||!['x','y','width','height'].every(key=>Number.isFinite(crop[key])&&Number.isFinite(frame[key]))||crop.width<=0||crop.height<=0||frame.width<=0||frame.height<=0)throw error('任务选区坐标无效');
 return [(frame.x-crop.x)*1000/crop.width,(frame.y-crop.y)*1000/crop.height,frame.width*1000/crop.width,frame.height*1000/crop.height];
}
export function validateReviewBubbles(value,request){
 if(!Array.isArray(value)||!value.length||value.length>12)throw error('请保留 1 至 12 个真实气泡；没有文字时请取消自动文字后重新提交');
 const frame=selectionReviewBox(request),ids=new Set();let length=0;
 const box=(value,label)=>{
  if(!Array.isArray(value)||value.length!==4||value.some(item=>typeof item!=='number'||!Number.isFinite(item))||value[2]<=0||value[3]<=0||!inside(value,[0,0,1000,1000])||!inside(value,frame))throw error(label+'必须完整位于当前选区内');
  return [...value];
 };
 const bubbles=value.map((item,index)=>{
  if(!plain(item))throw error('气泡记录无效');
  // Only these data fields can reach Python. No model-supplied path or command is accepted.
  const allowed=new Set(['id','text','box','bubbleBox','textBoxes','fontSize','direction','align','uncertain','confidence','sourceIds']);
  if(Object.keys(item).some(key=>!allowed.has(key)))throw error('气泡记录含不支持的字段');
  if(typeof item.id!=='string'||!/^[a-zA-Z0-9_-]{1,80}$/.test(item.id)||ids.has(item.id))throw error('气泡编号无效或重复');ids.add(item.id);
  if(typeof item.text!=='string'||!item.text.trim()||item.text.length>2000||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(item.text))throw error('第 '+(index+1)+' 个气泡的文字为空、过长或含无效字符');
  length+=item.text.length;if(length>12000)throw error('气泡文字总长度超过限制');
  const textBox=box(item.box,'文字框'),bubbleBox=box(item.bubbleBox,'气泡框');if(!inside(textBox,bubbleBox))throw error('文字框必须位于自己的气泡框内');
  if(item.textBoxes!==undefined){if(!Array.isArray(item.textBoxes)||item.textBoxes.length>12)throw error('原文行框数量无效');for(const line of item.textBoxes)if(!inside(box(line,'原文行框'),bubbleBox))throw error('原文行框必须位于自己的气泡框内');}
  const fontSize=item.fontSize??24;if(typeof fontSize!=='number'||!Number.isFinite(fontSize)||fontSize<6||fontSize>512)throw error('字号必须在 6 至 512 像素之间');
  const direction=item.direction==='vertical'?'vertical-rl':item.direction||'horizontal',align=item.align||'center';if(!['horizontal','vertical-rl','vertical-lr'].includes(direction)||!['left','center','right'].includes(align))throw error('文字方向或对齐方式无效');
  return {id:item.id,text:item.text.trim().replace(/\r\n?/g,'\n'),box:textBox,bubbleBox,fontSize,direction,align,uncertain:[]};
 });
 for(let i=0;i<bubbles.length;i++)for(let j=i+1;j<bubbles.length;j++){
  const a=bubbles[i],b=bubbles[j];
  if(overlap(a.box,b.box)>.1*Math.min(a.box[2]*a.box[3],b.box[2]*b.box[3])||overlap(a.bubbleBox,b.bubbleBox)>.5*Math.min(a.bubbleBox[2]*a.bubbleBox[3],b.bubbleBox[2]*b.bubbleBox[3]))throw error('气泡文字框或气泡框明显重叠，请合并同一气泡或调整框的位置');
 }
 return bubbles;
}

export class TextReviewService {
 constructor({root,readRequest,writeRequest,readAutomation,writeAutomation,validateRequest=async()=>{},startRepair,runtime,spawnWorker=spawn,archive=()=>{}}){
  this.root=root;this.readRequest=readRequest;this.writeRequest=writeRequest||((id,value)=>atomic(path.join(this.directory(id),'request.json'),value));
  this.readAutomation=readAutomation||((dir)=>json(path.join(dir,'automation.json'),null));this.writeAutomation=writeAutomation||((dir,value)=>atomic(path.join(dir,'automation.json'),value));
  this.validateRequest=validateRequest;this.startRepair=startRepair;this.runtime=runtime;this.spawnWorker=spawnWorker;this.archive=archive;
  this.queue=new RepairQueue(2,(e,id)=>console.error('文字识别任务异常：',id,e.message));this.active=new Map();this.locks=new Map();
 }
 directory(id){return path.join(this.root,'jobs',id);}
 async locked(id,work){const prior=this.locks.get(id)||Promise.resolve(),next=prior.catch(()=>{}).then(work);this.locks.set(id,next);try{return await next;}finally{if(this.locks.get(id)===next)this.locks.delete(id);}}
 async ensureWorkflow(id){let request=await this.readRequest(id);const workflowVersion=reviewWorkflowVersion(request);if(workflowVersion!==request.workflowVersion){request={...request,workflowVersion};await this.writeRequest(id,request);}return request;}
 async sourceHashes(id,request){return {sourceCropSha256:sha(await readFile(path.join(this.directory(id),'crop.png'))),frameHash:reviewFrameHash(request)};}
 async assertIdentity(id,record,request){const expected=await this.sourceHashes(id,request);if(record?.schemaVersion!==2||record.jobId!==id||record.sourceCropSha256!==expected.sourceCropSha256||record.frameHash!==expected.frameHash)throw error('原图裁片或选区已变化，请重新识别并校对',409);return expected;}
 async read(id){const request=await this.readRequest(id);if(request.autoText!==true||request.workflowVersion!==2||request.separateBubble===true)throw error('此任务没有文字校对草稿；原生气泡分离不需要识字草稿',404);const draft=await json(path.join(this.directory(id),'text-review.json'),null);if(!draft)throw error('识字草稿尚未就绪',404);await this.assertIdentity(id,draft,request);if(draft.status!=='draft'||typeof draft.revision!=='string'||!draft.revision||draft.revision.length>100||!Array.isArray(draft.bubbles))throw error('识字草稿格式无效，请重新识别',409);return draft;}
 async confirmed(id,request=undefined){request||=await this.readRequest(id);if(request.autoText!==true||request.workflowVersion!==2)return null;const confirmed=await json(path.join(this.directory(id),'confirmed-text.json'),null);if(!confirmed)return null;try{await this.assertIdentity(id,confirmed,request);if(typeof confirmed.reviewRevision!=='string'||!confirmed.reviewRevision||typeof confirmed.confirmedAt!=='string')return null;validateReviewBubbles(confirmed.bubbles,request);return confirmed;}catch{return null;}}
 async preserve(id,attemptId,names){const dir=this.directory(id),history=path.join(dir,'attempts',attemptId);await mkdir(history,{recursive:true});for(const name of names){try{await copyFile(path.join(dir,name),path.join(history,name));}catch(e){if(e.code!=='ENOENT')throw e;}}}
 async begin(id,action='recognize',expectedRevision){
  return this.locked(id,async()=>{
   const request=await this.ensureWorkflow(id);if(request.autoText!==true)throw error('此任务没有启用自动文字');if(request.workflowVersion!==2)throw error('原生气泡分离直接生成背景和透明气泡，不进入识字前置流程');await this.validateRequest(request);
   const dir=this.directory(id),previous=await this.readAutomation(dir);if(this.queue.has(id)||RECOGNITION_STATUSES.has(previous?.status))return previous;
   if(['queued','running'].includes(previous?.status))throw error('修图正在进行，请等待完成后再识别',409);
   let beforeRevision;if(action==='refine'){if(previous?.status!=='awaiting_text_review')throw error('当前任务尚未进入校对阶段',409);const draft=await this.read(id);beforeRevision=draft.revision;if(expectedRevision!==draft.revision)throw error('草稿已更新，请重新打开最新校对结果',409);}
   const attemptId=randomUUID().replaceAll('-','');await this.preserve(id,attemptId,['text-review.json','confirmed-text.json']);await rm(path.join(dir,'confirmed-text.json'),{force:true});await rm(path.join(dir,'recognition-error.json'),{force:true});if(action==='recognize')await rm(path.join(dir,'text-review.json'),{force:true});
   const state={jobId:id,attemptId,status:'recognition_queued',phase:'recognition_queued',reviewAction:action,reviewRevision:beforeRevision,message:action==='refine'?'已排队进行 Codex 视觉复核，不会生成修图':'已排队由 Codex 看原图识字，草稿需要校对后才能修图',startedAt:Date.now()/1000,updatedAt:Date.now()/1000,workflowVersion:2,reviewAvailable:false};
   await this.writeAutomation(dir,state);this.queue.enqueue(id,()=>this.run(id,state));this.archive(id);return state;
  });
 }
 async finish(id,state,exitCode){
  const dir=this.directory(id),current=await this.readAutomation(dir);if(current?.attemptId!==state.attemptId||current.status==='cancelled')return;
  try{const issue=await json(path.join(dir,'recognition-error.json'),null);if(exitCode!==0||issue)throw error(String(issue?.message||issue?.error||'识字程序失败，请检查识字运行环境或单独重试').slice(0,600));const draft=await this.read(id);if(state.reviewAction==='refine'&&draft.revision===state.reviewRevision)throw error('视觉复核没有产生新草稿，请重试');await this.writeAutomation(dir,{...state,status:'awaiting_text_review',phase:'awaiting_text_review',reviewRevision:draft.revision,reviewAvailable:true,message:'识字草稿已就绪，请对照原图校对、删掉假文字，再确认生成',updatedAt:Date.now()/1000});}
  catch(e){await this.writeAutomation(dir,{...state,status:'failed',phase:'text_recognition_failed',reviewAvailable:false,message:e.message,updatedAt:Date.now()/1000});}
  this.archive(id);
 }
 async run(id,state){
  const dir=this.directory(id);let child,stderr='';try{
   const current=await this.readAutomation(dir);if(current?.attemptId!==state.attemptId||current.status==='cancelled')return;
   await this.validateRequest(await this.readRequest(id));await this.writeAutomation(dir,{...state,status:state.reviewAction==='refine'?'refining_text':'recognizing_text',phase:state.reviewAction==='refine'?'refining_text':'recognizing_text',message:state.reviewAction==='refine'?'正在用 Codex 对照原图复核疑字；结果仍需校对':'Codex 正在看原图识字；完成后等待校对',updatedAt:Date.now()/1000});
   child=this.spawnWorker(this.runtime(),[path.join(this.root,'python','recognition_worker.py'),'--job',dir,'--action',state.reviewAction,'--attempt-id',state.attemptId],{cwd:this.root,windowsHide:true,detached:true,stdio:['ignore','ignore','pipe'],env:{...process.env,PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8'}});this.active.set(id,{child,attemptId:state.attemptId});child.stderr?.on('data',chunk=>{stderr=(stderr+chunk.toString('utf8')).slice(-20000);});
   const exit=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});if(child.pid)await atomic(path.join(dir,'recognition-worker.json'),{pid:child.pid,attemptId:state.attemptId});const code=await exit;if(stderr)await writeFile(path.join(dir,'recognition-stderr.log'),stderr,'utf8');await this.finish(id,state,code);
  }catch(e){const current=await this.readAutomation(dir);if(current?.attemptId===state.attemptId&&current.status!=='cancelled')await this.writeAutomation(dir,{...state,status:'failed',phase:'text_recognition_failed',reviewAvailable:false,message:e.message||'无法启动识字程序',updatedAt:Date.now()/1000});}
  finally{if(this.active.get(id)?.child===child)this.active.delete(id);this.archive(id);}
 }
 async editable(id,revision){const request=await this.readRequest(id);await this.validateRequest(request);const state=await this.readAutomation(this.directory(id));if(state?.status!=='awaiting_text_review')throw error('当前任务尚未进入校对阶段，或正在修图',409);const draft=await this.read(id);if(typeof revision!=='string'||revision!==draft.revision)throw error('草稿已更新，请重新打开最新校对结果',409);return {request,draft};}
 async saveDraft(id,body){return this.locked(id,async()=>{const {request,draft}=await this.editable(id,body?.revision),bubbles=validateReviewBubbles(body?.bubbles,request),next={...draft,bubbles,revision:randomUUID(),updatedAt:new Date().toISOString(),editedByUser:true};await atomic(path.join(this.directory(id),'text-review.json'),next);const state=await this.readAutomation(this.directory(id));await this.writeAutomation(this.directory(id),{...state,reviewRevision:next.revision,updatedAt:Date.now()/1000});this.archive(id);return next;});}
 async confirm(id,body){return this.locked(id,async()=>{const {request,draft}=await this.editable(id,body?.revision),bubbles=validateReviewBubbles(body?.bubbles,request),record={schemaVersion:2,jobId:id,reviewRevision:draft.revision,sourceCropSha256:draft.sourceCropSha256,frameHash:draft.frameHash,confirmedAt:new Date().toISOString(),bubbles};await atomic(path.join(this.directory(id),'confirmed-text.json'),record);const automation=await this.startRepair(id);this.archive(id);return {ok:true,automation};});}
 async refine(id,body){return {ok:true,automation:await this.begin(id,'refine',body?.revision)};}
 async cancel(id,message='已取消文字识别或待校对任务'){
  return this.locked(id,async()=>{const dir=this.directory(id),state=await this.readAutomation(dir);if(!TEXT_REVIEW_STATUSES.has(state?.status))return false;this.queue.cancel(id);await this.writeAutomation(dir,{...state,status:'cancelled',phase:'cancelled',reviewAvailable:false,message,updatedAt:Date.now()/1000});const active=this.active.get(id);if(active?.attemptId===state.attemptId)this.stop(active.child);this.archive(id);return true;});
 }
 stop(child){if(!child?.pid||child.exitCode!==null)return;if(process.platform==='win32')spawn('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});else{try{process.kill(-child.pid,'SIGTERM');}catch{child.kill('SIGTERM');}}}
 async recover(ids){
  for(const id of ids){const dir=this.directory(id),state=await this.readAutomation(dir);if(!TEXT_REVIEW_STATUSES.has(state?.status))continue;
   if(state.status==='awaiting_text_review'){try{await this.read(id);}catch(e){await this.writeAutomation(dir,{...state,status:'failed',phase:'text_recognition_failed',reviewAvailable:false,message:e.message});}continue;}
   const worker=await json(path.join(dir,'recognition-worker.json'),null),alive=()=>{try{if(worker?.attemptId!==state.attemptId||!worker.pid)return false;process.kill(worker.pid,0);return true;}catch{return false;}};
   if(alive())this.queue.adopt(id,()=>new Promise(resolve=>{const timer=setInterval(async()=>{try{const current=await this.readAutomation(dir);if(current?.attemptId!==state.attemptId||current.status==='cancelled'){if(current?.status==='cancelled')this.stop({pid:worker.pid,exitCode:null,kill:()=>{}});clearInterval(timer);resolve();}else if(!alive()){clearInterval(timer);await this.finish(id,state,0);resolve();}}catch(e){console.error('识字恢复检查失败：',e.message);}},500);}));
   else{const draft=await json(path.join(dir,'text-review.json'),null);if(draft&&(!state.reviewRevision||draft.revision!==state.reviewRevision))await this.finish(id,state,0);else await this.writeAutomation(dir,{...state,status:'failed',phase:'text_recognition_failed',reviewAvailable:false,message:'服务重启时识字进程已中断，请重试识字；未启动修图'});}
  }
 }
}
