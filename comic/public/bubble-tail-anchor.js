const finite=Number.isFinite,clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const interpolate=(a,b,t)=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});
const cross=(a,b)=>a.x*b.y-a.y*b.x;

/** A closed polyline is the shared numeric path used by SVG and Canvas, including
 * the sampled curves of the hand-drawn material catalog. No DOM path measuring. */
export function bubbleBoundary(points){
 if(!Array.isArray(points)||points.length<3||points.length>512||points.some(p=>!p||!finite(p.x)||!finite(p.y)))return null;
 const copy=points.map(p=>({x:p.x,y:p.y})),segments=[];let length=0;
 for(let i=0;i<copy.length;i++){const a=copy[i],b=copy[(i+1)%copy.length],size=distance(a,b);if(size>1e-9){segments.push({a,b,size,start:length,edge:i});length+=size;}}
 return finite(length)&&length>1e-8?{points:copy,segments,length}:null;
}
export function boundaryPointAt(path,t){
 if(!path||!finite(t))return null;const normalized=clamp(t,0,1),at=normalized*path.length,segment=path.segments.find(s=>s.start+s.size>=at-1e-9)||path.segments.at(-1),amount=clamp((at-segment.start)/segment.size,0,1);
 return {point:amount<=1e-12?{...segment.a}:amount>=1-1e-12?{...segment.b}:interpolate(segment.a,segment.b,amount),t:normalized,edge:segment.edge,amount};
}
export function projectPointToBoundary(path,target){
 if(!path||!finite(target?.x)||!finite(target?.y))return null;let best=null;
 for(const segment of path.segments){const dx=segment.b.x-segment.a.x,dy=segment.b.y-segment.a.y,amount=clamp(((target.x-segment.a.x)*dx+(target.y-segment.a.y)*dy)/(segment.size*segment.size),0,1),point=interpolate(segment.a,segment.b,amount),d=distance(point,target);if(!best||d<best.distance-1e-9)best={point,edge:segment.edge,amount,t:(segment.start+amount*segment.size)/path.length,distance:d};}
 return best;
}
export function tailBoundaryAnchors(points,anchorT,halfWidth){
 const path=bubbleBoundary(points);if(!path||!finite(anchorT))return null;const center=boundaryPointAt(path,anchorT),span=clamp(finite(halfWidth)?halfWidth:12,1e-6,path.length*.2),wrap=value=>((value%path.length)+path.length)%path.length/path.length;
 const anchors=[boundaryPointAt(path,wrap(center.t*path.length-span)),boundaryPointAt(path,wrap(center.t*path.length+span))];return {path,anchor:center.point,anchorT:center.t,anchors:anchors.map(a=>a.point),locations:anchors};
}

const inside=(polygon,p)=>{let yes=false;for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){const a=polygon[j],b=polygon[i];if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)yes=!yes;}return yes;};
const area=points=>points.reduce((sum,a,i)=>{const b=points[(i+1)%points.length];return sum+a.x*b.y-a.y*b.x;},0)/2;

/** Union the body with the tail triangle. This avoids a tail on the far side
 * cutting a hole through the bubble when its fixed tip lies across the body. */
export function unionBubbleTail(body,anchors,tip){
 if(!bubbleBoundary(body)||anchors?.length!==2||!finite(tip?.x)||!finite(tip?.y))return body;
 return unionBubblePolygons(body,[anchors[0],tip,anchors[1]]);
}

// Used by movable secondary circles and shaped tails. Keep detached pieces too.
export function unionBubblePolygons(body,addition){
 if(!bubbleBoundary(body)||!bubbleBoundary(addition))return body;
 const polygons=[...(body.components||[body]),...(addition.components||[addition])],all=polygons.flat(),w=Math.max(...all.map(p=>p.x))-Math.min(...all.map(p=>p.x)),h=Math.max(...all.map(p=>p.y))-Math.min(...all.map(p=>p.y)),epsilon=Math.max(1e-7,Math.min(Math.max(1,w),Math.max(1,h))*1e-7);
 const edges=polygons.flatMap((polygon,owner)=>polygon.map((a,i)=>({a,b:polygon[(i+1)%polygon.length],owner,cuts:[0,1]})));
 const projection=(p,e)=>{const dx=e.b.x-e.a.x,dy=e.b.y-e.a.y,d=dx*dx+dy*dy;return d?((p.x-e.a.x)*dx+(p.y-e.a.y)*dy)/d:0;};
 for(let i=0;i<edges.length;i++)for(let j=i+1;j<edges.length;j++){const a=edges[i],b=edges[j];if(a.owner===b.owner)continue;const r={x:a.b.x-a.a.x,y:a.b.y-a.a.y},s={x:b.b.x-b.a.x,y:b.b.y-b.a.y},q={x:b.a.x-a.a.x,y:b.a.y-a.a.y},den=cross(r,s);
  if(Math.abs(den)>epsilon*epsilon){const t=cross(q,s)/den,u=cross(q,r)/den;if(t>=-1e-8&&t<=1+1e-8&&u>=-1e-8&&u<=1+1e-8){a.cuts.push(clamp(t,0,1));b.cuts.push(clamp(u,0,1));}}
  else if(Math.abs(cross(q,r))<=epsilon*Math.max(1,distance(a.a,a.b))){for(const p of [b.a,b.b]){const t=projection(p,a);if(t>0&&t<1)a.cuts.push(t);}for(const p of [a.a,a.b]){const t=projection(p,b);if(t>0&&t<1)b.cuts.push(t);}}
 }
 const contains=p=>polygons.some(polygon=>inside(polygon,p)),boundary=[];
 for(const e of edges){const cuts=[...new Set(e.cuts)].sort((a,b)=>a-b);for(let i=1;i<cuts.length;i++){let a=interpolate(e.a,e.b,cuts[i-1]),b=interpolate(e.a,e.b,cuts[i]);const size=distance(a,b);if(size<=epsilon)continue;const middle=interpolate(a,b,.5),normal={x:-(b.y-a.y)/size*epsilon,y:(b.x-a.x)/size*epsilon},left=contains({x:middle.x+normal.x,y:middle.y+normal.y}),right=contains({x:middle.x-normal.x,y:middle.y-normal.y});if(left===right)continue;if(!left)[a,b]=[b,a];if(!boundary.some(v=>distance(v.a,a)<epsilon*2&&distance(v.b,b)<epsilon*2))boundary.push({a,b});}}
 const loops=[];
 while(boundary.length){const first=boundary.shift(),loop=[first.a,first.b];let closed=false;for(let step=0;step<1024;step++){if(distance(loop.at(-1),loop[0])<epsilon*8){closed=true;break;}const index=boundary.findIndex(e=>distance(e.a,loop.at(-1))<epsilon*8);if(index<0)break;loop.push(boundary.splice(index,1)[0].b);}if(closed&&loop.length>=4)loops.push(loop.slice(0,-1));}
 const sorted=loops.sort((a,b)=>Math.abs(area(b))-Math.abs(area(a))),outline=sorted[0]||body;
 // A scalloped body can touch the triangle at two points without an overlapping
 // edge. Keep every loop (including holes), rather than dropping the smaller tail.
 if(sorted.length>1)Object.defineProperty(outline,'components',{value:sorted,enumerable:false});
 return outline;
}
