import path from 'node:path';
import {readFile,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {replaceFile} from './safe-files.mjs';
export const DEFAULT_PROMPTS=[
  {name:'手部',prompt:'修正手指数量和关节，保持原有手势、漫画线条、配色和光影。'},
  {name:'五官',prompt:'修正五官结构，保持人物身份、表情、视线及原有画风。'},
  {name:'文字',prompt:'修正选区内错误的文字，保持原有字形、大小、颜色和透视。'},
  {name:'清理杂物',prompt:'移除选区中的多余杂物，自然补全背景，保持原有线条、配色、透视和光影。'}
];
export function validatePrompts(presets){
  if(!Array.isArray(presets)||presets.length!==4)throw new Error('请保存四个自定义提示词');
  return presets.map((item,index)=>{
    if(!item||typeof item.name!=='string'||typeof item.prompt!=='string'||item.name.length>20||item.prompt.length>12000)throw new Error('名称最多20字，提示词最多12000字');
    return{name:item.name.trim()||`自定义${index+1}`,prompt:item.prompt};
  });
}
export class PromptPresets{
  constructor(root){this.file=path.join(root,'prompt-presets.json');this.saving=Promise.resolve();}
  async get(){try{return{presets:validatePrompts(JSON.parse(await readFile(this.file,'utf8')).presets)};}catch(error){if(error.code==='ENOENT')return{presets:structuredClone(DEFAULT_PROMPTS)};throw error;}}
  async save(body){const presets=validatePrompts(body.presets);const operation=this.saving.catch(()=>{}).then(async()=>{const temporary=this.file+'.'+randomUUID()+'.tmp';await writeFile(temporary,JSON.stringify({presets},null,2),'utf8');await replaceFile(temporary,this.file);return{presets};});this.saving=operation;return operation;}
}
