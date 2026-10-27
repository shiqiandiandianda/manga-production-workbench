const active=new Set(['running','uploading','verifying']);
const count=value=>Math.max(0,Math.floor(Number(value)||0));
export const volunteerPending=(task,now=Date.now())=>task.status==='queued'&&task.volunteer&&Date.parse(task.volunteer.expiresAt)>now;
export function volunteerCapacity(node,tasks,{now=Date.now(),timeout=15000,reservePending=true}={}){
 const supported=node?.capabilities?.volunteerVersion>=1;
 if(!node||node.revoked||node.settings?.enabled===false)return {available:false,slots:0,supported,message:'本机接单器未启用'};
 if(!node.status?.online||!Number.isFinite(Date.parse(node.status.lastSeenAt))||now-Date.parse(node.status.lastSeenAt)>timeout)return {available:false,slots:0,supported,message:'本机接单器暂未在线'};
 if(!supported)return {available:false,slots:0,supported,message:'接单器需升级并重启，才能主动帮忙'};
 const local=node.status.local||{};
 if(local.available===false||!count(local.concurrency))return {available:false,slots:0,supported,message:'本机生图服务尚未就绪'};
 const assigned=tasks.filter(t=>t.assignedNodeId===node.id&&active.has(t.status));
 const reported=new Set(node.status.runningTaskIds||[]),unreported=assigned.filter(t=>!reported.has(t.id)).length;
 const pending=reservePending?tasks.filter(t=>volunteerPending(t,now)&&t.volunteer.nodeId===node.id).length:0;
 const slots=Math.max(0,Math.min(count(node.settings.maxConcurrency)-assigned.length-pending,count(local.concurrency)-count(local.active)-count(local.queued)-unreported-pending));
 return {available:slots>0,slots,supported,message:slots>0?'可主动帮忙 '+slots+' 项':'本机名额已满，完成当前任务后可主动帮忙'};
}
