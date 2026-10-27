import {effectiveOutfitPrompt} from './episode-outfit.js';
import {bounds} from './model.js';
import {productionPanelPrompts} from './production-panel-prompts.js';
export const PROMPT_SOURCES=Object.freeze([{value:'imported',label:'分镜表提示词'},{value:'post-lettering',label:'生图提示词（后期嵌字）'},{value:'direct',label:'直出提示词'}]);
export function promptSource(value){if(value===undefined||value===null||value==='current')return 'imported';if(!PROMPT_SOURCES.some(option=>option.value===value))throw Object.assign(Error('提示词来源无效'),{status:400});return value;}
const header=value=>String(value).normalize('NFKC').replace(/\s+/gu,'');
// Preserve the source and per-mode edits; derive the visible and submitted aspect from current geometry.
export function currentFramePromptRatio(text,panel){
 if(!text?.trim()||!panel||panel.productionSegment||panel.productionBackground||panel.cutoutLayer||panel.breakoutForeground||!Array.isArray(panel.points)||!panel.points.length||!Number.isFinite(panel.w)||!Number.isFinite(panel.h))return text;
 const box=bounds(panel),width=Math.round(box.w),height=Math.round(box.h);if(width<1||height<1)return text;
 const ratio=width+':'+height;
 const pattern=/((?:宽高比|画幅比例|画面比例|图片比例|图像比例|画幅)(?:\s*(?:为|是|设为|设置为|采用|使用|：|:))?\s*)(\d+(?:\.\d+)?\s*[:：/]\s*\d+(?:\.\d+)?)/gu;
 return text.replace(pattern,(_all,prefix)=>prefix+ratio);
}
export function generationPromptChoices(panel,project){
 const generation=panel?.generation||{},shot=project?.shots?.find(shot=>shot.id===panel?.shotId),original=shot||generation.lastSourceSnapshot?.original||generation.sourceSnapshot?.original||{},fields=original.sourceFields||{};
 const read=names=>{const match=Object.entries(fields).find(([key,value])=>names.includes(header(key))&&typeof value==='string'&&value.trim());return match?{text:match[1],column:match[0]}:{text:'',column:null};};
 const post=read(['生图提示词(后期嵌字)','后期嵌字提示词','后期嵌字生图提示词','生图提示词(无泡)']),direct=read(['直出提示词','生图直出提示词']),explicit=read(['生图提示词','生产提示词','提示词','prompt','productionPrompt']);
 if(original.productionPromptVariants===1){const variants=productionPanelPrompts({original:fields}),nested=fields['提示词']||fields['单格提示词']||{},withText=typeof nested['带字']==='string'?{text:nested['带字'],column:'提示词.带字'}:{text:'',column:null},empty=variants.empty.text?variants.empty:withText,clean=variants.clean.text?variants.clean:post;return PROMPT_SOURCES.map(option=>({...option,label:option.value==='imported'?(variants.empty.text?'单格空泡原文':withText.text?'单格带字原文':'单格空泡原文'):option.value==='post-lettering'?'单格无泡原文':withText.text?'单格带字原文':'直出提示词（本格未提供）',...(option.value==='imported'?empty:option.value==='post-lettering'?clean:withText)}));}
 const content=read(['画面内容','画面描述','description','画面','分镜内容','分镜','画面内容描述']);
 const imported=original.productionSegment?explicit:explicit.text?explicit:post.text?post:direct.text?direct:content.text?content:{text:original.productionPrompt||original.description||generation.prompt||'',column:null};
 return PROMPT_SOURCES.map(option=>({...option,...(original.productionSegment?{label:option.value==='imported'?'屏段空泡原文':option.value==='post-lettering'?'屏段无泡原文':direct.text?'单格带字原文':'直出提示词（本包未提供）'}:{}),...(option.value==='direct'?direct:option.value==='post-lettering'?post:imported)}));
}
export function generationPromptSelection(panel,project){
 const source=promptSource(panel?.generation?.promptSource),original=generationPromptChoices(panel,project).find(option=>option.value===source),overrides=panel?.generation?.promptOverrides;
 const edited=!!overrides&&Object.hasOwn(overrides,source)&&typeof overrides[source]==='string';
 const outfitText=effectiveOutfitPrompt(project,panel,edited?overrides[source]:original.text),text=currentFramePromptRatio(outfitText,panel);
 return {...original,source,originalText:original.text,edited:edited||outfitText!==original.text,text};
}
export function setPanelPromptText(panel,text){
 if(typeof text!=='string'||text.length>20000)throw Object.assign(Error('本格提示词最多20000字'),{status:400});
 const source=promptSource(panel?.generation?.promptSource);panel.generation||={};
 panel.generation.promptOverrides={...panel.generation.promptOverrides,[source]:text};
}
export function restorePanelPromptText(panel){
 const source=promptSource(panel?.generation?.promptSource),overrides=panel?.generation?.promptOverrides;
 if(!overrides||!Object.hasOwn(overrides,source))return false;
 delete overrides[source];if(!Object.keys(overrides).length)delete panel.generation.promptOverrides;return true;
}
export function validPromptOverrides(value){
 return value===undefined||!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length<=3&&Object.entries(value).every(([key,text])=>PROMPT_SOURCES.some(s=>s.value===key)&&typeof text==='string'&&text.length<=20000);
}
