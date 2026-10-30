/** Conservative fallback for a single column of panels separated by straight ink lines.
 * Require continuous, contrasting ink across the image and exactly N-1 boundaries.
 * No equal division or storyboard coordinates are used as image crop boundaries.
 */
export function detectDarkPanelSeparators(pixels,w,h,expected){
 if(w<32||h<32||expected.length<2||expected.length>12||new Set(expected.map(p=>p['排'])).size!==expected.length)return null;
 const xs=Array.from({length:100},(_,i)=>Math.round(3+i*(w-7)/99)),mask=new Uint8Array(w*h);
 const light=(x,y)=>{const i=(y*w+x)*4;return .299*pixels[i]+.587*pixels[i+1]+.114*pixels[i+2];};
 for(const x of xs)for(let y=6;y<h-6;y++){
  const v=light(x,y);if(pixels[(y*w+x)*4+3]>240&&v<85&&Math.max(light(x,y-5),light(x,y+5))-v>35)mask[y*w+x]=1;
 }
 const hits=[],edge=Math.max(12,Math.ceil(h*.04));
 for(let delta=-Math.floor(w*.16);delta<=w*.16;delta++){
  const slope=delta/(w-1);
  for(let y=edge;y<h-edge;y++){
   if(y+delta<edge||y+delta>h-edge)continue;
   let count=0,left=0,right=0;
   for(let i=0;i<xs.length;i++){const x=xs[i],yy=Math.round(y+slope*x);if(mask[yy*w+x]||mask[(yy-1)*w+x]||mask[(yy+1)*w+x]){count++;if(i<20)left++;if(i>=80)right++;}}
   if(count>=90&&left>=15&&right>=15)hits.push({y,slope,count});
  }
 }
 hits.sort((a,b)=>b.count-a.count);const lines=[];
 for(const hit of hits)if(lines.every(line=>Math.abs(hit.y+hit.slope*w/2-line.y-line.slope*w/2)>Math.max(12,h*.02)))lines.push(hit);
 if(lines.length!==expected.length-1)return null;
 lines.sort((a,b)=>a.y+a.slope*w/2-b.y-b.slope*w/2);
 const edges=[{y:0,slope:0},...lines,{y:h,slope:0}],regions={};
 for(let i=0;i<expected.length;i++){
  const top=edges[i],bottom=edges[i+1],tl=top.y/h,tr=(top.y+top.slope*(w-1))/h,bl=bottom.y/h,br=(bottom.y+bottom.slope*(w-1))/h;
  if(Math.min(bl-tl,br-tr)<.06)return null;
  const y=Math.min(tl,tr),end=Math.max(bl,br);
  regions[expected[i]['格ID']]={x:0,y,w:1,h:end-y,points:[{x:0,y:tl},{x:1,y:tr},{x:1,y:br},{x:0,y:bl}]};
 }
 return {regions,lines};
}
