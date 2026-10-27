import './portable-env.mjs';import fs from 'node:fs';import path from 'node:path';
const {installShutdown}=await import('./distribution/ipc.mjs');installShutdown();
const file=path.join(process.env.ASSET_STUDIO_DATA_DIR,'asset-studio.json');
if(!fs.existsSync(file)){const response=await fetch(process.env.ASSET_EDITOR+'/api/projects',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:'资产生成 · 内部工作区'})});if(!response.ok)throw Error('无法初始化空白资产生成工作区：'+response.status);const project=await response.json();fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify({projectId:project.id,title:project.title}));}
await import('./asset-studio/app/roles/assets.mjs');
