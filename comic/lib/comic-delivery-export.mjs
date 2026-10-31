import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {uid,check,imageInfo} from './store.mjs';
import {sendFile} from './send-file.mjs';
import {comicDeliveryLayouts,deliveryDimensions,deliveryProtectedRanges} from '../public/comic-delivery-layout.js';
import {chooseDeliveryCuts,validateDeliveryCuts,deliveryCutsSafe} from '../public/comic-delivery-cuts.js';
const root=fileURLToPath(new URL('../',import.meta.url)),require=createRequire(import.meta.url);
function worker(spec){return new Promise((resolve,reject)=>{
 const python=process.env.COMIC_PYTHON_BIN||path.join(root,'../runtime/python/python.exe'),child=spawn(python,[path.join(root,'python/comic_delivery.py')],{cwd:root,windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,PYTHONUTF8:'1',PYTHONDONTWRITEBYTECODE:'1'}});let out='',err='';
 const timer=setTimeout(()=>{child.kill();reject(Error('交付图片处理超时，请重试导出'));},180000);child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');child.stdout.on('data',c=>{out+=c;});child.stderr.on('data',c=>{err=(err+c).slice(-3000);});child.on('error',e=>{clearTimeout(timer);reject(Error('导出 Python 不可用：'+e.message));});child.on('close',code=>{clearTimeout(timer);if(code!==0)return reject(Error(err.trim()||'交付图片处理失败'));try{resolve(JSON.parse(out));}catch{reject(Error('交付处理结果无效'));}});child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify(spec));
});}
export function createComicDeliveryExports({dataDir,store,body,json,projectView=p=>p}){
 const sessions=new Map(),base=path.resolve(dataDir,'delivery-exports');
 const directory=id=>{const dir=path.resolve(base,id);check(/^delivery_[a-f0-9-]{36}$/.test(id)&&path.dirname(dir)===base,'交付导出路径无效');return dir;};
 function sweep(){for(const [id,s]of sessions)if(!s.running&&Date.now()-s.time>3600000){fs.rmSync(directory(id),{recursive:true,force:true});sessions.delete(id);}}
 function current(s){const p=store.project(s.projectId);check(p.revision===s.revision&&projectView(p).episodeBoards?.templateRevision===s.templateRevision,'工程或封尾模板已修改，请关闭预览并重新导出',409);}
 function ready(s){check(Object.values(s.groups).every(g=>g.nextY===g.height&&g.parts.length),'导出图片尚未全部接收，不能生成不完整交付包',409);}
 const resultView=s=>({...s.result,url:'/api/comic-delivery-exports/'+s.id+'/download',files:s.result.files.map(f=>({...f,url:'/api/comic-delivery-exports/'+s.id+'/files/'+encodeURIComponent(f.name)}))});
 const view=s=>({id:s.id,projectId:s.projectId,revision:s.revision,episode:s.episode,groups:Object.fromEntries(Object.entries(s.groups).map(([key,g])=>[key,{width:g.width,height:g.height}]))});
 return {async handle(req,res,pathname,method){
  if(pathname!=='/api/comic-delivery-exports'&&!pathname.startsWith('/api/comic-delivery-exports/'))return false;sweep();
  if(pathname==='/api/comic-delivery-exports'&&method==='POST'){
   const input=await body(req),project=store.project(input.projectId);check(project.revision===input.expectedRevision,'工程已修改，请保存后重新导出',409);
   const visible=projectView(project),plan=comicDeliveryLayouts(visible,input.episode,store.db.assets);check(plan.groups.body.height<=2000000,'正文长图超过 2000000 px，请分话导出');
   check(input.templateRevision===visible.episodeBoards?.templateRevision,'封尾模板已更新，请重新打开导出',409);
   let measurement;try{measurement=require(process.env.COMIC_CANVAS_MODULE||'@napi-rs/canvas').createCanvas(1,1).getContext('2d');}catch{check(!visible.pages.some(p=>p.bubbles?.some(b=>b.visible)),'文字测量组件不可用，无法保证切口避开文字',503);}
   const id=uid('delivery'),s={id,projectId:project.id,revision:project.revision,templateRevision:visible.episodeBoards?.templateRevision,episode:plan.episode,time:Date.now(),running:false,groups:Object.fromEntries(Object.entries(deliveryDimensions(plan)).map(([key,g])=>[key,{...g,nextY:0,parts:[]}])),protectedRanges:deliveryProtectedRanges(visible,plan.groups.body,measurement)};
   fs.mkdirSync(directory(id),{recursive:true});sessions.set(id,s);json(res,201,view(s));return true;
  }
  const m=/^\/api\/comic-delivery-exports\/(delivery_[a-f0-9-]{36})(?:\/(parts|analyze|complete|download|files\/[^/]+))?$/.exec(pathname);check(m,'交付导出接口不存在',404);const s=sessions.get(m[1]);check(s,'交付导出已失效，请重新导出',404);s.time=Date.now();const route='/api/comic-delivery-exports/'+s.id,dir=directory(s.id);
  if(method==='DELETE'&&!m[2]){check(!s.running,'导出正在写入，请稍后关闭',409);fs.rmSync(dir,{recursive:true,force:true});sessions.delete(s.id);json(res,200,{ok:true});return true;}
  if(method==='GET'&&(m[2]==='download'||m[2]?.startsWith('files/'))){
   const name=m[2]==='download'?'delivery.zip':decodeURIComponent(m[2].slice(6));check(name==='overview.png'&&s.analysis||s.result&&(name==='delivery.zip'||s.result.files.some(f=>f.name===name)),'导出文件尚未完成或不存在',404);check(path.basename(name)===name,'文件名无效');
   await sendFile(res,path.join(dir,name),{'Content-Type':name.endsWith('.zip')?'application/zip':'image/png','Content-Disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(name==='delivery.zip'?'第'+s.episode+'话_甲方交付.zip':name),'X-Content-Type-Options':'nosniff'});return true;
  }
  check(method==='POST','交付导出操作不存在',405);current(s);if(m[2]==='complete'&&s.result){const input=await body(req);check(JSON.stringify(input.cuts)===JSON.stringify(s.result.cuts),'已完成导出的切点不能更改，请重新打开导出',409);json(res,200,resultView(s));return true;}check(!s.running&&!s.result,'当前交付导出已完成或正在处理，请重新打开导出',409);
  if(m[2]==='parts'){
   const input=await body(req,43*1024*1024),g=Object.hasOwn(s.groups,input.group)?s.groups[input.group]:null;check(g&&input.index===g.parts.length&&input.y===g.nextY,'导出分段次序无效');check(typeof input.dataBase64==='string'&&/^[A-Za-z0-9+/]+={0,2}$/.test(input.dataBase64),'图片格式无效');const bytes=Buffer.from(input.dataBase64,'base64'),info=imageInfo(bytes);check(info.mime==='image/png'&&info.width===g.width&&info.height>0&&info.height<=4096&&g.nextY+info.height<=g.height,'导出分段尺寸无效');
   const file=path.join(dir,input.group+'_'+g.parts.length+'.png');fs.writeFileSync(file,bytes);g.parts.push({path:file,y:g.nextY,height:info.height});g.nextY+=info.height;json(res,200,{received:g.parts.length,nextY:g.nextY});return true;
  }
  const input=await body(req);ready(s);check(['analyze','complete'].includes(m[2]),'交付导出操作不存在',404);s.running=true;
  try{
   if(m[2]==='analyze'){
    const analysis=await worker({action:'analyze',directory:dir,groups:s.groups,protectedRanges:s.protectedRanges});current(s);s.analysis={...analysis,...chooseDeliveryCuts(s.groups.body.height,analysis.gaps)};
    json(res,200,{...s.analysis,protectedRanges:s.protectedRanges,previewUrl:route+'/files/overview.png',warnings:['cover','tail'].filter(kind=>!s.groups[kind]).map(kind=>(kind==='cover'?'封面':'尾图')+'未设置，本次不会生成该文件')});return true;
   }
   check(s.analysis,'请先识别并预览裁切位置',409);validateDeliveryCuts(s.groups.body.height,input.cuts);
   const safe=deliveryCutsSafe(input.cuts,s.analysis.gaps,s.protectedRanges);check(safe||input.reviewed===true,'切点不在两个不同的安全缝隙内，请调整或先核对切口预览',409);
   const result=await worker({action:'complete',directory:dir,groups:s.groups,cuts:input.cuts,episode:s.episode,projectId:s.projectId,revision:s.revision,prefix:'第'+String(s.episode).padStart(3,'0')+'话'});current(s);s.result=result;
   json(res,200,resultView(s));return true;
  }finally{s.running=false;}
 }};
}
