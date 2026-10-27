import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';import {writeJson} from './updates.mjs';
const check=(ok,message,status=400)=>{if(!ok)throw Object.assign(Error(message),{status});};
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
export function createAssetCorrections({dataDir,clock=()=>Date.now()}){
 const file=path.join(dataDir,'asset-corrections.local.json');let entries=[];if(fs.existsSync(file)){entries=JSON.parse(fs.readFileSync(file));check(Array.isArray(entries),'团队修正记录损坏');}
 const validText=(s,max)=>typeof s==='string'&&s.trim()&&s.length<=max&&!/[\u0000-\u001f]/u.test(s);
 return {list(workId){check(/^[a-f0-9-]{36}$/i.test(workId||''),'请明确选择所属墨库作品');return entries.filter(e=>e.workId===workId).slice(-1000).reverse();},publish(input,actor){
  check(/^[a-f0-9-]{36}$/i.test(input.workId||''),'请明确选择所属墨库作品');check(validText(input.name,100)&&validText(input.fromState,120)&&validText(input.state,120)&&input.fromState.trim()!==input.state.trim()&&validText(input.reason,1000),'请填写人物、新旧服装及修正原因');check(/^[a-f0-9-]{36}$/i.test(input.requestId||''),'发布请求编号无效');check(actor?.id&&validText(actor.name,100),'请先设置团队姓名',422);
  const fields={workId:input.workId.toLowerCase(),name:input.name.trim(),fromState:input.fromState.trim(),state:input.state.trim(),reason:input.reason.trim()},key=hash([fields.workId,fields.name,fields.fromState]),fingerprint=hash(fields),previous=entries.filter(e=>e.key===key).at(-1),retry=entries.find(e=>e.authorId===actor.id&&e.requestId===input.requestId);
  if(retry){check(retry.fingerprint===fingerprint,'同一发布请求的内容已改变',409);return retry;}
  check((input.previousVersion||0)===(previous?.version||0),'团队已有新版修正，请刷新后核对',409);
  if(previous?.fingerprint===fingerprint)return previous;
  const entry={...fields,key,version:(previous?.version||0)+1,authorId:actor.id,author:actor.name,createdAt:new Date(clock()).toISOString(),requestId:input.requestId,fingerprint};entry.id=hash(entry);
  const next=[...entries,entry];check(next.length<=100000,'团队修正记录过多，请管理员归档');writeJson(file,next);entries=next;return entry;
 }};
}
