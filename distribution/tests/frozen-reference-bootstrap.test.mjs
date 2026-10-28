import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';
import {bootstrapAutoLayout} from '../auto-layout-bootstrap.mjs';
const source=path.resolve(import.meta.dirname,'../..'),proof=path.resolve('.runtime/patch-bootstrap-test');fs.mkdirSync(proof,{recursive:true});
const hash=b=>createHash('sha256').update(b).digest('hex');
test('保留旧冻结参考全部40份并与原有参考去重，重启只补缺失不改变已有登记',()=>{
 const root=fs.mkdtempSync(path.join(proof,'data-')),registry=path.join(root,'library/projects.json');fs.mkdirSync(path.dirname(registry),{recursive:true});fs.writeFileSync(registry,'{"projects":[{"id":"dazhou","activeVersion":"keep-original"}]}');
 const result=bootstrapAutoLayout(source,{dataRoot:root}),manifest=JSON.parse(fs.readFileSync(path.join(source,'auto-layout/public/bootstrap/manifest.json'),'utf8'));
 const rows=manifest.files.filter(r=>r.path.startsWith('library/dazhou/versions/approved-selective-20261024-v1/'));assert.equal(rows.length,40);assert.ok(manifest.files.some(r=>r.path.startsWith('library/dazhou/versions/approved-cc94887b4f1d/')));
 for(const row of rows){const bytes=fs.readFileSync(path.join(root,row.path));assert.equal(bytes.length,row.bytes);assert.equal(hash(bytes),row.sha256);}
 assert.equal(JSON.parse(fs.readFileSync(registry,'utf8')).projects[0].activeVersion,'keep-original');
 const again=bootstrapAutoLayout(source,{dataRoot:root});assert.equal(again.added,0);assert.equal(result.files,manifest.files.length);
});
