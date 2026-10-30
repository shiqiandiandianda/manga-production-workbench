import {bubbleMaterials,applyBubbleMaterial,clearBubbleMaterial} from './bubble-material.js';
import {comicPreviewUrl} from './comic-styles.js';
import {bubbleLayout,normalizeBubbleStyle,svgBubbleMarkup,fitBubbleToTextFrame} from './lettering.js';
import {freezeBubbleForGeometry} from './bubble-editor.js';
import {fitBubbleToCurrentLayout} from './bubble-fit-layout.js';

const basics=[['none','无框文字'],['oval','自然椭圆'],['rounded-rect','圆角框'],['cloud','云朵'],['burst','放射']];
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const previews=new Map();
function shapePreview(shape){
 if(!previews.has(shape)){
  const svg=shape==='none'?'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 76"><rect width="120" height="76" fill="#f4f6fb"/><text x="60" y="44" text-anchor="middle" font-size="17" fill="#172333">台词文字</text></svg>':'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 76"><rect width="120" height="76" fill="#f4f6fb"/>'+svgBubbleMarkup({measureText:()=>({width:0})},{id:'preview-'+shape,visible:true,x:7,y:7,w:106,h:62,type:'speech',shape,text:'',fillOpacity:1,fillColor:'#ffffff',outlineWidth:1.5,outlineColor:'#172333',tail:{visible:false}})+'</svg>';
  previews.set(shape,'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg));
 }
 return previews.get(shape);
}
export function bubbleStyleSelectorMarkup(bubble,{label='',locked=false}={}){
 const selected=bubble.shape==='asset'?bubble.comicStyleId:'shape:'+normalizeBubbleStyle(bubble).shape;
 const choices=[...basics.map(([shape,label])=>({id:'shape:'+shape,label,src:shapePreview(shape)})),...bubbleMaterials.map(s=>({id:s.id,label:s.label.replaceAll('_',' · '),src:comicPreviewUrl(s.id)}))];
 return `<section class="bubble-style-selector" aria-label="气泡样式"><div class="bubble-style-heading"><strong>气泡样式</strong><span data-current-bubble-style>${esc(label)}</span></div><div class="bubble-style-grid" data-bubble-style-grid>${choices.map(s=>`<button type="button" class="bubble-style-option" data-action="bubble-pick-style" data-bubble-style="${esc(s.id)}" aria-label="${esc(s.label)}" aria-pressed="${s.id===selected}" title="${esc(s.label)}" ${locked?'disabled':''}><img loading="lazy" src="${esc(s.src)}" alt="${esc(s.label)}"><span>${esc(s.label)}</span></button>`).join('')}</div><p class="sub-note">点击缩略图更换当前气泡</p></section>`;
}

/** A style change replaces the contour, never the user's text arrangement. */
export function changeBubbleStyle(context,bubble,styleId,textureAssetId){
 if(bubble.locked)throw Error('请先解锁气泡');
 const frozen=freezeBubbleForGeometry(structuredClone(bubble),bubbleLayout(context,bubble));
 let next;
 if(styleId.startsWith('shape:')){
  const shape=styleId.slice(6);if(!basics.some(([value])=>value===shape))throw Error('气泡样式不存在');
  next=clearBubbleMaterial(frozen);next.shape=shape;
  if(shape!=='none'&&bubble.shape==='none'){if(next.fillOpacity===0)next.fillOpacity=1;if(next.outlineWidth===0)next.outlineWidth=2.8;}
 }else next=applyBubbleMaterial(frozen,styleId,textureAssetId);
 // Vertical material presets may set size, colors and writing mode. In the
 // inspector they change only the frame, retaining the already edited text.
 for(const key of ['x','y','w','h','text','textBox','textLayout','textFrameLayout','dialogueSegments','fontFamily','fontSize','fontWeight','fontStyle','textAlign','textColor','writingMode','textDirection','letterSpacing','lineHeight','lineBreakMode','textFlowVersion','tail']){
  if(Object.hasOwn(frozen,key))next[key]=structuredClone(frozen[key]);else delete next[key];
 }
 if(next.autoLettering)next.autoLettering.mode='manual';
 // A hidden frame may be tiny or far from its independently moved text. Restore
 // a visible body around the current text frame without moving/reflowing words.
 if(normalizeBubbleStyle(bubble).shape==='none'&&normalizeBubbleStyle(next).shape!=='none'&&String(next.text||'').trim()){
  const fitted=fitBubbleToCurrentLayout(context,next);
  // Match the inspector button; retain the safe frame fit for unsupported contours/segments.
  next=fitted.status==='fitted'?fitted.bubble:fitBubbleToTextFrame(context,next,{preserveMaterialAspect:true});
 }
 return next;
}
