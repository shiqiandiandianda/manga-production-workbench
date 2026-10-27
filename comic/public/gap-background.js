import {clone,id,rectangle,layoutLongStrip} from './model.js';
import {isOpaqueStripBackground} from './strip-background.js';
const broken=g=>g.stripSpace?.colorSource==='page-background'&&g.name==='画格留白';
function colorAt(g,x,y){const a={x:g.x+g.gradient.start.x*g.w,y:g.y+g.gradient.start.y*g.h},b={x:g.x+g.gradient.end.x*g.w,y:g.y+g.gradient.end.y*g.h},dx=b.x-a.x,dy=b.y-a.y,t=Math.max(0,Math.min(1,((x-a.x)*dx+(y-a.y)*dy)/(dx*dx+dy*dy||1)));return '#'+[1,3,5].map(i=>Math.round(parseInt(g.gradient.startColor.slice(i,i+2),16)*(1-t)+parseInt(g.gradient.endColor.slice(i,i+2),16)*t).toString(16).padStart(2,'0')).join('');}
const usable=project=>(project.gradients||[]).filter(g=>isOpaqueStripBackground(g)&&!broken(g));
function fallbackBand(project,from,to,height,pageId,key=id('gradient'),newY=from){
 const bands=usable(project),above=bands.filter(g=>g.y<=from).sort((a,b)=>(b.y+b.h)-(a.y+a.h))[0],below=bands.filter(g=>g.y+g.h>=to).sort((a,b)=>a.y-b.y)[0],page=project.pages.find(p=>p.id===pageId),base=page.background;
 const start=above?colorAt(above,640,from):below?colorAt(below,640,to):base,end=below?colorAt(below,640,to):start;
 return {id:key,name:'画格留白',coverage:'area',visible:true,locked:false,x:0,y:newY,w:1280,h:height,points:rectangle(),border:0,borderColor:'#111111',feather:0,
  gradient:{enabled:true,mode:'color',startColor:start,endColor:end,opacity:1,start:{x:.5,y:0},end:{x:.5,y:1}},stripBackground:true,gapBackground:{version:1,pageId,colorSource:'preserved-background'}};
}
function extendAcrossRow(g,{row,newY,height,pageId}){
 const out=clone(g),a={x:g.x+g.gradient.start.x*g.w,y:g.y+g.gradient.start.y*g.h},b={x:g.x+g.gradient.end.x*g.w,y:g.y+g.gradient.end.y*g.h},dx=b.x-a.x,dy=b.y-a.y,d=dx*dx+dy*dy,gx=dx/d,gy=dy/d;
 Object.assign(out,{id:id('gradient'),name:'画格留白',x:0,y:newY,w:1280,h:height,points:rectangle(),feather:0});delete out.featherEdges;delete out.mask;delete out.templateGenerated;delete out.stripSpace;
 out.stripBackground=true;out.gapBackground={version:1,pageId,colorSource:'preserved-background',sourceGradientId:g.id};
 if(Math.abs(gx)>1e-12){const startX=a.x-gy*(row-a.y)/gx;out.gradient={...out.gradient,start:{x:startX/1280,y:0},end:{x:(startX+1/gx)/1280,y:0}};}
 else{const color=colorAt(g,640,row);out.gradient={...out.gradient,startColor:color,endColor:color,start:{x:.5,y:0},end:{x:.5,y:1}};}
 return out;
}
/** Stretch only the old gap's gradient field, retaining unchanged colours outside the gap. */
function stretchBand(g,{oldFrom,oldTo,newY,height,pageId}){
 const out=clone(g),ratio=(oldTo-oldFrom)/height,a={x:g.x+g.gradient.start.x*g.w,y:g.y+g.gradient.start.y*g.h},b={x:g.x+g.gradient.end.x*g.w,y:g.y+g.gradient.end.y*g.h},vx=b.x-a.x,vy=b.y-a.y,d=vx*vx+vy*vy;
 const gx=vx/d,gy=vy/d*ratio,n=gx*gx+gy*gy,A={x:a.x,y:(a.y-oldFrom)/ratio},B={x:A.x+gx/n,y:A.y+gy/n};
 Object.assign(out,{id:id('gradient'),name:'画格留白',x:0,y:newY,w:1280,h:height,points:rectangle(),feather:0});delete out.featherEdges;delete out.mask;delete out.templateGenerated;delete out.stripSpace;out.stripBackground=true;out.gapBackground={version:1,pageId,colorSource:'preserved-background',sourceGradientId:g.id};
 out.gradient={...out.gradient,start:{x:A.x/1280,y:A.y/height},end:{x:B.x/1280,y:B.y/height}};return out;
}
export function repairGapBackgrounds(source){if(!(source.gradients||[]).some(broken))return {project:source,changed:0};const project=clone(source),layout=layoutLongStrip(project.pages);let changed=0;
 project.gradients=(project.gradients||[]).map(g=>{if(!broken(g))return g;const pageId=g.stripSpace.pageId||layout.pages.find(p=>g.y>=p.y&&g.y<p.endY)?.pageId;if(!pageId)return g;changed++;const cover=usable(project).find(b=>b.y<=g.y&&b.y+b.h>=g.y+g.h);if(cover){const out=stretchBand(cover,{oldFrom:g.y,oldTo:g.y+g.h,newY:g.y,height:g.h,pageId});out.id=g.id;return out;}return fallbackBand(project,g.y,g.y+g.h,g.h,pageId,g.id);});
 return {project,changed};
}
export function preservedGapBackgrounds(project,{from,to,height,pageId}){
 if(!height)return [];const oldHeight=to-from;if(oldHeight<=0){const source=usable(project).find(g=>g.y<=from&&g.y+g.h>=from);return [source?extendAcrossRow(source,{row:from,newY:from,height,pageId}):fallbackBand(project,from,to,height,pageId)];}
 const out=[],covered=[];for(const g of usable(project)){const start=Math.max(from,g.y),end=Math.min(to,g.y+g.h);if(end<=start)continue;const newY=from+(start-from)/oldHeight*height,h=(end-start)/oldHeight*height;if(h<1)continue;out.push(stretchBand(g,{oldFrom:start,oldTo:end,newY,height:h,pageId}));covered.push([newY,newY+h]);}
 const oldY=newY=>from+(newY-from)/height*oldHeight;
 covered.sort((a,b)=>a[0]-b[0]);let cursor=from;for(const [start,end] of covered){if(start-cursor>=1)out.unshift(fallbackBand(project,oldY(cursor),oldY(start),start-cursor,pageId,undefined,cursor));cursor=Math.max(cursor,end);}if(from+height-cursor>=1)out.unshift(fallbackBand(project,oldY(cursor),to,from+height-cursor,pageId,undefined,cursor));return out;
}
