import {createRequire} from 'node:module';
import {colorFamily,blackLike,colorRGB} from '../public/local-background-policy.js';
const require=createRequire(import.meta.url),hex=rgb=>'#'+rgb.map(v=>Math.round(v).toString(16).padStart(2,'0')).join('');
/** Pixel observations are candidates, never an assertion of semantic identity. */
export function sampleArtworkPixels(bytes,{sha256,width,height,exclusions=[]}={}){
 const side=width||Math.sqrt(bytes.length/4),rows=height||bytes.length/4/side,bins=new Map();let sampled=0;
 for(let i=0;i<bytes.length;i+=4){const index=i/4,x=(index%side)/side,y=Math.floor(index/side)/rows;
  if(exclusions.some(r=>x>=r.x&&x<=r.x+r.w&&y>=r.y&&y<=r.y+r.h)||bytes[i+3]<220)continue;
  const rgb=[bytes[i],bytes[i+1],bytes[i+2]],max=Math.max(...rgb),min=Math.min(...rgb);sampled++;
  if(min>224||max<32)continue;
  const key=rgb.map(v=>Math.min(7,Math.floor(v/32))).join(','),bin=bins.get(key)||{count:0,rgb:[0,0,0],tiles:new Set()};
  bin.count++;bin.tiles.add(Math.floor(x*4)+4*Math.floor(y*4));for(let c=0;c<3;c++)bin.rgb[c]+=rgb[c];bins.set(key,bin);
 }
 const families=new Map();
 for(const b of bins.values())if(b.count>=Math.max(3,sampled*.005)){
  const color=hex(b.rgb.map(v=>v/b.count));if(blackLike(color))continue;const family=colorFamily(color),group=families.get(family)||[];group.push({...b,color});families.set(family,group);
 }
 const candidates=[...families].map(([family,members])=>{
  // Select an existing representative bin of this local hue family, never the whole-strip average.
  const cost=a=>members.reduce((sum,b)=>{const x=colorRGB(a.color),y=colorRGB(b.color);return sum+b.count*Math.sqrt(x.reduce((s,v,i)=>s+(v-y[i])**2,0));},0),representative=[...members].sort((a,b)=>cost(a)-cost(b))[0],tiles=[...new Set(members.flatMap(b=>[...b.tiles]))],sides=[tiles.some(n=>n<4),tiles.some(n=>n>=12),tiles.some(n=>n%4===0),tiles.some(n=>n%4===3)].filter(Boolean).length;
  return {color:representative.color,family,coverage:members.reduce((n,b)=>n+b.count,0)/Math.max(1,sampled),spatialTiles:tiles.length,tileIds:tiles,edgeSides:sides,representativeMethod:'local-hue-family-medoid'};
 }).sort((a,b)=>b.coverage-a.coverage);
 return {version:2,status:candidates.length?'candidates':'pending',sha256,candidates,method:'masked-interior-pixel-candidates-v2',reason:candidates.length?'局部颜色候选，须结合人物、衣料、环境及光线依据':'主色待确认'};
}
export async function sampleArtworkPalette(item){
 if(item.paletteUnsafeText)return {version:2,status:'pending',sha256:item.sha256,candidates:[],method:'masked-interior-pixel-candidates-v2',reason:'主色待确认：旋转或翻转文字区域尚未准确排除'};
 const {createCanvas,loadImage}=require(process.env.COMIC_CANVAS_MODULE||'@napi-rs/canvas'),image=await loadImage(item.filePath),canvas=createCanvas(96,96),ctx=canvas.getContext('2d'),inset=.08;
 ctx.drawImage(image,image.width*inset,image.height*inset,image.width*(1-2*inset),image.height*(1-2*inset),0,0,96,96);
 const exclusions=(item.paletteExclusions||[]).map(r=>({x:(r.x-inset)/(1-2*inset),y:(r.y-inset)/(1-2*inset),w:r.w/(1-2*inset),h:r.h/(1-2*inset)}));
 const bytes=ctx.getImageData(0,0,96,96).data,result=sampleArtworkPixels(bytes,{sha256:item.sha256,width:96,height:96,exclusions});
 result.regionObservations=(item.paletteRegions||[]).filter(r=>r.confirmed===true&&r.sourceSha256===item.sha256&&r.rect&&['environment','light','person','clothing'].includes(r.role)).map(r=>{
  const normalized={x:(r.rect.x-inset)/(1-2*inset),y:(r.rect.y-inset)/(1-2*inset),w:r.rect.w/(1-2*inset),h:r.rect.h/(1-2*inset)},outside=[];
  if(normalized.x>0)outside.push({x:0,y:0,w:normalized.x,h:1});if(normalized.y>0)outside.push({x:0,y:0,w:1,h:normalized.y});if(normalized.x+normalized.w<1)outside.push({x:normalized.x+normalized.w,y:0,w:1,h:1});if(normalized.y+normalized.h<1)outside.push({x:0,y:normalized.y+normalized.h,w:1,h:1});
  return {...r,candidates:sampleArtworkPixels(bytes,{width:96,height:96,exclusions:[...exclusions,...outside]}).candidates};
 });return result;
}
