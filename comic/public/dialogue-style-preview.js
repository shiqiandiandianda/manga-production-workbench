import {applyProductionStyle,productionStyleKind,PRODUCTION_FONT_FIELDS,productionStyleRequestsFit} from './production-lettering-style.js';
import {fitDialogueObject} from './auto-lettering.js';
import {bubbleLayout,svgBubbleMarkup} from './lettering.js';

/** Render the same resolved style and measured text that will be used on the page. */
export function dialogueStylePreview(context,style,kind,text,{pageWidth=1280,parentWidth=pageWidth,maxHeight=16384,sourceBubble,patch={},protectedWords=[]}={}){
 const bubble=sourceBubble?{...structuredClone(sourceBubble),id:'style-preview',locked:false,text}:{id:'style-preview',type:kind==='thought'?'thought':kind==='speech'?'speech':'caption',productionBoxKind:kind,text,x:0,y:0,w:340,h:180,shape:'oval',visible:true,tail:{visible:['speech','thought'].includes(kind)}};
 // Frame selection must not copy the default font size over a sentence's size.
 const fonts=sourceBubble?Object.fromEntries(PRODUCTION_FONT_FIELDS.filter(k=>Object.hasOwn(patch,k)).map(k=>[k,style[k]])):style;
 applyProductionStyle(bubble,{...fonts,boxes:{[kind]:{styleId:'default',...style.boxes?.[kind]}}});
 const fit=!sourceBubble||productionStyleRequestsFit(patch,kind)||sourceBubble.autoLettering?.mode==='auto';
 const result=fit?fitDialogueObject(context,bubble,{pageWidth,parentWidth,maxHeight,protectedWords}):{status:'fitted',bubble,rows:bubbleLayout(context,bubble).lines.map(l=>l.text)};if(result.status!=='fitted')return {...result,markup:''};
 const fitted=result.bubble;fitted.x=0;fitted.y=0;const layout=bubbleLayout(context,fitted),tip=layout.tail?.tip,left=Math.min(-16,(tip?.x??0)-16),top=Math.min(-16,(tip?.y??0)-16),right=Math.max(fitted.w+16,(tip?.x??0)+16),bottom=Math.max(fitted.h+16,(tip?.y??0)+16);
 return {...result,bubble:fitted,layout,markup:`<svg viewBox="${left} ${top} ${right-left} ${bottom-top}" role="img" aria-label="${productionStyleKind(fitted)} 气泡与文字预览">${svgBubbleMarkup(context,fitted)}</svg>`};
}
