import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {createHash} from 'node:crypto';import http from 'node:http';
import {ProjectCenter} from '../server/project-center.mjs';import {compressEngineeringBatch} from '../server/compact-engineering.mjs';import {sendFile} from '../server/web.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
test('new snapshots use lossless storage and old snapshots compact without changing file IDs or raw hashes',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'center-compact-')),core=new ProjectCenter(dir);t.after(()=>core.db.close());const p=core.createProject({title:'Synthetic'}),raw=Buffer.from(JSON.stringify({source:'中文原文'.repeat(100000)}));
 const current=core.upload(p.id,{name:'current.comic.json',type:'comic-project',mime:'application/json'},raw);assert.equal(current.storageEncoding,'br');assert.deepEqual(core.readFile(current),raw);
 const oldPath=path.join(dir,'projects',p.id,'blobs',hash(raw)+'-old.json');fs.writeFileSync(oldPath,raw);const old={...current,id:'file_old',path:oldPath,name:'old.comic.json'};for(const k of ['storageEncoding','storageBytes','storageSha256'])delete old[k];core.put('file',old);
 const result=compressEngineeringBatch(core);assert.equal(result.files,1);assert.equal(fs.existsSync(oldPath),false);const restored=core.get('file',old.id);assert.equal(restored.sha256,hash(raw));assert.equal(restored.bytes,raw.length);assert.deepEqual(core.readFile(restored),raw);
 const server=http.createServer((req,res)=>void sendFile(req,res,{path:restored.path,mime:restored.mime,encoding:restored.storageEncoding,bytes:restored.bytes}).catch(e=>res.destroy(e)));await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close();});
 const response=await fetch('http://127.0.0.1:'+server.address().port);assert.equal(Number(response.headers.get('content-length')),raw.length);assert.deepEqual(Buffer.from(await response.arrayBuffer()),raw);
});
