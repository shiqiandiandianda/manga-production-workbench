import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {sendFile} from './send-file.mjs';
import {check} from './store.mjs';
import {writeFileAtomicSync} from './durable-files.mjs';
import {sourceFile} from '../repair-engine/page-service.mjs';

// Processing receipts live outside layout snapshots. Undo never deletes a result.
export function createLayoutRepair({root,store,localTools,createSession,applySession,body,json}){
 const directory=path.join(root,'layout-records'),locks=new Set();fs.mkdirSync(directory,{recursive:true});
 const uuid=/^[a-f0-9-]{36}$/i;
 const save=r=>writeFileAtomicSync(path.join(directory,r.id+'.json'),JSON.stringify(r));
 const read=id=>{check(uuid.test(id),'处理记录无效');const file=path.join(directory,id+'.json');check(fs.existsSync(file),'处理记录不存在',404);return JSON.parse(fs.readFileSync(file,'utf8'));};
 function records(projectId){
  const rows=fs.readdirSync(directory).filter(n=>n.endsWith('.json')).map(n=>JSON.parse(fs.readFileSync(path.join(directory,n),'utf8'))).filter(r=>r.projectId===projectId);
  // Recover completed work from the previous split editor, including undone HD.
  const known=new Set(rows.map(r=>r.taskId)),sessions=fs.readdirSync(path.join(root,'sessions')).filter(n=>uuid.test(n.replace(/\.json$/,''))).map(n=>JSON.parse(fs.readFileSync(path.join(root,'sessions',n),'utf8'))).filter(s=>s.projectId===projectId);
  for(const task of localTools.list({limit:Infinity})){
   if(known.has(task.id)||task.regionSelection)continue;
   const s=sessions.find(s=>s.sourceId===task.sourceId||s.initialSourceId===task.sourceId);if(!s)continue;
   const row={id:task.id,taskId:task.id,projectId,panelId:s.originalPanelId||s.panelId,sourceAssetId:s.initialImageAssetId||s.imageAssetId,sessionId:s.id,operation:task.operation,model:task.model,scale:task.scale,createdAt:task.createdAt,legacy:true};rows.push(row);known.add(task.id);
  }
  return rows.sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));
 }
 function view(r){let task;try{task=localTools.get(r.taskId);}catch{}const p=store.project(r.projectId),layer=r.layerId&&p.pages.flatMap(p=>p.panels).find(f=>f.id===r.layerId);return {...r,nativeScale:task?.nativeScale||r.nativeScale,outputScale:task?.outputScale||r.outputScale,modelLabel:task?.modelLabel||r.modelLabel,sourceUrl:task?'/api/layout-repair/'+r.id+'/source?projectId='+r.projectId:null,status:task?.status||'failed',message:task?.message||r.error||'任务未启动，请重试',onCanvas:!!(layer&&layer.imageAssetId===r.assetId),previewUrl:task?.status==='done'?'/api/layout-repair/'+r.id+'/preview?projectId='+r.projectId:null,resultUrl:task?.status==='done'?'/repair/api/local-tools/'+task.id+'/result':null};}
 async function handle(req,res,{pathname,method,url}){
  if(!pathname.startsWith('/api/layout-repair/'))return false;
  const source=pathname.match(/^\/api\/layout-repair\/([a-f0-9-]{36})\/source$/i);
  if(source&&method==='GET'){const projectId=url.searchParams.get('projectId');store.project(projectId);const r=records(projectId).find(r=>r.id===source[1]);check(r,'处理记录不存在',404);await sendFile(res,localTools.source(r.taskId),{'Content-Type':'image/png','Cache-Control':'private, max-age=86400'});return true;}
  const preview=pathname.match(/^\/api\/layout-repair\/([a-f0-9-]{36})\/preview$/i);
  if(preview&&method==='GET'){const projectId=url.searchParams.get('projectId');store.project(projectId);const r=records(projectId).find(r=>r.id===preview[1]);check(r,'处理记录不存在',404);const file=localTools.result(r.taskId),thumbnail=path.join(directory,r.taskId+'-preview.png');if(!fs.existsSync(thumbnail)){const native=createRequire(import.meta.url)(process.env.COMIC_CANVAS_MODULE||process.env.COMIC_TEST_CANVAS_MODULE||'@napi-rs/canvas'),im=await native.loadImage(file),scale=Math.min(1,240/im.width,360/im.height),c=native.createCanvas(Math.max(1,Math.round(im.width*scale)),Math.max(1,Math.round(im.height*scale)));c.getContext('2d').drawImage(im,0,0,c.width,c.height);writeFileAtomicSync(thumbnail,c.toBuffer('image/png'));}await sendFile(res,thumbnail,{'Content-Type':'image/png','Cache-Control':'private, max-age=86400'});return true;}
  if(pathname==='/api/layout-repair/history'&&method==='GET'){const projectId=url.searchParams.get('projectId');store.project(projectId);json(res,200,{items:records(projectId).map(view)});return true;}
  if(pathname==='/api/layout-repair/start'&&method==='POST'){
   const input=await body(req);check(uuid.test(input.requestId||''),'缺少处理请求编号');const existing=path.join(directory,input.requestId+'.json');if(fs.existsSync(existing)){const r=read(input.requestId);check(r.projectId===input.projectId&&r.panelId===input.panelId,'请求归属不符',409);json(res,200,view(r));return true;}
   const key=input.projectId+':'+input.panelId;check(!locks.has(key),'此画格正在准备处理，请勿重复点击',409);locks.add(key);
   try{check(['upscale','cutout'].includes(input.operation),'请选择高清放大或整图抠图');check(!records(input.projectId).some(r=>r.panelId===input.panelId&&['queued','running'].includes(view(r).status)),'此画格已有本地处理任务，请在处理记录中查看',409);const {session,metadata}=await createSession(input),r={id:input.requestId,projectId:session.projectId,panelId:session.panelId,sourceAssetId:session.imageAssetId,sessionId:session.id,operation:input.operation,model:input.model,scale:input.scale,createdAt:new Date().toISOString()};
    const task=localTools.start({input:sourceFile(root,metadata),sourceId:metadata.id,operation:r.operation,scale:r.scale,model:r.model,requestId:r.id});Object.assign(r,{taskId:task.id,nativeScale:task.nativeScale,outputScale:task.outputScale,modelLabel:task.modelLabel});save(r);json(res,202,view(r));
   }finally{locks.delete(key);}return true;
  }
  const apply=pathname.match(/^\/api\/layout-repair\/([a-f0-9-]{36})\/apply$/i);
  if(apply&&method==='POST'){
   const input=await body(req),r=records(input.projectId).find(r=>r.id===apply[1]);check(r,'当前工程没有这条处理记录',404);const key=r.projectId+':'+r.panelId;check(!locks.has(key),'此画格正在应用，请稍候',409);locks.add(key);
   try{
    const project=store.project(r.projectId);check(project.revision===input.expectedRevision,'工程已有修改，请保存后重试',409);
    const panels=project.pages.flatMap(p=>p.panels),existing=r.layerId&&panels.find(p=>p.id===r.layerId);
    if(existing&&existing.imageAssetId===r.assetId){json(res,200,{applied:true,unchanged:true,project,layerId:existing.id,asset:store.asset(r.assetId),message:'这个结果已在画布上，没有重复添加'});return true;}
    const panel=panels.find(p=>p.id===r.panelId);check(panel,'来源图层已删除，请先在修改步骤中恢复来源图层',409);
    // Never silently place an old result over a newer image.
    check(panel.imageAssetId===r.sourceAssetId,'来源图片已更换，旧结果保留；请恢复对应原图后再取回',409);
    const file=await localTools.validatedResult(r.taskId),prepared=await createSession({projectId:r.projectId,panelId:r.panelId,expectedRevision:input.expectedRevision});
    const original=JSON.parse(fs.readFileSync(path.join(root,'sessions',r.sessionId+'.json'),'utf8'));
    check((original.composition?.stamp||null)===(prepared.session.composition?.stamp||null),'补图组合已经改变，旧结果保留，请恢复对应组合后再取回',409);
    const exports=path.join(root,'exports');fs.mkdirSync(exports,{recursive:true});const resultUrl='/repair/exports/layout-'+r.taskId+'.png';fs.copyFileSync(file,path.join(exports,'layout-'+r.taskId+'.png'));
    const result=await applySession(prepared.session.id,{expectedRevision:input.expectedRevision,resultUrl,mode:r.operation==='upscale'?'upscale':'layer',model:r.model});
    if(result.applied){r.assetId=result.asset.id;r.layerId=result.layerId;r.appliedAt=new Date().toISOString();save(r);}json(res,200,result);
   }finally{locks.delete(key);}return true;
  }
  check(false,'修图操作不存在',404);
 }
 return {handle,running:()=>locks.size>0};
}
