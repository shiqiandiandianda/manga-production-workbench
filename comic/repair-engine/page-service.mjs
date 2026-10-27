import {spawn} from 'node:child_process';
import {createReadStream, createWriteStream, existsSync} from 'node:fs';
import {readFile,writeFile,mkdir,stat,copyFile,rename,link,readdir,rm} from 'node:fs/promises';
import {pipeline} from 'node:stream/promises';
import {Transform} from 'node:stream';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import os from 'node:os';
import {replaceFile} from './safe-files.mjs';
import {normalizeSections} from './public/page-sections.mjs';
import {normalizePageGaps} from './public/page-layout.mjs';
import {RepairQueue} from './repair-queue.mjs';
import {ProjectAssets,isAssetReference,fileForReference,imageDataURL,collectAssetReferences} from './project-assets.mjs';
import {sourceImageRef,pageDimensions} from './job-images.mjs';

const validSource=id=>/^[a-f0-9]{32}$/.test(id);
export const validJob=id=>/^\d{8}-\d{6}-[a-f0-9]{8}$/.test(id);
export function pythonRuntime(){
  return [process.env.IMAGE_REPAIR_PYTHON,path.resolve(import.meta.dirname,'../../.runtime/image-tools/python/python.exe'),path.resolve(path.dirname(process.execPath),'..','..','python','python.exe'),path.join(os.homedir(),'.cache','codex-runtimes','codex-primary-runtime','dependencies','python','python.exe')].find(value=>value&&existsSync(value))||'python';
}
export async function runPageTool(root,args){
  return new Promise((resolve,reject)=>{
    const child=spawn(pythonRuntime(),[path.join(process.env.COMIC_REPAIR_CODE_ROOT||root,'python','page_store.py'),...args],{cwd:root,windowsHide:true,stdio:['ignore','pipe','ignore'],env:{...process.env,PYTHONIOENCODING:'utf-8'}});
    let output=''; const timer=setTimeout(()=>{child.kill();reject(new Error('长图处理超时，请重试'));},180000);
    child.stdout.on('data',chunk=>{output=(output+chunk.toString('utf8')).slice(-16000);});
    child.on('error',error=>{clearTimeout(timer);reject(error);});
    child.on('close',code=>{clearTimeout(timer);try{const data=JSON.parse(output.trim().split(/\r?\n/).at(-1));if(code!==0||data.error)reject(new Error(data.error||'图片处理失败'));else resolve(data);}catch{reject(new Error('无法读取图片处理结果'));}});
  });
}
/** Header names arrive percent-encoded; a malformed value must not throw after a directory exists. */
export function decodeName(value,fallback){try{return decodeURIComponent(value||'')||fallback;}catch{return fallback;}}
const finite=value=>Number.isFinite(value);
export function validateLayerTiles(layers,sourceId=null){
  if(!Array.isArray(layers)||layers.length>2000)throw new Error('图层数据太多');
  for(const item of layers){
    if(item?.type==='background'){
      if(item.coordinateSpace!=='background'||item.x!==0||item.y!==0||!Number.isInteger(item.width)||!Number.isInteger(item.height)||item.width<1||item.width>32768||item.height<1||item.height>1000000||typeof item.color!=='string'||!/^#[a-f0-9]{6}$/i.test(item.color)||!Number.isFinite(item.opacity)||item.opacity<0||item.opacity>1)throw new Error('底色图层格式不正确');
      if(item.gradient){const g=item.gradient;if(!['linear','radial'].includes(g.type)||!/^#[a-f0-9]{6}$/i.test(g.endColor)||!Number.isFinite(g.angle)||g.angle<0||g.angle>360||[g.startOpacity,g.endOpacity].some(value=>!Number.isFinite(value)||value<0||value>1))throw new Error('渐变底色格式不正确');}
      continue;
    }
    if(!item||!Number.isInteger(item.x)||!Number.isInteger(item.y)||item.width!==512||item.height!==512||typeof item.image!=='string'||!(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(item.image)||(isAssetReference(item.image)&&(!sourceId||item.image.startsWith('/project-assets/'+sourceId+'/'))))||(item.coordinateSpace!==undefined&&!['source','output'].includes(item.coordinateSpace)))throw new Error('图层图块格式不正确');
  }
}
export function validateAnnotationMarks(marks){
  if(marks===undefined||marks===null)return;
  if(!Array.isArray(marks)||marks.length>500)throw new Error('标注数量过多');
  for(const mark of marks){
    if(!mark||typeof mark!=='object'||Array.isArray(mark))throw new Error('标注格式不正确');
    if(mark.kind==='text'){if(!finite(mark.x)||!finite(mark.y))throw new Error('文字标注位置无效');}
    else if(!Array.isArray(mark.points)||mark.points.length>20000||mark.points.some(p=>!p||!finite(p.x)||!finite(p.y)))throw new Error('标注笔画格式不正确');
  }
}
export async function validateReferenceIds(root,ids=[]){
  if(!Array.isArray(ids)||ids.length>100||ids.some(id=>!validSource(id)))throw new Error('参考图选择无效');
  for(const id of ids)if(!existsSync(path.join(root,'references',id,'reference.png')))throw new Error('参考图不存在，请刷新后重新选择');
}
/** Remove a half-created job so it never breaks job lists, archiving or startup recovery. */
export async function removeJobDir(root,dir){const jobs=path.resolve(root,'jobs');if(path.dirname(path.resolve(dir))!==jobs||!validJob(path.basename(dir)))return;await rm(dir,{recursive:true,force:true}).catch(()=>{});}
export async function fileHash(file){const hash=createHash('sha256');for await(const data of createReadStream(file))hash.update(data);return hash.digest('hex');}
async function jsonFile(file,value){const temp=file+'.'+randomUUID()+'.tmp';await writeFile(temp,JSON.stringify(value,null,2),'utf8');await replaceFile(temp,file);}
export function sourceFile(root,meta,revision=meta.revision){
  if(!Number.isInteger(revision)||revision<0)throw Object.assign(new Error('漫画版本无效'),{statusCode:400});
  if(revision>meta.lastRevision)throw Object.assign(new Error('漫画版本不存在'),{statusCode:404});
  return path.join(root,'sources',meta.id,revision===0?'original.png':`revision-${revision}.png`);
}
export async function sourceMetadata(root,id){if(!validSource(id))throw new Error('漫画不存在');return JSON.parse(await readFile(path.join(root,'sources',id,'metadata.json'),'utf8'));}
const displayCachePending=new Map(),displayCacheQueue=new RepairQueue(1);
export function prepareDisplayCache(root,meta,revision=meta.revision){
  if(meta.deletedAt)return Promise.resolve();const source=sourceFile(root,meta,revision),key=source;
  if(!displayCachePending.has(key)){
    const pending=new Promise((resolve,reject)=>displayCacheQueue.enqueue(key,async()=>{try{resolve(await runPageTool(root,['display-cache','--input',source]));}catch(error){reject(error);}}));
    displayCachePending.set(key,pending);pending.catch(()=>displayCachePending.delete(key));
  }
  return displayCachePending.get(key);
}
async function waitForDisplayArea(source,meta,revision,rect,preparation){
  const [x,y,width,height]=rect,files=[];
  for(let top=Math.floor(y/1024)*1024;top<y+height;top+=1024)files.push(path.join(path.dirname(source),`region-${revision}-0-${top}-${meta.width}-${Math.min(1024,meta.height-top)}.png`));
  let finished=false,failure;const done=preparation.then(()=>{finished=true;},error=>{finished=true;failure=error;});
  while(!files.every(existsSync)){if(finished){if(failure)throw failure;throw new Error('清晰画面分块尚未生成');}await Promise.race([done,new Promise(resolve=>setTimeout(resolve,100))]);}
}
const regionPending=new Map();
const sourceLocks=new Map();
async function locked(id,action){const prior=sourceLocks.get(id)||Promise.resolve();let release;const current=new Promise(resolve=>{release=resolve;});sourceLocks.set(id,current);await prior;try{return await action();}finally{release();if(sourceLocks.get(id)===current)sourceLocks.delete(id);}}

export async function importPage(req,root){
  const name=decodeName(req.headers['x-source-name'],'漫画页').slice(0,200);
  const id=randomUUID().replaceAll('-',''),sources=path.resolve(root,'sources'),dir=path.join(sources,id);await mkdir(dir,{recursive:true});
  const upload=path.join(dir,'upload.bin'),incoming=createHash('sha256');let size=0,keepDirectory=false;
  try{
    const limiter=new Transform({transform(chunk,encoding,done){size+=chunk.length;incoming.update(chunk);if(size>512*1024*1024)done(new Error('原图文件超过 512 MB'));else done(null,chunk);}});
    await pipeline(req,limiter,createWriteStream(upload));const uploadHash=incoming.digest('hex');
    return await locked(`import:${sources}:${name}:${uploadHash}`,async()=>{
      for(const existing of (await readdir(sources)).filter(value=>validSource(value)&&value!==id)){
        let meta;try{meta=await sourceMetadata(root,existing);}catch(error){if(error.code==='ENOENT')continue;throw error;}
        if(meta.deletedAt||meta.name!==name)continue;
        const fingerprint=meta.uploadHash||await fileHash(path.join(sources,existing,'original.png'));
        if(fingerprint===uploadHash)return{...meta,reused:true};
      }
      const info=await runPageTool(root,['import','--input',upload,'--out',dir]);
      const meta={id,name,...info,uploadHash,revision:0,lastRevision:0,createdAt:new Date().toISOString()};await jsonFile(path.join(dir,'metadata.json'),meta);keepDirectory=true;
      await rm(upload,{force:true});void prepareDisplayCache(root,meta).catch(()=>{});return meta;
    });
  }finally{if(!keepDirectory&&path.dirname(path.resolve(dir))===sources)await rm(dir,{recursive:true,force:true});}
}

export async function makeRegion(root,id,query){
  const meta=await sourceMetadata(root,id),revision=Number(query.get('revision')||0);if(meta.deletedAt)throw new Error('漫画项目已删除');
  const values=['x','y','width','height'].map(key=>Number(query.get(key)));
  const [x,y,width,height]=values;
  if(values.some(value=>!Number.isInteger(value))||x<0||y<0||width<=0||height<=0||x+width>meta.width||y+height>meta.height||width*height>8_000_000)throw new Error('显示区域无效');
  const source=sourceFile(root,meta,revision),key=`${id}-${revision}-${values.join('-')}`,file=path.join(root,'sources',id,`region-${revision}-${values.join('-')}.png`);
  if(existsSync(file))return file;
  if(!regionPending.has(key)){const promise=(async()=>{await waitForDisplayArea(source,meta,revision,values,prepareDisplayCache(root,meta,revision));if(!existsSync(file))await runPageTool(root,['region','--input',source,'--out',file,'--rect',...values.map(String)]);})();regionPending.set(key,promise);promise.finally(()=>regionPending.delete(key)).catch(()=>{});}
  await regionPending.get(key);return file;
}
export async function createSourceJob(root,body,decodePng){
  const meta=await sourceMetadata(root,body.sourceId),revision=body.sourceRevision,crop=body.crop;
  if(meta.deletedAt)throw new Error('项目已删除，请先恢复项目');
  const base=sourceFile(root,meta,revision),output=body.coordinateSpace==='output',sections=output&&body.sectionMode?normalizeSections(body.pageSections||[],meta.height,meta.width):null,gaps=output&&!sections?normalizePageGaps(body.pageGaps||[],meta.height):[],height=sections?sections.filter(section=>section.visible).reduce((sum,section)=>sum+section.height,0):meta.height+gaps.reduce((sum,gap)=>sum+gap.gap,0);
  if(!crop||!['x','y','width','height'].every(key=>Number.isInteger(crop[key]))||crop.x<0||crop.y<0||crop.width<=0||crop.height<=0||crop.x+crop.width>meta.width||crop.y+crop.height>height||crop.width*crop.height>16_000_000)throw new Error('裁切范围无效');
  if(typeof body.prompt!=='string'||!body.prompt.trim()||body.prompt.length>12000)throw new Error('修图要求无效');
  if(body.generationMode!==undefined&&!['low','configured'].includes(body.generationMode))throw new Error('生成调度模式无效');
  const mask=decodePng(await imageDataURL(root,meta.id,body.mask)),guide=body.guide?decodePng(await imageDataURL(root,meta.id,body.guide)):null;
  if([mask,guide].filter(Boolean).some(image=>image.width!==crop.width||image.height!==crop.height))throw new Error('蒙版尺寸与局部不一致');
  // Validate everything that can be checked before the job directory exists.
  for(const reference of collectAssetReferences(body,meta.id))await fileForReference(root,meta.id,reference);if(body.layers?.length)validateLayerTiles(body.layers,meta.id);validateAnnotationMarks(body.annotationMarks);await validateReferenceIds(root,body.references);
  const id=new Date().toISOString().replace(/[-:T]/g,'').slice(0,14).replace(/^(\d{8})(\d{6})$/,'$1-$2')+'-'+randomUUID().slice(0,8),dir=path.join(root,'jobs',id);await mkdir(dir);
  try{
  const cropOnly=!!body.regionId;
  if(cropOnly)await renderCroppedLayers(root,base,path.join(dir,'crop.png'),crop,body.layers||[],gaps,sections,meta.id);
  else{
    if(body.layers?.length)await copyFile(base,path.join(dir,'base.png'));else{try{await link(base,path.join(dir,'base.png'));}catch{await copyFile(base,path.join(dir,'base.png'));}}
    if(body.layers?.length||output){const target=path.join(dir,'layered-base.png');await composeLayers(root,path.join(dir,'base.png'),target,body.layers||[],3,gaps,sections,meta.id);await rename(target,path.join(dir,'base.png'));}
    await runPageTool(root,['region','--input',path.join(dir,'base.png'),'--out',path.join(dir,'crop.png'),'--rect',...['x','y','width','height'].map(key=>String(crop[key]))]);
  }
  await writeFile(path.join(dir,'mask.png'),mask.bytes);if(guide)await writeFile(path.join(dir,'guide.png'),guide.bytes);
  // Background (auto) jobs never send guide.png to Codex; the server builds it on first download.
  if(!guide&&body.mode!=='auto')await runPageTool(root,['guide','--job',dir]);
  if(body.autoText!==undefined&&typeof body.autoText!=='boolean')throw new Error('自动文字状态无效');
  if(body.autoText&&!body.regionId)throw new Error('自动文字图层需要漫画选区');
  if(body.separateBubble!==undefined&&typeof body.separateBubble!=='boolean')throw new Error('气泡分离状态无效');
  if(body.separateBubble&&!body.regionId)throw new Error('分离气泡框需要漫画选区');
  const request={...(body.separateBubble===true?{workflowVersion:3}:body.autoText===true?{workflowVersion:2}:{}),generationMode:body.generationMode||'low',separateBubble:body.separateBubble===true,autoText:body.autoText===true,schemaVersion:cropOnly?3:2,id,createdAt:new Date().toISOString(),editorKey:String(body.editorKey||'').slice(0,100),mode:body.mode,label:String(body.label||'').slice(0,200),sourceId:meta.id,sourceName:meta.name,sourceRevision:revision,coordinateSpace:output?'output':'source',original:{width:meta.width,height},crop,frame:body.frame,aspectRatio:body.aspectRatio,feather:body.feather,featherMode:body.featherMode||'gaussian',sourceHash:await fileHash(cropOnly?base:path.join(dir,'base.png')),prompt:body.prompt,expectedResult:'repaired.png',resultScope:'context-crop'};
  if(cropOnly){request.storageVersion=2;request.baseImageRef=sourceImageRef(root,base);request.inputSnapshot={kind:'local-crop',file:'crop.png',sha256:await fileHash(path.join(dir,'crop.png')),sourceSize:await pageDimensions(base)};request.submission={layers:(await new ProjectAssets(root).externalize(meta.id,body.layers||[],{markProject:false})).value,pageGaps:gaps,pageSections:sections};}
  if(body.regionId)request.regionId=String(body.regionId).slice(0,80);request.region=body.region?(await new ProjectAssets(root).externalize(meta.id,body.region,{markProject:false})).value:body.region;request.orderAt=new Date(Number(body.submittedAt)||Date.now()).toISOString();
  request.referenceFiles=await copyReferences(root,dir,body.references);if(body.annotationMarks?.length){if(body.annotationMarks.length>500)throw new Error('标注数量过多');request.annotationFile='annotation.png';await jsonFile(path.join(dir,'annotation-marks.json'),body.annotationMarks);}await writeFile(path.join(dir,'prompt.txt'),body.prompt,'utf8');await jsonFile(path.join(dir,'request.json'),request);if(request.annotationFile)await runPageTool(root,['annotate','--job',dir,'--manifest',path.join(dir,'annotation-marks.json')]);return {...request,folder:dir,result:null};
  }catch(error){await removeJobDir(root,dir);throw error;}
}
export async function adoptPage(root,id,body,decodePng){
  return locked(id,async()=>{
    const meta=await sourceMetadata(root,id);
    if(!validJob(body.jobId))throw new Error('修图任务不存在');
    const dir=path.join(root,'jobs',body.jobId),request=JSON.parse(await readFile(path.join(dir,'request.json'),'utf8'));
    if(request.sourceId!==id||request.sourceRevision!==meta.revision)throw new Error('原漫画版本已改变，请恢复对应版本后再回填');
    const patch=decodePng(await imageDataURL(root,id,body.patch)),feather=Number(body.feather);
    if(patch.width!==request.crop.width||patch.height!==request.crop.height||!Number.isInteger(feather)||feather<0||feather>64)throw new Error('局部尺寸或羽化值无效');
    const aligned=path.join(dir,'aligned-patch.png');await writeFile(aligned,patch.bytes);
    await runPageTool(root,['compose','--job',dir,'--input',aligned,'--feather',String(feather)]);
    const next=meta.lastRevision+1,target=path.join(root,'sources',id,`revision-${next}.png`);await copyFile(path.join(dir,'repaired_page.png'),target);
    await runPageTool(root,['preview','--input',target,'--out',path.join(root,'sources',id,`preview-${next}.png`)]);
    meta.revision=next;meta.lastRevision=next;await jsonFile(path.join(root,'sources',id,'metadata.json'),meta);return meta;
  });
}
export async function setPageRevision(root,id,revision){return locked(id,async()=>{const meta=await sourceMetadata(root,id);sourceFile(root,meta,revision);meta.revision=revision;await jsonFile(path.join(root,'sources',id,'metadata.json'),meta);return meta;});}
export async function exportPage(root,body,{automatic=false}={}){
  const mode=body.exportMode||'repaired';if(!['repaired','original'].includes(mode))throw new Error('导出模式无效');const original=mode==='original',meta=await sourceMetadata(root,body.sourceId),file=sourceFile(root,meta,original?0:body.sourceRevision);
  if(meta.deletedAt)throw new Error('漫画项目已删除');const label=meta.name.replace(/\.[^.]+$/,'').replace(/[^\p{L}\p{N} _-]/gu,'-').slice(0,80)||'漫画';
  const name=automatic?`${label}-自动合成-${meta.id}.png`:`${label}-${original?'原图':'修复'}-${Date.now()}.png`,target=path.join(root,'exports',name),temporary=target+'.'+randomUUID()+'.tmp';
  try{await composeLayers(root,file,temporary,original?[]:body.layers||[],6,original?[]:normalizePageGaps(body.pageGaps||[],meta.height),!original&&body.sectionMode?normalizeSections(body.pageSections||[],meta.height,meta.width):null,meta.id);await replaceFile(temporary,target);}finally{await rm(temporary,{force:true});}
  await locked(meta.id,async()=>{const registry=path.join(root,'sources',meta.id,'export-files.json');let names=[];try{names=JSON.parse(await readFile(registry,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}if(!names.includes(name))await jsonFile(registry,[...names,name]);});
  return{file:target,name,url:`/exports/${encodeURIComponent(name)}`,lossless:true,compressionLevel:6,automatic,exportMode:mode};
}
async function tileFile(root,sourceId,dir,index,image){if(isAssetReference(image))return fileForReference(root,sourceId,image);const file=path.join(dir,index+'.png');await writeFile(file,Buffer.from(image.split(',')[1],'base64'));return file;}
export async function renderCroppedLayers(root,base,target,rect,layers,pageGaps=[],pageSections=null,sourceId=null){
  validateLayerTiles(layers,sourceId);const tempRoot=path.resolve(root,'临时文件'),dir=path.join(tempRoot,'crop-'+randomUUID());await mkdir(dir,{recursive:true});
  try{
    const tiles=[];for(let index=0;index<layers.length;index++){const tile=layers[index];tiles.push(tile.type==='background'?{...tile}:{x:tile.x,y:tile.y,width:512,height:512,file:await tileFile(root,sourceId,dir,index,tile.image),coordinateSpace:tile.coordinateSpace||'source'});}
    const metadata=path.join(dir,'layers.json');await jsonFile(metadata,{tiles,...(pageSections!==null?{sections:pageSections}:{gaps:pageGaps})});
    await runPageTool(root,['extract-layer','--input',base,'--out',target,'--manifest',metadata,'--rect',...['x','y','width','height'].map(key=>String(rect[key]))]);
  }finally{if(path.dirname(path.resolve(dir))===tempRoot)await rm(dir,{recursive:true,force:true});}
}
export async function composeLayers(root,base,target,layers,compressionLevel=3,pageGaps=[],pageSections=null,sourceId=null){
  validateLayerTiles(layers,sourceId);
  const tempRoot=path.resolve(root,'临时文件'),dir=path.join(tempRoot,`compose-${randomUUID()}`);await mkdir(dir,{recursive:true});
  try{
    const manifest=[];
    for(let i=0;i<layers.length;i++){
      const item=layers[i];if(item.type==='background'){manifest.push({...item});continue;}
      const file=await tileFile(root,sourceId,dir,i,item.image);manifest.push({x:item.x,y:item.y,width:512,height:512,file,coordinateSpace:item.coordinateSpace||'source'});
    }
    const metadata=path.join(dir,'layers.json');await jsonFile(metadata,pageSections!==null?{tiles:manifest,sections:pageSections}:pageGaps.length?{tiles:manifest,gaps:pageGaps}:manifest);await runPageTool(root,['layers','--input',base,'--out',target,'--manifest',metadata,'--compress-level',String(compressionLevel)]);
  }finally{if(path.dirname(path.resolve(dir))===tempRoot)await rm(dir,{recursive:true,force:true});}
}

export async function importReference(req,root){
  const name=decodeName(req.headers['x-source-name'],'粘贴参考图').slice(0,100);
  const id=randomUUID().replaceAll('-',''),references=path.resolve(root,'references'),dir=path.join(references,id);await mkdir(dir,{recursive:true});
  const upload=path.join(dir,'upload.bin');let size=0,keepDirectory=false;
  try{
    const limiter=new Transform({transform(chunk,encoding,done){size+=chunk.length;if(size>64*1024*1024)done(new Error('参考图文件超过 64 MB'));else done(null,chunk);}});
    await pipeline(req,limiter,createWriteStream(upload));
    const info=await runPageTool(root,['reference','--input',upload,'--out',path.join(dir,'reference.png')]);
    const meta={id,...info,name,createdAt:new Date().toISOString(),url:`/references/${id}/reference.png`};await jsonFile(path.join(dir,'metadata.json'),meta);keepDirectory=true;return meta;
  }finally{
    // The normalized reference.png is kept; the raw upload (up to 64 MB) is never needed again.
    await rm(upload,{force:true}).catch(()=>{});
    if(!keepDirectory&&path.dirname(path.resolve(dir))===references)await rm(dir,{recursive:true,force:true}).catch(()=>{});
  }
}
export async function copyReferences(root,dir,ids=[]){
  if(!Array.isArray(ids)||ids.some(id=>!validSource(id)))throw new Error('参考图选择无效');const files=[];for(let i=0;i<ids.length;i++){const name=`reference-${i+1}.png`;await copyFile(path.join(root,'references',ids[i],'reference.png'),path.join(dir,name));files.push(name);}return files;
}

export async function extractLayerPicture(root,body){
  const meta=await sourceMetadata(root,body.sourceId);if(meta.deletedAt)throw new Error('漫画项目已删除');
  const sections=body.sectionMode?normalizeSections(body.pageSections||[],meta.height,meta.width):null,height=sections?Math.max(1,sections.filter(item=>item.visible).reduce((sum,item)=>sum+item.height,0)):meta.height+(body.pageGaps||[]).reduce((sum,item)=>sum+item.gap,0),rect=body.rect;
  if(!rect||!['x','y','width','height'].every(key=>Number.isInteger(rect[key]))||rect.x<0||rect.y<0||rect.width<2||rect.height<2||rect.x+rect.width>meta.width||rect.y+rect.height>height)throw new Error('自由剪切范围无效');
  if(rect.width*rect.height>40000000||rect.width>32768||rect.height>32768)throw new Error('单个剪切画面最多支持 4000 万像素，单边不超过 32768 px');
  const tempRoot=path.resolve(root,'临时文件'),dir=path.join(tempRoot,'extract-'+randomUUID());await mkdir(dir,{recursive:true});
  try{
    const picture=path.join(dir,'picture.png'),tiles=body.layers||[];validateLayerTiles(tiles,meta.id);const manifest=[];
    for(let i=0;i<tiles.length;i++){const tile=tiles[i];if(tile.type==='background'){manifest.push({...tile});continue;}const file=await tileFile(root,meta.id,dir,i,tile.image);manifest.push({x:tile.x,y:tile.y,width:512,height:512,file,coordinateSpace:tile.coordinateSpace||'source'});}
    const metadata=path.join(dir,'layers.json');await jsonFile(metadata,{tiles:manifest,...(sections!==null?{sections}:{gaps:normalizePageGaps(body.pageGaps||[],meta.height)})});
    await runPageTool(root,['extract-layer','--input',sourceFile(root,meta,body.sourceRevision),'--out',picture,'--manifest',metadata,'--rect',...['x','y','width','height'].map(key=>String(rect[key]))]);
    const asset=await new ProjectAssets(root).putFile(meta.id,picture);return{image:asset.image,width:asset.width,height:asset.height};
  }finally{if(path.dirname(path.resolve(dir))===tempRoot)await rm(dir,{recursive:true,force:true});}
}

export async function settleSourceWork(root,id){
 const prefix=path.resolve(root,'sources',id)+path.sep,cache=[...displayCachePending].filter(([file])=>file.startsWith(prefix)),regions=[...regionPending].filter(([key])=>key.startsWith(id+'-'));
 await Promise.allSettled([...cache.map(([,promise])=>promise),...regions.map(([,promise])=>promise),sourceLocks.get(id)]);
 for(const [file] of cache)displayCachePending.delete(file);for(const [key] of regions)regionPending.delete(key);
}
