import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createHash,generateKeyPairSync,randomUUID} from 'node:crypto';
import {createPublisher} from '../publisher.mjs';import {decodeRelease,applyRelease,writeJson} from '../updates.mjs';import {preparePublication,publishLocalCode} from '../publication-client.mjs';
const base=path.resolve(import.meta.dirname,'../../runtime-data/verification/publication');fs.mkdirSync(base,{recursive:true});
const put=(root,name,bytes)=>{const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,typeof bytes==='string'||Buffer.isBuffer(bytes)?bytes:JSON.stringify(bytes));};
async function fixture(t){
 const root=fs.mkdtempSync(path.join(base,'primary-')),keys=generateKeyPairSync('ed25519',{publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});
 const people=['开发甲','开发乙'].map((name,i)=>{const registrationKey=String(i+1).repeat(64),machineId='SYNTHETIC-'+i,key=createHash('sha256').update(machineId+':'+registrationKey).digest('hex');return {name,registrationKey,machineId,key,id:key.slice(0,16)};});
 put(root,'comic/server.mjs','export const value=1;');put(root,'comic/public/app.js','export const app=1;');put(root,'distribution/portable/README.md','guide');put(root,'distribution/environments.json',{packages:[]});
 const dataDir=path.join(root,'runtime-data/distribution/master'),releaseRoot=path.join(dataDir,'releases');
 put(root,'runtime-data/distribution/master/master.local.json',{...keys,enrollmentCode:'synthetic-invite',clients:Object.fromEntries(people.map(person=>[person.key,{name:person.machineId}]))});
 put(root,'runtime-data/distribution/master/member-names.local.json',Object.fromEntries(people.map(person=>[person.id,{name:person.name}])));
 let publisher,origin,port;
 async function start(){publisher=await createPublisher({root,masterUrl:'http://127.0.0.1:'+(port||0),primaryContext:async()=>({name:'主版本管理员'}),ownerCheck:req=>req.headers['x-owner']==='yes'});await new Promise(resolve=>publisher.server.listen(port||0,'127.0.0.1',resolve));port=publisher.server.address().port;origin='http://127.0.0.1:'+port;publisher.channel.masterUrl=origin;put(root,'distribution/channel.json',publisher.channel);put(root,'comic/public/team-release-channel.json',{masterUrl:origin});}
 await start();await publisher.publish({force:true});
 const headers=actor=>actor==='owner'?{'X-Owner':'yes','X-Team-Invitation':'synthetic-invite'}:actor===null?{}:{'X-Team-Registration':people[actor].registrationKey,'X-Team-Machine':people[actor].machineId};
 async function request(actor,route,input,expected=200,extra={}){const response=await fetch(origin+route,{method:input===undefined?'GET':'POST',headers:{Connection:'close',...headers(actor),...extra,...(input!==undefined?{'Content-Type':'application/json'}:{})},body:input===undefined?undefined:JSON.stringify(input)}),value=await response.json();assert.equal(response.status,expected,route+' '+JSON.stringify(value));return value;}
 const admin=await request('owner','/api/dashboard'),nonce=admin.nameControl;
 const permission=(actor,enabled,status=200)=>request('owner','/api/publication/permission',{memberId:people[actor].id,enabled},status,{'X-Dashboard-Control':nonce});
 const patch=(name,text,extra={})=>({baseContentId:publisher.latest.manifest.contentId,requestId:randomUUID(),note:'合成代码更新',changes:[{path:name,data:Buffer.from(text).toString('base64')}],removed:[],...extra});
 const bytes=()=>fs.readFileSync(path.join(releaseRoot,publisher.latest.manifest.contentId+'.json.gz'));
 t.after(async()=>publisher.close());
 return {root,dataDir,people,headers,request,permission,patch,bytes,get origin(){return origin;},get publisher(){return publisher;},async restart(){await publisher.close();await start();}};
}

test('只有主版本能授权，已登记成员默认不能发布，设备凭据与管理员凭据不泄露',async t=>{
 const f=await fixture(t),input=f.patch('comic/server.mjs','export const value=2;');
 await f.request(null,'/api/publication/submit',input,403);await f.request(0,'/api/publication/submit',input,403);
 await f.request(0,'/api/publication/permission',{memberId:f.people[0].id,enabled:true},403);
 await f.request('owner','/api/publication/permission',{memberId:f.people[0].id,enabled:true},403);
 await f.permission(0,true);
 const dashboard=await f.request(0,'/api/dashboard');assert.equal(dashboard.canPublish,true);assert.equal(dashboard.canManagePublishPermissions,false);assert.equal(dashboard.nameControl,null);
 assert.equal(JSON.stringify(dashboard).includes(f.people[0].registrationKey),false);
 await f.request('owner','/api/publication/permission',{memberId:'not-registered',enabled:true},404,{'X-Dashboard-Control':(await f.request('owner','/api/dashboard')).nameControl});
});

test('授权及撤销持久化，撤销后不能继续发布或给别人授权',async t=>{
 const f=await fixture(t);await f.permission(0,true);await f.restart();assert.equal((await f.request(0,'/api/dashboard')).canPublish,true);
 const nonce=(await f.request('owner','/api/dashboard')).nameControl;
 await f.request('owner','/api/publication/permission',{memberId:f.people[0].id,enabled:false},200,{'X-Dashboard-Control':nonce});await f.restart();
 assert.equal((await f.request(0,'/api/dashboard')).canPublish,false);await f.request(0,'/api/publication/submit',f.patch('comic/server.mjs','export const value=2;'),403);
});

