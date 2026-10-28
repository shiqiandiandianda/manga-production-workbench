import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {generateKeyPairSync} from 'node:crypto';
import {createRelease,decodeRelease,preflightRelease,applyRelease} from '../updates.mjs';
const proof=path.resolve('.runtime/patch-registry-test');fs.mkdirSync(proof,{recursive:true});
const fixture=()=>fs.mkdtempSync(path.join(proof,'fixture-'));
const keys=()=>generateKeyPairSync('ed25519',{publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});
const registry='auto-layout/library/projects.json';
const put=(root,p,data)=>{const f=path.join(root,p);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,data)};
const read=(root,p)=>fs.readFileSync(path.join(root,p),'utf8');
function setup(){const root=fixture(),key=keys();let previous=null;return {root,key,release(data){const r=createRelease(new Map(Object.entries(data).map(([p,v])=>[p,Buffer.from(v)])),key.privateKey,{previous});previous=r.manifest;return decodeRelease(r.archive,key.publicKey)}};}
test('本机修改的旧规则登记保持不变，其他签名代码正常升级，后续升级继续保留',()=>{
 const f=setup();applyRelease(f.root,f.release({[registry]:'default-v1','comic/server.mjs':'old-code'}));
 put(f.root,registry,'local-frozen-versions');put(f.root,'runtime-data/comic/project.json','original-project');
 let next=f.release({[registry]:'default-v2','comic/server.mjs':'new-code'});preflightRelease(f.root,next);applyRelease(f.root,next);
 assert.equal(read(f.root,registry),'local-frozen-versions');assert.equal(read(f.root,'comic/server.mjs'),'new-code');assert.equal(read(f.root,'runtime-data/comic/project.json'),'original-project');
 next=f.release({[registry]:'default-v3','comic/server.mjs':'newer-code'});applyRelease(f.root,next);assert.equal(read(f.root,registry),'local-frozen-versions');assert.equal(read(f.root,'comic/server.mjs'),'newer-code');
});
test('未修改的默认登记正常更新；文件缺失时可安装；本地修改的登记不因发布删除而消失',()=>{
 const f=setup();applyRelease(f.root,f.release({[registry]:'default-v1','comic/server.mjs':'code'}));applyRelease(f.root,f.release({[registry]:'default-v2','comic/server.mjs':'code'}));assert.equal(read(f.root,registry),'default-v2');
 fs.unlinkSync(path.join(f.root,registry));applyRelease(f.root,f.release({[registry]:'default-v3','comic/server.mjs':'code'}));assert.equal(read(f.root,registry),'default-v3');
 put(f.root,registry,'user-rules');applyRelease(f.root,f.release({'comic/server.mjs':'code-v2'}));assert.equal(read(f.root,registry),'user-rules');
});
test('非登记文件的本地代码冲突仍阻止升级',()=>{
 const f=setup();applyRelease(f.root,f.release({[registry]:'default','comic/server.mjs':'old'}));put(f.root,'comic/server.mjs','local-edit');
 const next=f.release({[registry]:'new','comic/server.mjs':'new'});assert.throws(()=>preflightRelease(f.root,next),/本机代码已修改/);assert.throws(()=>applyRelease(f.root,next),/本机代码已修改/);assert.equal(read(f.root,'comic/server.mjs'),'local-edit');
});
