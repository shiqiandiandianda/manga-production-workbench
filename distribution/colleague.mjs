import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import {fileURLToPath,pathToFileURL} from 'node:url';import {randomBytes} from 'node:crypto';import {createRequire} from 'node:module';import {spawnSync} from 'node:child_process';
import {writeJson,validateEnvelope,checkUpdate,stageUpdate,decodeRelease,applyRelease} from './updates.mjs';import {safeTarget,digest} from './code-policy.mjs';
import {localPrimaryChannel} from './primary-channel.mjs';
export function readChannel(root){const channel=JSON.parse(fs.readFileSync(path.join(root,'distribution/channel.json')));if(channel.format!=='comic-team-channel-v1'||!channel.publicKey||!/^https?:\/\//.test(channel.masterUrl))throw Error('接入发布频道无效');return localPrimaryChannel(root,channel);}
export function doctor(root){
 const required=['runtime/node/node.exe','runtime/python/python.exe','runtime/codex/codex.exe','.runtime/image-tools/python/python.exe','.runtime/image-tools/AI工具/models/u2net.onnx','.runtime/image-tools/AI工具/models/lama_fp32.onnx','.runtime/image-tools/AI工具/realesrgan/realesrgan-ncnn-vulkan.exe','.runtime/image-tools/AI工具/realesrgan/models/realesr-animevideov3-x2.param'];for(const file of required)if(!fs.existsSync(path.join(root,file)))throw Error('缺少运行环境：'+file);
 const py=spawnSync(path.join(root,'.runtime/image-tools/python/python.exe'),['-B','-c','import sys;sys.path.insert(0,sys.argv[1]);import PIL,numpy,onnxruntime,cv2;print(PIL.__version__,numpy.__version__,onnxruntime.__version__,cv2.__version__)',path.join(root,'.runtime/image-tools/extras')],{encoding:'utf8',windowsHide:true});if(py.status!==0)throw Error('本地模型 Python 依赖未就绪：'+py.stderr.slice(-300));
 const canvas=createRequire(import.meta.url)(path.join(root,'runtime/node/node_modules/@napi-rs/canvas'));let fonts=0;for(const folder of ['comic/public/fonts','comic/repair-engine/public/fonts'])for(const name of fs.readdirSync(path.join(root,folder)).filter(n=>/\.(otf|ttf|ttc|woff2?)$/i.test(n))){if(!canvas.GlobalFonts.registerFromPath(path.join(root,folder,name)))throw Error('字体无法加载：'+name);fonts++;}if(fonts<2)throw Error('缺少工具字体');return {ok:true,localModels:['U²-Net','LaMa ONNX FP32','Real-ESRGAN NCNN-Vulkan'],fontsLoaded:fonts,python:py.stdout.trim()};
}
export function registerBaseline(root,channel){
 const installed=path.join(root,'runtime-data/distribution/installed.local.json');if(fs.existsSync(installed))return;
 const envelope=JSON.parse(fs.readFileSync(path.join(root,'RELEASE.json'))),manifest=validateEnvelope(envelope,channel.publicKey);
 for(const row of manifest.files){const file=safeTarget(root,row.path);if(!fs.existsSync(file)||digest(fs.readFileSync(file))!==row.sha256)throw Error('初始代码与主版本不一致：'+row.path);}writeJson(installed,manifest);
}
export async function join(root,{channel=readChannel(root),localComic='http://127.0.0.1:18909',localWorkbench='http://127.0.0.1:8790'}={}){
 const folder=path.join(root,'runtime-data/team'),identityFile=path.join(folder,'identity.local.json');fs.mkdirSync(folder,{recursive:true});let identity=fs.existsSync(identityFile)?JSON.parse(fs.readFileSync(identityFile)):{machineId:os.hostname(),registrationKey:randomBytes(32).toString('hex')};writeJson(identityFile,identity);
 const response=await fetch(channel.masterUrl+'/api/join',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...identity,name:os.hostname(),enrollmentCode:channel.enrollmentCode}),signal:AbortSignal.timeout(30000)}),result=await response.json();if(!response.ok)throw Error(result.error||'自动接入未完成');
 const advertised=JSON.parse(fs.readFileSync(path.join(root,'distribution/channel.json'))),primary=localPrimaryChannel(root,advertised)!==advertised;
 const localize=address=>{if(!primary||!address)return address;const value=new URL(address);if(value.hostname!==new URL(advertised.masterUrl).hostname)return address;value.hostname='127.0.0.1';return value.origin+value.pathname.replace(/\/$/,'');};
 result.connection.hub=localize(result.connection.hub);if(result.canvas)result.canvas.hubUrl=localize(result.canvas.hubUrl);
 const connectionFile=path.join(folder,'接入配置.local.json'),old=fs.existsSync(connectionFile)?JSON.parse(fs.readFileSync(connectionFile)):{};writeJson(connectionFile,{...result.connection,localComic,localWorkbench,paused:old.paused===true});
 if(result.canvas){const {pairNode}=await import(pathToFileURL(path.join(root,'协作/lib/node-core.mjs')));const nodeFile=path.join(folder,'canvas-node.local.json'),existing=fs.existsSync(nodeFile)?JSON.parse(fs.readFileSync(nodeFile)):null;
  if(!existing||existing.hubUrl!==result.canvas.hubUrl){const paired=await pairNode({hubUrl:result.canvas.hubUrl,code:result.canvas.pairingCode,name:os.hostname()+' 漫画节点'});writeJson(nodeFile,{...paired,nodeName:os.hostname(),dataDir:path.join(folder,'canvas-node-data'),localComic:{origin:localComic,provider:'codex'},maxConcurrency:1});}
  writeJson(path.join(folder,'canvas-pair.local.json'),result.canvas);
 }
 return {ok:true,projects:result.connection.projectIds.length,projectCenter:result.connection.hub,canvas:!!result.canvas};
}
export async function connectCanvas(root,comic){
 const file=path.join(root,'runtime-data/team/canvas-pair.local.json');if(!fs.existsSync(file))return;const pair=JSON.parse(fs.readFileSync(file));const status=await fetch(comic+'/api/collab/status').then(r=>r.json());if(status.configured||status.config?.configured)return;const response=await fetch(comic+'/api/collab/pair',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...pair,clientName:os.hostname()})});if(!response.ok)throw Error('画格协作自动配对失败：'+response.status);
}
async function main(){const args=process.argv.slice(2),index=args.indexOf('--root'),root=path.resolve(index<0?path.join(path.dirname(fileURLToPath(import.meta.url)),'..'):args[index+1]),command=args[0]||'status',channel=readChannel(root);
 if(command==='setup'){registerBaseline(root,channel);console.log(JSON.stringify(doctor(root)));if(!args.includes('--skip-join'))console.log(JSON.stringify(await join(root)));return;}
 if(command==='check'){const update=await checkUpdate(root,channel);if(update.available){const staged=await stageUpdate(root,channel,update);console.log(JSON.stringify({available:true,version:update.manifest.version,pending:staged.file,message:'已接收升级包。关闭工具后运行“检查并升级.cmd”，或在运行窗口打开版本管理。'}));}else console.log('当前已是主版本最新代码');return;}
 if(command==='apply'){
  try{const res=await fetch('http://127.0.0.1:18913/api/status',{signal:AbortSignal.timeout(1000)});if(res.ok){console.log('工具正在运行，请打开 http://127.0.0.1:18913/ 点击“安全升级并重启”。');return;}}catch{}
  for(const [port,route]of [[18909,'/api/health'],[8796,'/api/health'],[8790,'/api/v1/center/status']]){try{const r=await fetch('http://127.0.0.1:'+port+route,{signal:AbortSignal.timeout(1000)});if(r.ok)throw Object.assign(Error('检测到工具服务仍在运行；先正常关闭服务，未替换代码。'),{active:true});}catch(e){if(e.active)throw e;}}
  const update=await checkUpdate(root,channel);if(!update.available)return console.log('当前已是主版本最新代码');const staged=await stageUpdate(root,channel,update);console.log(JSON.stringify(applyRelease(root,decodeRelease(fs.readFileSync(staged.file),channel.publicKey))));return;
 }
 console.log(JSON.stringify({channel:channel.masterUrl,...doctor(root)}));
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)await main();
