import {estimateRetainedBytes} from './bounded-cache.js';
export const UNDO_MEMORY_LIMITS=Object.freeze({steps:50,bytes:128*1024*1024,lowWater:.75});
// Trim the oldest recovery states, never the edited document or a live gesture.
export function createUndoMemoryBudget(limits=UNDO_MEMORY_LIMITS){
 const weights=new WeakMap();let evicted=0;
 const weight=snapshot=>{if(!weights.has(snapshot))weights.set(snapshot,estimateRetainedBytes(snapshot));return weights.get(snapshot);};
 function trim(history,future,{prefer='history'}={}){
  let bytes=[...history,...future].reduce((n,s)=>n+weight(s),0),removed=0;
  const over=bytes>limits.bytes,target=over?limits.bytes*limits.lowWater:limits.bytes;
  while(history.length+future.length&&(bytes>target||history.length+future.length>limits.steps)){
   if(history.length+future.length===1&&bytes<=limits.bytes)break;
   const stack=prefer==='history'?(history.length?history:future):(future.length?future:history);bytes-=weight(stack.shift());removed++;
  }
  evicted+=removed;return {estimatedBytes:bytes,steps:history.length+future.length,removed,evicted,maxBytes:limits.bytes};
 }
 return {trim};
}
