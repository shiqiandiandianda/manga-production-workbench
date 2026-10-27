import {clearBubbleMaterial} from './bubble-material.js';
import {applyFramePreset} from './bubble-frame.js';
import {builtinBubbleStyle} from './builtin-bubble-data.js';
export const PRODUCTION_BOX_KINDS={speech:'对白气泡',thought:'内心框',person:'人名框',location:'地点框',time:'时间框',narration:'旁白框'};
export const PRODUCTION_FONT_FIELDS=['fontFamily','fontSize','fontWeight'];
const copy=v=>structuredClone(v),merge=(a,b)=>({...a,...b,boxes:{...a?.boxes,...b?.boxes}});
export function productionStyleKind(bubble){const type=bubble.productionBoxKind||bubble.productionOriginal?.['类型']||bubble.type||'';if(/人名|角色名|person/.test(type))return 'person';if(/地点|地名|location/.test(type))return 'location';if(/时间|日期|time/.test(type))return 'time';if(/心声|内心|意念|thought/.test(type))return 'thought';if(/旁白|字幕|caption|narration/.test(type))return 'narration';return 'speech';}
export function resolveProductionStyle(project,segmentId){const config=project.productionLetteringStyles||{},episode=project.productionPackage?.episodes.find(e=>e.segments.some(s=>s.id===segmentId));return merge(merge(config.global,config.episodes?.[episode?.episode]),config.segments?.[segmentId]);}
export function productionStyleSegments(project,segmentId,scope){const episodes=project.productionPackage?.episodes||[],episode=episodes.find(e=>e.segments.some(s=>s.id===segmentId));if(!episode||!['screen','episode','all'].includes(scope))throw Error('请选择有效的屏段和应用范围');return new Set((scope==='all'?episodes:scope==='episode'?[episode]:[{segments:episode.segments.filter(s=>s.id===segmentId)}]).flatMap(e=>e.segments.map(s=>s.id)));}
export function updateProductionStyle(project,segmentId,scope,patch){
 const segments=productionStyleSegments(project,segmentId,scope),episode=project.productionPackage.episodes.find(e=>e.segments.some(s=>s.id===segmentId));project.productionLetteringStyles||={version:1,global:{},episodes:{},segments:{}};const config=project.productionLetteringStyles;config.global||={};config.episodes||={};config.segments||={};
 const clear=entry=>{if(!entry)return;for(const key of PRODUCTION_FONT_FIELDS)if(Object.hasOwn(patch,key))delete entry[key];for(const kind of Object.keys(patch.boxes||{}))if(entry.boxes)delete entry.boxes[kind];};
 if(scope==='all'){for(const entry of Object.values(config.episodes))clear(entry);for(const entry of Object.values(config.segments))clear(entry);config.global=merge(config.global,copy(patch));}
 else if(scope==='episode'){for(const id of segments)clear(config.segments[id]);config.episodes[episode.episode]=merge(config.episodes[episode.episode],copy(patch));}
 else config.segments[segmentId]=merge(config.segments[segmentId],copy(patch));return segments;
}
export function applyProductionStyle(bubble,style){
 for(const key of PRODUCTION_FONT_FIELDS)if(style[key]!==undefined)bubble[key]=style[key];const kind=productionStyleKind(bubble),box=style.boxes?.[kind];if(!box)return bubble;const cleared=clearBubbleMaterial(bubble);for(const key of ['assetContour','assetInsets','assetParts','assetTailKind','assetRays','assetFrame','comicStyleId','comicStyleLabel','styleTextureId','styleTextureAssetId','materialOutlineWidth'])delete bubble[key];Object.assign(bubble,cleared);bubble.productionBoxKind=kind;delete bubble.productionMaterialVersion;
 if(box.styleId==='none'){bubble.shape='none';bubble.fillOpacity=0;bubble.outlineWidth=0;bubble.tail={...bubble.tail,visible:false};return bubble;}
 bubble.fillColor='#ffffff';bubble.fillOpacity=1;bubble.outlineColor||='#171b20';bubble.outlineWidth=2.8;bubble.materialVisibilityVersion=1;
 if(kind==='speech')bubble.tail={side:'bottom',base:.54,...bubble.tail,visible:true};
 if(box.styleId==='default'){bubble.shape=kind==='thought'?'burst':['person','location','time','narration'].includes(kind)?'rounded-rect':'oval';return bubble;}
 const d=builtinBubbleStyle(box.styleId)||box.definition;if(!d?.contour)return bubble;Object.assign(bubble,{shape:'asset',assetContour:copy(d.contour),assetInsets:copy(d.insets||{left:.12,right:.12,top:.12,bottom:.12}),comicStyleId:box.styleId,comicStyleLabel:d.label,materialOutlineWidth:2.8});
 if(d.parts)bubble.assetParts=copy(d.parts);if(d.rays)bubble.assetRays=copy(d.rays);if(d.frame)bubble.assetFrame=copy(d.frame);applyFramePreset(bubble,d.preset);if(d.tailKind)bubble.assetTailKind=d.tailKind;if(d.tailPreset)bubble.tail=copy(d.tailPreset);
 if(kind==='speech'&&d.tailPreset?.visible!==false)bubble.tail={side:'bottom',base:.54,...bubble.tail,visible:true};
 if(d.texture){bubble.styleTextureId=box.styleId;bubble.styleTextureAssetId=box.localAssetId;bubble.outlineWidth=Number.isFinite(bubble.tail?.anchorT)?2.8:0;}bubble.productionMaterialVersion={styleId:box.styleId,assetId:box.assetId,revisionId:box.revisionId};return bubble;
}
export function productionStyleRecords(project){const c=project.productionLetteringStyles;return c?[c.global,...Object.values(c.episodes||{}),...Object.values(c.segments||{})].filter(Boolean):[];}
