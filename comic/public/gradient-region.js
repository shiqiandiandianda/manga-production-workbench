export const DEFAULT_GRADIENT_WIDTH=1280,DEFAULT_GRADIENT_HEIGHT=1920;
export const GRADIENT_HANDLES=[['nw',0,0,'左上角','nwse'],['n',.5,0,'上边','ns'],['ne',1,0,'右上角','nesw'],['e',1,.5,'右边','ew'],['se',1,1,'右下角','nwse'],['s',.5,1,'下边','ns'],['sw',0,1,'左下角','nesw'],['w',0,.5,'左边','ew']];
const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
export function constrainGradientRegion(frame,layout){
 const width=Math.max(1,layout.width),height=Math.max(1,layout.height),w=clamp(frame.w,1,width),h=clamp(frame.h,1,height);
 return {...frame,x:clamp(frame.x,0,width-w),y:clamp(frame.y,0,height-h),w,h};
}
export function resizeGradientRegion(initial,handle,point,layout){
 if(layout){initial=constrainGradientRegion(initial,layout);point={x:clamp(point.x,0,layout.width),y:clamp(point.y,0,layout.height)};}
 if(!GRADIENT_HANDLES.some(h=>h[0]===handle)||!Number.isFinite(point.x)||!Number.isFinite(point.y))return {x:initial.x,y:initial.y,w:initial.w,h:initial.h};
 let left=initial.x,top=initial.y,right=left+initial.w,bottom=top+initial.h;
 if(handle.includes('w'))left=clamp(point.x,Math.max(-4096,right-12288),right-1);
 if(handle.includes('e'))right=clamp(point.x,left+1,left+12288);
 if(handle.includes('n'))top=clamp(point.y,Math.max(-Number.MAX_SAFE_INTEGER,bottom-Number.MAX_SAFE_INTEGER),bottom-1);
 if(handle.includes('s'))bottom=clamp(point.y,top+1,Math.min(Number.MAX_SAFE_INTEGER,top+Number.MAX_SAFE_INTEGER));
 return {x:left,y:top,w:right-left,h:bottom-top};
}
export function gradientRegionHandles(frame,zoom){const z=Math.max(.00001,zoom),r=5/z,hit=10/z;return GRADIENT_HANDLES.map(([key,x,y,label,cursor])=>`<g><rect data-gradient-resize="${key}" x="${x*frame.w-hit}" y="${y*frame.h-hit}" width="${hit*2}" height="${hit*2}" fill="transparent" style="cursor:${cursor}-resize" role="button" aria-label="调整渐变${label}"><title>拖动${label}调整渐变范围</title></rect><rect x="${x*frame.w-r}" y="${y*frame.h-r}" width="${r*2}" height="${r*2}" fill="white" stroke="#48a4ef" stroke-width="${1.5/z}" pointer-events="none"/></g>`).join('');}
export function boundedGradient(layer,layout){
 const w=DEFAULT_GRADIENT_WIDTH,h=DEFAULT_GRADIENT_HEIGHT,g=layer.gradient;
 const start={x:layer.x+g.start.x*layer.w,y:layer.y+g.start.y*layer.h},end={x:layer.x+g.end.x*layer.w,y:layer.y+g.end.y*layer.h};
 const y=Math.min(Math.max(0,Math.floor(Math.min(start.y,end.y))),Math.max(0,layout.height-1));
 return constrainGradientRegion({...layer,coverage:'area',x:0,y,w,h,gradient:{...g,start:{x:start.x/w,y:(start.y-y)/h},end:{x:end.x/w,y:(end.y-y)/h}}},layout);
}
