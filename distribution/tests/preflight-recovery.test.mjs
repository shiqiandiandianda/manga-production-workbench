import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {generateKeyPairSync,randomUUID} from 'node:crypto';
import {createRelease,applyRelease,decodeRelease} from '../updates.mjs';
import {createForcedUpgrades,upgradeMemberId} from '../forced-upgrades.mjs';
import {createForcedUpgradeReceiver} from '../forced-upgrade-client.mjs';
const proof=path.resolve('.runtime/patch-preflight-test');fs.mkdirSync(proof,{recursive:true});const fixture=()=>fs.mkdtempSync(path.join(proof,'fixture-'));
const put=(root,name,body)=>{const p=path.join(root,name);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,typeof body==='string'?body:JSON.stringify(body));};

test('签名升级遇代码冲突时不关服务，保留项目；冲突解决后正常升级',async t=>{
 const root=fixture(), keys=generateKeyPairSync('ed25519',{publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});
 const identity={machineId:'test-peer',registrationKey:'c'.repeat(64)};
 const old=createRelease(new Map([['comic/server.mjs',Buffer.from('upstream-v1')]]),keys.privateKey,{now:'2026-10-23T00:00:00Z'});
 const next=createRelease(new Map([['comic/server.mjs',Buffer.from('upstream-v2')]]),keys.privateKey,{previous:old.manifest,now:'2026-10-24T00:00:00Z'});
 applyRelease(root,decodeRelease(old.archive,keys.publicKey));put(root,'comic/server.mjs','local-precious-fix');put(root,'runtime-data/comic/project.json','KEEP-PROJECT');put(root,'runtime-data/team/identity.local.json',identity);
 const commands=createForcedUpgrades({dataDir:fixture(),privateKey:keys.privateKey,getLatest:()=>next,getMembers:async()=>[{id:upgradeMemberId(identity),machine:'test'}]});await commands.start({requestId:randomUUID()});const command=commands.heartbeat(upgradeMemberId(identity),{forcedUpgradeVersion:2});
 const server=http.createServer((req,res)=>{if(req.url==='/api/releases/latest'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({manifest:next.manifest,signature:next.signature}));}else if(req.url==='/releases/'+next.manifest.contentId+'.json.gz')res.end(next.archive);else{res.statusCode=404;res.end();}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();server.close();});
 let stops=0,restarts=0,recovers=0,now=1000000;
 const receiver=createForcedUpgradeReceiver({root,channel:{masterUrl:'http://127.0.0.1:'+server.address().port,publicKey:keys.publicKey},clock:()=>now,readiness:async()=>({allowed:true}),stop:async()=>{stops++;},restart:async()=>{restarts++;},recover:async()=>{recovers++;}});
 await receiver.accept(command);assert.equal(receiver.status().phase,'failed');assert.match(receiver.status().message,/本机代码已修改/);assert.equal(stops,0);assert.equal(recovers,0);
 now+=60000;await receiver.accept(command);assert.equal(stops,0);assert.equal(restarts,0);assert.equal(fs.readFileSync(path.join(root,'comic/server.mjs'),'utf8'),'local-precious-fix');assert.equal(fs.readFileSync(path.join(root,'runtime-data/comic/project.json'),'utf8'),'KEEP-PROJECT');
 put(root,'comic/server.mjs','upstream-v1');now+=60000;await receiver.accept(command);assert.equal(stops,1);assert.equal(restarts,1);assert.equal(fs.readFileSync(path.join(root,'comic/server.mjs'),'utf8'),'upstream-v2');assert.equal(fs.readFileSync(path.join(root,'runtime-data/comic/project.json'),'utf8'),'KEEP-PROJECT');
});

test('检查之后出现新冲突时再次检查并恢复服务',async t=>{
 const root=fixture(), keys=generateKeyPairSync('ed25519',{publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}}),identity={machineId:'race-peer',registrationKey:'d'.repeat(64)};
 const old=createRelease(new Map([['comic/server.mjs',Buffer.from('v1')]]),keys.privateKey,{now:'2026-10-23T00:00:00Z'}),next=createRelease(new Map([['comic/server.mjs',Buffer.from('v2')]]),keys.privateKey,{previous:old.manifest,now:'2026-10-24T00:00:00Z'});
 applyRelease(root,decodeRelease(old.archive,keys.publicKey));put(root,'runtime-data/team/identity.local.json',identity);
 const commands=createForcedUpgrades({dataDir:fixture(),privateKey:keys.privateKey,getLatest:()=>next,getMembers:async()=>[{id:upgradeMemberId(identity),machine:'test'}]});await commands.start({requestId:randomUUID()});const command=commands.heartbeat(upgradeMemberId(identity),{forcedUpgradeVersion:2});
 const server=http.createServer((req,res)=>{if(req.url==='/api/releases/latest'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({manifest:next.manifest,signature:next.signature}));}else res.end(next.archive);});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();server.close();});
 let stops=0,recovers=0;
 const receiver=createForcedUpgradeReceiver({root,channel:{masterUrl:'http://127.0.0.1:'+server.address().port,publicKey:keys.publicKey},readiness:async()=>{put(root,'comic/server.mjs','late-edit');return {allowed:true};},stop:async()=>{stops++;},restart:async()=>{assert.fail('不应重启');},recover:async()=>{recovers++;}});
 await receiver.accept(command);assert.equal(stops,1);assert.equal(recovers,1);assert.equal(receiver.status().phase,'failed');assert.equal(fs.readFileSync(path.join(root,'comic/server.mjs'),'utf8'),'late-edit');
});
