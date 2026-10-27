import {editDialogueSegment} from './bubble-dialogue-segments.js';
import {isLibrarySfx,SFX_PRESETS} from './sfx-library.js';
import {saveBubbleTextFlow,freezeBubbleTextLayout} from './bubble-text-flow.js';
import {bubbleTextBox,bubbleTailGeometry,bubbleShapePoints,normalizeBubbleStyle,validBubblePoints} from './lettering.js';
import {applyBubbleEdit,freezeBubbleForGeometry} from './bubble-editor.js';
import {canonicalBubbleTail} from './bubble-tail-compat.js';
import {editBubblePart} from './bubble-parts.js';
export function selectionPage(project,selection,fallbackPageId){
  if(!project)return null;
  const collection=selection?.type==='bubble'?'bubbles':'panels';
  if(selection){const fixed=project.pages.find(p=>p.id===selection.pageId);if(fixed?.[collection]?.some(item=>item.id===selection.id))return fixed;const found=project.pages.find(p=>p[collection]?.some(item=>item.id===selection.id));if(found)return found;}
  return project.pages.find(p=>p.id===fallbackPageId)||project.pages[0]||null;
}
export function localPagePoint(layout,pageId,point){
  const entry=layout?.pages.find(p=>p.pageId===pageId);
  if(!entry||!Number.isFinite(point?.x)||!Number.isFinite(point?.y))return null;
  return {x:(point.x-entry.x)/entry.scale,y:(point.y-entry.y)/entry.scale};
}
export function bubbleFieldChange(bubble,section,key,value,nodeIndex=0,layout){
  if(section.startsWith('bubble-segment-')&&key==='text')return editDialogueSegment(bubble,Number(section.slice('bubble-segment-'.length)),{text:value});
  if(section==='bubble-tail'&&key==='widthPercent')key='width';
  let next=structuredClone(bubble);
  if(section.startsWith('bubble-part-'))return editBubblePart(freezeBubbleForGeometry(next,layout),Number(section.slice('bubble-part-'.length)),{field:key,value:value/100});
  if(section==='bubble-rays'&&next.assetRays&&['count','length'].includes(key)){next.assetRays[key]=key==='length'?value/100:value;return next;}
  if(isLibrarySfx(bubble)&&key==='sfxPreset'&&SFX_PRESETS[value]){Object.assign(next,SFX_PRESETS[value],{sfxPreset:value});}
  else if(section==='bubble-textbox'){if(['x','y'].includes(key)&&layout)freezeBubbleForGeometry(next,layout);next.textBox={...bubbleTextBox(next),[key]:value};if(['w','h'].includes(key)){delete next.textLayout;next.textFrameLayout=true;saveBubbleTextFlow(next);}}
  else if(section==='bubble'&&['w','h'].includes(key))next=applyBubbleEdit(freezeBubbleForGeometry(next,layout),{type:'resize',dx:key==='w'?value-bubble.w:0,dy:key==='h'?value-bubble.h:0});
  else if(key==='lineBreakMode'){next.lineBreakMode=value;next.textFlowVersion=1;}
  else if(section==='bubble-tail'){
    const w=layout?.w>0?layout.w:bubble.w,h=layout?.h>0?layout.h:bubble.h;
    if(key==='width')next=applyBubbleEdit({...next,w,h},{type:'tail-width',width:Number(value)/100});
    else if(key==='anchorT')next=applyBubbleEdit({...next,w,h},{type:'tail-anchor',anchorT:Number(value)/100});
    else{
      const geometry=bubbleTailGeometry({...bubble,tail:{...bubble.tail,visible:true}},w,h),tip=geometry.tip;
      next.tail={...bubble.tail,mode:'normalized',x:tip.x/w,y:tip.y/h,side:geometry.side,base:geometry.base,visible:bubble.tail?.visible!==false};
      next.tail[key]=['x','y','base'].includes(key)?value/100:value;
      if(key==='visible')next.tail.visibilityExplicit=true;
      if(key==='side'||key==='base')delete next.tail.anchorT;
    }
  }else if(section==='bubble-node'){
    const points=validBubblePoints(next.points)?next.points:bubbleShapePoints('custom'),point=points[nodeIndex];
    const x=key==='x'?value/100:point.x,y=key==='y'?value/100:point.y;
    next=applyBubbleEdit(next,{type:'point',index:nodeIndex,x:next.x+x*next.w,y:next.y+y*next.h});
    if(!Number.isFinite(next.points?.[nodeIndex]?.[key])||Math.abs(next.points[nodeIndex][key]-value/100)>1e-8)throw new Error('轮廓边线不能交叉，节点不能重叠');
  }else if(key==='shape'){
    next=applyBubbleEdit(next,{type:'shape',shape:value});if(bubble.shape==='none'&&value!=='none'){if(next.fillOpacity===0)next.fillOpacity=1;if(next.outlineWidth===0&&!next.styleTextureId)next.outlineWidth=2.8;}
  }else if(key==='x'||key==='y')next=applyBubbleEdit(next,{type:'move',dx:key==='x'?value-next.x:0,dy:key==='y'?value-next.y:0});
  else{next[key]=value;if(key==='text')saveBubbleTextFlow(next);if(key==='writingMode'&&value==='vertical'&&!next.textBox)next.overflow='expand';}
  if(next.textBox&&(!(next.textBox.w>=1)||!(next.textBox.h>=1)))throw new Error('文字框宽高至少为 1 px');
  const style=normalizeBubbleStyle(next);if(style.fontFamily!==next.fontFamily&&next.fontFamily!==undefined)throw new Error('请选择支持的字体');
  const canonical=canonicalBubbleTail(next);if(canonical)next.tail=canonical;
  return next;
}

