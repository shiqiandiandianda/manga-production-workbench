import type {ImageTiming,Job} from './scenes';
export type TimingDisplay={label:string;startedAt?:number;durationMs?:number;stages?:ImageTiming['stages']};
export function formatDuration(milliseconds:number){const seconds=Math.max(0,Math.floor(milliseconds/1000)),hours=Math.floor(seconds/3600),minutes=Math.floor(seconds%3600/60),rest=seconds%60;return hours?hours+' 小时 '+minutes+' 分 '+rest+' 秒':minutes?minutes+' 分 '+rest+' 秒':seconds+' 秒';}
export function candidateTiming(kind:string,job?:Job,saved?:ImageTiming|null):TimingDisplay|undefined{
  if(kind==='done')return saved?{label:'生成用时',durationMs:saved.durationMs,stages:saved.stages}:{label:'用时未记录'};
  if(['running','saving'].includes(kind)&&job?.startedAt)return job.finishedAt?{label:'生成用时',durationMs:job.durationMs}:{label:'已用时',startedAt:job.startedAt};
  if(['failed','paused'].includes(kind)&&job?.durationMs!==undefined)return {label:'本次尝试用时',durationMs:job.durationMs};
  return undefined;
}
