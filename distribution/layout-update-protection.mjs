import fs from 'node:fs';import path from 'node:path';import {createHash,randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {mergeText} from './layout-safe-merge.mjs';
const STATE='runtime-data/distribution/local-fixes/layout-ownership.local.json',DIR='runtime-data/distribution/local-fixes/layout-update-transactions',ACTIVE=DIR+'/active.json';
const sha=b=>createHash('sha256').update(b).digest('hex'),read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
function safe(root,name){if(typeof name!=='string'||!name||name.includes('\\')||name.includes(':')||path.isAbsolute(name)||name.split('/').some(p=>!p||p==='.'||p==='..'))throw Error('排版保护路径无效');let current=path.resolve(root);for(const part of name.split('/')){current=path.join(current,part);if(fs.existsSync(current)&&fs.lstatSync(current).isSymbolicLink())throw Error('排版保护不写链接路径：'+name);}return current;}
const write=(root,name,value)=>{const p=safe(root,name);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p+'.layout-tmp',JSON.stringify(value,null,2));fs.renameSync(p+'.layout-tmp',p);};
function verifyOverlay(root,candidate){
 const code=name=>(candidate.get(name)||fs.readFileSync(safe(root,name))).toString('utf8'),updater=code('distribution/updates.mjs');
 if(!updater.includes('../runtime-data/distribution/local-fixes/managed-overrides.mjs')||!updater.includes('applyManagedRelease(root,bundle,options'))throw Error('新版本更新器不再提供已验证的本地保留接口，已停止');
 if(!code('distribution/manager.mjs').includes('distribution/start-layout-local.mjs')||!code('comic/server.mjs').includes('createAutoLayoutAPI'))throw Error('新版本移除了排版启动或接口挂载点，已停止');
 const roots=['comic/public/app.js','comic/public/auto-layout-ui.js','comic/public/production-workspace.js','comic/lib/auto-layout-api.mjs','comic/lib/production-package-api.mjs','distribution/manager.mjs'],files={},seen=new Set();
 function collect(name){if(seen.has(name))return;seen.add(name);const value=code(name);files[name]=value;for(const match of value.matchAll(/(?:from\s*|import\s*)['"]([^'"]+)['"]/g))if(match[1].startsWith('.'))collect(path.posix.normalize(path.posix.join(path.posix.dirname(name),match[1])));}
 roots.forEach(collect);const result=spawnSync(process.execPath,['--experimental-vm-modules',safe(root,'distribution/layout-abi-check.mjs')],{input:JSON.stringify({roots,files}),encoding:'utf8',windowsHide:true,maxBuffer:8*1024*1024,timeout:30000});if(result.status!==0)throw Error('新版本与本地排版接口不兼容，已停止：'+(result.stderr||'模块校验失败'));
}
function stateFor(root){const file=safe(root,STATE);if(!fs.existsSync(file))return null;const s=read(file);if(s.format!=='comic-layout-ownership-v2'||!Array.isArray(s.files)||new Set(s.files.map(f=>f.path)).size!==s.files.length)throw Error('排版归属登记无效');for(const row of s.files){const p=safe(root,row.path);if(!fs.existsSync(p)||sha(fs.readFileSync(p))!==row.installedHash)throw Error('排版组件有未登记的本地修改，已保留并停止升级：'+row.path);}return s;}
export function managedExtensionStatus(root){const file=safe(root,STATE);if(!fs.existsSync(file))return {enabled:false};const s=read(file);return {enabled:true,format:s.format,featureVersion:s.featureVersion,ownedFiles:s.files?.length||0,strategy:'retain-local-layout-stop-on-conflict'};}
export function recoverManagedUpdate(root){const file=safe(root,ACTIVE);if(!fs.existsSync(file))return null;const a=read(file),current=read(safe(root,'runtime-data/distribution/installed.local.json'));if(current.contentId===a.upstreamContentId&&a.after.files.every(r=>fs.existsSync(safe(root,r.path))&&sha(fs.readFileSync(safe(root,r.path)))===r.installedHash)){write(root,STATE,a.after);fs.unlinkSync(file);return {recovered:true};}if(a.before.files.every(r=>fs.existsSync(safe(root,r.path))&&sha(fs.readFileSync(safe(root,r.path)))===r.installedHash)){fs.unlinkSync(file);return {recovered:true,rolledBack:true};}throw Error('排版保护升级事务未完整结束，保留当前文件，请先恢复该事务');}
export function applyManagedRelease(root,bundle,options,handlers){
 recoverManagedUpdate(root);const state=stateFor(root);if(!state)return handlers.apply(root,bundle,options);
 const m=bundle.manifest;if(!Array.isArray(m?.files)||sha(JSON.stringify(m.files))!==m.contentId)throw Error('上游版本清单摘要无效，未应用本地保留');
 for(const row of m.files){const bytes=bundle.files.get(row.path);if(!Buffer.isBuffer(bytes)||bytes.length!==row.bytes||sha(bytes)!==row.sha256)throw Error('上游文件摘要无效：'+row.path);}
 const files=new Map(bundle.files),incoming=new Map(m.files.map(r=>[r.path,r])),after=structuredClone(state),preserved=[];
 for(const row of after.files){
  const local=fs.readFileSync(safe(root,row.path)),up=files.get(row.path);let output=local;
  if(up){
   if(sha(up)===row.installedHash)output=up;
   else if(row.upstreamHash&&sha(up)===row.upstreamHash)output=local;
   else if(row.baseText!==undefined&&/\.(?:m?js|py|css|html|md|txt)$/.test(row.path))output=Buffer.from(mergeText(row.baseText,local.toString('utf8'),up.toString('utf8'),row.path));
   else throw Error('上游与本地排版组件存在未解决冲突，保留当前版本：'+row.path);
  }else if(row.upstreamHash&&row.role==='shared')throw Error('上游删除了排版依赖的共用接口，停止升级：'+row.path);
  if(!up||!output.equals(up))preserved.push(row.path);files.set(row.path,output);row.installedHash=sha(output);
  if(up){row.upstreamHash=sha(up);if(/\.(?:m?js|py|css|html|md|txt)$/.test(row.path))row.baseText=up.toString('utf8');}else{row.upstreamHash=null;delete row.baseText;}
 }
 const rows=[...files].map(([name,bytes])=>({path:name,bytes:bytes.length,sha256:sha(bytes)})).sort((a,b)=>a.path.localeCompare(b.path,'en'));
 verifyOverlay(root,files);
 // The native updater's allowModified flag is global. Check every non-owned change before allowing the validated local overlay.
 const installed=read(safe(root,'runtime-data/distribution/installed.local.json')),previous=new Map((installed.files||[]).map(r=>[r.path,r])),owned=new Set(state.files.map(r=>r.path));
 const affected=new Set([...rows.filter(r=>!fs.existsSync(safe(root,r.path))||sha(fs.readFileSync(safe(root,r.path)))!==r.sha256).map(r=>r.path),...[...previous.keys()].filter(n=>!files.has(n)&&fs.existsSync(safe(root,n)))]);
 for(const name of affected){const file=safe(root,name),old=previous.get(name);if(!owned.has(name)&&fs.existsSync(file)&&(!old||sha(fs.readFileSync(file))!==old.sha256)&&!options?.allowModified)throw Error('非排版代码有本地修改，已保留并停止：'+name);}
 for(const row of state.files)if(!fs.existsSync(safe(root,row.path))||sha(fs.readFileSync(safe(root,row.path)))!==row.installedHash)throw Error('核对期间排版代码发生变化，停止升级：'+row.path);
 // Signature validation happened before this local-only overlay. Keep the signed upstream identity for update detection.
 const hybrid={...bundle,files,manifest:{...m,files:rows,removed:(m.removed||[]).filter(n=>!files.has(n)),localOverlay:{format:'comic-layout-local-overlay-v1',upstreamContentId:m.contentId,overlayContentId:sha(JSON.stringify(rows)),preserved}}};
 const token=randomUUID(),transaction={format:'comic-layout-update-transaction-v1',upstreamContentId:m.contentId,before:state,after,token,created:new Date().toISOString()};write(root,ACTIVE,transaction);write(root,DIR+'/'+token+'.json',transaction);
 try{const result=handlers.apply(root,hybrid,{...options,allowModified:true});write(root,STATE,after);fs.unlinkSync(safe(root,ACTIVE));return {...result,layoutPreserved:preserved.length,layoutProtectionVersion:2};}
 catch(e){if(fs.existsSync(safe(root,ACTIVE))&&state.files.every(r=>fs.existsSync(safe(root,r.path))&&sha(fs.readFileSync(safe(root,r.path)))===r.installedHash))fs.unlinkSync(safe(root,ACTIVE));throw e;}
}
export function restoreManagedBackup(root,backup,restore){const result=restore(root,backup);const file=safe(root,ACTIVE);if(fs.existsSync(file)){const a=read(file);if(a.before.files.every(r=>fs.existsSync(safe(root,r.path))&&sha(fs.readFileSync(safe(root,r.path)))===r.installedHash)){write(root,STATE,a.before);fs.unlinkSync(file);}}return result;}
