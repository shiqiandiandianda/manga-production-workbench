// Old production lettering stored 'explicit' as an import default. Preserve its
// text/newlines, but let the editable frame wrap it until a user chooses a mode.
export function bubbleLineBreakMode(bubble){return bubble.productionTextId&&bubble.textFlowVersion!==1?'auto':bubble.lineBreakMode==='explicit'?'explicit':'auto';}
export function saveBubbleTextFlow(bubble){if(bubble.productionTextId&&bubble.textFlowVersion!==1){bubble.lineBreakMode=bubbleLineBreakMode(bubble);bubble.textFlowVersion=1;}return bubble;}

const layoutFields=['fontFamily','fontSize','fontWeight','fontStyle','letterSpacing','lineHeight','textAlign','writingMode','textDirection'];
export const bubbleTextLayoutKey=(bubble,style)=>JSON.stringify([String(bubble.text??''),...layoutFields.map(k=>style[k]),bubbleLineBreakMode(bubble)]);
/** Store the rendered rows relative to the independent text frame, not to the contour. */
export function freezeBubbleTextLayout(bubble,layout){
 if(!layout?.textBox||!Array.isArray(layout.lines))return bubble;
 const box=layout.textBox;saveBubbleTextFlow(bubble);bubble.textBox={...box};
 bubble.textLayout={version:1,key:layout.textLayoutStyleKey||bubbleTextLayoutKey(bubble,layout),w:box.w,h:box.h,lineHeight:layout.lineHeight,lines:layout.lines.map(line=>({...line,x:line.x-box.x,y:line.y-box.y,left:line.left-box.x,right:line.right-box.x,glyphs:line.glyphs?.map(g=>({...g,x:g.x-box.x,y:g.y-box.y}))||null}))};return bubble;
}
export function frozenBubbleTextRows(bubble,style,box){
 const saved=bubble.textLayout;if(!saved||saved.version!==1||saved.key!==bubbleTextLayoutKey(bubble,style)||saved.w!==box.w||saved.h!==box.h||!Array.isArray(saved.lines)||saved.lines.length>2000)return null;
 if(saved.lines.map(l=>l.text).join('')!==String(bubble.text??'').replaceAll('\n',''))return null;
 if(saved.lines.some(l=>typeof l.text!=='string'||!Number.isFinite(l.x)||!Number.isFinite(l.y)||l.glyphs?.some(g=>typeof g.text!=='string'||!Number.isFinite(g.x)||!Number.isFinite(g.y))))return null;
 return {box,lineHeight:saved.lineHeight,lines:saved.lines.map(l=>({...l,x:l.x+box.x,y:l.y+box.y,left:l.left+box.x,right:l.right+box.x,glyphs:l.glyphs?.map(g=>({...g,x:g.x+box.x,y:g.y+box.y}))||null})),overflow:false};
}
