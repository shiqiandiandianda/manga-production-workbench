import {taskHasPendingWork} from './text-review.mjs';
// Geometry locks protect pixels and position, not the instructions for the next attempt.
export function activeRegionAttempt(region,tasks){
  if(!region)return null;
  return [...tasks].find(task=>(task.regionId===region.id||task.id===region.jobId)&&task.decision!=='discarded'&&taskHasPendingWork(task))||null;
}
export function canEditRepairInstructions(region,{loading=false,creating=false,versionSelecting=false,selectingRegion=false}={}){
  return !!region&&!loading&&!creating&&!versionSelecting&&!selectingRegion&&!region.submitting;
}
export function updateRepairInstructions(region,{prompt='',references=[],padding=80}={}){
  if(!region||region.submitting)return false;
  region.prompt=String(prompt);region.references=structuredClone(references);region.padding=Number(padding);region.modifiedAt=Date.now();return true;
}
export function restoreRegionDescriptor(task,page){
  const region=task?.region,frame=region?.frame||task?.frame;
  if(!task?.regionId||!frame||![frame.x,frame.y,frame.width,frame.height].every(Number.isFinite)||frame.x<0||frame.y<0||frame.width<1||frame.height<1||frame.x+frame.width>page.width||frame.y+frame.height>page.height)return null;
  const restored=structuredClone(region||{});Object.assign(restored,{id:task.regionId,frame:{...frame},origin:region?.origin||{x:frame.x,y:frame.y},name:region?.name||'恢复选区',ratio:region?.ratio||'1:1',prompt:region?.prompt||task.label||'',references:region?.references||[],jobId:task.id,locked:true,recovered:true,modifiedAt:Date.now()});
  delete restored.submitting;delete restored.referenceLoading;delete restored.linking;restored.link=null;
  return restored;
}
export function adoptCanonicalReferences(current,submitted,canonical){
  if(!current||!submitted||!canonical||typeof current!=='object')return;
  for(const [key,value] of Object.entries(canonical)){
    if(typeof value==='string'&&value.startsWith('/repair/project-assets/')&&typeof submitted[key]==='string'&&submitted[key].startsWith('data:image/')&&current[key]===submitted[key])current[key]=value;
    else if(value&&typeof value==='object'&&submitted[key]&&current[key]){
      if(Array.isArray(value)&&Array.isArray(submitted[key])&&Array.isArray(current[key]))for(let index=0;index<value.length;index++){
        const item=value[index],before=item?.id?submitted[key].find(row=>row?.id===item.id):submitted[key][index],target=item?.id?current[key].find(row=>row?.id===item.id):current[key][index];
        if(item&&typeof item==='object')adoptCanonicalReferences(target,before,item);
      }else if(!Array.isArray(value))adoptCanonicalReferences(current[key],submitted[key],value);
    }
  }
}
export function visibleLayerWindows(transform,zoom,viewport,pageWidth,segments){
  const x=Math.max(0,-transform.x/zoom),right=Math.min(pageWidth,(viewport.width-transform.x)/zoom),top=Math.max(0,-transform.y/zoom),bottom=Math.max(top,(viewport.height-transform.y)/zoom),output=right>x?[{x,y:top,width:right-x,height:bottom-top}]:[];
  const source=[];for(const segment of segments){const from=Math.max(top,segment.start+segment.offset),to=Math.min(bottom,segment.end+segment.offset);if(to>from&&right>x)source.push({x,y:from-segment.offset,width:right-x,height:to-from});}
  return{source,output};
}

export function shouldActivateReceivedVersion(region,task){
  return !!region&&region.jobId===task.id&&(region.selectedVersionUpdatedAt||0)===(task.region?.selectedVersionUpdatedAt||0);
}

export function taskLayerBackup(editor,layer,decision){
  const saved=editor.projectLayer(layer),properties={};
  for(const key of ['x','y','scale','scaleX','scaleY','scaleMode','angle','skewX','opacity','visible','locked','userMaskModified','feather'])if(layer[key]!==undefined)properties[key]=layer[key];
  return{...properties,mask:saved?.mask,baseMask:saved?.baseMask,maskEdits:saved?.maskEdits,decision};
}
export function taskIsRunning(task){return !!task?.starting||['queued','running'].includes(task?.automation?.status);}
