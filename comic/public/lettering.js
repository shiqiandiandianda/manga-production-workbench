import {sfxFontFamily} from './sfx-fonts.js';
import {bubbleLineBreakMode,frozenBubbleTextRows,bubbleTextLayoutKey} from './bubble-text-flow.js';
import {isLibrarySfx,sfxRotation,sfxTransform} from './sfx-library.js';
import {comicPreviewUrl,currentVisualStyle,validAssetContour} from './comic-styles.js';
import {assetUrl} from './asset-url.js';
import {bubbleBoundary,projectPointToBoundary,tailBoundaryAnchors,unionBubbleTail} from './bubble-tail-anchor.js';
import {bubbleParts,outlineWithParts,shapedTailPoints} from './bubble-parts.js';
import {unionBubblePolygons} from './bubble-tail-anchor.js';
import {validBubbleRays,bubbleRaySegments} from './bubble-rays.js';
import {frameLines} from './bubble-frame.js';
export const BUBBLE_TYPES=Object.freeze(['speech','thought','caption','sfx','label','system']);
export const BUBBLE_SHAPES=Object.freeze(['oval','rounded-rect','cloud','burst','custom','asset','none']);
export const FONT_FAMILIES={
  'source-han-sans':'"Source Han Sans SC", "Microsoft YaHei", sans-serif',
  'source-han-serif':'"Source Han Serif SC", "SimSun", serif',
  'system-sans':'"Microsoft YaHei", sans-serif',
  'system-serif':'"SimSun", serif'
};
export const BUBBLE_TEXT_ALIGNS=Object.freeze(['left','center','right']);
export const BUBBLE_TAIL_SIDES=Object.freeze(['bottom','right','top','left']);
const finite=(value,fallback)=>Number.isFinite(value)?value:fallback;
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const color=(value,fallback)=>typeof value==='string'&&/^#[0-9a-f]{6}$/i.test(value)?value:fallback;
const escape=value=>String(value??'').replace(/[&<>"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const noStart=/^[，、。？！：；…‥」』）】〉》〕〗〙〛’”!?.,:;%‰\)\]\}]/u;
const noEnd=/[「『（【〈《〔〖〘〚‘“\(\[\{]$/u;
const segmenter=typeof Intl?.Segmenter==='function'?new Intl.Segmenter('zh',{granularity:'grapheme'}):null;
const graphemes=text=>segmenter?[...segmenter.segment(String(text))].map(part=>part.segment):[...String(text)];

// Punctuation is carried with its neighbour before wrapping. User-entered newlines remain authoritative.
function wrapUnits(text){
  const units=[];
  for(const character of graphemes(text)){
    if(units.length&&(noStart.test(character)||noEnd.test(units.at(-1))))units[units.length-1]+=character;
    else units.push(character);
  }
  if(units.length>1&&noEnd.test(units.at(-1)))units[units.length-2]+=units.pop();
  return units;
}
export function measureLettering(context,text,letterSpacing=0){
  return context.measureText(String(text)).width+Math.max(0,graphemes(text).length-1)*letterSpacing;
}
function wrapRows(context,text,widthAt,letterSpacing=0){
  const lines=[];
  for(const paragraph of String(text??'').split('\n')){
    let line='';
    for(const unit of wrapUnits(paragraph)){
      if(line&&measureLettering(context,line+unit,letterSpacing)>Math.max(1,widthAt(lines.length))){lines.push(line);line='';}
      line+=unit;
    }
    lines.push(line);
  }
  return lines;
}
export function wrapText(context,text,width,{letterSpacing=0}={}){
  return wrapRows(context,text,()=>Math.max(1,finite(width,1)),letterSpacing);
}

// Kept for existing thought layers. New cloud/burst shapes are explicitly chosen presets.
export function thoughtOutlinePoints(){
  return Array.from({length:80},(_,index)=>{
    const angle=-Math.PI/2+index*Math.PI/40,radius=index%2?.92:1;
    return {x:.5+Math.cos(angle)*radius*.5,y:.5+Math.sin(angle)*radius*.5};
  });
}
export function bubbleShapePoints(shape='oval'){
  if(shape==='custom')return [{x:.18,y:0},{x:.82,y:0},{x:1,y:.2},{x:1,y:.8},{x:.82,y:1},{x:.18,y:1},{x:0,y:.8},{x:0,y:.2}];
  if(shape==='rounded-rect'){
    const points=[],radius=.16;
    for(const [x,y,start] of [[1-radius,radius,-Math.PI/2],[1-radius,1-radius,0],[radius,1-radius,Math.PI/2],[radius,radius,Math.PI]])
      for(let step=0;step<=8;step++){const angle=start+step*Math.PI/16;points.push({x:x+radius*Math.cos(angle),y:y+radius*Math.sin(angle)});}
    return points;
  }
  const count=shape==='burst'?40:96;
  return Array.from({length:count},(_,index)=>{
    const angle=-Math.PI/2+index*Math.PI*2/count;
    const radius=shape==='cloud'?.945+.055*Math.cos(angle*12):shape==='burst'?(index%2?.78:1):1;
    return {x:.5+Math.cos(angle)*radius*.5,y:.5+Math.sin(angle)*radius*.5};
  });
}
const cross=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
const onSegment=(a,b,c)=>Math.abs(cross(a,b,c))<1e-9&&c.x>=Math.min(a.x,b.x)-1e-9&&c.x<=Math.max(a.x,b.x)+1e-9&&c.y>=Math.min(a.y,b.y)-1e-9&&c.y<=Math.max(a.y,b.y)+1e-9;
const intersects=(a,b,c,d)=>(cross(a,b,c)*cross(a,b,d)<0&&cross(c,d,a)*cross(c,d,b)<0)||onSegment(a,b,c)||onSegment(a,b,d)||onSegment(c,d,a)||onSegment(c,d,b);
export function validBubblePoints(points){
  if(!Array.isArray(points)||points.length<3||points.length>32||points.some(p=>!p||!Number.isFinite(p.x)||!Number.isFinite(p.y)||p.x<0||p.x>1||p.y<0||p.y>1))return false;
  let area=0;
  for(let i=0;i<points.length;i++){
    const a=points[i],b=points[(i+1)%points.length];
    if(Math.hypot(a.x-b.x,a.y-b.y)<.003)return false;
    area+=a.x*b.y-b.x*a.y;
    for(let j=i+1;j<points.length;j++){
      if(j===i+1||(i===0&&j===points.length-1))continue;
      if(intersects(a,b,points[j],points[(j+1)%points.length]))return false;
    }
  }
  return Math.abs(area)>.006;
}
export function normalizeBubbleStyle(bubble={}){
  const type=BUBBLE_TYPES.includes(bubble.type)?bubble.type:'speech';
  const unboxed=type==='sfx'||type==='label';
  const shape=BUBBLE_SHAPES.includes(bubble.shape)?bubble.shape:type==='speech'?'oval':type==='thought'?'legacy-thought':unboxed?'none':'rect';
  const fontFamily=Object.hasOwn(FONT_FAMILIES,bubble.fontFamily)?bubble.fontFamily:'source-han-sans';
  const fontWeight=Number.isInteger(bubble.fontWeight)&&bubble.fontWeight>=100&&bubble.fontWeight<=900&&bubble.fontWeight%100===0?bubble.fontWeight:type==='sfx'?700:400;
  return {
    type,shape,unboxed,legacyShape:bubble.shape===undefined,
    fontSize:clamp(finite(bubble.fontSize,28),10,2048),fontFamily,fontWeight,fontStyle:isLibrarySfx(bubble)?(bubble.fontStyle==='normal'?'normal':'italic'):type==='sfx'?'italic':'normal',
    textColor:color(bubble.textColor,type==='system'?'#f4d77a':type==='sfx'?'#000000':'#171b20'),
    lineHeight:clamp(finite(bubble.lineHeight,1.35),.8,3),letterSpacing:clamp(finite(bubble.letterSpacing,0),-128,256),
    textAlign:BUBBLE_TEXT_ALIGNS.includes(bubble.textAlign)?bubble.textAlign:'center',padding:clamp(finite(bubble.padding,unboxed?8:16),0,4096),
    outlineWidth:clamp(finite(bubble.outlineWidth,type==='thought'?1.4:2),0,256),outlineColor:color(bubble.outlineColor,type==='system'?'#e8c564':'#242830'),
    fillColor:color(bubble.fillColor,type==='system'?'#000000':'#ffffff'),fillOpacity:clamp(finite(bubble.fillOpacity,type==='system'?.78:1),0,1),
    writingMode:bubble.writingMode==='vertical'?'vertical':'horizontal',textDirection:bubble.textDirection==='rtl'?'rtl':'ltr',
    overflow:bubble.overflow==='expand'?'expand':'visible'
  };
}
export function bubbleTextBox(bubble,style=normalizeBubbleStyle(bubble),w=finite(bubble.w,100),h=finite(bubble.h,60)){
  const box=bubble.textBox;
  const inset=bubble.shape==='asset'?bubble.assetInsets:null;
  if(!box&&inset)return {x:w*inset.left,y:h*inset.top,w:Math.max(1,w*(1-inset.left-inset.right)),h:Math.max(1,h*(1-inset.top-inset.bottom))};
  return box&&[box.x,box.y,box.w,box.h].every(Number.isFinite)&&box.w>0&&box.h>0?{x:box.x,y:box.y,w:box.w,h:box.h}:
    {x:style.padding,y:style.padding,w:Math.max(1,w-style.padding*2),h:Math.max(1,h-style.padding*2)};
}
export function bubbleTailGeometry(bubble,w=Math.max(1,finite(bubble.w,100)),h=Math.max(1,finite(bubble.h,60))){
  if(bubble.tail?.visible===false||(!bubble.tail&&bubble.type!=='speech'))return null;
  const tail=bubble.tail||{},side=BUBBLE_TAIL_SIDES.includes(tail.side)?tail.side:'bottom',base=clamp(finite(tail.base,.54),.1,.9);
  const tip=Number.isFinite(tail.x)&&Number.isFinite(tail.y)?(tail.mode==='normalized'?{x:tail.x*w,y:tail.y*h}:{x:tail.x-finite(bubble.x,0),y:tail.y-finite(bubble.y,0)}):{x:w*.57,y:h+30};
  const legacy=!bubble.tail&&bubble.shape===undefined;
  const anchor=(amount)=>side==='bottom'?{x:w*amount,y:h}:side==='top'?{x:w*amount,y:0}:side==='right'?{x:w,y:h*amount}:{x:0,y:h*amount};
  const geometry={tip,side,base,legacy,anchors:legacy?[{x:w*.48,y:h*.96},{x:w*.6,y:h*.93}]:[anchor(base-.06),anchor(base+.06)]},outline=shapeOutline(normalizeBubbleStyle(bubble),bubble,w,h),path=bubbleBoundary(outline);
  if(!path)return geometry;
  const axis=side==='top'||side==='bottom'?w:h,width=clamp(finite(tail.width,.12),.01,.8);
  if(Number.isFinite(tail.anchorT)){const root=tailBoundaryAnchors(outline,tail.anchorT,axis*width/2);return {...geometry,...root,width,legacy:false,anchored:true};}
  const actual=legacy?geometry.anchors:geometry.anchors.map(point=>boundaryAnchor(outline,point,side).point),middle={x:(actual[0].x+actual[1].x)/2,y:(actual[0].y+actual[1].y)/2},root=projectPointToBoundary(path,middle);
  if(Number.isFinite(tail.width))return {...geometry,...tailBoundaryAnchors(outline,root.t,axis*width/2),width,legacy:false,anchored:true};
  return {...geometry,...(bubble.assetTailKind?{anchors:actual}:{}),width,anchor:root.point,anchorT:root.t};
}
function shapeOutline(style,bubble,w,h){
  if(style.shape==='none')return null;
  if(style.shape==='asset'&&validAssetContour(bubble.assetContour))return outlineWithParts(bubble.assetContour.map(point=>({x:point.x*w,y:point.y*h})),bubble,w,h);
  const points=style.shape==='custom'?(validBubblePoints(bubble.points)?bubble.points:bubbleShapePoints('custom')):
    style.shape==='legacy-thought'?thoughtOutlinePoints():style.shape==='rect'?[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}]:bubbleShapePoints(style.shape);
  return points.map(p=>({x:p.x*w,y:p.y*h}));
}
export function bubbleOutlinePoints(bubble,w=finite(bubble.w,100),h=finite(bubble.h,60)){return shapeOutline(normalizeBubbleStyle(bubble),bubble,Math.max(1,w),Math.max(1,h));}
function boundaryAnchor(points,target,side){
  const vertical=side==='top'||side==='bottom',axis=vertical?'x':'y',outer=vertical?'y':'x',maximum=side==='bottom'||side==='right';
  let best=null;
  for(let index=0;index<points.length;index++){
    const a=points[index],b=points[(index+1)%points.length],difference=b[axis]-a[axis];
    if(Math.abs(difference)<1e-9)continue;
    const amount=(target[axis]-a[axis])/difference;if(amount<0||amount>1)continue;
    const point={x:a.x+(b.x-a.x)*amount,y:a.y+(b.y-a.y)*amount};
    if(!best||(maximum?point[outer]>best.point[outer]:point[outer]<best.point[outer]))best={point,edge:index,amount};
  }
  if(best)return best;
  const index=points.reduce((best,p,index)=>Math.hypot(p.x-target.x,p.y-target.y)<Math.hypot(points[best].x-target.x,points[best].y-target.y)?index:best,0);
  return {point:points[index],edge:index,amount:0};
}
function outlineWithTail(points,tail){
  if(points&&tail?.anchored)return unionBubbleTail(points,tail.anchors,tail.tip);
  if(!points||!tail||tail.legacy)return points;
  const anchors=tail.anchors.map(target=>boundaryAnchor(points,target,tail.side));
  tail.anchors=anchors.map(anchor=>anchor.point);
  const vertices=points.map(point=>({point,markers:[]})),insertions=points.map(()=>[]);
  anchors.forEach((anchor,marker)=>{
    if(anchor.amount<=1e-9)vertices[anchor.edge].markers.push(marker);
    else if(anchor.amount>=1-1e-9)vertices[(anchor.edge+1)%points.length].markers.push(marker);
    else insertions[anchor.edge].push({...anchor,markers:[marker]});
  });
  const entries=vertices.flatMap((vertex,index)=>[vertex,...insertions[index].sort((a,b)=>a.amount-b.amount)]);
  let a=entries.findIndex(entry=>entry.markers.includes(0)),b=entries.findIndex(entry=>entry.markers.includes(1));
  if(a===b)return points;
  if((b-a+entries.length)%entries.length>entries.length/2)[a,b]=[b,a];
  const rotated=entries.slice(a).concat(entries.slice(0,a)),end=(b-a+entries.length)%entries.length;
  return [rotated[0].point,tail.tip,...rotated.slice(end).map(entry=>entry.point)];
}
function polygonInterval(points,y,center){
  const xs=[];
  for(let i=0;i<points.length;i++){
    const a=points[i],b=points[(i+1)%points.length];
    if((a.y<=y&&b.y>y)||(b.y<=y&&a.y>y))xs.push(a.x+(y-a.y)*(b.x-a.x)/(b.y-a.y));
  }
  xs.sort((a,b)=>a-b);
  let best=null;
  for(let i=0;i+1<xs.length;i+=2){const interval={left:xs[i],right:xs[i+1]};if(interval.left<=center&&interval.right>=center)return interval;if(!best||interval.right-interval.left>best.right-best.left)best=interval;}
  return best;
}
function safeInterval(style,outline,box,w,h,y,glyphHeight){
  let left=box.x,right=box.x+box.w;
  if(style.shape==='none')return {left,right,width:Math.max(1,right-left)};
  const inset=Math.max(style.outlineWidth/2+2,style.padding*.55);
  for(const rowY of [y-glyphHeight/2,y,y+glyphHeight/2]){
    let interval;
    if(style.shape==='oval'){
      const rx=Math.max(1,w/2-inset),ry=Math.max(1,h/2-inset),normal=(rowY-h/2)/ry;
      if(Math.abs(normal)>=1)return {left:w/2,right:w/2,width:1,unsafe:true};
      const half=rx*Math.sqrt(1-normal*normal);interval={left:w/2-half,right:w/2+half};
    }else{
      interval=polygonInterval(outline,rowY,box.x+box.w/2);
      if(!interval)return {left:w/2,right:w/2,width:1,unsafe:true};
      interval={left:interval.left+inset,right:interval.right-inset};
    }
    left=Math.max(left,interval.left);right=Math.min(right,interval.right);
  }
  return {left,right,width:Math.max(1,right-left),unsafe:right<=left};
}
const verticalPunctuation={'（':'︵','）':'︶','「':'﹁','」':'﹂','『':'﹃','』':'﹄','【':'︻','】':'︼','《':'︽','》':'︾','，':'︐','。':'︒','！':'︕','？':'︖','：':'︓','；':'︔'};
function positionVertical(context,bubble,style,w,h){const box=bubbleTextBox(bubble,style,w,h),outline=shapeOutline(style,bubble,w,h),transposed=outline?.map(p=>({x:p.y,y:p.x})),tbox={x:box.y,y:box.x,w:box.h,h:box.w},cell=Math.max(style.fontSize*.25,style.fontSize+style.letterSpacing),columnStep=style.fontSize*style.lineHeight,glyphWidth=style.fontSize*1.05;
 const short=!bubble.textBox&&graphemes(String(bubble.text).replaceAll('\n','')).length<=4;
 const wrap=heightAt=>{const out=[];for(const paragraph of String(bubble.text??'').split('\n')){let line='';for(const unit of wrapUnits(paragraph)){if(line&&!short&&(graphemes(line+unit).length-1)*cell+style.fontSize>heightAt(out.length)){out.push(line);line='';}line+=unit;}out.push(line);}return out;};
 let textLines=wrap(()=>Math.max(1,box.h)),fits=false;const maxCols=Math.max(1,Math.floor((box.w-glyphWidth)/columnStep)+1),areaAt=(index,count)=>{const logical=style.textDirection==='rtl'?count-1-index:index,x=box.x+box.w/2+(logical-(count-1)/2)*columnStep;return {x,area:safeInterval(style,transposed,tbox,h,w,x,glyphWidth)};};
 for(let count=textLines.length;count<=Math.min(maxCols,graphemes(bubble.text??'').length+1);count++){const attempt=wrap(index=>areaAt(index,count).area.width);if(attempt.length!==count)continue;if(attempt.every((text,i)=>{const a=areaAt(i,count);return !a.area.unsafe&&(graphemes(text).length-1)*cell+style.fontSize<=a.area.width+.01;})){textLines=attempt;fits=true;break;}}
 const lines=textLines.map((text,i)=>{const {x,area}=areaAt(i,textLines.length),chars=graphemes(text),height=Math.max(style.fontSize,(chars.length-1)*cell+style.fontSize),top=fits?area.left:box.y,bottom=fits?area.right:box.y+box.h,start=style.textAlign==='left'?top+style.fontSize/2:style.textAlign==='right'?bottom-height+style.fontSize/2:(top+bottom-height+style.fontSize)/2;return {text,x,y:start,width:style.fontSize,availableWidth:area.width,left:top,right:bottom,overflow:!fits||x-glyphWidth/2<box.x||x+glyphWidth/2>box.x+box.w,glyphs:chars.map((char,j)=>({text:verticalPunctuation[char]||char,x,y:start+j*cell}))};});return {box,outline,lines,overflow:!fits||lines.some(l=>l.overflow),lineHeight:columnStep};}
function positionRows(context,bubble,style,w,h){
  const currentBox=bubbleTextBox(bubble,style,w,h),currentOutline=shapeOutline(style,bubble,w,h),frozen=frozenBubbleTextRows(bubble,style,currentBox);
  if(frozen)return {...frozen,outline:currentOutline};
  if(bubble.textFrameLayout&&style.shape!=='none')return {...positionRows(context,{...bubble,textFrameLayout:false},{...style,shape:'none'},w,h),outline:currentOutline};
  if(style.writingMode==='vertical')return positionVertical(context,bubble,style,w,h);
  const box=bubbleTextBox(bubble,style,w,h),outline=shapeOutline(style,bubble,w,h),step=style.fontSize*style.lineHeight,glyphHeight=style.fontSize*1.05;
  if(bubbleLineBreakMode(bubble)==='explicit'){
    const rows=String(bubble.text??'').split('\n'),lines=rows.map((text,index)=>{const width=measureLettering(context,text,style.letterSpacing),y=box.y+box.h/2+(index-(rows.length-1)/2)*step,x=style.textAlign==='left'?box.x:style.textAlign==='right'?box.x+box.w:box.x+box.w/2;return {text,x,y,width,left:box.x,right:box.x+box.w,availableWidth:box.w,overflow:width>box.w+.01||y-glyphHeight/2<box.y||y+glyphHeight/2>box.y+box.h};});
    return {box,outline,lines,overflow:lines.some(line=>line.overflow),lineHeight:step};
  }
  const widest=Math.max(1,Math.min(box.w,style.shape==='none'?box.w:w-Math.max(style.padding*2,style.outlineWidth+4)));
  const rectangular=wrapRows(context,bubble.text,()=>widest,style.letterSpacing);
  const maxRows=Math.max(1,Math.floor(Math.max(0,box.h-glyphHeight)/step)+1);
  let textLines=rectangular,fits=false;
  // Testing the available line count avoids oscillating between a wide middle and narrow oval edges.
  for(let count=rectangular.length;count<=Math.min(maxRows,graphemes(bubble.text??'').length+String(bubble.text??'').split('\n').length);count++){
    const yAt=index=>box.y+box.h/2+(index-(count-1)/2)*step;
    const attempt=wrapRows(context,bubble.text,index=>safeInterval(style,outline,box,w,h,yAt(index),glyphHeight).width,style.letterSpacing);
    if(attempt.length!==count)continue;
    if(attempt.every((text,index)=>{const area=safeInterval(style,outline,box,w,h,yAt(index),glyphHeight);return !area.unsafe&&measureLettering(context,text,style.letterSpacing)<=area.width+.01;})){textLines=attempt;fits=true;break;}
  }
  const lines=textLines.map((text,index)=>{
    const y=box.y+box.h/2+(index-(textLines.length-1)/2)*step,area=safeInterval(style,outline,box,w,h,y,glyphHeight);
    const textWidth=measureLettering(context,text,style.letterSpacing);
    // On overflow use the full text box, so every glyph remains visible and selectable.
    const left=fits?area.left:box.x,right=fits?area.right:box.x+box.w;
    const x=style.textAlign==='left'?left:style.textAlign==='right'?right:(left+right)/2;
    const glyphs=style.textDirection==='rtl'?graphemes(text).map((char,i,chars)=>{const start=style.textAlign==='left'?x:style.textAlign==='right'?x-textWidth:x-textWidth/2,prefix=chars.slice(0,i).join('');return {text:char,x:start+textWidth-context.measureText(prefix).width-i*style.letterSpacing-context.measureText(char).width/2,y};}):null;
    return {text,x,y,glyphs,width:textWidth,availableWidth:area.width,left,right,overflow:area.unsafe||textWidth>area.width+.01||y-glyphHeight/2<box.y||y+glyphHeight/2>box.y+box.h};
  });
  return {box,outline,lines,overflow:!fits||lines.some(line=>line.overflow),lineHeight:step};
}
export function fitDialogueBubble(context,bubble,{maxWidth=640}={}){
 const next=structuredClone(bubble),style=normalizeBubbleStyle(next),ratio=1.45;
 delete next.textBox;next.overflow='visible';
 const chars=graphemes(String(next.text||'').replaceAll('\n','')).length,area=Math.max(4,chars)*style.fontSize**2*style.lineHeight/.58;
 next.w=Math.ceil(Math.min(maxWidth,Math.max(style.fontSize*(chars>12?9.5:4)+style.padding*2,Math.sqrt(area*ratio))));
 next.h=Math.ceil(Math.max(style.fontSize*2+style.padding*2,next.w/ratio));
 for(let i=0;i<80;i++){const layout=bubbleLayout(context,next);if(!layout.overflow)break;next.h=Math.ceil(next.h+style.fontSize*.5);}
 return next;
}
export function bubbleLayout(context,bubble){
  const style=normalizeBubbleStyle(bubble),originalW=Math.max(1,finite(bubble.w,100)),originalH=Math.max(1,finite(bubble.h,60));
  const font=(style.fontStyle==='italic'?'italic ':'')+style.fontWeight+' '+style.fontSize+'px '+sfxFontFamily(bubble,FONT_FAMILIES[style.fontFamily]);
  context.font=font;if('letterSpacing' in context)context.letterSpacing='0px';
  if(currentVisualStyle(bubble))return {...style,fontFamilyCSS:sfxFontFamily(bubble,FONT_FAMILIES[style.fontFamily]),type:'sfx',shape:'none',x:finite(bubble.x,0),y:finite(bubble.y,0),w:originalW,h:originalH,font,fontSize:style.fontSize,color:style.textColor,textBox:{x:0,y:0,w:originalW,h:originalH},lines:[],tail:null,drawOutline:null,suggestedSize:{w:originalW,h:originalH},overflow:false,expanded:false};
  let w=originalW,h=originalH,positioned=positionRows(context,bubble,style,w,h),suggestedSize={w,h};
  if(positioned.overflow&&!bubble.textBox){
    let fit=positioned,fitW=w,fitH=h;
    // Enlargement is bounded and pure: saved geometry is only changed by an explicit editor commit.
    for(let attempt=0;attempt<24&&fit.overflow;attempt++){
      fitW=Math.max(fitW+style.fontSize*.6,fitW*1.12);if(isLibrarySfx(bubble))fitW=Math.min(2560,fitW);fitH=Math.max(fitH+style.fontSize*.4,fitH*1.12);
      fit=positionRows(context,bubble,style,fitW,fitH);
    }
    suggestedSize={w:Math.ceil(fitW),h:Math.ceil(fitH)};
    if(style.overflow==='expand'&&!fit.overflow){w=suggestedSize.w;h=suggestedSize.h;positioned=positionRows(context,bubble,style,w,h);}
  }
  const tail=bubbleTailGeometry(bubble,w,h);
  return {...style,fontFamilyCSS:sfxFontFamily(bubble,FONT_FAMILIES[style.fontFamily]),type:style.type,x:finite(bubble.x,0),y:finite(bubble.y,0),w,h,fontSize:style.fontSize,font,color:style.textColor,
    ...positioned,textLayoutStyleKey:bubbleTextLayoutKey(bubble,style),textBox:positioned.box,clip:{x:0,y:0,w,h},tail,drawOutline:tail&&bubble.shape==='asset'&&['curved','lightning'].includes(bubble.assetTailKind)?unionBubblePolygons(positioned.outline,shapedTailPoints(tail,bubble.assetTailKind)):outlineWithTail(positioned.outline,tail),suggestedSize,
    expanded:w!==originalW||h!==originalH,textStroke:style.type==='sfx'?(isLibrarySfx(bubble)?style.outlineColor:'#ffffff'):null,textStrokeWidth:style.type==='sfx'?(isLibrarySfx(bubble)?style.outlineWidth:Math.max(2,Math.min(6,style.fontSize*.1))):0,
    thoughtPoints:style.shape==='legacy-thought'?positioned.outline:null};
}
function polygon(context,points){context.beginPath();for(const outline of points.components||[points]){outline.forEach((p,index)=>index?context.lineTo(p.x,p.y):context.moveTo(p.x,p.y));context.closePath();}}
function fillAndStroke(context,layout,fill=()=>context.fill(),stroke=()=>context.stroke()){
  context.save();context.globalAlpha=finite(context.globalAlpha,1)*layout.fillOpacity;context.fillStyle=layout.fillColor;fill();context.restore();
  if(layout.outlineWidth>0){context.strokeStyle=layout.outlineColor;context.lineWidth=layout.outlineWidth;context.lineJoin='round';stroke();}
}
function paintTextLine(context,layout,line){
  if(line.glyphs){context.save();context.textAlign='center';for(const glyph of line.glyphs){if(layout.textStroke){context.strokeStyle=layout.textStroke;context.lineWidth=layout.textStrokeWidth;context.strokeText(glyph.text,glyph.x,glyph.y);}context.fillText(glyph.text,glyph.x,glyph.y);}context.restore();return;}

  if(!layout.letterSpacing){
    if(layout.textStroke){context.strokeStyle=layout.textStroke;context.lineWidth=layout.textStrokeWidth;context.lineJoin='round';context.strokeText(line.text,line.x,line.y);}
    context.fillText(line.text,line.x,line.y);return;
  }
  const start=layout.textAlign==='left'?line.x:layout.textAlign==='right'?line.x-line.width:line.x-line.width/2,characters=graphemes(line.text);
  context.save();context.textAlign='left';let prefix='';
  characters.forEach((character,index)=>{const x=start+context.measureText(prefix).width+index*layout.letterSpacing;if(layout.textStroke){context.strokeStyle=layout.textStroke;context.lineWidth=layout.textStrokeWidth;context.lineJoin='round';context.strokeText(character,x,line.y);}context.fillText(character,x,line.y);prefix+=character;});
  context.restore();
}
export function paintBubble(context,bubble,{textureImage,visualImage}={}){
  if(!bubble.visible)return;
  context.save();const layout=bubbleLayout(context,bubble);context.translate(layout.x,layout.y);
  if(isLibrarySfx(bubble)){context.translate(layout.w/2,layout.h/2);context.rotate(sfxRotation(bubble)*Math.PI/180);context.translate(-layout.w/2,-layout.h/2);}
  if(layout.shape==='rect'&&!bubble.tail){
    fillAndStroke(context,layout,()=>context.fillRect(0,0,layout.w,layout.h),()=>context.strokeRect(0,0,layout.w,layout.h));
    if(layout.type==='system'&&layout.legacyShape){context.strokeStyle='#9a3333';context.lineWidth=1;context.strokeRect(4,4,Math.max(0,layout.w-8),Math.max(0,layout.h-8));}
  }else if(layout.shape==='oval'&&layout.legacyShape&&(!bubble.tail||layout.tail?.legacy)){
    context.beginPath();context.ellipse(layout.w/2,layout.h/2,layout.w/2,layout.h/2,0,0,Math.PI*2);fillAndStroke(context,layout);
    if(layout.tail){context.beginPath();context.moveTo(layout.tail.anchors[0].x,layout.tail.anchors[0].y);context.lineTo(layout.tail.tip.x,layout.tail.tip.y);context.lineTo(layout.tail.anchors[1].x,layout.tail.anchors[1].y);fillAndStroke(context,layout);}
  }else if(layout.drawOutline){polygon(context,layout.drawOutline);fillAndStroke(context,bubble.shape==='asset'&&validBubbleRays(bubble.assetRays)?{...layout,outlineWidth:0}:layout);}
  const rays=bubbleRaySegments(bubble,layout.drawOutline,layout.w,layout.h);
  if(rays.length&&layout.outlineWidth>0){context.save();context.beginPath();for(const ray of rays){context.moveTo(ray.inner.x,ray.inner.y);context.lineTo(ray.outer.x,ray.outer.y);}context.strokeStyle=layout.outlineColor;context.lineWidth=layout.outlineWidth*bubble.assetRays.strokeScale;context.lineCap='round';context.stroke();context.restore();}
  for(const line of frameLines(bubble,layout.w,layout.h)){context.save();context.beginPath();line.points.forEach((p,i)=>i?context.lineTo(p.x,p.y):context.moveTo(p.x,p.y));if(line.closed)context.closePath();context.strokeStyle=layout.outlineColor;context.lineWidth=layout.outlineWidth*line.strokeScale;context.lineJoin='round';context.lineCap='round';if(layout.outlineWidth>0)context.stroke();context.restore();}
  if(visualImage&&currentVisualStyle(bubble)){context.drawImage(visualImage,0,0,layout.w,layout.h);context.restore();return layout;}
  if(textureImage)context.drawImage(textureImage,0,0,layout.w,layout.h);
  context.font=layout.font;context.textAlign=layout.textAlign;context.textBaseline='middle';context.fillStyle=layout.color;
  if(isLibrarySfx(bubble)&&(bubble.shadowOffsetX||bubble.shadowOffsetY)){context.save();context.translate(clamp(finite(bubble.shadowOffsetX,0),-256,256),clamp(finite(bubble.shadowOffsetY,0),-256,256));const shade=color(bubble.shadowColor,'#171b20');context.fillStyle=shade;for(const line of layout.lines)paintTextLine(context,{...layout,textStroke:shade},line);context.restore();}
  for(const line of layout.lines)paintTextLine(context,layout,line);
  context.restore();return layout;
}
function svgOutline(layout,bubble){
  if(layout.shape==='none')return '';
  const rays=bubbleRaySegments(bubble,layout.drawOutline,layout.w,layout.h);
  if(rays.length){const paths=layout.drawOutline.components||[layout.drawOutline];return '<path d="'+paths.map(points=>'M '+points.map(p=>p.x+' '+p.y).join(' L ')+' Z').join(' ')+'" fill="'+layout.fillColor+'" fill-opacity="'+layout.fillOpacity+'" stroke="none"/><path data-thought-rays="'+rays.length+'" d="'+rays.map(r=>'M '+r.inner.x+' '+r.inner.y+' L '+r.outer.x+' '+r.outer.y).join(' ')+'" fill="none" stroke="'+layout.outlineColor+'" stroke-width="'+layout.outlineWidth*bubble.assetRays.strokeScale+'" stroke-linecap="round"/>';}
  const style='fill="'+layout.fillColor+'" fill-opacity="'+layout.fillOpacity+'" stroke="'+layout.outlineColor+'" stroke-width="'+layout.outlineWidth+'" stroke-linejoin="round"';
  if(layout.shape==='rect'&&!bubble.tail)return '<rect width="'+layout.w+'" height="'+layout.h+'" '+style+'/>'+(layout.type==='system'&&layout.legacyShape?'<rect x="4" y="4" width="'+Math.max(0,layout.w-8)+'" height="'+Math.max(0,layout.h-8)+'" fill="none" stroke="#9a3333" stroke-width="1"/>':'');
  if(layout.shape==='oval'&&layout.legacyShape&&(!bubble.tail||layout.tail?.legacy))return '<ellipse cx="'+layout.w/2+'" cy="'+layout.h/2+'" rx="'+layout.w/2+'" ry="'+layout.h/2+'" '+style+'/>'+(layout.tail?'<path d="M '+layout.tail.anchors[0].x+' '+layout.tail.anchors[0].y+' L '+layout.tail.tip.x+' '+layout.tail.tip.y+' L '+layout.tail.anchors[1].x+' '+layout.tail.anchors[1].y+'" '+style+'/>':'');
  if(layout.drawOutline.components)return '<path d="'+layout.drawOutline.components.map(points=>'M '+points.map(p=>p.x+' '+p.y).join(' L ')+' Z').join(' ')+'" '+style+'/>';
  return '<polygon points="'+layout.drawOutline.map(p=>p.x+','+p.y).join(' ')+'" '+style+'/>';
}
function svgHandles(layout,bubble,zoom){
  const z=Math.max(.01,finite(zoom,1)),radius=5/z,stroke=1.5/z,box=layout.textBox;
  if(isLibrarySfx(bubble))return '<rect x="-3" y="-3" width="'+(layout.w+6)+'" height="'+(layout.h+6)+'" fill="none" stroke="#48a4ef" stroke-width="'+stroke+'" pointer-events="none"/><line x1="'+layout.w/2+'" y1="0" x2="'+layout.w/2+'" y2="'+(-28/z)+'" stroke="#48a4ef" stroke-width="'+stroke+'" pointer-events="none"/>'+[['sfx-scale',layout.w,layout.h],['sfx-rotate',layout.w/2,-28/z]].map(([name,x,y])=>'<circle data-bubble-handle="'+name+'" cx="'+x+'" cy="'+y+'" r="'+(7/z)+'" fill="white" stroke="#1789db" stroke-width="'+stroke+'" style="cursor:'+ (name==='sfx-scale'?'nwse-resize':'grab')+'"><title>'+ (name==='sfx-scale'?'缩放特效文字':'旋转特效文字')+'</title></circle>').join('');
  const handle=(name,x,y,extra='')=>'<circle data-bubble-handle="'+name+'" '+extra+' cx="'+x+'" cy="'+y+'" r="'+12/z+'" fill="transparent" pointer-events="all" style="cursor:'+(name==='tail-anchor'?'grab':'move')+'"><title>'+ (name==='tail-anchor'?'沿气泡外边缘滑动尾巴根部':name==='tail-width'?'调整尾巴两个连接点的间距':name==='part-move'?'独立移动圆框':name==='part-resize'?'独立调整圆框大小':name==='tail'?'拖动尾尖':name==='resize'?'调整气泡大小':name==='text-move'?'移动文字框':name==='text-resize'?'调整文字框大小':'编辑轮廓节点')+'</title></circle><circle cx="'+x+'" cy="'+y+'" r="'+radius+'" fill="'+(name==='tail-anchor'?'#ffd681':name==='tail-width'?'#ffe3d6':'#ffffff')+'" stroke="'+(name==='tail-anchor'?'#bc7b17':name==='tail-width'?'#d1662a':'#1789db')+'" stroke-width="'+stroke+'" pointer-events="none"/>';
  if(layout.shape==='none')return '<rect data-text-selection="true" x="'+box.x+'" y="'+box.y+'" width="'+box.w+'" height="'+box.h+'" fill="none" stroke="'+(layout.overflow?'#dc5b32':'#1789db')+'" stroke-dasharray="'+5/z+' '+3/z+'" stroke-width="'+stroke+'" pointer-events="none"/>'+handle('text-move',box.x,box.y)+handle('text-resize',box.x+box.w,box.y+box.h);
  return '<rect x="-3" y="-3" width="'+(layout.w+6)+'" height="'+(layout.h+6)+'" fill="none" stroke="#48a4ef" stroke-width="'+stroke+'" pointer-events="none"/>'+
    '<rect data-bubble-handle="text-move" x="'+box.x+'" y="'+box.y+'" width="'+box.w+'" height="'+box.h+'" fill="transparent" stroke="'+(layout.overflow?'#dc5b32':'#1789db')+'" stroke-dasharray="'+5/z+' '+3/z+'" stroke-width="'+stroke+'" pointer-events="all" style="cursor:move"/>'+
    handle('resize',layout.w,layout.h)+handle('text-move',box.x,box.y)+handle('text-resize',box.x+box.w,box.y+box.h)+
    (layout.tail?handle('tail',layout.tail.tip.x,layout.tail.tip.y):'')+
    (layout.shape==='custom'?(validBubblePoints(bubble.points)?bubble.points:bubbleShapePoints('custom')).map((p,index)=>handle('point',p.x*layout.w,p.y*layout.h,'data-bubble-point="'+index+'"')).join(''):'')+
    (layout.tail?.anchor?handle('tail-anchor',layout.tail.anchor.x,layout.tail.anchor.y,'data-bubble-anchor-t="'+layout.tail.anchorT+'"'):'')+
    (layout.tail?.anchor?layout.tail.anchors.map((p,i)=>handle('tail-width',p.x,p.y,'data-bubble-point="'+i+'"')).join(''):'')+
    bubbleParts(bubble).map((p,index)=>'<g data-bubble-part="'+index+'"><rect x="'+p.x*layout.w+'" y="'+p.y*layout.h+'" width="'+p.w*layout.w+'" height="'+p.h*layout.h+'" fill="none" stroke="#9464d4" stroke-width="'+stroke+'" stroke-dasharray="'+5/z+' '+3/z+'" pointer-events="none"/>'+handle('part-move',p.x*layout.w,p.y*layout.h,'data-bubble-point="'+index+'"')+handle('part-resize',(p.x+p.w)*layout.w,(p.y+p.h)*layout.h,'data-bubble-point="'+index+'"')+'<text x="'+p.x*layout.w+'" y="'+(p.y*layout.h-10/z)+'" font-size="'+12/z+'" fill="#7a42ba" pointer-events="none">'+escape(p.label)+' · 移动 / 缩放</text></g>').join('');
}
export function svgBubbleMarkup(context,bubble,{selected=false,zoom=1}={}){
  if(!bubble.visible)return '';
  const layout=bubbleLayout(context,bubble),anchor=layout.textAlign==='left'?'start':layout.textAlign==='right'?'end':'middle';
  const textStyle='text-anchor="'+anchor+'" dominant-baseline="middle" fill="'+layout.color+'" font-family="'+escape(layout.fontFamilyCSS)+'" font-size="'+layout.fontSize+'" font-weight="'+layout.fontWeight+'" letter-spacing="'+layout.letterSpacing+'"'+(layout.fontStyle==='italic'?' font-style="italic"':'')+(layout.textStroke?' stroke="'+layout.textStroke+'" stroke-width="'+layout.textStrokeWidth+'" stroke-linejoin="round" paint-order="stroke fill"':'')+' pointer-events="none"';
  let text='<svg x="0" y="0" width="'+layout.w+'" height="'+layout.h+'" overflow="visible" pointer-events="none"><text '+textStyle+'>'+layout.lines.map(line=>line.glyphs?line.glyphs.map(g=>'<tspan text-anchor="middle" letter-spacing="0" x="'+g.x+'" y="'+g.y+'">'+escape(g.text)+'</tspan>').join(''):'<tspan x="'+line.x+'" y="'+line.y+'">'+escape(line.text)+'</tspan>').join('')+'</text></svg>';
  if(isLibrarySfx(bubble)&&(bubble.shadowOffsetX||bubble.shadowOffsetY)){const shade=color(bubble.shadowColor,'#171b20'),shadowText=text.replace('fill="'+layout.color+'"','fill="'+shade+'"').replace('stroke="'+layout.textStroke+'"','stroke="'+shade+'"');text='<g transform="translate('+clamp(finite(bubble.shadowOffsetX,0),-256,256)+' '+clamp(finite(bubble.shadowOffsetY,0),-256,256)+')">'+shadowText+'</g>'+text;}
  const hit='<rect width="'+layout.w+'" height="'+layout.h+'" fill="transparent" pointer-events="all"/>';
  const image=(source)=>'<image href="'+escape(source)+'" width="'+layout.w+'" height="'+layout.h+'" preserveAspectRatio="none" pointer-events="none"/>';
  const visual=currentVisualStyle(bubble),texture=bubble.styleTextureId?image(bubble.styleTextureAssetId?assetUrl(bubble.styleTextureAssetId):comicPreviewUrl(bubble.styleTextureId)):'';
  const frame=frameLines(bubble,layout.w,layout.h).map(line=>'<path data-frame-accent="true" d="M '+line.points.map(p=>p.x+' '+p.y).join(' L ')+(line.closed?' Z':'')+'" fill="none" stroke="'+layout.outlineColor+'" stroke-width="'+layout.outlineWidth*line.strokeScale+'" stroke-linecap="round" stroke-linejoin="round"/>').join('');
  const artwork=visual?image(bubble.visualAssetId?assetUrl(bubble.visualAssetId):comicPreviewUrl(visual)):svgOutline(layout,bubble)+frame+texture+text;
  return '<g data-bubble="'+escape(bubble.id)+'" data-overflow="'+layout.overflow+'" data-render-w="'+layout.w+'" data-render-h="'+layout.h+'" transform="translate('+layout.x+' '+layout.y+')'+sfxTransform(bubble,layout.w,layout.h)+'">'+(layout.overflow?'<title>文字超出气泡安全区域：请扩大气泡、调整文字框或开启自动扩泡。</title>':'')+hit+artwork+(selected&&!bubble.locked?svgHandles(layout,bubble,zoom):'')+'</g>';
}



// Editor controls are outside the page artwork clip, so tails and nodes remain reachable.
export function svgBubbleSelectionMarkup(context,bubble,{zoom=1}={}){
  if(!bubble.visible||bubble.locked)return '';
  const layout=bubbleLayout(context,bubble);
  return '<g data-bubble="'+escape(bubble.id)+'" data-render-w="'+layout.w+'" data-render-h="'+layout.h+'" transform="translate('+layout.x+' '+layout.y+')'+sfxTransform(bubble,layout.w,layout.h)+'">'+svgHandles(layout,bubble,zoom)+'</g>';
}
