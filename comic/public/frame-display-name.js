export function frameDisplayName(frame,shot,{episode}={}){
 const unit=frame?.layoutUnitId||frame?.storyboard?.unitId||frame?.layoutIntent?.unitId||shot?.sourceFields?.['格ID']||shot?.storyboard?.unitId||shot?.code||'',match=/^E(\d+)[-·](\d+)(.*)$/i.exec(unit),number=match?.[2]||shot?.sourceFields?.['格号']||(/^\d+$/.test(shot?.code||'')?shot.code:null),ep=Number(episode||match?.[1]||shot?.episode||shot?.storyboard?.episode),size=frame?.generation?.shotSize||shot?.shotSizeRaw||shot?.shotScale||shot?.shotSize||'';
 const code=number?String(number).padStart(3,'0')+(match?.[3]||''):unit||'未绑定';return [ep?'第'+ep+'话':'',code,size].filter(Boolean).join(' · ');
}
export function projectFrameName(project,frame){const shot=project?.shots?.find(s=>s.id===frame?.shotId);return frameDisplayName(frame,shot);}
export function taskFrameName(project,job){const frame=project?.pages?.flatMap(p=>p.panels).find(f=>f.id===job.panelId);if(frame)return projectFrameName(project,frame);return frameDisplayName(null,{code:job.shotCode,shotSize:job.shotSize})+(job.shotCode?'':' · '+(job.shotTitle||'镜头'));}
