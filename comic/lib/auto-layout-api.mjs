import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {buildLayoutProject} from '../public/auto-layout-adapter.mjs';
import {createLayoutPlanning} from './layout-planning.mjs';
import {createScreenReflow} from './screen-reflow.mjs';

export function createAutoLayoutAPI({store,dataDir,body,json,validateProject,checkAssets,addAsset}){
 const origin=process.env.AUTO_LAYOUT_ORIGIN||'http://127.0.0.1:19848',receipts=path.join(dataDir,'auto-layout-receipts.json');let importing=false;
 const request=async(route,input)=>{const r=await fetch(origin+route,{signal:AbortSignal.timeout(15000),...(input?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)}:{})});const v=await r.json();if(!r.ok)throw Error(v.error||'自动排版服务请求失败');return v;};
 const reflow=createScreenReflow({store,dataDir,body,json,request,addAsset,validateProject,checkAssets});
 const planning=createLayoutPlanning({store,dataDir,body,json,request,validateProject,checkAssets});
 return {async handle(req,res,{pathname,method}){
  if(pathname==='/api/auto-layout/learning-scope'){
   if(method==='GET'){const state=await request('/api/state');json(res,200,{projects:state.projects.filter(p=>p.id!=='studio-original-rules'),references:state.references});return true;}
   if(method==='POST'){const input=await body(req);if(input.projectId==='studio-original-rules')throw Object.assign(Error('内置固定规则不参与参考学习，请选择自己的作品项目'),{status:400});json(res,200,await request('/api/library/select',{projectId:input.projectId,referenceIds:input.referenceIds}));return true;}
  }
  if(await planning.handle(req,res,{pathname,method}))return true;
  if(await reflow.handle(req,res,{pathname,method}))return true;
  if(method==='GET'&&pathname==='/api/auto-layout/status'){try{const health=await request('/api/integration/status');json(res,200,{ready:true,origin,...health});}catch(e){json(res,200,{ready:false,origin,error:e.message});}return true;}
  if(method!=='POST'||pathname!=='/api/auto-layout/import')return false;
  if(importing){json(res,409,{error:'正在接回工程，请稍候'});return true;}importing=true;
  try{
   const {scriptId,expectedScript,expectedPacket}=await body(req);if(typeof scriptId!=='string'||!/^[-\w]{1,90}$/.test(scriptId))throw Error('分镜ID无效');
   const script=await request('/api/scripts/'+scriptId),draft=await request('/api/drafts/'+scriptId);if(expectedScript&&JSON.stringify(script)!==JSON.stringify(expectedScript)||expectedPacket&&JSON.stringify(draft)!==JSON.stringify(expectedPacket))throw Object.assign(Error('分镜或排版结果已有更新，请重新打开后再接回'),{status:409});const {packet}=await request('/api/export',{id:scriptId,packet:draft});
   if(script.studioSource?.planningBatchId){const project=await planning.importResult(script,packet);json(res,201,project);return true;}
   if(script.studioSource?.reflowBatchId){const project=await reflow.importResult(script,packet);json(res,201,project);return true;}
   let originalProject=null;
   if(script.studioSource){originalProject=store.project(script.studioSource.projectId);if(originalProject.productionPackage)throw Error('不能将屏段工程作为逐格工程重新排版');if(originalProject.revision!==script.studioSource.revision)throw Error('原工程已有新版本，请重新送入分镜后排版');}
   const digest=createHash('sha256').update(JSON.stringify({script,packet})).digest('hex');let saved={};if(fs.existsSync(receipts))saved=JSON.parse(fs.readFileSync(receipts,'utf8'));
   const existing=store.db.projects.find(p=>p.id===saved[digest]&&!p.deletedAt);if(existing){json(res,200,existing);return true;}
   const project=buildLayoutProject(script,packet,{originalProject});validateProject(project);checkAssets(project);store.db.projects.push(project);store.save();
   saved[digest]=project.id;fs.writeFileSync(receipts+'.tmp',JSON.stringify(saved));fs.renameSync(receipts+'.tmp',receipts);json(res,201,project);return true;
  }finally{importing=false;}
 }};
}
