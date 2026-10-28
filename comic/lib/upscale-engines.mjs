import fs from 'node:fs';
import path from 'node:path';
import {UPSCALE_MODELS,upscalePlan} from '../public/upscale-models.js';

export function createUpscaleEngines({runtimeRoot,python,script,run}){
 const base=path.join(runtimeRoot,'AI工具'),onnxPython=process.env.COMIC_UPSCALE_PYTHON||path.resolve(runtimeRoot,'../upscale-onnx/Scripts/python.exe');
 const detail=path.join(base,'illustration-janai','2x_IllustrationJaNai_V3detail_FDAT_M_local_fp32.onnx');
 const available=()=>[onnxPython,detail].every(file=>fs.existsSync(file));
 function plan(model,scale,outputScale){const p=upscalePlan(model,scale,outputScale);if(!available(p.model,p.nativeScale))throw Error(p.modelLabel+' 本机模型尚未安装完整');return p;}
 const catalog=()=>UPSCALE_MODELS.map(model=>({...model,ready:model.scales.every(scale=>available(model.id,scale))}));
 async function execute(task,progress){
  const p=plan(task.model,task.scale,task.outputScale);
  if(p.model==='illustrationjanai-v3-detail'){
   let log='';try{log=await run(onnxPython,[path.join(path.dirname(script),'local_onnx_upscale.py'),'--input',task.input,'--output',task.output,'--model',detail,'--scale',String(p.nativeScale),'--tile','192','--overlap','32'],progress);}catch(error){log+=error.log||error.message;throw error;}finally{fs.writeFileSync(path.join(path.dirname(task.output),'upscale.log'),log);}
   await run(python,[script,'--phase','validate','--input',task.input,'--output',task.output,'--scale',String(p.outputScale)]);
  }
 }
 return {plan,catalog,execute};
}
