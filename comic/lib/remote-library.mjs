import {compatibleCanvas} from './canvas-image-compat.mjs';
import {isCollaborationFile} from '../public/collaboration-files.js';
import {expandMokuAssets,mokuCharacterMetadata} from '../public/moku-character-groups.js';
import {createMokuClassifiedReader} from './moku-classified-reader.mjs';
import {createMokuProjectLibrary} from './moku-project-library.mjs';
import {createMokuRecycle} from './moku-recycle.mjs';
import {createProjectMediaFiles} from './project-media-files.mjs';
import {AsyncLocalStorage} from 'node:async_hooks';
import fs from 'node:fs';import path from 'node:path';import {createHash,randomUUID} from 'node:crypto';
import {check,imageInfo} from './store.mjs';import {writeFileAtomicSync} from './durable-files.mjs';import {FONT_FAMILIES} from '../public/lettering.js';import {createRequire} from 'node:module';
const uuid=value=>typeof value==='string'&&/^[a-f0-9-]{36}$/i.test(value);
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const mediaExtension=mime=>({'image/png':'.png','image/jpeg':'.jpg','image/webp':'.webp','image/gif':'.gif','image/svg+xml':'.svg','image/avif':'.avif','font/ttf':'.ttf','font/otf':'.otf','font/collection':'.ttc','font/woff':'.woff','font/woff2':'.woff2','application/x-font-ttf':'.ttf','application/x-font-opentype':'.otf','application/vnd.ms-opentype':'.otf'})[String(mime||'').split(';')[0].trim().toLowerCase()]||'';
const supportedExtension=extension=>/^\.(ttf|otf|ttc|woff2?|png|jpe?g|webp|gif|svg|avif)$/.test(extension);
export function createRemoteLibrary({dataDir,configPath,baseUrl='http://127.0.0.1:8443',store,addAsset,body,json}){
 const local=path.join(dataDir,'library-session.local.json'),cache=path.join(dataDir,'library-cache');fs.mkdirSync(cache,{recursive:true});
 let session={};for(const file of [configPath,local])try{Object.assign(session,JSON.parse(fs.readFileSync(file)));}catch{}
 let sessionEpoch=0;const operation=new AsyncLocalStorage();
 const pin=fn=>operation.getStore()!==undefined?fn():operation.run(sessionEpoch,fn);
 const accountChanged=()=>Object.assign(Error('墨库账号已切换，原操作已暂停，请确认账号后重试'),{status:409,code:'SESSION_ACCOUNT_CHANGED'});
 const checkSession=()=>{if(operation.getStore()!==undefined&&operation.getStore()!==sessionEpoch)throw accountChanged();};
 const folderRequests=new Map();
 const defaults={projectId:typeof session.projectId==='string'?session.projectId:'',projectName:typeof session.projectName==='string'?session.projectName:''};
 const base=(session.base||session.baseUrl||baseUrl).replace(/\/$/,'');
 const accountFile=path.join(dataDir,'library-account.local.json');let account={},accountAt=0;try{account=JSON.parse(fs.readFileSync(accountFile));}catch{}
 function rememberAccount(user){account=Object.fromEntries(['id','username','displayName','name'].filter(k=>typeof user?.[k]==='string').map(k=>[k,user[k].slice(0,200)]));accountAt=Date.now();writeFileAtomicSync(accountFile,JSON.stringify(account));return account;}
 async function memberIdentity(){if(Date.now()-accountAt<30000)return account;try{const r=await remote('/api/auth/me',{signal:AbortSignal.timeout(2500)}),value=await r.json();return rememberAccount(value.user||value);}catch{accountAt=Date.now();return account;}}
 async function rawRemote(route,options={}){
  checkSession();const ticket=sessionEpoch;
  check(route.startsWith('/api/'),'素材库接口无效');const response=await fetch(base+route,{...options,redirect:'error',headers:{Cookie:session.cookie||'',Origin:base,Referer:base+'/',...(options.body?{'Content-Type':'application/json'}:{}),...options.headers},signal:options.signal||AbortSignal.timeout(60000)});
  if(ticket!==sessionEpoch)throw accountChanged();
  if(!response.ok){let error;try{error=await response.json();}catch{}throw Object.assign(Error(error?.error?.message||error?.error||'素材库请求失败（'+response.status+'）'),{status:response.status,code:error?.error?.code});}return response;
 }
 const classified=createMokuClassifiedReader({request:rawRemote,getAssets:()=>store.db.assets});
 const projectLibrary=createMokuProjectLibrary({dataDir,request:rawRemote,reader:classified,accountKey:async()=>{const me=await rawRemote('/api/auth/me').then(r=>r.json());return base+':'+(me.user?.id||me.id);},getProject:id=>store.db.projects?.find(p=>p.id===id),getAssets:()=>store.db.assets});
 async function remote(route,options={}){return pin(async()=>await projectLibrary.handle(route,options)||await classified.handle(route,options)||rawRemote(route,options));}
 const read=route=>pin(async()=>{const value=await(await remote(route)).json();checkSession();return value;});
 const recycle=createMokuRecycle({dataDir,baseUrl:base,request:rawRemote,read,assertSession:checkSession,invalidate:classified.invalidate});
 function registerFont(font){FONT_FAMILIES[font.key]='"'+font.family+'", sans-serif';try{compatibleCanvas(createRequire(import.meta.url)(process.env.COMIC_CANVAS_MODULE||process.env.COMIC_TEST_CANVAS_MODULE||'@napi-rs/canvas')).GlobalFonts.registerFromPath(font.filePath,font.family);}catch{}}
 for(const font of store.db.libraryFonts||[])registerFont(font);
 function fonts(){return (store.db.libraryFonts||[]).map(({filePath,...font})=>font);}
 async function registerSnapshotFont(file,resource){
  check(uuid(resource?.assetId)&&uuid(resource?.revisionId)&&/^[a-f0-9]{64}$/.test(resource?.sha256||''),'固定字体身份无效');
  const hash=createHash('sha256');for await(const chunk of fs.createReadStream(file))hash.update(chunk);check(hash.digest('hex')===resource.sha256,'字体原件完整性校验失败',422);
  const key='moku_'+resource.revisionId.replaceAll('-',''),family='Moku_'+resource.revisionId.replaceAll('-','');store.db.libraryFonts||=[];
  let font=store.db.libraryFonts.find(f=>f.key===key);if(font)check(font.provenance?.assetId===resource.assetId&&font.provenance?.sha256===resource.sha256,'字体版本身份冲突',409);
  else{font={key,name:resource.originalName||'墨库固定字体',family,revisionId:resource.revisionId,url:'/api/library/fonts/'+resource.revisionId,provenance:{baseUrl:base,projectId:null,scopeId:'global',assetKind:'file',assetType:'font',assetId:resource.assetId,revisionId:resource.revisionId,sha256:resource.sha256}};store.db.libraryFonts.push(font);}
  font.filePath=file;registerFont(font);store.save();return font;
 }
 async function ensureCollaborationFolder(projectId,folder){
  if(await classified.supported())return;
  if(!isCollaborationFile({folder})||!folder.startsWith('协作工程/'))return;
  const key=projectId+':'+folder;if(folderRequests.has(key))return folderRequests.get(key);
  const request=remote('/api/folders',{method:'POST',body:JSON.stringify({projectId,path:folder}),headers:{'Idempotency-Key':randomUUID()}}).then(r=>r.json()).catch(error=>{folderRequests.delete(key);throw error;});folderRequests.set(key,request);return request;
 }
 async function organizeCollaborationAsset(reference,folder){
  if(await classified.supported()){const detail=await read('/api/assets/'+reference.assetId);return {...reference,folder:detail.folder||'',assetKind:detail.assetKind,assetType:detail.assetType,scopeId:detail.scopeId,episodeId:detail.episodeId};}
  const detail=await read('/api/assets/'+reference.assetId);if(!isCollaborationFile(detail)||detail.folder==='协作工程'||detail.folder?.startsWith('协作工程/'))return {...reference,folder:detail.folder||''};
  await ensureCollaborationFolder(detail.projectId,folder);
  try{const saved=await remote('/api/assets/'+reference.assetId,{method:'PATCH',body:JSON.stringify({objectVersion:detail.objectVersion,folder}),headers:{'Idempotency-Key':randomUUID()}}).then(r=>r.json());return {...reference,folder:saved.folder||folder};}catch(error){if(Number(error.status)===409){const current=await read('/api/assets/'+reference.assetId);if(current.folder===folder||current.folder?.startsWith('协作工程/'))return {...reference,folder:current.folder};}throw error;}
 }
 // 分片上传：POST /uploads 建会话 → 逐片 PUT（X-Chunk-SHA256）→ complete → 轮询到 completed。
 async function uploadAsset(input){
  const typed=await projectLibrary.upload(input);if(typed)return typed;
  let {projectId,name,bytes,mime='application/octet-stream',folder='',category='reference'}=input;
  check(projectId===null||projectId===undefined||projectId===''||uuid(projectId),'墨库项目编号无效');check(Buffer.isBuffer(bytes)&&bytes.length,'上传内容为空');check(typeof name==='string'&&name.trim(),'上传名称不能为空');
  const extension=mediaExtension(mime);if(extension&&!supportedExtension(path.extname(name).toLowerCase()))name=name.slice(0,200-extension.length)+extension;
  await ensureCollaborationFolder(projectId,folder);
  const created=await remote('/api/uploads',{method:'POST',body:JSON.stringify({projectId,name:name.slice(0,200),size:bytes.length,mime,folder:folder||'',category}),headers:{'Idempotency-Key':randomUUID()}}).then(response=>response.json());
  check(uuid(created?.id)&&Number(created?.chunkSize)>0,'墨库没有返回有效上传会话');
  const size=Number(created.chunkSize),total=Math.ceil(bytes.length/size);
  for(let index=0;index<total;index++){
   const chunk=bytes.subarray(index*size,Math.min(bytes.length,(index+1)*size)),sha=createHash('sha256').update(chunk).digest('hex');
   for(let attempt=0;;attempt++)try{await remote('/api/uploads/'+created.id+'/chunks/'+index,{method:'PUT',body:chunk,headers:{'Content-Type':'application/octet-stream','X-Chunk-SHA256':sha}});break;}catch(error){if(attempt>=3||(Number(error.status)&&Number(error.status)<500))throw error;await new Promise(resolve=>setTimeout(resolve,500*2**attempt));}
  }
  await remote('/api/uploads/'+created.id+'/complete',{method:'POST',body:'{}',headers:{'Idempotency-Key':randomUUID()}});
  for(let attempt=0;attempt<180;attempt++){
   const state=await read('/api/uploads/'+created.id);
   if(state.state==='completed'){
    const asset=state.asset||null,assetId=asset?.id||state.assetId||state.result?.assetId||'';
    check(uuid(assetId),'墨库上传完成但没有返回素材编号');
    const detail=await read('/api/assets/'+assetId),revisionId=asset?.recommendedRevisionId||state.revisionId||detail.recommendedRevisionId||detail.revisions?.[0]?.id;
    return {assetId,revisionId,name:asset?.name||detail.name||name,folder:asset?.folder??detail.folder??folder,detail};
   }
   if(['failed','cancelled'].includes(state.state))throw new Error(state.error||'墨库上传失败');
   await new Promise(resolve=>setTimeout(resolve,1000));
  }
  throw new Error('墨库校验超时');
 }
 async function importAsset({assetId,revisionId}){
  check(uuid(assetId)&&uuid(revisionId),'请选择明确的素材版本');const detail=await read('/api/assets/'+assetId),revision=detail.revisions?.find(r=>r.id===revisionId)||(await classified.supported()?await read('/api/assets/'+assetId+'/revisions/'+revisionId):null);check(revision&&(!revision.assetId||revision.assetId===assetId),'此版本不属于选中的素材',409);check(!detail.deletedAt,'素材已删除',410);check(/^[a-f0-9]{64}$/.test(revision.sha256),'素材缺少完整性校验');
  let extension=path.extname(revision.originalName||detail.name).toLowerCase(),downloaded;
  if(!supportedExtension(extension))extension=mediaExtension(revision.mime)||mediaExtension(detail.mime);
  const download=async()=>{const res=await remote('/api/revisions/'+revisionId+'/download');check(Number(res.headers.get('content-length')||revision.size||0)<=256*1024*1024,'素材原件过大，请在墨库下载');const bytes=Buffer.from(await res.arrayBuffer());check(bytes.length<=256*1024*1024&&digest(bytes)===revision.sha256,'素材下载完整性校验失败',502);return bytes;};
  if(!extension){downloaded=await download();try{extension=imageInfo(downloaded).extension;}catch{check(false,'此资料请使用预览或下载；可直接添加图片、元素和字体：'+detail.name);}}
  const font=/\.(ttf|otf|ttc|woff2?)$/.test(extension),file=path.join(cache,revisionId+'_'+revision.sha256+extension);if(downloaded||!fs.existsSync(file)||digest(fs.readFileSync(file))!==revision.sha256)writeFileAtomicSync(file,downloaded||await download());
  const provenance={baseUrl:base,projectId:detail.projectId,assetId,revisionId,objectVersion:detail.objectVersion,sha256:revision.sha256,category:detail.category,folder:detail.folder||'',tags:detail.tags||[],...mokuCharacterMetadata(detail,assetId),...(detail.assetKind?{assetKind:detail.assetKind,assetType:detail.assetType,scopeId:detail.scopeId,objectId:detail.objectId}:{}),...(detail.episodeId?{episodeId:detail.episodeId}:{}),...(detail.scopeLabel?{scopeLabel:detail.scopeLabel}:{}),...(detail.canonicalAssetId?{canonicalAssetId:detail.canonicalAssetId}:{})};
  if(font){store.db.libraryFonts||=[];let record=store.db.libraryFonts.find(f=>f.revisionId===revisionId);if(!record){record={key:'moku_'+revisionId.replaceAll('-',''),name:detail.name,family:'Moku_'+revisionId.replaceAll('-',''),filePath:file,url:'/api/library/fonts/'+revisionId,revisionId,provenance};store.db.libraryFonts.push(record);store.save();}registerFont(record);return {kind:'font',font:Object.fromEntries(Object.entries(record).filter(([key])=>key!=='filePath'))};}
  let asset;try{asset=addAsset(file,detail.name,'moku');}catch(error){const canvasModule=compatibleCanvas(createRequire(import.meta.url)(process.env.COMIC_CANVAS_MODULE||process.env.COMIC_TEST_CANVAS_MODULE||'@napi-rs/canvas')),image=await canvasModule.loadImage(file);check(image.width*image.height<=40000000,'图片超过 4000 万像素，请下载原件后裁切');const canvas=canvasModule.createCanvas(image.width,image.height);canvas.getContext('2d').drawImage(image,0,0);const raster=path.join(cache,revisionId+'_'+revision.sha256+'.raster.png');writeFileAtomicSync(raster,canvas.toBuffer('image/png'));asset=addAsset(raster,detail.name,'moku');}
  // 名称属于素材当前元数据；固定版本、摘要和本地引用保持不变。
  const copies=new Set([asset,...store.db.assets.filter(candidate=>{const ref=candidate.library;return ref&&String(ref.baseUrl||'').replace(/\/$/,'')===base&&ref.assetId===assetId&&ref.revisionId===revisionId&&ref.sha256===revision.sha256;})]);
  for(const copy of copies){copy.name=String(detail.name||path.basename(file)).slice(0,180);copy.library={...copy.library,...provenance};}
  store.save();return {kind:'image',asset};
 }
 async function handle(req,res,{pathname,method,url}){
  if(!pathname.startsWith('/api/library'))return false;
  if(method==='GET'&&pathname==='/api/library/open'){res.writeHead(302,{Location:base+'/','Cache-Control':'no-store'});res.end();return true;}
  if(method==='GET'&&pathname==='/api/library/status'){try{const me=await read('/api/auth/me');rememberAccount(me.user||me);json(res,200,{connected:true,hasSession:!!session.cookie,baseUrl:base,user:me.user||me,fonts:fonts()});}catch(e){json(res,200,{connected:false,hasSession:!!session.cookie,baseUrl:base,error:e.message,fonts:fonts()});}return true;}
  if(method==='POST'&&pathname==='/api/library/login'){const input=await body(req);const r=await remote('/api/auth/login',{method:'POST',body:JSON.stringify({username:input.username,password:input.password}),headers:{'Idempotency-Key':randomUUID()}});const cookies=r.headers.getSetCookie();const cookie=cookies.map(c=>c.split(';')[0]).find(c=>c.startsWith('library_session='));check(cookie,'素材库没有返回有效会话');session={base,cookie};sessionEpoch++;classified.clear();projectLibrary.clear();account={};accountAt=0;writeFileAtomicSync(local,JSON.stringify(session));json(res,200,{ok:true});return true;}
  if(method==='POST'&&pathname==='/api/library/logout'){
   const cookie=session.cookie||'',cleared={base,cookie:''};
   // Persist first: an offline logout must not restore the old account on restart.
   writeFileAtomicSync(local,JSON.stringify(cleared));session=cleared;sessionEpoch++;classified.clear();projectLibrary.clear();account={};accountAt=0;
   try{writeFileAtomicSync(accountFile,JSON.stringify({}));}catch{}
   let remoteRevoked=!cookie;
   if(cookie)try{
    const response=await fetch(base+'/api/auth/logout',{method:'POST',redirect:'error',headers:{Cookie:cookie,Origin:base,Referer:base+'/','Content-Type':'application/json','Idempotency-Key':randomUUID()},body:'{}',signal:AbortSignal.timeout(8000)});
    remoteRevoked=response.ok||response.status===401;
   }catch{}
   json(res,200,{ok:true,remoteRevoked,...(!remoteRevoked?{warning:'本机已退出，墨库服务暂未确认会话注销。'}:{})});return true;
  }
  const tagMatch=pathname.match(/^\/api\/library\/assets\/([a-f0-9-]{36})\/tags$/i);
  if(method==='POST'&&tagMatch){const input=await body(req);const asset=await pin(()=>classified.appendTags(tagMatch[1],input.tags));json(res,200,{asset});return true;}
  if(method==='POST'&&pathname==='/api/library/recycle/preview'){const input=await body(req);json(res,200,await pin(()=>recycle.preview(input)));return true;}
  if(method==='POST'&&pathname==='/api/library/recycle/commit'){const input=await body(req);json(res,200,await pin(()=>recycle.commit(input)));return true;}
  if(method==='GET'&&pathname==='/api/library/recycle/pending'){json(res,200,await pin(()=>recycle.pending(url.searchParams.get('projectId'))));return true;}
  if(method==='POST'&&pathname==='/api/library/import'){const input=await body(req);json(res,201,await pin(()=>importAsset(input)));return true;}
  if(method==='GET'&&pathname==='/api/library/fonts'){json(res,200,{items:fonts()});return true;}
  const fontMatch=pathname.match(/^\/api\/library\/fonts\/([a-f0-9-]{36})$/i);if(method==='GET'&&fontMatch){const f=store.db.libraryFonts?.find(f=>f.revisionId===fontMatch[1]);check(f,'字体尚未取用',404);const bytes=fs.readFileSync(f.filePath);res.writeHead(200,{'Content-Type':path.extname(f.filePath)==='.otf'?'font/otf':'font/ttf','Cache-Control':'private, max-age=31536000, immutable'});res.end(bytes);return true;}
  if(method==='GET'&&pathname==='/api/library/assets'&&['bubble','font','sfx'].includes(url.searchParams.get('kind'))&&await classified.supported()){
   const params=new URLSearchParams(url.searchParams);params.set('projectId','public');params.set('assetType',({bubble:'bubble',font:'font',sfx:'sfx_text'})[params.get('kind')]);params.delete('kind');params.delete('categoryId');params.delete('category');
   json(res,200,await read('/api/assets?'+params));return true;
  }
  const route=pathname.slice('/api/library'.length);check(method==='GET'&&(/^\/(projects|assets|categories|asset-facets|character-groups)$/.test(route)||/^\/(character-groups\/[a-f0-9-]{36}|assets\/[a-f0-9-]{36}(?:\/revisions(?:\/[a-f0-9-]{36})?)?|projects\/[a-f0-9-]{36}\/(episodes|documents)|documents\/[a-f0-9-]{36}|revisions\/[a-f0-9-]{36}\/(download|references|preview\/[a-zA-Z0-9_.-]+))$/.test(route)),'素材库接口不存在',404);
  if(route==='/assets'&&url.searchParams.has('kind')){const kind=url.searchParams.get('kind'),params=new URLSearchParams(url.searchParams),offset=Math.max(0,Number(params.get('offset'))||0),limit=Math.max(1,Math.min(200,Number(params.get('limit'))||40)),items=[];const includeCollaboration=params.get('includeCollaboration')==='true';params.delete('includeCollaboration');params.delete('kind');params.set('limit','200');for(let begin=0;begin<10000;begin+=200){params.set('offset',String(begin));const page=await read('/api/assets?'+params);for(const item of expandMokuAssets(page.items)){ if(!includeCollaboration&&isCollaborationFile(item))continue;const font=/\.(otf|ttf|ttc|woff2?)$/i.test(item.name)||/font/.test(item.mime||''),image=/\.(png|jpe?g|webp|gif|svg|avif)$/i.test(item.name)||/^image\//.test(item.mime||''),text=[item.name,item.category,item.folder,...item.tags||[]].join(' ');if(kind==='font'&&font||kind==='image'&&image||kind==='document'&&!font&&!image||kind==='bubble'&&/气泡|对话框|对白|bubble|speech|thought|caption/i.test(text)||kind==='sfx'&&/拟声|音效|特效|氛围字|sfx|effect|sound/i.test(text))items.push(item);}if(page.items.length<200||items.length>offset+limit)break;}json(res,200,{items:items.slice(offset,offset+limit),offset,limit,more:items.length>offset+limit});return true;}
  const response=await remote('/api'+route+url.search),type=response.headers.get('content-type')||'application/octet-stream';res.writeHead(200,{'Content-Type':type,'Cache-Control':route.includes('/preview/')?'private, max-age=3600':'no-store'});res.end(Buffer.from(await response.arrayBuffer()));return true;
 }
 const api={handle,read,remote,memberIdentity,importAsset:input=>pin(()=>importAsset(input)),uploadAsset:input=>pin(()=>uploadAsset(input)),withSession:pin,assertSession:checkSession,sessionVersion:()=>sessionEpoch,rememberClassifiedAsset:classified.remember,projectUploadContext:projectLibrary.uploadContext,supportsClassified:classified.supported,organizeCollaborationAsset,ensureCollaborationFolder,registerSnapshotFont,fonts,baseUrl:base,defaultProjectId:defaults.projectId,defaultProjectName:defaults.projectName};
 const receiptsFile=path.join(dataDir,'moku-project-files.local.json');let receipts={};try{receipts=JSON.parse(fs.readFileSync(receiptsFile,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
 const projectFiles=createProjectMediaFiles({store,library:api,dataDir,receipts,persist:()=>writeFileAtomicSync(receiptsFile,JSON.stringify(receipts))});
 api.packProject=async(project,projectId)=>await classified.supported()?projectFiles.pack(project,projectId):null;return api;
}
