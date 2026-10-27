import {Loader2,Clock3,CheckCircle2,Pause,AlertCircle,Image as ImageIcon} from 'lucide-react';
import {ImageTimingText} from './image-timing';
import type {ImageStatus} from '../lib/image-status';

export function VariantStatus({status,index,compact=false,bar=false,announce=false}:{status:ImageStatus;index:number;compact?:boolean;bar?:boolean;announce?:boolean}){
  const letter=index===0?'A':'B';
  const Icon=['running','saving','submitting'].includes(status.kind)?Loader2:status.kind==='pending'?Clock3:status.kind==='done'?CheckCircle2:status.kind==='paused'?Pause:status.kind==='failed'?AlertCircle:ImageIcon;
  return <span className={'variant-status '+status.kind+(compact?' compact':'')} data-image-status={status.kind} data-variant={letter} role={announce?'status':undefined} aria-live={announce?'polite':undefined} aria-busy={status.busy} title={status.error}>
    <span className="variant-status-label"><Icon size={compact?12:15} className={Icon===Loader2?'spin':''}/><strong>{letter}</strong><span>{status.label}</span></span>
    <ImageTimingText timing={status.timing} compact={compact}/>
    {bar&&status.busy&&<span className={'image-activity-track '+status.kind} role="progressbar" aria-label={'候选版 '+letter+' · '+status.label}><span/></span>}
  </span>;
}

export function VariantGenerateButton({status,index,disabled=false,onClick}:{status:ImageStatus;index:number;disabled?:boolean;onClick:()=>void}){
  const letter=index===0?'A':'B';
  return <button disabled={disabled||status.blocked} onClick={onClick} aria-label={'候选版 '+letter+' · '+(status.blocked?status.label:status.kind==='failed'?'重试生成':'生成')}>
    {status.busy&&<Loader2 size={14} className="spin"/>}{status.blocked?status.kind==='done'?'此版已生成':status.label:status.kind==='failed'?'重试 '+letter+' 版':status.kind==='paused'?'继续生成 '+letter+' 版':'生成 '+letter+' 版'}
  </button>;
}
