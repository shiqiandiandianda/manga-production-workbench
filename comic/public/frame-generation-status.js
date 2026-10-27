import {bounds} from './model.js';
import {projectFrameName} from './frame-display-name.js';
import {ACTIVE_TASK_STATES,taskPhaseLabel,taskShortTime,taskMessage} from './job-cards.js';
/** Status belongs to jobs, never to pixels or exported comic content. */
export function frameStatusRows({project,jobs=[],submitting=new Set(),pageIds=[],now=Date.now()}={}){
 if(!project)return [];const pages=project.pages.filter(p=>pageIds.includes(p.id)),frames=new Map(pages.flatMap(p=>p.panels.map(f=>[f.id,{frame:f,page:p}]))),latest=new Map();
 for(const job of jobs)if(job.projectId===project.id&&frames.has(job.panelId)){const prior=latest.get(job.panelId);if(!prior||String(job.created||'')>=String(prior.created||''))latest.set(job.panelId,job);}
 const rows=[];for(const [panelId,entry] of frames){if(entry.frame.visible===false)continue;let job=latest.get(panelId);if(submitting.has(panelId))job={id:'submitting:'+panelId,panelId,status:'submitting',message:'正在提交生成请求'};if(!job)continue;const justDone=job.status==='done'&&now-Date.parse(job.completedAt||job.updated||0)<10000;if(!['submitting','failed',...ACTIVE_TASK_STATES].includes(job.status)&&!justDone)continue;rows.push({...entry,job,name:projectFrameName(project,entry.frame)});}return rows;
}
export function mountFrameGenerationStatus({wrap,stage,button,getState,escape,storage=globalThis.localStorage}){
 const root=document.createElement('div');root.className='frame-status-rail';root.setAttribute('aria-label','画格生成状态');wrap.append(root);let enabled=true;try{enabled=storage.getItem('comic-frame-generation-status')!=='hidden';}catch{}const hidden=new Set();
 const rows=()=>{const state=getState();return state.fixed?[]:frameStatusRows(state);};
 function syncVisibility(){const visible=enabled&&rows().length>0;wrap.classList.toggle('has-frame-status',visible);root.hidden=!visible;button.setAttribute('aria-pressed',String(enabled));button.textContent=enabled?'隐藏格子生成状态':'显示格子生成状态';return visible;}
 function render(){if(!syncVisibility()){root.replaceChildren();return;}const state=getState(),matrix=stage.getScreenCTM(),origin=wrap.getBoundingClientRect();if(!matrix||!state.layout)return;let bottom=8;const positioned=[];
  for(const row of rows()){const entry=state.layout.pages.find(p=>p.pageId===row.page.id);if(!entry)continue;const b=bounds(row.frame),y=entry.y+(row.frame.y+b.y)*entry.scale-(state.offset||0),top=matrix.d*y+matrix.f-origin.top,height=b.h*entry.scale*matrix.d;if(top+height<0||top>origin.height)continue;positioned.push({...row,top});}
  positioned.sort((a,b)=>a.top-b.top);root.innerHTML=positioned.map(row=>{const collapsed=hidden.has(row.job.id),height=collapsed?38:83,top=Math.max(bottom,Math.min(Math.max(8,row.top),origin.height-height-8));if(top+height>origin.height)return '';bottom=top+height+7;return `<section class="frame-status-badge ${row.job.status}" data-frame-status="${escape(row.frame.id)}" style="top:${top}px" title="${escape(row.name+' · '+taskMessage(row.job))}"><strong>${escape(row.name)}</strong>${collapsed?`<button type="button" data-restore-frame-status="${escape(row.job.id)}">显示状态</button>`:`<button type="button" class="frame-status-close" data-hide-frame-status="${escape(row.job.id)}" aria-label="隐藏${escape(row.name)}生成状态">×</button><span>${row.job.status==='submitting'?'提交中':escape(taskPhaseLabel(row.job))}</span><small>${row.job.status==='submitting'?'正在发送请求':escape(taskShortTime(row.job))}</small>`}</section>`;}).join('');
 }
 button.addEventListener('click',()=>{enabled=!enabled;if(enabled)hidden.clear();try{storage.setItem('comic-frame-generation-status',enabled?'visible':'hidden');}catch{}getState().onChange?.();render();});
 root.addEventListener('click',event=>{const hide=event.target.closest('[data-hide-frame-status]'),restore=event.target.closest('[data-restore-frame-status]');if(hide)hidden.add(hide.dataset.hideFrameStatus);if(restore)hidden.delete(restore.dataset.restoreFrameStatus);render();});
 return {render,syncVisibility};
}
