import {useEffect,useState} from 'react';
import {Timer} from 'lucide-react';
import {formatDuration} from '../lib/image-timing';
import type {TimingDisplay} from '../lib/image-timing';
export function ImageTimingText({timing,compact=false}:{timing?:TimingDisplay;compact?:boolean}){
  const [now,setNow]=useState(Date.now());
  useEffect(()=>{if(!timing?.startedAt)return;setNow(Date.now());const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[timing?.startedAt]);
  if(!timing||(compact&&timing.durationMs===undefined&&!timing.startedAt))return null;
  const duration=timing.startedAt?Math.max(0,now-timing.startedAt):timing.durationMs;
  const detail=timing.stages?Object.entries(timing.stages).map(([key,value])=>({forward:'正打',reverse:'反打',composing:'拼接与标注'}[key]||key)+' '+formatDuration(value)).join(' · '):undefined;
  return <span className={'image-duration'+(compact?' compact':'')} title={detail} aria-live="off"><Timer size={compact?11:13}/>{timing.label}{duration===undefined?'':' '+formatDuration(duration)}</span>;
}
