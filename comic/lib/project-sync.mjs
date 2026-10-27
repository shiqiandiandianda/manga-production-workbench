import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {check} from './store.mjs';
import {writeFileAtomicSync} from './durable-files.mjs';
import {encodeProjectSnapshot,decodeProjectSnapshot} from './project-snapshot-codec.mjs';

/**
 * 工程快照自动上传墨库。
 *
 * 墨库把工程正文保存在"业务文档"里：`documents` 持 name/type 与不可变 revision，
 * revision 保存 schemaVersion、content（JSON）和固定版本引用 references（revisionId 列表）。
 * 本地每次保存工程后按内容摘要去重，串行推送；失败只记录状态，绝不阻断本机保存。
 */
const DOCUMENT_TYPE='engineering.snapshot';
const CONTENT_FORMAT='comic-strip-project-snapshot';
const CONTENT_VERSION=1;
// 撤销步骤、导入中间数据和已迁移的工作流只服务当前窗口，不是可恢复的工程正文；
// 带上它们会让单次快照从几百 KB 放大到数 MB（本机实测 4.7MB 工程里有 4.0MB 是 layoutHistory）。
const LOCAL_ONLY_FIELDS=['layoutHistory','layoutImports','designHistory','storyboardWorkflow','novelProductionWorkflow','productionAssets'];
const ASSET_ID=/^asset_[0-9a-f-]{36}$/i;
const MAX_REFERENCES=2000;
const RETRY_DELAYS=[30*1000,2*60*1000,5*60*1000];
const sha256=text=>createHash('sha256').update(text).digest('hex');
const text=value=>String(value??'').trim();
const normalize=value=>text(value).toLowerCase().replace(/[\s·，,。.、_\-—:：()（）[\]【】"'“”"']/g,'');

function collectAssetIds(value,into=new Set(),depth=0){
  if(depth>16)return into;
  if(typeof value==='string'){if(ASSET_ID.test(value))into.add(value);return into;}
  if(Array.isArray(value)){for(const item of value)collectAssetIds(item,into,depth+1);return into;}
  if(value&&typeof value==='object')for(const item of Object.values(value))collectAssetIds(item,into,depth+1);
  return into;
}

function friendly(error){
  const status=Number(error?.status)||0;
  if(status===401||status===403)return '墨库会话已失效，请在“参考图 · 墨库素材”里重新登录';
  if(status===404)return '墨库接口或文档不存在（'+text(error.message)+'）';
  if(status===409)return '墨库文档版本冲突，稍后自动重试';
  if(status===413)return '工程快照超出墨库单次请求大小限制';
  const message=text(error?.message)||'墨库同步失败';
  if(!status&&/fetch failed|network|ECONN|ETIMEDOUT|timeout/i.test(message))return '无法连接墨库（'+message+'）';
  return message;
}

export function createProjectSync({
  dataDir,store,library,projectView,json,body,isFormallyManaged=()=>false,
  enabled=process.env.COMIC_PROJECT_SYNC!=='0',
  debounceMs=Math.max(1000,Number(process.env.COMIC_PROJECT_SYNC_DELAY)||8000),
}={}){
  check(typeof dataDir==='string'&&dataDir,'工程快照同步缺少数据目录');
  check(store&&library&&typeof projectView==='function','工程快照同步缺少依赖');
  const file=path.join(dataDir,'project-sync.local.json');
  let saved={};try{saved=JSON.parse(fs.readFileSync(file,'utf8'));}catch{}
  const state={version:1,auto:saved.auto!==false,projects:saved.projects&&typeof saved.projects==='object'&&!Array.isArray(saved.projects)?saved.projects:{}};
  let closed=false,timer=null,draining=false,running=false,chain=Promise.resolve(),lastError='';

  function persist(){try{writeFileAtomicSync(file,JSON.stringify(state));}catch(error){lastError='同步状态无法写盘：'+error.message;}}

  const serialize=task=>{const run=chain.then(task,task);chain=run.then(()=>{},()=>{});return run;};

  function manifest(view){
    const byId=new Map(store.db.assets.map(asset=>[asset.id,asset])),assets=[];
    for(const id of collectAssetIds(view)){
      const asset=byId.get(id);if(!asset)continue;
      const library_=asset.library&&asset.library.revisionId?{
        assetId:asset.library.assetId,
        revisionId:asset.library.revisionId,
        ...(asset.library.projectId?{projectId:asset.library.projectId}:{}),
        ...(asset.library.category?{category:asset.library.category}:{}),
      }:null;
      assets.push({id,name:text(asset.name),width:asset.width||null,height:asset.height||null,mime:asset.mime||'',source:asset.source||'',...(library_?{library:library_}:{})});
    }
    return assets.sort((a,b)=>a.id.localeCompare(b.id));
  }

  function snapshot(project){
    const view=projectView(project);
    for(const key of LOCAL_ONLY_FIELDS)delete view[key];
    const assets=manifest(view);
    const references=[...new Set(assets.map(asset=>asset.library?.revisionId).filter(Boolean))].slice(0,MAX_REFERENCES);
    return {view,assets,references};
  }

  async function listRemoteProjects(){
    const result=await library.read('/api/projects');
    const items=Array.isArray(result)?result:(Array.isArray(result?.items)?result.items:[]);
    return items.filter(item=>/^[a-f0-9-]{36}$/i.test(String(item?.id||''))).map(item=>({id:item.id,name:text(item.name)}));
  }

  function score(name,title){
    const remote=normalize(name),local=normalize(title);
    if(!remote||!local)return 0;
    if(remote===local)return 1000+remote.length;
    if(local.includes(remote))return 500+remote.length;
    if(remote.includes(local))return 400+local.length;
    return 0;
  }

  // 目标墨库项目：显式绑定 > 工程名匹配 > 会话里配置的默认项目。匹配有歧义时不猜。
  async function resolveTarget(project,item){
    if(item.remoteProjectId)return {projectId:item.remoteProjectId,name:item.remoteProjectName||''};
    let projects;
    try{projects=await listRemoteProjects();}catch(error){throw Object.assign(error,{message:'读取墨库项目失败：'+friendly(error)});}
    const explicit=text(project?.assetLibrary?.mokuProjectId||project?.mokuProjectId);
    if(explicit){
      const found=projects.find(candidate=>candidate.id===explicit);
      return {projectId:explicit,name:found?.name||''};
    }
    const ranked=projects.map(candidate=>({...candidate,score:score(candidate.name,project.title)})).filter(candidate=>candidate.score>0).sort((a,b)=>b.score-a.score);
    if(ranked.length&&(!ranked[1]||ranked[1].score<ranked[0].score))return {projectId:ranked[0].id,name:ranked[0].name};
    const fallback=text(library.defaultProjectId);
    if(fallback){
      const found=projects.find(candidate=>candidate.id===fallback);
      if(found)return {projectId:fallback,name:found.name};
    }
    if(projects.length===1)return {projectId:projects[0].id,name:projects[0].name};
    if(ranked.length>1)check(false,'墨库里有多个可能对应当前工程的项目，请把墨库项目改成唯一同名，或在同步设置里指定项目');
    check(false,'墨库没有可匹配的工程：请先在墨库建立同名项目，或在同步设置里指定墨库项目');
  }

  function idempotency(item,digest){
    if(item.idempotency&&item.idempotencyDigest===digest)return item.idempotency;
    item.pendingKeys||={};item.idempotency=item.pendingKeys[digest]||randomUUID();item.pendingKeys[digest]=item.idempotency;item.idempotencyDigest=digest;return item.idempotency;
  }

  async function sendWrite(item,digest,route,payload){
    const run=next=>{const raw=JSON.stringify(next),key=sha256(JSON.stringify([digest,route,payload.method,raw]));return library.remote(route,{method:payload.method,body:raw,headers:{'Idempotency-Key':idempotency(item,key)}}).then(response=>response.json().catch(()=>({})));};
    const input={...payload.input};
    try{return await run(input);}
    catch(error){
      if([400,422].includes(Number(error?.status))&&input.references?.length){
        item.warning='墨库未接受固定版本引用，本次快照按无引用保存';
        delete item.idempotency;delete item.idempotencyDigest;
        return await run({...input,references:[]});
      }
      throw error;
    }
  }

  async function createDocument(target,input,item,digest){
    return sendWrite(item,digest,'/api/documents',{method:'POST',input:{...input,projectId:target.projectId,type:DOCUMENT_TYPE}});
  }

  async function updateDocument(input,item,digest){
    const attempt=()=>sendWrite(item,digest,'/api/documents/'+encodeURIComponent(item.documentId),{method:'PUT',input:{...input,objectVersion:item.objectVersion??null}});
    try{return await attempt();}
    catch(error){
      if(Number(error?.status)!==409)throw error;
      const current=await library.read('/api/documents/'+encodeURIComponent(item.documentId));
      check(Number.isInteger(current?.objectVersion),'墨库文档缺少版本号，无法覆盖');
      const remoteContent=current.content??current.revision?.content;
      check(remoteContent?.stableHash===item.hash,'墨库已有其他人的工程修改，已停止覆盖；请从工程协作取回并合并',409);
      item.objectVersion=current.objectVersion;
      return await attempt();
    }
  }

  const generation=projectId=>{const jobs=(store.db.jobs||[]).filter(j=>j.projectId===projectId&&['queued','preparing','running','recoverable','delegated','awaiting_confirmation'].includes(j.status));return {active:jobs.length>0,count:jobs.length};};
  async function pushProject(projectId,{force=false}={}){
    check(typeof projectId==='string'&&/^[a-z]+_[0-9a-f-]{36}$/.test(projectId),'工程编号无效');
    const project=store.project(projectId);
    check(!project.deletedAt,'工程已删除，停止上传快照');
    if(!enabled)throw Object.assign(new Error('工程快照同步已停用'),{status:503});
    const item=state.projects[projectId]||(state.projects[projectId]={});
    if(isFormallyManaged(projectId)||Object.keys(project.formalVersionBindings||{}).length){item.pending=false;item.lastError='';persist();return {status:'formal-only',projectId,message:'本机自动保存不发布正式版本，请使用本话版本提交'};}
    if(generation(projectId).active){item.pending=true;item.nextAttemptAt=Date.now()+2000;persist();scheduleWake();return {status:'generating',state:status(projectId)};}
    if(!item.documentId&&await library.supportsClassified?.())throw Object.assign(new Error('请先共享工程并明确选择墨库项目、角色或场景；本机工程已保存'),{status:409,code:'project_classification_required'});
    const {view,assets,references}=snapshot(project);
    // revision/updated 每次保存都会刷新（即使内容完全相同）；只用正文摘要判断是否真的变了。
    const digest=sha256(JSON.stringify({project:{...view,revision:null,updated:null},assets}));
    if(!force&&item.hash===digest&&item.documentId)return {status:'unchanged',projectId,documentId:item.documentId,revision:view.revision,syncedAt:item.syncedAt||null};
    const target=await resolveTarget(project,item);
    const name=(text(view.title)||'未命名工程')+' · 工程快照';
    if(item.pendingHash!==digest){item.pendingHash=digest;item.pendingExportedAt=new Date().toISOString();delete item.pendingUpload;delete item.pendingKeys;}
    const content={
      format:CONTENT_FORMAT,version:CONTENT_VERSION,
      projectId:view.id,title:view.title,revision:view.revision,updated:view.updated||null,
      exportedAt:item.pendingExportedAt,stableHash:digest,
      project:view,assets,
    };
    const complete=await library.packProject?.(view,target.projectId);if(complete)Object.assign(content,{assets:complete.assets,fonts:complete.fonts,originals:complete.originals});
    item.pending=true;persist();
    const pack=async forceAsset=>{const result=await encodeProjectSnapshot(content,library,{projectId:target.projectId,forceAsset,uploadedAsset:item.pendingUpload,inlineOnly:await library.supportsClassified?.()});if(result.uploadedAsset){item.pendingUpload=result.uploadedAsset;persist();}return result;};
    let packed=await pack(false);
    let input={name:name.slice(0,180),schemaVersion:packed.schemaVersion,content:packed.content,references:[...new Set([...packed.references,...references])].slice(0,MAX_REFERENCES)};
    let document;
    const write=async()=>{
    if(item.documentId){
      try{document=await updateDocument(input,item,digest);}
      catch(error){
        if(Number(error?.status)!==404)throw error;
        delete item.documentId;delete item.objectVersion;
        document=await createDocument(target,input,item,digest);
      }
    }else document=await createDocument(target,input,item,digest);
    };
    try{await write();}catch(error){
      if(Number(error?.status)!==413)throw error;
      packed=await pack(true);
      input={...input,schemaVersion:packed.schemaVersion,content:packed.content,references:[...new Set([...packed.references,...references])].slice(0,MAX_REFERENCES)};
      await write();
    }
    item.documentId=text(document?.id||document?.documentId)||item.documentId;
    check(item.documentId,'墨库没有返回工程快照文档编号，本次上传未计入已同步');
    item.objectVersion=Number.isInteger(document?.objectVersion)?document.objectVersion:(item.objectVersion??null);
    item.remoteProjectId=target.projectId;
    item.remoteProjectName=target.name||item.remoteProjectName||'';
    item.hash=digest;item.revision=view.revision;item.syncedAt=new Date().toISOString();
    item.transport=packed.content.payload?.storage||'json';item.requestBytes=Buffer.byteLength(JSON.stringify(input));
    delete item.setupRequired;delete item.error;delete item.nextAttemptAt;delete item.suspended;item.attempts=0;item.pending=false;
    delete item.idempotency;delete item.idempotencyDigest;
    delete item.pendingHash;delete item.pendingExportedAt;delete item.pendingUpload;delete item.pendingKeys;
    persist();
    return {status:'synced',projectId,documentId:item.documentId,objectVersion:item.objectVersion,revision:item.revision,syncedAt:item.syncedAt,target:{projectId:item.remoteProjectId,name:item.remoteProjectName},...(item.warning?{warning:item.warning}:{})};
  }

  function recordFailure(item,error){
    item.setupRequired=error?.code==='project_classification_required';
    if(item.setupRequired){item.error=error.message;item.pending=false;item.suspended=true;delete item.nextAttemptAt;persist();return;}
    item.error=friendly(error);item.attempts=(item.attempts||0)+1;item.lastAttemptAt=new Date().toISOString();
    const auth=Number(error?.status)===401||Number(error?.status)===403;
    // 会话失效时不再自动重试：等待用户重新登录，下一次保存或手动上传会重新排队。
    if(auth){item.pending=false;item.suspended=true;delete item.nextAttemptAt;}
    else{item.pending=true;item.suspended=false;item.nextAttemptAt=Date.now()+RETRY_DELAYS[Math.min(item.attempts-1,RETRY_DELAYS.length-1)];}
    lastError=item.error;persist();
  }

  function nextDue(now=Date.now()){
    for(const [id,item] of Object.entries(state.projects)){
      if(!item.pending)continue;
      if(item.nextAttemptAt&&item.nextAttemptAt>now)continue;
      return id;
    }
    return null;
  }

  function scheduleWake(){
    clearTimeout(timer);timer=null;
    if(closed)return;
    const waiting=Object.values(state.projects).filter(item=>item.pending&&item.nextAttemptAt).map(item=>item.nextAttemptAt);
    if(!waiting.length)return;
    const delay=Math.max(1000,Math.min(...waiting)-Date.now());
    timer=setTimeout(()=>{timer=null;void drain();},delay);timer.unref?.();
  }

  async function drain(){
    if(closed||draining||!enabled||!state.auto)return;
    draining=true;
    try{
      for(let guard=0;guard<50&&!closed;guard++){
        const id=nextDue();if(!id)break;
        const item=state.projects[id];item.pending=false;item.nextAttemptAt=0;persist();
        running=true;
        try{await attempt(id,{force:false});}catch{}
        finally{running=false;}
      }
    }finally{draining=false;scheduleWake();}
  }

  async function attempt(projectId,{force=false}={}){
    try{return await serialize(()=>pushProject(projectId,{force}));}
    catch(error){recordFailure(state.projects[projectId]||(state.projects[projectId]={}),error);throw error;}
  }

  function mark(project){
    if(closed||!enabled||!state.auto)return;
    const id=typeof project==='string'?project:project?.id;
    if(typeof id!=='string'||!id)return;
    const item=state.projects[id]||(state.projects[id]={});
    if(item.teamManaged)return;
    item.pending=true;delete item.nextAttemptAt;delete item.suspended;
    clearTimeout(timer);timer=setTimeout(()=>{timer=null;void drain();},debounceMs);timer.unref?.();
  }

  function status(projectId=''){
    const item=projectId?(state.projects[projectId]||{}):{};
    let phase='idle';
    if(generation(projectId).active)phase='generating';
    else if(item.setupRequired)phase='needs-classification';
    else if(item.error)phase='error';
    else if(item.pending)phase='pending';
    else if(item.syncedAt)phase='synced';
    if(!projectId){
      const values=Object.values(state.projects);
      return {ok:true,auto:state.auto,enabled,baseUrl:library.baseUrl,defaultProjectId:library.defaultProjectId||'',projects:values.length,synced:values.filter(value=>value.syncedAt).length,failed:values.filter(value=>value.error).length,pending:values.filter(value=>value.pending).length,lastError,debounceMs};
    }
    return {ok:true,auto:state.auto,enabled,baseUrl:library.baseUrl,defaultProjectId:library.defaultProjectId||'',projectId,status:phase,setupRequired:!!item.setupRequired,generation:generation(projectId),revision:item.revision??null,syncedAt:item.syncedAt||null,error:item.error||'',warning:item.warning||'',pending:!!item.pending,attempts:item.attempts||0,documentId:item.documentId||'',objectVersion:item.objectVersion??null,target:{projectId:item.remoteProjectId||'',name:item.remoteProjectName||''}};
  }

  async function handle(request,response,{pathname,method,url}){
    if(!pathname.startsWith('/api/project-sync'))return false;
    if(method==='GET'&&pathname==='/api/project-sync/status'){json(response,200,status(url.searchParams.get('projectId')||''));return true;}
    if(method==='GET'&&pathname==='/api/project-sync/snapshot'){
      const projectId=text(url.searchParams.get('projectId'));check(!store.project(projectId).deletedAt,'工程已删除');const item=state.projects[projectId];check(item?.documentId,'工程尚无墨库快照',404);const document=await library.read('/api/documents/'+encodeURIComponent(item.documentId)),decoded=await decodeProjectSnapshot(document.content??document.revision?.content,library);check(decoded.projectId===projectId,'墨库快照属于其他工程',409);json(response,200,decoded);return true;
    }
    if(method==='GET'&&pathname==='/api/project-sync/settings'){json(response,200,{auto:state.auto,enabled,debounceMs});return true;}
    if(method==='PUT'&&pathname==='/api/project-sync/settings'){
      const input=await body(request);check(typeof input?.auto==='boolean','请提供自动上传开关');
      state.auto=input.auto;persist();
      if(state.auto)for(const id of Object.keys(state.projects))mark(id);
      json(response,200,{auto:state.auto,enabled,debounceMs});return true;
    }
    if(method==='POST'&&pathname==='/api/project-sync/push'){
      const input=request.teamSyncBody||await body(request),projectId=text(input?.projectId);
      check(/^[a-z]+_[0-9a-f-]{36}$/.test(projectId),'工程编号无效');
      const project=store.project(projectId);check(!project.deletedAt,'工程已删除');
      const result=await attempt(projectId,{force:input?.force!==false});
      json(response,200,{...result,state:status(projectId)});
      return true;
    }
    if(method==='POST'&&pathname==='/api/project-sync/link'){
      const input=await body(request),projectId=text(input?.projectId),remoteProjectId=text(input?.remoteProjectId);
      check(/^[a-z]+_[0-9a-f-]{36}$/.test(projectId),'工程编号无效');check(!remoteProjectId||/^[a-f0-9-]{36}$/i.test(remoteProjectId),'墨库项目编号无效');
      const project=store.project(projectId);check(!project.deletedAt,'工程已删除');
      const item=state.projects[projectId]||(state.projects[projectId]={});
      if(remoteProjectId){
        const projects=await listRemoteProjects(),found=projects.find(candidate=>candidate.id===remoteProjectId);
        check(found,'墨库项目不存在或无权访问');
        item.remoteProjectId=remoteProjectId;item.remoteProjectName=found.name;delete item.documentId;delete item.objectVersion;
      }else{delete item.remoteProjectId;delete item.remoteProjectName;delete item.documentId;delete item.objectVersion;}
      if(input.bindOnly===true){
        project.assetLibrary||={version:1,assetIds:[]};
        if(remoteProjectId)project.assetLibrary.mokuProjectId=remoteProjectId;else delete project.assetLibrary.mokuProjectId;
        project.revision=(project.revision||0)+1;project.updated=new Date().toISOString();store.markProject?.(project);store.save();
        item.pending=false;item.error='';delete item.nextAttemptAt;delete item.setupRequired;
      }else item.pending=true;
      persist();json(response,200,status(projectId));return true;
    }
    json(response,404,{error:'同步接口不存在'});return true;
  }

  function close(){
    closed=true;clearTimeout(timer);timer=null;persist();
  }

  // 上次退出时还没传完的快照，下次启动继续补传（仍受自动开关和重试退避约束）。
  if(state.auto&&Object.values(state.projects).some(item=>item.pending)){
    timer=setTimeout(()=>{timer=null;void drain();},debounceMs);timer.unref?.();
  }

  function hold(projectId){const item=state.projects[projectId]||(state.projects[projectId]={});item.teamManaged=true;item.pending=false;persist();}
  return {handle,mark,status,close,push:projectId=>attempt(projectId,{force:true}),drain,hold,running:()=>running,forget(projectId){delete state.projects[projectId];persist();}};
}
