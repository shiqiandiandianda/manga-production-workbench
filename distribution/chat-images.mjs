/** Raster magic bytes only. Never inline HTML or SVG based on a file's name. */
export function chatImageMime(bytes){
 if(bytes.length>=24&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&bytes.toString('ascii',12,16)==='IHDR'&&bytes.readUInt32BE(16)>0&&bytes.readUInt32BE(20)>0)return 'image/png';
 if(bytes.length>=3&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return 'image/jpeg';
 if(bytes.length>=13&&/^GIF8[79]a$/.test(bytes.toString('ascii',0,6))&&bytes.readUInt16LE(6)>0&&bytes.readUInt16LE(8)>0)return 'image/gif';
 if(bytes.length>=30&&bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)=='WEBP'&&['VP8 ','VP8L','VP8X'].includes(bytes.toString('ascii',12,16)))return 'image/webp';
 return null;
}
