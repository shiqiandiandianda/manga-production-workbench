const timestamp=value=>{const time=Date.parse(value);return Number.isFinite(time)?time:null;};
const numeric=value=>Number.isFinite(value)&&value>=0?value:null;
export function duration(ms){const seconds=Math.max(0,Math.floor((numeric(ms)||0)/1000));return seconds<60?seconds+'秒':Math.floor(seconds/60)+'分'+seconds%60+'秒';}

export function jobTiming(job,now=Date.now()){
 const created=timestamp(job.created)??now,started=timestamp(job.startedAt),terminal=['done','failed','cancelled','recoverable'].includes(job.status);
 const end=timestamp(job.completedAt)??(terminal?timestamp(job.updated):null)??now;
 const generationStart=timestamp(job.generationStartedAt),generationEnd=timestamp(job.generationCompletedAt);
 const totalMs=Math.max(0,end-(started??created)),queueMs=Math.max(0,(started??now)-created);
 const preImageMs=generationStart!==null&&started!==null?Math.max(0,generationStart-started):null;
 const imageMs=numeric(job.timings?.imageGenerationMs)??numeric(job.imageGenerationMs)??(generationEnd!==null&&generationStart!==null?Math.max(0,generationEnd-generationStart):null);
 const outputMs=imageMs!==null&&preImageMs!==null?Math.max(0,totalMs-preImageMs-imageMs):null;
 return {queueMs,totalMs,preImageMs,imageMs,outputMs,started,generationStart,estimatedImageAndOutputMs:generationStart!==null&&imageMs===null?Math.max(0,end-generationStart):null,effort:job.timings?.dispatchEffort||job.dispatchEffort||null,referenceMode:job.timings?.referenceMode||null,referenceCount:numeric(job.timings?.referenceCount)};
}

export function formatJobTime(job,now=Date.now()){
 const t=jobTiming(job,now);
 if(job.status==='queued')return '排队 '+duration(t.queueMs);
 if(job.status==='awaiting_confirmation')return '已处理 '+duration((timestamp(job.updated)??now)-(t.started??timestamp(job.created)??now))+' · 等待批准 '+duration(now-(timestamp(job.updated)??now));
 if(t.started===null)return '总耗时 '+duration(t.totalMs);
 let text='排队 '+duration(t.queueMs)+' · 总处理 '+duration(t.totalMs);
 if(t.preImageMs!==null){
  text+='（包含以下阶段） · 生图前 '+duration(t.preImageMs);
  if(t.imageMs!==null)text+=' · 生图 '+duration(t.imageMs)+' · 收尾 '+duration(t.outputMs);
  if(t.referenceCount)text+=' · 参考 '+t.referenceCount+' 张'+(t.referenceMode==='direct'?'（直传）':'');
  else text+=' · 生图及收尾约 '+duration(t.estimatedImageAndOutputMs);
 }else if(job.status==='running')text+=' · 当前正在准备分镜与参考';
 return text;
}
