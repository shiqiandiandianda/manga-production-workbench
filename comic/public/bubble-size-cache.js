import {bubbleLayout} from './lettering.js';

/** Spacing needs dimensions and a relative tail tip, not a fresh text layout per mouse move. */
export function createBubbleSizeCache(context,{measure=bubbleLayout,limit=1000}={}){
 const entries=new Map();
 function size(bubble){
  const normalized={...bubble,x:0,y:0};
  if(bubble.tail&&bubble.tail.mode!=='normalized'&&Number.isFinite(bubble.tail.x)&&Number.isFinite(bubble.tail.y))normalized.tail={...bubble.tail,x:bubble.tail.x-(bubble.x||0),y:bubble.tail.y-(bubble.y||0)};
  const signature=JSON.stringify(normalized),previous=entries.get(bubble.id);
  if(previous?.signature===signature)return previous.size;
  const layout=measure(context,normalized),value={w:layout.w,h:layout.h,tail:layout.tail?{tip:{...layout.tail.tip}}:null};
  entries.delete(bubble.id);entries.set(bubble.id,{signature,size:value});
  while(entries.size>limit)entries.delete(entries.keys().next().value);
  return value;
 }
 return {size,clear:()=>entries.clear()};
}
