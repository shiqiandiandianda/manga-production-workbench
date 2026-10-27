import {regionDeleted} from './public/repair-items.mjs';
export class RegionSubmissionGuard {
 constructor(readJobs){this.readJobs=readJobs;this.pending=new Set();}
 async run(body,action){
  if(!body.sourceId||!body.regionId)return action();
  const key=JSON.stringify([body.sourceId,body.regionId]);
  const busy=()=>Object.assign(new Error('这个选区正在处理中，请等待完成后再重新生成'),{statusCode:409});
  if(this.pending.has(key))throw busy();
  this.pending.add(key);
  try{
   const active=(await this.readJobs()).some(job=>job.sourceId===body.sourceId&&job.regionId===body.regionId&&['queued','running'].includes(job.automation?.status));
   if(active)throw busy();
   return await action();
  }finally{this.pending.delete(key);}
 }
}

export function assertRepairRegion(request,meta,project){
 if(!request.sourceId)return;
 if(meta?.deletedAt)throw Object.assign(new Error('项目已删除，任务不能继续生成'),{statusCode:410});
 if(request.regionId&&regionDeleted(request.regionId,project||{}))throw Object.assign(new Error('选区已删除，请先恢复选区再生成'),{statusCode:410});
}
