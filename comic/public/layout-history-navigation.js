import {allLayers} from './layers.js';
import {layerDocumentBox} from './multi-selection.js';
import {layoutLongStrip} from './model.js';
import {isLibrarySfx,sfxBounds} from './sfx-library.js';
const types={panel:'画面',bubble:'气泡',gradient:'渐变',page:'画板',document:'工程'};
export function historyObjectLabel(project,change){const layer=allLayers(project).find(e=>e.item.id===change.objectId);return (isLibrarySfx(layer?.item)?'特效字':types[change.objectType]||change.objectType)+' · '+(layer?.item.name||change.sourceShotCode||change.objectId.slice(-8));}
function setField(object,path,value){const keys=path.split('.'),last=keys.pop();let target=object;for(const key of keys)target=target[key]||=( {} );target[last]=value;}
function historicalObject(project,record,change){
 const key=change.objectType+':'+change.objectId,baseline=project.layoutHistory?.baseline.objects[key];
 let state=baseline?structuredClone(baseline):{context:{...change},values:{}};
 for(const step of project.layoutHistory?.records||[]){for(const c of step.changes.filter(c=>c.objectId===change.objectId&&c.objectType===change.objectType)){
   state.context={...state.context,...c};for(const f of c.fields){const val=c.action==='delete'?f.before:f.after;if(f.field.startsWith('context.'))setField(state.context,f.field.slice(8),val);else setField(state.values,f.field,val);}
  }if(step.id===record.id)break;}
 return state;
}
function union(boxes){if(!boxes.length)return null;const x=Math.min(...boxes.map(b=>b.x)),y=Math.min(...boxes.map(b=>b.y));return {x,y,w:Math.max(...boxes.map(b=>b.x+b.w))-x,h:Math.max(...boxes.map(b=>b.y+b.h))-y};}
/** Resolves only the open project. Missing objects use historical geometry, never guessed IDs. */
export function resolveHistoryLocation(project,record,{objectId='',measurement}={}){
 if(!project||record.projectId!==project.id)return {targets:[],box:null,message:'这条记录属于来源工程；不会切换到其他工程或话。'};
 const layout=layoutLongStrip(project.pages),pages=new Map(layout.pages.map(p=>[p.pageId,p])),layers=new Map(allLayers(project).map(e=>[e.item.id,e]));
 let changes=record.changes.filter(c=>!objectId||c.objectId===objectId);
 const concrete=changes.filter(c=>['panel','bubble','gradient'].includes(c.objectType));if(concrete.length)changes=concrete;else changes=changes.filter(c=>c.objectType==='page');
 const targets=changes.map(c=>{
  const entry=layers.get(c.objectId),label=historyObjectLabel(project,c);
  if(entry)return {id:c.objectId,pageId:entry.pageId,label,status:entry.item.visible===false?'hidden':'current',box:layerDocumentBox(project,c.objectId,measurement)};
  if(c.objectType==='page'){const p=pages.get(c.objectId);return {id:c.objectId,pageId:c.objectId,label,status:p?'page':'missing-page',box:p?{x:0,y:p.y,w:p.width,h:p.height}:null};}
  const historical=historicalObject(project,record,c),v=historical.values,p=pages.get(historical.context.pageId||c.pageId);
  if(c.objectType!=='gradient'&&!p)return {id:c.objectId,pageId:c.pageId,label,status:'missing-page',box:null};
  const scale=p?.scale||1,offset=p?.y||0,b=isLibrarySfx(v)?sfxBounds(v):{x:v.x,y:v.y,w:v.w,h:v.h};
  const valid=['x','y','w','h'].every(k=>Number.isFinite(b[k]))&&b.w>0&&b.h>0;
  return {id:c.objectId,pageId:p?.pageId||null,label,status:'deleted',box:valid?{x:b.x*scale,y:offset+b.y*scale,w:b.w*scale,h:b.h*scale}:null};
 });
 const box=union(targets.map(t=>t.box).filter(Boolean)),missing=targets.filter(t=>t.status==='deleted'||t.status==='missing-page'),hidden=targets.some(t=>t.status==='hidden');
 return {targets,box,message:missing.length?`含 ${missing.length} 个已删除或画板不存在的对象；仅定位可确认的历史区域，不选中已删除对象。`:hidden?'已定位；含隐藏对象，仅标示区域，不改变可见性。':box?`已定位 ${targets.length} 个对象；不撤销或修改工程。`:'没有可定位的对象或历史坐标。'};
}
/** Metadata annotates the existing real undo/future arrays; no second undo stack. */
export function historyStepAvailability(record,history,future,operationIds,invalidated){
 const undoIndex=history.findIndex(s=>operationIds.get(s)===record.id),redoIndex=future.findIndex(s=>operationIds.get(s)===record.id);
 const undoSteps=undoIndex<0?0:history.length-undoIndex,redoSteps=redoIndex<0?0:future.length-redoIndex;
 return {undoSteps,redoSteps,reason:undoSteps||redoSteps?'':invalidated.has(record.id)?'新修改已替换此重做分支。':record.source==='undo'||record.source==='redo'?'这是撤销/重做审计事件，请在原修改步骤控制恢复。':'无本次会话恢复快照：重开工程、外部更新、超过最近 50 步或内存预算回收后不能恢复。'};
}
