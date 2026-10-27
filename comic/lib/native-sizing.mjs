import {normalizeNativeSizing} from '../public/native-image-sizing.js';
import {resolveMainHeight} from './native-model-capabilities.mjs';
export function sanitizeTrustedNativeSizing(raw,{assets=[],capability,panelWidth=1280,requireGenerationEvidence=false}={}){
 const sizing=normalizeNativeSizing(raw);if(!sizing)return undefined;delete sizing.resolved;
 const check=(condition,message)=>{if(!condition)throw Object.assign(Error(message),{status:400});};
 if(sizing.observed){const evidence=sizing.observed,asset=assets.find(asset=>asset.id===evidence.assetId);check(asset&&Number.isSafeInteger(asset.width)&&Number.isSafeInteger(asset.height)&&asset.width===evidence.width&&asset.height===evidence.height,'采用图片尺寸须绑定已登记图片的真实宽高');if(requireGenerationEvidence)check(asset.nativeGeneration?.provider===sizing.provider,'该图片没有所选通道的原生生成证据');}
 return resolveMainHeight({panelWidth,nativeSizing:sizing,capability}).nativeSizing;
}
