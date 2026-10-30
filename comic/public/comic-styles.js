import {TEXT_FONT_DEFAULTS} from './text-font-defaults.js';
import {COMIC_STYLE_CATALOG} from './comic-style-data.js';
import {builtinBubbleStyle,builtinBubblePreview} from './builtin-bubble-data.js';
import {REFERENCE_BUBBLE_STYLES} from './reference-bubble-data.js';
import {REFERENCE_BUBBLE_UPDATES} from './reference-bubble-updates.js';
import {REFERENCE_THOUGHT_BUBBLES} from './reference-thought-bubble-data.js';
import {VERTICAL_LABEL_FRAMES} from './vertical-label-frame-data.js';
import {validBubbleParts} from './bubble-parts.js';
import {validBubbleRays} from './bubble-rays.js';
import {validBubbleFrame,validFramePreset,applyFramePreset} from './bubble-frame.js';
export const comicStyles=[...COMIC_STYLE_CATALOG.items,...REFERENCE_BUBBLE_STYLES,...REFERENCE_BUBBLE_UPDATES,...REFERENCE_THOUGHT_BUBBLES,...VERTICAL_LABEL_FRAMES];
export const comicStyle=id=>builtinBubbleStyle(id)||comicStyles.find(item=>item.id===id)||null;
// 墨库里维护的气泡样式覆盖本地目录；预览图也改走墨库固定版本。
const remotePreviews=new Map();
const normalizeRemoteStyle=item=>({id:String(item.id||''),kind:'bubble',label:String(item.label||item.id||''),family:String(item.family||''),uses:Array.isArray(item.uses)?item.uses.filter(use=>['speech','thought','caption'].includes(use)):[],contour:item.contour,insets:item.insets||{left:.12,right:.12,top:.12,bottom:.12},texture:item.texture===true,width:Number(item.width)||null,height:Number(item.height)||null,assetId:item.assetId||'',revisionId:item.revisionId||'',assetType:item.assetType||'bubble',definitionSha256:item.definitionSha256,previewUrl:item.previewUrl||'',parts:validBubbleParts(item.parts)?structuredClone(item.parts):undefined,rays:validBubbleRays(item.rays)?structuredClone(item.rays):undefined,frame:validBubbleFrame(item.frame)?structuredClone(item.frame):undefined,preset:validFramePreset(item.preset)?structuredClone(item.preset):undefined,tailKind:['straight','curved','lightning'].includes(item.tailKind)?item.tailKind:undefined,tailPreset:item.tailPreset&&typeof item.tailPreset==='object'?structuredClone(item.tailPreset):undefined});
export function applyRemoteBubbleStyles(items){
 const list=(Array.isArray(items)?items:[]).map(normalizeRemoteStyle).filter(item=>item.id&&validAssetContour(item.contour));
 if(!list.length)return 0;
 for(let index=comicStyles.length-1;index>=0;index--)if(comicStyles[index].kind==='bubble')comicStyles.splice(index,1);
 comicStyles.unshift(...list);
 remotePreviews.clear();
 for(const item of list)if(item.previewUrl)remotePreviews.set(item.id,item.previewUrl);
 return list.length;
}
export const comicPreviewUrl=id=>builtinBubblePreview(id)||remotePreviews.get(id)||'/api/comic-style-library/items/'+encodeURIComponent(id)+'/image';
export const normalizeSfxWord=text=>String(text??'').replace(/[\s“”"'‘’!！?？。，,、：:；;…—\-【】\[\]]/gu,'').trim();
export const isEmptySfxWord=text=>/^(?:无|暂无|没有|无音效|无特效|无特效字|无拟声词|无特效文字|none|n\/a|null)$/iu.test(normalizeSfxWord(text));
const hash=text=>{let value=2166136261;for(const char of text){value^=char.codePointAt(0);value=Math.imul(value,16777619);}return value>>>0;};
const thought=comicStyles.filter(item=>item.kind==='bubble'&&item.texture).slice(0,2).map(item=>item.id);
export function recommendedComicProfile(){return {enabled:true,seed:'comic-library-v1',speech:['thin-01','thin-03','thin-05','thin-14'],thought,caption:['thin-14','thin-15'],sfxChoices:{},placeSfx:true};}
export function normalizeComicProfile(input){
 if(!input)return {enabled:false};
 const out={enabled:input.enabled===true,seed:String(input.seed||'comic-library-v1').slice(0,120),sfxChoices:{},customSfx:{},placeSfx:input.placeSfx===true};
 for(const [word,item] of Object.entries(input.customSfx||{}))if(item&&/^asset_[0-9a-f-]{36}$/.test(item.assetId||'')&&Number.isFinite(item.width)&&item.width>0&&Number.isFinite(item.height)&&item.height>0)out.customSfx[normalizeSfxWord(word)]={assetId:item.assetId,width:item.width,height:item.height,label:String(item.label||word).slice(0,120)};
 for(const type of ['speech','thought','caption']){const values=Array.isArray(input[type])?input[type]:[];out[type]=[...new Set(values.filter(id=>comicStyle(id)?.kind==='bubble'&&comicStyle(id).uses.includes(type)))].slice(0,29);}
 for(const [word,id] of Object.entries(input.sfxChoices||{})){const item=comicStyle(id);if(item?.kind==='sfx'&&normalizeSfxWord(item.word)===normalizeSfxWord(word))out.sfxChoices[normalizeSfxWord(word)]=id;}
 return out;
}
export function validAssetContour(points){return Array.isArray(points)&&points.length>=8&&points.length<=160&&points.every(point=>point&&Number.isFinite(point.x)&&Number.isFinite(point.y)&&point.x>=0&&point.x<=1&&point.y>=0&&point.y<=1);}
export function applyComicBubbleStyle(bubble,profile,key){
 const config=normalizeComicProfile(profile),type=['speech','thought','caption'].includes(bubble.type)?bubble.type:null,pool=type&&config[type];
 if(!config.enabled||!pool?.length)return bubble;
 const style=comicStyle(pool[hash(config.seed+':'+key)%pool.length]);
 Object.assign(bubble,{shape:'asset',assetContour:structuredClone(style.contour),assetInsets:{...style.insets},comicStyleId:style.id,comicStyleLabel:style.label,outlineWidth:style.texture?0:2.8,outlineColor:'#171717',fillColor:'#ffffff',fillOpacity:1,fontFamily:bubble.fontFamily||TEXT_FONT_DEFAULTS.fontFamily,fontWeight:bubble.fontWeight??TEXT_FONT_DEFAULTS.fontWeight,fontSize:bubble.fontSize??TEXT_FONT_DEFAULTS.fontSize});
 delete bubble.assetParts;delete bubble.assetTailKind;delete bubble.assetRays;delete bubble.assetFrame;if(style.frame)bubble.assetFrame=structuredClone(style.frame);applyFramePreset(bubble,style.preset);if(style.rays)bubble.assetRays=structuredClone(style.rays);if(style.parts)bubble.assetParts=structuredClone(style.parts);if(style.tailKind)bubble.assetTailKind=style.tailKind;if(style.tailPreset)bubble.tail=structuredClone(style.tailPreset);
 if(style.texture)bubble.styleTextureId=style.id;else delete bubble.styleTextureId;
 return bubble;
}
export function effectCandidates(word){return comicStyles.filter(item=>item.kind==='sfx'&&normalizeSfxWord(item.word)===normalizeSfxWord(word));}
function explicitWords(value){
 if(isEmptySfxWord(value))return [];
 return String(value??'').replace(/\bN\/A\b/gi,'').split(/[\n、,，;；|/]+/u).map(text=>text.replace(/^\s*(?:特效字|音效字|拟声词|音效)[：:]?/u,'').replace(/[（(][^）)]*[）)]/gu,'').trim()).filter(text=>normalizeSfxWord(text)&&[...normalizeSfxWord(text)].length<=24);
}
export function collectSfxDemands(shots){
 const map=new Map();
 const add=(word,shot,origin)=>{const key=normalizeSfxWord(word);if(!key||isEmptySfxWord(key))return;let demand=map.get(key);if(!demand){demand={word:key,originalWords:[],occurrences:[],matches:effectCandidates(key).map(item=>item.id)};map.set(key,demand);}if(!demand.originalWords.includes(word))demand.originalWords.push(word);if(!demand.occurrences.some(item=>item.shotId===shot.id&&item.origin===origin))demand.occurrences.push({shotId:shot.id,code:shot.code,origin});};
 for(const shot of shots||[]){
  for(const field of ['sfxWords','特效字','音效字','音效','拟声词','sfx','soundEffects'])for(const word of explicitWords(shot[field]))add(word,shot,'column');
  for(const word of explicitWords(shot.storyboard?.clientFields?.['特效字']))add(word,shot,'column');
  for(const item of shot.embeddedTexts||[])if(typeof item==='object'&&/特效|音效|拟声|sfx/i.test(item.type||''))for(const word of explicitWords(item.text))add(word,shot,'column');
  for(const line of String(shot.dialogue||'').split('\n')){const match=/^\s*(?:SFX|音效|特效字|拟声)[：:]\s*(.+)$/iu.exec(line);if(match)for(const word of explicitWords(match[1]))add(word,shot,'dialogue');}
 }
 return [...map.values()];
}
export function pickEffectStyle(word,profile,key=''){
 const config=normalizeComicProfile(profile),candidates=effectCandidates(word);if(!config.enabled)return null;
 const custom=config.customSfx?.[normalizeSfxWord(word)];if(custom)return {...custom,id:'custom-'+custom.assetId,word:normalizeSfxWord(word),kind:'sfx',family:'新设计字效'};
 if(!candidates.length)return null;
 return comicStyle(config.sfxChoices[normalizeSfxWord(word)])||candidates[hash(config.seed+':'+normalizeSfxWord(word)+':'+key)%candidates.length];
}
export function applyEffectVisual(bubble,style){
 if(!style)return bubble;
 Object.assign(bubble,{type:'sfx',shape:'none',sfxLibrary:true,visualStyleId:style.id,visualWord:normalizeSfxWord(style.word),comicStyleLabel:style.label,tail:{visible:false},overflow:'visible',fontSize:Math.max(44,bubble.fontSize||96)});
 if(style.assetId)bubble.visualAssetId=style.assetId;else delete bubble.visualAssetId;
 const maximum=Math.min(480,bubble.w||360);bubble.w=maximum;bubble.h=maximum*style.height/style.width;
 return bubble;
}
export function currentVisualStyle(bubble){return normalizeSfxWord(bubble.text)===bubble.visualWord?(bubble.visualStyleId||bubble.visualAssetId):null;}
