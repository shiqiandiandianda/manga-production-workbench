import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';import {createRequire} from 'node:module';
import {compatibleCanvas} from '../lib/canvas-image-compat.mjs';
import {comicStyles} from '../public/comic-styles.js';import {comicStyleFile} from '../lib/comic-style-library.mjs';
const require=createRequire(import.meta.url),native=require(process.env.COMIC_CANVAS_MODULE||'@napi-rs/canvas'),canvas=compatibleCanvas(native),hash=b=>createHash('sha256').update(b).digest('hex');
test('155个随包素材可用于服务端渲染，保留原件及内容摘要',async()=>{
 const manifest=JSON.parse(fs.readFileSync(path.resolve('materials/漫画素材/catalogue-integrity.json')));
 assert.equal(comicStyles.length,155);
 for(const style of comicStyles){const file=comicStyleFile(style.id),before=fs.readFileSync(file),entry=manifest.entries.find(e=>e.id===style.id),image=await canvas.loadImage(before);assert.equal(image.width,entry.width,style.id);assert.equal(image.height,entry.height,style.id);assert.equal(hash(fs.readFileSync(file)),entry.sha256,style.id);assert.equal(hash(before),entry.sha256);}
 const file=comicStyleFile(comicStyles.find(s=>s.id==='drive-1AmnY0odZqb5QG8rgaIA0rqnBIhLzs7uy').id);assert.ok((await canvas.loadImage(file)).width>0);
});
test('无效图片仍明确拒绝，不写回原文件',async()=>{
 await assert.rejects(canvas.loadImage(Buffer.from('not an image')));assert.equal(compatibleCanvas(native),canvas);
 const valid=fs.readFileSync(comicStyleFile('drive-1AmnY0odZqb5QG8rgaIA0rqnBIhLzs7uy'));await assert.rejects(canvas.loadImage(valid.subarray(0,100)));
});
