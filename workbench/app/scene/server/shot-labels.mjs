import {spawn} from 'node:child_process';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import os from 'node:os';
import path from 'node:path';
import {decodePng,encodePng} from './png-composition.mjs';
function renderer(binary,args){return new Promise((resolve,reject)=>{const child=spawn(binary,args,{windowsHide:true,shell:false,stdio:['ignore','ignore','ignore']});const timer=setTimeout(()=>{child.kill();reject(Error('视角文字渲染超时。'));},30000);child.once('error',()=>{clearTimeout(timer);reject(Error('无法启动本机文字渲染器。'));});child.once('close',code=>{clearTimeout(timer);code===0?resolve():reject(Error('视角文字渲染失败；Windows 需系统中文字体，macOS/Linux 需 Python Pillow 和中文字体。'));});});}
export async function frameAndLabelShots(bytes,sceneName='未命名场景'){
  const image=decodePng(bytes),{width,height,pixels}=image,half=height/2;if(!Number.isInteger(half))throw Error('正反打合成尺寸不正确。');
  const line=Math.max(3,Math.round(width/384)),inset=line+Math.round(width/128),fontSize=Math.round(width/55);
  for(const offset of [0,half])for(let y=0;y<half;y++)for(let x=0;x<width;x++)if(x<line||x>=width-line||y<line||y>=half-line){const position=((y+offset)*width+x)*4;pixels.fill(255,position,position+4);}
  const root=fileURLToPath(new URL('../',import.meta.url)),job=await mkdtemp(path.join(os.tmpdir(),'scene-shot-label-'));
  try{const spec=path.join(job,'labels.json');const name=String(sceneName||'未命名场景').replace(/[\r\n\t]+/g,' ').slice(0,120);await writeFile(spec,JSON.stringify({labels:[name+' · 正打视角',name+' · 反打视角'],fontSize,maxWidth:Math.floor(width*.8)}));
    if(process.platform==='win32'){const binary=path.join(process.env.SystemRoot||'C:/Windows','System32/WindowsPowerShell/v1.0/powershell.exe');await renderer(binary,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(root,'scripts/render-labels.ps1'),'-InputFile',spec,'-OutputDirectory',job]);}
    else await renderer(process.env.SCENE_LABEL_PYTHON||'python3',[path.join(root,'scripts/render-labels.py'),spec,job]);
    for(const index of [0,1]){const label=decodePng(await readFile(path.join(job,'label-'+index+'.png')));for(let y=0;y<label.height&&y+inset<half-line;y++)for(let x=0;x<label.width&&x+inset<width-line;x++){const source=(y*label.width+x)*4,dest=((index*half+inset+y)*width+inset+x)*4,alpha=label.pixels[source+3]/255;for(let c=0;c<3;c++)pixels[dest+c]=Math.round(label.pixels[source+c]*alpha+pixels[dest+c]*(1-alpha));pixels[dest+3]=255;}}
    return encodePng(image);
  }finally{await rm(job,{recursive:true,force:true}).catch(()=>{});}
}