test('同事代码签名发布、重复请求幂等、自动观察和服务重启不回退团队版本',async t=>{
 const f=await fixture(t);await f.permission(0,true);const input=f.patch('comic/server.mjs','export const value=2;');
 const result=await f.request(0,'/api/publication/submit',input),release=decodeRelease(f.bytes(),f.publisher.channel.publicKey);
 assert.equal(release.files.get('comic/server.mjs').toString(),'export const value=2;');assert.equal(release.manifest.author.name,'开发甲');assert.equal(release.manifest.releaseNotes,input.note);
 assert.equal(fs.readFileSync(path.join(f.root,'comic/server.mjs'),'utf8'),'export const value=1;','发布不能热替换正在运行的主版本');
 assert.equal((await f.request(0,'/api/publication/submit',input)).version,result.version);
 await f.publisher.publish({force:true});assert.equal(f.publisher.latest.manifest.version,result.version);await f.restart();await f.publisher.publish({force:true});assert.equal(f.publisher.latest.manifest.version,result.version);
 const colleague=fs.mkdtempSync(path.join(base,'colleague-'));applyRelease(colleague,release);assert.equal(fs.readFileSync(path.join(colleague,'comic/server.mjs'),'utf8'),'export const value=2;');
 const audit=fs.readFileSync(path.join(f.dataDir,'publication-audit.local.jsonl'),'utf8').trim().split('\n').map(JSON.parse);assert.equal(audit.filter(row=>row.action==='publish').length,1);
});

test('并发发布只接受一个，旧基线、语法错误、越界及隐私文件都被拦截',async t=>{
 const f=await fixture(t);await f.permission(0,true);await f.permission(1,true);
 const input=f.patch('comic/server.mjs','export const value=2;'),responses=await Promise.all([0,1].map(i=>fetch(f.origin+'/api/publication/submit',{method:'POST',headers:{...f.headers(i),'Content-Type':'application/json'},body:JSON.stringify({...input,requestId:randomUUID()})})));
 assert.deepEqual(responses.map(row=>row.status).sort(),[200,409]);
 const before=f.publisher.latest.manifest.contentId;
 await f.request(0,'/api/publication/submit',f.patch('comic/server.mjs','export const = broken;'),422);
 for(const name of ['../escape.js','runtime-data/auth.json','distribution/channel.json','comic/public/private.local.json'])await f.request(0,'/api/publication/submit',f.patch(name,'synthetic'),400);
 assert.equal(f.publisher.latest.manifest.contentId,before);
});

test('主版本后续改动合入同事版本，同文件冲突要求合并，升级后不会重新回退',async t=>{
 const f=await fixture(t);await f.permission(0,true);await f.request(0,'/api/publication/submit',f.patch('comic/server.mjs','export const value=2;'));
 put(f.root,'comic/public/app.js','export const app=3;');await f.publisher.publish({force:true});let release=decodeRelease(f.bytes(),f.publisher.channel.publicKey);
 assert.equal(release.files.get('comic/server.mjs').toString(),'export const value=2;');assert.equal(release.files.get('comic/public/app.js').toString(),'export const app=3;');
 put(f.root,'comic/server.mjs','export const value=99;');await assert.rejects(()=>f.publisher.publish({force:true}),/冲突/);const id=f.publisher.latest.manifest.contentId;
 put(f.root,'comic/server.mjs','export const value=2;');await f.publisher.publish({force:true});assert.equal(f.publisher.latest.manifest.contentId,id);
});

test('本机发布预览只列代码，预览后发生修改会拒绝；断线重试发送原请求',async t=>{
 const f=await fixture(t);await f.permission(0,true);
 const colleague=fs.mkdtempSync(path.join(base,'client-'));applyRelease(colleague,decodeRelease(f.bytes(),f.publisher.channel.publicKey));
 put(colleague,'distribution/portable/README.md','guide');put(colleague,'runtime-data/team/identity.local.json',f.people[0]);put(colleague,'runtime-data/account.local.json','SECRET');
 put(colleague,'comic/server.mjs','export const value=2;');let preview=await preparePublication(colleague);
 assert.deepEqual(preview.changes.map(row=>row.path),['comic/server.mjs']);
 put(colleague,'comic/server.mjs','export const value=3;');await assert.rejects(()=>publishLocalCode(colleague,{...preview,requestId:randomUUID(),note:'合成更新'}),/预览之后/);
 preview=await preparePublication(colleague);const input={baseContentId:preview.baseContentId,changeId:preview.changeId,requestId:randomUUID(),note:'合成更新'};
 await assert.rejects(()=>publishLocalCode(colleague,input,{request:async(url,options)=>{const response=await fetch(url,options);if(url.endsWith('/submit'))throw Error('synthetic lost response');return response;}}),/lost response/);
 const version=f.publisher.latest.manifest.version,result=await publishLocalCode(colleague,input);assert.equal(result.version,version);assert.equal(result.reused,true);
});
