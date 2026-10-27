import {inspectManaged,upgradeBlocked,serviceBlockers,readableServiceMessage,SERVICE_NAMES} from './upgrade-readiness.mjs';
import {releaseDetails,pendingReleaseDetails} from './release-details.mjs';
import fs from 'node:fs';import path from 'node:path';import http from 'node:http';import net from 'node:net';import {spawn} from 'node:child_process';import {randomUUID,randomBytes} from 'node:crypto';import {pathToFileURL} from 'node:url';
import {readChannel,join,connectCanvas} from './colleague.mjs';import {checkUpdate,stageUpdate,applyRelease,decodeRelease,finalizeInstalledUpdate,recoverLocalExtensions,localExtensionsStatus} from './updates.mjs';
import {reportPresence} from './presence.mjs';
import {createForcedUpgradeReceiver} from './forced-upgrade-client.mjs';
import {ensurePrimaryPublisher,isPrimaryInstallation} from './master-startup.mjs';
import {primaryReleaseState,activatePrimaryRelease} from './primary-release.mjs';
export function childRequest(child,type,timeout=15000){
 if(child.exitCode!==null||child.signalCode)return Promise.resolve({stopped:true});return new Promise((resolve,reject)=>{const id=randomUUID(),timer=setTimeout(()=>finish(Error('子服务未确认安全退出，未强制结束')),timeout),message=m=>{if(m.id===id)finish(null,m);},exited=()=>finish(null,{stopped:true});function finish(error,value){clearTimeout(timer);child.off('message',message);child.off('exit',exited);error?reject(error):resolve(value);}child.on('message',message);child.on('exit',exited);child.send({id,type},e=>{if(e)finish(e);});});
}
export async function stopManaged(children){
 const readiness=await inspectManaged(children,childRequest);if(!readiness.allowed)throw upgradeBlocked(readiness);
 for(const item of [...children].reverse().filter(i=>i.child.exitCode===null&&!i.child.signalCode)){const result=await childRequest(item.child,'distribution-stop',30000);if(result.busy||result.error)throw upgradeBlocked({allowed:false,blockers:serviceBlockers(item.name,result)});if(item.child.exitCode===null&&!item.child.signalCode)await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error((SERVICE_NAMES[item.name]||'本机服务')+'尚未退出，请稍后重试。')),15000);item.child.once('exit',()=>{clearTimeout(timer);resolve();});});}
}
const option=(args,name,value)=>{const i=args.indexOf(name);return i<0?value:Number(args[i+1]);};
const available=port=>new Promise(resolve=>{const socket=net.connect({port,host:'127.0.0.1'});socket.once('connect',()=>{socket.destroy();resolve(false);});socket.once('error',()=>resolve(true));});
const pageFile=new URL('./manager-page.mjs',import.meta.url);
export async function runManager(root,args=process.argv.slice(2)){
 const primary=isPrimaryInstallation(root);let primarySource=null;
 const comic=option(args,'--comic-port',18909),asset=option(args,'--asset-port',8796),center=option(args,'--center-port',8790),control=option(args,'--control-port',18913),data=process.env.WORKBENCH_RELEASE_DATA_ROOT||path.join(root,'runtime-data'),channel=readChannel(root),children=[],nonce=randomBytes(24).toString('hex');let update=null,staged=null,error=null,busy=false,checking=false,readiness=null,readinessPromise=null;
 process.chdir(root);recoverLocalExtensions(root);try{finalizeInstalledUpdate(root);}catch{console.error('旧升级临时文件待下次清理，工程数据保留');}fs.mkdirSync(path.join(data,'logs'),{recursive:true});for(const port of [comic,asset,center,control])if(!Number.isSafeInteger(port)||port<1024||port>65535||!await available(port))throw Error('端口无效或已使用：'+port+'。未停止其他工具。');
 Object.assign(process.env,{ASSET_EDITOR:'http://127.0.0.1:'+comic,ASSET_STUDIO_URL:'http://127.0.0.1:'+asset,PROJECT_CENTER_URL:'http://127.0.0.1:'+center,COMIC_TEAM_CONTROL_URL:'http://127.0.0.1:'+control});
 const configModule=await import(pathToFileURL(path.join(root,'workbench/server/config.mjs')));await configModule.createConfig().update({port:center,bindHost:'127.0.0.1',scene:{port:option(args,'--scene-port',center+101),codexPath:process.env.COMIC_CODEX_BIN},workshop:{port:option(args,'--workshop-port',center+102),pythonPath:process.env.COMIC_PYTHON_BIN,maxConcurrentJobs:2},intake:{maxConcurrentJobs:2}});
 const launch=(name,file,argv=[])=>{const old=children.find(i=>i.name===name&&i.child.exitCode===null&&!i.child.signalCode);if(old)return old.child;const fd=fs.openSync(path.join(data,'logs',name+'.log'),'a'),child=spawn(process.execPath,[path.join(root,file),...argv],{cwd:root,env:process.env,windowsHide:true,stdio:['ignore',fd,fd,'ipc']});fs.closeSync(fd);children.push({name,child});return child;};
 async function ready(port,route='/api/health'){for(let i=0;i<100;i++){try{const r=await fetch('http://127.0.0.1:'+port+route,{signal:AbortSignal.timeout(1000)});if(r.ok)return;}catch{}await new Promise(r=>setTimeout(r,200));}throw Error('服务未就绪，请查看 runtime-data/logs，端口 '+port);}
 async function startServices(){
  if(fs.existsSync(path.join(root,'auto-layout/learning-workbench/integration_server.py'))){
   const layoutPort=Number(process.env.AUTO_LAYOUT_PORT||19848);let existing=null;
   if(!await available(layoutPort)){const response=await fetch('http://127.0.0.1:'+layoutPort+'/api/health',{signal:AbortSignal.timeout(2000)});existing=await response.json();if(existing.integrationVersion!==1||path.resolve(existing.root||'')!==path.join(root,'auto-layout/learning-workbench'))throw Error('自动排版端口由其他工具使用，未停止其他工具');}
   launch('auto-layout','distribution/start-layout-local.mjs',existing?['--adopt']:[]);await ready(layoutPort,'/api/integration/status');
  }
  launch('comic','start-comic-local.mjs',['--port',String(comic)]);await ready(comic);launch('assets','start-assets-local.mjs',['--port',String(asset)]);await ready(asset);launch('center','start-center-local.mjs',['--port',String(center),...(args.includes('--no-engines')?['--no-engines']:[])]);await ready(center,'/api/v1/center/status');
  if(!args.includes('--no-publisher')){try{await ensurePrimaryPublisher(root,{port:option(args,'--publisher-port',18914),hubPort:option(args,'--hub-port',18897),comicPort:comic,launch});Object.assign(channel,readChannel(root));}catch(e){error='团队中心启动待完成：'+e.message;console.error(error);}}
  if(!args.includes('--no-workers')){try{await join(root,{channel,localComic:'http://127.0.0.1:'+comic,localWorkbench:'http://127.0.0.1:'+center});await connectCanvas(root,'http://127.0.0.1:'+comic);}catch(e){error='接入暂未完成：'+e.message;}
   for(const [name,file,configuration]of [['team-worker','distribution/team-worker.mjs','接入配置.local.json'],['canvas-node','distribution/canvas-node.mjs','canvas-node.local.json']]){const config=path.join(root,'runtime-data/team',configuration);if(fs.existsSync(config))launch(name,file,[config]);}}
 }
 async function sendPresence(progressOnly=false){const file=path.join(root,'runtime-data/distribution/installed.local.json'),installed=fs.existsSync(file)?JSON.parse(fs.readFileSync(file)):{};return reportPresence(root,{masterUrl:channel.masterUrl,comic:'http://127.0.0.1:'+comic,center:'http://127.0.0.1:'+center,version:installed.version||'',contentId:installed.contentId||'',forcedUpgradeVersion:2,forcedUpgradeStatus:receiver.status(),progressOnly});}
 let reporting=false;async function heartbeat(){if(primary||reporting||busy||receiver.running||args.includes('--no-presence'))return;reporting=true;try{const reply=await sendPresence();if(reply?.upgradeCommand)void receiver.accept(reply.upgradeCommand)?.catch(e=>{error=readableServiceMessage(e.message);});}catch{}finally{reporting=false;}}
 async function refresh(){if(checking||busy)return;checking=true;try{if(!args.includes('--no-publisher')){await ensurePrimaryPublisher(root,{port:option(args,'--publisher-port',18914),hubPort:option(args,'--hub-port',18897),comicPort:comic,launch});Object.assign(channel,readChannel(root));}update=await checkUpdate(root,channel);primarySource=primary?primaryReleaseState(root,update.manifest):null;if(primary&&!primarySource.matches){staged=null;error='主机源码有待合并或发布的修改，已保留主机代码。请先完成主机发布，再启用并重启。';}else{if(update.available)staged=await stageUpdate(root,channel,update);error=null;}}catch(e){error='主版本暂时不可达，可继续使用本机工具。'+e.message;}finally{checking=false;}}
 async function checkReadiness(){if(readinessPromise)return readinessPromise;readinessPromise=inspectManaged(children,(child,type)=>childRequest(child,type,2500)).then(value=>(readiness=value)).finally(()=>readinessPromise=null);return readinessPromise;}
 async function restartManager(){
  clearInterval(timer);clearInterval(presenceTimer);server.close();
  const fd=fs.openSync(path.join(data,'logs/restart.log'),'a'),child=spawn(process.execPath,[path.join(root,'start-all.mjs'),...args],{cwd:root,env:process.env,windowsHide:true,detached:true,stdio:['ignore',fd,fd]});fs.closeSync(fd);child.unref();setTimeout(()=>process.exit(0),500);
 }
 const receiver=createForcedUpgradeReceiver({root,channel,readiness:checkReadiness,stop:async()=>{busy=true;await stopManaged(children);},restart:restartManager,recover:async()=>{busy=false;await startServices();},report:async()=>{await sendPresence(true);}});
 const queueFile=path.join(root,'runtime-data/distribution/deferred-upgrade.local.json');let upgradeQueued=false;
 try{upgradeQueued=JSON.parse(fs.readFileSync(queueFile)).requested===true;}catch{}
 const queueUpgrade=value=>{upgradeQueued=value;fs.mkdirSync(path.dirname(queueFile),{recursive:true});fs.writeFileSync(queueFile,JSON.stringify({requested:value}));};
 async function applyUpdate(send){
  if(busy||receiver.running)return send(409,{error:'正在处理升级'});
  if(!staged||!update?.available){queueUpgrade(false);return send(200,{message:'当前已是最新版本'});}busy=true;
  try{
   if(primary&&!primaryReleaseState(root,update.manifest).matches)throw Error('主机代码已变化，请先发布主机修改；没有覆盖主机文件。');
   await stopManaged(children);
   const result=primary?activatePrimaryRelease(root,update):applyRelease(root,decodeRelease(fs.readFileSync(staged.file),channel.publicKey));
   queueUpgrade(false);send(200,{message:'代码已升级，正在重启。工程和账号保留。',...result});await restartManager();
  }catch(e){
   error=e.readiness?null:readableServiceMessage(e.message);readiness=e.readiness||readiness;busy=false;
   if(e.code==='upgrade_blocked')queueUpgrade(true);
   await startServices().catch(e=>error='重启待完成：'+readableServiceMessage(e.message));
   send(e.code==='upgrade_blocked'?202:409,{error:error||e.message,message:e.code==='upgrade_blocked'?'已安排本机空闲后自动升级；任务继续执行，其他同事可独立升级。':undefined,code:e.code,readiness,upgradeQueued});
  }
 }
 async function resumeQueued(){if(!upgradeQueued||busy||receiver.running||checking)return;try{if((await checkReadiness()).allowed)await applyUpdate(()=>{});}catch(e){error=readableServiceMessage(e.message);}}
 const cleanupStatus=()=>{try{return JSON.parse(fs.readFileSync(path.join(root,'runtime-data/distribution/cleanup.local.json')));}catch{return null;}};
 const status=()=>{const installed=path.join(root,'runtime-data/distribution/installed.local.json');return {application:primary?'comic-team-primary':'comic-team-colleague',role:primary?'publisher':'colleague',primarySource,localIntegration:args.includes('--local-integration'),localExtensions:localExtensionsStatus(root),root,current:fs.existsSync(installed)?JSON.parse(fs.readFileSync(installed)).version:null,currentRelease:releaseDetails(fs.existsSync(installed)?JSON.parse(fs.readFileSync(installed)):null),latestRelease:releaseDetails(update?.manifest),releaseHistory:pendingReleaseDetails(update?.manifest,fs.existsSync(installed)?JSON.parse(fs.readFileSync(installed)).contentId:null),latest:update?.manifest.version,available:!!(update?.available&&staged),error,busy,readiness,upgradeQueued,forcedUpgrade:receiver.status(),cleanup:cleanupStatus(),projectCenter:'http://127.0.0.1:'+comic+'/project-center.html',services:children.filter((i,n,all)=>all.findLastIndex(x=>x.name===i.name)===n).map(i=>({name:i.name,running:i.child.exitCode===null&&!i.child.signalCode}))};};
 const server=http.createServer(async(req,res)=>{const send=(code,value)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...(req.headers.origin==='http://127.0.0.1:'+comic?{'Access-Control-Allow-Origin':req.headers.origin}:{})});res.end(JSON.stringify(value));};try{const url=new URL(req.url,'http://localhost');if(req.method==='GET'&&url.pathname==='/api/status'){if(!readiness||!Number.isFinite(Date.parse(readiness.checkedAt))||Date.now()-Date.parse(readiness.checkedAt)>2000)await checkReadiness();return send(200,status());}if(req.method==='GET'&&url.pathname==='/'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});const {managerPage}=await import(pageFile.href+'?v='+fs.statSync(pageFile).mtimeMs);return res.end(managerPage.replace('__NONCE__',nonce).replaceAll('http://127.0.0.1:18909/','http://127.0.0.1:'+comic+'/'));}
  if(req.method!=='POST'||req.headers['x-local-control']!==nonce||req.headers.origin&&req.headers.origin!=='http://'+req.headers.host)return send(403,{error:'仅允许本机版本管理页操作'});
  if(url.pathname==='/api/check'){await Promise.all([refresh(),checkReadiness()]);return send(200,{message:error||'版本与任务检查完成',readiness});}
  if(url.pathname==='/api/apply')return applyUpdate(send);
  if(url.pathname==='/api/stop'){await stopManaged(children);send(200,{message:'本机工具已安全停止'});clearInterval(timer);clearInterval(presenceTimer);server.close();setTimeout(()=>process.exit(0),300);return;}
  send(404,{error:'接口不存在'});
 }catch(e){send(500,{error:e.message});}});
 let timer,presenceTimer;try{await startServices();await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(control,'127.0.0.1',resolve);});await receiver.confirmRestart();void refresh();void heartbeat();presenceTimer=setInterval(()=>{void heartbeat();void resumeQueued();},15000);timer=setInterval(()=>void refresh(),30000);console.log('漫画工具：http://127.0.0.1:'+comic+'/');console.log('版本与接入：http://127.0.0.1:'+control+'/');if(!args.includes('--no-browser'))spawn('cmd.exe',['/c','start','','http://127.0.0.1:'+comic+'/'],{windowsHide:true,stdio:'ignore'});
 }catch(e){await stopManaged(children).catch(()=>{});throw e;}
 const close=async()=>{await stopManaged(children);clearInterval(timer);clearInterval(presenceTimer);server.close();};const {installShutdown}=await import('./ipc.mjs');installShutdown({busy:async()=>{for(const item of children.filter(i=>i.child.exitCode===null&&!i.child.signalCode)){const s=await childRequest(item.child,'distribution-status');if(s.busy)return true;}return false;},close});
 for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>void close().then(()=>process.exit(0)).catch(e=>console.error(e.message)));
 return {server,children,status,close};
}
