// Budgets account for retained JS data / decoded pixels, not total process RSS.
const caches=new Set();
export function estimateRetainedBytes(value,limit=Infinity){
 let bytes=0;const pending=[value],seen=new WeakSet();
 while(pending.length&&bytes<=limit){const item=pending.pop();if(typeof item==='string'){bytes+=40+item.length*2;continue;}if(!item||typeof item!=='object'){bytes+=8;continue;}if(seen.has(item))continue;seen.add(item);
  if(ArrayBuffer.isView(item)||item instanceof ArrayBuffer){bytes+=64+item.byteLength;continue;}
  bytes+=64;if(item instanceof Map){for(const [k,v]of item){bytes+=24;pending.push(k,v);}}else if(item instanceof Set){for(const v of item)pending.push(v);}else for(const k of Object.keys(item)){bytes+=24+k.length*2;pending.push(item[k]);}
 }
 return bytes;
}
export class BoundedCache{
 constructor({name='cache',maxEntries=64,maxBytes=8*1024*1024,ttl=300000,lowWater=.75,now=Date.now}={}){this.name=name;this.maxEntries=maxEntries;this.maxBytes=maxBytes;this.ttl=ttl;this.lowWater=lowWater;this.now=now;this.entries=new Map();this.bytes=0;this.evicted=0;this.expired=0;caches.add(new WeakRef(this));}
 get size(){return this.entries.size;}
 get(key){const entry=this.entries.get(key);if(!entry)return undefined;if(entry.expires<=this.now()){this.delete(key);this.expired++;return undefined;}this.entries.delete(key);this.entries.set(key,entry);return entry.value;}
 has(key){return this.get(key)!==undefined;}
 set(key,value,bytes=estimateRetainedBytes(value,this.maxBytes)){this.delete(key);this.sweep();if(bytes>this.maxBytes||this.maxEntries<1)return this;this.entries.set(key,{value,bytes,expires:this.now()+this.ttl});this.bytes+=bytes;
  if(this.bytes>this.maxBytes||this.size>this.maxEntries){const targetBytes=this.maxBytes*this.lowWater,targetEntries=Math.max(1,Math.floor(this.maxEntries*this.lowWater));while(this.size>1&&(this.bytes>targetBytes||this.size>targetEntries)){this.delete(this.entries.keys().next().value);this.evicted++;}}
  return this;
 }
 delete(key){const entry=this.entries.get(key);if(!entry)return false;this.bytes-=entry.bytes;return this.entries.delete(key);}
 clear(){this.entries.clear();this.bytes=0;}
 sweep(){const now=this.now();for(const [key,entry]of this.entries)if(entry.expires<=now){this.delete(key);this.expired++;}}
 stats(){return {name:this.name,entries:this.size,estimatedBytes:this.bytes,maxEntries:this.maxEntries,maxBytes:this.maxBytes,evicted:this.evicted,expired:this.expired};}
}
// Pending reads are coalesced separately and never evicted as if they were data.
export function createAsyncCache(options={}){
 const cache=new BoundedCache(options),pending=new Map();let generation=0;
 async function load(key,reader){const value=cache.get(key);if(value!==undefined)return value;if(pending.has(key))return pending.get(key);
  if(pending.size>=(options.maxPending||16)){await Promise.race(pending.values()).catch(()=>{});return load(key,reader);}
  const ticket=generation,promise=Promise.resolve().then(reader).then(result=>{if(ticket===generation&&pending.get(key)===promise)cache.set(key,result,options.weight?.(result));return result;}).finally(()=>{if(pending.get(key)===promise)pending.delete(key);});pending.set(key,promise);return promise;
 }
 return {load,delete(key){cache.delete(key);pending.delete(key);},clear(){generation++;cache.clear();pending.clear();},stats:()=>({...cache.stats(),pending:pending.size})};
}
export function memoryCacheStats(){const result=[];for(const ref of caches){const cache=ref.deref();if(cache)result.push(cache.stats());else caches.delete(ref);}return result;}
export function sweepMemoryCaches(){for(const ref of caches){const cache=ref.deref();if(cache)cache.sweep();else caches.delete(ref);}}
if(typeof window!=='undefined'){setInterval(sweepMemoryCaches,30000);document.addEventListener('visibilitychange',sweepMemoryCaches);}
