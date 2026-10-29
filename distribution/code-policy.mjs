import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
export const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
export const COMPONENTS=['comic','asset-studio','workbench','center','协作','distribution','auto-layout'];
const skipped=new Set(['data','runtime','runtime-data','node-data','production-comic-data','production-comic-data-current','node_modules','__pycache__','.git','.codex','.runtime','verification','audit','merge-audit','release','releases','logs','cache','.cache','temp','slot','source','output','outputs','test-output','test-temp','.test-temp']);
const extensions=new Set(['.mjs','.js','.cjs','.py','.css','.html','.json','.svg','.ts','.tsx','.txt','.md','.cmd','.bat','.ps1','.map','.yml','.yaml','.ico','.png','.jpg','.jpeg','.webp']);
const roots=new Set(['portable-env.mjs','start-all.mjs','start-comic-local.mjs','start-assets-local.mjs','start-center-local.mjs','AGENTS.md','README.md','安装并接入.cmd','启动全部.cmd','检查并升级.cmd','同事Codex接入指南.md','主版本发布与升级说明.md']);
export function allowedCodePath(value){
 if(typeof value!=='string'||!value||value.includes('\\')||value.includes(':')||value.startsWith('/')||value.includes('\0'))return false;
 const parts=value.split('/');if(parts.some(p=>!p||p==='.'||p==='..'||skipped.has(p)||/^prompt-rewrite-[A-Za-z0-9]{6}$/.test(p)||/[. ]$/.test(p)))return false;
 const name=parts.at(-1);if(name.startsWith('.')||/\.local\.|\.bak(?:-|$)|\.log$|\.pyc$/i.test(name)||['auth.json','tokens.json','settings.json','assistant-token.txt','moku.json','asset-studio.json','studio.json'].includes(name))return false;
 if(!extensions.has(path.posix.extname(name).toLowerCase()))return false;
 if(parts.length===1)return roots.has(name);
 if(!COMPONENTS.includes(parts[0]))return false;
 if(parts[0]==='distribution'&&parts[1]==='portable')return false;
 if(parts.includes('fonts')&&!/\.(md|txt|css|json)$/i.test(name))return false;
 if(/\.(png|jpe?g|webp)$/i.test(name)&&!parts.some(p=>['public','web','dist'].includes(p)))return false;
 return true;
}
export function collectCode(root){
 const files=new Map(),libraryManifest=path.join(root,'auto-layout/public/bootstrap/code-library-manifest.json'),useFrozenLibrary=fs.existsSync(libraryManifest);
 function walk(dir,base){if(!fs.existsSync(dir))return;for(const item of fs.readdirSync(dir,{withFileTypes:true})){if(item.isSymbolicLink())continue;const relative=base+'/'+item.name,full=path.join(dir,item.name);if(item.isDirectory()){if(relative==='auto-layout/library'&&useFrozenLibrary)continue;if(!skipped.has(item.name))walk(full,relative);}else if(allowedCodePath(relative)&&!(item.name==='AGENTS.md'&&base==='workbench'))files.set(relative,fs.readFileSync(full));}}
 if(useFrozenLibrary){const manifest=JSON.parse(fs.readFileSync(safeTarget(root,'auto-layout/public/bootstrap/code-library-manifest.json')));if(manifest.format!=='comic-release-library-code-v1'||!Array.isArray(manifest.files)||manifest.files.length>1000)throw Error('冻结代码库清单无效');const seen=new Set();for(const row of manifest.files){if(!row.path.startsWith('auto-layout/library/')||!/^auto-layout\/public\/bootstrap\/blobs\/[a-f0-9]{64}\.(json|png|jpe?g|webp|txt|md)$/.test(row.blob)||seen.has(row.path))throw Error('冻结代码库路径无效');seen.add(row.path);safeTarget(root,row.path);const bytes=fs.readFileSync(safeTarget(root,row.blob));if(bytes.length!==row.bytes||digest(bytes)!==row.sha256)throw Error('冻结代码库摘要不匹配：'+row.path);files.set(row.path,bytes);}}
 for(const component of COMPONENTS)walk(path.join(root,component),component);
 // Source trees package their portable launchers; installed colleagues use the root copies.
 const portable=path.join(root,'distribution','portable'),launchers=fs.existsSync(portable)?portable:root;
 for(const item of fs.readdirSync(launchers,{withFileTypes:true}))if(item.isFile()&&allowedCodePath(item.name))files.set(item.name,fs.readFileSync(path.join(launchers,item.name)));
 return new Map([...files].sort(([a],[b])=>a.localeCompare(b,'en')));
}
export function safeTarget(root,relative){
 if(!allowedCodePath(relative))throw Error('非代码或越界路径：'+relative);
 const absolute=path.resolve(root,...relative.split('/'));if(!absolute.startsWith(path.resolve(root)+path.sep))throw Error('路径超出代码目录');
 let current=path.resolve(root);for(const part of relative.split('/')){current=path.join(current,part);if(fs.existsSync(current)&&fs.lstatSync(current).isSymbolicLink())throw Error('拒绝写入链接路径：'+relative);}
 return absolute;
}
