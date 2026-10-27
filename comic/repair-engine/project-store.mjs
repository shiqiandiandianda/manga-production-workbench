import {normalizeRepairVersions,chosenRegionLayer} from './public/repair-versions.mjs';
import {hasReviewableAttempt} from './public/tasks.mjs';
import {normalizeSections,sectionManifest} from './public/page-sections.mjs';
import {normalizePageGaps} from './public/page-layout.mjs';
import path from 'node:path';
import {readFile,writeFile,rename,readdir,stat,lstat} from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import {sourceMetadata,exportPage,runPageTool,settleSourceWork} from './page-service.mjs';
import {replaceFile} from './safe-files.mjs';
import {purgeProjectFiles} from './project-delete.mjs';
import {ProjectAssets} from './project-assets.mjs';
import {renderServerTextTiles} from './server-text-render.mjs';
import {addEarlyTextLayers,companionAction,finishPendingText,normalizeCompanionStack} from './public/early-text.mjs';

const sourceId=value=>/^[a-f0-9]{32}$/.test(value);
const jobId=value=>/^\d{8}-\d{6}-[a-f0-9]{8}$/.test(value);
const signature=(tiles,gaps=[],sections=null)=>createHash('sha256').update(JSON.stringify([tiles||[],gaps,sections])).digest('hex');
async function readJSON(file,fallback){try{return JSON.parse(await readFile(file,'utf8'));}catch(error){if(error.code==='ENOENT'&&fallback!==undefined)return fallback;throw error;}}
async function atomicJSON(file,value){const temporary=file+'.'+randomUUID()+'.tmp';await writeFile(temporary,JSON.stringify(value),'utf8');await replaceFile(temporary,file);}

