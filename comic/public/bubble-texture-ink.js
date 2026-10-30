const cache=new WeakMap();
export const textureStrokeWidth=b=>Number.isFinite(b.materialOutlineWidth)?b.materialOutlineWidth:2.8;
const rgb=color=>[1,3,5].map(i=>parseInt(color.slice(i,i+2),16));
const validColor=(color,fallback)=>/^#[\da-f]{6}$/i.test(color||'')?color:fallback;
/** Keep both ink and paper masks from the source, rather than replacing paper
 * with the low-resolution contour used only for text layout and handles. */
export function svgTextureInk(bubble,source,w,h,escape,fill){
 if(bubble.textureInkVersion!==1)return `<image href="${escape(source)}" width="${w}" height="${h}" preserveAspectRatio="none" pointer-events="none"/>`;
 const width=textureStrokeWidth(bubble),opacity=Math.max(0,Math.min(1,fill?.fillOpacity??0));if(width<=0&&!opacity)return '';
 const ink=rgb(validColor(bubble.outlineColor,'#171b20')).map(v=>v/255),paper=rgb(validColor(fill?.fillColor,'#ffffff')).map(v=>v/255),delta=(width-2.8)/2,id='bubble-ink-'+String(bubble.id).replace(/[^\w-]/g,'');
 const inkAlpha=width>0?'-.2126 -.7152 -.0722 0 1':'0 0 0 0 0';
 const inkFilter=`<feColorMatrix in="SourceGraphic" type="matrix" values="0 0 0 0 ${ink[0]} 0 0 0 0 ${ink[1]} 0 0 0 0 ${ink[2]} ${inkAlpha}"/><feComposite in2="SourceAlpha" operator="in"/>${width>0&&Math.abs(delta)>.001?`<feMorphology operator="${delta>0?'dilate':'erode'}" radius="${Math.abs(delta)}"/>`:''}`;
 const paperFilter=opacity?`<feColorMatrix in="SourceGraphic" type="matrix" values="0 0 0 0 ${paper[0]} 0 0 0 0 ${paper[1]} 0 0 0 0 ${paper[2]} ${.2126*opacity} ${.7152*opacity} ${.0722*opacity} 0 0"/><feComposite in2="SourceAlpha" operator="in" result="paper"/>`:'';
 // Add the premultiplied contributions, so antialiased edges retain source alpha.
 return `<defs><filter id="${id}" color-interpolation-filters="sRGB" x="-20%" y="-20%" width="140%" height="140%">${paperFilter}${inkFilter}${opacity?'<feComposite in2="paper" operator="arithmetic" k2="1" k3="1"/>':''}</filter></defs><image href="${escape(source)}" width="${w}" height="${h}" preserveAspectRatio="none" filter="url(#${id})" pointer-events="none"/>`;
}
function extremum(input,w,h,radius,horizontal,dilate){
 if(radius<1)return input;const out=new Uint8ClampedArray(input.length),n=horizontal?w:h,lines=horizontal?h:w,queue=new Int32Array(n),at=(i,line)=>horizontal?line*w+i:i*w+line;
 for(let line=0;line<lines;line++){let head=0,tail=0,right=-1;for(let x=0;x<n;x++){
  const limit=Math.min(n-1,x+radius);while(right<limit){const i=++right,value=input[at(i,line)];while(tail>head&&(dilate?input[at(queue[tail-1],line)]<=value:input[at(queue[tail-1],line)]>=value))tail--;queue[tail++]=i;}
  while(tail>head&&queue[head]<x-radius)head++;out[at(x,line)]=!dilate&&(x<radius||x+radius>=n)?0:input[at(queue[head],line)];
 }}return out;
}
export function paintTextureInk(context,image,bubble,layout,fill){
 if(bubble.textureInkVersion!==1){context.drawImage(image,0,0,layout.w,layout.h);return;}
 const stroke=textureStrokeWidth(bubble),opacity=Math.max(0,Math.min(1,fill?.fillOpacity??0));if(stroke<=0&&!opacity)return;
 const w=image.naturalWidth||image.width,h=image.naturalHeight||image.height,color=validColor(bubble.outlineColor,'#171b20'),paperColor=validColor(fill?.fillColor,'#ffffff'),delta=(stroke-2.8)/2,rx=Math.min(w,Math.round(Math.abs(delta)*w/layout.w)),ry=Math.min(h,Math.round(Math.abs(delta)*h/layout.h)),key=[color,rx,ry,delta>0,stroke>0,paperColor,opacity].join('|');let entries=cache.get(image);if(!entries)cache.set(image,entries=new Map());let canvas=entries.get(key);
 if(!canvas){
  canvas=typeof document!=='undefined'?document.createElement('canvas'):new context.canvas.constructor(w,h);canvas.width=w;canvas.height=h;const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0,w,h);const pixels=ctx.getImageData(0,0,w,h),alpha=new Uint8ClampedArray(w*h);
  const paper=new Float32Array(w*h);
  for(let i=0;i<alpha.length;i++){const j=i*4,a=pixels.data[j+3],l=(.2126*pixels.data[j]+.7152*pixels.data[j+1]+.0722*pixels.data[j+2])/255;alpha[i]=stroke>0?a*(1-l):0;paper[i]=a*l*opacity;}
  const ink=stroke>0?extremum(extremum(alpha,w,h,rx,true,delta>0),w,h,ry,false,delta>0):alpha,inkRgb=rgb(color),paperRgb=rgb(paperColor);
  for(let i=0;i<ink.length;i++){const j=i*4,a=Math.min(255,ink[i]+paper[i]);for(let c=0;c<3;c++)pixels.data[j+c]=a?(inkRgb[c]*ink[i]+paperRgb[c]*paper[i])/a:0;pixels.data[j+3]=a;}ctx.putImageData(pixels,0,0);entries.set(key,canvas);if(entries.size>3)entries.delete(entries.keys().next().value);
 }
 context.drawImage(canvas,0,0,layout.w,layout.h);
}
