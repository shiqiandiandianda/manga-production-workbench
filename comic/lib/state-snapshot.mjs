// 状态接口的增量返回。前端在有任务运行时每 2 秒轮询一次；以前每次都返回全部工程、全部素材和全部任务，
// 工程一多每次就是几十 MB。现在前端带上已知的“内容戳”，没变的工程只回一个占位，素材没变就不回，
// 任务只回有变化的那几条。没带内容戳的请求（首次加载、其他调用方）仍返回完整数据，格式与以前相同。
import {createHash,randomUUID} from 'node:crypto';
import {purgeSummary} from './project-purge.mjs';

const digest=text=>createHash('sha1').update(text).digest('hex');

export function createStateSnapshot({store,publicJob,projectView=project=>project}){
 // 服务重启后任务序号从头计数：带上本进程编号，前端发现编号变化就重新取完整数据。
 const instance=randomUUID(),jobState=new Map();let jobClock=0;
 function liveJobs(){
  const live=new Set(store.db.projects.filter(p=>!p.deletedAt).map(p=>p.id));
  return store.db.jobs.filter(job=>live.has(job.projectId)).map(publicJob);
 }
 /** 给每条任务一个递增的变化序号；只在任务内容真的变化时递增。 */
 function trackJobs(jobs){
  const seen=new Set();
  for(const job of jobs){
   seen.add(job.id);const text=JSON.stringify(job),previous=jobState.get(job.id);
   if(!previous||previous.text!==text)jobState.set(job.id,{text,clock:++jobClock});
  }
  for(const id of [...jobState.keys()])if(!seen.has(id))jobState.delete(id);
  return digest(jobs.map(job=>job.id).join('\n'));
 }
 function parseKnown(value){
  if(!value)return null;
  try{const known=JSON.parse(value);return known&&typeof known==='object'&&!Array.isArray(known)?known:null;}catch{return null;}
 }
 return function snapshot(searchParams,extra){
  const projects=store.db.projects.filter(p=>!p.deletedAt&&!p.internalAssetWorkspace);
  // 有尚未写盘的修改时先写盘，保证内容戳与内存一致。
  if(projects.some(p=>store.changed?.(p)))store.save();
  const deletedProjects=[...store.db.projects.filter(p=>p.deletedAt).map(p=>({id:p.id,title:p.title,revision:p.revision,deletedAt:p.deletedAt,pageCount:p.pages.length,shotCount:p.shots.length})),...[...(store.pendingPurges?.values()||[])].map(purgeSummary)];
  const jobs=liveJobs(),membership=trackJobs(jobs),assetsStamp=digest(JSON.stringify(store.db.assets));
  const stamps={s:instance,p:Object.fromEntries(projects.map(p=>[p.id,store.changed?.(p)?digest(JSON.stringify(p)):store.projectStamp?.(p.id)||null])),a:assetsStamp,j:jobClock,jm:membership};
  const known=parseKnown(searchParams.get('known'));
  if(!known||known.s!==instance)return {projects:projects.map(projectView),deletedProjects,assets:store.db.assets,jobs,layouts:[],...extra,stamps};
  const knownProjects=known.p&&typeof known.p==='object'?known.p:{};
  const since=Number.isFinite(known.j)?known.j:-1;
  return {
   incremental:true,
   projects:projects.map(p=>stamps.p[p.id]&&knownProjects[p.id]===stamps.p[p.id]?{id:p.id,unchanged:true}:projectView(p)),
   deletedProjects,
   ...(known.a===assetsStamp?{assetsUnchanged:true}:{assets:store.db.assets}),
   jobs:jobs.filter(job=>jobState.get(job.id).clock>since),
   ...(known.jm===membership?{}:{jobIds:jobs.map(job=>job.id)}),
   layouts:[],...extra,stamps
  };
 };
}
