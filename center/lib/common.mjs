import {createHash,randomUUID,randomBytes} from 'node:crypto';
export const id=prefix=>prefix+'_'+randomUUID();
export const hash=value=>createHash('sha256').update(value).digest('hex');
export const token=()=> 'act_'+randomBytes(32).toString('hex');
export function check(ok,message,status=400){if(!ok)throw Object.assign(Error(message),{status});}
export function text(value,max=2000,{required=false}={}){check(typeof value==='string'&&value.length<=max&&(!required||value.trim()),'文字字段无效或过长');return value.trim();}
export const key=value=>String(value??'').normalize('NFKC').trim().toLowerCase().replace(/\s/gu,'');
export const now=()=>new Date().toISOString();
export function atomic(file,bytes){const temp=file+'.'+randomUUID()+'.tmp';return import('node:fs').then(({default:fs})=>{try{fs.writeFileSync(temp,bytes,{mode:0o600});fs.renameSync(temp,file);}finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}});}
export function json(response,status,value){response.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});response.end(JSON.stringify(value));}
export async function body(request,max=2*1024*1024){let size=0;const chunks=[];for await(const chunk of request){size+=chunk.length;check(size<=max,'请求超过大小限制',413);chunks.push(chunk);}try{return JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');}catch{check(false,'请求不是有效 JSON');}}
