import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {UPSCALE_MODELS,upscalePlan} from '../public/upscale-models.js';
import {isLocalMemoryFailure,localImageMessage} from '../public/local-image-messages.js';

function progressMessage(log){
 for(const line of String(log).split(/\r?\n/).reverse())try{const row=JSON.parse(line);if(row.progress&&row.total)return `高清放大：${row.percent}%（${row.progress}/${row.total}）`;if(row.tile)return row.tile<row.requestedTile?'可用内存较少，正在使用小分块处理…':'正在准备高清模型…';}catch{}
 return '本机高清模型处理中…';
}
export async function runOnnxUpscale({python,script,input,output,model,scale,run,progress,availableMemory=os.freemem()}){
 let tile=availableMemory<2*1024**3?64:availableMemory<4*1024**3?128:192,provider='auto',log='';
 try{
  while(true){
   log+=`\n${JSON.stringify({attemptTile:tile,provider})}\n`;
   try{log+=await run(python,[script,'--input',input,'--output',output,'--model',model,'--scale',String(scale),'--tile',String(tile),'--overlap','32','--provider',provider],value=>progress?.(progressMessage(value)));break;}
   catch(error){
    const detail=error.log||error.message;log+=detail;
    if(!isLocalMemoryFailure(detail))throw Object.assign(Error(localImageMessage(detail)),{log});
    // A failed child has exited before run rejects, releasing its session allocations.
    for(const line of String(detail).split(/\r?\n/))try{const row=JSON.parse(line);if(Number.isFinite(row.tile))tile=Math.min(tile,row.tile);}catch{}
    const next=[128,64].find(value=>value<tile);
    if(!next){if(provider==='auto'){provider='cpu';tile=64;progress?.('显卡内存不足，正在使用 CPU 继续处理，模型和倍率不变…');continue;}throw Object.assign(Error(localImageMessage(detail)),{log});}
    tile=next;progress?.(`内存不足，正在使用 ${tile} 像素分块重试…`);
   }
  }
  return log;
 }finally{fs.writeFileSync(path.join(path.dirname(output),'upscale.log'),log);}
}

export function createUpscaleEngines({runtimeRoot,python,script,run}){
 const base=path.join(runtimeRoot,'AI工具'),onnxPython=process.env.COMIC_UPSCALE_PYTHON||path.resolve(runtimeRoot,'../upscale-onnx/Scripts/python.exe');
 const detail=path.join(base,'illustration-janai','2x_IllustrationJaNai_V3detail_FDAT_M_local_fp32.onnx');
 const available=()=>[onnxPython,detail].every(file=>fs.existsSync(file));
 function plan(model,scale,outputScale){const p=upscalePlan(model,scale,outputScale);if(!available(p.model,p.nativeScale))throw Error(p.modelLabel+' 本机模型尚未安装完整');return p;}
 const catalog=()=>UPSCALE_MODELS.map(model=>({...model,ready:model.scales.every(scale=>available(model.id,scale))}));
 async function execute(task,progress){
  const p=plan(task.model,task.scale,task.outputScale);
  if(p.model==='illustrationjanai-v3-detail'){
   await runOnnxUpscale({python:onnxPython,script:path.join(path.dirname(script),'local_onnx_upscale.py'),input:task.input,output:task.output,model:detail,scale:p.nativeScale,run,progress});
   await run(python,[script,'--phase','validate','--input',task.input,'--output',task.output,'--scale',String(p.outputScale)]);
  }
 }
 return {plan,catalog,execute};
}
