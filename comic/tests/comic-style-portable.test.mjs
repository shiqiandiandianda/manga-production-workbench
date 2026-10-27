import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';
import {comicStyleFile,comicStyleAvailable,comicStyleSourcePath} from '../lib/comic-style-library.mjs';
import {comicStyles} from '../public/comic-styles.js';
test('全部54款本地气泡从随包原件或定义预览读取，保持尺寸与来源摘要',()=>{
 const root=path.resolve('materials/漫画素材'),manifest=JSON.parse(fs.readFileSync(path.join(root,'bubble-provenance.json')));
 assert.equal(manifest.entries.length,54);assert.equal(manifest.entries.filter(e=>e.source==='original').length,29);
 for(const entry of manifest.entries){assert.equal(comicStyleAvailable(entry.id),true);const file=comicStyleFile(entry.id),bytes=fs.readFileSync(file);assert.equal(createHash('sha256').update(bytes).digest('hex'),entry.sha256);assert.equal(bytes.subarray(1,4).toString(),'PNG');assert.equal(bytes.readUInt32BE(16),entry.width);assert.equal(bytes.readUInt32BE(20),entry.height);}
 assert.throws(()=>comicStyleFile('missing'),/不存在/);assert.equal(comicStyleSourcePath({filePath:'C:/outside.png'}),'');
 const item=comicStyles[0],original=item.filePath;try{item.filePath=root+'/../../server.mjs';assert.throws(()=>comicStyleFile(item.id),/超出素材库/);}finally{item.filePath=original;}
});
