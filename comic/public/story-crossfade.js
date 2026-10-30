import {gradientStops} from './gradient-stops.js';
import {storyFadeSteps} from './story-fade-curve.js';

const clamp=value=>Math.max(0,Math.min(1,value));
const smooth=value=>{const at=clamp(value)*(storyFadeSteps.length-1),i=Math.min(storyFadeSteps.length-2,Math.floor(at)),t=at-i;return storyFadeSteps[i].amount*(1-t)+storyFadeSteps[i+1].amount*t;};
const groupOf=entry=>entry.type==='gradient'&&entry.frame.storyCrossfade?.version===1?entry.frame.storyCrossfade.group:null;
const canNormalize=frame=>frame.points?.length===4&&[[0,0],[1,0],[1,1],[0,1]].every(([x,y])=>frame.points.some(p=>p.x===x&&p.y===y))&&
 frame.gradient?.enabled&&frame.gradient.opacity===1&&gradientStops(frame.gradient).every(s=>s.opacity===1)&&
 !(frame.mask?.enabled&&frame.mask.strokes?.length)&&!(frame.featherEdges?.left>0)&&!(frame.featherEdges?.right>0)&&(!frame.feather||frame.featherEdges);
function weightAt(frame,y){
 const local=y-frame.y;if(local<0||local>frame.h)return 0;
 const edges=frame.featherEdges||{};
 return (edges.top?smooth(local/edges.top):1)*(edges.bottom?smooth((frame.h-local)/edges.bottom):1);
}
/** Render-only masks turn normalized fade weights into ordinary source-over alpha.
 * Additive blending clips RGB when edited regions overlap beyond their paired fades.
 * Source-over cannot brighten colors past their endpoints, in either SVG or PNG export.
 */
export function prepareStoryCrossfades(entries){
 const result=entries.slice();
 for(let start=0;start<entries.length;){
  const group=groupOf(entries[start]);if(typeof group!=='string'||!group){start++;continue;}
  let end=start+1;while(end<entries.length&&groupOf(entries[end])===group)end++;
  const run=entries.slice(start,end),frames=run.map(e=>e.frame);
  if(frames.length>1&&frames.every(f=>canNormalize(f)&&f.x===frames[0].x&&f.w===frames[0].w)){
   const knots=new Set();
   for(const f of frames){knots.add(f.y);knots.add(f.y+f.h);for(const s of storyFadeSteps){if(f.featherEdges?.top)knots.add(f.y+s.offset*f.featherEdges.top);if(f.featherEdges?.bottom)knots.add(f.y+f.h-s.offset*f.featherEdges.bottom);}}
   const ordered=[...knots].sort((a,b)=>a-b);
   for(let i=0;i<frames.length;i++){
    const f=frames[i],alpha=y=>{const weights=frames.map(frame=>weightAt(frame,y)),total=weights.reduce((a,b)=>a+b,0),later=weights.slice(i+1).reduce((a,b)=>a+b,0),denominator=Math.max(1,total)-later;return denominator<1e-10?1:clamp(weights[i]/denominator);};
    const positions=[f.y,...ordered.filter(y=>y>f.y&&y<f.y+f.h),f.y+f.h],stops=[{offset:0,amount:alpha(f.y)}];
    const append=(a,b,va,vb,depth=0)=>{const mid=(a+b)/2,vm=alpha(mid),q1=alpha((3*a+b)/4),q3=alpha((a+3*b)/4);if(depth<10&&b-a>.001&&Math.max(Math.abs(vm-(va+vb)/2),Math.abs(q1-(3*va+vb)/4),Math.abs(q3-(va+3*vb)/4))>.001){append(a,mid,va,vm,depth+1);append(mid,b,vm,vb,depth+1);}else stops.push({offset:(b-f.y)/f.h,amount:vb});};
    for(let j=1;j<positions.length;j++)append(positions[j-1],positions[j],alpha(positions[j-1]),alpha(positions[j]));
    result[start+i]={...run[i],frame:{...f,storyFadeStops:stops}};
   }
  }
  start=end;
 }
 return result;
}
