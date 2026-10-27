import path from 'node:path';
import {readFile,readdir,rm,lstat} from 'node:fs/promises';
const validSource=id=>/^[a-f0-9]{32}$/.test(id),validJob=id=>/^\d{8}-\d{6}-[a-f0-9]{8}$/.test(id);
async function json(file,fallback){try{return JSON.parse(await readFile(file,'utf8'));}catch(error){if(error.code==='ENOENT')return fallback;throw error;}}
async function entries(directory){try{return await readdir(directory,{withFileTypes:true});}catch(error){if(error.code==='ENOENT')return [];throw error;}}
async function bytes(file){try{const info=await lstat(file);if(!info.isDirectory()||info.isSymbolicLink())return info.size;let total=0;for(const item of await entries(file))total+=await bytes(path.join(file,item.name));return total;}catch(error){if(error.code==='ENOENT')return 0;throw error;}}
async function removeChild(base,file){base=path.resolve(base);file=path.resolve(file);if(path.dirname(file)!==base)throw new Error('项目清理路径无效');const size=await bytes(file);await rm(file,{recursive:true,force:true});return size;}
// Delete only paths whose source/job ownership is verified. Shared reference libraries are independent.
export async function purgeProjectFiles(root,meta,storage,jobs){
 if(!validSource(meta.id))throw new Error('漫画项目不存在');
 const id=meta.id,sourceRoot=path.resolve(root,'sources'),source=path.join(sourceRoot,id),project=await json(path.join(source,'project.json'),{});
 const exportRoot=path.resolve(root,'exports'),exports=new Set([...(await json(path.join(source,'export-files.json'),[])),...(await json(path.join(source,'project-files.json'),[]))]);
 if(project.composite?.file&&path.dirname(path.resolve(project.composite.file))===exportRoot)exports.add(path.basename(project.composite.file));
 exports.add((meta.name.replace(/\.[^.]+$/,'').replace(/[^\p{L}\p{N} _-]/gu,'-').slice(0,80)||'漫画')+'-自动合成-'+id+'.png');
 const archiveRoot=path.resolve(storage.status().directory),folder=path.resolve(storage.projectFolder(meta));
 if(path.dirname(folder)!==archiveRoot)throw new Error('项目归档清理路径无效');
 const owner=await json(path.join(folder,'原始漫画','原图信息.json'),null);
 if(owner&&owner.id!==id)throw new Error('项目归档编号不匹配');
 for(const entry of await entries(path.join(folder,'导出成品')))if(entry.isFile()&&entry.name.startsWith('成品－'))exports.add(entry.name.slice(3));
 let freedBytes=0;const removed=[];
 for(const job of jobs){if(job.sourceId!==id||!validJob(job.id))continue;const jobRoot=path.resolve(root,'jobs'),file=path.join(jobRoot,job.id),request=await json(path.join(file,'request.json'),null);if(request?.sourceId!==id)continue;freedBytes+=await removeChild(jobRoot,file);removed.push(file);}
 for(const name of exports){if(typeof name!=='string'||path.basename(name)!==name||!['.png','.patchproj'].includes(path.extname(name).toLowerCase()))continue;const file=path.join(exportRoot,name);freedBytes+=await removeChild(exportRoot,file);removed.push(file);}
 freedBytes+=await removeChild(archiveRoot,folder);removed.push(folder);
 const backupRoot=path.resolve(root,'备份');for(const entry of await entries(backupRoot)){if(!entry.isDirectory()||!/^V\d+升级前-\d{8}-\d{6}$/.test(entry.name))continue;const snapshots=path.join(backupRoot,entry.name,'工程快照'),snapshot=path.join(snapshots,id);freedBytes+=await removeChild(snapshots,snapshot);removed.push(snapshot);const backupAssets=path.join(backupRoot,entry.name,'project-assets'),assetCopy=path.join(backupAssets,id);freedBytes+=await removeChild(backupAssets,assetCopy);removed.push(assetCopy);}
 const assetsRoot=path.resolve(root,'project-assets'),assets=path.join(assetsRoot,id);freedBytes+=await removeChild(assetsRoot,assets);removed.push(assets);
 const fontsRoot=path.resolve(root,'project-fonts'),fonts=path.join(fontsRoot,id);freedBytes+=await removeChild(fontsRoot,fonts);removed.push(fonts);
 freedBytes+=await removeChild(sourceRoot,source);removed.push(source);
 return{ok:true,id,permanent:true,freedBytes,removed};
}
