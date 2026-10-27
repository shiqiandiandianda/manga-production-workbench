import {defaultTextFont,textFontWeight,textFontStack} from './text-fonts.mjs';
const number=(value,fallback,min,max)=>Number.isFinite(Number(value))?Math.max(min,Math.min(max,Number(value))):fallback;
const characters=text=>typeof Intl.Segmenter==='function'?[...new Intl.Segmenter('zh',{granularity:'grapheme'}).segment(text)].map(item=>item.segment):Array.from(text);
export function textCreationSettings(style,rect,paragraph=false){return{...style,text:'',textMode:paragraph?'paragraph':'point',textWrap:paragraph,textBoxWidth:paragraph?Math.max(1,Math.round(rect.width)):0,textBoxHeight:paragraph?Math.max(1,Math.round(rect.height)):0};}
export function textLayoutSettings(layer={}){return{fontSize:number(layer.fontSize,36,6,512),textDirection:['vertical-rl','vertical-lr'].includes(layer.textDirection)?layer.textDirection:'horizontal',textAlign:['center','right','justify'].includes(layer.textAlign)?layer.textAlign:'left',letterSpacing:number(layer.letterSpacing,0,-200,512),lineHeight:number(layer.lineHeight,1.35,.5,4),paragraphSpacing:number(layer.paragraphSpacing,0,0,512),textBoxWidth:number(layer.textBoxWidth,0,0,4096),textBoxHeight:number(layer.textBoxHeight,0,0,8192),textWrap:layer.textWrap!==false,textStrokeWidth:number(layer.textStrokeWidth,0,0,40),textStrokeColor:layer.textStrokeColor||'#ffffff',strikethrough:!!layer.strikethrough,textShadow:layer.textShadow?{color:layer.textShadow.color||'#000000',blur:number(layer.textShadow.blur,4,0,50),x:number(layer.textShadow.x,2,-100,100),y:number(layer.textShadow.y,2,-100,100)}:null};}
export function layoutText(ctx,layer){
 const settings=textLayoutSettings(layer),size=settings.fontSize,vertical=settings.textDirection!=='horizontal',spacing=settings.letterSpacing;
 ctx.font=`${layer.italic?'italic ':''}${textFontWeight(layer)} ${size}px ${textFontStack(layer)}`;
 const measure=text=>spacing?characters(text).reduce((sum,char)=>sum+ctx.measureText(char).width,0)+Math.max(0,characters(text).length-1)*spacing:ctx.measureText(text).width;
 const rows=[];let position=0;
 const availableWidth=settings.textBoxWidth>0?Math.max(1,settings.textBoxWidth-12):0;
 for(const paragraph of String(layer.text??'文字').split('\n')){
  const parts=characters(paragraph),limit=vertical?settings.textBoxHeight:availableWidth;let current=[];
  const extent=items=>vertical?Math.max(0,items.length-1)*Math.max(1,size+spacing)+size*1.65:measure(items.join(''));
  for(const char of parts){if(settings.textWrap&&limit>0&&current.length&&extent([...current,char])>limit){rows.push({text:current.join(''),width:extent(current),position,last:false});position+=size*settings.lineHeight;current=[];}current.push(char);}
  rows.push({text:current.join(''),width:extent(current),position,last:true});position+=size*settings.lineHeight+settings.paragraphSpacing;
 }
 const contentWidth=vertical?Math.max(size,position-size*settings.lineHeight-settings.paragraphSpacing+size):Math.max(0,...rows.map(row=>row.width));
 const contentHeight=vertical?Math.max(size*1.65,...rows.map(row=>row.width)):position-settings.paragraphSpacing+size*.3;
 const boxWidth=settings.textBoxWidth>0?settings.textBoxWidth:contentWidth+12,boxHeight=settings.textBoxHeight>0?settings.textBoxHeight:contentHeight,shadow=settings.textShadow;
 const width=Math.max(1,boxWidth-12),height=boxHeight,overflowX=contentWidth>width+.01,overflowY=contentHeight>height+.01;
 const bleed=Math.ceil(settings.textStrokeWidth+(shadow?shadow.blur*2+Math.max(Math.abs(shadow.x),Math.abs(shadow.y)):0));
 return{settings,rows,contentWidth:width,contentHeight:height,naturalWidth:contentWidth,naturalHeight:contentHeight,boxWidth,boxHeight,overflowX,overflowY,overflow:overflowX||overflowY,width:Math.ceil(boxWidth+bleed*2),height:Math.ceil(height+bleed*2),bleed,font:ctx.font,measure};
}
export function renderTextCanvas(layer,makeCanvas){
 const measure=makeCanvas(1,1).getContext('2d'),layout=layoutText(measure,layer),{settings,rows,bleed}=layout,size=settings.fontSize;
 if(layout.width>8192||layout.height>32768||layout.width*layout.height>40000000)throw new Error('文字范围过大，请减小字号、设置文本框换行或分成多个文字图层');
 const canvas=makeCanvas(Math.max(2,layout.width),Math.max(2,layout.height)),ctx=canvas.getContext('2d');ctx.font=layout.font;ctx.fillStyle=layer.color||'#111111';ctx.textBaseline='top';ctx.strokeStyle=settings.textStrokeColor;ctx.lineWidth=settings.textStrokeWidth*2;ctx.lineJoin='round';
 if(settings.textShadow){ctx.shadowColor=settings.textShadow.color;ctx.shadowBlur=settings.textShadow.blur;ctx.shadowOffsetX=settings.textShadow.x;ctx.shadowOffsetY=settings.textShadow.y;}
 // Fixed frames never grow to fit overflowing text. Keep the source text intact.
 if(layout.overflow){ctx.beginPath();ctx.rect(settings.textBoxWidth>0?bleed:0,settings.textBoxHeight>0?bleed:0,settings.textBoxWidth>0?layout.boxWidth:canvas.width,settings.textBoxHeight>0?layout.boxHeight:canvas.height);ctx.clip();}
 const paint=(text,x,y)=>{if(settings.textStrokeWidth)ctx.strokeText(text,x,y);ctx.fillText(text,x,y);};
 const alignment=(available,used)=>settings.textAlign==='center'?(available-used)/2:settings.textAlign==='right'?available-used:0;
 for(const row of rows){const chars=characters(row.text),vertical=settings.textDirection!=='horizontal',justify=settings.textAlign==='justify'&&!row.last&&chars.length>1;
  if(vertical){const x=4+bleed+(settings.textDirection==='vertical-rl'?layout.contentWidth-size-row.position:row.position),y=bleed+alignment(layout.contentHeight,row.width),advance=Math.max(1,size+settings.letterSpacing)+(justify?(layout.contentHeight-row.width)/(chars.length-1):0);chars.forEach((char,index)=>paint(char,x+(size-ctx.measureText(char).width)/2,y+index*advance));if(layer.underline||settings.strikethrough){ctx.save();ctx.shadowColor='transparent';const lineX=x+(settings.strikethrough?size*.5:size+2);ctx.fillRect(lineX,y,Math.max(1,size*.06),row.width);ctx.restore();}}
  else{const x=4+bleed+alignment(layout.contentWidth,row.width),y=bleed+row.position;if(!settings.letterSpacing&&!justify)paint(row.text,x,y);else{let cursor=x;const extra=justify?(layout.contentWidth-row.width)/(chars.length-1):0;for(const char of chars){paint(char,cursor,y);cursor+=ctx.measureText(char).width+settings.letterSpacing+extra;}}ctx.save();ctx.shadowColor='transparent';if(layer.underline)ctx.fillRect(x,y+size,row.width,Math.max(1,size*.06));if(settings.strikethrough)ctx.fillRect(x,y+size*.6,row.width,Math.max(1,size*.06));ctx.restore();}
 }
 return canvas;
}
