import path from 'node:path';
import {createHash} from 'node:crypto';
import {check,imageInfo} from './store.mjs';
import {workspaceTarget} from './asset-workspace-api.mjs';
import {assetRequirementKey} from '../public/asset-workspace-model.js';
import {libraryProjectScopes} from '../public/library-project-scope.js';
import {unknownState} from '../public/character-states.js';

export const ASSET_UPLOAD_LIMIT=24*1024*1024;
const hash=value=>createHash('sha256').update(value).digest('hex');
export function workspaceUploadTags(need){
 const state=need.role==='character'&&unknownState(need.state)?'':need.state;
 return [...new Set([need.name,({character:'人物',scene:'场景',prop:'道具'})[need.role],state,'本地上传'].filter(Boolean).map(s=>String(s).normalize('NFKC').replace(/[\x00-\x1f\x7f]/g,' ').trim().slice(0,100)).filter(Boolean))];
}
export function createAssetWorkspaceUpload({store,library,body,json}){
 async function context(project,input){
  check(project.revision===input.expectedRevision,'工程已改变，请重新打开上传',409);
  const {need}=workspaceTarget(store,project,input);
  check(await library.supportsClassified(),'当前墨库不支持分类上传，请先升级墨库',409);
  const projects=(await library.read('/api/projects')).items?.filter(p=>!p.deletedAt).map(p=>({id:p.id,name:p.name}))||[];
  const scope=libraryProjectScopes(project,store.db.assets,projects),ids=scope.ids.filter(id=>projects.some(p=>p.id===id));
  const explicit=project.assetLibrary?.mokuProjectId||project.mokuProjectId;
  const priorIds=[...new Set(store.db.assets.filter(a=>a.assetWorkspaceUpload?.projectId===project.id).map(a=>a.library?.projectId).filter(id=>projects.some(p=>p.id===id)))];
  const projectId=explicit?(projects.some(p=>p.id===explicit)?explicit:''):ids.length===1?ids[0]:scope.source==='public'&&priorIds.length===1?priorIds[0]:'';
  return {need,projects,projectId,tags:workspaceUploadTags(need),sessionVersion:library.sessionVersion()};
 }
 return async(req,res,{pathname,method})=>{
  const match=/^\/api\/projects\/([a-z]+_[a-f0-9-]{36})\/asset-workspace\/(upload-context|upload)$/.exec(pathname);
  if(!match)return false;
  check(method==='POST','上传接口不存在',404);
  const input=await body(req,Math.ceil(ASSET_UPLOAD_LIMIT*4/3)+16384);
  await library.withSession(async()=>{
   if(match[2]==='upload')check(input.sessionVersion===library.sessionVersion(),'墨库账号已切换，请重新打开上传',409);
   const project=store.project(match[1]),info=await context(project,input);
   if(match[2]==='upload-context'){const {need,...result}=info;json(res,200,{...result,name:need.name,role:need.role});return;}
   check(info.projects.some(p=>p.id===input.mokuProjectId),'请选择当前账号可访问的墨库作品',400);
   check(typeof input.dataBase64==='string'&&input.dataBase64.length<=Math.ceil(ASSET_UPLOAD_LIMIT*4/3)&&input.dataBase64.length%4===0&&!/[^A-Za-z0-9+/=]/.test(input.dataBase64),'图片内容无效或超过24 MB',413);
   const bytes=Buffer.from(input.dataBase64,'base64');check(bytes.toString('base64')===input.dataBase64,'图片编码无效');check(bytes.length&&bytes.length<=ASSET_UPLOAD_LIMIT,'单张图片须小于24 MB',413);
   const {mime,extension}=imageInfo(bytes),need=info.need,key=assetRequirementKey(need);
   check(typeof input.fileName==='string'&&input.fileName.trim(),'文件名不能为空');
   const originalName=path.win32.basename(input.fileName).replace(/[\x00-\x1f\x7f]/g,'').slice(0,180);
   const name=(need.name+'_'+originalName.replace(/\.[^.]*$/,'')).slice(0,190)+extension;
   const intent={projectId:input.mokuProjectId,name,mime,assetKind:'image',assetType:need.role,scopeId:'project',objectName:need.name,variantName:need.role==='character'&&!unknownState(need.state)?need.state.slice(0,100):undefined,tags:info.tags};
   // Reuse the durable classified upload receipt when the same file is retried.
   const operationId='workspace-local:'+hash(JSON.stringify([project.id,key,intent,hash(bytes)]));
   library.assertSession();
   const uploaded=await library.uploadAsset({...intent,bytes,operationId});
   library.assertSession();
   let remote=await library.read('/api/assets/'+uploaded.assetId);
   if(!info.tags.every(tag=>remote.tags?.includes(tag)))remote=await library.appendTags(uploaded.assetId,info.tags);
   check(info.tags.every(tag=>remote.tags?.includes(tag)),'图片已入库，但标签尚未保存，请用原文件重试',502);
   const result=await library.importAsset({assetId:uploaded.assetId,revisionId:uploaded.revisionId});
   library.assertSession();
   check(result.asset?.library?.assetId===uploaded.assetId&&result.asset.library.revisionId===uploaded.revisionId&&result.asset.library.sha256===hash(bytes),'上传图片的固定版本校验失败',502);
   Object.assign(result.asset,{libraryRole:need.role,libraryName:need.name,libraryState:need.state||'',assetWorkspaceUpload:{projectId:project.id,requirementKey:key,originalName}});
   result.asset.library.tags=[...remote.tags];store.save();
   json(res,200,{asset:result.asset,tags:info.tags,mokuProjectId:input.mokuProjectId});
  });
  return true;
 };
}
