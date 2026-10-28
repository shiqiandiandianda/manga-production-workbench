import fs from 'node:fs';
import path from 'node:path';

export const vulkanFailure=log=>/vk\w*\s+failed|VK_ERROR|device\s+lost|out of (?:device )?memory|failed to (?:allocate|create|submit)/i.test(log);
export async function runLocalUpscale({input,output,scale,outputScale=scale,model,exe,models,engine='realesrgan',python,script,run,progress}){
 const dir=path.dirname(output),rgb=path.join(dir,'upscale-rgb.png'),result=path.join(dir,'upscale-rgb-result.png');
 await run(python,[script,'--phase','prepare','--input',input,'--output',rgb]);
 let diagnostics='',gpu;
 for(let attempt=0;attempt<2;attempt++){
  if(fs.existsSync(result))fs.unlinkSync(result);
  let log='',failure;
  try{log=await run(exe,['-i',rgb,'-o',result,'-m',models,'-n',engine==='cugan'?'0':model,'-s',String(scale),'-t','128','-f','png','-j','1:1:1',...(gpu?['-g',gpu]:[])],progress);if(vulkanFailure(log))throw Error('显卡处理异常，未应用高清结果');await run(python,[script,'--phase','finish','--input',input,'--output',output,'--model-output',result,'--scale',String(scale),...(outputScale!==scale?['--output-scale',String(outputScale)]:[])]);}
  catch(error){failure=error;log+=error.log||error.message;}
  diagnostics+='\n--- '+(gpu?'GPU '+gpu:'自动显卡')+' ---\n'+log;fs.writeFileSync(path.join(dir,'upscale.log'),diagnostics);
  if(!failure)return;
  const devices=[...log.matchAll(/^\[(\d+) ([^\]\r\n]+)\]\s+queueC=/gm)].map(m=>({id:m[1],name:m[2]})),preferred=devices.find(d=>/NVIDIA|Radeon|AMD/i.test(d.name)&&d.id!==gpu);
  if(attempt||!preferred)throw failure;
  gpu=preferred.id;progress?.('自动显卡处理异常，正在使用独立显卡重试同一本地任务…');
 }
}
