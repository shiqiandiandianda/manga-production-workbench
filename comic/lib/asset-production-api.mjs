import {referenceContentStamp} from './reference-content.mjs';
import {clone} from '../public/model.js';
import {check,validateProject} from './store.mjs';
import {assetProductionView,applyAssetProductionAction,prepareAssetGeneration,collectProductionAssetImageIds} from './asset-production.mjs';
import {referenceStamp} from './image-files.mjs';
import {projectLibraryAssetIds} from '../public/project-asset-library.js';

export const productionImageIds=collectProductionAssetImageIds;
export function createAssetProductionHandler({store,body,json,saveProject,enqueue,checkImage}){
 return async(req,res,{pathname,method})=>{
  const match=/^\/api\/projects\/([a-z]+_[0-9a-f-]{36})\/asset-production(?:\/(action|generate))?$/.exec(pathname);if(!match)return false;
  const result=p=>{const ids=new Set([...projectLibraryAssetIds(p),...productionImageIds(p)]);return {project:clone(p),productionAssets:assetProductionView(p,store.db.assets),revision:p.revision,libraryAssets:clone(store.db.assets.filter(asset=>ids.has(asset.id)))};};
  if(method==='GET'&&!match[2]){json(res,200,result(store.project(match[1])));return true;}
  check(method==='POST','资产生产入口不支持此方法',405);const input=await body(req),project=store.project(match[1]);check(input.revision===project.revision,'工程已有新修改，请重新载入资产资料',409);
  if(match[2]==='generate'){const request=prepareAssetGeneration(project,input,store.db.assets),job=enqueue(project,request,input);json(res,202,{...result(project),job});return true;}
  check(match[2]==='action','资产生产操作无效');if(input.imageAssetId)await checkImage?.(input.imageAssetId);
  let stamp=null;if(['bind-candidate','confirm'].includes(input.type)){const request=prepareAssetGeneration(project,{...input,provider:'codex'},store.db.assets);const candidate=request.stage.candidates.find(c=>c.assetId===input.imageAssetId);stamp=input.type==='bind-candidate'||candidate?.referenceStamp?.startsWith('sha256:')?referenceContentStamp(request.referencePaths):referenceStamp(request.referencePaths);if(input.type==='confirm'){check(!candidate?.referenceStamp||candidate.referenceStamp===stamp,'基础图或参考原文件已变化，请重新登记核验或生成',409);}}
  check(store.project(project.id)===project&&project.revision===input.revision,'工程已在读取图片期间修改，请重新载入后继续',409);
  const next=applyAssetProductionAction(project,input,store.db.assets);if(input.type==='bind-candidate'){const candidate=next.productionAssets.find(a=>a.id===input.assetId)?.stages.find(s=>s.id===input.stageId)?.candidates.find(c=>c.assetId===input.imageAssetId);if(candidate)candidate.referenceStamp=stamp;}validateProject(next);
  const views=assetProductionView(next,store.db.assets);
  for(const item of views)for(const stage of item.stages){if(stage.status!=='confirmed'||!stage.confirmedAssetId)continue;const image=store.db.assets.find(a=>a.id===stage.confirmedAssetId);if(!image)continue;
   const role={major:'character',simple:'character',crowd:'character',scene:'scene',prop:'prop',style:'style'}[item.workflow.kind];
   if(role&&/card|reference/.test(stage.id)){Object.assign(image,{productionStatus:'confirmed',productionAssetId:item.id,productionStageId:stage.id,libraryRole:role,libraryName:item.name,libraryAliases:item.aliases||[],libraryState:role==='character'?(stage.outfitDescription??item.workflow.outfitDescription)||stage.label:stage.label,libraryStateAliases:[stage.label]});}
  }
  store.db.projects[store.db.projects.indexOf(project)]=next;const saved=saveProject(next,{editor:true});json(res,200,result(saved));return true;
 };
}
