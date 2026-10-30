// Automatic placement of sound-effect words and atmosphere lines inside a planned panel.
// Pure geometry: no network, no file access. Library images are referenced by style id; the
// server resolves them, and a caller-supplied `available(styleId)` decides when to fall back
// to an editable brush-text layer.
import {comicStyles,comicStyle,normalizeSfxWord,applyEffectVisual} from './comic-styles.js';
import {makeSfxLayer} from './sfx-library.js';

const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const hash=text=>{let h=2166136261;for(const c of String(text)){h^=c.codePointAt(0);h=Math.imul(h,16777619);}return h>>>0;};
const area=r=>Math.max(0,r.w)*Math.max(0,r.h);
const intersection=(a,b)=>{const x=Math.max(a.x,b.x),y=Math.max(a.y,b.y),r=Math.min(a.x+a.w,b.x+b.w),d=Math.min(a.y+a.h,b.y+b.h);return r>x&&d>y?{x,y,w:r-x,h:d-y}:{x,y,w:0,h:0};};

const IMPACT=/[砰嘭轰当铛锵铮噗咔嚓啪咚哐踏]/u,SPEED=/[嗖咻唰刷呼飕]/u,CRACK=/[咔嚓啪裂]/u;
/** impact：撞击、刺中；speed：疾速、风声；ambient：环境音、小动作。 */
export function sfxCategory(word){const w=normalizeSfxWord(word);return IMPACT.test(w)?'impact':SPEED.test(w)?'speed':'ambient';}

const libraryWords=()=>[...new Set(comicStyles.filter(item=>item.kind==='sfx').map(item=>normalizeSfxWord(item.word)).filter(Boolean))].sort((a,b)=>b.length-a.length);
/**
 * 把拟声字拆成素材库里已有的字效，字形必须完全一样：
 * 嗡嗡嗡 → 嗡 嗡 嗡；咔嚓咔嚓 → 咔嚓 咔嚓。拆不完的返回 null，交给文字字效，绝不替换成别的字。
 */
export function segmentEffectWord(word,words=libraryWords()){
 const text=normalizeSfxWord(word);if(!text)return null;
 const parts=[];let i=0;
 while(i<text.length){const match=words.find(w=>text.startsWith(w,i));if(!match)return null;parts.push(match);i+=match.length;}
 return parts;
}
function pickStyle(word,key,seed){
 const candidates=comicStyles.filter(item=>item.kind==='sfx'&&normalizeSfxWord(item.word)===word);
 return candidates.length?candidates[hash(seed+':'+word+':'+key)%candidates.length]:null;
}
/** 格内候选落点（中心点，相对画格）。冲击字可以压出画格边框。 */
const SPOTS=[{x:.2,y:.2,side:'left'},{x:.8,y:.2,side:'right'},{x:.2,y:.78,side:'left'},{x:.8,y:.78,side:'right'},{x:.12,y:.5,side:'left'},{x:.88,y:.5,side:'right'}];
function chooseSpot({frame,size,avoid,category,seedKey,taken,contain=false}){
 const bleed=contain?0:category==='impact'?.12:category==='speed'?.06:0;
 let best=null;
 for(const [index,spot] of SPOTS.entries()){
  const cx=frame.x+frame.w*spot.x+(spot.side==='left'?-1:1)*size.w*bleed,cy=frame.y+frame.h*spot.y;
  const rect={x:cx-size.w/2,y:cy-size.h/2,w:size.w,h:size.h};
  if(contain){rect.x=clamp(rect.x,frame.x,frame.x+frame.w-size.w);rect.y=clamp(rect.y,frame.y,frame.y+frame.h-size.h);}
  let cost=0;
  for(const r of avoid)cost+=area(intersection(rect,r.rect))*r.weight;
  for(const r of taken)cost+=area(intersection(rect,r))*6;
  cost/=Math.max(1,area(rect));
  cost+=((hash(seedKey+':'+index)%100)/100)*.05;// 稳定但不千篇一律
  if(!best||cost<best.cost)best={cost,rect,spot};
 }
 return best;
}
/**
 * 为一个画格生成拟声字图层。
 * words：本格拟声字；intensity：1—5；letters：本格已排好的气泡（避让）；faces：人物脸部锚点（避让）。
 */
