export function validateDeliveryCuts(height,cuts){
 if(!Number.isSafeInteger(height)||height<3||!Array.isArray(cuts)||cuts.length!==2||!cuts.every(Number.isSafeInteger)||cuts[0]<1||cuts[0]>=cuts[1]||cuts[1]>=height)throw Object.assign(Error('两个切点必须依次位于正文内部，且三张图片均有内容'),{status:400});
 return [0,...cuts,height].slice(0,-1).map((start,i)=>({start,end:[...cuts,height][i],height:[...cuts,height][i]-start}));
}
export const deliveryCutSafe=(y,gaps,protectedRanges=[])=>gaps.some(g=>y>=g.start+2&&y<=g.end-2)&&!protectedRanges.some(r=>y>=r.start&&y<=r.end);
export function deliveryCutsSafe(cuts,gaps,protectedRanges=[]){const indexes=cuts.map(y=>gaps.findIndex(g=>y>=g.start+2&&y<=g.end-2));return indexes.length===2&&indexes[0]>=0&&indexes[0]!==indexes[1]&&cuts.every(y=>deliveryCutSafe(y,gaps,protectedRanges));}
export function chooseDeliveryCuts(height,gaps){
 const points=gaps.filter(g=>g.end-g.start>=24&&g.start>0&&g.end<height).map(g=>({...g,y:Math.round((g.start+g.end)/2)})).sort((a,b)=>a.y-b.y);
 let best=null;
 for(let i=0;i<points.length;i++)for(let j=i+1;j<points.length;j++){
  const a=points[i],b=points[j],sizes=[a.y,b.y-a.y,height-b.y];if(Math.min(...sizes)<height*.12)continue;
  const imbalance=sizes.reduce((n,h)=>n+Math.abs(h/height-1/3),0),score=Math.log1p(a.end-a.start)+Math.log1p(b.end-b.start)-imbalance*14;
  if(!best||score>best.score)best={score,cuts:[a.y,b.y]};
 }
 return best?{cuts:best.cuts,automatic:true}:{cuts:[Math.max(1,Math.round(height/3)),Math.min(height-1,Math.round(height*2/3))],automatic:false};
}
