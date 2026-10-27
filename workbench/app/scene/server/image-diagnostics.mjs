import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
export function redactDiagnostic(value){return String(value||'').replace(/Bearer\s+[^\s"',;]+/gi,'Bearer [redacted]').replace(/sk-[\w-]+/g,'[redacted]').replace(/eyJ[\w-]{8,}\.[\w-]+\.[\w-]+/g,'[redacted]').replace(/((?:api[_-]?key|access_token|refresh_token|id_token|authorization)"?\s*[:=]\s*["']?)[^\s"',;]+/gi,'$1[redacted]').replace(/https?:\/\/[^\s"'<>]+/g,url=>url.replace(/\/\/[^/@]+@/,'//[redacted]@').split('?')[0]).slice(0,8000);}
export async function saveImageDiagnostic(dataDir,details){const id=randomUUID();await mkdir(path.join(dataDir,'diagnostics'),{recursive:true});await writeFile(path.join(dataDir,'diagnostics',id+'.json'),JSON.stringify({...details,id,stderr:redactDiagnostic(details.stderr),events:(details.events||[]).map(event=>({type:event.type,message:redactDiagnostic(event.message)}))},null,2));return id;}
