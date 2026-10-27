import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomBytes} from 'node:crypto';
import {CenterStore} from './lib/store.mjs';
import {check,json,body,hash,text} from './lib/common.mjs';
import {inspectImage,decodeImage} from './lib/images.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
const hosts=()=>new Set(['localhost','127.0.0.1','::1',os.hostname().toLowerCase(),...Object.values(os.networkInterfaces()).flat().filter(Boolean).map(item=>item.address.toLowerCase()),...(process.env.ASSET_CENTER_ALLOWED_HOSTS||'').split(',').filter(Boolean)]);
export function createCenter({dataDir=path.join(root,'data'),clock=Date.now}={}){
 const store=new CenterStore(dataDir,{clock}),failures=new Map();let uploads=0;
 const server=http.createServer(async(request,response)=>{
  try{
   const host=request.headers.host||'';check(host&&!/[\s/@\\]/.test(host),'Host无效',403);const url=new URL(request.url,'http://'+host);check(hosts().has(url.hostname.replace(/^\[|\]$/g,'').toLowerCase()),'此主机名未授权',403);
   const origin=request.headers.origin;check(!origin||origin===(process.env.ASSET_CENTER_ORIGIN||'http://'+host),'不接受跨站请求',403);const pathname=decodeURIComponent(url.pathname),method=request.method;
   if(pathname==='/api/health'&&method==='GET')return json(response,200,{application:'comic-asset-center',version:'1.0.0',protocol:'comic-asset-center-v1',instanceId:store.instanceId});
   if(!pathname.startsWith('/api/v1/')){
    const name=pathname==='/'?'index.html':pathname.slice(1);check(method==='GET'&&(/^(index\.html|center\.js|center\.css|openapi\.json)$/.test(name)||/^icons\/[a-z0-9-]+\.svg$/.test(name)),'页面不存在',404);const file=path.join(root,'public',name);check(fs.existsSync(file),'页面不存在',404);
    response.writeHead(200,{'Content-Type':{'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml'}[path.extname(file)],'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"});return fs.createReadStream(file).pipe(response);
   }
   const remote=request.socket.remoteAddress||'',failed=failures.get(remote);if(failed&&failed.until>Date.now()&&failed.count>=20)check(false,'认证失败次数过多，请一分钟后再试',429);
   let actor;try{actor=store.auth((request.headers.authorization||'').replace(/^Bearer /,''));}catch(error){const state=failed?.until>Date.now()?failed:{count:0,until:Date.now()+60000};state.count++;failures.set(remote,state);if(failures.size>2000)for(const [key,value] of failures)if(value.until<Date.now())failures.delete(key);throw error;}
   const admin=()=>check(actor.role==='admin','此操作需要管理员权限',403),worker=()=>check(['worker','admin'].includes(actor.role),'此操作需要接单器权限',403),client=()=>check(['client','admin'].includes(actor.role),'此操作需要工作台权限',403);
   if(pathname==='/api/v1/status'&&method==='GET'){const limit=Math.min(500,Math.max(1,Number(url.searchParams.get('limit'))||200)),offset=Math.max(0,Math.floor(Number(url.searchParams.get('offset'))||0));return json(response,200,{...store.snapshot(actor,{workId:url.searchParams.get('workId'),status:url.searchParams.get('status'),limit,offset}),role:actor.role,label:actor.label});}
   if(pathname==='/api/v1/requirements/batches'&&method==='POST'){client();return json(response,201,store.submit(actor,await body(request,12*1024*1024)));}
   if(pathname==='/api/v1/tasks/claim'&&method==='POST'){worker();return json(response,200,store.claim(actor,await body(request)));}
   const taskRoute=/^\/api\/v1\/tasks\/(task_[a-f0-9-]{36})(?:\/(heartbeat|result|fail|control))?$/.exec(pathname);
   if(taskRoute){const task=store.task(taskRoute[1]);store.allow(actor,task.workId);if(method==='GET'&&!taskRoute[2])return json(response,200,{task});check(method==='POST','不支持此方法',405);
    if(taskRoute[2]==='heartbeat'){worker();return json(response,200,store.heartbeat(actor,task.id,await body(request)));}
    if(taskRoute[2]==='control'){client();return json(response,200,store.control(actor,task.id,await body(request)));}
    if(taskRoute[2]==='fail'){worker();const input=await body(request);store.lease(actor,task.id,input.leaseToken);const status=input.uncertain===true?'uncertain':'failed';store.db.prepare('UPDATE tasks SET status=?,message=?,ended=?,updated=? WHERE id=?').run(status,text(input.message||'生成失败',500),status==='failed'?new Date().toISOString():null,new Date().toISOString(),task.id);store.event(actor,'task.'+status,task.id);return json(response,200,store.task(task.id));}
    if(taskRoute[2]==='result'){
     worker();check(uploads<2,'图片上传繁忙，请稍后重试',429);uploads++;
     try{const input=await body(request,43*1024*1024),bytes=decodeImage(input.imageBase64),info=await inspectImage(bytes);const old=store.db.prepare('SELECT id FROM versions WHERE asset_id=? AND request_key=?').get(task.assetId,input.idempotencyKey||'');if(!old)store.lease(actor,task.id,input.leaseToken);const file=path.join(store.directory,'blobs',info.sha256+info.extension);if(!fs.existsSync(file))fs.writeFileSync(file,bytes,{flag:'wx'});return json(response,201,store.commitImage(actor,task.id,input,info));}finally{uploads--;}
    }
   }
   const versionInfo=/^\/api\/v1\/versions\/(version_[a-f0-9-]{36})$/.exec(pathname);if(versionInfo&&method==='GET'){const version=store.version(versionInfo[1]);store.allow(actor,version.workId);check(['admin','client'].includes(actor.role)||version.status==='approved'||actor.role==='worker'&&version.metadata.actorId===actor.id,'此版本尚未确认',403);return json(response,200,version);}
   const versionRoute=/^\/api\/v1\/versions\/(version_[a-f0-9-]{36})\/(image|review)$/.exec(pathname);
   if(versionRoute){const version=store.version(versionRoute[1]);store.allow(actor,version.workId);if(versionRoute[2]==='review'&&method==='POST'){client();return json(response,200,store.review(actor,version.id,await body(request)));}
    if(versionRoute[2]==='image'&&method==='GET'){check(['admin','client'].includes(actor.role)||version.status==='approved'||actor.role==='worker'&&version.metadata.actorId===actor.id,'此版本尚未确认',403);const file=path.join(store.directory,'blobs',version.sha256+version.extension);check(fs.existsSync(file),'图片文件缺失，请从备份恢复',404);response.writeHead(200,{'Content-Type':version.mime,'Content-Length':version.size,'Cache-Control':'private, no-cache','ETag':'"'+version.sha256+'"','X-Content-Type-Options':'nosniff'});return fs.createReadStream(file).pipe(response);}
   }
   const versionsRoute=/^\/api\/v1\/assets\/(asset_[a-f0-9-]{36})\/versions$/.exec(pathname);
   if(versionsRoute&&method==='GET'){const asset=store.asset(versionsRoute[1]);store.allow(actor,asset.workId);const versions=store.db.prepare("SELECT id FROM versions WHERE asset_id=? AND (? IN ('admin','client') OR status='approved' OR json_extract(metadata,'$.actorId')=?) ORDER BY number DESC").all(asset.id,actor.role,actor.id).map(row=>store.version(row.id));return json(response,200,{asset,versions});}
   if(pathname==='/api/v1/keys'){
    admin();if(method==='GET')return json(response,200,{keys:store.db.prepare('SELECT id,role,label,work_id AS workId,enabled,created FROM keys ORDER BY created').all()});
    if(method==='POST'){const input=await body(request),created=store.createKey(input.role,input.label,input.workId||null);store.event(actor,'key.create',created.id);return json(response,201,created);}
   }
   const keyRoute=/^\/api\/v1\/keys\/(key_[a-f0-9-]{36})$/.exec(pathname);if(keyRoute&&method==='DELETE'){admin();check(keyRoute[1]!==actor.id,'不能撤销当前登录令牌');check(store.db.prepare('SELECT role FROM keys WHERE id=? AND enabled=1').get(keyRoute[1]),'令牌不存在',404);store.db.prepare('UPDATE keys SET enabled=0 WHERE id=?').run(keyRoute[1]);store.event(actor,'key.revoke',keyRoute[1]);return json(response,200,{ok:true});}
   if(pathname==='/api/v1/backup'&&method==='POST'){admin();return json(response,201,store.backup());}
   if(pathname==='/api/v1/events'&&method==='GET'){admin();return json(response,200,{events:store.db.prepare('SELECT seq,actor,action,target,detail,created FROM events ORDER BY seq DESC LIMIT 200').all()});}
   json(response,404,{error:'接口不存在'});
  }catch(error){if(!response.headersSent)json(response,error.status||500,{error:error.status?error.message:'资产中心内部错误，请查看本机日志'});else response.destroy();}
 });
 server.requestTimeout=90000;server.headersTimeout=10000;server.keepAliveTimeout=5000;
 return {server,store,close(){return new Promise(resolve=>server.close(()=>{store.close();resolve();}));}};
}
async function main(){
 const port=Number(process.env.ASSET_CENTER_PORT||19080),lan=process.argv.includes('--lan'),dataDir=path.resolve(process.env.ASSET_CENTER_DATA||path.join(root,'data'));check(Number.isInteger(port)&&port>=1024&&port<=65535,'端口无效');
 const center=createCenter({dataDir});await new Promise((resolve,reject)=>{center.server.once('error',reject);center.server.listen(port,lan?'0.0.0.0':'127.0.0.1',resolve);});const session=randomBytes(24).toString('hex'),ownerFile=path.join(dataDir,'server.local.json'),stopFile=path.join(dataDir,'stop.local.json');fs.writeFileSync(ownerFile,JSON.stringify({pid:process.pid,session,port,lan,started:new Date().toISOString()}));
 console.log('资产中心：http://127.0.0.1:'+port);if(lan)for(const item of Object.values(os.networkInterfaces()).flat().filter(Boolean).filter(i=>i.family==='IPv4'&&!i.internal))console.log('局域网：http://'+item.address+':'+port);console.log('首次令牌文件：'+path.join(dataDir,'首次连接凭据.local.json'));
 let stopping=false;const stop=async()=>{if(stopping)return;stopping=true;clearInterval(timer);await center.close();try{if(JSON.parse(fs.readFileSync(ownerFile)).session===session)fs.unlinkSync(ownerFile);}catch{};};const timer=setInterval(()=>{try{const value=JSON.parse(fs.readFileSync(stopFile));if(value.session!==session)return;fs.unlinkSync(stopFile);void stop();}catch{}},750);process.on('SIGINT',()=>void stop());process.on('SIGTERM',()=>void stop());
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)main().catch(error=>{console.error(error.message);process.exitCode=1;});
