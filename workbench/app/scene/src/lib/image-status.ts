import {candidateTiming} from './image-timing.ts';
import type {TimingDisplay} from './image-timing.ts';
import type {Job,Scene} from './scenes.ts';

export type ImageStatusKind='idle'|'submitting'|'pending'|'running'|'saving'|'done'|'failed'|'paused';
export type ImageStatus={timing?:TimingDisplay;kind:ImageStatusKind;label:string;busy:boolean;blocked:boolean;error?:string;regenerating?:boolean};
export type ImageQueueFlags={imagesPaused?:boolean;automaticImages?:boolean};
const labels:Record<ImageStatusKind,string>={idle:'待生成',submitting:'正在提交',pending:'排队等待',running:'正在生成',saving:'正在保存',done:'已完成',failed:'生成失败',paused:'已暂停'};

export function imageStatus(scene:Pick<Scene,'images'|'imageTimings'>,index:number,job?:Job,flags:ImageQueueFlags={},requesting=false,requestingRegeneration=false):ImageStatus{
  let kind:ImageStatusKind='idle';
  const regenerating=requestingRegeneration||!!job?.regenerate;
  const replacing=regenerating&&(requesting||['pending','running','paused','failed'].includes(job?.status||''));
  // An existing image remains visible during regeneration, but must not hide its job status.
  if(scene.images[index]&&!replacing)kind='done';
  else if(requesting)kind='submitting';
  else if(job?.status==='running')kind='running';
  else if(job?.status==='done')kind='saving';
  else if(job?.status==='pending')kind=flags.imagesPaused||(job.origin==='automatic'&&flags.automaticImages===false)?'paused':'pending';
  else if(job?.status==='failed')kind='failed';
  else if(job?.status==='paused')kind='paused';
  const busy=['submitting','pending','running','saving'].includes(kind);
  const regenerationLabels:Partial<Record<ImageStatusKind,string>>={submitting:'正在提交重生成',pending:'等待重生成',running:'重新生成中',saving:'保存新图片',failed:'重生成失败',paused:'重生成已暂停'};
  const stageLabel=kind==='running'&&job?.stage?({forward:'正打生成中',reverse:'反打生成中',composing:'正在拼接正反打'}[job.stage]):undefined;
  return {timing:candidateTiming(kind,job,scene.imageTimings?.[index]),kind,label:stageLabel?(regenerating?'重新生成 · ':'')+stageLabel:regenerating?regenerationLabels[kind]||labels[kind]:labels[kind],busy,blocked:busy||kind==='done',error:kind==='failed'?job?.error:undefined,regenerating};
}
