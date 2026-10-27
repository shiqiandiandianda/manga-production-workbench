import fs from 'node:fs/promises';

// Some native decoders mistake SVG text inside PNG provenance metadata for SVG
// content. Retry with only that ancillary chunk omitted in memory; source bytes,
// downloads, hashes and saved asset identities are never changed.
function withoutProvenanceChunk(bytes){
 if(!Buffer.isBuffer(bytes)||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return null;
 const parts=[bytes.subarray(0,8)];let offset=8,removed=false,ended=false;
 while(offset+12<=bytes.length){
  const length=bytes.readUInt32BE(offset),end=offset+12+length;
  if(end>bytes.length)throw Error('PNG 文件不完整');
  const type=bytes.toString('ascii',offset+4,offset+8);
  if(type==='caBX')removed=true;else parts.push(bytes.subarray(offset,end));
  offset=end;if(type==='IEND'){ended=true;break;}
 }
 if(!ended||offset!==bytes.length)throw Error('PNG 文件不完整');
 return removed?Buffer.concat(parts):null;
}
const adapters=new WeakMap();
export function compatibleCanvas(native){
 if(adapters.has(native))return adapters.get(native);
 const adapter={...native,async loadImage(source,options){
  let bytes=source;
  if(typeof source==='string'&&!/^https?:|^data:/i.test(source))bytes=await fs.readFile(source);
  const retry=withoutProvenanceChunk(bytes);
  return native.loadImage(retry||bytes,options);
 }};
 adapters.set(native,adapter);return adapter;
}
