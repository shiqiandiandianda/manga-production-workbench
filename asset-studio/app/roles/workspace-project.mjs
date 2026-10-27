import fs from 'node:fs';import path from 'node:path';
import {writeFileAtomicSync} from '../../../comic/lib/durable-files.mjs';
// Rebuild a missing execution workspace only for an explicit new submission.
// Never restore a trashed user project or retry an existing generation record.
export function createWorkspaceProject({studioFile,editorJson}){
 let pending;
 return {ensure(){if(pending)return pending;pending=(async()=>{let config={};try{config=JSON.parse(fs.readFileSync(studioFile,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
  if(config.projectId)try{const p=await editorJson('/api/projects/'+config.projectId);return p.id;}catch(e){if(e.status!==404)throw e;}
  const p=await editorJson('/api/internal/asset-workspace',{method:'POST',body:{purpose:'asset-generation'}});if(!/^project_[a-f0-9-]{36}$/u.test(p.id||''))throw Error('内部资产工作区建立失败，请检查漫画编辑器连接');
  fs.mkdirSync(path.dirname(studioFile),{recursive:true});writeFileAtomicSync(studioFile,JSON.stringify({...config,projectId:p.id,title:p.title}));return p.id;
 })().finally(()=>{pending=null;});return pending;}};
}
