import {createHash} from 'node:crypto';
import {normalizeNativeSizing,nativeDisplayHeight,ratioNumber} from '../public/native-image-sizing.js';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const now=()=>new Date().toISOString();
const error=message=>{throw Object.assign(new Error(message),{status:400,field:'nativeSizing'});};
const check=(v,message)=>{if(!v)error(message);};
function observationsFor(assets,provider,imageModelId){
 const outputs=[];for(const asset of assets||[]){const evidence=asset.nativeGeneration;if(evidence?.provider!==provider||!Number.isSafeInteger(asset.width)||!Number.isSafeInteger(asset.height)||asset.width<=0||asset.height<=0)continue;if(imageModelId&&evidence.imageModelId!==imageModelId)continue;outputs.push({width:asset.width,height:asset.height,imageModelId:evidence.imageModelId??null,assetId:asset.id,source:'decoded-output',verifiedAt:evidence.checkedAt||asset.created||null});}
 return outputs.slice(-100);
}
function finish(value){const snapshot={...value};snapshot.id=hash(snapshot);return snapshot;}
/** Codex native imageGeneration exposes prompt preferences, not public API pixel controls. */
export function codexImageCapabilities({status={},assets=[],checkedAt=now()}={}){
 const observations=observationsFor(assets,'codex',null);return finish({version:1,provider:'codex',imageModelId:null,imageModelState:'unknown',dispatcherModelId:null,transport:{kind:'codex-native-imagegen',version:status.version??null},connected:status.connected===true,state:'unknown',sizeControl:'prompt',ratios:[],resolutions:[],nativeSizes:[],limits:null,observations,transparency:{supported:true,control:'transparent_background',validation:'decoded-alpha'},source:'installed-native-bridge-contract',checkedAt,message:observations.length?'有实际输出尺寸记录；只能说明已验证输出，模型最大高度仍未知。':'原生图片模型及最大像素待核对；提示比例不等于精确尺寸控制。'});
}
/** Preserve live model/mode options verbatim; resolution labels do not imply pixel dimensions. */
export function jimengImageCapabilities({catalogue={},channelVersion=null,assets=[],checkedAt=now()}={}){
 const items=Array.isArray(catalogue.items)?catalogue.items:[];if(!items.length)return [finish({version:1,provider:'jimeng',imageModelId:null,imageModelState:'unknown',transport:{kind:'jimeng-official-cli',version:channelVersion},state:'unknown',sizeControl:'discrete',ratios:[],resolutions:[],nativeSizes:[],limits:null,observations:observationsFor(assets,'jimeng',null),transparency:{supported:false,validation:'not-adapted'},source:'model-list-unavailable',checkedAt,message:'请读取当前即梦模型目录；不能采用Codex或公开API的尺寸上限。'})];
 return items.filter(item=>typeof item.model==='string').flatMap(item=>(item.modes||[]).map(mode=>{
  const flags=new Map((mode.flags||[]).map(f=>[String(f.flag||'').replace(/^--/,''),f]));
  const ratios=(flags.get('ratio')?.values||[]).filter(r=>typeof r==='string'&&ratioNumber(r)),resolutions=(flags.get('resolution')?.values||[]).filter(r=>typeof r==='string');
  const observations=observationsFor(assets,'jimeng',item.model);
  return finish({version:1,provider:'jimeng',imageModelId:item.model,imageModelState:'contract',mode:mode.name,transport:{kind:'jimeng-official-cli',version:channelVersion},state:'contract',sizeControl:'discrete',ratios,resolutions,nativeSizes:[],limits:null,observations,transparency:{supported:false,validation:'not-adapted'},source:'live-model-list-mode-flags',checkedAt,message:'比例及分辨率档来自当前模型；未公开原生像素映射时最大高度保持未知。'});
 }));
}

/** Trusted discovery resolves ratio choices; imported claims do not prove a transport limit. */
export function resolveMainHeight({panelWidth,nativeSizing,capability}={}){
 const sizing=normalizeNativeSizing(nativeSizing);check(Number.isFinite(panelWidth)&&panelWidth>0,'画格宽度无效');if(!sizing||sizing.mode==='component')return {nativeSizing:sizing,displayHeight:null,selectionStatus:'component',warnings:[]};
 delete sizing.resolved;const warnings=[];
 if(sizing.observed?.accepted){return {nativeSizing:sizing,displayHeight:nativeDisplayHeight(panelWidth,sizing),selectionStatus:'verified',warnings};}
 if(!capability||capability.state==='unknown'||capability.sizeControl==='prompt')return {nativeSizing:{...sizing,control:'prompt',capabilityState:'unknown'},displayHeight:null,selectionStatus:'preference',warnings:['当前通道只能提示长幅比例；最大高度待核对，生成后须按真实尺寸确认。']};
 check(capability.provider===sizing.provider,'尺寸能力与所选主图通道不匹配');check(!sizing.imageModelId||sizing.imageModelId===capability.imageModelId,'尺寸能力与所选图片模型不匹配');
 check(!sizing.generationMode||!capability.mode||sizing.generationMode===capability.mode,'尺寸能力与所选图片生成方式不匹配');if(capability.mode)sizing.generationMode=capability.mode;
 sizing.imageModelId=capability.imageModelId??null;sizing.control=capability.sizeControl;sizing.capabilityState=capability.state;
 const request=sizing.request;
 if(capability.sizeControl==='discrete'){
  check(!request.width||(capability.nativeSizes||[]).some(s=>s.width===request.width&&s.height===request.height),'所选通道未公开该精确原生像素尺寸');
  if(request.ratio)check((capability.ratios||[]).includes(request.ratio),'主格比例不在当前模型允许选项中');
  if(request.resolution)check((capability.resolutions||[]).includes(request.resolution),'主格分辨率不在当前模型允许选项中');
  const ratio=request.width?`${request.width}:${request.height}`:request.ratio;
  if(!ratio)return {nativeSizing:sizing,displayHeight:null,selectionStatus:'preference',warnings:['请选择当前模型公开的竖幅比例。']};
  sizing.resolved={state:'contract',ratio,capabilitySnapshotId:capability.id,...(request.width?{width:request.width,height:request.height}:{})};
 }else if(capability.sizeControl==='free-size'){
  check(request.width&&request.height,'自由尺寸通道需要原生宽高');const {width:w,height:h}=request,limits=capability.limits;check(limits&&Number.isFinite(limits.maxEdge)&&Number.isFinite(limits.maxPixels)&&Number.isInteger(limits.step)&&limits.step>0,'自由尺寸通道缺少已核对上限');
  check(w%limits.step===0&&h%limits.step===0&&Math.max(w,h)<=limits.maxEdge&&w*h<=limits.maxPixels&&(!limits.minPixels||w*h>=limits.minPixels)&&(!limits.maxAspect||Math.max(w/h,h/w)<=limits.maxAspect),'原生尺寸超出已核对通道能力');
  sizing.resolved={state:'contract',ratio:`${w}:${h}`,width:w,height:h,capabilitySnapshotId:capability.id};
 }else error('通道尺寸控制方式尚未适配');
 return {nativeSizing:sizing,displayHeight:nativeDisplayHeight(panelWidth,sizing),selectionStatus:sizing.resolved?.state||'preference',warnings};
}
