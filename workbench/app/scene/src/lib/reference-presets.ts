import {DEFAULT_FORMAT} from './scenes.ts';
import type {Format} from './scenes';
export const PRESET_VERSION='shot-reverse-v2';
export const SAMPLE_REFERENCES=[
  {url:'/references/room-forward.png',name:'正打参考 · 同一房间'},
  {url:'/references/room-reverse.png',name:'反打参考 · 同一房间180°反向机位'},
];
export const REFERENCE_STYLE='中式古建筑写实场景概念美术，旧木与石材的真实材质细节，自然光照，统一空间尺度和物件造型，保持正打与反打的一致性。光照服从剧本。';
export function applySampleReferences(format:Format,images:string[],force=false):Format{
  if(!force&&format.referencePresetVersion===PRESET_VERSION)return format;
  if(images.length!==SAMPLE_REFERENCES.length)throw Error('正反打参考图没有加载完整，请稍后重试。');
  return {...format,layout:'shot-reverse',confirmed:true,template:DEFAULT_FORMAT.template,reverseTemplate:DEFAULT_FORMAT.reverseTemplate,style:REFERENCE_STYLE,referenceImages:images,referenceNames:SAMPLE_REFERENCES.map(r=>r.name),referencePresetVersion:PRESET_VERSION,showChapterSubtitle:false,showPanelLabels:false};
}
export async function loadSampleReferences():Promise<string[]>{
  return await Promise.all(SAMPLE_REFERENCES.map(async sample=>{
    const response=await fetch(sample.url,{signal:AbortSignal.timeout(15000)});if(!response.ok)throw new Error('样板参考图加载失败，请点击“恢复两张样板图”重试。');
    const blob=await response.blob();if(blob.type!=='image/png')throw new Error('样板图返回格式不正确。');
    return await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(new Error('样板图读取失败。'));reader.readAsDataURL(blob);});
  }));
}
