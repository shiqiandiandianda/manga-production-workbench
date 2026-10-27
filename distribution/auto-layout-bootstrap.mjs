import fs from 'node:fs';import path from 'node:path';import {digest} from './code-policy.mjs';
function target(root,relative){
 if(typeof relative!=='string'||relative.includes('\\')||relative.includes(':')||relative.startsWith('/')||relative.split('/').some(p=>!p||p==='.'||p==='..'))throw Error('排版组件路径无效');
 const full=path.resolve(root,relative);if(!full.startsWith(path.resolve(root)+path.sep))throw Error('排版组件路径越界');
 let current=path.resolve(root);for(const part of relative.split('/')){current=path.join(current,part);if(fs.existsSync(current)&&fs.lstatSync(current).isSymbolicLink())throw Error('排版组件不使用链接路径');}return full;
}
export function bootstrapAutoLayout(root,{dataRoot=path.join(root,'runtime-data/auto-layout')}={}){
 const source=path.join(root,'auto-layout'),manifest=JSON.parse(fs.readFileSync(path.join(source,'public/bootstrap/manifest.json')));
 if(manifest.format!=='comic-layout-bootstrap-v1'||!Array.isArray(manifest.files)||manifest.files.length>4000)throw Error('排版参考清单无效');
 const checked=new Map(),rows=[],seen=new Set();for(const row of manifest.files){
  if(!/^(learning-workbench\/data|engine\/data|library)\//.test(row.path)||!/^public\/bootstrap\/blobs\/[a-f0-9]{64}\.(json|png|jpe?g|webp|txt|md)$/.test(row.blob)||seen.has(row.path))throw Error('排版参考文件路径无效');seen.add(row.path);
  const from=target(source,row.blob),to=target(dataRoot,row.path);if(!checked.has(row.blob)){const bytes=fs.readFileSync(from);if(bytes.length!==row.bytes||digest(bytes)!==row.sha256)throw Error('排版参考文件校验失败');checked.set(row.blob,bytes);}else if(checked.get(row.blob).length!==row.bytes||digest(checked.get(row.blob))!==row.sha256)throw Error('排版参考重复摘要不一致');rows.push({row,to});
 }
 let added=0;for(const {row,to}of rows){if(fs.existsSync(to))continue;fs.mkdirSync(path.dirname(to),{recursive:true});fs.writeFileSync(to,checked.get(row.blob),{flag:'wx'});added++;}
 for(const folder of ['scripts','drafts','runs','history'])fs.mkdirSync(target(dataRoot,'learning-workbench/data/'+folder),{recursive:true});
 return {dataRoot,added,files:rows.length,sourceSha256:manifest.sourceSha256};
}
