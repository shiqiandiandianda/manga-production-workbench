const overlaps=(a,b)=>a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y;
export function panelNoteBox(frameBox,obstacles=[],padding=12){
 let candidates=[frameBox];
 for(const item of obstacles){
  const obstacle={x:item.x-padding,y:item.y-padding,w:item.w+padding*2,h:item.h+padding*2};
  if(!overlaps(frameBox,obstacle))continue;
  const next=[];
  for(const box of candidates){
   if(!overlaps(box,obstacle)){next.push(box);continue;}
   next.push({x:box.x,y:box.y,w:box.w,h:obstacle.y-box.y},
    {x:box.x,y:obstacle.y+obstacle.h,w:box.w,h:box.y+box.h-obstacle.y-obstacle.h},
    {x:box.x,y:box.y,w:obstacle.x-box.x,h:box.h},
    {x:obstacle.x+obstacle.w,y:box.y,w:box.x+box.w-obstacle.x-obstacle.w,h:box.h});
  }
  candidates=next.filter(box=>box.w>0&&box.h>0).sort((a,b)=>b.w*b.h-a.w*a.h).slice(0,24);
  if(!candidates.length)return null;
 }
 return candidates[0]||null;
}
