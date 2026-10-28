// Only the selected model can start new jobs. Historical results keep their labels.
export const DEFAULT_UPSCALE_MODEL='illustrationjanai-v3-detail';
export const UPSCALE_MODELS=Object.freeze([{id:DEFAULT_UPSCALE_MODEL,label:'IllustrationJaNai V3 Detail（FDAT-M）',scales:[2],engine:'IllustrationJaNai V3 Detail',note:'2倍'}]);
const legacyLabels={'realesr-animevideov3':'动漫 · 快速','realesrgan-x4plus-anime':'动漫 · 精细','realesrgan-x4plus':'通用 · 精细','realcugan-pro':'Real-CUGAN Pro'};
export const upscaleModel=id=>UPSCALE_MODELS.find(m=>m.id===(id||DEFAULT_UPSCALE_MODEL));
export const upscaleLabel=id=>upscaleModel(id)?.label||legacyLabels[id]||'历史高清模型';
export const upscaleScale=r=>Number(r.outputScale||(r.model==='realesrgan-x4plus-anime'||r.model==='realesrgan-x4plus'?4:r.scale||2));
export function upscalePlan(id=DEFAULT_UPSCALE_MODEL,scale=2,outputScale=2){
 const model=upscaleModel(id);if(!model)throw Error('当前只使用 IllustrationJaNai V3 Detail（FDAT-M）2倍；旧结果可从处理记录取回');
 if(Number(scale)!==2||Number(outputScale)!==2)throw Error('当前高清模型仅支持2倍放大');
 return {model:model.id,modelLabel:model.label,nativeScale:2,outputScale:2};
}
