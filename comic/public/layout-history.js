import {generationPromptSelection} from './prompt-source.js';
import {preserveEditRevision} from './revision-sync.js';
import {isLibrarySfx} from './sfx-library.js';
// Layout audit data only. Never include images, prompts, dialogue text or masks.
import {resolveNegativePrompt} from './generation-constraints.js';
export const LAYOUT_HISTORY_VERSION = 1;
export const HISTORY_LIMITS = Object.freeze({records:2000,bytes:16*1024*1024});
export const historyJsonBytes=value=>new TextEncoder().encode(JSON.stringify(value)).length;
const sources = new Set(['manual','automatic','undo','redo','unknown']);
const copy = value => JSON.parse(JSON.stringify(value));
const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
const scalar = value => typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value) || typeof value === 'string' && value.length <= 240 && !/data:|base64/i.test(value);
const fields = (object,keys) => Object.fromEntries(keys.filter(key=>scalar(object?.[key])).map(key=>[key,object[key]]));
const points = value => Array.isArray(value) && value.length <= 64 ? value.map(p=>fields(p,['x','y'])) : null;
const time = value => value || new Date().toISOString();
const keyFor = (type,id) => type+':'+id;
function template(project,page,item){
  const intent=item?.layoutIntent || (item?.parentPanelId && page?.panels?.find(p=>p.id===item.parentPanelId)?.layoutIntent);
  if(intent?.templateId)return {templateId:intent.templateId,templateVersion:intent.templateVersion??null};

  return {templateId:page?.layoutPreset??null,templateVersion:page?.layoutPresetVersion??null};
}
function geometry(item){
  const out=fields(item,['x','y','w','h','width','height','kind','shape','type','visible','locked','border','borderColor','feather','coverage','background','fontSize','padding','lineHeight','letterSpacing','fontFamily','fontWeight','textAlign','textColor','outlineWidth','outlineColor','fillColor','fillOpacity','writingMode','textDirection','overflow','opacity','rotation','sfxImage','sfxImageKey','sfxImageBaseWidth','sfxLibrary','sfxTypeface','sfxPreset','fontStyle','shadowOffsetX','shadowOffsetY','shadowColor','imageAssetId','parentPanelId','shotId']);
  if(item.generation){let hash=2166136261;for(const char of JSON.stringify({prompt:generationPromptSelection(item).text,promptSource:item.generation.promptSource??'imported',negativePrompt:resolveNegativePrompt(item.generation),shotSize:item.generation.shotSize,cameraAngle:item.generation.cameraAngle,referenceIds:item.referenceIds,referenceRoles:item.generation.referenceRoles})){hash=Math.imul(hash^char.codePointAt(0),16777619);}out.panelContentFingerprint=(hash>>>0).toString(16);}
  if(isLibrarySfx(item)){let hash=2166136261;for(const char of String(item.text)){hash=Math.imul(hash^char.codePointAt(0),16777619);}out.sfxTextFingerprint=(hash>>>0).toString(16);}
  if(item.points)out.points=points(item.points);
  for(const name of ['imageTransform','imageCrop','crop','textBox','tail','featherEdges','stripSpace'])if(item[name])out[name]=fields(item[name],['x','y','w','h','width','height','scale','rotation','flipX','flipY','mode','side','base','visible','top','bottom','left','right','version','pageId']);
  if(item.gradient){out.gradient=fields(item.gradient,['enabled','mode','startColor','endColor','opacity']);for(const name of ['start','end'])if(item.gradient[name])out.gradient[name]=fields(item.gradient[name],['x','y']);if(item.gradient.stops)out.gradient.stops=item.gradient.stops.map(s=>fields(s,['offset','color','opacity','feather']));}
  return out;
}
/** A baseline describes the layout when recording starts, never presumed past edits. */
export function captureLayout(project){
  const objects={},shots=new Map((project.shots||[]).map(s=>[s.id,s]));
  const add=(type,item,page,extra={})=>{
    const shot=shots.get(item.shotId),story=shot?.storyboard||item.storyboard;
    objects[keyFor(type,item.id)]={context:{projectId:project.id,pageId:page?.id??null,objectId:item.id,objectType:type,
      sourceShotId:item.shotId??null,sourceShotCode:shot?.code??null,
      sourceStoryboard:story?fields(story,['format','rowKey','lineId','versionId','sourceHash','signature','sourceId','row','rowIndex','sheet','sheetName','episode','episodeId','shotId','code']):null,
      sourceLocation:shot?fields(shot,['sourceRow','sourceSheet']):null,
      ...template(project,page,item)},values:{...geometry(item),...extra}};
  };
  objects[keyFor('document',project.id)]={context:{projectId:project.id,pageId:null,objectId:project.id,objectType:'document',sourceShotId:null,sourceShotCode:null,sourceStoryboard:null,...template(project)},values:{pageOrder:(project.pages||[]).map(p=>p.id),layerOrder:[...(project.layerOrder||[])]}};
  for(const page of project.pages||[]){
    add('page',page,page,{panelOrder:(page.panels||[]).map(p=>p.id)});
    for(const [index,item] of (page.panels||[]).entries()){
      const previous=page.panels[index-1];
      add('panel',item,page,{panelIndex:index,precedingPanelId:previous?.id??null,gapBefore:previous?item.y-(previous.y+previous.h):null});
    }
    for(const item of page.bubbles||[])add('bubble',item,page);
  }
  for(const item of project.gradients||[])add('gradient',item,null);
  return {projectId:project.id,objects};
}
export function ensureLayoutHistory(project,{now,limits}={}){
  if(project.layoutHistory){if(project.layoutHistory.version!==LAYOUT_HISTORY_VERSION)throw new Error('调整记录版本不受支持，原记录已保留');trimLayoutHistory(project.layoutHistory);return project.layoutHistory;}
  const baseline=captureLayout(project),at=time(now);
  return project.layoutHistory={version:LAYOUT_HISTORY_VERSION,retention:'rolling',bytePolicy:'drop-oldest-half',pruneCycles:0,evictedRecords:0,startedAt:at,baseline:{capturedAt:at,origin:'current-layout-at-first-use',...baseline},limits:{...HISTORY_LIMITS,...limits},records:[],paused:null,unrecordedOperations:0};
}
export function trimLayoutHistory(history){
 history.retention='rolling';history.paused=null;history.evictedRecords||=0;
 history.limits||={...HISTORY_LIMITS};
 // Migrate the former default once; explicit custom budgets remain supported.
 if(!history.bytePolicy&&history.limits.bytes===4*1024*1024)history.limits.bytes=HISTORY_LIMITS.bytes;
 history.bytePolicy='drop-oldest-half';history.pruneCycles||=0;history.oversizedRecord=false;
 const limit=Number.isFinite(history.limits.bytes)&&history.limits.bytes>0?history.limits.bytes:HISTORY_LIMITS.bytes;
 const maxRecords=Number.isFinite(history.limits.records)?Math.max(1,history.limits.records):HISTORY_LIMITS.records;
 if(history.records.length>maxRecords){const count=history.records.length-maxRecords;history.records.splice(0,count);history.evictedRecords+=count;}
 while(history.records.length&&historyJsonBytes(history)>=limit)evictOldestLayoutHalf(history);
 // The initial baseline is protected even if it alone exceeds the audit budget.
 history.oversizedRecord=historyJsonBytes(history)>=limit;
 return history;
}
export function evictOldestLayoutHalf(history){
 const count=Math.ceil(history.records.length/2);if(!count)return 0;
 history.records.splice(0,count);history.evictedRecords=(history.evictedRecords||0)+count;history.pruneCycles=(history.pruneCycles||0)+1;return count;
}
function difference(a,b,path='',out=[]){
  for(const key of new Set([...Object.keys(a||{}),...Object.keys(b||{})])){
    const before=a?.[key],after=b?.[key],field=path?path+'.'+key:key;
    if(same(before,after))continue;
    if(before&&after&&typeof before==='object'&&typeof after==='object'&&!Array.isArray(before)&&!Array.isArray(after))difference(before,after,field,out);
    else out.push({field,before:before??null,after:after??null});
  }
  return out;
}
function categories(change){
  if(change.action!=='update')return ['layer.'+change.action];
  const names=new Set();
  for(const {field} of change.fields){
    if(/^(imageTransform|imageCrop|crop|points)(\.|$)/.test(field))names.add('crop');
    else if(/^tail(\.|$)/.test(field))names.add('bubble.tail');
    else if(/^(x|y)$/.test(field))names.add(change.objectType==='bubble'?'bubble.move':'move');
    else if(/^(w|h|width|height|textBox)(\.|$)/.test(field))names.add(change.objectType==='bubble'?'bubble.resize':'resize');
    else if(/Order$|^(panelIndex|precedingPanelId|gapBefore)$/.test(field))names.add('arrangement');
    else names.add('property');
  }
  return [...names];
}
/** Call once at completed operation boundaries, never pointermove. Mutates only after.layoutHistory. */
export function recordLayoutAdjustment(before,after,{source='unknown',operation,now,operationId,relatedOperationId=null,copiedFrom={}}={}){
  const history=after.layoutHistory||copy(ensureLayoutHistory(before,{now}));
  after.layoutHistory=history;
  const a=captureLayout(before),b=captureLayout(after),changes=[];
  for(const key of new Set([...Object.keys(a.objects),...Object.keys(b.objects)])){
    const old=a.objects[key],next=b.objects[key],fields=difference(old?.values,next?.values);
    if(old&&next)fields.push(...difference(old.context,next.context,'context'));
    if(!fields.length)continue;
    const context=next?.context||old.context;
    const change={...context,action:!old?'create':!next?'delete':'update',copiedFromId:copiedFrom[context.objectId]??null,fields};
    change.categories=categories(change);changes.push(change);
  }
  if(!changes.length){trimLayoutHistory(history);return {record:null,warning:null};}
  const record={id:operationId||'adjustment_'+globalThis.crypto.randomUUID(),projectId:after.id,at:time(now),source:sources.has(source)?source:'unknown',
    operation:operation||[...new Set(changes.flatMap(c=>c.categories))].join('+'),relatedOperationId,changes};
  history.records.push(record);trimLayoutHistory(history);return {record,warning:null};
}
/** Undo restores layout state, while audit records and initial baseline remain chronological. */
export function preserveLayoutHistory(current,target){target.layoutHistory=copy(ensureLayoutHistory(current));return preserveEditRevision(current,target);}
export function layoutEditSnapshot(project){const {layoutHistory,...document}=project;return copy(document);}
export function queryLayoutHistory(project,{objectId='',operation='',source='',offset=0,limit=100}={}){
  const history=project.layoutHistory;
  if(!history)return [];
  return history.records.filter(r=>(!source||r.source===source)&&(!operation||r.operation.includes(operation)||r.changes.some(c=>c.categories.some(v=>v.includes(operation))))&&(!objectId||r.changes.some(c=>c.objectId===objectId||c.pageId===objectId||c.sourceShotId===objectId))).slice(offset,offset+limit);
}
export function exportLayoutHistory(project){
  return {format:'comic-layout-adjustments',version:1,exportedAt:new Date().toISOString(),projectId:project.id,projectTitle:project.title,
    history:project.layoutHistory?copy(project.layoutHistory):null};
}
export function layoutHistorySummary(project){
  const h=project.layoutHistory;if(!h)return '尚未启用调整记录；启用时会从当前布局开始，不补写旧历史。';
  const groups=new Map();
  for(const r of h.records)for(const c of r.changes)for(const f of c.fields){const key=JSON.stringify([c.templateId,c.templateVersion,r.source,c.objectType,f.field]);groups.set(key,(groups.get(key)||0)+1);}
  const lines=[`工程：${project.title} (${project.id})`,`记录开始：${h.startedAt}；基线：${h.baseline.origin==='automatic-layout-output'?'本次自动排版完成后的原始布局':'首次使用时的当前布局（不补写旧历史）'}。`,
    `已完成操作：${h.records.length} 条；上限：${h.limits.records} 条 / ${Math.round(h.limits.bytes/1024)} KB。`,
    `记录状态：达到大小上限删除最早一半记录，持续循环；已自动清理最旧 ${h.evictedRecords||0} 条；旧版本暂停期间未记录：${h.unrecordedOperations} 次。`,
    '字段修改频次（含自动、人工、撤销重做或未知来源；可按来源分析）：'];
  for(const [key,count] of [...groups].sort((a,b)=>b[1]-a[1])){const [id,version,source,type,field]=JSON.parse(key);lines.push(`${count} 次 | 模板 ${id??'未知'} / 版本 ${version??'未知'} | ${source} | ${type}.${field}`);}
  return lines.join('\n');
}
