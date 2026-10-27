import {projectFrameName} from './frame-display-name.js';
import {ACTIVE_TASK_STATES,taskPhaseLabel,taskShortTime} from './job-cards.js';
/** Status belongs to jobs, never to pixels or exported comic content. */
export function frameStatusRows({project,jobs=[],submitting=new Set(),pageIds=[],now=Date.now()}={}){
 if(!project)return [];const pages=project.pages.filter(p=>pageIds.includes(p.id)),frames=new Map(pages.flatMap(p=>p.panels.map(f=>[f.id,{frame:f,page:p}]))),latest=new Map();
 for(const job of jobs)if(job.projectId===project.id&&frames.has(job.panelId)){const prior=latest.get(job.panelId);if(!prior||String(job.created||'')>=String(prior.created||''))latest.set(job.panelId,job);}
 const rows=[];for(const [panelId,entry] of frames){if(entry.frame.visible===false)continue;let job=latest.get(panelId);if(submitting.has(panelId))job={id:'submitting:'+panelId,panelId,status:'submitting',message:'正在提交生成请求'};if(!job)continue;const justDone=job.status==='done'&&now-Date.parse(job.completedAt||job.updated||0)<10000;if(!['submitting','failed',...ACTIVE_TASK_STATES].includes(job.status)&&!justDone)continue;rows.push({...entry,job,name:projectFrameName(project,entry.frame)});}return rows;
}
export function mountFrameGenerationStatus({wrap,stage,getState,escape}){
 const progress=document.createElement('div');progress.className='frame-progress-layer';progress.setAttribute('aria-label','格内生成进度');wrap.append(progress);
 const rows=()=>{const state=getState();return state.fixed?[]:frameStatusRows(state);};
 function renderProgress(){
  const state=getState(),origin=wrap.getBoundingClientRect(),scroll=wrap.querySelector('.canvas-scroll');
  if(state.fixed||!state.project){progress.replaceChildren();return;}
  // Read the rendered frame outline so covers, virtual scrolling and zoom share the exact canvas position.
  const outlines=new Map();for(const node of stage.querySelectorAll('[data-panel][data-layer-type="panel"]')){const outline=node.querySelector(':scope > path');if(outline&&!outlines.has(node.dataset.panel))outlines.set(node.dataset.panel,outline);}
  const clip=scroll?.getBoundingClientRect()||origin,left=clip.left-origin.left,top=clip.top-origin.top,right=left+(scroll?.clientWidth||clip.width),bottom=top+(scroll?.clientHeight||clip.height);
  progress.innerHTML=rows().filter(row=>row.job.status==='submitting'||ACTIVE_TASK_STATES.includes(row.job.status)).map(row=>{
   const outline=outlines.get(row.frame.id);if(!outline)return '';
   const box=outline.getBoundingClientRect(),sx=box.left-origin.left,sy=box.top-origin.top,w=box.width,h=box.height;
   const l=Math.max(left,sx),t=Math.max(top,sy),r=Math.min(right,sx+w),d=Math.min(bottom,sy+h),vw=r-l,vh=d-t;if(vw<48||vh<32)return '';
   const compact=vw<110||vh<50,width=Math.min(128,vw-8),height=Math.min(compact?26:42,vh-4),waiting=['awaiting_confirmation','recoverable'].includes(row.job.status),submitting=row.job.status==='submitting';
   return `<section class="frame-progress ${compact?'compact':''} ${waiting?'waiting':''}" data-frame-progress="${escape(row.frame.id)}" role="status" aria-live="off" aria-label="${escape(row.name+' · '+(submitting?'正在提交':taskPhaseLabel(row.job)))}" style="left:${l+(vw-width)/2}px;top:${t+(vh-height)/2}px;width:${width}px;height:${height}px"><i class="frame-progress-spinner" aria-hidden="true"></i><strong>${submitting?'正在提交':escape(taskPhaseLabel(row.job))}</strong><small ${submitting?'':`data-job-short-time="${escape(row.job.id)}"`}>${submitting?'准备生成请求':escape(taskShortTime(row.job))}</small></section>`;
  }).join('');
 }
 return {render:renderProgress};
}
