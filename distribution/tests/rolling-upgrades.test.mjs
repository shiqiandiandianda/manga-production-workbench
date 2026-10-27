import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {generateKeyPairSync,createHash,randomUUID} from 'node:crypto';
import {createPublisher} from '../publisher.mjs';
import {createRelease,decodeRelease,applyRelease,writeJson} from '../updates.mjs';
import {upgradeMemberId} from '../forced-upgrades.mjs';

const proof=path.resolve(import.meta.dirname,'../../verification/rolling-upgrades-20261026');fs.mkdirSync(proof,{recursive:true});
const put=(root,name,value)=>{const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,typeof value==='string'?value:JSON.stringify(value));};
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function ports(){const servers=await Promise.all(Array.from({length:4},async()=>{const s=http.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));return s;}));const values=servers.map(s=>s.address().port);await Promise.all(servers.map(s=>new Promise(r=>s.close(r))));return values;}

test('主机协调服务重启不取消同事资产任务：占用编号、令牌、去重和结果回传继续有效',async t=>{
 const root=fs.mkdtempSync(path.join(proof,'publisher-')),keys=generateKeyPairSync('ed25519',{publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}}),identity={machineId:'SYNTHETIC-ASSET',registrationKey:'a'.repeat(64)},key=createHash('sha256').update(identity.machineId+':'+identity.registrationKey).digest('hex');
 put(root,'distribution/environments.json',{packages:[]});put(root,'comic/server.mjs','export const testOnly=true;');put(root,'runtime-data/distribution/master/master.local.json',{...keys,enrollmentCode:'synthetic',clients:{[key]:{name:'合成同事'}}});
 let publisher=await createPublisher({root,masterUrl:'http://127.0.0.1:0'});await new Promise(r=>publisher.server.listen(0,'127.0.0.1',r));const port=publisher.server.address().port,origin='http://127.0.0.1:'+port;t.after(()=>publisher.close());
 const call=async(action,input)=>{const response=await fetch(origin+'/api/team-asset-generations/'+action,{method:'POST',headers:{'Content-Type':'application/json','X-Team-Machine':identity.machineId,'X-Team-Registration':identity.registrationKey},body:JSON.stringify(input)});return {status:response.status,value:await response.json()};},asset={work:{title:'合成作品'},role:'scene',name:'合成庭院'};
 const first=await call('claim',{asset,requestId:'synthetic-original'});assert.equal(first.status,201);assert.equal(publisher.busy,false);assert.deepEqual(publisher.upgradeBlockers,[]);
 await publisher.close();publisher=await createPublisher({root,masterUrl:origin});await new Promise(r=>publisher.server.listen(port,'127.0.0.1',r));
 const resumed=await call('claim',{asset,requestId:'synthetic-original'});assert.equal(resumed.status,200);assert.equal(resumed.value.claim.id,first.value.claim.id);assert.equal(resumed.value.claim.token,first.value.claim.token);
 assert.equal((await call('claim',{asset,requestId:'synthetic-duplicate'})).status,409);
 assert.equal((await call('finish',{id:first.value.claim.id,token:first.value.claim.token,status:'completed',executionEnded:true})).status,200);
});

