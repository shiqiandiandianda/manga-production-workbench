import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createCenter} from '../server.mjs';
import {AssetCenterClient} from '../sdk/client.mjs';
import {executeOne} from '../sdk/worker.mjs';
test('external SDK uses a fake adapter, persists results, requires authentication and human review',async t=>{
 const parent=path.resolve('.test-temp');fs.mkdirSync(parent,{recursive:true});const dir=fs.mkdtempSync(path.join(parent,'http-')),center=createCenter({dataDir:dir});await new Promise(resolve=>center.server.listen(0,'127.0.0.1',resolve));t.after(async()=>{await center.close();assert.equal(path.dirname(dir),parent);fs.rmSync(dir,{recursive:true,force:true});});
 const url='http://127.0.0.1:'+center.server.address().port,admin=center.store.createKey('admin','合成管理'),client=new AssetCenterClient({url,token:admin.token});assert.equal((await fetch(url+'/api/v1/status')).status,401);assert.equal((await fetch(url+'/openapi.json')).status,200);
 const input={format:'comic-asset-requirements-v1',idempotencyKey:'external-test-001',work:{externalKey:'synthetic',title:'合成作品'},needs:[{role:'scene',name:'合成石桥',prompt:'合成测试',spec:{width:128,height:128},usages:[{episode:1,unitId:'E001-001'}]}]},receipt=await client.submit(input);assert.deepEqual(await client.submit(input),receipt);
 const {createRequire}=await import('node:module'),{homedir}=await import('node:os'),require=createRequire(import.meta.url),{createCanvas}=require(path.join(homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@napi-rs/canvas'));
 let calls=0;const result=await executeOne({client,directory:path.join(dir,'worker'),workId:receipt.workId,heartbeatMs:20,generate:async({directory,onProgress})=>{calls++;onProgress('假通道执行中');const canvas=createCanvas(128,128),ctx=canvas.getContext('2d');ctx.fillRect(0,0,128,128);const filePath=path.join(directory,'fake.png');fs.writeFileSync(filePath,canvas.toBuffer('image/png'));return {filePath};}});assert.equal(calls,1);assert.equal(result.version.status,'review');
 const status=await client.status('?workId='+receipt.workId);assert.equal(status.tasks[0].status,'review');assert.ok(status.tasks[0].started&&status.tasks[0].ended);await client.request('/api/v1/versions/'+result.version.id+'/review',{method:'POST',data:{action:'approve',expectedApprovedVersionId:null}});assert.equal((await client.status()).assets[0].approvedVersionId,result.version.id);assert.ok((await client.image(result.version.id)).length>24);
});
