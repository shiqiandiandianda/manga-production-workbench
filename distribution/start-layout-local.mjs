import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import {spawn,spawnSync} from 'node:child_process';
import {bootstrapAutoLayout} from './auto-layout-bootstrap.mjs';import {installShutdown} from './ipc.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),port=Number(process.env.AUTO_LAYOUT_PORT||19848),dataRoot=path.join(process.env.WORKBENCH_RELEASE_DATA_ROOT||path.join(root,'runtime-data'),'auto-layout'),adopt=process.argv.includes('--adopt');
bootstrapAutoLayout(root,{dataRoot});
const python=process.env.COMIC_PYTHON_BIN||path.join(root,'runtime/python/python.exe'),directory=path.join(root,'auto-layout/learning-workbench');
if(!fs.existsSync(python))throw Error('排版服务缺少本机 Python 运行环境，请先运行安装并接入');
const health=async()=>{const r=await fetch('http://127.0.0.1:'+port+'/api/health',{signal:AbortSignal.timeout(2000)});if(!r.ok)throw Error('自动排版服务未就绪');const s=await r.json();if(s.integrationVersion!==1||path.resolve(s.root||'')!==directory)throw Error('排版后台身份不匹配');return s;};
let child;
if(adopt){await health();console.log('接管同目录已有排版后台的状态检查，运行中的任务继续。');}else{
 child=spawn(python,['-u',path.join(directory,'integration_server.py'),'--port',String(port)],{cwd:directory,windowsHide:true,env:{...process.env,PYTHONUTF8:'1',PYTHONDONTWRITEBYTECODE:'1',PYTHONPATH:[path.join(root,'auto-layout/vendor'),process.env.PYTHONPATH,path.join(root,'.runtime/image-tools/python/Lib/site-packages'),path.join(root,'.runtime/image-tools/extras')].filter(Boolean).join(path.delimiter),AUTO_LAYOUT_EDITOR_ORIGIN:process.env.ASSET_EDITOR||'http://127.0.0.1:18909',AUTO_LAYOUT_DATA_DIR:path.join(dataRoot,'learning-workbench/data'),AUTO_LAYOUT_LIBRARY_DIR:path.join(dataRoot,'library'),AUTO_LAYOUT_ENGINE_DATA_DIR:path.join(dataRoot,'engine/data'),CODEX_BIN:process.env.COMIC_CODEX_BIN||process.env.CODEX_BIN||''},stdio:['ignore','inherit','inherit']});
 child.on('error',e=>{console.error(e.message);process.exit(1);});child.on('exit',code=>process.exit(code||0));
}
const exited=()=>child&&(child.exitCode!==null||child.signalCode),busy=async()=>exited()?false:!!(await health()).busy;
async function close(){
 if(exited())return;let current;try{current=await health();}catch(e){if(adopt&&e.cause?.code==='ECONNREFUSED')return;throw e;}if(current.busy)throw Error('本机排版任务尚未结束，后台继续运行');
 if(child){await new Promise(resolve=>{child.once('exit',resolve);child.kill();});return;}
 const pid=current.pid;if(!Number.isSafeInteger(pid)||pid<=0)throw Error('排版进程身份无效');
 if(process.platform==='win32'){
  const result=spawnSync('powershell.exe',['-NoProfile','-Command','[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()\nGet-CimInstance Win32_Process -Filter "ProcessId='+pid+'" | Select-Object ProcessId,ExecutablePath,CommandLine | ConvertTo-Json -Compress'],{windowsHide:true,encoding:'utf8'});if(result.status!==0)throw Error('无法核对排版进程');const processInfo=JSON.parse(result.stdout||'null');if(!processInfo)return;
  if(path.resolve(processInfo.ExecutablePath||'').toLowerCase()!==path.resolve(python).toLowerCase()||!processInfo.CommandLine?.includes(path.join(directory,'integration_server.py')))throw Error('排版进程与当前目录不一致，未停止其他工具');
 }else throw Error('当前系统不支持接管已有排版进程，请先正常退出原启动器');
 process.kill(pid);
}
installShutdown({busy,details:async()=>await busy()?[{target:'排版或学习任务',status:'处理中',message:'自动排版后台正在处理本机任务；原任务继续运行，完成后再启用主机版本。'}]:[],close});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>void busy().then(b=>{if(b)throw Error('本机排版任务尚未结束');return close();}).catch(e=>console.error(e.message)));
