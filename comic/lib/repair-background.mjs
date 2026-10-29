import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {check} from './store.mjs';
import {composeLayers,sourceMetadata} from '../repair-engine/page-service.mjs';

const validId=id=>/^\d{8}-\d{6}-[a-f0-9]{8}$/.test(id);
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
function write(file,value){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file+'.tmp',JSON.stringify(value));fs.renameSync(file+'.tmp',file);}

// Only explicitly bound submissions belong to the layout canvas. A shared image
// hash/source ID is never sufficient to identify a frame.
export function createRepairBackground({root,store,ensure,applySession}){
 const dir=path.join(root,'background-tasks'),preparing=new Map(),applying=new Set();fs.mkdirSync(dir,{recursive:true});
 const file=id=>{check(validId(id),'修图任务编号无效');return path.join(dir,id+'.json');};
 const session=id=>{check(/^[a-f0-9-]{36}$/i.test(id),'修图会话无效');return read(path.join(root,'sessions',id+'.json'));};
 function validate(input){if(!input.integratedSessionId)return;const s=session(input.integratedSessionId);check([s.sourceId,s.initialSourceId,...(s.backgroundSourceIds||[])].includes(input.sourceId),'修图来源已切换，请重新打开画格',409);const p=store.project(s.projectId);check(p.pages.some(pg=>pg.panels.some(f=>f.id===s.panelId)),'原画格已删除',409);}
 function register(input,job){if(!input.integratedSessionId)return;validate(input);const s=session(input.integratedSessionId),p=store.project(s.projectId),pg=p.pages.find(pg=>pg.panels.some(f=>f.id===s.panelId)),f=pg.panels.find(f=>f.id===s.panelId);write(file(job.id),{id:job.id,sessionId:s.id,projectId:p.id,pageId:pg.id,panelId:f.id,sourceId:job.sourceId,projectTitle:p.title,label:p.shots.find(shot=>shot.id===f.shotId)?.code||f.name||'画格',instruction:job.label||job.region?.prompt||'',createdAt:job.createdAt,status:'queued'});}
 async function prepare(task){
  if(preparing.has(task.id))return;const save=value=>{if(read(file(task.id)).status!=='applied')write(file(task.id),value);};const operation=(async()=>{
   try{const engine=await ensure(),request=await engine.projects.job(task.id);await engine.projects.attachJob(task.id);const project=await engine.projects.get(task.sourceId),note=project.tasks?.[task.id],layer=project.layers.find(l=>l.jobId===task.id);
    if(['discarded','archived'].includes(note?.decision)){save({...task,status:'cancelled',message:'修图结果已弃用'});return;}
    if(!layer||!note?.resultVersion)return;
    if(request.autoText||request.separateBubble||request.submission?.pageSections||request.submission?.pageGaps?.length){save({...task,status:'attention',message:'结果已接回修图记录，请核对文字或分段后手动应用'});return;}
    const tiles=project.renderedLayers.filter(tile=>tile.layerId===layer.id);check(tiles.length,'修图结果尚未生成选区补片');
    // Tiles already contain the original human mask and feathering. Never paste
    // the raw AI context crop onto the full frame.
    save({...task,status:'ready',message:'修图已完成，等待合成到画板',tiles,resultVersion:note.resultVersion});
   }catch(error){save({...task,status:'attention',message:error.message});}
  })().finally(()=>preparing.delete(task.id));preparing.set(task.id,operation);await operation;
 }
 async function list(){
  const records=fs.readdirSync(dir).filter(n=>validId(n.replace(/\.json$/,''))).map(n=>read(path.join(dir,n))),items=[];if(records.some(t=>!['applied','cancelled','attention'].includes(t.status)))await ensure();
  for(const row of records){let task=row;
   if(!['applied','attention','cancelled'].includes(task.status)){
    let automation=null;try{automation=read(path.join(root,'jobs',task.id,'automation.json'));}catch(e){if(e.code!=='ENOENT')throw e;}
    const result=path.join(root,'jobs',task.id,'repaired.png');
    if(automation&&['failed','cancelled'].includes(automation.status)){task={...task,status:automation.status,message:automation.message||'修图未完成，结果保留在记录中'};}
    else if((!automation||automation.status==='completed')&&fs.existsSync(result)&&Date.now()-fs.statSync(result).mtimeMs>1000){if(task.status!=='ready'){void prepare(task);task={...task,status:'compositing',message:'结果已返回，正在按选区接回'};}}
    else task={...task,status:automation?.status==='running'?'running':automation?.status==='queued'?'queued':'waiting',message:automation?.message||'等待修图结果',phase:automation?.phase};
   }
   const {tiles,...summary}=task;items.push(summary);
  }
  items.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));return {tasks:[...items.filter(t=>t.status!=='applied'),...items.filter(t=>t.status==='applied').slice(0,100)]};
 }
 async function apply(id,input){
  let task=read(file(id));if(task.status==='applied')return {alreadyApplied:true,task};check(task.status==='ready','修图结果尚未就绪',409);check(!applying.has(task.projectId),'正在接回上一张修图',409);applying.add(task.projectId);
  try{
   const s=session(task.sessionId),project=store.project(task.projectId);check(project.revision===input.expectedRevision,'工程已有修改，请稍后自动接回',409);
   const base=s.composition?.file||s.patchBaseFile||store.assetPath(s.imageAssetId),source=await sourceMetadata(root,task.sourceId),size=s.composition||store.asset(s.imageAssetId);check(source.width===size.width&&source.height===size.height,'原画幅已改变，结果保留，请在修图记录中核对',409);
   const target=path.join(root,'exports','background-'+id+'.png'),baseKey=s.composition?.stamp||s.patchBaseHash||s.imageAssetId;fs.mkdirSync(path.dirname(target),{recursive:true});
   const wasApplied=task.resultUrl&&fs.existsSync(target)&&['patch','replace'].some(mode=>s.appliedResults?.[mode+':'+createHash('sha256').update(fs.readFileSync(target)).digest('hex')]);
   if(!task.resultUrl||!fs.existsSync(target)||task.baseKey!==baseKey&&!wasApplied){await composeLayers(root,base,target,task.tiles,6,[],null,task.sourceId);task={...task,resultUrl:'/repair/exports/'+path.basename(target),baseKey};write(file(id),task);}
   // Persist the prepared image before applying it. A retry after a lost reply
   // reuses that exact image instead of feathering the same patch twice.
   const result=await applySession(s.id,{expectedRevision:input.expectedRevision,resultUrl:task.resultUrl,mode:s.targetKind==='upscale'?'replace':'patch'});
   check(result.applied,'原画格已调整，修图结果保留为候选，请核对后采用',409);
   task={...task,status:'applied',message:'图片修改已合成',completedAt:new Date().toISOString(),assetId:result.asset?.id,layerId:result.layerId};delete task.tiles;write(file(id),task);return {...result,task,background:true};
  }catch(error){if(error.statusCode!==409||!/工程已有修改|校验期间|载入期间/.test(error.message)){task={...task,status:'attention',message:error.message};write(file(id),task);}throw error;}
  finally{applying.delete(task.projectId);}
 }
 function accept(ids,sessionId,result){if(!result.applied||!Array.isArray(ids))return;for(const id of ids.slice(0,200)){if(!validId(id)||!fs.existsSync(file(id)))continue;const task=read(file(id));if(task.sessionId!==sessionId||task.status==='applied')continue;const {tiles,...summary}=task;write(file(id),{...summary,status:'applied',message:'图片修改已合成',completedAt:new Date().toISOString(),assetId:result.asset?.id,layerId:result.layerId});}}
 return {validate,register,list,apply,accept,running:()=>applying.size+preparing.size};
}