export function placePanelSfx({words,frame,page,intensity=3,letters=[],faces=[],makeId,seed='comic-library-v1',available=()=>true,key='',chooseStyle=null,contain=false}){
 const layers=[],taken=[];
 const avoid=[...letters.map(b=>({rect:{x:b.x,y:b.y,w:b.w,h:b.h},weight:5})),...faces.map(p=>({rect:{x:p.x-frame.w*.12,y:p.y-frame.h*.12,w:frame.w*.24,h:frame.h*.24},weight:2}))];
 for(const raw of words){
  const word=normalizeSfxWord(raw);if(!word)continue;
  const category=sfxCategory(word),parts=segmentEffectWord(word);
  const chosen=chooseStyle?.(word,key),styles=chosen?[chosen]:parts?.map((part,i)=>pickStyle(part,key+':'+i,seed));
  const useImages=styles&&styles.every(style=>style&&(style.assetId||available(style.id)));
  const scale=clamp((category==='impact'?.3:category==='speed'?.26:.17)+(intensity-3)*.05,.14,.5);
  const baseW=Math.round(clamp(frame.w*scale,150,560));
  if(useImages){
   // 叠字按序错落、逐个缩小，读起来仍是原来的字。
   const group=styles.map((style,i)=>{const w=Math.round(baseW*Math.pow(.82,i)),h=Math.round(w*style.height/style.width);return {style,w,h};});
   const box={w:Math.max(...group.map((g,i)=>g.w+i*baseW*.35)),h:Math.max(...group.map((g,i)=>g.h+i*baseW*.22))};
   if(contain){const fit=Math.min(1,frame.w*.9/box.w,frame.h*.9/box.h);for(const g of group){g.w=Math.round(g.w*fit);g.h=Math.round(g.h*fit);}box.w*=fit;box.h*=fit;}
   const spot=chooseSpot({frame,size:box,avoid,category,seedKey:key+word,taken,contain});
   const tilt=(spot.spot.side==='left'?-1:1)*(category==='impact'?10:category==='speed'?14:4);
   group.forEach((g,i)=>{
    const layer=applyEffectVisual({id:makeId('bubble'),text:g.style.word,name:word+' · 字效',visible:true,locked:false,x:0,y:0,w:g.w,h:g.h,fontSize:96,fontFamily:'source-han-sans'},g.style);
    layer.w=g.w;layer.h=g.h;layer.rotation=tilt;layer.sfxAuto=category;
    const step=contain?Math.min(baseW*.35,(frame.w-g.w)/Math.max(1,group.length)):baseW*.35;
    layer.x=Math.round(contain?clamp(spot.rect.x+i*step,frame.x,frame.x+frame.w-g.w):clamp(spot.rect.x+i*step,8-g.w*.2,page.width-8-g.w*.8));layer.y=Math.round(contain?clamp(spot.rect.y+i*baseW*.22,frame.y,frame.y+frame.h-g.h):spot.rect.y+i*baseW*.22);
    layers.push(layer);
   });
   taken.push(spot.rect);
  }else{
   // 素材库没有完全一致的字形：用可编辑的毛笔文字字效，文字保持原样。
   const preset=CRACK.test(word)?'crack':category==='speed'?'speed':'impact';
   const layer=makeSfxLayer({id:makeId('bubble'),text:String(raw).trim().slice(0,24),preset,page,frame});
   const ratio=clamp(baseW/layer.w,.45,1.6);
   for(const field of ['w','h','outlineWidth','shadowOffsetX','shadowOffsetY'])if(Number.isFinite(layer[field]))layer[field]=Math.round(layer[field]*ratio);
   if(category==='ambient')layer.rotation=-4;
   const spot=chooseSpot({frame,size:{w:layer.w,h:layer.h},avoid,category,seedKey:key+word,taken,contain});
   layer.x=Math.round(clamp(spot.rect.x,8,page.width-8-layer.w));layer.y=Math.round(spot.rect.y);layer.name=word+' · 字效';layer.sfxAuto=category;
   layers.push(layer);taken.push(spot.rect);
  }
 }
 return layers;
}

