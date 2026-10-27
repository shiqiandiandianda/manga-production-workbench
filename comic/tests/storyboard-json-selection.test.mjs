import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectProductionPackage,loadPackageFiles,packageDigest} from '../lib/production-package.mjs';
import {syntheticFiles} from './fixtures/production-synthetic.mjs';
const file=(relativePath,data)=>{const bytes=Buffer.from(JSON.stringify(data));return {relativePath,bytes,sha256:packageDigest(bytes)};};

test('附带格数组的其他JSON保留原件，不作为分镜版本参与判重',async()=>{
 const files=syntheticFiles(),original=JSON.parse(files[0].bytes),extra=file('定位资料/第011话_另一用途.json',{...original,'作品':'另一用途标记','格':[{'生图提示词':'不应作为正式分镜'}]});
 const source=await inspectProductionPackage([...files,extra]);
 assert.equal(source.title,'合成制作资料');assert.equal(source.episodes[0].panelRecords[0].original['生图提示词'],'单格底稿1');
 assert.ok(source.manifest.some(f=>f.relativePath===extra.relativePath&&f.sha256===extra.sha256));assert.deepEqual(source.count,(await inspectProductionPackage(files)).count);
});

test('分镜JSON目录优先于目录外同名分镜，选择不依赖文件遍历顺序',async()=>{
 const files=syntheticFiles(),alternate=JSON.parse(files[0].bytes);alternate['格'][0]['生图提示词']='目录外旧内容';
 const outside1=file('旧资料/第011话_分镜.json',alternate),outside2=file('其他目录/第011话_分镜.json',alternate);
 for(const input of[[outside1,outside2,...files],[...files,outside2,outside1]]){
  const source=await inspectProductionPackage(input);assert.equal(source.episodes[0].panelRecords[0].original['生图提示词'],'单格底稿1');assert.equal(source.manifest.length,4);
 }
});

test('分镜JSON目录内的正式JSON不强制改文件名',async()=>{
 const files=syntheticFiles();files[0]={...files[0],relativePath:'整包/分镜JSON/第011话.json'};
 const source=await inspectProductionPackage(files);assert.equal(source.episodes[0].panelRecords[0].source.file,files[0].relativePath);
});

test('兼容直接选择分镜.json及带话号的分镜JSON文件',async()=>{
 for(const name of['分镜.json','第011话_分镜.json','第011话_分镜JSON.json']){
  const files=syntheticFiles();files[0]={...files[0],relativePath:name};const source=await inspectProductionPackage(files);
  assert.equal(source.episodes[0].panelRecords[0].source.file,name);assert.equal(source.count.panels,2);
 }
});

test('正式分镜目录内真正重复的话号仍拒绝，并指出两份文件',async()=>{
 const files=syntheticFiles(),duplicate={...files[0],relativePath:'分镜JSON/第011话_修订稿.json'};
 await assert.rejects(inspectProductionPackage([...files,duplicate]),error=>error.message.includes('同一话有多个分镜JSON版本')&&error.message.includes(files[0].relativePath)&&error.message.includes(duplicate.relativePath));
});

test('文件夹上传保留全部原件摘要，屏段文字层与正式分镜继续匹配',async()=>{
 const files=syntheticFiles(),extra=file('其他资料/第011话_附加.json',{'话':11,'格':[]});files.push(extra);
 const uploaded=await loadPackageFiles({files:files.map(f=>({relativePath:'完整资料/'+f.relativePath,dataBase64:f.bytes.toString('base64')}))});
 const source=await inspectProductionPackage(uploaded);assert.equal(source.manifest.length,3);assert.equal(source.count.segments,2);assert.equal(source.count.toolTexts,2);
 for(const f of files)assert.equal(source.manifest.find(m=>m.relativePath===f.relativePath).sha256,f.sha256);
});
