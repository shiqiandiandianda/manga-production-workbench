import {gradientStops,gradientColorAt} from './gradient-stops.js';
import {rectangle,COMIC_PAGE_WIDTH} from './model.js';

const rectangular=layer=>layer.points?.length===4&&rectangle().every(corner=>layer.points.some(p=>Math.abs(p.x-corner.x)<1e-8&&Math.abs(p.y-corner.y)<1e-8));
/** Story backgrounds span the strip; ordinary overlay gradients remain freely positioned. */
// Older local story backgrounds were saved without a strip marker. Recognize only the
// documented generated layer with its matching episode anchor; freehand edits remain free.
const isLegacyStoryBackground=layer=>layer.name==='剧情段落衬底'&&Number.isSafeInteger(layer.designEpisode)&&layer.assistantLayoutAnchor?.episode===layer.designEpisode&&typeof layer.assistantLayoutAnchor.pageId==='string';
export const isStripBackground=layer=>!!layer&&!layer.freeGradientRegion&&layer.coverage==='area'&&rectangular(layer)&&!!(layer.templateGenerated||layer.stripSpace||layer.stripBackground||layer.storyBackgroundVersion===1||isLegacyStoryBackground(layer));
export function anchoredBackground(layer,width=COMIC_PAGE_WIDTH){return isStripBackground(layer)?{...layer,x:0,w:width}:layer;}
export function anchorStripBackgrounds(project){for(const layer of project.gradients||[])if(isStripBackground(layer)){layer.x=0;layer.w=COMIC_PAGE_WIDTH;}return project;}
export function isOpaqueStripBackground(layer){
 const g=layer?.gradient;
 return isStripBackground(layer)&&layer.visible!==false&&g?.enabled&&g.mode==='color'&&g.opacity===1&&gradientStops(g).every(s=>s.opacity===1)&&!(layer.feather>0)&&!Object.values(layer.featherEdges||{}).some(v=>v>0)&&!(layer.mask?.enabled&&layer.mask.strokes?.length);
}
/** Only opaque base rectangles get a one-output-pixel overlap, never artwork or translucent effects. */
export function backgroundPaintRegion(frame,region,bleed=1){
 const x=Math.max(0,region.x),right=Math.min(frame.w,region.x+region.w),y=Math.max(-bleed,region.y),bottom=Math.min(frame.h+bleed,region.y+region.h);
 return {x,y,w:Math.max(0,right-x),h:Math.max(0,bottom-y)};
}
function colorAt(frame,y){
 const g=frame.gradient,ax=g.start.x*frame.w,ay=g.start.y*frame.h,bx=g.end.x*frame.w,by=g.end.y*frame.h,dx=bx-ax,dy=by-ay;
 const t=Math.max(0,Math.min(1,((frame.w/2-ax)*dx+(y-frame.y-ay)*dy)/(dx*dx+dy*dy||1)));
 return gradientColorAt(g,t).color;
}
/** Fill exposed base gaps using neighboring edge colors without moving any panels or lettering. */
export function stripBackgroundGaps(project,layout){
 const inDocument=g=>{const anchored=anchoredBackground(g,layout.width);if(!g.assistantLayoutAnchor)return anchored;const page=layout.pages.find(p=>p.pageId===g.assistantLayoutAnchor.pageId);return page?{...anchored,y:page.y+g.assistantLayoutAnchor.y}:null;};
 const bands=(project.gradients||[]).filter(isOpaqueStripBackground).map(inDocument).filter(g=>g&&g.y<layout.height&&g.y+g.h>0).sort((a,b)=>a.y-b.y||b.h-a.h);
 const intentional=(project.gradients||[]).filter(g=>isStripBackground(g)&&!isOpaqueStripBackground(g)).map(inDocument).filter(Boolean);
 if(!bands.length)return [];
 const gaps=[];let end=0,previous=null;
 const add=(from,to,left,right)=>{if(to-from<1e-8||to-from>8||intentional.some(g=>g.y<to&&g.y+g.h>from))return;const c1=left?colorAt(left,from):colorAt(right,to),c2=right?colorAt(right,to):c1;
  gaps.push({id:'strip_background_gap_'+gaps.length,name:'底色衔接',coverage:'area',stripBackground:true,visible:true,x:0,y:from,w:layout.width,h:to-from,points:rectangle(),border:0,feather:0,
   gradient:{enabled:true,mode:'color',opacity:1,startColor:c1,endColor:c2,start:{x:.5,y:0},end:{x:.5,y:1}}});};
 for(const band of bands){const start=Math.max(0,band.y),bottom=Math.min(layout.height,band.y+band.h);if(start>end)add(end,start,previous,band);if(bottom>end){end=bottom;previous=band;}}
 if(end<layout.height)add(end,layout.height,previous,null);
 return gaps;
}
