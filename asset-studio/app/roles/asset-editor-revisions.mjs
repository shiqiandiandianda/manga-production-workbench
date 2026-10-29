import {createHash} from 'node:crypto';
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const revisionConflict=error=>error?.status===409&&/^(工程已有新修改，请重新载入资产资料|工程已改变，请刷新资产状态后重试)$/.test(error.message||'');

/** Serialize this studio's writes to its shared internal project. Rebase only a
 * definite pre-dispatch 409 while the target asset and shared style are unchanged.
 * Network failures and unknown submissions are never retried here. */
export function createAssetEditorRevisionClient(editorJson){
 const histories=new Map(),queues=new Map();
 const context=p=>digest([p.id,p.style||'',p.layerSchema||null,!!p.deletedAt]);
 const fingerprint=(p,id)=>{const asset=p.productionAssets?.find(a=>a.id===id);return asset?digest(asset):null;};
 function remember(value){const p=value?.project||value;if(!p?.id||!Number.isInteger(p.revision))return;let history=histories.get(p.id);if(!history){history=new Map();histories.set(p.id,history);}history.set(p.revision,{context:context(p),assets:new Map((p.productionAssets||[]).map(a=>[a.id,digest(a)]))});while(history.size>128)history.delete(history.keys().next().value);}
 async function exclusive(projectId,operation){const prior=queues.get(projectId)||Promise.resolve();let unlock;const gate=new Promise(resolve=>unlock=resolve),tail=prior.catch(()=>{}).then(()=>gate);queues.set(projectId,tail);await prior.catch(()=>{});try{return await operation();}finally{unlock();if(queues.get(projectId)===tail)queues.delete(projectId);}}
 return async(route,input)=>{
  const pathname=String(route).split('?')[0],write=/^\/api\/projects\/([^/]+)\/asset-production\/(action|generate)$/.exec(pathname),method=(input?.method||'GET').toUpperCase();
  if(!write||method!=='POST'||!Number.isInteger(input?.body?.revision)||typeof input.body.assetId!=='string'){const result=await editorJson(route,input);if(method==='GET'&&/^\/api\/projects\/[^/]+(?:\/asset-production)?$/.test(pathname))remember(result);return result;}
  const projectId=write[1],assetId=input.body.assetId,baseline=histories.get(projectId)?.get(input.body.revision),expected=baseline?.assets.get(assetId)??null;
  return exclusive(projectId,async()=>{let body={...input.body};for(let attempt=0;;attempt++){
   try{const result=await editorJson(route,{...input,body});remember(result);return result;}catch(error){
    if(!revisionConflict(error)||!baseline||attempt>=3)throw error;
    const latest=await editorJson('/api/projects/'+projectId);remember(latest);
    if(context(latest)!==baseline.context||fingerprint(latest,assetId)!==expected)throw Object.assign(Error('当前人物资产内容已有修改，请重新载入后再操作'),{status:409,code:'asset_content_changed'});
    body={...body,revision:latest.revision};
   }
  }});
 };
}
