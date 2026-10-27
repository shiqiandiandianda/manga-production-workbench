import path from 'node:path';
import {createRequire} from 'node:module';
import {mkdir,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {lstatSync} from 'node:fs';
import {renderTextCanvas} from './public/text-layout.mjs';
import {fontChoice,defaultTextFont,textFontWeight} from './public/text-fonts.mjs';
import {layerMatrix,mapPoint} from './public/affine-links.mjs';

const require=createRequire(import.meta.url),loadedFonts=new Set();let graphics;
function canvasRuntime(){
 if(graphics)return graphics;
 const candidates=[process.env.COMIC_TEST_CANVAS_MODULE,path.join(path.dirname(process.execPath),'node_modules','@napi-rs','canvas'),'@napi-rs/canvas'].filter(Boolean);
 for(const candidate of candidates)try{return graphics=require(candidate);}catch(error){if(error.code!=='MODULE_NOT_FOUND')throw error;}
 throw new Error('后台文字渲染运行环境缺失，请使用附带的 Node 启动工作台');
}
function nativeFont(toolRoot,root,sourceId,layer,fontAssets){
 const {GlobalFonts}=canvasRuntime(),choice=fontChoice(layer.fontFamily||defaultTextFont,textFontWeight(layer));
 if(!choice)return layer;
 // One alias per real face avoids native CSS weight rounding (e.g. 250/350).
 const owned=fontAssets.find(font=>font.family===choice.font.family&&Number(font.weight)===Number(choice.face.weight)),match=owned&&new RegExp(`^/project-fonts/${sourceId}/([a-f0-9]{64}\\.(?:otf|ttf|ttc|woff2))$`).exec(owned.url||'');if(owned&&!match)throw new Error('后台工程字体来源无效');
 const file=match?path.join(root,'project-fonts',sourceId,match[1]):path.join(toolRoot,'public','fonts',choice.face.file);
 if(match)for(const item of [path.join(root,'project-fonts'),path.dirname(file),file])if(lstatSync(item).isSymbolicLink())throw new Error('后台工程字体路径无效');
 const alias=`ComicText_${choice.font.id}_${choice.face.weight}_${match?match[1].slice(0,16):'bundled'}`,key=file+'\0'+alias;
 if(!loadedFonts.has(key)){if(!GlobalFonts.registerFromPath(file,alias))throw new Error('后台文字字体加载失败：'+choice.font.label);loadedFonts.add(key);}
 return {...layer,fontFamily:alias,fontWeight:400};
}
export async function renderServerTextTiles(toolRoot,root,layers,assets,sourceId,{fontAssets=[]}={}){
 const visible=layers.filter(layer=>layer.type==='text'&&layer.visible!==false&&layer.opacity!==0&&!layer.versionHidden);if(!visible.length)return [];
 const {createCanvas}=canvasRuntime(),temporaryRoot=path.join(root,'临时文件');await mkdir(temporaryRoot,{recursive:true});const temporary=await mkdtemp(path.join(temporaryRoot,'text-tiles-')),tiles=[];
 try{
  for(let index=0;index<visible.length;index++){
   const layer=visible[index],canvas=renderTextCanvas(nativeFont(toolRoot,root,sourceId,layer,fontAssets),createCanvas),matrix=layerMatrix(layer);
   if(!Object.values(matrix).every(Number.isFinite))throw new Error('后台文字图层坐标无效');
   const points=[[0,0],[canvas.width,0],[0,canvas.height],[canvas.width,canvas.height]].map(([x,y])=>mapPoint(matrix,{x,y})),left=Math.floor(Math.min(...points.map(p=>p.x))/512)*512,top=Math.floor(Math.min(...points.map(p=>p.y))/512)*512,right=Math.ceil(Math.max(...points.map(p=>p.x))),bottom=Math.ceil(Math.max(...points.map(p=>p.y)));
   if((Math.ceil((right-left)/512)*Math.ceil((bottom-top)/512))+tiles.length>2000)throw new Error('后台文字图块数量过多');
   for(let y=top;y<bottom;y+=512)for(let x=left;x<right;x+=512){
    const tile=createCanvas(512,512),ctx=tile.getContext('2d');ctx.globalAlpha=layer.opacity??1;ctx.setTransform(matrix.a,matrix.b,matrix.c,matrix.d,matrix.e-x,matrix.f-y);ctx.drawImage(canvas,0,0);
    const pixels=ctx.getImageData(0,0,512,512).data;let ink=false;for(let p=3;p<pixels.length;p+=4)if(pixels[p]){ink=true;break;}if(!ink)continue;
    const file=path.join(temporary,`${index}-${x}-${y}.png`);await writeFile(file,tile.toBuffer('image/png'));
    tiles.push({layerId:layer.id,x,y,width:512,height:512,coordinateSpace:layer.coordinateSpace||'source',image:(await assets.putFile(sourceId,file)).image});
   }
  }
  return tiles;
 }finally{await rm(temporary,{recursive:true,force:true});}
}
