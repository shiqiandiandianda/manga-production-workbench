import path from 'node:path';
import {realpath,stat} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';

const failure=(message,statusCode)=>Object.assign(new Error(message),{statusCode});

// Browsers receive a receipt for a completed export, never an arbitrary launch path.
export class ExportFolders {
  constructor({spawnProcess=spawn,platform=process.platform,maxReceipts=100}={}){
    this.spawnProcess=spawnProcess;this.platform=platform;this.maxReceipts=maxReceipts;this.receipts=new Map();
  }
  registerResult(saved){
    const file=saved.archivePath||saved.file;
    if(typeof file!=='string'||!path.isAbsolute(file))throw failure('导出文件路径无效',500);
    const resolved=path.resolve(file),folderToken=randomUUID();this.receipts.set(folderToken,resolved);
    while(this.receipts.size>this.maxReceipts)this.receipts.delete(this.receipts.keys().next().value);
    return {...saved,folderToken,exportFolder:path.dirname(resolved)};
  }
  async open(folderToken){
    const file=typeof folderToken==='string'&&this.receipts.get(folderToken);
    if(!file)throw failure('导出记录已失效，请重新导出',404);
    let target;
    try{target=await realpath(file);if(!(await stat(target)).isFile())throw new Error('Not a file');}
    catch{throw failure('导出文件已移动或删除，请重新导出',404);}
    const folder=path.dirname(target),command=this.platform==='win32'?path.join(process.env.SystemRoot||'C:\\Windows','explorer.exe'):this.platform==='darwin'?'open':this.platform==='linux'?'xdg-open':null;
    if(!command)throw failure('当前系统不支持打开文件夹',501);
    try{
      await new Promise((resolve,reject)=>{
        const child=this.spawnProcess(command,[folder],{windowsHide:false,detached:true,stdio:'ignore'});
        child.once('error',reject);child.once('spawn',()=>{child.unref();resolve();});
      });
    }catch(error){throw failure('无法打开文件夹：'+error.message,500);}
    return {ok:true,folder};
  }
}
