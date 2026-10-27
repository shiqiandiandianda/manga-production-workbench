import test from'node:test';import assert from'node:assert/strict';
import{inspectProductionPackage,packageDigest}from'../lib/production-package.mjs';import{syntheticFiles}from'./fixtures/production-synthetic.mjs';
const file=(relativePath,data)=>{const bytes=Buffer.from(JSON.stringify(data));return{relativePath,bytes,sha256:packageDigest(bytes)};};
test('资产绑定需求中的屏段不冒充文字层，并保留原件',async()=>{
 const files=syntheticFiles(),extra=file('资产绑定需求.json',{'状态':'待绑定','说明':'另一用途','屏段':[{'段ID':'段01','附图':[]}]}),source=await inspectProductionPackage([extra,...files]);
 assert.equal(source.count.segments,2);assert.ok(source.manifest.some(f=>f.relativePath===extra.relativePath&&f.sha256===extra.sha256));assert.equal(source.episodes[0].texts.length,3);
});
test('同目录的屏段计划和其他含屏段资料不进入文字层判重',async()=>{
 const files=syntheticFiles(),plan=file('屏段/第011话_屏段计划.json',{'话':11,'默认模式':'空泡','屏段':[]}),other=file('其他.json',{'话':11,'屏段':[]}),source=await inspectProductionPackage([...files,plan,other]);
 assert.equal(source.manifest.length,4);assert.equal(source.count.episodes,1);assert.equal(source.count.panels,2);
});
test('正式文字层缺版本仍报错，并给出文件名而不是undefined',async()=>{
 const files=syntheticFiles(),data=JSON.parse(files[1].bytes);delete data['版本'];files[1]=file(files[1].relativePath,data);
 await assert.rejects(inspectProductionPackage(files),e=>e.message.includes('版本缺失')&&e.message.includes(files[1].relativePath)&&!e.message.includes('undefined'));
});
test('正式文字层不支持的版本仍拒绝，不能为了通过扫描跳过验证',async()=>{
 const files=syntheticFiles(),data=JSON.parse(files[1].bytes);data['版本']='屏段文字层 9.0';files[1]=file(files[1].relativePath,data);
 await assert.rejects(inspectProductionPackage(files),e=>e.message.includes('不支持的屏段文字层版本')&&e.message.includes('9.0')&&e.message.includes(files[1].relativePath));
});
test('兼容有明确版本声明的旧命名文字层',async()=>{
 const files=syntheticFiles();files[1]={...files[1],relativePath:'自定义屏段资料.json'};const source=await inspectProductionPackage(files);assert.equal(source.count.segments,2);
});
