import fs from 'node:fs';
import path from 'node:path';
import {DEFAULT_MAIN_CONCURRENCY,DEFAULT_REPAIR_CONCURRENCY,validatePlatformConcurrency} from './concurrency.mjs';
import {GENERATION_RANGES,validateGenerationConcurrency} from '../public/generation-policy.js';

export class GenerationSettings {
  constructor(directory, initial=DEFAULT_MAIN_CONCURRENCY, platforms={main:initial,repair:DEFAULT_REPAIR_CONCURRENCY}) {
    this.file=path.join(directory,'generation-settings.json');
    this.limits={codex:Math.min(initial,8),jimeng:initial};
    this.platforms=validatePlatformConcurrency(platforms);
    try {
      const saved=JSON.parse(fs.readFileSync(this.file,'utf8'));
      for(const provider of Object.keys(GENERATION_RANGES))if(saved[provider]!==undefined)this.limits[provider]=validateGenerationConcurrency(provider,saved[provider]);
      if(saved.platforms!==undefined)this.platforms=validatePlatformConcurrency(saved.platforms);
      for(const provider of Object.keys(GENERATION_RANGES))if(saved[provider]===undefined)this.limits[provider]=provider==='codex'?Math.min(this.platforms.main,8):this.platforms.main;
    } catch(error) { if(error.code!=='ENOENT')throw new Error('生图并发设置无法读取：'+error.message); }
  }
  snapshot(){return {limits:{...this.limits},ranges:GENERATION_RANGES,sharedLimit:Math.max(...Object.values(this.limits)),platforms:{...this.platforms},totalConcurrency:this.platforms.main};}
  platformSnapshot(){return {main:this.platforms.main,repair:this.platforms.repair,total:this.platforms.main,mainWhenRepair:this.platforms.main-this.platforms.repair,mode:'borrow'};}
  save(limits,platforms){
    const saved={platforms};
    for(const key of Object.keys(GENERATION_RANGES))if(limits[key]>=GENERATION_RANGES[key].min)saved[key]=limits[key];
    const temporary=this.file+'.tmp';
    fs.writeFileSync(temporary,JSON.stringify(saved,null,2));fs.renameSync(temporary,this.file);
    this.limits=limits;this.platforms=platforms;
  }
  update(provider,value) {
    const count=validateGenerationConcurrency(provider,value);
    this.save({...this.limits,[provider]:count},{...this.platforms});return this.snapshot();
  }
  updatePlatforms(value){
    const platforms=validatePlatformConcurrency(value);
    const limits={codex:Math.max(this.limits.codex,Math.min(platforms.main,8)),jimeng:Math.max(this.limits.jimeng,platforms.main)};
    this.save(limits,platforms);return this.platformSnapshot();
  }
}
