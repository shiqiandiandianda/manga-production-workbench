import {IMAGE_CONCURRENCY} from '../src/lib/image-policy.ts';
import {mkdir,readFile,writeFile,rename,copyFile} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
export async function readJson(file,fallback){try{return JSON.parse((await readFile(file,'utf8')).replace(/^\uFEFF/,''));}catch(e){if(e.code==='ENOENT')return fallback;throw new Error('本地文件读取失败：'+path.basename(file)+'。请检查本地备份。');}}
export async function replaceWithRetry(source,target,move=rename){for(let attempt=0;;attempt++){try{return await move(source,target);}catch(error){if(!['EPERM','EBUSY','EACCES'].includes(error.code)||attempt>=5)throw error;await new Promise(resolve=>setTimeout(resolve,20*2**attempt));}}}
export async function atomicJson(file,value,backup=false){await mkdir(path.dirname(file),{recursive:true});const temp=file+'.'+randomUUID()+'.tmp';await writeFile(temp,JSON.stringify(value),{mode:0o600});if(backup)await copyFile(file,file+'.bak').catch(e=>{if(e.code!=='ENOENT')throw new Error('本地备份写入失败。');});await replaceWithRetry(temp,file);}
export function projectRevision(project){const {_revision,...content}=project;return createHash('sha256').update(JSON.stringify(content)).digest('hex');}
export function localStore(dataDir){let chain=Promise.resolve();let corrupt=false;const file=path.join(dataDir,'project.json');return {
  async load(){try{const project=await readJson(file,null);return project?{...project,_revision:projectRevision(project)}:null;}catch(e){corrupt=true;throw e;}},
  async save(project,{requireRevision=false}={}){
    if(corrupt)throw new Error('原项目文件损坏，已停止写入。请从 data/project.json.bak 恢复。');
    const snapshot=structuredClone(project);const write=chain.catch(()=>{}).then(async()=>{
      const previous=await readJson(file,null);
      if(previous?.id===snapshot.id&&(requireRevision||snapshot._revision)&&snapshot._revision!==projectRevision(previous))throw Object.assign(Error('项目已被后台或其他标签页更新，本次保存没有覆盖新数据。请刷新页面后重试。'),{status:409,code:'project_conflict'});
      const {_revision,...content}=snapshot;await atomicJson(file,content,true);return projectRevision(content);
    });chain=write;return await write;
  },async flush(){await chain.catch(()=>{});}
};}
export function imageLimiter(dataDir){let leases;let initializing;let chain=Promise.resolve();const file=path.join(dataDir,'image-leases.json');async function ready(){initializing||=(async()=>{const saved=await readJson(file,[]);if(!Array.isArray(saved))throw new Error('本地出图队列记录无法读取。');leases=new Map(saved.map(x=>[x.id,x.expiresAt]));})();await initializing;}async function persist(){const snapshot=[...leases].map(([id,expiresAt])=>({id,expiresAt}));const write=chain.catch(()=>{}).then(()=>atomicJson(file,snapshot));chain=write;await write;}return {async acquire(){await ready();const now=Date.now();for(const [id,end]of leases)if(end<=now)leases.delete(id);if(leases.size>=IMAGE_CONCURRENCY)throw Object.assign(new Error('已有八张图片正在生成。请等待任务结束后继续。'),{status:409,code:'image_queue_full'});const id=randomUUID();leases.set(id,now+30*60*1000);await persist();return id;},async release(id){await ready();leases.delete(id);await persist();},async count(){await ready();return [...leases.values()].filter(end=>end>Date.now()).length;}};}
