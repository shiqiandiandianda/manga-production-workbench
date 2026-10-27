import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {bootstrapAutoLayout} from '../auto-layout-bootstrap.mjs';

const root=path.resolve(import.meta.dirname,'../..');

test('公开源码不自带项目参考，空白初始化可重复且不覆盖本机数据',t=>{
 const index=path.join(root,'auto-layout/public/bootstrap/manifest.json');
 const manifest=JSON.parse(fs.readFileSync(index,'utf8'));
 assert.equal(manifest.format,'comic-layout-bootstrap-v1');
 assert.deepEqual(manifest.files,[]);
 assert.equal(fs.existsSync(path.join(root,'auto-layout/public/bootstrap/blobs')),false);
 const data=fs.mkdtempSync(path.join(os.tmpdir(),'comic-public-bootstrap-'));
 t.after(()=>{if(path.dirname(data)!==path.resolve(os.tmpdir()))throw Error('临时路径不匹配');fs.rmSync(data,{recursive:true,force:true});});
 const personal=path.join(data,'learning-workbench/data/scripts/personal.json');
 fs.mkdirSync(path.dirname(personal),{recursive:true});fs.writeFileSync(personal,'synthetic existing data');
 assert.equal(bootstrapAutoLayout(root,{dataRoot:data}).added,0);
 assert.equal(bootstrapAutoLayout(root,{dataRoot:data}).added,0);
 assert.equal(fs.readFileSync(personal,'utf8'),'synthetic existing data');
 for(const name of ['scripts','drafts','runs','history'])assert.ok(fs.statSync(path.join(data,'learning-workbench/data',name)).isDirectory());
});
