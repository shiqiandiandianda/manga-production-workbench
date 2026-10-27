import fs from 'node:fs';import path from 'node:path';
import {uid,check} from './store.mjs';import {comicStyleFile} from './comic-style-library.mjs';import {comicStyle,normalizeSfxWord} from '../public/comic-styles.js';
import {findPython,run,redact} from './process.mjs';import {inspectImageFile} from './image-files.mjs';
const active=job=>['queued','running'].includes(job.status);
export class ComicSfxDesigner{
 constructor({store,bridge,slots,dataDir,alphaProbe,slotOrigin}){this.store=store;this.bridge=bridge;this.slotOrigin=slotOrigin;this.slots=slots;this.directory=path.resolve(dataDir,'comic-sfx-design');this.jobs=new Map();this.alphaProbe=alphaProbe||(async file=>{const python=findPython();check(python,'未找到透明PNG检查所需Python');const result=await run([python],['-c','import sys,json;from PIL import Image;im=Image.open(sys.argv[1]);print(json.dumps({"png":im.format=="PNG","alpha":im.convert("RGBA").getextrema()[3][0]<255}))',file],{timeout:15000,env:{...process.env,PYTHONUTF8:'1'}});check(result.code===0,'无法检查生成字效的透明背景');return JSON.parse(result.stdout);});}
 public(job){return {id:job.id,status:job.status,message:job.message,word:job.word,...(job.asset?{asset:job.asset}:{})};}
 get(id){const job=this.jobs.get(id);check(job,'字效设计任务不存在',404);return this.public(job);}
 start(input){const word=String(input.word||'').trim();check(word&&[...word].length<=24,'字样需要1至24个字符');check(typeof(input.notes||'')==='string'&&(input.notes||'').length<=2000,'设计要求超过长度限制');const reference=input.referenceId?comicStyle(input.referenceId):null;check(!input.referenceId||reference?.kind==='sfx','请选择字效参考素材');check([...this.jobs.values()].filter(active).length<20,'字效设计队列已满，请稍后继续');const job={id:uid('job'),word,notes:input.notes||'',referenceId:reference?.id||'',status:'queued',message:'等待可用生图槽',controller:new AbortController()};this.jobs.set(job.id,job);void this.work(job);return this.public(job);}
 async work(job){let lease=null,complete=false;
  try{lease=await this.slots.acquire({ownerId:job.id,requestId:job.id,signal:job.controller.signal,provider:'codex'});if(job.controller.signal.aborted)throw Error('设计已取消');job.status='running';job.message='Codex 正在设计透明字效';
   const directory=path.join(this.directory,job.id);fs.mkdirSync(directory,{recursive:true});const refs=job.referenceId?[comicStyleFile(job.referenceId)]:[],reference=job.referenceId?comicStyle(job.referenceId):null;
   const input={kind:'sfx-design',action:'generate',sfxText:job.word,sfxNotes:job.notes,style:reference?.family||'电影感漫画笔触',referenceRoles:reference?[{role:'style',name:reference.label}]:[],shot:{id:job.id,description:job.word,dialogue:'',embeddedTexts:[]},panel:{id:job.id,x:0,y:0,w:Math.max(512,[...job.word].length*350),h:768,points:[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}]}};
   const result=await this.bridge.generate(directory,input,refs,{signal:job.controller.signal,...(this.slotOrigin?{globalSlot:{origin:this.slotOrigin(),token:lease.token}}:{}),onWorkerPid:pid=>lease.trackPid(pid),onProgress:message=>{if(!job.controller.signal.aborted)job.message=String(message).slice(0,250);}});complete=true;
   if(job.controller.signal.aborted)throw Error('设计已取消');const verified=await this.alphaProbe(result.filePath);check(verified.png&&verified.alpha,'设计结果缺少透明背景，现有素材保持不变，请重新设计');
   const file=path.join(directory,'字效.png');fs.copyFileSync(result.filePath,file);const info=inspectImageFile(file),asset={id:uid('asset'),name:job.word+' · 自定义字效',...info,source:'comic-sfx-design',word:normalizeSfxWord(job.word),family:(job.notes||'自定义字效').slice(0,60),created:new Date().toISOString()};this.store.db.assets.push(asset);this.store.save();job.asset=asset;job.status='completed';job.message='设计完成，等待预览后采用';
  }catch(error){if(lease&&error.mayHaveStarted&&!error.generationEnded){lease.keepRemote();lease=null;job.message='本次云端设计状态尚未确认，请保留任务信息，避免重复提交。'+redact(error.message);}else job.message=job.controller.signal.aborted?'字效设计已取消，现有素材保持不变':redact(error.message||'字效设计失败');job.status=job.controller.signal.aborted?'cancelled':'failed';}
  finally{lease?.release({completed:complete});}
 }
 cancel(id){const job=this.jobs.get(id);check(job,'字效设计任务不存在',404);if(active(job)){job.controller.abort();job.message='正在取消设计';}return this.public(job);}
 running(){return [...this.jobs.values()].filter(active).length;}
 close(){for(const job of this.jobs.values())if(active(job))job.controller.abort();}
}
