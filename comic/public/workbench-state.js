export function taskGroups(jobs,projectId){
  const relevant=jobs.filter(job=>job.projectId===projectId),latest=new Map();
  for(const job of relevant){const key=job.panelId||job.id,prior=latest.get(key);if(!prior||String(job.created||'')>=String(prior.created||''))latest.set(key,job);}
  const active=relevant.filter(job=>['queued','running','awaiting_confirmation','recoverable'].includes(job.status));
  const failed=[...latest.values()].filter(job=>job.status==='failed'&&!active.some(item=>item.panelId===job.panelId));
  const visibleIds=new Set([...active,...failed].map(job=>job.id));
  return {active,failed,history:relevant.filter(job=>!visibleIds.has(job.id)).slice(-20).reverse(),running:active.filter(job=>job.status==='running').length,queued:active.filter(job=>job.status==='queued').length,approval:active.filter(job=>job.status==='awaiting_confirmation').length,recovery:active.filter(job=>job.status==='recoverable').length};
}
export function taskSummary(groups){
  const items=[];
  if(groups.running)items.push('生成中 '+groups.running);
  if(groups.queued)items.push('排队 '+groups.queued);
  if(groups.approval)items.push('待确认 '+groups.approval);
  if(groups.failed.length)items.push('失败 '+groups.failed.length);
  if(groups.recovery)items.push('可恢复 '+groups.recovery);
  return items.join(' · ')||'暂无进行中的任务';
}