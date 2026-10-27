import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root=path.dirname(fileURLToPath(import.meta.url));
process.chdir(root);
const args=process.argv.slice(2);
const option=(name,fallback)=>{const i=args.indexOf(name);return i<0?fallback:Number(args[i+1]);};
const comic=option('--comic-port',18909),asset=option('--asset-port',8796),center=option('--center-port',8790),layout=19848;
const ports=[comic,asset,center,layout];
if(new Set(ports).size!==ports.length||ports.some(p=>!Number.isSafeInteger(p)||p<1024||p>65535))throw Error('端口无效或重复，请更换端口。');
const available=port=>new Promise(resolve=>{const server=net.createServer();server.once('error',()=>resolve(false));server.listen(port,'127.0.0.1',()=>server.close(()=>resolve(true)));});
for(const port of ports)if(!await available(port))throw Error('端口 '+port+' 已被占用；请先正常关闭占用它的程序，本启动器不会停止其他程序。');

process.env.WORKBENCH_RELEASE_DATA_ROOT||=path.join(root,'runtime-data');
process.env.ASSET_EDITOR='http://127.0.0.1:'+comic;
process.env.ASSET_STUDIO_URL='http://127.0.0.1:'+asset;
process.env.PROJECT_CENTER_URL='http://127.0.0.1:'+center;
process.env.AUTO_LAYOUT_PORT=String(layout);
process.env.COMIC_TEAM_AUTO_SYNC='0';
process.env.COMIC_PROJECT_SYNC='1';
await import('./portable-env.mjs');
const children=[];
function launch(name,file,argv=[]){
 const child=spawn(process.execPath,[path.join(root,file),...argv],{cwd:root,env:process.env,windowsHide:true,stdio:['ignore','inherit','inherit','ipc']});
 children.push({name,child});return child;
}
async function ready(child,port,route){
 for(let i=0;i<150;i++){
  if(child.exitCode!==null)throw Error('服务提前退出，请查看上面的错误。端口 '+port);
  try{const r=await fetch('http://127.0.0.1:'+port+route,{signal:AbortSignal.timeout(800)});if(r.ok)return;}catch{}
  await new Promise(r=>setTimeout(r,200));
 }
 throw Error('服务未就绪：'+port+'。');
}
async function stop(){
 const {stopManaged}=await import('./distribution/manager.mjs');
 await stopManaged(children);
}
try{
 const config=await import('./workbench/server/config.mjs');
 await config.createConfig().update({port:center,bindHost:'127.0.0.1',scene:{port:center+101,codexPath:process.env.COMIC_CODEX_BIN||''},workshop:{port:center+102,pythonPath:process.env.COMIC_PYTHON_BIN,maxConcurrentJobs:2},intake:{maxConcurrentJobs:2}});
 let child=launch('auto-layout','distribution/start-layout-local.mjs');await ready(child,layout,'/api/integration/status');
 child=launch('comic','start-comic-local.mjs',['--port',String(comic)]);await ready(child,comic,'/api/health');
 child=launch('assets','start-assets-local.mjs',['--port',String(asset)]);await ready(child,asset,'/api/health');
 child=launch('center','start-center-local.mjs',['--port',String(center),'--host','127.0.0.1']);await ready(child,center,'/api/v1/center/status');
 console.log('\n漫画工作台：http://127.0.0.1:'+comic+'/');
 console.log('资产工作室：http://127.0.0.1:'+asset+'/');
 console.log('使用本机墨库和生图账号登录；按 Ctrl+C 安全退出。');
 if(!args.includes('--no-browser'))spawn('cmd.exe',['/c','start','','http://127.0.0.1:'+comic+'/'],{windowsHide:true,stdio:'ignore'});
}catch(error){console.error(error.message);await stop().catch(e=>console.error('服务未能全部退出：'+e.message));process.exit(1);}
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>void stop().then(()=>process.exit(0)).catch(e=>console.error('有任务未结束，继续运行：'+e.message)));
if(process.send)process.on('message',message=>{if(message?.type==='test-stop')void stop().then(()=>process.send?.({type:'test-stopped'},()=>process.exit(0))).catch(e=>process.send?.({type:'test-stop-error',error:e.message}));});
