import fs from 'node:fs';import path from 'node:path';import {randomUUID} from 'node:crypto';
import {collectCode,digest} from './code-policy.mjs';import {validateEnvelope} from './updates.mjs';
import {localPrimaryChannel} from './primary-channel.mjs';
const fail=(ok,message,status=400)=>{if(!ok)throw Object.assign(Error(message),{status});};
export function publicationConnection(root){
 const channel=localPrimaryChannel(root,JSON.parse(fs.readFileSync(path.join(root,'distribution/channel.json')))),headers={'X-Team-Invitation':channel.enrollmentCode};
 const identity=path.join(root,'runtime-data/team/identity.local.json');
 const primaryFile=path.join(root,'runtime-data/distribution/master/master.local.json'),primary=fs.existsSync(primaryFile)&&JSON.parse(fs.readFileSync(primaryFile)).publicKey===channel.publicKey;
 if(!primary&&fs.existsSync(identity)){const value=JSON.parse(fs.readFileSync(identity));headers['X-Team-Machine']=encodeURIComponent(value.machineId);headers['X-Team-Registration']=value.registrationKey;}
 return {channel,headers};
}
export async function preparePublication(root,{request=fetch}={}){
 const {channel,headers}=publicationConnection(root);
 const response=await request(channel.masterUrl+'/api/releases/latest',{headers,signal:AbortSignal.timeout(7000)});fail(response.ok,'暂时无法读取团队最新版本',503);
 const envelope=await response.json(),latest=validateEnvelope(envelope,channel.publicKey),installedFile=path.join(root,'runtime-data/distribution/installed.local.json');
 fail(fs.existsSync(installedFile),'请先完成工具安装与团队接入',409);
 const installed=JSON.parse(fs.readFileSync(installedFile));
 fail(installed.contentId===latest.contentId,'团队已有新版本，请先保留本机改动并升级、合并后再发布',409);
 const files=collectCode(root),previous=new Map(latest.files.map(row=>[row.path,row.sha256]));
 const changes=[...files].filter(([name,bytes])=>digest(bytes)!==previous.get(name)).map(([name,bytes])=>({path:name,data:bytes.toString('base64'),bytes:bytes.length,action:previous.has(name)?'修改':'新增'}));
 const removed=latest.files.filter(row=>!files.has(row.path)).map(row=>row.path);
 return {baseContentId:latest.contentId,baseVersion:latest.version,changeId:digest(JSON.stringify({changes,removed})),changes,removed};
}
export async function publishLocalCode(root,{baseContentId,requestId=randomUUID(),note,changeId},{request=fetch}={}){
 fail(/^[\w-]{8,100}$/.test(requestId),'发布请求编号无效');
 const pendingFile=path.join(root,'runtime-data/distribution/publication-requests',requestId+'.local.json');
 let payload;
 if(fs.existsSync(pendingFile)){payload=JSON.parse(fs.readFileSync(pendingFile));fail(payload.baseContentId===baseContentId&&payload.note===note&&payload.changeId===changeId,'发布请求与原预览不一致，请重新预览',409);}
 else{
 const prepared=await preparePublication(root,{request});
 fail(prepared.baseContentId===baseContentId,'发布预览已过期，请重新检查改动',409);
 fail(prepared.changeId===changeId,'预览之后本机代码已变化，请重新预览',409);
 payload={...prepared,requestId,note};fs.mkdirSync(path.dirname(pendingFile),{recursive:true});fs.writeFileSync(pendingFile,JSON.stringify(payload));
 }
 const {channel,headers}=publicationConnection(root);
 const response=await request(channel.masterUrl+'/api/publication/submit',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(120000)});
 const result=await response.json();fail(response.ok,result.error||'发布失败',response.status);return result;
}
