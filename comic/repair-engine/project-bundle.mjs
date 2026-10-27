import path from 'node:path';
import {spawn} from 'node:child_process';
import {createWriteStream} from 'node:fs';
import {mkdir,mkdtemp,writeFile,readFile,readdir,lstat,realpath,rm} from 'node:fs/promises';
import {pipeline} from 'node:stream/promises';
import {Transform} from 'node:stream';
import {randomUUID} from 'node:crypto';
import {sourceMetadata,pythonRuntime} from './page-service.mjs';
import {collectAssetReferences} from './project-assets.mjs';
import {fontChoice,defaultTextFont,textFontWeight} from './public/text-fonts.mjs';
import {replaceFile} from './safe-files.mjs';

export const MAX_PROJECT_FILE_BYTES=512*1024*1024;
const validSource=id=>/^[a-f0-9]{32}$/.test(id),validJob=id=>/^\d{8}-\d{6}-[a-f0-9]{8}$/.test(id);
const jobFile=/^(?:(?:crop|mask|guide|annotation|base|patch|repaired|repaired_page|resized_patch|image|layer-mask|bubble-sheet|bubble-native|background-coverage|selection|clean-background-selection|transparent-bubble-selection|native-[12]|bubble-(?:[1-9]|1[0-2])|reference-\d{1,3})\.(?:png|webp|jpg)|prompt\.txt|alignment\.json|early-text\.json|editable-text\.json|bubble-layers\.json|original-bubble-text\.json|text-review\.json|confirmed-text\.json|recognition-error\.json|text-cleanup-review\.json|codex-bubble-metadata\.json|native-role-validation\.json|visual-validation\.json|native-bubble-assets-v3\.json|generation-diagnostics\.json|bubble-generation\.json|image-generation\.json|native-images\.json|background-coverage\.json|annotation-marks\.json)$/;
const failure=(message,code=400)=>Object.assign(new Error(message),{statusCode:code});
const safeName=value=>String(value||'漫画').replace(/\.[^.]+$/,'').replace(/[\\/:*?"<>|\x00-\x1f]/g,'').replace(/[. ]+$/,'').slice(0,60)||'漫画';
async function entries(dir){try{return await readdir(dir,{withFileTypes:true});}catch(error){if(error.code==='ENOENT')return [];throw error;}}
async function temporaryFolder(root,prefix){const base=path.join(root,'临时文件');await mkdir(base,{recursive:true});if((await lstat(base)).isSymbolicLink()||!((await realpath(base))+path.sep).startsWith((await realpath(root))+path.sep))throw failure('工程临时目录路径无效');return mkdtemp(path.join(base,prefix));}
async function removeTemporary(root,temporary){const base=path.join(root,'临时文件');if(path.dirname(path.resolve(temporary))!==path.resolve(base)||(await lstat(temporary)).isSymbolicLink()||!((await realpath(temporary))+path.sep).startsWith((await realpath(base))+path.sep))throw failure('工程临时文件清理路径无效');await rm(temporary,{recursive:true,force:true});}
function cleanSnapshot(value){
 if(Array.isArray(value))return value.map(cleanSnapshot);if(!value||typeof value!=='object')return value;
 return Object.fromEntries(Object.entries(value).filter(([key])=>!['composite','folder','archivePath','workerPid','pid','threadId','turnId'].includes(key)).map(([key,item])=>[key,cleanSnapshot(item)]));
}
function visit(value,action){if(Array.isArray(value)){for(const item of value)visit(item,action);}else if(value&&typeof value==='object'){action(value);for(const item of Object.values(value))visit(item,action);}}
function strings(value,action){if(typeof value==='string')action(value);else if(Array.isArray(value)){for(const item of value)strings(item,action);}else if(value&&typeof value==='object'){for(const item of Object.values(value))strings(item,action);}}
function runBundle(root,toolRoot,args){return new Promise((resolve,reject)=>{
 const child=spawn(pythonRuntime(),[path.join(toolRoot,'python','project_bundle.py'),...args,'--root',root],{cwd:toolRoot,windowsHide:true,stdio:['ignore','pipe','ignore'],env:{...process.env,PYTHONIOENCODING:'utf-8',PYTHONUTF8:'1'}});let output='';const timer=setTimeout(()=>{child.kill();reject(failure('工程文件处理超时，请重试',408));},300000);
 child.stdout.on('data',chunk=>{output=(output+chunk.toString('utf8')).slice(-32*1024*1024);});child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('close',code=>{clearTimeout(timer);try{const result=JSON.parse(output.trim().split(/\r?\n/).at(-1));if(code!==0||result.error)reject(failure(result.error||'工程文件处理失败'));else resolve(result);}catch{reject(failure('无法读取工程文件处理结果'));}});
});}

export class ProjectBundles {
 constructor(root,projects,{toolRoot=root}={}){this.root=path.resolve(root);this.toolRoot=toolRoot;this.projects=projects;this.exporting=new Map();this.previewing=new Map();projects.bundleOperations=this.exporting;}
 async snapshot(id){
  if(!validSource(id))throw failure('漫画项目不存在',404);const metadata=await sourceMetadata(this.root,id);if(metadata.id!==id||metadata.deletedAt)throw failure('漫画项目已删除',410);
  const project=cleanSnapshot(await this.projects.get(id)),jobs=(await this.projects.jobs()).filter(item=>item.sourceId===id).map(({automation,...request})=>({id:request.id,request:cleanSnapshot(request),automation:cleanSnapshot(automation)})),fileSet=new Set();
  const add=relative=>fileSet.add(relative.split(path.sep).join('/'));
  for(const entry of await entries(path.join(this.root,'sources',id))){if(entry.isSymbolicLink())throw failure('漫画目录不能含符号链接');if(entry.isFile()&&(entry.name==='original.png'||/^revision-\d+\.png$/.test(entry.name)))add(`sources/${id}/${entry.name}`);}
  for(const entry of await entries(path.join(this.root,'sources',id,'submission-images'))){if(entry.isSymbolicLink())throw failure('提交原图不能含符号链接');if(entry.isFile()&&/^[a-f0-9]{64}\.png$/.test(entry.name))add(`sources/${id}/submission-images/${entry.name}`);}
  for(const reference of collectAssetReferences([project,...jobs.map(item=>item.request)],id))add(reference.slice(1));
  const refIds=new Set(),fonts=new Map(),ownedFonts=[];const fontKey=(family,weight)=>JSON.stringify([family,Number(weight)]);
  for(const font of project.fontAssets||[]){const match=/^\/project-fonts\/([a-f0-9]{32})\/([a-f0-9]{64}\.(?:otf|ttf|ttc|woff2))$/.exec(font.url||''),weight=Number(font.weight);if(!match||match[1]!==id||typeof font.family!=='string'||!font.family||font.family.length>200||!Number.isInteger(weight)||weight<1||weight>1000)throw failure('工程字体不属于当前漫画或样式无效');const key=fontKey(font.family,weight);if(fonts.has(key))continue;fonts.set(key,{path:font.url.slice(1),family:font.family,weight});ownedFonts.push({...font,weight});}
  // Match the registry's first face for each family/weight and keep only its URL.
  // A bundled face is a fallback when the project has no corresponding face.
  if(project.fontAssets)project.fontAssets=ownedFonts;
  strings([project,...jobs.map(item=>item.request)],value=>{const ref=/^\/references\/([a-f0-9]{32})\/reference\.png$/.exec(value);if(ref)refIds.add(ref[1]);});
  visit([project,...jobs.map(item=>item.request)],value=>{
   if(Array.isArray(value.references))for(const ref of value.references){const rid=typeof ref==='string'?ref:ref?.id;if(validSource(rid))refIds.add(rid);}
   if(value.type==='text')for(const family of [value.fontFamily||defaultTextFont,defaultTextFont]){const selected=fontChoice(family,textFontWeight(value));if(selected){const key=fontKey(selected.font.family,selected.face.weight);if(!fonts.has(key))fonts.set(key,{path:'public/fonts/'+selected.face.file,family:selected.font.family,weight:Number(selected.face.weight)});}}
  });
  const references=[];for(const rid of refIds){const refMeta=JSON.parse(await readFile(path.join(this.root,'references',rid,'metadata.json'),'utf8'));if(refMeta.id!==rid)throw failure('参考图编号不一致');references.push({id:rid,metadata:cleanSnapshot(refMeta)});add(`references/${rid}/reference.png`);}
  for(const job of jobs){
   if(!validJob(job.id)||job.request.sourceId!==id)throw failure('工程任务编号不匹配');const folder=path.join(this.root,'jobs',job.id);
   for(const entry of await entries(folder)){if(entry.isSymbolicLink())throw failure('任务目录不能含符号链接');if(entry.isFile()&&jobFile.test(entry.name))add(`jobs/${job.id}/${entry.name}`);}
   for(const attempt of await entries(path.join(folder,'attempts'))){if(attempt.isSymbolicLink())throw failure('任务历史目录不能含符号链接');if(!attempt.isDirectory()||!validSource(attempt.name))continue;for(const entry of await entries(path.join(folder,'attempts',attempt.name))){if(entry.isSymbolicLink())throw failure('任务历史文件不能含符号链接');if(entry.isFile()&&jobFile.test(entry.name))add(`jobs/${job.id}/attempts/${attempt.name}/${entry.name}`);}}
  }
  for(const font of fonts.values())add(font.path);
  if(fonts.size)for(const base of ['public/fonts/licenses',`project-fonts/${id}/licenses`])for(const family of await entries(path.join(this.root,base))){if(family.isSymbolicLink())throw failure('字体许可目录不能含符号链接');if(!family.isDirectory()||!/^[a-z0-9-]{1,80}$/i.test(family.name))continue;for(const entry of await entries(path.join(this.root,base,family.name))){if(entry.isSymbolicLink())throw failure('字体许可文件不能含符号链接');if(entry.isFile()&&/^[a-z0-9_-]{1,80}\.txt$/i.test(entry.name)){const file=path.join(this.root,base,family.name,entry.name);if((await lstat(file)).size>1024*1024)throw failure('字体许可文件大小无效');add(`${base}/${family.name}/${entry.name}`);}}}
  return {format:'patch-studio-project',schemaVersion:1,sourceId:id,metadata:cleanSnapshot(metadata),project,jobs,references,fonts:[...fonts.values()],files:[...fileSet].sort().map(file=>({path:file})),createdAt:new Date().toISOString()};
 }
 async export(id){
  if(this.exporting.has(id))return this.exporting.get(id);
  const operation=(async()=>{const temporary=await temporaryFolder(this.root,'project-export-');let file;try{const snapshot=await this.snapshot(id),manifest=path.join(temporary,'snapshot.json');await writeFile(manifest,JSON.stringify(snapshot),'utf8');const name=`${safeName(snapshot.metadata.name)}-工程-${Date.now()}-${randomUUID().slice(0,8)}.patchproj`;file=path.join(this.root,'exports',name);const saved=await runBundle(this.root,this.toolRoot,['export','--manifest',manifest,'--file',file]);await this.projects.locked(id,async()=>{if((await sourceMetadata(this.root,id)).deletedAt)throw failure('漫画项目已删除，未保存工程文件',410);const registry=path.join(this.root,'sources',id,'project-files.json');let names=[];try{names=JSON.parse(await readFile(registry,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}const next=registry+'.'+randomUUID()+'.tmp';await writeFile(next,JSON.stringify([...new Set([...names,name])]),'utf8');await replaceFile(next,registry);});return {...saved,path:saved.file,name,url:`/api/project-files/download/${encodeURIComponent(name)}`,sourceId:id};}catch(error){if(file&&path.dirname(path.resolve(file))===path.resolve(this.root,'exports'))await rm(file,{force:true});throw error;}finally{await removeTemporary(this.root,temporary);}})();this.exporting.set(id,operation);try{return await operation;}finally{this.exporting.delete(id);}
 }
 async import(req){
  const contentLength=Number(req.headers?.['content-length']);if(Number.isFinite(contentLength)&&contentLength>MAX_PROJECT_FILE_BYTES)throw failure('工程文件超过 512 MB',413);
  const temporary=await temporaryFolder(this.root,'project-upload-'),file=path.join(temporary,'upload.patchproj');let bytes=0;
  try{const limit=new Transform({transform(chunk,encoding,done){bytes+=chunk.length;done(bytes>MAX_PROJECT_FILE_BYTES?failure('工程文件超过 512 MB',413):null,chunk);}});await pipeline(req,limit,createWriteStream(file,{flags:'wx'}));if(!bytes)throw failure('请选择工程文件');const result=await runBundle(this.root,this.toolRoot,['import','--file',file]);return result;}finally{await removeTemporary(this.root,temporary);}
 }
 async downloadFile(name){
  if(typeof name!=='string'||path.basename(name)!==name||!name.endsWith('.patchproj')||name.length>160)throw failure('工程文件名无效',404);const file=path.join(this.root,'exports',name),info=await lstat(file);if(info.isSymbolicLink()||!info.isFile()||info.size>MAX_PROJECT_FILE_BYTES)throw failure('工程文件不存在',404);return file;
 }
 async preparePreview(id,revision=0){
  if(!validSource(id))throw failure('漫画项目不存在',404);const key=id+':'+revision;
  if(this.previewing.has(key))return this.previewing.get(key);const operation=runBundle(this.root,this.toolRoot,['preview','--source-id',id,'--revision',String(revision)]);this.previewing.set(key,operation);try{return await operation;}finally{this.previewing.delete(key);}
 }
}
