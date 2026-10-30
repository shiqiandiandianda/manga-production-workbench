import {TEXT_FONT_DEFAULTS} from './text-font-defaults.js';
import {productionFrameSegment} from './production-frame-source.js';
import {clearBubbleMaterial,applyResolvedBubbleMaterial} from './bubble-material.js';
import {builtinBubbleStyle} from './builtin-bubble-data.js';
import {comicStyle} from './comic-styles.js';
import {currentBoardEpisode} from './episode-boards.js';
export const PRODUCTION_BOX_KINDS={speech:'对白气泡',thought:'内心框',person:'人名框',location:'地点框',time:'时间框',narration:'旁白框'};
// All creation and bulk-edit paths use the same typography fields and scope tree.
export const PRODUCTION_FONT_FIELDS=['fontFamily','fontSize','fontWeight','letterSpacing','lineHeight','textColor','textAlign','writingMode','textDirection','padding'];
export const PRODUCTION_BOX_FIELDS=['fillColor','fillOpacity','outlineColor','outlineWidth','tailVisible'];
export const productionStyleRequestsFit=(patch,kind)=>Object.hasOwn(patch.boxes?.[kind]||{},'styleId')||PRODUCTION_FONT_FIELDS.some(k=>k!=='textColor'&&Object.hasOwn(patch,k));
const copy=v=>structuredClone(v);
function styleEpisodes(project){
 if(project.productionPackage)return project.productionPackage.episodes;
 const groups=new Map();for(const page of project.pages||[]){if(page.designEpisodeRole)continue;const episode=currentBoardEpisode(project,page);if(!groups.has(episode))groups.set(episode,{episode,segments:[]});groups.get(episode).segments.push({id:'page:'+page.id});}return [...groups.values()];
}
export function mergeProductionBoxes(a={},b={}){const out=copy(a);for(const [kind,box] of Object.entries(b)){const prior={...out[kind]};if(Object.hasOwn(box,'styleId'))for(const k of ['definition','assetId','revisionId','localAssetId','shape'])delete prior[k];out[kind]={...prior,...copy(box)};}return out;}
const merge=(a,b)=>({...a,...b,boxes:mergeProductionBoxes(a?.boxes,b?.boxes)});
export function productionBoxSettings(style,kind){const box=style.boxes?.[kind]||{},material=box.definition||builtinBubbleStyle(box.styleId)||comicStyle(box.styleId);return {fillColor:material?.preset?.fillColor||'#ffffff',fillOpacity:box.styleId==='none'?0:1,outlineColor:material?.preset?.outlineColor||'#171b20',outlineWidth:box.styleId==='none'?0:2.8,tailVisible:box.styleId==='none'?false:material?material.tailPreset?.visible??(['speech','thought'].includes(kind)&&(material.uses||['speech']).includes('speech')):['speech','thought'].includes(kind),...box};}
export function productionStyleKind(bubble){const type=bubble.productionBoxKind||bubble.productionOriginal?.['类型']||bubble.type||'';if(/人名|角色名|person/.test(type))return 'person';if(/地点|地名|location/.test(type))return 'location';if(/时间|日期|time/.test(type))return 'time';if(/心声|内心|意念|thought/.test(type))return 'thought';if(/旁白|字幕|caption|narration/.test(type))return 'narration';return 'speech';}
export function resolveProductionStyle(project,segmentId){const config=project.productionLetteringStyles||{},episode=styleEpisodes(project).find(e=>e.segments.some(s=>s.id===segmentId)),source=episode?.typography||{};const base={...TEXT_FONT_DEFAULTS,fontSize:source['字号']||source.fontSize||TEXT_FONT_DEFAULTS.fontSize,letterSpacing:0,lineHeight:4/3,textColor:'#171b20',textAlign:'center',writingMode:'horizontal',textDirection:'ltr',padding:18,...project.typography};return merge(merge(merge(base,config.global),config.episodes?.[episode?.episode]),config.segments?.[segmentId]);}
export function productionBubbleSegment(project,bubble,page,knownParent){
 const owner=page||project.pages.find(p=>p.bubbles?.some(b=>b.id===bubble.id)),parent=knownParent===undefined?owner?.panels.find(f=>f.id===bubble.parentPanelId):knownParent;
 return bubble.productionSegment||productionFrameSegment(parent)||owner?.screenBoard?.segmentId||(!project.productionPackage&&owner?'page:'+owner.id:undefined);
}
/** Apply only the requested fields. Changing a frame never reapplies old font overrides. */
export function applyProductionStyleToScope(project,segmentId,scope,patch){
 const segments=updateProductionStyle(project,segmentId,scope,patch);let count=0,skipped=0;
 for(const page of project.pages)for(const bubble of page.bubbles||[]){
  if(!['speech','thought','caption','label','system'].includes(bubble.type))continue;
  const key=productionBubbleSegment(project,bubble,page),kind=productionStyleKind(bubble);if(!segments.has(key))continue;
  if(!PRODUCTION_FONT_FIELDS.some(k=>Object.hasOwn(patch,k))&&!Object.hasOwn(patch.boxes||{},kind))continue;
  const parent=page.panels.find(f=>f.id===bubble.parentPanelId);if(bubble.locked||page.locked||parent?.locked){skipped++;continue;}
  const effective=resolveProductionStyle(project,key),selected={...Object.fromEntries(PRODUCTION_FONT_FIELDS.filter(k=>Object.hasOwn(patch,k)).map(k=>[k,effective[k]])),boxes:Object.fromEntries(Object.keys(patch.boxes||{}).map(k=>[k,Object.hasOwn(patch.boxes[k],'styleId')?effective.boxes[k]:Object.fromEntries(Object.keys(patch.boxes[k]).map(f=>[f,effective.boxes[k][f]]))]))};
  applyProductionStyle(bubble,selected);
  // Selecting a new frame explicitly requests a fresh fit. Appearance-only edits
  // keep the existing text frame, including intentional manual line breaks.
  if(productionStyleRequestsFit(patch,kind))bubble.autoLettering={version:0,mode:'auto',measurement:'canvas'};
  count++;
 }
 return {count,skipped,segments:segments.size};
}
export function productionStyleSegments(project,segmentId,scope){const episodes=styleEpisodes(project),episode=episodes.find(e=>e.segments.some(s=>s.id===segmentId));if(!episode||!['screen','episode','all'].includes(scope))throw Error('请选择有效的画板和应用范围');return new Set((scope==='all'?episodes:scope==='episode'?[episode]:[{segments:episode.segments.filter(s=>s.id===segmentId)}]).flatMap(e=>e.segments.map(s=>s.id)));}
export function updateProductionStyle(project,segmentId,scope,patch){
 const segments=productionStyleSegments(project,segmentId,scope),episode=styleEpisodes(project).find(e=>e.segments.some(s=>s.id===segmentId));project.productionLetteringStyles||={version:1,global:{},episodes:{},segments:{}};const config=project.productionLetteringStyles;config.global||={};config.episodes||={};config.segments||={};
 const clear=entry=>{if(!entry)return;for(const key of PRODUCTION_FONT_FIELDS)if(Object.hasOwn(patch,key))delete entry[key];for(const [kind,box] of Object.entries(patch.boxes||{}))if(entry.boxes?.[kind]){for(const field of Object.keys(box))delete entry.boxes[kind][field];if(Object.hasOwn(box,'styleId'))for(const f of ['definition','assetId','revisionId','localAssetId','shape'])delete entry.boxes[kind][f];}};
 if(scope==='all'){for(const entry of Object.values(config.episodes))clear(entry);for(const entry of Object.values(config.segments))clear(entry);config.global=merge(config.global,copy(patch));}
 else if(scope==='episode'){for(const id of segments)clear(config.segments[id]);config.episodes[episode.episode]=merge(config.episodes[episode.episode],copy(patch));}
 else config.segments[segmentId]=merge(config.segments[segmentId],copy(patch));return segments;
}
export function applyProductionStyle(bubble,style){
 for(const key of PRODUCTION_FONT_FIELDS)if(style[key]!==undefined)bubble[key]=style[key];const kind=productionStyleKind(bubble),box=style.boxes?.[kind];if(!box)return bubble;
 const appearance=()=>{if(bubble.shape!=='none'){for(const field of PRODUCTION_BOX_FIELDS)if(Object.hasOwn(box,field)){if(field==='tailVisible')bubble.tail={side:'bottom',base:.54,...bubble.tail,visible:box[field],visibilityExplicit:true};else if(field==='outlineWidth'&&bubble.styleTextureId)bubble.materialOutlineWidth=box[field];else bubble[field]=box[field];}if(bubble.styleTextureId&&Object.hasOwn(box,'outlineWidth')&&Number.isFinite(bubble.tail?.anchorT))bubble.outlineWidth=box.outlineWidth;if(PRODUCTION_BOX_FIELDS.some(f=>Object.hasOwn(box,f)))bubble.materialVisibilityVersion=2;if(bubble.styleTextureId)bubble.textureInkVersion=1;}return bubble;};
 if(!Object.hasOwn(box,'styleId'))return appearance();
 const cleared=clearBubbleMaterial(bubble);for(const key of ['assetContour','assetInsets','assetParts','assetTailKind','assetRays','assetFrame','comicStyleId','comicStyleLabel','styleTextureId','styleTextureAssetId','styleLibrary','materialOutlineWidth','materialAspectRatio','textureInkVersion'])delete bubble[key];Object.assign(bubble,cleared);bubble.productionBoxKind=kind;delete bubble.productionMaterialVersion;
 if(box.styleId==='none'){bubble.shape='none';bubble.fillOpacity=0;bubble.outlineWidth=0;bubble.tail={...bubble.tail,visible:false};return bubble;}
 bubble.fillColor='#ffffff';bubble.fillOpacity=1;bubble.outlineColor||='#171b20';bubble.outlineWidth=2.8;bubble.materialVisibilityVersion=1;
 if(box.styleId==='default'){bubble.shape=box.shape||(kind==='thought'?'burst':['person','location','time','narration'].includes(kind)?'rounded-rect':'oval');bubble.tail={side:'bottom',base:.54,...bubble.tail,visible:['speech','thought'].includes(kind),visibilityExplicit:false};return appearance();}
 const d=box.definition||builtinBubbleStyle(box.styleId)||comicStyle(box.styleId);if(!d?.contour)throw Error('所选气泡样式尚未加载，请重新打开样式库');Object.assign(bubble,applyResolvedBubbleMaterial(bubble,{...d,id:box.styleId,kind:'bubble',uses:d.uses||(['speech','thought'].includes(kind)?['speech']:['caption'])},box.localAssetId));
 if(['person','location','time','narration'].includes(kind))bubble.tail={...bubble.tail,visible:false};
 bubble.productionMaterialVersion={styleId:box.styleId,assetId:box.assetId,revisionId:box.revisionId};return appearance();
}
export function productionStyleRecords(project){const c=project.productionLetteringStyles;return c?[c.global,...Object.values(c.episodes||{}),...Object.values(c.segments||{})].filter(Boolean):[];}

