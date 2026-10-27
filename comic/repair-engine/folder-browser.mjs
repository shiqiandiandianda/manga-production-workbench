import path from 'node:path';
import {readdir,stat} from 'node:fs/promises';

export function bounded(promise,ms,message='读取文件夹超时，请重试或直接填写路径'){
  let timer;
  return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Object.assign(new Error(message),{status:504})),ms);})]).finally(()=>clearTimeout(timer));
}
export class LocalFolderBrowser {
  constructor({fs={readdir,stat},timeoutMs=6000,roots=process.platform==='win32'?[...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].map(letter=>letter+':\\'):['/']}={}){
    this.fs=fs;this.timeoutMs=timeoutMs;this.roots=roots;this.driveCache=null;
  }
  async drives(){
    if(this.driveCache&&Date.now()-this.driveCache.time<30000)return this.driveCache.value;
    const entries=await Promise.all(this.roots.map(async root=>{
      try{const info=await bounded(this.fs.stat(root),Math.min(1200,this.timeoutMs));return info.isDirectory()?{name:root,path:root}:null;}catch{return null;}
    }));
    const value=entries.filter(Boolean);this.driveCache={time:Date.now(),value};return value;
  }
  async list(input=''){
    if(typeof input!=='string'||input.length>4096||/[\x00-\x1f]/.test(input))throw Object.assign(new Error('文件夹路径无效'),{status:400});
    const drives=await this.drives();
    if(!input.trim())return{path:'',parent:null,folders:drives,drives,root:true};
    if(!path.isAbsolute(input))throw Object.assign(new Error('请填写完整的本地文件夹路径，例如 D:\\漫画工具'),{status:400});
    const directory=path.resolve(input),parent=path.dirname(directory);
    let entries;
    try{entries=await bounded(this.fs.readdir(directory,{withFileTypes:true}),this.timeoutMs);}
    catch(error){
      if(error.status===504)throw error;
      const message={ENOENT:'这个文件夹不存在，请检查路径或返回上一级',ENOTDIR:'所填路径是文件，请选择文件夹',EACCES:'没有权限打开这个文件夹，请选择其他目录',EPERM:'没有权限打开这个文件夹，请选择其他目录'}[error.code]||'暂时无法读取这个文件夹，请重试或直接填写路径';
      throw Object.assign(new Error(message),{status:error.code==='ENOENT'?404:400});
    }
    const hidden=new Set(['$RECYCLE.BIN','System Volume Information','Config.Msi']);
    const folders=entries.filter(item=>item.isDirectory()&&!item.name.startsWith('.')&&!hidden.has(item.name))
      .sort((a,b)=>a.name.localeCompare(b.name,'zh-CN',{numeric:true})).map(item=>({name:item.name,path:path.join(directory,item.name)}));
    return{path:directory,parent:parent===directory?null:parent,folders,drives,root:false};
  }
}
