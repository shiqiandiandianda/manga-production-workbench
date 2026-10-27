/** Native output sizing is separate from canvas pixels and from the text dispatcher model. */
const fail=message=>{throw Object.assign(new Error(message),{status:400,field:'nativeSizing'});};
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const dimension=value=>Number.isSafeInteger(value)&&value>0&&value<=30000;
const optionalText=(value,name,max=160)=>{if(value===undefined||value===null||value==='')return undefined;if(typeof value!=='string'||value.length>max)fail('生图尺寸字段无效：'+name);return value.trim();};
export function ratioNumber(value){
 if(typeof value==='number')return Number.isFinite(value)&&value>0?value:null;
 if(typeof value!=='string')return null;
 const match=value.trim().match(/^(\d+(?:\.\d+)?)\s*[:/]\s*(\d+(?:\.\d+)?)$/u);
 if(!match||+match[1]<=0||+match[2]<=0)return null;return +match[1]/+match[2];
}
function nativeDimensions(value,label){
 if(!object(value)||!dimension(value.width)||!dimension(value.height)||value.width*value.height>100000000)fail(label+'必须是有效原生像素尺寸');
 return {width:value.width,height:value.height};
}
/** Input normalization never discovers, verifies or invents provider capabilities. */
export function normalizeNativeSizing(value){
 if(value===undefined||value===null)return undefined;if(!object(value))fail('生图尺寸设置需要对象');
 if(value.version!==undefined&&value.version!==1)fail('生图尺寸版本无效');
 const mode=value.mode??'component';if(!['component','model-long'].includes(mode))fail('主格高度模式无效');
 const provider=value.provider??'codex';if(!['codex','jimeng'].includes(provider))fail('主图通道无效');
 const control=value.control??(provider==='codex'?'prompt':'discrete');if(!['prompt','discrete','free-size','observed'].includes(control))fail('通道尺寸控制方式无效');
 const capabilityState=value.capabilityState??'unknown';if(!['unknown','contract','verified'].includes(capabilityState))fail('通道能力状态无效');
 const generationMode=optionalText(value.generationMode,'generationMode',80);const imageModelId=optionalText(value.imageModelId,'imageModelId');const result={version:1,mode,provider,imageModelId:imageModelId??null,control,capabilityState,request:{}};
 if(generationMode)result.generationMode=generationMode;
 if(value.request!==undefined&&!object(value.request))fail('生图尺寸请求需要对象');
 const request=value.request||{},ratio=optionalText(request.ratio,'ratio',48),resolution=optionalText(request.resolution,'resolution',80);
 if(ratio!==undefined){const numeric=ratioNumber(ratio);if(!numeric||numeric<.05||numeric>20)fail('原生比例无效');result.request.ratio=ratio;}
 if(resolution!==undefined)result.request.resolution=resolution;
 if(request.width!==undefined||request.height!==undefined)Object.assign(result.request,nativeDimensions(request,'请求尺寸'));
 if(value.observed!==undefined){const observed=nativeDimensions(value.observed,'实际返回尺寸');if(typeof value.observed.accepted!=='boolean')fail('实际返回尺寸须明确是否采用');result.observed={...observed,accepted:value.observed.accepted};const assetId=optionalText(value.observed.assetId,'observed.assetId');if(assetId)result.observed.assetId=assetId;}
 if(value.resolved!==undefined){
  if(!object(value.resolved)||!['contract','verified'].includes(value.resolved.state)||!ratioNumber(value.resolved.ratio))fail('已解析尺寸需要合法能力记录');
  result.resolved={state:value.resolved.state,ratio:String(value.resolved.ratio)};
  if(value.resolved.width!==undefined||value.resolved.height!==undefined)Object.assign(result.resolved,nativeDimensions(value.resolved,'已解析尺寸'));
  const snapshotId=optionalText(value.resolved.capabilitySnapshotId,'capabilitySnapshotId');if(snapshotId)result.resolved.capabilitySnapshotId=snapshotId;
 }
 return result;
}
/** Exact, uniform aspect scaling. It adds no image detail and never stretches an asset. */
export function nativeDisplayHeight(panelWidth,value){
 if(!Number.isFinite(panelWidth)||panelWidth<=0)fail('画格宽度无效');const sizing=normalizeNativeSizing(value);if(!sizing||sizing.mode!=='model-long')return null;
 if(sizing.observed?.accepted)return panelWidth*sizing.observed.height/sizing.observed.width;
 if(sizing.resolved?.width)return panelWidth*sizing.resolved.height/sizing.resolved.width;
 return sizing.resolved?panelWidth/ratioNumber(sizing.resolved.ratio):null;
}
/** New native results remain candidates when requested shape or exact pixels differ. */
export function assessNativeResult(value,info,{provider,imageModelId=null,channelVersion=null,tolerance=.025}={}){
 const actual=nativeDimensions(info,'实际返回尺寸'),sizing=normalizeNativeSizing(value),request=sizing?.request||{};
 const result={version:1,provider:provider||sizing?.provider||'codex',imageModelId,channelVersion,actual,requested:sizing?{...request}:null,accepted:false,mismatch:false,requiresAcceptance:false};
 if(!sizing||sizing.mode!=='model-long')return result;
 const target=request.width?request.width/request.height:ratioNumber(request.ratio)||ratioNumber(sizing.resolved?.ratio);
 const dimensionsDiffer=!!request.width&&(actual.width!==request.width||actual.height!==request.height);
 const ratioDiff=target?Math.abs((actual.width/actual.height)/target-1):0;
 const identityMismatch=sizing.provider!==result.provider||!!(sizing.imageModelId&&imageModelId&&sizing.imageModelId!==imageModelId);
 result.mismatch=dimensionsDiffer||ratioDiff>tolerance||identityMismatch;
 result.ratioDifference=ratioDiff;result.requiresAcceptance=result.mismatch||(!sizing.resolved&&!sizing.observed?.accepted);
 result.notice=result.mismatch?'实际返回尺寸与主格长幅请求不一致，原图保留为候选；可按实际比例采用或重新生成。':result.requiresAcceptance?'原生通道尺寸能力待核对，已记录实际输出；请按实际比例确认采用。':null;
 return result;
}
export function nativeSizingInstructions(value){
 const sizing=normalizeNativeSizing(value);if(!sizing||sizing.mode!=='model-long')return '';
 const r=sizing.request,ratio=r.ratio||(r.width?`${r.width}:${r.height}`:sizing.resolved?.ratio);
 return ['本格选择模型长幅构图。',ratio?`希望原生图片宽高比 ${ratio}。`:'按本格长幅比例构图。',r.width?`希望原生像素 ${r.width} × ${r.height}；不得通过缩放旧图、拉伸或补空白伪造原生尺寸。`:'',sizing.control==='prompt'?'当前原生通道仅把尺寸作为提示偏好，像素上限与精确尺寸尚未核对；不得改用额外API。':'只使用本通道已公开的比例、分辨率或尺寸选项。','生成后保存真实宽高，若返回比例或像素不一致，交付候选供按实际比例采用。'].filter(Boolean).join('');
}
