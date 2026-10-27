// Decode raster pixels without ancillary metadata. Keep and hash the original bytes for storage.
// Native Skia can mis-detect PNG as SVG when C2PA/caBX metadata contains an SVG thumbnail.
export function rasterDecodeBytes(bytes){
 if(!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return bytes;
 const chunks=[bytes.subarray(0,8)];let at=8,ended=false;
 while(at+12<=bytes.length){const length=bytes.readUInt32BE(at),type=bytes.toString('ascii',at+4,at+8),next=at+12+length;if(next>bytes.length)throw Error('PNG数据不完整');if(['IHDR','PLTE','IDAT','IEND','tRNS'].includes(type))chunks.push(bytes.subarray(at,next));at=next;if(type==='IEND'){ended=true;break;}}
 if(!ended||at!==bytes.length)throw Error('PNG数据不完整');return Buffer.concat(chunks);
}
