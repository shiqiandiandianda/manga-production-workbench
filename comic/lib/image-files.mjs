import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {check,imageInfo} from './store.mjs';
import {run,findPython} from './process.mjs';
import {isMountedImagePath,mountedImageIO} from './mounted-io.mjs';

export function imagePathValue(value){
 check(typeof value==='string'&&value.length>0&&value.length<=32768,'请提供图片的完整本地路径');
 let file=value.trim().replace(/^"(.*)"$/s,'$1');
 if(file.startsWith('file:')){try{file=fileURLToPath(file);}catch{check(false,'本地图片路径无效');}}
 check(path.isAbsolute(file)&&!/[\r\n\0]/.test(file)&&!/^\\\\[.?]\\/.test(file),'图片需要完整文件路径，例如 K:\\素材\\角色.png');
 check(/\.(png|jpe?g|webp)$/i.test(file),'只支持 PNG、JPEG 或 WebP 图片');
 return path.resolve(file);
}
export function localImagePath(value){
 const file=imagePathValue(value);
 try{const real=fs.realpathSync(file);check(fs.statSync(real).isFile(),'图片路径不是文件');return real;}
 catch(error){if(error.status)throw error;check(false,'无法读取图片，请检查文件是否存在、共享盘是否连接：'+file,404);}
}
export function inspectImageFile(value){
 const filePath=localImagePath(value),stat=fs.statSync(filePath);
 check(stat.size>24&&stat.size<=256*1024*1024,'图片为空或超过 256 MB');
 const info=imageInfo(fs.readFileSync(filePath));
 return {...info,filePath,storage:'path',fileSize:stat.size,fileModified:stat.mtimeMs,fileChanged:stat.ctimeMs};
}
export async function inspectImageFileAsync(value,{cached=null}={}){
 const requested=imagePathValue(value),filePath=isMountedImagePath(requested)?requested:localImagePath(requested),stat=await mountedImageIO(filePath,()=>fs.promises.lstat(filePath));
 check(stat.isFile()&&!stat.isSymbolicLink(),'图片路径不是普通文件');
 check(stat.size>24&&stat.size<=256*1024*1024,'图片为空或超过 256 MB');
 // Windows and mounted filesystems can coalesce timestamps for quick writes.
 // Reuse dimensions only after the file's metadata has settled for a second.
 if(cached?.width&&cached.fileSize===stat.size&&cached.fileModified===stat.mtimeMs&&cached.fileChanged===stat.ctimeMs&&Date.now()-Math.max(stat.mtimeMs,stat.ctimeMs)>1000)return {width:cached.width,height:cached.height,mime:cached.mime,extension:cached.extension,filePath,storage:'path',fileSize:stat.size,fileModified:stat.mtimeMs,fileChanged:stat.ctimeMs};
 return mountedImageIO(filePath,async()=>{const handle=await fs.promises.open(filePath,'r');try{
  const header=Buffer.alloc(Math.min(stat.size,65536)),{bytesRead}=await handle.read(header,0,header.length,0);
  let info;
  try{info=imageInfo(header.subarray(0,bytesRead));}
  catch(error){
   // JPEG metadata may precede the size marker. The common path reads headers only.
   if(header[0]!==255||header[1]!==216||bytesRead>=stat.size)throw error;
   info=imageInfo(await handle.readFile());
  }
  return {...info,filePath,storage:'path',fileSize:stat.size,fileModified:stat.mtimeMs,fileChanged:stat.ctimeMs};
 }finally{await handle.close();}});
}
export function referenceStamp(files){return JSON.stringify(files.map(file=>{const real=localImagePath(file),s=fs.statSync(real);return [real,s.size,s.mtimeMs,s.ctimeMs];}));}
export async function selectImageFiles({multiple=false,runner=run}={}){
 check(process.platform==='win32','当前系统请粘贴图片路径',409);
 const executable=findPython();check(executable,'请使用随包提供的 Python，或粘贴图片路径',409);
 const script=fileURLToPath(new URL('../python/select_images.py',import.meta.url));
 const result=await runner([executable],[script,...(multiple?['--multiple']:[])],{timeout:300000});
 check(result.code===0,'文件选择未完成，请改为粘贴图片路径',502);
 let files;try{files=JSON.parse(result.stdout.replace(/^\uFEFF/,'').trim()||'[]');}catch{check(false,'文件选择返回无效路径，请粘贴路径',502);}
 check(Array.isArray(files)&&files.length<=60&&files.every(f=>typeof f==='string'),'文件路径过多或无效');return files;
}
export async function selectImageDirectory({runner=run}={}){
 check(process.platform==='win32','当前系统请粘贴目录路径',409);
 const executable=findPython();check(executable,'请使用随包提供的 Python，或粘贴目录路径',409);
 const script=fileURLToPath(new URL('../python/select_directory.py',import.meta.url));
 const result=await runner([executable],[script],{timeout:300000});
 check(result.code===0,'目录选择未完成，请改为粘贴目录路径',502);
 let directory;try{directory=JSON.parse(result.stdout.replace(/^\uFEFF/,'').trim()||'null');}catch{check(false,'目录选择返回无效路径，请粘贴目录路径',502);}
 check(directory===null||typeof directory==='string','目录选择返回无效路径');return directory;
}
