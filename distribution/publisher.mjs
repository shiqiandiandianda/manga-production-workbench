import {createForcedUpgrades} from './forced-upgrades.mjs';
import {createAssetGenerationLocks} from './asset-generation-locks.mjs';
import {publicGenerationBoard} from './generation-board.mjs';
import fs from 'node:fs';import path from 'node:path';import http from 'node:http';import os from 'node:os';import {fileURLToPath,pathToFileURL} from 'node:url';import {randomBytes,generateKeyPairSync,timingSafeEqual,createHash} from 'node:crypto';
import {digest} from './code-policy.mjs';import {writeJson} from './updates.mjs';
import {createPresence} from './presence.mjs';
import {createReleaseNames} from './release-names.mjs';
import {createMemberDirectory,createTeamCommunications} from './team-communications.mjs';
import {createReleaseCatalog} from './release-catalog.mjs';
import {createPublicationPermissions} from './publication-permissions.mjs';
import {retargetPrimaryAccess} from './primary-channel.mjs';
const json=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));};
const local=req=>['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
const ownMachine=req=>local(req)||Object.values(os.networkInterfaces()).flat().some(r=>r.address===String(req.socket.remoteAddress).replace(/^::ffff:/,''));
const equal=(a,b)=>{const x=Buffer.from(String(a||'')),y=Buffer.from(String(b||''));return x.length===y.length&&timingSafeEqual(x,y);};
export function primaryAddress(){return Object.entries(os.networkInterfaces()).filter(([name])=>!/virtual|vmnet|vethernet|vpn|tun|tap|本地连接\*/i.test(name)).flatMap(([,rows])=>rows.filter(r=>r.family==='IPv4'&&!r.internal&&/^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(r.address)).map(r=>r.address))[0]||os.hostname();}
const channelAddress=(masterUrl,port)=>{const u=new URL(masterUrl);u.port=String(port);return u.origin;};
export async function createPublisher({root,dataDir=path.join(root,'runtime-data/distribution/master'),masterUrl,centerUrl='http://127.0.0.1:8790',projectIds=[],environmentDirectory,mokuSessionFile,hub=null,checkSyntax=true,releaseDirectory,primaryContext,ownerCheck=ownMachine}={}){
 const ownMachine=ownerCheck;
 fs.mkdirSync(dataDir,{recursive:true});const stateFile=path.join(dataDir,'master.local.json');let state=fs.existsSync(stateFile)?JSON.parse(fs.readFileSync(stateFile)):null;
 if(!state){const keys=generateKeyPairSync('ed25519',{publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});state={...keys,enrollmentCode:randomBytes(24).toString('hex'),clients:{}};writeJson(stateFile,state);}
 let previousChannel;try{previousChannel=JSON.parse(fs.readFileSync(path.join(root,'distribution/channel.json')));}catch{}
 if(previousChannel?.publicKey===state.publicKey&&retargetPrimaryAccess(state,previousChannel.masterUrl,masterUrl))writeJson(stateFile,state);
 const channel={format:'comic-team-channel-v1',masterUrl,publicKey:state.publicKey,enrollmentCode:state.enrollmentCode,projectCenterUrl:masterUrl.replace(/:\d+$/,':8790'),collabHubUrl:hub?.url||masterUrl.replace(/:\d+$/,':18897')};writeJson(path.join(root,'distribution/channel.json'),channel);
 writeJson(path.join(root,'comic/public/team-release-channel.json'),{masterUrl});
 const spec=JSON.parse(fs.readFileSync(path.join(root,'distribution/environments.json'))),releaseRoot=releaseDirectory||path.join(dataDir,'releases');fs.mkdirSync(releaseRoot,{recursive:true});let latest=null,watcher=null,lastError=null;
 const presence=createPresence({file:path.join(dataDir,'presence.local.json'),clients:()=>state.clients}),controlNonce=randomBytes(24).toString('hex');
 const directory=createMemberDirectory(path.join(dataDir,'member-names.local.json'));
 const getMembers=async()=>{let selfId='';try{const i=JSON.parse(fs.readFileSync(path.join(root,'runtime-data/team/identity.local.json')));selfId=createHash('sha256').update(i.machineId+':'+i.registrationKey).digest('hex').slice(0,16);}catch{}const rows=presence.members(latest?.manifest.contentId).filter(m=>!primaryContext||m.id!==selfId);if(primaryContext){let c;try{c=await primaryContext();}catch{}rows.unshift({id:'publisher',name:c?.name||'',nameSource:c?.nameSource||'',machine:os.hostname(),version:latest?.manifest.version||'主版本（本地开发）',versionStatus:'source',connection:c?'online':'unknown',project:c?.project||'',page:c?.page||'',episode:c?.episode||'',activity:c?.activity||'等待工作台上报',task:c?.task||'',lastSeen:c?Date.now():null,generationTasks:c?.generationTasks||[],editorAlive:c?.editorAlive===true});}return directory.resolve(rows).map(row=>({...row,displayVersion:row.version?releaseNames.label(row.version):''}));};
 const forcedUpgrades=createForcedUpgrades({dataDir,privateKey:state.privateKey,getLatest:()=>latest,getMembers});
 const communications=createTeamCommunications({dataDir,clients:()=>state.clients,invitation:state.enrollmentCode,ownMachine,equal,controlNonce,getMembers,directory});
 const assetGenerationLocks=createAssetGenerationLocks({file:path.join(dataDir,'asset-generations.local.json'),authenticate:communications.authenticate,getMembers});
 const latestFile=path.join(releaseRoot,'latest.json');if(fs.existsSync(latestFile))latest=JSON.parse(fs.readFileSync(latestFile));
 const releaseNames=createReleaseNames(releaseRoot,{legacyDirectory:path.join(dataDir,'releases'),initial:latest?[latest.manifest]:[]});
 const catalog=createReleaseCatalog({root,releaseRoot,privateKey:state.privateKey,publicKey:state.publicKey,releaseNames,initial:latest,checkSyntax,getSourceAuthor:async()=>{const person=(await getMembers()).find(m=>m.id==='publisher');return {id:'publisher',name:person?.name||('主版本电脑 · '+os.hostname())};},onLatest:value=>latest=value,onError:value=>lastError=value});
 const publish=options=>catalog.publishSource(options);
 const publication=createPublicationPermissions({dataDir,clients:()=>state.clients,authenticate:communications.authenticate,ownMachine,controlNonce,getMembers,submit:catalog.submit});
 async function body(req){let size=0;const parts=[];for await(const b of req){size+=b.length;if(size>16384)throw Error('请求过大');parts.push(b);}return JSON.parse(Buffer.concat(parts).toString()||'{}');}
 const requestJson=async(route,input)=>{const r=await fetch(centerUrl+route,{method:input===undefined?'GET':'POST',headers:input===undefined?{}:{'Content-Type':'application/json'},body:input===undefined?undefined:JSON.stringify(input),signal:AbortSignal.timeout(15000)}),v=await r.json();if(!r.ok)throw Error(v.error||'项目中心连接失败');return v;};
 const checkedEnvironments=new Set();
 async function serveEnvironment(req,res,revision){
  const entry=spec.packages.find(p=>p.revisionId===revision);if(!entry)return json(res,404,{error:'环境包未登记'});
  const candidate=environmentDirectory&&path.join(environmentDirectory,entry.name);
  if(candidate&&fs.existsSync(candidate)){
   if(!checkedEnvironments.has(entry.sha256)){const h=createHash('sha256');for await(const b of fs.createReadStream(candidate))h.update(b);if(fs.statSync(candidate).size!==entry.bytes||h.digest('hex')!==entry.sha256)throw Error('主版本环境缓存校验失败');checkedEnvironments.add(entry.sha256);}
   let start=0,status=200;const range=/^bytes=(\d+)-$/.exec(req.headers.range||'');if(range){start=Number(range[1]);if(start>=entry.bytes)return json(res,416,{error:'续传位置无效'});status=206;}
   res.writeHead(status,{'Content-Type':'application/zip','Content-Length':entry.bytes-start,'Accept-Ranges':'bytes',...(start?{'Content-Range':`bytes ${start}-${entry.bytes-1}/${entry.bytes}`}:{})});fs.createReadStream(candidate,{start}).pipe(res);return;
  }
  if(!mokuSessionFile||!fs.existsSync(mokuSessionFile))throw Error('主版本没有环境缓存或有效墨库会话，可用同事自己的墨库登录直接下载');
  const session=JSON.parse(fs.readFileSync(mokuSessionFile)),upstream=await fetch(spec.mokuBase+'/api/revisions/'+entry.revisionId+'/download',{headers:{Cookie:session.cookie||'',...(req.headers.range?{Range:req.headers.range}:{})},redirect:'error',signal:AbortSignal.timeout(1800000)});
  if(!upstream.ok)return json(res,upstream.status,{error:'墨库环境下载暂不可用，请在主版本重新登录墨库'});
  res.writeHead(upstream.status,{'Content-Type':'application/zip',...(upstream.headers.get('content-length')?{'Content-Length':upstream.headers.get('content-length')}:{})});for await(const b of upstream.body)if(!res.write(b))await new Promise(r=>res.once('drain',r));res.end();
 }
 const server=http.createServer(async(req,res)=>{try{const url=new URL(req.url,'http://localhost');
  if(req.method==='GET'&&url.pathname==='/downloads/team-connection-repair.zip'){if(!latest)return json(res,503,{error:'主版本正在准备连接修复包'});const {buildReconnectPackage}=await import('./reconnect-package.mjs'),artifact=buildReconnectPackage(root,latest);res.writeHead(200,{'Content-Type':'application/zip','Content-Length':artifact.bytes.length,'Content-Disposition':'attachment; filename="team-connection-repair.zip"','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end(artifact.bytes);}
  if(await publication.handle(req,res,url))return;
  if(await assetGenerationLocks.handle(req,res,url))return;
  if(req.method==='GET'&&url.pathname==='/api/team/generation-board'){
   if(!(ownMachine(req)||equal(req.headers['x-team-invitation'],state.enrollmentCode)||publication.info(req).actor))return json(res,403,{error:'请通过已接入的团队工具查看任务'});
   return json(res,200,publicGenerationBoard(assetGenerationLocks.items,await getMembers()));
  }
  if(await communications.handle(req,res,url))return;
  if(req.method==='POST'&&url.pathname==='/api/team/heartbeat'){if(req.headers.origin)return json(res,403,{error:'请由本机工具上报状态'});const input=await body(req),result=presence.heartbeat(input),upgradeCommand=forcedUpgrades.heartbeat(result.memberId,input);return json(res,200,{...result,upgradeCommand});}
  if(req.method==='GET'&&url.pathname==='/api/dashboard'){
   const authorized=ownMachine(req)||equal(req.headers['x-team-invitation'],state.enrollmentCode)||!!publication.info(req).actor,members=authorized?await getMembers():[];
   return json(res,200,{forcedUpgrades:authorized?await forcedUpgrades.view():null,canForceUpgrade:ownMachine(req),role:ownMachine(req)?'publisher':'colleague',authorized,canManageNames:ownMachine(req),nameControl:ownMachine(req)?controlNonce:null,...publication.info(req),latest:latest?.manifest.version||null,publishedAt:latest?.manifest.createdAt||null,lastPublication:latest?.manifest.author?{author:latest.manifest.author,note:latest.manifest.releaseNotes}:null,watching:!!watcher,publishing:catalog.busy,error:lastError,projectCount:projectIds.length,members:members.map(member=>({...member,canPublish:publication.allowed(member.id)})),online:members.filter(m=>m.connection==='online').length,registered:Object.keys(state.clients).length,projectCenterUrl:channel.projectCenterUrl,availablePackages:spec.packages.filter(p=>environmentDirectory&&fs.existsSync(path.join(environmentDirectory,p.name))).length});
  }
  if(req.method==='POST'&&url.pathname==='/api/dashboard/force-upgrade'){if(!ownMachine(req)||req.headers['x-dashboard-control']!==controlNonce||req.headers.origin&&req.headers.origin!=='http://'+req.headers.host)return json(res,403,{error:'只有主机管理员可以强制升级同事'});const input=await body(req);const value=await forcedUpgrades.start({requestId:input.requestId,author:(await getMembers()).find(m=>m.id==='publisher')?.name||'主机管理员'});return json(res,202,{...value,message:'升级已安排：空闲同事先升级，生图中的同事结束后自动升级'});}
  if(req.method==='POST'&&url.pathname==='/api/dashboard/publish'){if(!ownMachine(req)||req.headers['x-dashboard-control']!==controlNonce||req.headers.origin&&req.headers.origin!=='http://'+req.headers.host)return json(res,403,{error:'请在主版本电脑发布'});const release=await publish({force:true});return json(res,200,{ok:true,version:release?.manifest.version,message:'已检查并发布当前版本'});}
  if(req.method==='GET'&&url.pathname==='/health')return json(res,200,{application:'comic-team-publisher',version:1,assetGenerationLockVersion:1,latest:latest?.manifest.version,environmentRelay:true,...(local(req)?{root,projectIds,watching:!!watcher,lastError}:{})});
  if(req.method==='GET'&&url.pathname==='/api/releases/latest')return latest?json(res,200,latest):json(res,503,{error:'主版本正在准备首个发布包'});
  const download=/^\/releases\/([a-f0-9]{64})\.json\.gz$/.exec(url.pathname);if(req.method==='GET'&&download){const file=path.join(releaseRoot,download[1]+'.json.gz');if(!fs.existsSync(file))return json(res,404,{error:'版本不存在'});res.writeHead(200,{'Content-Type':'application/gzip','Content-Length':fs.statSync(file).size});return fs.createReadStream(file).pipe(res);}
  const env=/^\/api\/environments\/([a-f0-9-]{36})$/.exec(url.pathname);if(req.method==='GET'&&env){if(!equal(req.headers['x-setup-invitation'],state.enrollmentCode))return json(res,403,{error:'安装邀请无效'});return await serveEnvironment(req,res,env[1]);}
  if(req.method==='POST'&&url.pathname==='/api/join'){
   if(req.headers.origin)return json(res,403,{error:'接入必须由本机安装器执行'});const input=await body(req);if(!equal(input.enrollmentCode,state.enrollmentCode))return json(res,403,{error:'接入邀请无效'});if(!/^[a-f0-9]{64}$/.test(input.registrationKey||'')||!input.machineId||String(input.machineId).length>100)return json(res,400,{error:'设备身份无效'});
   const key=digest(input.machineId+':'+input.registrationKey);let access=state.clients[key];if(!access){if(!projectIds.length)throw Error('主版本尚未指定允许接入的项目');const grant=await requestJson('/api/v1/projects/'+projectIds[0]+'/access-tokens',{label:'同事接入 '+String(input.name||input.machineId).slice(0,80),projectIds,scopes:['read','intake']});access={hub:grant.hub||channel.projectCenterUrl,projectIds,token:grant.token,name:String(input.name||input.machineId).slice(0,80),capacity:2,reserve:1,roles:['character','scene','prop'],localWorkbench:'http://127.0.0.1:8790',localComic:'http://127.0.0.1:18909'};state.clients[key]=access;writeJson(stateFile,state);}
   const canvas=hub?(hub.pairing?await hub.pairing():{hubUrl:channel.collabHubUrl,pairingCode:hub.hub.state.pairingCode}):null;return json(res,200,{connection:access,canvas});
  }
  if(req.method==='POST'&&url.pathname==='/api/publish'){if(!local(req)||req.headers.origin)return json(res,403,{error:'只允许主版本本机发布'});return json(res,200,await publish({force:true}));}
  if(req.method==='GET'&&['/','/team-dashboard.html','/team-dashboard.js','/team-dashboard.css','/team-publishing.js','/team-forced-upgrades.js','/team-comms.js','/team-chat-media.js','/team-comms.css','/team-version.js','/team-dashboard-boot.js','/team-remote-assist.js','/team-remote-input.js','/team-member-name.js','/team-instance-labels.mjs','/workbench-update-navigation.mjs','/team-local-instances.json'].includes(url.pathname)){
   const name=url.pathname==='/'?'team-dashboard.html':url.pathname.slice(1),file=path.join(root,'comic/public',name);if(name==='team-local-instances.json'&&!fs.existsSync(file))return json(res,200,{});if(!fs.existsSync(file))return json(res,503,{error:'团队页面文件尚未就绪'});let bytes=fs.readFileSync(file);if(name.endsWith('.html'))bytes=Buffer.from(bytes.toString().replace('__TEAM_MODE__','publisher').replace('__TEAM_CONTROL__',ownMachine(req)?controlNonce:''));res.writeHead(200,{'Content-Type':name.endsWith('.html')?'text/html; charset=utf-8':name.endsWith('.css')?'text/css; charset=utf-8':name.endsWith('.json')?'application/json; charset=utf-8':'text/javascript; charset=utf-8','Cache-Control':'no-store',...(name.endsWith('.html')&&ownMachine(req)?{'Set-Cookie':'comic_team_owner_'+(/:(\d+)$/.exec(req.headers.host||'')?.[1]||'80')+'='+controlNonce+'; HttpOnly; SameSite=Strict; Path=/api/team-comms'}:{}),'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'"});return res.end(bytes);
  }
  json(res,404,{error:'接口不存在'});
 }catch(e){if(!res.headersSent)json(res,e.status||500,{error:e.message});else res.destroy(e);}});
 // Asset claims are durable coordination records. Execution belongs to the
 // colleague's manager, which independently defers its own upgrade while busy.
 return {server,channel,publish,get busy(){return catalog.busy;},get upgradeBlockers(){return catalog.busy?[{kind:'release',target:'团队代码版本',status:'正在发布',message:'正在检查、签名或打包新版本。',reason:'发布完成前需要保持版本文件完整。',nextAction:'发布结束后即可升级。'}]:[];},get latest(){return latest;},watch(ms=15000){watcher=setInterval(()=>void publish().catch(()=>{}),ms);watcher.unref?.();},async close(){clearInterval(watcher);communications.close();server.closeAllConnections();await new Promise(r=>server.close(r));}};
}
export async function existingCanvasHub({root,hubPort=18897,comicPort=18909,request=fetch}={}){
 let health;try{health=await request('http://127.0.0.1:'+comicPort+'/api/health',{signal:AbortSignal.timeout(1500)}).then(r=>r.json());}catch{return null;}
 if(health.application!=='comic-merged-studio'||!health.dataRoot)return null;
 const file=path.join(health.dataRoot,'collab/client-config.json');if(!fs.existsSync(file))return null;const client=JSON.parse(fs.readFileSync(file));if(!client.hubUrl||!client.token||client.enabled===false)return null;
 const base=new URL(client.hubUrl);if(!/^https?:$/.test(base.protocol)||base.username||base.password)throw Error('现有协作中控地址无效');
 const ownedState=root&&path.join(root,'runtime-data/distribution/master/canvas-hub/hub-state.json');let saved;try{saved=JSON.parse(fs.readFileSync(ownedState));}catch{}
 const ownsClient=Number(base.port)===hubPort&&saved?.clients?.some(c=>!c.revoked&&c.id===client.clientId&&c.tokenHash===digest(client.token));
 let response;try{response=await request(base.origin+'/api/health',{signal:AbortSignal.timeout(3000)});}catch(error){
  const localHosts=new Set(['localhost','127.0.0.1','[::1]',os.hostname().toLowerCase(),...Object.values(os.networkInterfaces()).flat().filter(Boolean).map(row=>row.address.toLowerCase())]);
  if(ownsClient||ownedState&&fs.existsSync(ownedState)&&localHosts.has(base.hostname.toLowerCase())&&Number(base.port)===hubPort)return null;
  throw Error('原协作中控暂不可达，未创建第二套中控：'+error.message);
 }
 const status=await response.json();if(!response.ok||status.application!=='photocraft-collab-hub')throw Error('现有中控协议不匹配，未新建冲突服务');
 if(ownsClient&&status.hubId!==saved.hubId)throw Error('旧地址上的中控身份已变化，未发送原配对令牌');
 const adapter={url:base.origin,owned:!!ownsClient,async pairing(){const r=await request(base.origin+'/api/admin/pairing',{headers:{Authorization:'Bearer '+client.token},signal:AbortSignal.timeout(3000)}),value=await r.json();if(!r.ok||!value.pairingCode)throw Error('现有中控配对信息不可读，请在主版本恢复协作连接');return {hubUrl:base.origin,pairingCode:value.pairingCode};},async close(){}};
 await adapter.pairing();return adapter;
}
export async function startMaster(root,{port=18914,environmentDirectory,mokuSessionFile,projectIds,hubPort=18897,comicPort=18909}={}){
 const dataDir=path.join(root,'runtime-data/distribution/master'),masterUrl='http://'+primaryAddress()+':'+port;let hub;
 hub=await existingCanvasHub({root,hubPort,comicPort});
 if(hub?.owned){const pairing=hub.pairing.bind(hub);hub.url=channelAddress(masterUrl,hubPort);hub.pairing=async()=>({...await pairing(),hubUrl:hub.url});}
 if(!hub){for(const host of ['127.0.0.1',primaryAddress()]){let present=false;try{const r=await fetch('http://'+host+':'+hubPort+'/api/health',{signal:AbortSignal.timeout(1000)});present=r.ok;}catch{}if(present)throw Error('协作端口已有服务，请先在主版本漫画工具连接这套中控；未创建重叠监听。');}const {createHubServer}=await import(pathToFileURL(path.join(root,'协作/lib/hub-server.mjs')));hub=createHubServer({dataDir:path.join(dataDir,'canvas-hub'),config:{port:hubPort,host:'0.0.0.0'},logger:{info(){},warn(){},error:console.error}});await hub.listen({port:hubPort,host:'0.0.0.0'});hub.url=channelAddress(masterUrl,hubPort);}
 if(!projectIds){try{const response=await fetch('http://127.0.0.1:8790/api/v1/projects',{signal:AbortSignal.timeout(5000)});if(!response.ok)throw Error('HTTP '+response.status);const value=await response.json();if(!Array.isArray(value.projects))throw Error('项目列表格式无效');projectIds=value.projects.filter(p=>!/验收|测试/.test(p.title)).map(p=>p.id);}catch(error){projectIds=[];console.error('项目中心暂不可达，团队会话与版本服务继续启动：'+error.message);}}
 const releaseDirectory=path.join(dataDir,'releases-by-port',String(port));if(!fs.existsSync(path.join(releaseDirectory,'latest.json'))&&fs.existsSync(path.join(dataDir,'releases/latest.json'))){const old=JSON.parse(fs.readFileSync(path.join(dataDir,'releases/latest.json'))),archive=path.join(dataDir,'releases',old.manifest.contentId+'.json.gz');if(fs.existsSync(archive)){fs.mkdirSync(releaseDirectory,{recursive:true});fs.copyFileSync(archive,path.join(releaseDirectory,path.basename(archive)));writeJson(path.join(releaseDirectory,'latest.json'),old);}}
 const primaryContext=async()=>{const r=await fetch('http://127.0.0.1:'+comicPort+'/api/team-release/context',{signal:AbortSignal.timeout(1500)});if(!r.ok)throw Error('工作台尚未上报');return r.json();};
 const publisher=await createPublisher({root,dataDir,masterUrl,projectIds,environmentDirectory,mokuSessionFile,hub,releaseDirectory,primaryContext});await new Promise((resolve,reject)=>{publisher.server.once('error',reject);publisher.server.listen(port,'0.0.0.0',resolve);});await publisher.publish({force:true});publisher.watch();
 if(hub){try{const status=await fetch('http://127.0.0.1:'+comicPort+'/api/collab/status',{signal:AbortSignal.timeout(2000)}).then(r=>r.json());if(!status.configured&&!status.config?.configured){const pair=hub.pairing?await hub.pairing():{hubUrl:hub.url,pairingCode:hub.hub.state.pairingCode};await fetch('http://127.0.0.1:'+comicPort+'/api/collab/pair',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...pair,clientName:'主版本漫画工作台'}),signal:AbortSignal.timeout(3000)});}}catch(e){console.error('主版本画格配对待完成：'+e.message);}}
 console.log(JSON.stringify({application:'comic-team-publisher',masterUrl,version:publisher.latest.manifest.version,projects:projectIds.length,sourceRoot:root}));return {publisher,hub};
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){const root=path.resolve(process.argv[2]||path.join(path.dirname(fileURLToPath(import.meta.url)),'..')),instance=await startMaster(root,{environmentDirectory:process.env.COMIC_ENVIRONMENT_PACKAGES,mokuSessionFile:process.env.COMIC_MOKU_SESSION_FILE});for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await instance.publisher.close();await instance.hub?.close();process.exit(0);});}
