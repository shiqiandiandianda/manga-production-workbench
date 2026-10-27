import {unionBubblePolygons} from './bubble-tail-anchor.js';

// These editable defaults belong to the editor, independently of the remote material catalog.
const ellipse=()=>Array.from({length:96},(_,i)=>{const a=-Math.PI/2+i*Math.PI/48;return {x:.5+.5*Math.cos(a),y:.5+.5*Math.sin(a)};});
const outline=shape=>{
 if(shape==='rounded'){
  const points=[],r=.16;
  for(const [x,y,start] of [[1-r,r,-Math.PI/2],[1-r,1-r,0],[r,1-r,Math.PI/2],[r,r,Math.PI]])for(let i=0;i<=8;i++){const a=start+i*Math.PI/16;points.push({x:x+r*Math.cos(a),y:y+r*Math.sin(a)});}
  return points;
 }
 if(shape==='double')return ellipse().map(p=>({x:p.x,y:.30+p.y*.70}));
 if(shape==='oval')return ellipse();
 const n=shape==='burst'?40:96;
 return Array.from({length:n},(_,i)=>{const a=-Math.PI/2+i*Math.PI*2/n,r=shape==='cloud'?.945+.055*Math.cos(a*12):i%2?.78:1;return {x:.5+.5*r*Math.cos(a),y:.5+.5*r*Math.sin(a)};});
};
export const BUILTIN_BUBBLE_STYLES=[['oval','系统默认圆形气泡'],['double','系统默认双圆气泡'],['rounded','系统默认圆角框'],['cloud','系统默认云朵框'],['burst','系统默认放射框']].map(([shape,label])=>({
 id:'builtin-'+shape,kind:'bubble',family:'系统默认 · 可编辑',label,uses:['speech','thought','caption'],texture:false,contour:outline(shape),
 insets:{left:.15,right:.15,top:shape==='double'?.42:.15,bottom:.15},
 ...(shape==='double'?{parts:[{id:'upper-bubble',label:'上方圆框',x:.21,y:0,w:.58,h:.50}]}:{})
}));
export const builtinBubbleStyle=id=>BUILTIN_BUBBLE_STYLES.find(style=>style.id===id);
export function builtinBubblePreview(id){
 const style=builtinBubbleStyle(id);if(!style)return null;
 let points=style.contour;
 for(const part of style.parts||[])points=unionBubblePolygons(points,ellipse().map(p=>({x:part.x+p.x*part.w,y:part.y+p.y*part.h})));
 const d=points.map((p,i)=>(i?'L':'M')+(8+p.x*84).toFixed(2)+' '+(7+p.y*56).toFixed(2)).join(' ')+' Z';
 return 'data:image/svg+xml;charset=utf-8,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 70"><rect width="100" height="70" fill="#f4f6fb"/><path d="'+d+'" fill="white" stroke="#172333" stroke-width="1.5" stroke-linejoin="round"/></svg>');
}
