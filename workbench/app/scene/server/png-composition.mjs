import {inflateSync,deflateSync} from 'node:zlib';
const signature=Buffer.from([137,80,78,71,13,10,26,10]);
function invalid(message){return Object.assign(Error('图片拼接失败：'+message),{code:'image_composition_failed',providerConfirmed:true});}
const crcTable=Uint32Array.from({length:256},(_,i)=>{for(let n=0;n<8;n++)i=i&1?0xedb88320^(i>>>1):i>>>1;return i>>>0;});
function chunk(type,data){const name=Buffer.from(type),out=Buffer.alloc(data.length+12);out.writeUInt32BE(data.length);name.copy(out,4);data.copy(out,8);let crc=0xffffffff;for(const value of Buffer.concat([name,data]))crc=crcTable[(crc^value)&255]^(crc>>>8);out.writeUInt32BE((crc^0xffffffff)>>>0,out.length-4);return out;}
export function encodePng({width,height,pixels}){if(pixels.length!==width*height*4)throw invalid('像素尺寸不匹配。');const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=8;header[9]=6;const rows=Buffer.alloc(height*(width*4+1));for(let y=0;y<height;y++)pixels.copy(rows,y*(width*4+1)+1,y*width*4,(y+1)*width*4);return Buffer.concat([signature,chunk('IHDR',header),chunk('IDAT',deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]);}
export function decodePng(bytes){
  if(!bytes.subarray(0,8).equals(signature))throw invalid('需要 PNG 原图。');let width,height,depth,color,interlace,palette,transparency;const idat=[];
  for(let offset=8;offset+12<=bytes.length;){const length=bytes.readUInt32BE(offset),type=bytes.toString('ascii',offset+4,offset+8);if(length>40*1024*1024||offset+length+12>bytes.length)throw invalid('PNG 数据不完整。');const data=bytes.subarray(offset+8,offset+8+length);if(type==='IHDR'){width=data.readUInt32BE(0);height=data.readUInt32BE(4);depth=data[8];color=data[9];interlace=data[12];}if(type==='PLTE')palette=data;if(type==='tRNS')transparency=data;if(type==='IDAT')idat.push(data);offset+=length+12;if(type==='IEND')break;}
  if(!width||!height||width*height>16000000||interlace!==0)throw invalid('原图尺寸过大或使用不支持的隔行编码，请重新生成此版。');
  const channels={0:1,2:3,3:1,4:2,6:4}[color];if(!channels||![1,2,4,8,16].includes(depth)||(color!==0&&color!==3&&depth<8)||color===3&&depth===16)throw invalid('原图色彩编码不支持。');
  const stride=Math.ceil(width*channels*depth/8),bpp=Math.max(1,Math.ceil(channels*depth/8));let raw;try{raw=inflateSync(Buffer.concat(idat),{maxOutputLength:height*(stride+1)});}catch{throw invalid('原图压缩数据损坏。');}if(raw.length!==height*(stride+1))throw invalid('原图像素不完整。');const rows=Buffer.alloc(height*stride);
  for(let y=0;y<height;y++){const filter=raw[y*(stride+1)];if(filter>4)throw invalid('原图过滤器无效。');for(let x=0;x<stride;x++){const a=x>=bpp?rows[y*stride+x-bpp]:0,b=y?rows[(y-1)*stride+x]:0,c=y&&x>=bpp?rows[(y-1)*stride+x-bpp]:0;let prediction=0;if(filter===1)prediction=a;if(filter===2)prediction=b;if(filter===3)prediction=Math.floor((a+b)/2);if(filter===4){const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);prediction=pa<=pb&&pa<=pc?a:pb<=pc?b:c;}rows[y*stride+x]=(raw[y*(stride+1)+1+x]+prediction)&255;}}
  const pixels=Buffer.alloc(width*height*4),maximum=2**depth-1;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){const sample=channel=>{const n=x*channels+channel;if(depth===16)return rows.readUInt16BE(y*stride+n*2);if(depth===8)return rows[y*stride+n];return (rows[y*stride+Math.floor(n*depth/8)]>>(8-depth-(n*depth%8)))&maximum;};const pos=(y*width+x)*4;const convert=n=>Math.round(n*255/maximum);let alpha=255;
    if(color===3){const index=sample(0);if(!palette||index*3+2>=palette.length)throw invalid('原图调色板损坏。');palette.copy(pixels,pos,index*3,index*3+3);alpha=transparency?.[index]??255;}
    else if(color===0||color===4){const gray=sample(0);pixels.fill(convert(gray),pos,pos+3);if(color===4)alpha=convert(sample(1));else if(transparency?.length>=2&&gray===transparency.readUInt16BE())alpha=0;}
    else{const r=sample(0),g=sample(1),b=sample(2);pixels[pos]=convert(r);pixels[pos+1]=convert(g);pixels[pos+2]=convert(b);if(color===6)alpha=convert(sample(3));else if(transparency?.length>=6&&r===transparency.readUInt16BE()&&g===transparency.readUInt16BE(2)&&b===transparency.readUInt16BE(4))alpha=0;}pixels[pos+3]=alpha;
  }return {width,height,pixels};
}
export function stackShots(forward,reverse,size='1536x864'){
  const [width,height]=size.split('x').map(Number);if(![[1536,864],[2048,1152]].some(([w,h])=>w===width&&h===height))throw invalid('单幅必须为 16:9。');
  const result=Buffer.alloc(width*height*2*4);
  for(const [index,bytes]of [forward,reverse].entries()){const source=decodePng(bytes),ratio=source.width/source.height;if(ratio<1.65||ratio>1.9)throw invalid('模型未返回横向 16:9 单幅，请重新生成此版。');const zoom=Math.max(width/source.width,height/source.height),cropX=(source.width-width/zoom)/2,cropY=(source.height-height/zoom)/2;
    for(let y=0;y<height;y++){const sy=Math.max(0,Math.min(source.height-1,(y+.5)/zoom-.5+cropY)),y0=Math.floor(sy),y1=Math.min(source.height-1,y0+1),dy=sy-y0;for(let x=0;x<width;x++){const sx=Math.max(0,Math.min(source.width-1,(x+.5)/zoom-.5+cropX)),x0=Math.floor(sx),x1=Math.min(source.width-1,x0+1),dx=sx-x0,dest=((index*height+y)*width+x)*4;for(let c=0;c<4;c++)result[dest+c]=Math.round((source.pixels[(y0*source.width+x0)*4+c]*(1-dx)+source.pixels[(y0*source.width+x1)*4+c]*dx)*(1-dy)+(source.pixels[(y1*source.width+x0)*4+c]*(1-dx)+source.pixels[(y1*source.width+x1)*4+c]*dx)*dy);}}
  }return encodePng({width,height:height*2,pixels:result});
}
