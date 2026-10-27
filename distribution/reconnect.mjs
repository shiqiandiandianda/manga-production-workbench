import fs from 'node:fs';
import path from 'node:path';
import {createHash,verify} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=(ok,message)=>{if(!ok)throw Error(message);};
const samePath=(a,b)=>path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase();
const read=file=>JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
function signed(manifest,signature,key){fail(manifest?.format==='comic-code-update-v1'&&Array.isArray(manifest.files),'修复包版本记录无效');fail(verify(null,Buffer.from(JSON.stringify(manifest)),key,Buffer.from(signature||'','base64')),'修复包签名不匹配，未修改工具');}
function endpoint(value){const url=new URL(value);fail(['http:','https:'].includes(url.protocol)&&!url.username&&!url.password,'团队地址无效');return url;}
export function validateReconnect(root,payload){
 root=fs.realpathSync(root);fail(fs.existsSync(path.join(root,'comic/server.mjs')),'所选目录不是漫画工作台');
 fail(!fs.existsSync(path.join(root,'runtime-data/distribution/master/master.local.json')),'这是主机，请勿运行同事接入修复');
 const current=read(path.join(root,'distribution/channel.json'));fail(current.publicKey,'工具尚未登记团队签名身份');signed(payload.manifest,payload.signature,current.publicKey);
 const files=[];for(const name of ['distribution/channel.json','comic/public/team-release-channel.json']){
  const row=payload.manifest.files.find(r=>r.path===name),item=payload.files?.find(r=>r.path===name);fail(row&&item,'修复包缺少团队配置');const bytes=Buffer.from(item.data,'base64');fail(bytes.length===row.bytes&&sha(bytes)===row.sha256,'团队配置摘要不符，未修改工具');files.push({path:name,bytes});
 }
 const next=JSON.parse(files[0].bytes);fail(next.publicKey===current.publicKey,'修复包属于另一支团队');endpoint(next.masterUrl);endpoint(next.collabHubUrl);endpoint(next.projectCenterUrl);return {root,current,next,files};
}
export async function repairConnection(root,payload,{request=fetch,upgrade=true,validateOnly=false,log=()=>{}}={}){
 const plan=validateReconnect(root,payload),get=async(url,options={})=>{const r=await request(url,{...options,signal:AbortSignal.timeout(options.timeout||10000)}),value=await r.json();if(!r.ok)throw Error(value.error||'HTTP '+r.status);return value;};
 const online=await get(plan.next.masterUrl+'/api/releases/latest');signed(online.manifest,online.signature,plan.current.publicKey);
 for(const file of plan.files)fail(online.manifest.files.find(r=>r.path===file.path)?.sha256===sha(file.bytes),'主机接入地址已再次更新，请重新取得修复包');
 const health=await get(plan.next.masterUrl+'/health');fail(health.application==='comic-team-publisher','新地址不是原团队的发布服务');
 let editor=null,control=null;
 for(const port of [18909,18924])try{const value=await get('http://127.0.0.1:'+port+'/api/health',{timeout:1500});if(value.codeRoot&&samePath(value.codeRoot,path.join(plan.root,'comic'))){editor={base:'http://127.0.0.1:'+port,...value};break;}}catch{}
 const controls=[editor?.teamControlUrl,'http://127.0.0.1:18913/','http://127.0.0.1:18925/'].filter(Boolean);
 for(const address of new Set(controls))try{const u=endpoint(address);if(u.hostname!=='127.0.0.1')continue;const status=await get(u.origin+'/api/status',{timeout:1500});if(status.root&&samePath(status.root,plan.root)){control={base:u.origin,status};break;}}catch{}
 fail(control?.status.role!=='publisher','当前运行的是主机，未修改同事接入配置');
 const replacements=[...plan.files],oldHosts=new Set([plan.current.masterUrl,plan.current.collabHubUrl,plan.current.projectCenterUrl].filter(Boolean).map(u=>endpoint(u).hostname));
 const retarget=(value,target)=>{if(!value||!target)return value;const u=endpoint(value);return oldHosts.has(u.hostname)?target:value;};
 const runtime=[['runtime-data/team/接入配置.local.json','hub',plan.next.projectCenterUrl],['runtime-data/team/canvas-node.local.json','hubUrl',plan.next.collabHubUrl],['runtime-data/team/canvas-pair.local.json','hubUrl',plan.next.collabHubUrl]];
 if(editor?.dataRoot)runtime.push([path.join(editor.dataRoot,'collab/client-config.json'),'hubUrl',plan.next.collabHubUrl]);
 for(const [relative,key,address]of runtime){const file=path.resolve(plan.root,relative);if(!fs.existsSync(file))continue;const value=read(file),next=retarget(value[key],address);if(next===value[key])continue;value[key]=next;replacements.push({path:file,bytes:Buffer.from(JSON.stringify(value,null,2))});}
 if(validateOnly)return {validated:true,version:online.manifest.version,files:replacements.map(f=>f.path),masterUrl:plan.next.masterUrl};
 // Keep originals in memory only. These are connection settings, never projects or accounts.
 const originals=[];try{for(const item of replacements){const file=path.resolve(plan.root,item.path);originals.push({file,bytes:fs.existsSync(file)?fs.readFileSync(file):null});fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file+'.reconnecting',item.bytes);fs.renameSync(file+'.reconnecting',file);}}catch(error){for(const row of originals.reverse()){if(row.bytes)fs.writeFileSync(row.file,row.bytes);else if(fs.existsSync(row.file))fs.unlinkSync(row.file);}throw error;}
 log('团队地址已修复：'+plan.next.masterUrl+'；工程、账号和原配对凭据保留。');
 if(editor)try{await get(editor.base+'/api/collab/config',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({hubUrl:plan.next.collabHubUrl})});}catch{log('当前版本的画格连接会在升级重启后生效。');}
 let result={repaired:true,masterUrl:plan.next.masterUrl,version:online.manifest.version,upgraded:false};
 if(control){
  const page=await request(control.base+'/'),html=await page.text(),nonce=/const nonce='([^']+)'/.exec(html)?.[1];
  if(nonce)try{
   await get(control.base+'/api/check',{method:'POST',headers:{'X-Local-Control':nonce},timeout:45000});const status=await get(control.base+'/api/status');
   if(status.available&&status.readiness?.allowed&&upgrade){const applied=await get(control.base+'/api/apply',{method:'POST',headers:{'X-Local-Control':nonce},timeout:60000});result={...result,upgraded:true,version:applied.version||status.latest};log('已校验并启用 '+result.version+'，工具正在重新启动。');}
   else{result.pendingUpgrade=!!status.available;log(status.readiness?.allowed?'团队已重新连接，可在版本管理页继续升级。':'当前任务尚未结束；连接已修复，请在任务结束后安全升级。');}
  }catch(e){result.upgradeError=e.message;log('接入地址已修复；自动升级暂未完成：'+e.message);}
  result.controlUrl=control.base+'/';
 }else log('请重新运行本工具的“启动全部.cmd”，再进入版本管理页升级。');
 return result;
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
 const args=process.argv.slice(2),value=name=>args[args.indexOf(name)+1];
 try{fail(args.includes('--root')&&args.includes('--payload'),'请通过“修复同事团队连接.cmd”运行');const result=await repairConnection(value('--root'),read(value('--payload')),{upgrade:!args.includes('--no-upgrade'),validateOnly:args.includes('--validate-only'),log:console.log});console.log(result.upgraded?'已应用新版，工具正在重启。':result.repaired?'连接修复完成。':'检查完成。');if(result.controlUrl)console.log('本机升级页：'+result.controlUrl);}catch(e){console.error('修复未完成：'+e.message);process.exitCode=1;}
}
