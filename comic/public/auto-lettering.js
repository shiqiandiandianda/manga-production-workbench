import {FONT_FAMILIES,bubbleLayout,bubbleOutlinePoints,normalizeBubbleStyle,measureLettering} from './lettering.js';
import {balancedWrapRows,meaningfulLength,orphanLine,textGraphemes} from './balanced-text-wrap.js';
import {freezeBubbleTextLayout,bubbleTextLayoutKey,bubbleLineBreakMode} from './bubble-text-flow.js';
import {dialogueSegments,segmentBubble} from './bubble-dialogue-segments.js';

export const AUTO_LETTERING_VERSION=3;
const copy=v=>structuredClone(v),clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const estimate={font:'36px sans-serif',measureText(text){const size=Number(/([\d.]+)px/.exec(this.font)?.[1])||36;return {width:textGraphemes(text).reduce((n,c)=>n+size*(/^[\x00-\x7f]$/.test(c)?.56:1),0)};}};
const eligible=b=>b&&!b.locked&&['speech','thought','caption','label','system'].includes(b.type)&&String(b.text||'').trim();
const inputs=b=>JSON.stringify([b.text,b.type,b.shape,b.comicStyleId,b.assetContour,b.assetInsets,b.assetParts,b.materialAspectRatio,b.fontFamily,b.fontSize,b.fontWeight,b.fontStyle,b.lineHeight,b.letterSpacing,b.writingMode,b.textDirection,b.textAlign,b.padding,b.lineBreakMode,b.autoLettering?.textWidth]);
const productionSnapshot=b=>JSON.stringify(Object.fromEntries(Object.entries(b).filter(([k])=>!['productionAutoLettering','productionModeHidden','productionModeVisible','visible'].includes(k))));
function contains(points,rect){
 const ys=[rect.y,rect.y+rect.h,...points.flatMap(p=>p.y>rect.y&&p.y<rect.y+rect.h?[p.y-.00001,p.y+.00001]:[])];
 return ys.every(y=>{const xs=[];for(let i=0;i<points.length;i++){const a=points[i],b=points[(i+1)%points.length];if((a.y<=y&&b.y>y)||(b.y<=y&&a.y>y))xs.push(a.x+(y-a.y)*(b.x-a.x)/(b.y-a.y));}xs.sort((a,b)=>a-b);for(let i=0;i+1<xs.length;i+=2)if(xs[i]<=rect.x&&xs[i+1]>=rect.x+rect.w)return true;return false;});
}
function dimensions(b,tw,th,style,maxWidth,maxHeight){
 const gapX=Math.max(style.fontSize*.5,Math.min(style.padding,style.fontSize*.8)),gapY=Math.max(style.fontSize*.5,Math.min(style.padding,style.fontSize*.75));
 if(style.shape==='none')return {w:Math.max(30,tw),h:Math.max(20,th),cx:tw/2,cy:th/2};
 const outline=bubbleOutlinePoints(b,1,1);if(!outline?.length)return null;
 const inset=b.assetInsets||{},bounds={l:Math.max(Math.min(...outline.map(p=>p.x)),inset.left||0),r:Math.min(Math.max(...outline.map(p=>p.x)),1-(inset.right||0)),t:Math.max(Math.min(...outline.map(p=>p.y)),inset.top||0),b:Math.min(Math.max(...outline.map(p=>p.y)),1-(inset.bottom||0))},bw=bounds.r-bounds.l,bh=bounds.b-bounds.t;
 if(bw<=0||bh<=0)return null;
 const round=b.comicStyleId==='builtin-oval',vertical=style.writingMode==='vertical';
 let w=Math.max(style.fontSize*3.6,(tw+gapX*2)/bw),h=Math.max(style.fontSize*2.7,(th+gapY*2)/bh);
 const aspect=b.materialAspectRatio;if(Number.isFinite(aspect)&&aspect>0){w=Math.max(w,h*aspect);h=w/aspect;}else if(round)w=h=Math.max(w,h);else if(['oval','cloud','burst'].includes(style.shape)&&!vertical){w=Math.max(w,h*1.2);h=Math.max(h,w/1.7);}
 for(let pass=0;pass<90;pass++){
  if(w>maxWidth+.01||h>maxHeight+.01)return null;
  const cx=w*(bounds.l+bounds.r)/2,cy=h*(bounds.t+bounds.b)/2,safety=style.outlineWidth/2+2,rect={x:cx-tw/2-gapX-safety,y:cy-th/2-gapY-safety,w:tw+gapX*2+safety*2,h:th+gapY*2+safety*2};
  if(contains(bubbleOutlinePoints(b,w,h),rect))return {w:Math.ceil(w),h:Math.ceil(h),cx:Math.ceil(w)*(bounds.l+bounds.r)/2,cy:Math.ceil(h)*(bounds.t+bounds.b)/2};
  w*=1.025;h*=1.025;
 }
 return null;
}
function freezeRows(context,b,rows,box,style){
 const vertical=style.writingMode==='vertical',step=style.fontSize*style.lineHeight,cell=style.fontSize+style.letterSpacing;
 const punctuation={'（':'︵','）':'︶','「':'﹁','」':'﹂','，':'︐','。':'︒','！':'︕','？':'︖','：':'︓','；':'︔'};
 const lines=rows.map((text,i)=>{
  const width=measureLettering(context,text,style.letterSpacing),x=vertical?box.x+box.w/2+((style.textDirection==='rtl'?rows.length-1-i:i)-(rows.length-1)/2)*step:style.textAlign==='left'?box.x:style.textAlign==='right'?box.x+box.w:box.x+box.w/2,y=vertical?box.y+style.fontSize*.525:box.y+box.h/2+(i-(rows.length-1)/2)*step;
  return {text,x,y,width,availableWidth:box.w,left:box.x,right:box.x+box.w,overflow:false,glyphs:vertical?textGraphemes(text).map((c,j)=>({text:punctuation[c]||c,x,y:y+j*cell})):style.textDirection==='rtl'?textGraphemes(text).map((c,j,chars)=>({text:c,x:box.x+box.w/2+width/2-measureLettering(context,chars.slice(0,j).join(''),style.letterSpacing)-context.measureText(c).width/2-(j?style.letterSpacing:0),y})):null};
 });
 freezeBubbleTextLayout(b,{...style,lines,textBox:box,lineHeight:step,textLayoutStyleKey:bubbleTextLayoutKey(b,style),font:`${style.fontWeight} ${style.fontSize}px ${FONT_FAMILIES[style.fontFamily]}`},style);b.textFrameLayout=true;
}
function fitDouble(context,b,options){
 const next=copy(b),style=normalizeBubbleStyle(b),parts=dialogueSegments(next),upper=next.assetParts?.find(p=>p.id==='upper-bubble')||{x:.21,y:0,w:.58,h:.5},results=parts.map((s,i)=>autoLettering(context,{...segmentBubble(next,i),id:next.id+'-part-'+i,shape:'oval',comicStyleId:undefined,assetContour:undefined,assetParts:undefined,assetInsets:undefined,locked:false},{...options,textWidth:options.segmentWidths?.[i]??options.textWidth,maxWidth:options.maxWidth*(i===0?upper.w:.9),preserveTop:true}));
 if(results.some(r=>r.status!=='fitted'))return {bubble:copy(b),status:'too-large'};
 const w=Math.ceil(Math.max(results[0].bubble.w/upper.w,results[1].bubble.w/.90)),h=Math.ceil(Math.max(results[0].bubble.h/upper.h,results[1].bubble.h/.70,(results[0].bubble.textBox.h+results[1].bubble.textBox.h+style.fontSize*2)/.65));
 if(w>options.maxWidth||h>options.maxHeight)return {bubble:copy(b),status:'too-large'};
 next.w=w;next.h=h;next.x=b.x+b.w/2-w/2;
 parts.forEach((s,i)=>{const result=results[i],tw=result.bubble.textBox.w,th=result.bubble.textBox.h,cx=i===0?w*(upper.x+upper.w/2):w*.5,cy=i===0?h*(upper.y+upper.h/2):h*.65,box={x:cx-tw/2,y:cy-th/2,w:tw,h:th},holder={...next,text:s.text};delete holder.dialogueSegments;freezeRows(context,holder,result.rows,box,style);s.independentBox=holder.textBox;s.textBox={x:box.x/w,y:box.y/h,w:tw/w,h:th/h};s.textLayout=holder.textLayout;});
 next.autoLettering={version:AUTO_LETTERING_VERSION,mode:'auto',measurement:context===estimate?'estimate':'canvas'};next.autoLettering.signature=inputs(next);return {bubble:next,status:'fitted',rows:results.flatMap(r=>r.rows)};
}
/** Text determines its box, then the true body contour encloses that box. */
export function autoLettering(context,bubble,{maxWidth=704,maxHeight=8192,textWidth,segmentWidths,preserveTop=true,protectedWords=[]}={}){
 if(!eligible(bubble))return {bubble:copy(bubble),status:'skipped'};
 const ctx=context||estimate,style=normalizeBubbleStyle(bubble);ctx.font=`${style.fontStyle==='italic'?'italic ':''}${style.fontWeight} ${style.fontSize}px ${FONT_FAMILIES[style.fontFamily]}`;if('letterSpacing' in ctx)ctx.letterSpacing='0px';
 maxWidth=Math.max(30,maxWidth);maxHeight=Math.max(20,maxHeight);
 if(dialogueSegments(bubble).length)return fitDouble(ctx,bubble,{maxWidth,maxHeight,textWidth,segmentWidths,preserveTop,protectedWords});
 const vertical=style.writingMode==='vertical',f=style.fontSize,cap=vertical?Math.max(f*2,Math.min(maxHeight*.7,f*10)):Math.max(f*2,Math.min(maxWidth*.70,f*10));
 const fixed=Number.isFinite(textWidth)?Math.max(f*3,Math.min(cap,textWidth)):null,candidates=fixed?[fixed]:[4,5,6,7,8,9,10].map(n=>Math.min(cap,n*f));let best=null;
 for(const width of [...new Set(candidates)]){
  const measuring=vertical?{measureText:value=>({width:textGraphemes(value).length*f})}:ctx;
  const rows=bubbleLineBreakMode(bubble)==='explicit'?String(bubble.text).split('\n'):balancedWrapRows(measuring,bubble.text,()=>width,{letterSpacing:style.letterSpacing,protectedWords});
  const tw=vertical?(rows.length-1)*f*style.lineHeight+f*1.05:Math.max(...rows.map(t=>measureLettering(ctx,t,style.letterSpacing)))+.1,th=vertical?Math.max(...rows.map(t=>(textGraphemes(t).length-1)*(f+style.letterSpacing)+f*1.05)):(rows.length-1)*f*style.lineHeight+f*1.05;
  const size=dimensions(bubble,tw,th,style,maxWidth,maxHeight);if(!size)continue;
  const orphan=rows.length>1&&orphanLine(rows.at(-1))&&meaningfulLength(bubble.text)>1,mean=rows.reduce((n,r)=>n+textGraphemes(r).length,0)/rows.length,variance=rows.reduce((n,r)=>n+(textGraphemes(r).length-mean)**2,0)/rows.length;
  const pauses=rows.slice(0,-1).reduce((n,r)=>n+(/[。？！!?；;]$/.test(r)?-.5:/[，、,:：]$/.test(r)?-.12:0),0),score=(orphan?100000:0)+size.w*size.h/(f*f)*.02+variance*.04+Math.abs(width/f-8)*.6+pauses;
  if(!best||score<best.score)best={rows,tw,th,size,score};
 }
 if(!best)return {bubble:copy(bubble),status:'too-large'};
 const next=copy(bubble),{rows,tw,th,size}=best;next.x=(bubble.x||0)+bubble.w/2-size.w/2;next.y=preserveTop?(bubble.y||0):(bubble.y||0)+bubble.h/2-size.h/2;next.w=size.w;next.h=size.h;next.overflow='fit';delete next.textBox;delete next.textLayout;delete next.textFrameLayout;
 freezeRows(ctx,next,rows,{x:size.cx-tw/2,y:size.cy-th/2,w:tw,h:th},style);
 next.autoLettering={version:AUTO_LETTERING_VERSION,mode:'auto',measurement:ctx===estimate?'estimate':'canvas',...(fixed?{textWidth:fixed}:{})};next.autoLettering.signature=inputs(next);
 return {bubble:next,status:'fitted',rows};
}
/** Preview and canvas use the same bounds and never substitute a different shape. */
export function fitDialogueObject(context,bubble,{pageWidth=1280,parentWidth=pageWidth,maxHeight=16384,...options}={}){
 const preferred=Math.min(pageWidth*.55,Math.max((bubble.fontSize||36)*4,parentWidth*.65));
 let result=autoLettering(context,bubble,{maxWidth:preferred,maxHeight,...options});
 if(result.status==='too-large')result=autoLettering(context,bubble,{maxWidth:pageWidth,maxHeight,...options});
 return result;
}
export function autoLetteringNeedsUpdate(bubble){return bubble.autoLettering?.mode==='auto'&&(bubble.autoLettering.version!==AUTO_LETTERING_VERSION||bubble.autoLettering.measurement!=='canvas'||bubble.autoLettering.signature!==inputs(bubble));}
export function legacyAutomaticLettering(b){
 if(!b.productionTextId||b.autoLettering||bubbleLineBreakMode(b)==='explicit'||dialogueSegments(b).length||b.visible===false)return false;
 if(!b.textBox&&!b.textLayout)return b.w/Math.max(1,b.h)>3;
 return !!b.textLayout&&b.textBox?.x===48&&b.textBox?.y===72&&b.w/Math.max(1,b.h)>3;
}
/** Only automatic/default geometry is upgraded implicitly. Hand edits stay opt-in. */
export function reflowProjectLettering(context,project,{force=false,segmentIds,includeHidden=false,onlyRequested=false,upgradeLegacy=project.autoLetteringUpgradeVersion!==AUTO_LETTERING_VERSION}={}){
 const result={changed:0,locked:0,unsupported:0};
 const words=project.pages.flatMap(p=>p.bubbles.map(b=>b.speaker).filter(Boolean)).concat(project.productionPackage?.episodes.flatMap(e=>[...(e.texts||[]).map(t=>t['说话人']),...e.segments.flatMap(s=>(s.references||[]).map(r=>r['人物']))]).filter(Boolean)||[]);
 for(const page of project.pages){const changed=[];
  for(const bubble of page.bubbles||[]){const parent=page.panels.find(p=>p.id===bubble.parentPanelId),segment=bubble.productionSegment||parent?.productionGrid?.segmentId||parent?.panelSlice?.segmentId||parent?.productionSegment||page.screenBoard?.segmentId||(!project.productionPackage?'page:'+page.id:undefined);if(segmentIds&&!segmentIds.has(segment))continue;
   if(page.locked||parent?.locked||bubble.locked){result.locked++;continue;}if(!includeHidden&&(bubble.visible===false||parent?.visible===false))continue;if(onlyRequested&&bubble.autoLettering?.version!==0)continue;
   if(!force&&!(upgradeLegacy&&legacyAutomaticLettering(bubble))&&!autoLetteringNeedsUpdate(bubble))continue;
   if(!force&&bubble.autoLettering?.measurement==='estimate'&&bubble.productionAutoLettering&&bubble.productionAutoLettering.snapshot!==productionSnapshot(bubble))continue;
   // An existing image-owned empty bubble has a deliberate rectangle. Its body is fixed.
   if(bubble.shape==='none'&&parent?.generation?.promptSource==='imported'&&!force)continue;
   const untouched=bubble.productionAutoLettering?.snapshot===productionSnapshot(bubble),source=force?{...bubble,lineBreakMode:'auto',textFlowVersion:1}:bubble,fitted=fitDialogueObject(context,source,{pageWidth:page.width,parentWidth:parent?.w||page.width,maxHeight:Math.max(parent?.h||8192,bubble.fontSize*6),textWidth:force?undefined:bubble.autoLettering?.textWidth,protectedWords:words});
   if(fitted.status==='fitted'){const next=fitted.bubble;next.x=clamp(next.x,parent?.x||0,Math.max(parent?.x||0,(parent?parent.x+parent.w:page.width)-next.w));if(parent)next.y=Math.max(parent.y,Math.min(next.y,parent.y+parent.h-next.h));Object.assign(bubble,next);changed.push({bubble,untouched});result.changed++;}else result.unsupported++;
  }
  const sorted=changed.toSorted((a,b)=>a.bubble.y-b.bubble.y),placed=new Set();
  for(const {bubble:b,untouched} of sorted){const parent=page.panels.find(p=>p.id===b.parentPanelId);for(const other of page.bubbles||[]){if(other===b||other.parentPanelId!==b.parentPanelId||other.visible===false||changed.some(c=>c.bubble===other)&&!placed.has(other))continue;if(b.x<other.x+other.w+8&&b.x+b.w+8>other.x&&b.y<other.y+other.h+16&&b.y+b.h+16>other.y){const y=other.y+other.h+16;if(!parent||y+b.h<=parent.y+parent.h)b.y=y;}}
   placed.add(b);if(untouched) b.productionAutoLettering.snapshot=productionSnapshot(b);
  }
 }
 return result;
}
