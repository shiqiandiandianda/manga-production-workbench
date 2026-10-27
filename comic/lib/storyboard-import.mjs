import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
export async function importStoryboard(input={}){
 if(typeof input.text==='string'){
  if(Buffer.byteLength(input.text,'utf8')>8*1024*1024)throw new Error('分镜文本超过 8 MB');
  return {text:input.text};
 }
 if(typeof input.dataBase64!=='string'||!/^[A-Za-z0-9+/]*={0,2}$/.test(input.dataBase64)||input.dataBase64.length>12*1024*1024)
  throw new Error('分镜文件为空或超过 8 MB');
 const bytes=Buffer.from(input.dataBase64,'base64'),name=String(input.name||'');
 if(bytes.length>8*1024*1024)throw new Error('分镜文件超过 8 MB');
 if(!/\.xlsx$/i.test(name)){
  if(!/\.(csv|tsv|json|txt)$/i.test(name))throw new Error('请使用 XLSX、CSV、TSV、JSON 或 TXT；旧 XLS 请另存为 XLSX');
  const decoder=new TextDecoder('utf-8',{fatal:true});
  try{return {text:decoder.decode(bytes)};}catch{throw new Error('文本文件需要 UTF-8 编码；建议从 Excel 另存为 CSV UTF-8');}
 }
 return new Promise((resolve,reject)=>{
  const python=process.env.COMIC_PYTHON_BIN||path.join(root,'runtime','python','python.exe');
  const child=spawn(python,[path.join(root,'python','storyboard_xlsx.py')],{cwd:root,windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,PYTHONUTF8:'1',PYTHONDONTWRITEBYTECODE:'1'}});
  let out='',err='',done=false;
  const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);error?reject(error):resolve(value);};
  const timer=setTimeout(()=>{child.kill();finish(new Error('Excel 读取超时，请检查工作簿大小'));},15000);
  child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
  child.stdout.on('data',chunk=>{out+=chunk;if(out.length>12*1024*1024){child.kill();finish(new Error('工作簿内容超过支持长度'));}});
  child.stderr.on('data',chunk=>{err=(err+chunk).slice(-3000);});
  child.on('error',e=>finish(new Error('便携 Python 无法启动：'+e.message)));
  child.on('close',code=>{if(code!==0)return finish(new Error(err.trim()||'Excel 读取失败'));try{finish(null,JSON.parse(out));}catch{finish(new Error('Excel 返回格式无效'));}});
  child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify({dataBase64:input.dataBase64,sheet:input.sheet||'',mode:input.mode==='inspect'?'inspect':'',maxColumns:Number.isInteger(input.maxColumns)&&input.maxColumns>=64&&input.maxColumns<=256?input.maxColumns:64}));
 });
}
