import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {generateKeyPairSync} from 'node:crypto';
import {repairConnection} from '../reconnect.mjs';
import {createRelease,decodeRelease,applyRelease} from '../updates.mjs';
import {buildReconnectPackage} from '../reconnect-package.mjs';
import {validateReconnect} from '../reconnect.mjs';
import {readZip} from '../../comic/lib/xlsx.mjs';
const proof=path.resolve(import.meta.dirname,'../../verification/team-peer-reconnect-20261025');fs.mkdirSync(proof,{recursive:true});
const put=(root,name,value)=>{const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value));};
function fixture({busy=false,modified=false}={}){
 const root=fs.mkdtempSync(path.join(proof,'fixture-')),keys=generateKeyPairSync('ed25519',{publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}}),old={format:'comic-team-channel-v1',publicKey:keys.publicKey,enrollmentCode:'SYNTHETIC-INVITE',masterUrl:'http://192.0.2.44:18914',projectCenterUrl:'http://192.0.2.44:8790',collabHubUrl:'http://192.0.2.44:18897'},next={...old,masterUrl:'http://192.0.2.22:18914',projectCenterUrl:'http://192.0.2.22:8790',collabHubUrl:'http://192.0.2.22:18897'},files=c=>new Map([['distribution/channel.json',Buffer.from(JSON.stringify(c,null,2))],['comic/public/team-release-channel.json',Buffer.from(JSON.stringify({masterUrl:c.masterUrl},null,2))],['comic/server.mjs',Buffer.from(c===old?'export const version=1;':'export const version=2;')]]),previous=createRelease(files(old),keys.privateKey),release=createRelease(files(next),keys.privateKey,{previous:previous.manifest});
 for(const [name,bytes]of files(old))put(root,name,bytes);put(root,'runtime-data/distribution/installed.local.json',previous.manifest);put(root,'runtime-data/team/接入配置.local.json',{hub:old.projectCenterUrl,token:'CENTER-TOKEN',projectIds:['original-project']});put(root,'runtime-data/team/canvas-node.local.json',{hubUrl:old.collabHubUrl,token:'NODE-TOKEN',clientId:'original-client',nodeId:'original-node'});put(root,'runtime-data/comic/collab/client-config.json',{hubUrl:old.collabHubUrl,token:'EDITOR-TOKEN',clientId:'editor-client'});put(root,'runtime-data/comic/projects.json',{id:'original-project',art:'original-image'});put(root,'runtime-data/comic/library-session.local.json','PRIVATE-ACCOUNT');if(modified)put(root,'comic/server.mjs','MANUAL-EDIT');
 const payload={manifest:release.manifest,signature:release.signature,publicKey:keys.publicKey,files:[...files(next)].filter(([name])=>name!=='comic/server.mjs').map(([name,bytes])=>({path:name,data:bytes.toString('base64')}))},calls=[];
 const request=async(url,options={})=>{
  calls.push({url,method:options.method||'GET'});const u=new URL(url),p=u.pathname;
  if(u.hostname==='192.0.2.22'&&p==='/api/releases/latest')return Response.json({manifest:release.manifest,signature:release.signature});
  if(u.hostname==='192.0.2.22'&&p==='/health')return Response.json({application:'comic-team-publisher'});
  if(u.port==='18909'&&p==='/api/health')return Response.json({codeRoot:path.join(root,'comic'),dataRoot:path.join(root,'runtime-data/comic'),teamControlUrl:'http://127.0.0.1:18913/'});
  if(u.port==='18909'&&p==='/api/collab/config')return Response.json({configured:true});
  if(u.port==='18913'&&p==='/api/status')return Response.json({root,role:'colleague',available:true,latest:release.manifest.version,readiness:{allowed:!busy}});
  if(u.port==='18913'&&p==='/')return new Response("const nonce='SYNTHETIC-CONTROL';");
  if(u.port==='18913'&&p==='/api/check')return Response.json({ok:true});
  if(u.port==='18913'&&p==='/api/apply'){try{return Response.json(applyRelease(root,decodeRelease(release.archive,keys.publicKey)));}catch(e){return Response.json({error:e.message},{status:409});}}
  return Response.json({error:'not found'},{status:404});
 };
 return {root,keys,payload,request,calls,old,next};
}
test('签名修复接入地址后可跨版正常升级，不丢工程、账号、节点及令牌',async()=>{
 const f=fixture(),result=await repairConnection(f.root,f.payload,{request:f.request});assert.equal(result.repaired,true);assert.equal(result.upgraded,true);assert.equal(fs.readFileSync(path.join(f.root,'comic/server.mjs'),'utf8'),'export const version=2;');assert.equal(JSON.parse(fs.readFileSync(path.join(f.root,'distribution/channel.json'))).masterUrl,f.next.masterUrl);
 const node=JSON.parse(fs.readFileSync(path.join(f.root,'runtime-data/team/canvas-node.local.json')));assert.equal(node.token,'NODE-TOKEN');assert.equal(node.nodeId,'original-node');assert.equal(node.hubUrl,f.next.collabHubUrl);assert.equal(fs.readFileSync(path.join(f.root,'runtime-data/comic/library-session.local.json'),'utf8'),'PRIVATE-ACCOUNT');assert.equal(JSON.parse(fs.readFileSync(path.join(f.root,'runtime-data/comic/projects.json'))).id,'original-project');
});
test('同事仍有生成任务时只修复连接，不停任务或强行升级',async()=>{const f=fixture({busy:true}),result=await repairConnection(f.root,f.payload,{request:f.request});assert.equal(result.repaired,true);assert.equal(result.upgraded,false);assert.equal(result.pendingUpgrade,true);assert.ok(!f.calls.some(c=>c.url.endsWith('/api/apply')));assert.equal(fs.readFileSync(path.join(f.root,'comic/server.mjs'),'utf8'),'export const version=1;');});
test('本机人工代码修改仍被升级保护，地址修复不覆盖人工成果',async()=>{const f=fixture({modified:true}),result=await repairConnection(f.root,f.payload,{request:f.request});assert.equal(result.repaired,true);assert.equal(result.upgraded,false);assert.match(result.upgradeError,/本机代码已修改/);assert.equal(fs.readFileSync(path.join(f.root,'comic/server.mjs'),'utf8'),'MANUAL-EDIT');});
test('主机、签名篡改及错误配置摘要均拒绝，不修改原频道',async()=>{
 for(const kind of ['primary','signature','digest']){const f=fixture(),file=path.join(f.root,'distribution/channel.json'),before=fs.readFileSync(file);if(kind==='primary')put(f.root,'runtime-data/distribution/master/master.local.json',f.keys);else if(kind==='signature')f.payload.signature=Buffer.alloc(64).toString('base64');else f.payload.files[0].data=Buffer.from('WRONG').toString('base64');await assert.rejects(()=>repairConnection(f.root,f.payload,{request:f.request}));assert.deepEqual(fs.readFileSync(file),before);assert.equal(f.calls.length,0);}
});
test('新主机不可达或仅检查时不改本机文件',async()=>{const f=fixture(),file=path.join(f.root,'distribution/channel.json'),before=fs.readFileSync(file);await assert.rejects(()=>repairConnection(f.root,f.payload,{request:async()=>{throw Error('offline');}}));assert.deepEqual(fs.readFileSync(file),before);const result=await repairConnection(f.root,f.payload,{request:f.request,validateOnly:true});assert.equal(result.validated,true);assert.deepEqual(fs.readFileSync(file),before);assert.ok(!f.calls.some(c=>c.method==='POST'||c.method==='PUT'));});
test('轻量修复ZIP可读回验签，含Windows5可读脚本与中文入口，不包含主机私钥或账号',()=>{
 const f=fixture(),files=new Map(f.payload.files.map(row=>[row.path,Buffer.from(row.data,'base64')]));for(const [name,bytes]of files)put(f.root,name,bytes);
 for(const name of ['distribution/Repair-TeamConnection.cmd','distribution/Repair-TeamConnection.ps1','distribution/reconnect.mjs']){const bytes=fs.readFileSync(path.resolve(import.meta.dirname,'../..',name));files.set(name,bytes);put(f.root,name,bytes);}
 const release=createRelease(files,f.keys.privateKey),artifact=buildReconnectPackage(f.root,{manifest:release.manifest,signature:release.signature}),zip=readZip(artifact.bytes);assert.equal(zip.names().length,5);assert.ok(zip.has('修复同事团队连接.cmd'));assert.equal(zip.read('Repair-TeamConnection.ps1').charCodeAt(0),0xfeff);const payload=JSON.parse(zip.read('connection-patch.json'));assert.equal(validateReconnect(f.root,payload).next.masterUrl,f.next.masterUrl);assert.ok(!zip.names().some(n=>/account|session|master.local/.test(n)));assert.ok(zip.names().every(n=>!zip.read(n).includes('BEGIN PRIVATE KEY')));fs.writeFileSync(path.join(proof,'synthetic-reconnect.zip'),artifact.bytes);
});
