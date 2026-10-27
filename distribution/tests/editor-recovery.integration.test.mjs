import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import {pathToFileURL} from 'node:url';
import {generateKeyPairSync} from 'node:crypto';
import {runManager} from '../manager.mjs';
const A=process.env.COMIC_TEST_OUTPUT_DIR||path.resolve(import.meta.dirname,'../../verification/editor-recovery'),base=A+'/fixtures';fs.mkdirSync(base,{recursive:true});
test('编辑器真实子进程退出后恢复，其他服务PID和工程文件不变，主动关闭不恢复',{timeout:30000},async t=>{
 const root=fs.mkdtempSync(base+'/manager-'),put=(p,v)=>{const f=path.join(root,p);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,typeof v==='string'?v:JSON.stringify(v));};
 const holders=[];for(let i=0;i<4;i++){const server=net.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));holders.push(server);}const [comic,asset,center,control]=holders.map(s=>s.address().port);await Promise.all(holders.map(s=>new Promise(r=>s.close(r))));
 const keys=generateKeyPairSync('ed25519',{publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});
 put('distribution/channel.json',{format:'comic-team-channel-v1',masterUrl:'http://127.0.0.1:9',publicKey:keys.publicKey});
 put('workbench/server/config.mjs','export const createConfig=()=>({read:async()=>({}),update:async()=>{}});');put('runtime-data/comic/projects/keep.json',{original:'keep'});
 const ipc=pathToFileURL(path.resolve(import.meta.dirname,'../ipc.mjs')).href;
 const script=`import http from 'node:http';import {installShutdown} from ${JSON.stringify(ipc)};const port=Number(process.argv[process.argv.indexOf('--port')+1]);const server=http.createServer((req,res)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify({application:'synthetic',pid:process.pid}));});await new Promise(r=>server.listen(port,'127.0.0.1',r));installShutdown({close:()=>new Promise(r=>{server.closeAllConnections();server.close(r);})});process.on('message',m=>{if(m.type==='fixture-exit')process.exit(23);});`;
 for(const name of ['start-comic-local.mjs','start-assets-local.mjs','start-center-local.mjs'])put(name,script);
 const manager=await runManager(root,['--comic-port',String(comic),'--asset-port',String(asset),'--center-port',String(center),'--control-port',String(control),'--no-publisher','--no-workers','--no-presence','--no-engines','--no-browser']);t.after(()=>manager.close());
 const pids=Object.fromEntries(manager.children.map(s=>[s.name,s.child.pid])),old=manager.children.find(s=>s.name==='comic').child;const exited=new Promise(r=>old.once('exit',r));old.send({type:'fixture-exit'});await exited;
 let restored;for(let i=0;i<100;i++){await new Promise(r=>setTimeout(r,100));restored=manager.children.findLast(s=>s.name==='comic').child;if(restored.pid!==old.pid&&restored.exitCode===null)try{if((await fetch('http://127.0.0.1:'+comic+'/api/health')).ok)break;}catch{}}
 for(let i=0;i<30&&manager.status().editorRecovery.pending;i++)await new Promise(r=>setTimeout(r,100));
 assert.notEqual(restored.pid,pids.comic);assert.equal(manager.children.find(s=>s.name==='assets').child.pid,pids.assets);assert.equal(manager.children.find(s=>s.name==='center').child.pid,pids.center);
 assert.equal(manager.status().editorRecovery.lastExit.code,23);assert.equal(manager.status().editorRecovery.lastExit.expected,false);assert.equal(fs.readFileSync(root+'/runtime-data/comic/projects/keep.json','utf8'),'{"original":"keep"}');
 const records=fs.readFileSync(root+'/runtime-data/logs/service-recovery.jsonl','utf8').trim().split('\n').map(JSON.parse);assert.ok(records.some(r=>r.event==='recovered'));
 await manager.close();const count=manager.children.length;await new Promise(r=>setTimeout(r,3300));assert.equal(manager.children.length,count);assert.ok(manager.children.every(s=>s.child.exitCode!==null));fs.writeFileSync(A+'/recovery-acceptance.json',JSON.stringify({passed:true,oldPid:pids.comic,newPid:restored.pid,otherServicesUnchanged:true,projectUnchanged:true,explicitCloseNotRestarted:true,records},null,2));
});