const ATMOSPHERE_KEYWORDS={集中线:/集中线|聚焦|汇聚/u,速度线:/速度线|飞驰/u,冲击线:/冲击/u,爆发线:/爆发/u,惊悚线:/惊悚|悬疑|垂降/u};
/** 氛围列：自动 / 无 / 集中线 / 速度线 / 冲击线 / 爆发线 / 惊悚线。“自动”只在高潮主格和惊恐反应时加。 */
export function atmosphereKind({setting='',beat='',intensity=3,mood='',words=[]}){
 if(setting==='无')return null;
 if(setting&&setting!=='自动')return Object.hasOwn(ATMOSPHERE_KEYWORDS,setting)?setting:null;
 if(beat==='高潮'&&intensity>=5)return words.some(w=>sfxCategory(w)==='speed')?'速度线':'集中线';
 if(mood==='恐惧'&&intensity>=4&&['反应','揭示'].includes(beat))return '惊悚线';
 return null;
}
/** 把一张氛围线素材铺在画格内（等比放入，不压出画格）。 */
export function placeAtmosphere({kind,frame,makeId,seed='comic-library-v1',key='',available=()=>true}){
 const pattern=ATMOSPHERE_KEYWORDS[kind];if(!pattern)return null;
 const options=comicStyles.filter(item=>item.kind==='atmosphere'&&pattern.test(item.label)&&available(item.id));
 if(!options.length)return null;
 const portrait=frame.h>frame.w,ranked=options.sort((a,b)=>((b.height>b.width)===portrait)-((a.height>a.width)===portrait)),best=ranked.filter(item=>(item.height>item.width)===(ranked[0].height>ranked[0].width));
 const style=best[hash(seed+':'+kind+':'+key)%best.length];
 const scale=Math.min(frame.w/style.width,frame.h/style.height),w=Math.round(style.width*scale),h=Math.round(style.height*scale);
 const layer=applyEffectVisual({id:makeId('bubble'),text:'',name:kind+' · 氛围',visible:true,locked:false,x:0,y:0,w,h,fontSize:96,fontFamily:'source-han-sans'},{...style,word:''});
 Object.assign(layer,{w,h,x:Math.round(frame.x+(frame.w-w)/2),y:Math.round(frame.y+(frame.h-h)/2),rotation:0,atmosphere:kind,sfxAuto:'atmosphere'});
 return layer;
}
export const atmosphereStyle=id=>comicStyle(id)?.kind==='atmosphere'?comicStyle(id):null;
/** 拟声字列的原始写法（“嗖／唳~~~”“无”）拆成单个拟声字。 */
export function sfxWordsFrom(value){
 return String(value??'').split(/[\n、,，;；|／/]+/u).map(word=>word.replace(/^\s*(?:特效字|音效字|拟声词|音效)[：:]?/u,'').trim()).filter(word=>normalizeSfxWord(word)&&!/^(?:无|暂无|没有|无特效字|无音效|none)$/iu.test(normalizeSfxWord(word)));
}
/**
 * 一格的氛围线与拟声字：氛围线紧贴在画格图层之上，拟声字在最上层；均避开本格气泡和人物脸部。
 */
export function decoratePanelEffects({page,frame,shotId,words=[],intensity=3,beat='',mood='',atmosphere='',makeId,layerOrder,available=()=>true,key=''}){
 const letters=page.bubbles.filter(b=>b.parentPanelId===frame.id&&b.type!=='sfx');
 const faces=Object.values(frame.layoutIntent?.faceAnchors||{}).map(p=>({x:frame.x+frame.w*p.x,y:frame.y+frame.h*p.y}));
 const added=[];
 const kind=atmosphereKind({setting:atmosphere,beat,intensity,mood,words});
 const lines=kind&&placeAtmosphere({kind,frame,makeId,key,available});
 if(lines){Object.assign(lines,{shotId,parentPanelId:frame.id});page.bubbles.push(lines);const at=layerOrder.indexOf(frame.id);if(at>=0)layerOrder.splice(at+1,0,lines.id);else layerOrder.push(lines.id);added.push(lines);}
 for(const layer of placePanelSfx({words,frame,page,intensity,letters,faces,makeId,available,key})){Object.assign(layer,{shotId,parentPanelId:frame.id});page.bubbles.push(layer);layerOrder.push(layer.id);added.push(layer);}
 return added;
}
