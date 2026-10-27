import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
export async function ensureLocalAssetCenter({root,env}){
 if(env.COMIC_ASSET_CENTER_AUTOSTART==='0')return;
 const candidates=[env.COMIC_ASSET_CENTER_ROOT,path.resolve(root,'../共享资产中心'),path.resolve(root,'../../../共享资产中心')].filter(Boolean);
 const centerRoot=candidates.find(value=>fs.existsSync(path.join(value,'server.mjs'))&&fs.existsSync(path.join(value,'lib/local-pairing.mjs')));
 if(!centerRoot)return;
 const port=Number(env.ASSET_CENTER_PORT||19080),url='http://127.0.0.1:'+port,centerData=path.resolve(env.ASSET_CENTER_DATA||path.join(centerRoot,'data'));
 const health=async()=>{try{const res=await fetch(url+'/api/health',{signal:AbortSignal.timeout(1000)});if(!res.ok)return null;const value=await res.json();if(value.application!=='comic-asset-center')throw Error('资产中心端口被其他服务占用');return value;}catch(error){if(error.message.includes('端口'))throw error;return null;}};
 let current=await health();
 if(!current){fs.mkdirSync(path.join(centerRoot,'logs'),{recursive:true});const out=fs.openSync(path.join(centerRoot,'logs/server.log'),'a');const child=spawn(env.COMIC_NODE,[path.join(centerRoot,'server.mjs')],{cwd:centerRoot,env:{...env,ASSET_CENTER_DATA:centerData},detached:true,windowsHide:true,stdio:['ignore',out,out]});child.unref();fs.closeSync(out);for(let i=0;i<60&&!current;i++){await new Promise(resolve=>setTimeout(resolve,150));current=await health();}if(!current)throw Error('资产中心启动失败，请查看中心 logs/server.log');}
 const {pairLocalWorkbench}=await import(pathToFileURL(path.join(centerRoot,'lib/local-pairing.mjs')));
 pairLocalWorkbench({centerData,workbenchData:env.COMIC_DATA_DIR,url,instanceId:current.instanceId});
 return {url,centerRoot};
}
