import {fontWeightOptions} from './font-weights.js';
import {dialogueSegments,isDoubleBubble} from './bubble-dialogue-segments.js';
import {speakerMarkup} from './bubble-speaker.js';
import {bubbleLineBreakMode} from './bubble-text-flow.js';
import {isLibrarySfx,sfxInspectorMarkup} from './sfx-library.js';
import {FONT_FAMILIES,normalizeBubbleStyle,bubbleTailGeometry,bubbleShapePoints,validBubblePoints} from './lettering.js';
import {FONT_LABELS} from './unified-typography.js';
import {fontNameInChinese} from './font-names.js';
import {bubbleStyleSelectorMarkup} from './bubble-style-selector.js';
import {bubbleParts} from './bubble-parts.js';
import {PRODUCTION_BOX_KINDS,productionStyleKind} from './production-lettering-style.js';
export function bubbleInspectorMarkup(bubble,{escape,numberField,nodeIndex=0,layout,page,project,assets=[]}={}){
 if(isLibrarySfx(bubble))return sfxInspectorMarkup(bubble,{escape,numberField,page});
 const w=layout?.w>0?layout.w:bubble.w,h=layout?.h>0?layout.h:bubble.h,style=normalizeBubbleStyle(bubble),tail=bubbleTailGeometry({...bubble,tail:{...bubble.tail,visible:true}},w,h),points=validBubblePoints(bubble.points)?bubble.points:bubbleShapePoints('custom'),index=Math.max(0,Math.min(points.length-1,nodeIndex)),parts=bubbleParts(bubble),showTail=!!bubbleTailGeometry(bubble)&&style.shape!=='none';
 const segments=dialogueSegments(bubble),locked=!!(bubble.locked||page.locked);
 const select=(label,key,value,options,section='bubble',numeric=false)=>`<label>${label}<select data-section="${section}" data-field="${key}"${numeric?' data-value-type="number"':''}>${options.map(([v,l])=>`<option value="${escape(v)}" ${v===value?'selected':''}>${escape(l)}</option>`).join('')}</select></label>`;
 const color=(label,key,value)=>`<label>${label}<input type="color" data-section="bubble" data-field="${key}" value="${value}" aria-label="${label}"></label>`;
 const n=(label,key,value,min,max,step=1,section='bubble')=>numberField(label,key,value,section,min,max,step);
 const types=[['speech','对白'],['thought','心声'],['caption','旁白']];if(!types.some(([value])=>value===bubble.type))types.push([bubble.type,{sfx:'音效文字',label:'画内文字',system:'系统文字'}[bubble.type]||bubble.type]);
 const fonts=Object.keys(FONT_FAMILIES).map((key,i)=>[key,FONT_LABELS[key]||fontNameInChinese(key,i+1)]),shapeOptions=[['','原有样式'],['oval','自然椭圆'],['rounded-rect','圆角框'],['cloud','云朵'],['burst','放射'],['custom','自定义节点'],['asset','素材轮廓'],['none','无框']];
 const styleLabel=bubble.comicStyleLabel?.replaceAll('_',' · ')||shapeOptions.find(([key])=>key===style.shape)?.[1]||'原有样式';
 return `<div class="bubble-properties" data-bubble-properties>
 <div class="bubble-context">${speakerMarkup(project,bubble,assets,{editable:true})}<label class="bubble-type-field"><select data-section="bubble" data-field="${project?.productionPackage?'productionBoxKind':'type'}" aria-label="对白类型">${(project?.productionPackage?Object.entries(PRODUCTION_BOX_KINDS):types).map(([value,label])=>`<option value="${escape(value)}" ${value===(project?.productionPackage?productionStyleKind(bubble):bubble.type)?'selected':''}>${escape(label)}</option>`).join('')}</select></label></div>

 <section class="bubble-dialogue-content" aria-label="台词内容">
 <div class="bubble-dialogue-heading"><strong>${segments.length?'双段台词':'台词内容'}</strong>${isDoubleBubble(bubble)&&!segments.length?`<button type="button" class="bubble-add-dialogue" data-action="bubble-add-dialogue" ${locked?'disabled':''} title="为双圆气泡新增第二段台词，原文保留，可撤销">＋ 新增台词</button>`:''}</div>
 ${segments.length?segments.map((s,i)=>`<label class="bubble-content-field">第 ${i+1} 段<textarea aria-label="第 ${i+1} 段台词" data-section="bubble-segment-${i}" data-field="text" rows="3" maxlength="4000">${escape(s.text)}</textarea></label>`).join(''):`<label class="bubble-content-field"><textarea aria-label="对白内容" data-section="bubble" data-field="text" rows="2" maxlength="4000">${escape(bubble.text)}</textarea></label>${/[\r\n\u2028\u2029]/.test(bubble.text)?'<button type="button" data-action="bubble-join-lines" class="bubble-join-lines" title="仅合并当前对白的回车，标点保留；可撤销">合并换行</button>':''}`}
 ${segments.length?`<div class="bubble-dialogue-actions"><span>两段可分别拖动、缩放</span><button type="button" data-action="bubble-reset-textbox" ${locked?'disabled':''}>恢复自动排字</button></div>`:''}
 </section>

 ${bubbleStyleSelectorMarkup(bubble,{label:styleLabel,locked:bubble.locked||page.locked})}
 <section class="bubble-properties-pane" data-bubble-property-group="font"><h3>字体</h3>
 ${select('字体','fontFamily',style.fontFamily,fonts)}
 <div class="field-grid">${n('字号 px','fontSize',style.fontSize,10,2048)}${select('字重','fontWeight',style.fontWeight,fontWeightOptions(style.fontFamily,style.fontWeight),'bubble',true)}${color('文字颜色','textColor',style.textColor)}${select('对齐','textAlign',style.textAlign,[['left','靠左'],['center','居中'],['right','靠右']])}</div>
 ${layout?.overflow?'<p class="bubble-overflow-note" role="status">文字超出区域，请调整文字框或适配气泡。</p>':''}
 <details class="bubble-typography-more" data-inspector-section="bubble-text"><summary>换行与排字</summary>${select('换行方式','lineBreakMode',bubbleLineBreakMode(bubble),[['auto','随框宽自动换行（保留回车）'],['explicit','仅按手动回车换行']])}<div class="field-grid">${n('行高倍率','lineHeight',style.lineHeight,.8,3,.05)}${n('字间距 px','letterSpacing',style.letterSpacing,-128,256,.5)}${select('文字排列','writingMode',style.writingMode,[['horizontal','横排'],['vertical','竖排']])}${select('书写顺序','textDirection',style.textDirection,[['ltr','左到右'],['rtl','右到左']])}${n('内部留白 px','padding',style.padding,0,4096)}</div></details>
 <button type="button" data-action="bubble-fit-current-layout" class="wide" ${locked||style.shape==='none'||segments.length||!String(bubble.text||'').trim()?'disabled':''} title="${segments.length?'双段气泡请分别拖动文字框调整排字':'保留字号、分行、文字位置及尾巴显示状态，只调整气泡外框，可撤销'}">按文字适配气泡</button>
 </section>
 <section class="bubble-properties-pane" data-bubble-property-group="frame"><h3>气泡框</h3>
 <div class="field-grid">${n('描边粗细 px','outlineWidth',bubble.styleTextureId?(bubble.materialOutlineWidth??2.8):style.outlineWidth,0,256,.5)}${color('描边颜色','outlineColor',style.outlineColor)}${color('气泡底色','fillColor',style.fillColor)}${n('填充不透明度 %','fillOpacity',Math.round(style.fillOpacity*100),0,100,1)}</div>
 <div class="bubble-tail-controls"><label class="checkbox-field"><input type="checkbox" data-section="bubble-tail" data-field="visible" ${showTail?'checked':''} ${style.shape==='none'?'disabled':''}>显示尾巴</label><div class="bubble-tail-adjustments" ${showTail?'':'hidden'}>
 <label><span>尾巴连接位置<output data-tail-anchor-output>${Math.round((tail.anchorT||0)*1000)/10}%</output></span><input type="range" data-section="bubble-tail" data-field="anchorT" min="0" max="100" step="0.1" value="${(tail.anchorT||0)*100}" aria-label="尾巴根部沿外边缘位置"></label>
 <label><span>尾巴根部宽度<output data-tail-width-output>${Math.round((bubble.tail?.width??.12)*1000)/10}%</output></span><input type="range" data-section="bubble-tail" data-field="width" min="1" max="80" step="0.5" value="${(bubble.tail?.width??.12)*100}" aria-label="尾巴根部间距"></label></div></div>
 ${bubble.assetRays?`<section class="bubble-property-fields" data-inspector-section="bubble-rays"><h4>内心框放射细线</h4><div class="field-grid">${n('细线数量','count',bubble.assetRays.count,32,240,1,'bubble-rays')}${n('细线长度 %','length',bubble.assetRays.length*100,2,22,.5,'bubble-rays')}</div></section>`:''}
 ${parts.length?'<p class="bubble-canvas-hint">拖动画布上的紫色控点，可移动或缩放上方圆框。</p>':''}
 </section>
 ${style.shape==='custom'?`<section class="bubble-property-fields" data-inspector-section="bubble-nodes"><h4>轮廓节点</h4>${select('当前节点','nodeIndex',index,points.map((p,i)=>[i,'节点 '+(i+1)]),'bubble-node-index',true)}<div class="row"><button type="button" data-action="bubble-add-node" ${locked||points.length>=32?'disabled':''}>加点</button><button type="button" data-action="bubble-delete-node" ${locked||points.length<=3?'disabled':''}>删点</button></div></section>`:''}
 </div>`;
}
