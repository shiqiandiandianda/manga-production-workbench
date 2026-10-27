// Only the local workbench launcher calls this. No credentials are printed or sent to a browser.
import fs from 'node:fs';
import path from 'node:path';
export function pairLocalWorkbench({centerData,workbenchData,url,instanceId}){
 const target=path.join(workbenchData,'asset-center.local.json');
 if(fs.existsSync(target))return false;
 const credentials=JSON.parse(fs.readFileSync(path.join(centerData,'首次连接凭据.local.json'),'utf8'));
 if(credentials.instanceId!==instanceId)throw Error('本机中心身份不一致，未自动配对');
 fs.mkdirSync(workbenchData,{recursive:true});
 fs.writeFileSync(target,JSON.stringify({version:1,url,instanceId,clientToken:credentials.client,workerToken:credentials.worker},null,2),{flag:'wx',mode:0o600});
 return true;
}
