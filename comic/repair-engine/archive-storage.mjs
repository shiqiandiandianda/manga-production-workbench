import path from 'node:path';
import {readFile,writeFile,mkdir,stat,copyFile,rename,readdir,lstat} from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import {replaceFile} from './safe-files.mjs';
import {collectAssetReferences,fileForReference} from './project-assets.mjs';
import {jobBaseFile,imageHash,pageDimensions} from './job-images.mjs';
import {existsSync} from 'node:fs';
import {unlink} from 'node:fs/promises';

const safeName=(value,fallback)=>String(value||fallback).replace(/[\\/:*?"<>|\x00-\x1f]/g,'').trim().replace(/[. ]+$/,'').slice(0,90)||fallback;
const fileNames={'early-text.json':'本地识别文字草稿.json','native-images.json':'双图原生输出记录.json','bubble-native.png':'AI 原始透明气泡.png','background-coverage.png':'背景修补覆盖范围.png','bubble-layers.json':'独立气泡图层.json','bubble-sheet.png':'透明无字气泡.png','bubble-generation.json':'气泡生成记录.json',...Object.fromEntries(Array.from({length:12},(_,i)=>[`bubble-${i+1}.png`,`气泡框－${i+1}.png`])),'editable-text.json':'可编辑气泡文字.json','original-bubble-text.json':'气泡原文识别.json','base.png':'提交时整图.png','crop.png':'局部原图.png','guide.png':'修复位置.png','mask.png':'选区蒙版.png','prompt.txt':'修图要求.txt','request.json':'任务记录.json','automation.json':'处理状态.json','patch.png':'AI 原始返回图.png','repaired.png':'局部修复图.png','repaired.webp':'局部修复图.webp','repaired.jpg':'局部修复图.jpg','repaired_page.png':'本任务整图快照.png','resized_patch.png':'缩放后修复图.png','image-generation.json':'AI 输出记录.json','annotation.png':'人工标注参考图.png','annotation-marks.json':'人工标注记录.json','image.png':'未蒙版局部图.png','layer-mask.png':'图层蒙版.png','alignment.json':'自动对齐记录.json'};

export class ArchiveStorage {
  async projectFonts(project,id,folder){
    for(const font of project?.fontAssets||[]){
      const match=/^\/project-fonts\/([a-f0-9]{32})\/([a-f0-9]{64}\.(?:otf|ttf|ttc|woff2))$/i.exec(font.url||'');
      if(!match||match[1]!==id)throw new Error('工程字体归属无效');
      const file=path.join(this.root,'project-fonts',id,match[2]),info=await lstat(file);
      if(!info.isFile()||info.isSymbolicLink())throw new Error('工程字体不能引用其他路径');
      await this.copy(file,path.join(folder,'project-fonts',id,match[2]));
    }
    const base=path.join(this.root,'project-fonts',id,'licenses');let families=[];
    try{families=await readdir(base,{withFileTypes:true});}catch(error){if(error.code!=='ENOENT')throw error;}
    for(const family of families){
      if(family.isSymbolicLink())throw new Error('字体许可不能引用其他路径');
      if(!family.isDirectory()||!/^[a-z0-9-]{1,80}$/i.test(family.name))continue;
      for(const entry of await readdir(path.join(base,family.name),{withFileTypes:true})){
        if(entry.isSymbolicLink())throw new Error('字体许可不能引用其他路径');
        if(entry.isFile()&&/^[a-z0-9_-]{1,80}\.txt$/i.test(entry.name))await this.copy(path.join(base,family.name,entry.name),path.join(folder,'project-fonts',id,'licenses',family.name,entry.name));
      }
    }
  }
  async archiveInput(source,target,request,folder){
    let base;try{base=await jobBaseFile(this.root,request,source);}catch(error){if(error.code==='ENOENT')return;throw error;}
    const hash=await imageHash(base);if(request.sourceHash&&request.sourceHash!==hash)throw new Error('任务原图校验失败，未整理归档');
    let shared=path.join(folder,'共享提交图像',hash+'.png');
    const original=/^[a-f0-9]{32}$/.test(request.sourceId||'')?path.join(this.root,'sources',request.sourceId,'original.png'):null;
    if(original&&existsSync(original)&&await imageHash(original)===hash)shared=path.join(folder,'原始漫画','原图.png');
    await this.copy(base,shared);if(await imageHash(shared)!==hash)throw new Error('共享归档图像校验失败');
    const relative=file=>path.relative(target,file).split(path.sep).join('/'),crop=path.join(source,'crop.png');
    const references=/^[a-f0-9]{32}$/.test(request.sourceId||'')?[...collectAssetReferences(request,request.sourceId)]:[];
    const record={schemaVersion:1,kind:'submitted-image-reference',base:{path:relative(shared),sha256:hash,...await pageDimensions(shared)},...(existsSync(crop)?{crop:{path:'局部原图.png',sha256:await imageHash(crop)}}:{}),submission:request.submission||null,assets:Object.fromEntries(references.map(ref=>[ref,relative(path.join(folder,ref.slice(1)))]))};
    await mkdir(target,{recursive:true});const file=path.join(target,'提交图像引用.json'),temporary=file+'.'+randomUUID()+'.tmp';await writeFile(temporary,JSON.stringify(record,null,2),'utf8');await replaceFile(temporary,file);
    const old=path.join(target,'提交时整图.png');if(existsSync(old)&&await imageHash(old)===hash)await unlink(old);
  }
  constructor(root){this.root=root;this.file=path.join(root,'storage-config.json');this.config={baseFolder:path.join(root,'保存与归档'),folderName:'漫画修图归档'};this.locks=new Map();this.deletedSources=new Set();this.lastError=null;}
  async init(){try{this.config={...this.config,...JSON.parse(await readFile(this.file,'utf8'))};}catch(error){if(error.code!=='ENOENT')throw error;}return this.status();}
  status(){return{...this.config,directory:path.join(this.config.baseFolder,this.config.folderName),lastError:this.lastError};}
  async configure({baseFolder=this.config.baseFolder,folderName=this.config.folderName}){
    if(typeof baseFolder!=='string'||!path.isAbsolute(baseFolder))throw new Error('请选择完整的本地保存目录');
    if(typeof folderName!=='string'||folderName!==safeName(folderName,'漫画修图归档')||!/[\p{Script=Han}]/u.test(folderName))throw new Error('归档文件夹名称请使用中文，且不能包含路径符号');
    const directory=path.join(baseFolder,folderName);await mkdir(directory,{recursive:true});
    const config={baseFolder:path.resolve(baseFolder),folderName};const temp=this.file+'.'+randomUUID()+'.tmp';await writeFile(temp,JSON.stringify(config,null,2),'utf8');await replaceFile(temp,this.file);this.config=config;this.lastError=null;return this.status();
  }
  background(promise){promise.catch(error=>{this.lastError=error.message;console.error('归档暂未完成：',error.message);});}
  async locked(key,action){const previous=this.locks.get(key)||Promise.resolve(),next=previous.catch(()=>{}).then(action);this.locks.set(key,next);try{return await next;}finally{if(this.locks.get(key)===next)this.locks.delete(key);}}
  projectFolder(meta){const id=meta.sourceId||meta.id||createHash('sha256').update(meta.sourceName||'演示漫画').digest('hex');return path.join(this.status().directory,`漫画－${safeName(path.parse(meta.name||meta.sourceName||'演示漫画').name,'未命名')}－${id.slice(-8)}`);}
  async copy(source,target){
    let info;try{info=await stat(source);}catch(error){if(error.code==='ENOENT')return;throw error;}
    try{const saved=await stat(target);if(saved.size===info.size&&saved.mtimeMs>=info.mtimeMs)return;}catch(error){if(error.code!=='ENOENT')throw error;}
    await mkdir(path.dirname(target),{recursive:true});const temp=target+'.'+randomUUID()+'.tmp';await copyFile(source,temp);await replaceFile(temp,target);
  }
  async page(id){
    if(!/^[a-f0-9]{32}$/.test(id))throw new Error('漫画不存在');
    return this.locked(`page:${id}`,async()=>{if(this.deletedSources.has(id))return;const source=path.join(this.root,'sources',id),meta=JSON.parse(await readFile(path.join(source,'metadata.json'),'utf8')),folder=this.projectFolder(meta);await this.copy(path.join(source,'original.png'),path.join(folder,'原始漫画','原图.png'));await this.copy(path.join(source,'metadata.json'),path.join(folder,'原始漫画','原图信息.json'));await this.copy(path.join(source,'project.json'),path.join(folder,'漫画工程.json'));let project;try{project=JSON.parse(await readFile(path.join(source,'project.json'),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}for(const reference of collectAssetReferences(project,id)){const file=await fileForReference(this.root,id,reference);await this.copy(file,path.join(folder,'project-assets',id,path.basename(file)));}await this.projectFonts(project,id,folder);return folder;});
  }
  async task(id){
    if(!/^\d{8}-\d{6}-[a-f0-9]{8}$/.test(id))throw new Error('任务不存在');
    return this.locked(`task:${id}`,async()=>{
      const source=path.join(this.root,'jobs',id),request=JSON.parse(await readFile(path.join(source,'request.json'),'utf8'));
      if(this.deletedSources.has(request.sourceId))return;const folder=this.projectFolder(request),target=path.join(folder,'修图任务',`${safeName(request.label?.slice(0,25),'局部修复')}－${id}`);
      for(const [file,chinese] of Object.entries(fileNames).filter(([file])=>file!=='base.png'))await this.copy(path.join(source,file),path.join(target,chinese));
      await this.archiveInput(source,target,request,folder);
      if(/^[a-f0-9]{32}$/.test(request.sourceId))for(const reference of collectAssetReferences(request,request.sourceId)){const file=await fileForReference(this.root,request.sourceId,reference);await this.copy(file,path.join(folder,'project-assets',request.sourceId,path.basename(file)));}
      for(const [index,reference] of (request.referenceFiles||[]).entries())await this.copy(path.join(source,reference),path.join(target,'参考图片',`参考图－${index+1}.png`));
      const attemptRoot=path.join(source,'attempts');let attempts=[];try{attempts=await readdir(attemptRoot,{withFileTypes:true});}catch(error){if(error.code!=='ENOENT')throw error;}
      for(const attempt of attempts.filter(entry=>entry.isDirectory())){const from=path.join(attemptRoot,attempt.name),to=path.join(target,'尝试记录',`尝试－${safeName(attempt.name,'记录')}`);for(const [file,chinese] of Object.entries(fileNames).filter(([file])=>file!=='base.png'))await this.copy(path.join(from,file),path.join(to,chinese));if(existsSync(path.join(from,'base.png')))await this.archiveInput(from,to,request,folder);}
      if(request.sourceId)await this.page(request.sourceId);return folder;
    });
  }
  async export(file,meta,{automatic=false}={}){if(this.deletedSources.has(meta.sourceId||meta.id))return;const folder=this.projectFolder(meta),target=automatic?path.join(folder,'自动合成','最新合成.png'):path.join(folder,'导出成品',`成品－${safeName(path.basename(file),'修复漫画.png')}`);await this.locked(`export:${target}`,()=>this.copy(file,target));return target;}
  async reference(id){return this.locked(`reference:${id}`,async()=>{const source=path.join(this.root,'references',id),meta=JSON.parse(await readFile(path.join(source,'metadata.json'),'utf8')),folder=path.join(this.status().directory,'参考图库',`参考－${safeName(path.parse(meta.name||'参考图片').name,'参考图片')}－${id.slice(-8)}`);await this.copy(path.join(source,'reference.png'),path.join(folder,'参考图片.png'));await this.copy(path.join(source,'metadata.json'),path.join(folder,'参考信息.json'));});}
  async archive(id){
    const folder=await this.page(id);const jobs=await readdir(path.join(this.root,'jobs'));
    for(const job of jobs.filter(value=>/^\d{8}-\d{6}-[a-f0-9]{8}$/.test(value))){let request;try{request=JSON.parse(await readFile(path.join(this.root,'jobs',job,'request.json'),'utf8'));}catch(error){if(error.code==='ENOENT')continue;throw error;}if(request.sourceId===id)await this.task(job);}
    let refs=[];try{refs=await readdir(path.join(this.root,'references'));}catch(error){if(error.code!=='ENOENT')throw error;}for(const ref of refs.filter(value=>/^[a-f0-9]{32}$/.test(value)))await this.reference(ref);
    return{folder};
  }
}

