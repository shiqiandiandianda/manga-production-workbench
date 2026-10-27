import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {inspectProductionPackage,loadPackageFiles,packageDigest} from '../lib/production-package.mjs';
import {createStudio} from '../server.mjs';
import {syntheticFiles} from './fixtures/production-synthetic.mjs';
const file=(relativePath,data)=>{const bytes=Buffer.from(JSON.stringify(data));return {relativePath,bytes,sha256:packageDigest(bytes)};};

test('附带格数组的其他JSON保留原件，不作为分镜版本参与判重',async()=>{
 const files=syntheticFiles(),original=JSON.parse(files[0].bytes),extra=file('定位资料/第011话_另一用途.json',{...original,'格式':'定位资料 1.0','作品':'另一用途标记','格':[{'生图提示词':'不应作为正式分镜'}]});
 const source=await inspectProductionPackage([...files,extra]);
 assert.equal(source.title,'合成制作资料');assert.equal(source.episodes[0].panelRecords[0].original['生图提示词'],'单格底稿1');
 assert.ok(source.manifest.some(f=>f.relativePath===extra.relativePath&&f.sha256===extra.sha256));assert.deepEqual(source.count,(await inspectProductionPackage(files)).count);
});

test('分镜JSON目录优先于目录外未声明格式的同名文件，选择不依赖遍历顺序',async()=>{
 const files=syntheticFiles(),alternate=JSON.parse(files[0].bytes);delete alternate['格式'];alternate['格'][0]['生图提示词']='目录外旧内容';
 const outside1=file('旧资料/第011话_分镜.json',alternate),outside2=file('其他目录/第011话_分镜.json',alternate);
 for(const input of[[outside1,outside2,...files],[...files,outside2,outside1]]){
  const source=await inspectProductionPackage(input);assert.equal(source.episodes[0].panelRecords[0].original['生图提示词'],'单格底稿1');assert.equal(source.manifest.length,4);
 }
});

test('目录外明确声明正式分镜的文件参与冲突检查，不自动丢弃',async()=>{
 const files=syntheticFiles(),alternate=JSON.parse(files[0].bytes);alternate['格'][0]['生图提示词']='另一版正式内容';
 const outside=file('旧资料/第011话_分镜.json',alternate);
 for(const input of [[outside,...files],[...files,outside]])await assert.rejects(inspectProductionPackage(input),error=>error.message.includes('同一话有多个分镜JSON版本')&&error.message.includes(outside.relativePath)&&error.message.includes(files[0].relativePath));
});

test('只有其他用途的格数组时不猜成分镜，原件保留并提示缺少分镜',async()=>{
 const files=syntheticFiles(),data=JSON.parse(files[0].bytes);data['格式']='定位资料 1.0';
 const other=file('定位资料/第011话_人物定位.json',data);
 const result=await inspectProductionPackage([files[1],other]);
 assert.ok(result.manifest.some(row=>row.relativePath===other.relativePath&&row.sha256===other.sha256));
 assert.ok(result.issues.some(issue=>issue.severity==='conflict'&&issue.message.includes('缺少逐格分镜JSON')));
 assert.ok(result.episodes[0].panelRecords.every(panel=>!panel.source.file));
});

test('没有格式的辅助格列表即使有相同格ID，也不会冒充缺失分镜',async()=>{
 const files=syntheticFiles(),board=JSON.parse(files[0].bytes),other=file('定位资料/第011话_辅助.json',{'作品':board['作品'],'话':11,'格':board['格'].map(row=>({'格ID':row['格ID']}))});
 const result=await inspectProductionPackage([files[1],other]);
 assert.ok(result.issues.some(issue=>issue.severity==='conflict'&&issue.message.includes('缺少逐格分镜JSON')));
 assert.ok(result.episodes[0].panelRecords.every(panel=>!panel.source.file));
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

test('实际接口预览和导入保留其他资料原件，正式分镜冲突不能新建工程',async t=>{
 const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'storyboard-selection-'));
 const bridge={close(){},status:async()=>({connected:false})},studio=createStudio({dataDir,seedReference:false,bridge,jimengBridge:bridge});
 await new Promise(resolve=>studio.server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{studio.close();studio.server.closeAllConnections();if(studio.server.listening)await new Promise(resolve=>studio.server.close(resolve));});
 const origin='http://127.0.0.1:'+studio.server.address().port,files=syntheticFiles(),extra=file('定位资料/第011话_其他.json',{'格式':'定位资料 1.0','话':11,'格':[{'内容':'合成测试'}]});
 const uploads=items=>items.map(item=>({relativePath:item.relativePath,dataBase64:item.bytes.toString('base64')}));
 const post=async(route,body)=>{const response=await fetch(origin+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});return {status:response.status,value:await response.json()};};
 const scan=await post('/api/production-packages/scan',{files:uploads([...files,extra])});
 assert.equal(scan.status,200,JSON.stringify(scan.value));assert.equal(scan.value.count.panels,2);assert.ok(scan.value.files.some(item=>item.path===extra.relativePath));
 const imported=await post('/api/production-packages/import',{scanId:scan.value.scanId});
 assert.equal(imported.status,201,JSON.stringify(imported.value));
 const original=await fetch(origin+'/api/projects/'+imported.value.id+'/production/source?path='+encodeURIComponent(extra.relativePath));
 assert.equal(original.status,200);assert.equal(packageDigest(Buffer.from(await original.arrayBuffer())),extra.sha256);
 const duplicate={...files[0],relativePath:'其他目录/第011话_分镜.json'};
 const conflict=await post('/api/production-packages/scan',{files:uploads([...files,duplicate])});
 assert.equal(conflict.status,400);assert.match(conflict.value.error,/多个分镜JSON版本/);assert.equal(studio.store.db.projects.length,1);
});