const plainObject=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const earlyLayerFields=new Set(['id','type','name','text','x','y','coordinateSpace','fontFamily','fontSize','fontWeight','bold','italic','underline','strikethrough','color','textDirection','textAlign','textWrap','textMode','textBoxWidth','textBoxHeight','lineHeight','letterSpacing','paragraphSpacing','textStrokeWidth','textStrokeColor','textShadow','scale','scaleX','scaleY','angle','skewX','opacity','visible','locked','originJobId','originRegionId','jobOrder','pendingAutoShow','autoTextPending','pendingLinkGroupId','linkGroupId','layoutVersion']);
// V3 native generation may flag its independently read text for human review.
// This is final companion metadata; it does not loosen the early-draft contract.
const finalTextLayerFields=new Set([...earlyLayerFields,'textNeedsReview']);
export function validateEarlyTextManifest(value,id,request,automation){
 if(!plainObject(value)||value.schemaVersion!==1||value.jobId!==id||!automation?.attemptId||value.attemptId!==automation.attemptId||!sourceId(request.sourceId)||!request.regionId||request.autoText!==true)throw new Error('早期文字任务记录不匹配');
 if(value.sourceId!==undefined&&value.sourceId!==request.sourceId||value.regionId!==undefined&&value.regionId!==request.regionId)throw new Error('早期文字工程或选区不匹配');
 if(!Array.isArray(value.layers)||value.layers.length<1||value.layers.length>12||!Array.isArray(value.bubbles)||value.bubbles.length>12)throw new Error('早期文字数量无效');
 const finiteRange=(number,min,max)=>typeof number==='number'&&Number.isFinite(number)&&number>=min&&number<=max;
 const layers=value.layers.map((layer,index)=>{
  if(!plainObject(layer)||layer.id!==`text-${id}-${index+1}`||layer.type!=='text'||Object.keys(layer).some(key=>!earlyLayerFields.has(key))||typeof layer.text!=='string'||!layer.text.trim()||layer.text.length>2000||!finiteRange(layer.x,-1000000,1000000)||!finiteRange(layer.y,-1000000,1000000)||!finiteRange(layer.fontSize,6,512))throw new Error('早期文字图层格式无效');
  if(layer.originJobId!==undefined&&layer.originJobId!==id||layer.originRegionId!==undefined&&layer.originRegionId!==request.regionId||layer.coordinateSpace!==undefined&&layer.coordinateSpace!==(request.coordinateSpace||'source'))throw new Error('早期文字来源无效');
  for(const [field,min,max] of [['fontWeight',1,1000],['textBoxWidth',0,4096],['textBoxHeight',0,8192],['lineHeight',.5,4],['letterSpacing',-200,512],['paragraphSpacing',0,512],['scale',.1,4],['scaleX',.1,4],['scaleY',.1,4],['angle',-3600,3600],['skewX',-100,100],['opacity',0,1],['textStrokeWidth',0,40]])if(layer[field]!==undefined&&!finiteRange(layer[field],min,max))throw new Error('早期文字样式无效');
  for(const field of ['name','fontFamily','jobOrder','pendingLinkGroupId','linkGroupId'])if(layer[field]!==undefined&&(typeof layer[field]!=='string'||layer[field].length>(field==='name'?2000:200)))throw new Error('早期文字样式名称无效');
  for(const field of ['color','textStrokeColor'])if(layer[field]!==undefined&&(typeof layer[field]!=='string'||!/^#[a-f0-9]{6}(?:[a-f0-9]{2})?$/i.test(layer[field])))throw new Error('早期文字颜色无效');
  for(const field of ['bold','italic','underline','strikethrough','textWrap','visible','locked','pendingAutoShow','autoTextPending'])if(layer[field]!==undefined&&typeof layer[field]!=='boolean')throw new Error('早期文字状态无效');
  if(layer.textDirection!==undefined&&!['horizontal','vertical-rl','vertical-lr'].includes(layer.textDirection)||layer.textAlign!==undefined&&!['left','center','right','justify'].includes(layer.textAlign)||layer.textMode!==undefined&&!['point','paragraph'].includes(layer.textMode))throw new Error('早期文字排版无效');
  if(layer.textShadow!==undefined&&layer.textShadow!==null){const shadow=layer.textShadow;if(!plainObject(shadow)||Object.keys(shadow).some(key=>!['color','blur','x','y'].includes(key))||typeof shadow.color!=='string'||!/^#[a-f0-9]{6}(?:[a-f0-9]{2})?$/i.test(shadow.color)||!finiteRange(shadow.blur,0,50)||!finiteRange(shadow.x,-100,100)||!finiteRange(shadow.y,-100,100))throw new Error('早期文字阴影无效');}
  const {linkGroupId,...properties}=layer;return {...properties,coordinateSpace:request.coordinateSpace||'source',originJobId:id,originRegionId:request.regionId,jobOrder:request.orderAt||request.createdAt,layoutVersion:2,visible:false,locked:false,pendingAutoShow:true,autoTextPending:true,...(layer.pendingLinkGroupId||linkGroupId?{pendingLinkGroupId:layer.pendingLinkGroupId||linkGroupId}:{})};
 });
 return {attemptId:value.attemptId,layers};
}
export async function readEarlyTextManifest(directory,id,request,automation){
 const file=path.join(directory,'early-text.json');let info;try{info=await lstat(file);}catch(error){if(error.code==='ENOENT')return null;throw error;}
 if(!info.isFile()||info.isSymbolicLink()||info.size>256*1024)throw new Error('早期文字文件无效或过大');
 const raw=await readFile(file,'utf8');if(Buffer.byteLength(raw,'utf8')>256*1024)throw new Error('早期文字文件过大');
 const value=JSON.parse(raw);if(value?.attemptId!==automation?.attemptId)return null;
 return {...validateEarlyTextManifest(value,id,request,automation),version:`${info.size}-${info.mtimeMs}`};
}
export async function readFinalCompanionManifest(directory,name,id,request,automation){
 if(!['editable-text.json','bubble-layers.json'].includes(name))throw new Error('返回图层文件名无效');
 const file=path.join(directory,name);let info;try{info=await lstat(file);}catch(error){if(error.code==='ENOENT')return null;throw error;}
 if(!info.isFile()||info.isSymbolicLink()||info.size>256*1024)throw new Error('返回图层文件无效或过大');
 const raw=await readFile(file,'utf8');if(Buffer.byteLength(raw,'utf8')>256*1024)throw new Error('返回图层文件过大');const value=JSON.parse(raw);
 if(!plainObject(value)||value.jobId!==id||value.attemptId!==undefined&&value.attemptId!==automation?.attemptId||value.sourceId!==undefined&&value.sourceId!==request.sourceId||value.regionId!==undefined&&value.regionId!==request.regionId)throw new Error('返回图层任务或请求编号不匹配');
 if(value.schemaVersion!==undefined&&value.schemaVersion!==1)throw new Error('返回图层版本无效');
 if((automation?.earlyTextReady||automation?.originalTextRecordSha256)&&value.attemptId!==automation.attemptId)throw new Error('当前识别流程的返回图层请求编号不匹配');
 if(!Array.isArray(value.layers)||value.layers.length>12)throw new Error('返回图层数量无效');
 for(let index=0;index<value.layers.length;index++){
  const layer=value.layers[index];if(!plainObject(layer)||layer.originJobId!==undefined&&layer.originJobId!==id||layer.originRegionId!==undefined&&layer.originRegionId!==request.regionId||layer.coordinateSpace!==undefined&&layer.coordinateSpace!==(request.coordinateSpace||'source'))throw new Error('返回图层来源不匹配');
  if(name==='editable-text.json'){
   if(layer.type!=='text'||typeof layer.text!=='string'||!layer.text.trim()||layer.text.length>2000||!Number.isFinite(layer.x)||!Number.isFinite(layer.y)||!Number.isFinite(layer.fontSize)||layer.fontSize<6||layer.fontSize>512||Object.keys(layer).some(key=>!finalTextLayerFields.has(key))||layer.textNeedsReview!==undefined&&typeof layer.textNeedsReview!=='boolean')throw new Error('返回文字图层无效');
   if(value.attemptId!==undefined&&layer.id!==`text-${id}-${index+1}`)throw new Error('返回文字图层编号无效');
  }else if(layer.type!=='image'||layer.imageFile!==`bubble-${index+1}.png`||value.attemptId!==undefined&&layer.id!==`bubble-${id}-${index+1}`)throw new Error('透明气泡路径或图层编号无效');
 }
 return value;
}

const markerMap=(a={},b={})=>Object.fromEntries([...new Set([...Object.keys(a),...Object.keys(b)])].map(id=>[id,Math.max(Number(a[id])||0,Number(b[id])||0)]));
export function regionDeleted(project,id){return (Number(project.deletedRegionIds?.[id])||0)>(Number(project.restoredRegionIds?.[id])||0);}
export async function recoverMissingRegions(root,id,project,meta,readRequest=jid=>readJSON(path.join(root,'jobs',jid,'request.json'),null)){
 const missing=new Set((project.layers||[]).filter(layer=>layer.type==='image'&&layer.regionId&&jobId(layer.jobId)&&!regionDeleted(project,layer.regionId)&&!['discarded','archived'].includes(project.tasks?.[layer.jobId]?.decision)).map(layer=>layer.regionId));let changed=false;
 for(const regionId of missing){if((project.regions||[]).some(region=>region.id===regionId)||!/^[a-z0-9-]{1,80}$/i.test(regionId))continue;
  const layers=(project.layers||[]).filter(layer=>layer.regionId===regionId&&jobId(layer.jobId)).sort((a,b)=>String(b.jobOrder||b.jobId).localeCompare(String(a.jobOrder||a.jobId)));let restored;
  for(const layer of layers){if(['discarded','archived'].includes(project.tasks?.[layer.jobId]?.decision))continue;const request=await readRequest(layer.jobId);if(!request||request.sourceId!==id||request.regionId!==regionId)continue;const frame=request.region?.frame||request.frame;if(!frame||!['x','y','width','height'].every(key=>Number.isInteger(frame[key]))||frame.x<0||frame.y<0||frame.width<1||frame.height<1||frame.x+frame.width>meta.width||frame.y+frame.height>meta.height)continue;
   const number=project.regionNumbers?.[regionId]||request.region?.number||Number(/(?:选区|修复)\s*(\d+)/.exec(request.region?.name||'')?.[1])||undefined;restored={...request.region,id:regionId,frame:{...frame},jobId:layer.jobId,locked:layer.locked!==false,prompt:request.prompt||request.region?.prompt||'',references:request.region?.references||[],recovered:true,...(number?{number}:{}),name:request.region?.name||(number?'选区 '+number:'恢复选区')};break;
  }
  if(restored){(project.regions||= []).push(restored);if(restored.number)(project.regionNumbers||= {})[regionId]=restored.number;changed=true;}
 }
 return changed;
}
export function activateAttachedVersion(project,request,id=request.id){
 const region=project.regions?.find(region=>region.id===request.regionId);if(!region||region.jobId!==id||(region.selectedVersionUpdatedAt||0)!==(request.region?.selectedVersionUpdatedAt||0))return false;
 region.versionPinned=false;region.selectedVersionJobId=id;return true;
}
export function mergeProject(current,incoming){
  const deletedRegionIds=markerMap(current.deletedRegionIds,incoming.deletedRegionIds),restoredRegionIds=markerMap(current.restoredRegionIds,incoming.restoredRegionIds),deletion={deletedRegionIds,restoredRegionIds};
  const tasks={...current.tasks};
  for(const [id,note] of Object.entries(incoming.tasks||{}))if((note.updatedAt||0)>=(tasks[id]?.updatedAt||0))tasks[id]={...tasks[id],...note};
  for(const [id,note] of Object.entries(current.tasks||{}))if(note.earlyTextReceived)tasks[id]={...tasks[id],earlyTextReceived:true,earlyTextIds:[...new Set([...(note.earlyTextIds||[]),...(tasks[id]?.earlyTextIds||[])])]};
  const incomingRegionFrames=new Map((incoming.regions??current.regions??[]).map(region=>[region.id,region.frame])),currentRegionFrames=new Map((current.regions||[]).map(region=>[region.id,region.frame]));
  const incomingLayoutDelta=layer=>{if(layer.coordinateSpace!=='output')return 0;const id=layer.regionId||layer.originRegionId,before=currentRegionFrames.get(id),after=incomingRegionFrames.get(id);return before&&after?after.y-before.y:0;};
  const atIncomingPose=layer=>{const dy=incomingLayoutDelta(layer);return dy?{...layer,y:layer.y+dy,...(layer.type==='text'&&layer.autoTextLayoutOffset!==undefined?{autoTextLayoutOffset:layer.autoTextLayoutOffset+dy}:{})}:layer;};
  const layers=[...(incoming.layers||[])].filter(layer=>!regionDeleted(deletion,layer.regionId||layer.originRegionId)&&(!layer.jobId&&!layer.originJobId||!['discarded','archived'].includes(tasks[layer.jobId||layer.originJobId]?.decision)));
  const promotedIds=new Set();for(let index=0;index<layers.length;index++){const layer=layers[index],old=current.layers?.find(item=>item.id===layer.id);if(layer.type==='text'&&layer.autoTextPending&&old?.autoTextPending===false){layers[index]={...layer};finishPendingText(layers[index],atIncomingPose(old));promotedIds.add(layer.id);}}
  const incomingIds=new Set(layers.map(layer=>layer.id));
  for(const layer of current.layers||[])if(layer.jobId&&!regionDeleted(deletion,layer.regionId)&&!layers.some(item=>item.id===layer.id||item.jobId===layer.jobId)&&!['discarded','archived'].includes(tasks[layer.jobId]?.decision)){const index=layers.findIndex(item=>item.jobOrder>layer.jobOrder);if(index<0)layers.push(atIncomingPose(layer));else layers.splice(index,0,atIncomingPose(layer));}
  for(const layer of current.layers||[])if(layer.originJobId&&!regionDeleted(deletion,layer.originRegionId)&&!incoming.tasks?.[layer.originJobId]?.autoTextReceived&&!(layer.type==='text'&&incoming.tasks?.[layer.originJobId]?.earlyTextReceived&&(incoming.tasks[layer.originJobId].earlyTextIds||[]).includes(layer.id))&&!layers.some(item=>item.id===layer.id)&&!['discarded','archived'].includes(tasks[layer.originJobId]?.decision)){const imageIndex=layers.findIndex(item=>item.jobId===layer.originJobId);layers.splice(imageIndex<0?layers.length:imageIndex+1,0,atIncomingPose(layer));}
  const unseenFinalJobs=new Set((current.layers||[]).filter(layer=>{const id=layer.jobId||layer.originJobId;return id&&current.tasks?.[id]?.autoTextReceived&&!incoming.tasks?.[id]?.autoTextReceived&&!incomingIds.has(layer.id)&&layers.some(item=>item.id===layer.id);}).map(layer=>layer.jobId||layer.originJobId));
  for(const id of unseenFinalJobs)normalizeCompanionStack(layers,(current.layers||[]).filter(layer=>layer.originJobId===id),layers.find(layer=>layer.jobId===id));
  const oldRegions=new Map((current.regions||[]).map(region=>[region.id,region]));
  const regionInputs=[...(incoming.regions??current.regions??[])];for(const region of current.regions||[])if(region.recovered&&!regionInputs.some(item=>item.id===region.id)&&!regionDeleted(deletion,region.id))regionInputs.push(region);
  const regions=regionInputs.filter(region=>!regionDeleted(deletion,region.id)).map(region=>{const old=oldRegions.get(region.id)||{},next={...old,...region,number:old.number||region.number,jobId:old.jobId||region.jobId};if((old.selectedVersionUpdatedAt||0)>(region.selectedVersionUpdatedAt||0)){next.selectedVersionJobId=old.selectedVersionJobId;next.versionPinned=old.versionPinned;next.selectedVersionUpdatedAt=old.selectedVersionUpdatedAt;}if((old.linkUpdatedAt||0)>(region.linkUpdatedAt||0)){next.link=old.link;next.linkUpdatedAt=old.linkUpdatedAt;}return next;});
  normalizeRepairVersions(regions,layers);
  const ids=new Set(layers.filter(layer=>layer.visible!==false&&!layer.versionHidden&&layer.opacity!==0).map(layer=>layer.id)),renderedLayers=[...(incoming.renderedLayers||[])].filter(tile=>ids.has(tile.layerId));
  const keepIds=new Set([...ids].filter(id=>!incomingIds.has(id)||incoming.renderedLayers===undefined||promotedIds.has(id)));
  for(const tile of current.renderedLayers||[])if(keepIds.has(tile.layerId)&&!renderedLayers.some(item=>item.layerId===tile.layerId&&item.x===tile.x&&item.y===tile.y)){const old=current.layers?.find(layer=>layer.id===tile.layerId),dy=old?incomingLayoutDelta(old):0;renderedLayers.push(dy?{...tile,y:tile.y+dy}:tile);}
  const orderedTiles=layers.flatMap(layer=>renderedLayers.filter(tile=>tile.layerId===layer.id));
  return{...current,...incoming,deletedRegionIds,restoredRegionIds,regionNumbers:{...incoming.regionNumbers,...current.regionNumbers},layers,tasks,regions,renderedLayers:orderedTiles,version:(current.version||0)+1,visualSignature:signature(orderedTiles,incoming.pageGaps??current.pageGaps??[],(incoming.sectionMode??current.sectionMode)?sectionManifest(layers):null)};
}

export class ProjectStore {
  constructor(root,storage,{toolRoot=root}={}){this.root=root;this.toolRoot=toolRoot;this.storage=storage;this.locks=new Map();this.attaching=new Map();this.earlyAttaching=new Map();this.attachedVersions=new Map();this.timers=new Map();this.composing=new Set();this.assets=new ProjectAssets(root);this.projectCache=new Map();this.reading=new Map();this.jobCache=new Map();this.jobReading=new Map();}
  file(id){if(!sourceId(id))throw new Error('漫画项目不存在');return path.join(this.root,'sources',id,'project.json');}
  async get(id){return this.locked(id,()=>this.load(id));}
  async load(id){
    const meta=await sourceMetadata(this.root,id);let info;try{info=await stat(this.file(id));}catch(error){if(error.code!=='ENOENT')throw error;}
    const stamp=info?`${info.size}-${info.mtimeMs}`:'missing',cache=this.projectCache.get(id);if(cache?.stamp===stamp)return structuredClone(cache.project);
    if(!this.reading.has(id)){const operation=(async()=>{const data=await readJSON(this.file(id),{layers:[],regions:[],tasks:{},renderedLayers:[],version:0}),recovered=await recoverMissingRegions(this.root,id,data,meta,jid=>this.job(jid).catch(error=>{if(error.code==='ENOENT')return null;throw error;})),canonical=await this.assets.externalize(id,data);if((canonical.changed||recovered)&&info)await atomicJSON(this.file(id),canonical.value);const latest=info?await stat(this.file(id)):null;this.projectCache.set(id,{stamp:latest?`${latest.size}-${latest.mtimeMs}`:'missing',project:canonical.value});if(this.projectCache.size>8)this.projectCache.delete(this.projectCache.keys().next().value);return canonical.value;})();this.reading.set(id,operation);operation.finally(()=>{if(this.reading.get(id)===operation)this.reading.delete(id);}).catch(()=>{});}
    return structuredClone(await this.reading.get(id));
  }
  async persist(id,project){const canonical=(await this.assets.externalize(id,project)).value;await atomicJSON(this.file(id),canonical);const info=await stat(this.file(id));this.projectCache.set(id,{stamp:`${info.size}-${info.mtimeMs}`,project:canonical});return canonical;}
  async job(id){
    if(!jobId(id))throw Object.assign(new Error('任务不存在'),{statusCode:404});
    if(this.jobReading.has(id))return structuredClone(await this.jobReading.get(id));
    const operation=(async()=>{const file=path.join(this.root,'jobs',id,'request.json');
      for(let attempt=0;attempt<4;attempt++){
        const info=await stat(file),stamp=`${info.size}-${info.mtimeMs}`,cache=this.jobCache.get(id);if(cache?.stamp===stamp)return cache.request;
        const request=await readJSON(file);if(request.id!==id)throw new Error('任务记录编号不匹配');let canonical=request,owned=false,written=false;
        if(sourceId(request.sourceId)){let meta;try{meta=await sourceMetadata(this.root,request.sourceId);}catch(error){if(error.code!=='ENOENT')throw error;}
          if(meta&&meta.id===request.sourceId&&!meta.deletedAt){owned=true;const converted=await this.assets.externalize(request.sourceId,request,{markProject:false});canonical=converted.value;
            if(converted.changed){const latest=await stat(file);if(`${latest.size}-${latest.mtimeMs}`!==stamp)continue;const currentMeta=await sourceMetadata(this.root,request.sourceId);if(currentMeta.id===request.sourceId&&!currentMeta.deletedAt){await atomicJSON(file,canonical);written=true;}else{canonical=request;owned=false;}}
          }
        }
        const latest=await stat(file),latestStamp=`${latest.size}-${latest.mtimeMs}`;if(!written&&latestStamp!==stamp)continue;
        if(owned||info.size<256*1024){this.jobCache.set(id,{stamp:latestStamp,request:canonical});if(this.jobCache.size>400)this.jobCache.delete(this.jobCache.keys().next().value);}return canonical;
      }
      throw new Error('任务记录正在更新，请稍后重试');
    })();this.jobReading.set(id,operation);try{return structuredClone(await operation);}finally{if(this.jobReading.get(id)===operation)this.jobReading.delete(id);}
  }
  async initializeCompletedVersions(){
    await this.jobs();
    let ids=[];try{ids=(await readdir(path.join(this.root,'sources'))).filter(sourceId);}catch(error){if(error.code!=='ENOENT')throw error;}
    for(const id of ids){const meta=await sourceMetadata(this.root,id);if(meta.deletedAt)continue;const project=await this.get(id);for(const layer of project.layers||[]){if(!jobId(layer.jobId)||['discarded','archived'].includes(project.tasks?.[layer.jobId]?.decision))continue;const request=await this.job(layer.jobId).catch(error=>{if(error.code==='ENOENT')return null;throw error;});if(request?.sourceId!==id)continue;try{const info=await stat(path.join(this.root,'jobs',layer.jobId,'repaired.png')),version=`${info.size}-${info.mtimeMs}`;if(project.tasks?.[layer.jobId]?.resultVersion===version)this.attachedVersions.set(layer.jobId,version);}catch(error){if(error.code!=='ENOENT')throw error;}}
    }
    return this.attachedVersions.size;
  }
  async locked(id,action){const previous=this.locks.get(id)||Promise.resolve(),next=previous.catch(()=>{}).then(action);this.locks.set(id,next);try{return await next;}finally{if(this.locks.get(id)===next)this.locks.delete(id);}}
  async save(id,body){
    if(!Array.isArray(body.layers)||body.layers.length>400||!Array.isArray(body.regions||[])||(body.regions||[]).length>200)throw new Error('工程图层或选区数量无效');
    const meta=await sourceMetadata(this.root,id);
    if(body.sectionMode!==undefined&&typeof body.sectionMode!=='boolean')throw new Error('漫画分段状态无效');
    if(body.sectionMode)body={...body,pageSections:normalizeSections(sectionManifest(body.layers),meta.height,meta.width)};
    if(body.pageGaps!==undefined)body={...body,pageGaps:normalizePageGaps(body.pageGaps,meta.height)};
    for(const region of body.regions||[]){const frame=region.frame;if(!/^[a-z0-9-]{1,80}$/i.test(region.id)||!frame||!['x','y','width','height'].every(key=>Number.isInteger(frame[key]))||frame.x<0||frame.y<0||frame.width<1||frame.height<1||frame.x+frame.width>meta.width||frame.y+frame.height>meta.height)throw new Error('选区图层坐标无效');}
    return this.locked(id,async()=>{if((await sourceMetadata(this.root,id)).deletedAt)throw Object.assign(new Error('项目已删除，不能再保存'),{statusCode:410});const current=await this.load(id);if(current.canvasVersion>=2&&body.canvasVersion!==2)throw Object.assign(new Error('工具已更新，请刷新页面后继续编辑，旧版本不能覆盖新版工程'),{statusCode:409});const combined=mergeProject(current,body),promoted=combined.layers.filter(layer=>layer.type==='text'&&layer.autoTextPending===false&&body.layers.some(item=>item.id===layer.id&&item.autoTextPending));if(promoted.length){const tiles=await renderServerTextTiles(this.toolRoot,this.root,promoted,this.assets,id,{fontAssets:combined.fontAssets||[]}),ids=new Set(promoted.map(layer=>layer.id));combined.renderedLayers=combined.layers.flatMap(layer=>[...combined.renderedLayers.filter(tile=>tile.layerId===layer.id&&!ids.has(layer.id)),...tiles.filter(tile=>tile.layerId===layer.id)]);combined.visualSignature=signature(combined.renderedLayers,combined.pageGaps||[],combined.sectionMode?sectionManifest(combined.layers):null);}const merged=await this.persist(id,combined);this.storage.background(this.storage.page(id));if(current.visualSignature!==merged.visualSignature)this.scheduleComposite(id);return merged;});
  }
  async bindJob(request){
    if(!request.sourceId||!request.regionId)return;
    await this.locked(request.sourceId,async()=>{if((await sourceMetadata(this.root,request.sourceId)).deletedAt)throw new Error('项目已删除，任务未提交');const project=await this.load(request.sourceId);if(regionDeleted(project,request.regionId))throw Object.assign(new Error('选区已删除，请先恢复选区再提交'),{statusCode:410});project.regions=project.regions||[];let region=project.regions.find(item=>item.id===request.regionId);if(!region){region={...request.region,id:request.regionId,frame:request.frame};project.regions.push(region);}region.jobId=request.id;region.locked=true;project.version=(project.version||0)+1;await this.persist(request.sourceId,project);});
  }
  async attachJob(id){
    if(this.attaching.has(id))return this.attaching.get(id);
    const operation=(async()=>{await this.attachEarlyText(id);return this.attach(id);})();this.attaching.set(id,operation);try{return await operation;}finally{this.attaching.delete(id);}
  }
  async attachEarlyText(id){
    if(!jobId(id))return null;if(this.earlyAttaching.has(id))return this.earlyAttaching.get(id);
    const operation=this.attachEarly(id);this.earlyAttaching.set(id,operation);try{return await operation;}finally{this.earlyAttaching.delete(id);}
  }
  async attachEarly(id){
    const directory=path.join(this.root,'jobs',id),request=await this.job(id);if(!request.regionId||!sourceId(request.sourceId)||request.autoText!==true)return null;
    if(request.workflowVersion>=2)return null;
    const automation=await readJSON(path.join(directory,'automation.json'),null);if(!automation?.attemptId||automation.status==='cancelled')return null;
    if((await readJSON(path.join(directory,'cancel-requested.json'),null))?.attemptId===automation.attemptId)return null;
    const early=await readEarlyTextManifest(directory,id,request,automation);if(!early)return null;
    return this.locked(request.sourceId,async()=>{
      const meta=await sourceMetadata(this.root,request.sourceId);if(meta.deletedAt||meta.id!==request.sourceId)return null;
      const project=await this.load(request.sourceId),current=await readJSON(path.join(directory,'automation.json'),null),note=project.tasks?.[id]||{},region=project.regions?.find(item=>item.id===request.regionId);
      if(current?.attemptId!==early.attemptId||current.status==='cancelled'||(await readJSON(path.join(directory,'cancel-requested.json'),null))?.attemptId===early.attemptId||regionDeleted(project,request.regionId)||!region||region.jobId!==id||['discarded','archived'].includes(note.decision))return null;
      project.layers||=[];const received=addEarlyTextLayers(project.layers,{...request,automation:current,earlyText:early},note,{offsetY:request.coordinateSpace==='output'?region.frame.y-request.frame.y:0});
      if(received.received){project.tasks||={};project.tasks[id]={...note,...received.note,updatedAt:Date.now()};project.version=(project.version||0)+1;await this.persist(request.sourceId,project);this.storage.background(this.storage.page(request.sourceId));}
      const latest=project.tasks?.[id];return latest?.earlyTextReceived?{version:latest.earlyTextVersion,attemptId:latest.earlyTextAttemptId,frame:{...region.frame},received:true,ids:[...(latest.earlyTextIds||[])],layers:project.layers.filter(layer=>(latest.earlyTextIds||[]).includes(layer.id)&&layer.type==='text'&&layer.originJobId===id&&layer.originRegionId===request.regionId)}:null;
    });
  }
  async earlyTextForJob(id){return this.attachEarlyText(id);}
  async attach(id){
    if(!jobId(id))return;
    const directory=path.join(this.root,'jobs',id),request=await this.job(id);
    if(!request.regionId||!request.sourceId)return;
    const meta=await sourceMetadata(this.root,request.sourceId);if(meta.deletedAt||meta.id!==request.sourceId)return;
    const automation=await readJSON(path.join(directory,'automation.json'),null);if(automation&&automation.status!=='completed')return;
    const finalText=await readFinalCompanionManifest(directory,'editable-text.json',id,request,automation),finalBubbles=await readFinalCompanionManifest(directory,'bubble-layers.json',id,request,automation);
    if(request.workflowVersion===3&&request.separateBubble&&!finalBubbles?.layers.length)return;
    if(request.workflowVersion!==3&&request.autoText&&(!finalText?.layers.length||request.separateBubble&&!finalBubbles?.layers.length))return;
    let info;try{info=await stat(path.join(directory,'repaired.png'));}catch(error){if(error.code==='ENOENT')return;throw error;}
    // Pipeline writers publish repaired.png atomically before marking the attempt completed,
    // so only manual results (no automation record) still need the settle delay.
    if(automation?.status!=='completed'&&Date.now()-info.mtimeMs<1000)return;
    const version=`${info.size}-${info.mtimeMs}`;if(this.attachedVersions.get(id)===version)return;
    const saved=await this.get(request.sourceId);if(['discarded','archived'].includes(saved.tasks?.[id]?.decision)||regionDeleted(saved,request.regionId)||!saved.regions?.some(region=>region.id===request.regionId))return;if(saved.tasks?.[id]?.resultVersion===version&&saved.layers?.some(layer=>layer.jobId===id)){this.attachedVersions.set(id,version);return;}
    const prepared=await runPageTool(this.toolRoot,['ai-layer','--job',directory]);
    const picture=await this.assets.putFile(request.sourceId,prepared.imagePath),image=picture.image,mask=(await this.assets.putFile(request.sourceId,prepared.maskPath)).image,layerId=`ai-${id}`;
    const tiles=await Promise.all(prepared.tiles.map(async tile=>({layerId,x:tile.x,y:tile.y,width:512,height:512,image:(await this.assets.putFile(request.sourceId,tile.file)).image})));
    const textLayers=await Promise.all((prepared.textLayers||[]).map(async item=>({layer:item.layer,tiles:await Promise.all(item.tiles.map(async tile=>({layerId:item.layer.id,x:tile.x,y:tile.y,width:512,height:512,coordinateSpace:tile.coordinateSpace,image:(await this.assets.putFile(request.sourceId,tile.file)).image})))})));
    const bubbleLayers=await Promise.all((prepared.bubbleLayers||[]).map(async item=>({layer:{...item.layer,image:(await this.assets.putFile(request.sourceId,item.imagePath)).image},tiles:await Promise.all(item.tiles.map(async tile=>({layerId:item.layer.id,x:tile.x,y:tile.y,width:512,height:512,coordinateSpace:tile.coordinateSpace,image:(await this.assets.putFile(request.sourceId,tile.file)).image})))})));
    await this.locked(request.sourceId,async()=>{
      const project=await this.load(request.sourceId),currentAutomation=await readJSON(path.join(directory,'automation.json'),null),cancellation=await readJSON(path.join(directory,'cancel-requested.json'),null);if((await sourceMetadata(this.root,request.sourceId)).deletedAt||regionDeleted(project,request.regionId)||!project.regions?.some(region=>region.id===request.regionId)||['discarded','archived'].includes(project.tasks?.[id]?.decision)||automation&&(currentAutomation?.status!=='completed'||currentAutomation.attemptId!==automation.attemptId)||automation?.attemptId&&cancellation?.attemptId===automation.attemptId)return;
      project.layers=project.layers||[];project.renderedLayers=project.renderedLayers||[];
      if(!project.layers.some(layer=>layer.jobId===id)){
        const regionPose=project.regions?.find(region=>region.id===request.regionId),dy=request.coordinateSpace==='output'&&regionPose?regionPose.frame.y-request.frame.y:0;
        const layer={id:layerId,layoutVersion:2,coordinateSpace:request.coordinateSpace||'source',type:'image',name:request.region?.name||request.label?.slice(0,24)||'AI 修复图层',x:request.crop.x,y:request.crop.y+dy,scale:1,angle:0,opacity:1,visible:true,locked:true,feather:request.feather||0,jobId:id,regionId:request.regionId,jobOrder:request.orderAt||request.createdAt,image,mask,imageWidth:picture.width,imageHeight:picture.height},index=project.layers.findIndex(item=>item.jobOrder>layer.jobOrder);if(index<0)project.layers.push(layer);else project.layers.splice(index,0,layer);
        project.renderedLayers.push(...tiles.map(tile=>({...tile,y:tile.y+dy,coordinateSpace:request.coordinateSpace||'source'})));
        project.renderedLayers=project.layers.flatMap(layer=>project.renderedLayers.filter(tile=>tile.layerId===layer.id));
      }
      const finishedText=[];let companionsAdded=false;
      for(const item of [...bubbleLayers,...textLayers].reverse()){
        const existing=project.layers.find(layer=>layer.id===item.layer.id),action=companionAction(existing,item.layer,project.tasks?.[id]);
        if(action==='finish-early'){const region=project.regions?.find(region=>region.id===request.regionId),dy=request.coordinateSpace==='output'&&region?region.frame.y-request.frame.y:0;finishPendingText(existing,item.layer,{offsetY:dy});finishedText.push(existing);}
        else if(action==='add'){const at=project.layers.findIndex(layer=>layer.jobId===id);const region=project.regions?.find(region=>region.id===request.regionId),dy=request.coordinateSpace==='output'&&region?region.frame.y-request.frame.y:0;project.layers.splice(at+1,0,{...item.layer,y:item.layer.y+dy,layoutVersion:2});project.renderedLayers.push(...item.tiles.map(tile=>({...tile,y:tile.y+dy})));companionsAdded=true;}
      }
      if(companionsAdded||finishedText.length)normalizeCompanionStack(project.layers,[...bubbleLayers,...textLayers].map(item=>item.layer),project.layers.find(layer=>layer.jobId===id));
      activateAttachedVersion(project,request,id);normalizeRepairVersions(project.regions||[],project.layers);
      if(finishedText.length){const finishedIds=new Set(finishedText.map(layer=>layer.id));project.renderedLayers=project.renderedLayers.filter(tile=>!finishedIds.has(tile.layerId));project.renderedLayers.push(...await renderServerTextTiles(this.toolRoot,this.root,finishedText,this.assets,request.sourceId,{fontAssets:project.fontAssets||[]}));}
      project.renderedLayers=project.layers.flatMap(layer=>project.renderedLayers.filter(tile=>tile.layerId===layer.id));
      const region=project.regions?.find(region=>region.id===request.regionId),attachedLayer=region?chosenRegionLayer(region,project.layers):project.layers.find(layer=>layer.jobId===id);if(region)region.locked=attachedLayer?.locked??true;project.renderedLayers=project.renderedLayers.filter(tile=>project.layers.some(layer=>layer.id===tile.layerId&&!layer.versionHidden&&layer.visible!==false&&layer.opacity!==0));
      project.tasks=project.tasks||{};project.tasks[id]={...project.tasks[id],layerId,autoTextIds:[...bubbleLayers,...textLayers].map(item=>item.layer.id),...([...bubbleLayers,...textLayers].length?{autoTextReceived:true}:{}),resultVersion:version,updatedAt:Date.now()};project.version=(project.version||0)+1;project.visualSignature=signature(project.renderedLayers,project.pageGaps||[],project.sectionMode?sectionManifest(project.layers||[]):null);await this.persist(request.sourceId,project);
      if(automation)await atomicJSON(path.join(directory,'automation.json'),{...automation,projectAttached:true,layerId,message:'选区已接回并锁定图层，等待项目自动合成'});
      this.attachedVersions.set(id,version);this.storage.background(this.storage.page(request.sourceId));this.scheduleComposite(request.sourceId);
    });
  }
  scheduleComposite(id){clearTimeout(this.timers.get(id));this.timers.set(id,setTimeout(()=>{this.timers.delete(id);this.compose(id).catch(async error=>{await this.locked(id,async()=>{const project=await this.load(id);project.composite={status:'failed',error:error.message};await this.persist(id,project);});}).catch(error=>console.error('项目自动保存失败：',error.message));},700));}
  // Light job list for the endpoints the browser polls every few seconds. It never clones the
  // full request (which can carry submitted layer tiles) and re-reads request.json or
  // automation.json only when that file's size or modification time changed.
  async jobIndex(){
    const names=(await readdir(path.join(this.root,'jobs'))).filter(jobId),known=this.jobIndexCache||=new Map(),present=new Set(names),result=[];
    for(const id of [...known.keys()])if(!present.has(id))known.delete(id);
    const stampOf=async file=>{try{const info=await stat(file);return `${info.size}-${info.mtimeMs}`;}catch(error){if(error.code==='ENOENT')return null;throw error;}};
    for(let start=0;start<names.length;start+=64)result.push(...(await Promise.all(names.slice(start,start+64).map(async id=>{
      const folder=path.join(this.root,'jobs',id),cached=known.get(id),now=Date.now();
      // The fields kept here (project, region, mode, editor) are fixed once a job exists, so
      // request.json is re-checked only every 30 s; automation.json is checked on every call.
      const recheck=!cached||now-cached.requestCheckedAt>30000;
      const [requestStamp,automationStamp]=await Promise.all([recheck?stampOf(path.join(folder,'request.json')):cached.requestStamp,stampOf(path.join(folder,'automation.json'))]);
      if(!requestStamp){known.delete(id);return null;}
      let entry=cached?{...cached,requestCheckedAt:recheck?now:cached.requestCheckedAt}:undefined;
      if(entry?.requestStamp!==requestStamp){
        let request;try{request=await this.job(id);}catch(error){if(error.code==='ENOENT')return null;throw error;}
        entry={requestStamp,requestCheckedAt:now,automationStamp:undefined,automation:null,job:{id,sourceId:request.sourceId,regionId:request.regionId,mode:request.mode,editorKey:request.editorKey,workflowVersion:request.workflowVersion,autoText:request.autoText,separateBubble:request.separateBubble,createdAt:request.createdAt,orderAt:request.orderAt}};
      }
      if(entry.automationStamp!==automationStamp){entry={...entry,automationStamp,automation:automationStamp?await readJSON(path.join(folder,'automation.json'),null).catch(error=>{if(error instanceof SyntaxError)return null;throw error;}):null};}
      known.set(id,entry);return {...entry.job,automation:entry.automation};
    }))).filter(Boolean));
    return result;
  }
  async jobs(){const names=(await readdir(path.join(this.root,'jobs'))).filter(jobId),jobs=[];for(const id of names){try{const request=await this.job(id);jobs.push({...request,automation:await readJSON(path.join(this.root,'jobs',id,'automation.json'),null)});}catch(error){if(error.code!=='ENOENT')throw error;}}return jobs;}
  async compose(id){
    if((await sourceMetadata(this.root,id)).deletedAt)return;
    if(this.composing.has(id)){this.scheduleComposite(id);return;}
    this.composing.add(id);
    try{
      const project=await this.get(id),jobs=new Map((await this.jobIndex()).filter(job=>job.sourceId===id).map(job=>[job.id,job]));
      const submitted=(project.regions||[]).filter(region=>region.jobId);if(!submitted.length||!(project.layers||[]).some(layer=>layer.jobId))return;
      for(const region of submitted){const job=jobs.get(region.jobId),note=project.tasks?.[region.jobId];if(['discarded','archived'].includes(note?.decision)||['failed','cancelled'].includes(job?.automation?.status))continue;if(!project.layers.some(layer=>layer.jobId===region.jobId))return;}
      const meta=await sourceMetadata(this.root,id),startSignature=signature(project.renderedLayers,project.pageGaps||[],project.sectionMode?sectionManifest(project.layers||[]):null),layers=project.renderedLayers||[];
      if(project.composite?.signature===startSignature&&project.composite.status==='ready'&&project.composite.automatic)return;
      await this.locked(id,async()=>{const latest=await this.load(id);latest.composite={...latest.composite,status:'compositing'};await this.persist(id,latest);});
      const saved=await exportPage(this.root,{sourceId:id,sourceRevision:project.sourceRevision??meta.revision,layers,pageGaps:project.pageGaps||[],sectionMode:project.sectionMode,pageSections:sectionManifest(project.layers||[])},{automatic:true});saved.archivePath=await this.storage.export(saved.file,meta,{automatic:true});
      await this.locked(id,async()=>{const latest=await this.load(id);latest.composite={...saved,status:'ready',signature:startSignature,completedAt:new Date().toISOString()};await this.persist(id,latest);this.storage.background(this.storage.page(id));if(signature(latest.renderedLayers,latest.pageGaps||[],latest.sectionMode?sectionManifest(latest.layers||[]):null)!==startSignature)this.scheduleComposite(id);});
    }finally{this.composing.delete(id);}
  }
  async setDeleted(id,deleted){return this.locked(id,async()=>{const meta=await sourceMetadata(this.root,id);meta.deletedAt=deleted?new Date().toISOString():null;await atomicJSON(path.join(this.root,'sources',id,'metadata.json'),meta);if(deleted){clearTimeout(this.timers.get(id));this.timers.delete(id);}else this.scheduleComposite(id);return meta;});}
  async deletePermanently(id,{cancelJobs=async()=>{}}={}){
    const meta=await this.setDeleted(id,true),jobs=(await this.jobs()).filter(job=>job.sourceId===id);
    this.storage.deletedSources?.add(id);await cancelJobs(jobs);
    const started=Date.now();while(this.composing.has(id)||this.bundleOperations?.has(id)||jobs.some(job=>this.attaching.has(job.id)||this.earlyAttaching.has(job.id))){if(Date.now()-started>30000)throw new Error('正在结束项目处理，请稍后重试删除');await new Promise(resolve=>setTimeout(resolve,50));}
    await settleSourceWork(this.root,id);await Promise.allSettled([...this.jobReading.values()]);await Promise.allSettled([...this.storage.locks?.values()||[]]);
    return this.locked(id,async()=>{const result=await purgeProjectFiles(this.root,meta,this.storage,jobs);for(const job of jobs){this.attachedVersions.delete(job.id);this.jobCache.delete(job.id);}this.projectCache.delete(id);this.reading.delete(id);return result;});
  }
  async summaries(includeDeleted=false){
    const jobs=await this.jobIndex(),bySource=new Map(),jobById=new Map(jobs.map(job=>[job.id,job]));
    for(const job of jobs){if(!bySource.has(job.sourceId))bySource.set(job.sourceId,[]);bySource.get(job.sourceId).push(job);}
    const directory=path.join(this.root,'sources'),ids=(await readdir(directory)).filter(sourceId),projects=[];
    for(const id of ids){let meta;try{meta=await sourceMetadata(this.root,id);}catch(error){if(error.code==='ENOENT')continue;throw error;}if(meta.deletedAt&&!includeDeleted)continue;const project=await this.get(id);
      // Catch-up attach for finished (or manual) jobs whose layer is still missing; attached ones cost nothing.
      if(!meta.deletedAt){const present=new Set((project.layers||[]).filter(layer=>layer.jobId).map(layer=>layer.jobId)),regions=new Set((project.regions||[]).map(region=>region.id));for(const job of bySource.get(id)||[])if(job.regionId&&!present.has(job.id)&&regions.has(job.regionId)&&!regionDeleted(project,job.regionId)&&!['discarded','archived'].includes(project.tasks?.[job.id]?.decision)&&(!job.automation||job.automation.status==='completed'))this.attachJob(job.id).catch(error=>console.error('项目接回暂未完成：',error.message));}
      if(!!meta.deletedAt!==includeDeleted)continue;const counts={draft:0,queued:0,running:0,waiting:0,completed:0,review:0,failed:0};for(const region of project.regions||[]){if(!region.jobId){counts.draft++;continue;}const job=jobById.get(region.jobId),status=job?.automation?.status;if(status==='queued')counts.queued++;else if(status==='running')counts.running++;else if(hasReviewableAttempt({...job,decision:project.tasks?.[region.jobId]?.decision}))counts.review++;else if(['failed','cancelled'].includes(status))counts.failed++;else if(project.layers.some(layer=>layer.jobId===region.jobId)||project.tasks?.[region.jobId]?.decision==='discarded')counts.completed++;else if(!job?.automation&&job?.mode!=='auto')counts.waiting++;else counts.running++;}projects.push({...meta,regions:(project.regions||[]).length,counts,composite:project.composite,projectVersion:project.version||0});}
    return projects.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  }
}
