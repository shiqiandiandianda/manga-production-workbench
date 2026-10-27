// 静态文件（尤其是 34 MB 的字体）再次打开时只做 304 校验，不重复下载。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createStudio} from '../server.mjs';

test('字体和页面文件带 ETag，未变化时返回 304 且不传文件内容',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'static-cache-'));
 const studio=createStudio({dataDir:dir,seedReference:false,bridge:{status:async()=>({connected:false})}});
 await new Promise(r=>studio.server.listen(0,'127.0.0.1',r));
 t.after(async()=>{studio.close();await new Promise(r=>studio.server.close(r));fs.rmSync(dir,{recursive:true,force:true});});
 const url=`http://127.0.0.1:${studio.server.address().port}`;
 for(const file of ['/fonts.css','/fonts/SourceHanSansSC-VF.ttf.woff2','/app.js']){
  const first=await fetch(url+file);assert.equal(first.status,200);const etag=first.headers.get('etag');assert.ok(etag,file);await first.arrayBuffer();
  const again=await fetch(url+file,{headers:{'If-None-Match':etag}});assert.equal(again.status,304,file);assert.equal((await again.arrayBuffer()).byteLength,0);
 }
});
