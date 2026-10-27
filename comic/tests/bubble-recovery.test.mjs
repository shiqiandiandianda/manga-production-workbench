import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {classifiedBubbleDefinitions,readClassifiedBubbleAssets} from '../public/moku-bubble-catalog.js';
import {comicStyleFile,comicStyleSourcePath} from '../lib/comic-style-library.mjs';
import {applyRemoteBubbleStyles,comicPreviewUrl,comicStyles} from '../public/comic-styles.js';
import {applyBubbleMaterial,clearBubbleMaterial} from '../public/bubble-material.js';
const assets=JSON.parse(fs.readFileSync(new URL('./fixtures/bubble-cloud-v074.json',import.meta.url),'utf8').replace(/^\uFEFF/,'')).items;

test('墨库实际七张图片准确接入：保留固定版本、独立上圆，排除未知图和重复歧义',()=>{
 const result=classifiedBubbleDefinitions(assets);assert.equal(result.length,7);
 const double=result.find(s=>s.id==='ref22-double');assert.equal(double.revisionId,'00000000-0000-4000-8000-000000000011');assert.ok(double.parts?.length);
 assert.equal(classifiedBubbleDefinitions([...assets,{...assets[0],id:'00000000-0000-0000-0000-000000000001'}]).length,6);
 assert.equal(classifiedBubbleDefinitions(assets.map(a=>({...a,deletedAt:'2026-10-27'}))).length,0);
 assert.equal(classifiedBubbleDefinitions(assets.map(a=>({...a,projectId:'00000000-0000-0000-0000-000000000001'}))).length,0);
 assert.equal(classifiedBubbleDefinitions(assets.map(a=>({...a,name:'未知气泡.png'}))).length,0);
});

test('读取分类分页时保留精确版本，不上传、不猜测未知图片',async()=>{
 const calls=[];const result=await readClassifiedBubbleAssets(async route=>{calls.push(route);const u=new URL(route,'http://fixture');if(u.searchParams.get('assetType')==='nameplate')return {items:[]};return u.searchParams.get('offset')==='0'?{items:assets.slice(0,3),more:true}:{items:assets.slice(3),more:false};});
 assert.equal(result.items.length,7);assert.equal(calls.length,3);assert.ok(calls.every(p=>p.startsWith('/api/library/assets?')));
});

test.skip('参考图片未包含在源码中，需使用隔离授权素材测试',()=>{
 const root=new URL('../public/comic-materials/漫画素材/',import.meta.url);
 const manifest=JSON.parse(fs.readFileSync(new URL('bubble-provenance.json',root)));
 assert.equal(manifest.entries.length,54);assert.equal(manifest.entries.filter(e=>e.source==='original-google-drive').length,11);
 for(const entry of manifest.entries){const file=comicStyleFile(entry.id),bytes=fs.readFileSync(file);assert.equal(createHash('sha256').update(bytes).digest('hex'),entry.sha256);assert.equal(bytes.subarray(1,4).toString(),'PNG');assert.equal(bytes.readUInt32BE(16),entry.width);assert.equal(bytes.readUInt32BE(20),entry.height);assert.match(comicPreviewUrl(entry.id),/^\/api\/comic-style-library\//);}
 assert.equal(comicStyleSourcePath({filePath:'C:/outside.png'}),'');
 const first=comicStyles[0],original=first.filePath;try{first.filePath=new URL('../public/comic-materials/漫画素材/../../../comic-style-data.js',import.meta.url).pathname;assert.throws(()=>comicStyleFile(first.id));}finally{first.filePath=original;}
});

test('采用云端气泡保留对白、位置、尾巴及固定版本，清除素材时清除绑定',()=>{
 const styles=classifiedBubbleDefinitions(assets);applyRemoteBubbleStyles(styles);
 const before={text:'原句保留',x:10,y:20,w:300,h:200,type:'speech',shape:'oval',fillOpacity:1,outlineWidth:2,tail:{visible:true,side:'bottom',base:.54},textBox:{x:30,y:25,w:240,h:130}};
 const after=applyBubbleMaterial(before,'ref22-double');assert.equal(after.text,before.text);assert.deepEqual([after.x,after.y,after.w,after.h],[10,20,300,200]);assert.deepEqual(after.textBox,before.textBox);assert.ok(after.assetParts.length);assert.equal(after.styleLibrary.revisionId,styles.find(s=>s.id==='ref22-double').revisionId);assert.equal(clearBubbleMaterial(after).styleLibrary,undefined);
});
