import {clone} from '../public/model.js';
import {check,validateProject} from './store.mjs';
import {prepareBreakout,confirmBreakout} from './breakout-production.mjs';
import {inspectTransparentForegroundFile} from './codex.mjs';
import {referenceStamp} from './image-files.mjs';
export function createBreakoutHandler({store,body,json,saveProject,enqueue,python}){
 return async(req,res,{pathname,method})=>{
  const match=/^\/api\/projects\/([a-z]+_[0-9a-f-]{36})\/panels\/([a-z]+_[0-9a-f-]{36})\/breakout\/(generate|confirm)$/.exec(pathname);if(!match)return false;
  check(method==='POST','破框操作不支持此方法',405);const input=await body(req),old=store.project(match[1]);check(input.revision===old.revision,'工程已有新修改，请重新载入后继续',409);
  if(match[3]==='generate'){const request=prepareBreakout(old,match[2],store.db.assets,{revision:input.revision,provider:input.provider||'codex'});json(res,202,{job:enqueue(old,request),project:clone(old)});return true;}
  const sourcePanel=old.pages.flatMap(p=>p.panels).find(p=>p.id===match[2]),candidate=sourcePanel?.breakoutCandidates?.find(c=>c.assetId===input.assetId);check(candidate&&candidate.status!=='stale','破框候选来源已变化，请重新生成',409);
  check(candidate.referenceStamp&&candidate.referenceStamp===referenceStamp(candidate.referenceAssetIds.map(id=>store.assetPath(id))),'背景或参考原文件已变化，请按当前画面重新生成',409);
  const image=store.asset(input.assetId),proof=await inspectTransparentForegroundFile(store.assetPath(image.id),python);image.transparency=proof;
  // Decoding may take time; do not commit over another editor's newer revision.
  check(store.project(old.id)===old&&old.revision===input.revision,'工程已在验收图片期间修改，请重新载入后确认',409);
  check(candidate.referenceStamp===referenceStamp(candidate.referenceAssetIds.map(id=>store.assetPath(id))),'验收期间参考原文件已变化，请重新生成',409);
  const result=confirmBreakout(clone(old),match[2],input.assetId,store.db.assets);validateProject(result.project);if(!result.reused){store.db.projects[store.db.projects.indexOf(old)]=result.project;saveProject(result.project,{editor:true});}else store.save();json(res,200,{project:clone(result.project),foregroundId:result.foreground.id});return true;
 };
}
