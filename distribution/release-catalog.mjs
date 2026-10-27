import {pruneUpdateArchives} from './update-cleanup.mjs';
import {sourceReleaseDetails} from './release-details.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {collectCode,allowedCodePath,digest} from './code-policy.mjs';
import {createRelease,decodeRelease,writeJson} from './updates.mjs';
const fail=(ok,message,status=400)=>{if(!ok)throw Object.assign(Error(message),{status});};
const rows=files=>[...files].map(([name,bytes])=>({path:name,sha256:digest(bytes),bytes:bytes.length}));
const protectedPaths=new Set(['distribution/channel.json','comic/public/team-release-channel.json','distribution/environments.json']);

export function createReleaseCatalog({root,releaseRoot,privateKey,publicKey,releaseNames,initial=null,checkSyntax=true,getSourceAuthor=async()=>({id:'publisher',name:'主版本电脑'}),onLatest=()=>{},onError=()=>{}}){
 const baselineFile=path.join(releaseRoot,'source-baseline.local.json'),receiptsFile=path.join(releaseRoot,'publication-receipts.local.json');
 let latest=initial,publishing=false,lastCandidate=null,stableCount=0;
 let baseline=fs.existsSync(baselineFile)?JSON.parse(fs.readFileSync(baselineFile)).files:latest?.manifest.files||[];
 const receipts=fs.existsSync(receiptsFile)?JSON.parse(fs.readFileSync(receiptsFile)):[];
 const canonical=()=>latest?decodeRelease(fs.readFileSync(path.join(releaseRoot,latest.manifest.contentId+'.json.gz')),publicKey).files:new Map();
 function syntax(files){
  if(!checkSyntax)return;
  const previous=new Map((latest?.manifest.files||[]).map(row=>[row.path,row.sha256]));
  for(const [name,bytes]of files){
   if(!/\.[mc]?js$/.test(name)||previous.get(name)===digest(bytes))continue;
   let result=spawnSync(process.execPath,['--input-type=module','--check'],{input:bytes,encoding:'utf8',windowsHide:true});
   if(result.status!==0)result=spawnSync(process.execPath,['--input-type=commonjs','--check'],{input:bytes,encoding:'utf8',windowsHide:true});
   fail(result.status===0,'语法检查失败，保留上一版：'+name+' '+String(result.stderr).slice(0,200),422);
  }
 }
 function commit(files,{author,note,changeSummary}={}){
  fail(files.size>0&&files.size<=10000,'发布代码文件数量无效');
  let total=0;for(const [name,bytes]of files){total+=bytes.length;fail(allowedCodePath(name)&&bytes.length<=32*1024*1024&&total<=64*1024*1024,'发布代码路径或总体大小无效',413);}
  syntax(files);
  const now=new Date().toISOString(),release=createRelease(files,privateKey,{previous:{...latest?.manifest,version:releaseNames.previous(now)},now,author,note,changeSummary,previousReleases:latest?[latest.manifest,...(latest.manifest.previousReleases||[])].slice(0,100).map(m=>({version:m.version,contentId:m.contentId,createdAt:m.createdAt,author:m.author,releaseNotes:m.releaseNotes})):[]});
  fail(release.archive.length<=64*1024*1024,'发布包超过升级器容量限制',413);
  if(latest?.manifest.contentId===release.manifest.contentId)return latest;
  fs.writeFileSync(path.join(releaseRoot,release.manifest.contentId+'.json.gz'),release.archive);
  latest={manifest:release.manifest,signature:release.signature};
  writeJson(path.join(releaseRoot,'latest.json'),latest);releaseNames.remember(release.manifest);onLatest(latest);onError(null);try{pruneUpdateArchives(root,path.relative(root,releaseRoot).split(path.sep).join('/'),{protect:[latest.manifest.contentId]});}catch{}return latest;
 }
 function setBaseline(files){baseline=rows(files);writeJson(baselineFile,{files:baseline});}
 async function publishSource({force=false}={}){
  if(publishing)return latest;publishing=true;
  try{
   const source=collectCode(root),fingerprint=digest(JSON.stringify(rows(source)));
   if(!force&&fingerprint!==lastCandidate){lastCandidate=fingerprint;stableCount=0;return latest;}
   if(!force&&++stableCount<2)return latest;
   if(!latest){const result=commit(source,{author:await getSourceAuthor(),...sourceReleaseDetails(source)});setBaseline(source);return result;}
   const old=new Map(baseline.map(row=>[row.path,row.sha256])),files=canonical();let changed=false;
   for(const name of new Set([...old.keys(),...source.keys()])){
    const bytes=source.get(name),hash=bytes&&digest(bytes);if(hash===old.get(name))continue;
    const current=files.get(name),currentHash=current&&digest(current);
    fail(currentHash===old.get(name)||currentHash===hash,'主版本本机修改与同事已发布代码冲突：'+name+'。请先合并，未覆盖团队版本。',409);
    changed=true;if(bytes)files.set(name,bytes);else files.delete(name);
   }
   if(!changed)return latest;
   const result=commit(files,{author:await getSourceAuthor(),...sourceReleaseDetails(files,latest.manifest.files)});setBaseline(source);return result;
  }catch(error){onError(error.message);throw error;}finally{publishing=false;}
 }
 async function submit(input,author,stillAllowed=()=>true){
  fail(!publishing,'其他版本正在发布，请稍后重试',409);publishing=true;
  try{
   fail(typeof input.requestId==='string'&&/^[\w-]{8,100}$/.test(input.requestId),'发布请求编号无效');
   const requestHash=digest(JSON.stringify(input)),prior=receipts.find(row=>row.actor===author.id&&row.requestId===input.requestId);
   if(prior){fail(prior.requestHash===requestHash,'请求编号已用于其他代码',409);return {...prior.result,reused:true};}
   fail(latest&&input.baseContentId===latest.manifest.contentId,'团队已有新版本，请先同步最新版本并保留、合并本机修改后再发布',409);
   fail(Array.isArray(input.changes)&&Array.isArray(input.removed)&&input.changes.length+input.removed.length<=10000,'发布内容无效');
   fail(typeof input.note==='string'&&input.note.trim()&&input.note.length<=1000,'请填写本次更新说明');
   const files=canonical(),seen=new Set();let total=0;
   for(const row of input.changes){
    fail(allowedCodePath(row?.path)&&!protectedPaths.has(row.path)&&!seen.has(row.path),'非代码、重复或受保护的文件：'+row?.path);seen.add(row.path);
    fail(typeof row.data==='string'&&row.data.length<=44*1024*1024&&/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(row.data),'文件编码或长度无效');
    const bytes=Buffer.from(row.data,'base64');total+=bytes.length;fail(bytes.length<=32*1024*1024&&total<=48*1024*1024,'发布代码过大',413);files.set(row.path,bytes);
   }
   for(const name of input.removed){fail(allowedCodePath(name)&&!protectedPaths.has(name)&&!seen.has(name)&&files.has(name),'删除文件无效或受保护：'+name);seen.add(name);files.delete(name);}
   fail(seen.size>0,'没有可发布的代码改动',409);
   const previous=latest;syntax(files);fail(stillAllowed(),'发布权限已被撤销',403);
   const release=commit(files,{author,note:input.note.trim(),changeSummary:sourceReleaseDetails(files,previous.manifest.files).changeSummary});fail(release.manifest.contentId!==previous.manifest.contentId,'没有可发布的代码改动',409);
   const result={ok:true,version:release.manifest.version,contentId:release.manifest.contentId,author:release.manifest.author,note:release.manifest.releaseNotes};
   receipts.push({actor:author.id,requestId:input.requestId,requestHash,result});writeJson(receiptsFile,receipts.slice(-1000));return result;
  }finally{publishing=false;}
 }
 return {publishSource,submit,get busy(){return publishing;},get latest(){return latest;}};
}
