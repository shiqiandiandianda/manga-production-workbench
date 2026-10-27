import {unionBubblePolygons} from './bubble-tail-anchor.js';
const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const validPartContour=points=>Array.isArray(points)&&points.length>=8&&points.length<=160&&points.every(p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y)&&p.x>=0&&p.x<=1&&p.y>=0&&p.y<=1);
export function validBubbleParts(parts){return Array.isArray(parts)&&parts.length<=6&&parts.every(p=>p&&typeof p.id==='string'&&p.id.length<=40&&typeof p.label==='string'&&p.label.length<=80&&['x','y','w','h'].every(k=>Number.isFinite(p[k]))&&p.x>=-2&&p.x<=3&&p.y>=-2&&p.y<=3&&p.w>=.02&&p.w<=3&&p.h>=.02&&p.h<=3&&(p.rotation===undefined||Number.isFinite(p.rotation)&&Math.abs(p.rotation)<=180)&&(p.contour===undefined||validPartContour(p.contour)));}
export function bubbleParts(bubble){return bubble.shape==='asset'&&validBubbleParts(bubble.assetParts)?bubble.assetParts:[];}
export function partPoints(part,w,h){const cx=(part.x+part.w/2)*w,cy=(part.y+part.h/2)*h,a=(part.rotation||0)*Math.PI/180,points=part.contour||Array.from({length:80},(_,i)=>({x:.5+.5*Math.cos(i*Math.PI/40),y:.5+.5*Math.sin(i*Math.PI/40)}));return points.map(p=>{const x=(p.x-.5)*part.w*w,y=(p.y-.5)*part.h*h;return {x:cx+x*Math.cos(a)-y*Math.sin(a),y:cy+x*Math.sin(a)+y*Math.cos(a)};});}
export function outlineWithParts(outline,bubble,w,h){for(const part of bubbleParts(bubble))outline=unionBubblePolygons(outline,partPoints(part,w,h));return outline;}
export function editBubblePart(bubble,index,{dx=0,dy=0,resize=false,field,value}={}){
 const parts=bubbleParts(bubble);if(bubble.locked||!parts[index])return bubble;
 const next=structuredClone(bubble),p=next.assetParts[index],w=Math.max(1,bubble.w),h=Math.max(1,bubble.h);
 if(field&&['x','y','w','h'].includes(field))p[field]=value;
 else if(resize){p.w+=dx/w;p.h+=dy/h;}else{p.x+=dx/w;p.y+=dy/h;}
 p.x=clamp(p.x,-2,3);p.y=clamp(p.y,-2,3);p.w=clamp(p.w,.02,3);p.h=clamp(p.h,.02,3);
 return next;
}

// The same sampled outline drives Canvas exports and the interactive SVG.
export function shapedTailPoints(tail,kind){
 const [a,b]=tail.anchors,m={x:(a.x+b.x)/2,y:(a.y+b.y)/2},v={x:tail.tip.x-m.x,y:tail.tip.y-m.y},d={x:b.x-a.x,y:b.y-a.y};
 const p=(t,s)=>({x:m.x+v.x*t+d.x*s,y:m.y+v.y*t+d.y*s});
 if(kind==='lightning')return [a,p(.03,.02),p(.35,-.27),p(.43,.15),tail.tip,p(.33,.48),p(.29,.26),b];
 if(kind==='curved'){
  const cubic=(a,c,d,b)=>Array.from({length:13},(_,i)=>{const t=i/12,s=1-t;return {x:s*s*s*a.x+3*s*s*t*c.x+3*s*t*t*d.x+t*t*t*b.x,y:s*s*s*a.y+3*s*s*t*c.y+3*s*t*t*d.y+t*t*t*b.y};});
  return [...cubic(a,p(.45,-.45),p(.9,-.1),tail.tip),...cubic(tail.tip,p(.55,.18),p(.22,.25),b).slice(1)];
 }
 return [a,tail.tip,b];
}
