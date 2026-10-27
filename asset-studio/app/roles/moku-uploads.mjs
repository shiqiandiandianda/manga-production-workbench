import fs from 'node:fs';
import path from 'node:path';
import {AsyncLocalStorage} from 'node:async_hooks';
import {createHash} from 'node:crypto';
import {createMokuProjectLibrary} from '../../../comic/lib/moku-project-library.mjs';
import {writeFileAtomicSync} from '../../../comic/lib/durable-files.mjs';

// Asset studio uses the same classified upload and durable receipt logic as
// the comic editor. A request stays bound to its original account and project.
export function createAssetStudioMokuUploader({dataDir,getConfig,fetcher=fetch}){
 fs.mkdirSync(dataDir,{recursive:true});
 const context=new AsyncLocalStorage();
 const receiptFile=path.join(dataDir,'asset-studio-upload-operations.local.json');let revisions={};
 try{revisions=JSON.parse(fs.readFileSync(receiptFile,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
 const hash=value=>createHash('sha256').update(value).digest('hex');
 const changed=()=>Object.assign(Error('墨库账号或项目已切换，原上传已暂停，请确认后重试'),{status:409,code:'SESSION_ACCOUNT_CHANGED'});
 function pinned(){
  const original=context.getStore(),current=getConfig();
  if(!original||!current||current.base!==original.base||current.cookie!==original.cookie||current.projectId!==original.projectId)throw changed();
  return original;
 }
 async function request(route,options={}){
  const config=pinned();
  const response=await fetcher(config.base+route,{...options,redirect:'error',headers:{Cookie:config.cookie,Origin:config.base,Referer:config.base+'/',...(options.body?{'Content-Type':'application/json'}:{}),...options.headers},signal:options.signal||AbortSignal.timeout(120000)});
  pinned();
  if(!response.ok){let body;try{body=await response.json();}catch{}throw Object.assign(Error(body?.error?.message||body?.error||'墨库请求失败（'+response.status+'）'),{status:response.status,code:body?.error?.code});}
  return response;
 }
 const reader={supported:async()=>true,remember:()=>{}};
 const classified=createMokuProjectLibrary({dataDir,request,reader,accountKey:async()=>{const response=await request('/api/auth/me'),me=await response.json();pinned();return context.getStore().base+':'+(me.user?.id||me.id);}});
 const formats=[{signature:Buffer.from('89504e470d0a1a0a','hex'),mime:'image/png',extension:'.png'},{signature:Buffer.from('ffd8ff','hex'),mime:'image/jpeg',extension:'.jpg'}];
 function imageFormat(bytes){
  const found=formats.find(f=>bytes.subarray(0,f.signature.length).equals(f.signature));
  if(found)return found;
  if(bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP')return {mime:'image/webp',extension:'.webp'};
  throw Error('请上传 PNG、JPEG 或 WebP 原图');
 }
 return async function upload(bytes,{type,name,objectName,variantName,assetId,scopeId='project',operationId}={}){
  const config=getConfig();
  if(!config?.cookie)throw Error('墨库未登录');
  if(!config.projectId)throw Error('未配置墨库项目');
  const uuid=value=>typeof value==='string'&&/^[a-f0-9-]{36}$/i.test(value);
  if(!uuid(config.projectId)||scopeId!=='project'&&!uuid(scopeId)||assetId&&!uuid(assetId))throw Error('墨库项目、话或资产编号无效');
  if(operationId!==undefined&&(typeof operationId!=='string'||!operationId.length||operationId.length>200||/[\x00-\x1f]/.test(operationId)))throw Error('上传操作编号无效');
  if(!['character','scene','prop'].includes(type))throw Error('请选择人物、场景或道具分类');
  if(!Buffer.isBuffer(bytes)||!bytes.length)throw Error('上传内容为空');
  const format=imageFormat(bytes),uploadName=String(name||'').trim();
  if(!uploadName)throw Error('请填写资产名称');
  const finalName=/\.(png|jpe?g|webp)$/i.test(uploadName)?uploadName.replace(/\.(png|jpe?g|webp)$/i,format.extension):uploadName+format.extension;
  return context.run({...config},async()=>{
   let existing={};
   if(assetId){
    let receiptKey,intent;
    if(operationId){
     const me=await request('/api/auth/me').then(r=>r.json());pinned();const owner=me.user?.id||me.id;if(!owner)throw Error('无法确认墨库账号');
     receiptKey=hash(JSON.stringify([config.base,owner,operationId]));
     intent=hash(JSON.stringify([config.projectId,scopeId,type,finalName,variantName||'',assetId,hash(bytes)]));
     if(revisions[receiptKey]){if(revisions[receiptKey].intent!==intent)throw Object.assign(Error('上传操作编号对应的分类或内容已变化，请新建操作'),{status:409});existing=revisions[receiptKey].existing;}
    }
    if(!existing.assetId){
     const route='/api/project-library/'+config.projectId+'/'+scopeId+'/image/'+type+'/assets/'+assetId;
     const detail=await request(route).then(r=>r.json());pinned();
     existing={assetId,objectVersion:detail.objectVersion,objectId:detail.objectId,characterIds:detail.characterIds||[],sceneIds:detail.sceneIds||[]};
     if(receiptKey){
      const prior=revisions[receiptKey];
      if(prior){if(prior.intent!==intent)throw Object.assign(Error('上传操作编号对应的分类或内容已变化，请新建操作'),{status:409});existing=prior.existing;}
      else{revisions[receiptKey]={intent,existing};writeFileAtomicSync(receiptFile,JSON.stringify(revisions));}
     }
    }
   }else{
    const subject=String(objectName||'').trim();
    if(!subject)throw Error('请明确所属人物、场景或道具名称');
    existing.objectName=subject;
   }
   const result=await classified.upload({projectId:config.projectId,scopeId,assetKind:'image',assetType:type,name:finalName,mime:format.mime,bytes,...existing,...(variantName?{variantName,variantKind:type==='character'?'outfit':'state'}:{}),...(operationId?{operationId}:{})});
   pinned();return result;
  });
 };
}
