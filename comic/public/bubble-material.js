import {comicStyles,comicStyle,validAssetContour} from './comic-styles.js';
import {BUILTIN_BUBBLE_STYLES} from './builtin-bubble-data.js';
import {applyFramePreset} from './bubble-frame.js';

// 系统默认款始终保留；其他气泡款式随墨库「气泡素材」目录更新。
export const bubbleMaterials=[];
const materialFields=['assetContour','assetInsets','assetParts','assetTailKind','assetRays','assetFrame','comicStyleId','comicStyleLabel','styleTextureId','styleTextureAssetId','styleLibrary','materialOutlineWidth','materialAspectRatio','textureInkVersion'];

export function refreshBubbleMaterials(){
 const list=[...BUILTIN_BUBBLE_STYLES,...comicStyles.filter(style=>style.kind==='bubble'&&!BUILTIN_BUBBLE_STYLES.some(s=>s.id===style.id)&&validAssetContour(style.contour))];
 bubbleMaterials.splice(0,bubbleMaterials.length,...list);
 return bubbleMaterials.length;
}
refreshBubbleMaterials();

export function clearBubbleMaterial(bubble){
 const next=structuredClone(bubble);
 if(next.styleTextureId&&next.outlineWidth===0)next.outlineWidth=Number.isFinite(next.materialOutlineWidth)?next.materialOutlineWidth:2.8;
 for(const field of materialFields)delete next[field];
 return next;
}

// 气泡默认带尾尖：新款式、旧工程第一次换款都不会丢掉说话方向。
const DEFAULT_TAIL=Object.freeze({visible:true,side:'bottom',base:.54});

export function applyBubbleMaterial(bubble,styleId,textureAssetId){
 const style=comicStyle(styleId);
 return applyResolvedBubbleMaterial(bubble,style,textureAssetId);
}
export function applyResolvedBubbleMaterial(bubble,style,textureAssetId){
 if(style?.kind!=='bubble'||!validAssetContour(style.contour))throw Error('请选择有效的气泡素材款式');
 const next=structuredClone(bubble),wasHidden=bubble.shape==='none'||!bubble.styleTextureId&&bubble.fillOpacity===0&&!(bubble.outlineWidth>0),originalStroke=bubble.styleTextureId&&bubble.outlineWidth===0?
  Number.isFinite(bubble.materialOutlineWidth)?bubble.materialOutlineWidth:2.8:Number.isFinite(bubble.outlineWidth)?bubble.outlineWidth:2.8;
 const stroke=wasHidden&&originalStroke<=0?2.8:originalStroke;
 Object.assign(next,{shape:'asset',fillOpacity:wasHidden?1:bubble.fillOpacity??1,materialVisibilityVersion:1,assetContour:structuredClone(style.contour),assetInsets:{...style.insets},comicStyleId:style.id,comicStyleLabel:style.label,materialOutlineWidth:stroke,outlineWidth:style.texture&&!Number.isFinite(bubble.tail?.anchorT)?0:stroke});
 delete next.materialAspectRatio;if(style.preset?.aspect)next.materialAspectRatio=style.preset.aspect;else if(style.texture&&style.width>0&&style.height>0)next.materialAspectRatio=style.width/style.height;
 if(!next.tail||next.tail.visible===undefined)next.tail={...DEFAULT_TAIL,...(next.tail||{})};
 delete next.styleTextureId;delete next.styleTextureAssetId;
 delete next.styleLibrary;
 if(style.assetId&&style.revisionId)next.styleLibrary={assetId:style.assetId,revisionId:style.revisionId,styleId:style.id,definitionSha256:style.definitionSha256,assetType:style.assetType||'bubble',assetKind:'image',projectId:null,scopeId:'global'};
 delete next.assetParts;delete next.assetTailKind;delete next.assetRays;delete next.assetFrame;
 if(style.parts)next.assetParts=structuredClone(style.parts);if(style.rays)next.assetRays=structuredClone(style.rays);
 if(style.tailKind)next.assetTailKind=style.tailKind;
 if(style.tailPreset)next.tail=structuredClone(style.tailPreset);if(style.frame)next.assetFrame=structuredClone(style.frame);applyFramePreset(next,style.preset);
 const tailDefault=style.tailPreset?.visible??(bubble.tail?.visible===true||['speech','thought'].includes(next.type)&&(style.uses||[]).includes('speech'));
 next.tail=style.tailPreset?structuredClone(style.tailPreset):{...DEFAULT_TAIL,...next.tail,visible:tailDefault};delete next.tail.visibilityExplicit;
 if(style.texture){next.styleTextureId=style.id;next.textureInkVersion=1;if(textureAssetId)next.styleTextureAssetId=textureAssetId;}
 return next;
}

export function defaultBubbleMaterial(bubble){
 return bubbleMaterials.find(style=>style.id===bubble.comicStyleId)||bubbleMaterials.find(style=>style.uses.includes(bubble.type))||bubbleMaterials[0];
}

/** Repair the legacy none -> material transition, without changing intentional new transparency. */
export function restoreLegacyBubbleMaterialVisibility(bubble){
 if(bubble.shape!=='asset'||!bubble.comicStyleId||bubble.materialVisibilityVersion>=1||bubble.styleTextureId||bubble.fillOpacity!==0||bubble.outlineWidth!==0||bubble.materialOutlineWidth!==0)return false;
 bubble.fillOpacity=1;bubble.outlineWidth=2.8;bubble.materialOutlineWidth=2.8;bubble.materialVisibilityVersion=1;return true;
}