test('两台真实管理器：甲生图时乙先升级；甲任务原样保留，结束后自动升级',{timeout:60000},async t=>{
 const primary=fs.mkdtempSync(path.join(proof,'primary-')),keys=generateKeyPairSync('ed25519',{publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});
 const peers=await Promise.all([1,2].map(async n=>({root:fs.mkdtempSync(path.join(proof,'peer-')),identity:{machineId:'SYNTHETIC-ROLLING-'+n,registrationKey:String(n).repeat(64)},ports:await ports()})));
 put(primary,'distribution/environments.json',{packages:[]});put(primary,'runtime-data/distribution/master/master.local.json',{...keys,enrollmentCode:'synthetic',clients:Object.fromEntries(peers.map(p=>[createHash('sha256').update(p.identity.machineId+':'+p.identity.registrationKey).digest('hex'),{name:p.identity.machineId}]))});
 const publisher=await createPublisher({root:primary,masterUrl:'http://127.0.0.1:0',primaryContext:async()=>({name:'合成主机'}),ownerCheck:r=>r.headers['x-test-admin']==='yes'});await new Promise(r=>publisher.server.listen(0,'127.0.0.1',r));t.after(()=>publisher.close());
 const origin='http://127.0.0.1:'+publisher.server.address().port;publisher.channel.masterUrl=origin;writeJson(path.join(primary,'distribution/channel.json'),publisher.channel);
 const manager=pathToFileURL(path.resolve(import.meta.dirname,'../manager.mjs')).href,ipc=pathToFileURL(path.resolve(import.meta.dirname,'../ipc.mjs')).href;
 const service=`import fs from 'node:fs';import http from 'node:http';import {installShutdown} from ${JSON.stringify(ipc)};const port=Number(process.argv[process.argv.indexOf('--port')+1]),gate='runtime-data/busy.local.json';const server=http.createServer((q,r)=>{r.setHeader('Content-Type','application/json');r.end(JSON.stringify(q.url==='/api/team-release/context'?{name:'合成同事'}:{ok:true,jobs:[]}));});server.listen(port,'127.0.0.1');installShutdown({busy:()=>JSON.parse(fs.readFileSync(gate)).busy,close(){server.closeAllConnections();server.close();},forceClose(){fs.writeFileSync('runtime-data/CANCELLED','must-not-happen');}});`;
 const files=new Map([['start-all.mjs',Buffer.from(`import {runManager} from ${JSON.stringify(manager)};await runManager(process.cwd(),process.argv.slice(2));`)],...['start-comic-local.mjs','start-assets-local.mjs','start-center-local.mjs'].map(n=>[n,Buffer.from(service)]),['workbench/server/config.mjs',Buffer.from('export const createConfig=()=>({update:async()=>{}});')],['comic/server.mjs',Buffer.from('export const current=true;')]]);
 for(const [name,bytes]of files)put(primary,name,bytes.toString());const old=createRelease(new Map([...files,['comic/obsolete.js',Buffer.from('export const obsolete=true;')]]),keys.privateKey,{now:'2026-10-25T12:00:00Z'});await publisher.publish({force:true});
 for(const [index,p]of peers.entries()){
  applyRelease(p.root,decodeRelease(old.archive,keys.publicKey));put(p.root,'distribution/channel.json',publisher.channel);put(p.root,'runtime-data/team/identity.local.json',p.identity);put(p.root,'runtime-data/busy.local.json',{busy:index===0});put(p.root,'runtime-data/comic/project.json','KEEP-PROJECT');put(p.root,'runtime-data/comic/job.json',{id:'original-job',submitId:'KEEP-CLOUD-ID',status:index===0?'running':'done'});
  const [comic,asset,center,control]=p.ports,log=fs.openSync(path.join(p.root,'manager.log'),'a');p.child=spawn(process.execPath,[path.join(p.root,'start-all.mjs'),'--comic-port',String(comic),'--asset-port',String(asset),'--center-port',String(center),'--control-port',String(control),'--no-publisher','--no-workers','--no-browser'],{cwd:p.root,env:{...process.env,WORKBENCH_RELEASE_DATA_ROOT:path.join(p.root,'runtime-data')},windowsHide:true,stdio:['ignore',log,log]});fs.closeSync(log);
  t.after(async()=>{put(p.root,'runtime-data/busy.local.json',{busy:false});try{const html=await(await fetch('http://127.0.0.1:'+control+'/')).text(),nonce=/const nonce='([^']+)'/.exec(html)[1];await fetch('http://127.0.0.1:'+control+'/api/stop',{method:'POST',headers:{'X-Local-Control':nonce}});}catch{}if(p.child.exitCode===null)p.child.kill();});
 }
 const dashboard=async()=>{const r=await fetch(origin+'/api/dashboard',{headers:{'X-Test-Admin':'yes'}});return r.json();},admin=await dashboard();const response=await fetch(origin+'/api/dashboard/force-upgrade',{method:'POST',headers:{'Content-Type':'application/json','X-Test-Admin':'yes','X-Dashboard-Control':admin.nameControl},body:JSON.stringify({requestId:randomUUID()})});assert.equal(response.status,202);
 let independent=false,last;for(let n=0;n<120;n++){last=await dashboard();const targets=last.forcedUpgrades.campaign.targets;if(targets.find(v=>v.memberId===upgradeMemberId(peers[0].identity)).phase==='waiting'&&targets.find(v=>v.memberId===upgradeMemberId(peers[1].identity)).phase==='completed'){independent=true;break;}await pause(100);}
 assert.equal(independent,true,JSON.stringify(last.forcedUpgrades));const jobBefore=fs.readFileSync(path.join(peers[0].root,'runtime-data/comic/job.json'),'utf8');assert.equal(JSON.parse(jobBefore).status,'running');assert.equal(peers[0].child.exitCode,null);assert.equal(fs.existsSync(path.join(peers[0].root,'runtime-data/CANCELLED')),false);
 assert.equal(JSON.parse(fs.readFileSync(path.join(peers[0].root,'runtime-data/distribution/installed.local.json'))).contentId,old.manifest.contentId);
 const control='http://127.0.0.1:'+peers[0].ports[3],html=await(await fetch(control+'/')).text(),nonce=/const nonce='([^']+)'/.exec(html)[1];
 const queued=await fetch(control+'/api/apply',{method:'POST',headers:{'X-Local-Control':nonce}});assert.equal(queued.status,202);assert.equal((await queued.json()).upgradeQueued,true);assert.equal(JSON.parse(fs.readFileSync(path.join(peers[0].root,'runtime-data/distribution/deferred-upgrade.local.json'))).requested,true);
 put(peers[0].root,'runtime-data/busy.local.json',{busy:false});
 for(let n=0;n<250;n++){last=await dashboard();if(last.forcedUpgrades.campaign.completed===2)break;await pause(100);}assert.equal(last.forcedUpgrades.campaign.completed,2,JSON.stringify(last.forcedUpgrades));
 for(const p of peers){assert.equal(fs.existsSync(path.join(p.root,'runtime-data/CANCELLED')),false);assert.equal(fs.readFileSync(path.join(p.root,'runtime-data/comic/project.json'),'utf8'),'KEEP-PROJECT');assert.equal(fs.existsSync(path.join(p.root,'comic/obsolete.js')),false);const status=await(await fetch('http://127.0.0.1:'+p.ports[3]+'/api/status')).json();assert.ok(status.services.every(s=>s.running));assert.equal(status.forcedUpgrade.phase,'completed');}
 assert.equal(fs.readFileSync(path.join(peers[0].root,'runtime-data/comic/job.json'),'utf8'),jobBefore);
 fs.writeFileSync(path.join(proof,'acceptance.json'),JSON.stringify({ok:true,idlePeerUpgradedWhileOtherBusy:true,busyPeerAutomaticallyResumed:true,originalTaskUnchanged:true,noTasksCancelled:true,completed:2,realAI:false},null,2));
});
