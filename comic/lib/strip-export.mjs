import {episodeExportLayout} from '../public/episode-board-export.js';
import {ensureProjectBoardTransitionSafety,imageBoardsForTransition} from '../public/episode-board-transitions.js';
import {createRequire} from 'node:module';
import {layoutLongStrip} from '../public/model.js';
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {uid,check,imageInfo} from './store.mjs';
import {sendFile} from './send-file.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),require=createRequire(import.meta.url);
export function createStripExports({dataDir,store,body,json,projectView=p=>p}){
 const sessions=new Map(),directory=path.join(dataDir,'exports');
 function ownedPath(id){
  const target=path.resolve(directory,id),parent=path.resolve(directory);
  check(target.startsWith(parent+path.sep)&&/^export_[0-9a-f-]{36}$/.test(id),'导出路径无效');
  return target;
 }
 function sweep(){
  for(const [id,s] of sessions)if(Date.now()-s.time>60*60*1000&&!s.running){
   fs.rmSync(ownedPath(id),{recursive:true,force:true});sessions.delete(id);
  }
 }
 async function handle(request,response,pathname,method){
  if(pathname!=='/api/strip-exports'&&!pathname.startsWith('/api/strip-exports/'))return false;
  sweep();
  if(method==='POST'&&pathname==='/api/strip-exports'){
   const input=await body(request),project=store.project(input.projectId);
   check(input.expectedRevision===project.revision,'工程已经修改，请保存后重新导出',409);
   check(input.episode===undefined||input.episode===null||Number.isInteger(input.episode)&&input.episode>=1&&input.episode<=9999,'导出话数无效');const visible=projectView(project),page=input.pageId?visible.pages.find(p=>p.id===input.pageId):null;check(!input.pageId||page,'导出画板不存在',404);if(!page&&imageBoardsForTransition(visible,{episode:input.episode??null,assets:store.db.assets}).length){let native;try{native=require(process.env.COMIC_CANVAS_MODULE||'@napi-rs/canvas');}catch{throw Object.assign(new Error('本机图片检测组件不可用，请修复工作台环境后导出'),{status:503});}await ensureProjectBoardTransitionSafety(visible,{episode:input.episode??null,assets:store.db.assets,imageLoader:id=>native.loadImage(store.assetPath(id)),canvasFactory:()=>native.createCanvas(1,1),refresh:true});}const layout=page?layoutLongStrip([page]):episodeExportLayout(visible,{episode:input.episode??null,assets:store.db.assets});check(layout.height>0&&layout.height<=2000000,'单张 PNG 支持高度 1—2000000 px；工程数据不截断');
   const id=uid('export'),s={id,width:layout.width,height:layout.height,nextY:0,parts:[],time:Date.now(),running:false,complete:false};
   fs.mkdirSync(ownedPath(id),{recursive:true});sessions.set(id,s);json(response,201,{id,width:s.width,height:s.height});return true;
  }
  const match=pathname.match(/^\/api\/strip-exports\/(export_[0-9a-f-]{36})\/(parts|complete|download)$/);
  check(match,'导出接口不存在',404);const s=sessions.get(match[1]);check(s,'导出会话已失效，请重新导出',404);s.time=Date.now();
  if(match[2]==='parts'&&method==='POST'){
   check(!s.running&&!s.complete,'导出已在写入完整长图',409);
   const input=await body(request,43*1024*1024);
   check(input.index===s.parts.length&&input.y===s.nextY,'导出片段次序不一致');
   check(typeof input.dataBase64==='string'&&/^[A-Za-z0-9+/]+={0,2}$/.test(input.dataBase64),'导出片段格式无效');
   const bytes=Buffer.from(input.dataBase64,'base64'),info=imageInfo(bytes);
   check(info.mime==='image/png'&&info.width===s.width&&info.height>=1&&info.height<=8192&&s.nextY+info.height<=s.height,'导出片段尺寸不一致');
   const name='part_'+String(s.parts.length).padStart(4,'0')+'.png',file=path.join(ownedPath(s.id),name);
   fs.writeFileSync(file,bytes);s.parts.push({path:file,y:s.nextY,height:info.height});s.nextY+=info.height;
   json(response,200,{received:s.parts.length,nextY:s.nextY});return true;
  }
  if(match[2]==='complete'&&method==='POST'){
   await body(request);
   check(s.nextY===s.height&&s.parts.length>0,'整话片段不完整，未写出截断长图');
   if(!s.complete){
    check(!s.running,'完整长图正在写入，请稍后重试',409);s.running=true;
    try{
     const result=await new Promise((resolve,reject)=>{
      const python=process.env.COMIC_PYTHON_BIN||path.join(root,'runtime','python','python.exe');
      const child=spawn(python,[path.join(root,'python','strip_png.py')],{cwd:root,windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,PYTHONUTF8:'1',PYTHONDONTWRITEBYTECODE:'1'}});
      let out='',err='';const timer=setTimeout(()=>{child.kill();reject(new Error('整话 PNG 写入超时'));},180000);
      child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
      child.stdout.on('data',chunk=>{out+=chunk;});child.stderr.on('data',chunk=>{err=(err+chunk).slice(-3000);});
      child.on('error',e=>{clearTimeout(timer);reject(new Error('便携 Python 不可用：'+e.message));});
      child.on('close',code=>{clearTimeout(timer);if(code!==0)return reject(new Error(err.trim()||'整话 PNG 写入失败'));try{resolve(JSON.parse(out));}catch{reject(new Error('整话 PNG 返回格式无效'));}});
      child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify({width:s.width,height:s.height,parts:s.parts,output:path.join(ownedPath(s.id),'episode.png')}));
     });
     s.complete=true;s.result=result;
    }finally{s.running=false;}
   }
   json(response,200,{...s.result,url:'/api/strip-exports/'+s.id+'/download'});return true;
  }
  if(match[2]==='download'&&method==='GET'){
   check(s.complete,'整话 PNG 尚未完成',409);
   await sendFile(response,path.join(ownedPath(s.id),'episode.png'),{'Content-Type':'image/png','Content-Disposition':'attachment; filename="episode.png"','X-Content-Type-Options':'nosniff'},{missingMessage:'整话 PNG 已被清理，请重新导出'});return true;
  }
  check(false,'导出接口不支持此操作',405);
 }
 return {handle};
}
