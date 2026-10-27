import {chineseFonts,defaultTextFont,fontNameInChinese} from './font-catalog.mjs';
export {chineseFonts,defaultTextFont};
const catalog=new Map(chineseFonts.map(font=>[font.family,font])),cache=new Map();
export function registerLibraryFont(font){const entry={family:font.family,label:fontNameInChinese(font.name,catalog.size+1),faces:[{weight:400,file:font.revisionId,url:font.url}]};catalog.set(font.family,entry);if(!chineseFonts.some(f=>f.family===font.family))chineseFonts.push(entry);return entry;}
let projectAssets=[],projectFaces=new Map(),projectFontRevision=0;
export function setProjectFontAssets(assets=[]){
 for(const entry of projectFaces.values())if(entry.face&&globalThis.document?.fonts?.delete)document.fonts.delete(entry.face);
 projectFontRevision++;projectFaces=new Map();cache.clear();
 projectAssets=Array.isArray(assets)?assets.map(asset=>({...asset,url:asset.url?.replace(/^\/repair\//,'/')})).filter(asset=>typeof asset.family==='string'&&Number.isInteger(Number(asset.weight))&&Number(asset.weight)>=1&&Number(asset.weight)<=1000&&/^\/project-fonts\/[a-f0-9]{32}\/[a-f0-9]{64}\.(?:otf|ttf|ttc|woff2)$/i.test(asset.url||'')).map(asset=>({...asset,weight:Number(asset.weight),alias:'ProjectFont_'+asset.url.split('/')[2]+'_'+asset.url.split('/')[3].split('.')[0]+'_'+asset.weight})):[];
}
function projectFace(family,weight){const selected=Number(fontChoice(family,weight)?.face.weight)||Number(weight);return projectAssets.find(asset=>asset.family===family&&asset.weight===selected);}
export function textFontStack(layer={}){
 const family=layer.fontFamily||defaultTextFont,weight=textFontWeight(layer),primary=projectFace(family,weight)?.alias||family,fallback=projectFace(defaultTextFont,weight)?.alias||defaultTextFont;
 return `"${primary.replaceAll('"','')}","${fallback.replaceAll('"','')}",sans-serif`;
}
function loadSelectedFont(family,weight,onReady){
 const asset=projectFace(family,weight);if(!asset)return browserLoader().load(family,weight,onReady);
 let entry=projectFaces.get(asset.url);
 if(!entry){
  const revision=projectFontRevision,face=new FontFace(asset.alias,`url("/repair${asset.url}")`,{weight:String(asset.weight),style:'normal'});
  entry={face,loaded:false,callbacks:new Set()};projectFaces.set(asset.url,entry);
  entry.promise=face.load().then(loaded=>{if(revision===projectFontRevision){document.fonts.add(loaded);entry.loaded=true;for(const callback of entry.callbacks)callback();entry.callbacks.clear();}return loaded;}).catch(error=>{if(revision===projectFontRevision)projectFaces.delete(asset.url);throw new Error('工程字体加载失败，请重新导入工程',{cause:error});});
 }
 if(onReady&&!entry.loaded)entry.callbacks.add(onReady);
 return entry.promise;
}
function normalizedWeight(value=400){if(typeof value==='boolean')return value?700:400;const number=Number(value);return Number.isInteger(number)&&number>=1&&number<=1000?number:400;}
export function textFontWeight(layer={}){return layer.fontWeight!==undefined&&layer.fontWeight!==null?normalizedWeight(layer.fontWeight):layer.bold?700:400;}
export function availableFontWeights(family){const font=catalog.get(family);return font?[...new Set(font.faces.map(face=>Number(face.weight)))].sort((a,b)=>a-b):[400,700];}
export function fontWeightLabel(weight){return ({100:'极细',200:'特细',250:'特细',300:'细体',350:'偏细',400:'常规',500:'中等',600:'半粗',700:'粗体',800:'特粗',900:'重黑'})[weight]||'自定义';}
export function fontChoice(family,weight=400){const font=catalog.get(family);if(!font)return null;weight=normalizedWeight(weight);const faces=[...font.faces].sort((a,b)=>Math.abs(Number(a.weight)-weight)-Math.abs(Number(b.weight)-weight)||Number(a.weight)-Number(b.weight));return {font,face:faces[0]};}
export function setFontWeightSelection(select,family,weight=400,{preserve=false}={}){
 weight=normalizedWeight(weight);const weights=availableFontWeights(family),legacy=preserve&&!weights.includes(weight);
 if(legacy)weights.push(weight);weights.sort((a,b)=>a-b);
 select.replaceChildren(...weights.map(value=>{const option=document.createElement('option');option.value=String(value);option.textContent=`${fontWeightLabel(value)} ${value}${legacy&&value===weight?'（旧样式）':''}`;return option;}));
 select.value=String(weights.includes(weight)?weight:Number(fontChoice(family,weight)?.face.weight)||400);
}
export function createFontLoader({createFace,addFace}={}){
 const entries=new Map();
 return {load(family,weight=400,onReady){
  const choice=fontChoice(family,weight);if(!choice)return Promise.resolve();
  const key=choice.face.file;let entry=entries.get(key);
  if(!entry){entry={loaded:false,callbacks:new Set()};entries.set(key,entry);
   const face=createFace(choice.font.family,`url("${choice.face.url||'/repair/fonts/'+choice.face.file}")`,{weight:choice.face.weight,style:'normal'});
   entry.promise=face.load().then(loaded=>{addFace(loaded);entry.loaded=true;for(const callback of entry.callbacks)callback();entry.callbacks.clear();return loaded;}).catch(error=>{entries.delete(key);throw new Error(`${choice.font.label}加载失败，请重试`,{cause:error});});
  }
  if(onReady&&!entry.loaded)entry.callbacks.add(onReady);
  return entry.promise;
 }};
}
let loader;
function browserLoader(){return loader||=createFontLoader({createFace:(...args)=>new FontFace(...args),addFace:face=>document.fonts.add(face)});}
export function ensureTextFont(layer){const family=layer.fontFamily||defaultTextFont,weight=textFontWeight(layer);return Promise.all([loadSelectedFont(family,weight),...(family!==defaultTextFont?[loadSelectedFont(defaultTextFont,weight)]:[])]);}
export async function ensureLayerFonts(layers){await Promise.all(layers.filter(layer=>layer.type==='text').map(ensureTextFont));}
export function requestTextFont(layer,onReady){const weight=textFontWeight(layer);if(layer.fontFamily&&layer.fontFamily!==defaultTextFont)loadSelectedFont(defaultTextFont,weight,onReady).catch(()=>{});const key=(layer.fontFamily||defaultTextFont)+':'+weight;if(cache.get(key)==='failed')return;loadSelectedFont(layer.fontFamily||defaultTextFont,weight,onReady).catch(()=>{cache.set(key,'failed');});}
export function setFontSelection(select,family){
 if(!family)family=defaultTextFont;
 if(![...select.options].some(option=>option.value===family)){const option=document.createElement('option');option.value=family;option.textContent=`${{'Microsoft YaHei':'微软雅黑','SimSun':'宋体','SimHei':'黑体','KaiTi':'楷体'}[family]||family}（旧图层沿用）`;option.dataset.legacy='true';select.append(option);}
 select.value=family;
}
