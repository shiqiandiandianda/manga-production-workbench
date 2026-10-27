import {bounds} from './model.js';
import {normalizeNativeSizing} from './native-image-sizing.js';

/** Canvas geometry is a composition request; returned native pixels are checked separately. */
export function generationFrameSizing(input){
 if(input.action==='edit'||input.kind&&input.kind!=='panel'||!input.panel)return null;
 const box=bounds(input.panel),width=Math.max(1,Math.round(box.w)),height=Math.max(1,Math.round(box.h));
 return {version:1,policy:'native-compose',width,height,ratio:width/height,allowUpscale:false};
}
export function frameSizingInstructions(input){
 const request=generationFrameSizing(input);if(!request)return '';
 if(input.shot?.productionSegment)return `当前生成单位是一个竖向屏段整页，含原文中指定的多格。严格保持原始段内格数、顺序和主副格组织；不要改成单镜头或将各格独立出图。画布目标 ${request.width} × ${request.height} px，优先按原文1:3构图；记录实际原生宽高，不能拉伸或补白伪造尺寸。`;
 if(input.shot?.productionBackground)return '此任务仅生成屏段共用氛围底图，按原文1:3生成，不画人物、画格或文字；共享覆盖由工具另存副本完成。';
 return `按当前画格 ${request.width} × ${request.height} px、宽高比 ${request.width}:${request.height} 重新组织并生成一个完整镜头。高格增加上下场景层次和纵深，宽格按横向空间与人物关系构图；保留原剧情、人物、动作和对白依据。不能把旧图放大、拉长、裁切后冒充新构图，也不能用后期缩放或补空白伪造原生尺寸。当前原生通道仅把尺寸作为提示偏好，不保证精确像素；若本通道不能精确满足尺寸，保留实际原图并报告真实宽高。`;
}
/** An old long-frame preference must not override the frame the user has since resized. */
export function currentFrameNativeSizing(input){
 const previous=normalizeNativeSizing(input.nativeSizing??input.panel?.nativeSizing),current=generationFrameSizing(input);
 if(!current)return previous;
 return normalizeNativeSizing({version:1,mode:'component',provider:'codex',control:'prompt',capabilityState:'unknown',imageModelId:previous?.imageModelId??null,request:{width:current.width,height:current.height,ratio:`${current.width}:${current.height}`}});
}
export function assessFrameComposition(input,actual,{tolerance=.005}={}){
 const requested=generationFrameSizing(input);if(!requested)return null;
 const ratioDifference=Math.abs((actual.width/actual.height)/requested.ratio-1),needsUpscale=actual.width<requested.width||actual.height<requested.height,ratioMismatch=ratioDifference>tolerance;
 const sizeMismatch=needsUpscale||ratioMismatch;
 return {...requested,requested:{width:requested.width,height:requested.height},actual:{width:actual.width,height:actual.height},ratioDifference,needsUpscale,ratioMismatch,sizeMismatch,requiresAcceptance:false,
  notice:sizeMismatch?`画格需求 ${requested.width} × ${requested.height} px，实际返回 ${actual.width} × ${actual.height} px${needsUpscale?'，原图像素不足':''}${ratioMismatch?'，画幅比例不同':''}；原生文件不放大或拉伸，画布按原比例以 95% 缩放预览。可调整取景或高清放大。`:null};
}
/** Use the full original, at native size or uniformly reduced. Never upscale or overscan. */
export function fitNativeComposition(panel,asset){
 const box=bounds(panel),scale=Math.min(1,box.w/asset.width,box.h/asset.height);
 return {x:box.x+(box.w-asset.width*scale)/2,y:box.y+(box.h-asset.height*scale)/2,scale};
}