/** Frozen material data lets future dialogue inherit a template without copying its words or position. */
export function dialogueTemplateStyle(bubble){
 const box={styleId:bubble.comicStyleId||'default',shape:bubble.shape,...Object.fromEntries(PRODUCTION_BOX_FIELDS.filter(f=>f!=='tailVisible'&&bubble[f]!==undefined).map(f=>[f,bubble[f]])),...(bubble.styleTextureId?{outlineWidth:bubble.materialOutlineWidth??2.8}:{}),tailVisible:bubble.tail?.visible!==false};
 if(bubble.assetContour)Object.assign(box,{localAssetId:bubble.styleTextureAssetId,assetId:bubble.styleLibrary?.assetId,revisionId:bubble.styleLibrary?.revisionId,definition:{contour:copy(bubble.assetContour),insets:copy(bubble.assetInsets),label:bubble.comicStyleLabel,texture:!!bubble.styleTextureId,...(bubble.materialAspectRatio?{width:bubble.materialAspectRatio,height:1}:{}),parts:copy(bubble.assetParts),rays:copy(bubble.assetRays),frame:copy(bubble.assetFrame),tailKind:bubble.assetTailKind,tailPreset:{visible:bubble.tail?.visible,side:bubble.tail?.side,base:bubble.tail?.base}}});
 return {...Object.fromEntries(PRODUCTION_FONT_FIELDS.filter(k=>bubble[k]!==undefined).map(k=>[k,bubble[k]])),boxes:{speech:box}};
}
