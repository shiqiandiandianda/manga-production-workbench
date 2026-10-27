import {bounds,rectangle} from './model.js';
import {circleFramePoints,isCircleFrame} from './frame-primitives.js';
import {validateCustomFramePoints,customFrameShapeIcon} from './custom-frame-shapes.js';
export const SIMPLE_FRAME_TEMPLATES=Object.freeze([{id:'frame-square',label:'1:1',title:'正方形 1:1',ratio:1},{id:'frame-landscape',label:'16:9',title:'横版 16:9',ratio:16/9},{id:'frame-portrait',label:'9:16',title:'竖版 9:16',ratio:9/16},{id:'frame-circle',label:'圆形',title:'圆形',ratio:1}]);
export function savedFrameShapes(library){return [...library.list(),...library.presets().filter(p=>p.overridden).map(p=>({id:'legacy-frame:'+p.id,name:'原常用 · '+p.name,points:p.points}))];}
export function activeFrameTemplate(frame){const circle=isCircleFrame(frame.points),rect=JSON.stringify(frame.points)===JSON.stringify(rectangle());if(circle)return Math.abs(frame.w/frame.h-1)<.001?'frame-circle':null;if(!rect)return null;return SIMPLE_FRAME_TEMPLATES.filter(t=>t.id!=='frame-circle').find(t=>Math.abs(frame.w/frame.h-t.ratio)<.001)?.id||null;}
export function applyFrameTemplate(frame,value,{pageWidth=1280}={}){
 if(frame.locked)throw Error('请先解锁画格');const template=SIMPLE_FRAME_TEMPLATES.find(t=>t.id===value);if(!template)throw Error('基础形状不存在');const b=bounds(frame),oldX=frame.x,oldY=frame.y,w=Math.max(20,Math.min(b.w,pageWidth,3840*template.ratio)),h=w/template.ratio;
 frame.x=Math.max(0,Math.min(pageWidth-w,frame.x+b.x));frame.y+=b.y;frame.w=w;frame.h=h;frame.points=template.id==='frame-circle'?circleFramePoints():rectangle();
 if(frame.imageTransform)frame.imageTransform={...frame.imageTransform,x:frame.imageTransform.x+oldX-frame.x,y:frame.imageTransform.y+oldY-frame.y};return frame;
}
/** An explicit uniform scale changes the frame and its image transform by the same factor. */
export function scaleFrameUniformly(frame,factor,{pageWidth=1280}={}){
 if(frame.locked)throw Error('请先解锁画格');if(!Number.isFinite(factor)||factor<=0)throw Error('缩放比例无效');const b=bounds(frame),w=b.w*factor,h=b.h*factor;
 if(w<20||h<20||h>3840+.001||frame.w*factor>pageWidth*3||frame.x+(b.x+b.w)*factor>pageWidth+.001||frame.x+b.x*factor<-.001)throw Error('缩放后超出画板宽度或3840 px高度，请缩小比例');
 frame.w*=factor;frame.h*=factor;if(frame.imageTransform){const t=frame.imageTransform;frame.imageTransform={...t,x:t.x*factor,y:t.y*factor,scale:t.scale*factor};}if(frame.featherEdges)frame.featherEdges=Object.fromEntries(Object.entries(frame.featherEdges).map(([k,v])=>[k,Math.min(10000,v*factor)]));if(frame.feather)frame.feather*=factor;return frame;
}
export function simpleFrameShapeMarkup(frame,library,escape){let items=[];try{items=savedFrameShapes(library);}catch{}const active=activeFrameTemplate(frame);return `<div class="simple-frame-shapes" role="group" aria-label="画格基础形状">${SIMPLE_FRAME_TEMPLATES.map(t=>`<button type="button" data-frame-template="${t.id}" title="${t.title}" aria-label="${t.title}" aria-pressed="${active===t.id}" ${frame.locked?'disabled':''}>${t.label}</button>`).join('')}<button type="button" data-save-frame-shape aria-label="保存当前轮廓为自定义形状" title="＋ 保存当前画格轮廓，可保存多个" ${frame.locked?'disabled':''}>＋</button></div><div class="simple-frame-saved">${items.map(s=>`<button type="button" data-saved-frame-shape="${escape(s.id)}" title="应用 ${escape(s.name)}" aria-label="应用${escape(s.name)}" ${frame.locked?'disabled':''}>${customFrameShapeIcon(s.points)}</button>`).join('')}</div>`;}
export function openSaveFrameShape({library,getTarget,modal,closeModal,escape,onSaved=()=>{},toast=()=>{}}){
 const frame=getTarget();if(!frame||frame.locked)throw Error('请先选中并解锁画格');const id=frame.id,points=validateCustomFramePoints(frame.points),name='自定义形状 '+(library.list().length+1);
 modal('保存当前轮廓',`<div class="simple-frame-save-preview">${customFrameShapeIcon(points,{width:110,height:80})}</div><label>形状名称<input data-save-shape-name value="${escape(name)}" maxlength="80"></label><p class="sub-note">保存后出现在形状栏，可在其他画格重复使用。</p>`,[{label:'取消',run:closeModal},{label:'保存形状',primary:true,run:()=>{if(getTarget()?.id!==id||getTarget()?.locked)throw Error('当前画格已切换或锁定，请重新保存');const saved=library.create(document.querySelector('[data-save-shape-name]').value||name,points);closeModal();onSaved(saved);toast('已保存 '+saved.name);}}]);
}
