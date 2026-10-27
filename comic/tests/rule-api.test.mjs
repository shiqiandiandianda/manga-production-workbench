import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {createStudio} from '../server.mjs';
import {normalizeRows} from '../public/model.js';

import {zipStore} from '../public/render.js';
import {inflateSync} from 'node:zlib';
const root=fileURLToPath(new URL('../',import.meta.url)),require=createRequire(import.meta.url);
const native=require(process.env.COMIC_TEST_CANVAS_MODULE||path.join(root,'runtime/node/node_modules/@napi-rs/canvas'));
const ctx=()=>native.createCanvas(8,8).getContext('2d');
async function fixture(t){
 const parent=path.join(root,'.runtime','temp');fs.mkdirSync(parent,{recursive:true});
 const directory=fs.mkdtempSync(path.join(parent,'rule-api-')),calls=[];
 const blocked={status:async()=>{calls.push('unexpected-status');throw Error('No generation connection permitted');},generate:async()=>{calls.push('unexpected-generation');throw Error('No generation');},close(){}};
 const studio=createStudio({dataDir:directory,bridge:blocked,jimengBridge:blocked});
 await new Promise(resolve=>studio.server.listen(0,'127.0.0.1',resolve));const url='http://127.0.0.1:'+studio.server.address().port;
 t.after(async()=>{studio.close();await new Promise(resolve=>studio.server.close(resolve));const resolved=path.resolve(directory);assert.equal(path.dirname(resolved),path.resolve(parent));assert.ok(path.basename(resolved).startsWith('rule-api-'));fs.rmSync(resolved,{recursive:true,force:true});});
 const request=async(route,method='GET',data)=>{
  const response=await fetch(url+route,{method,headers:data?{'Content-Type':'application/json'}:undefined,body:data?JSON.stringify(data):undefined});
  return {status:response.status,data:await response.json()};
 };
  const saveReviewedRuleProject=async project=>{
    let checked=await request('/api/storyboards/check','POST',{text:JSON.stringify(project.shots)});assert.equal(checked.status,200,JSON.stringify(checked.data));
    if(checked.data.issues.length){const s=checked.data;assert.ok(s.issues.every(i=>i.kind==='CAMERA_ALIAS'));checked=await request('/api/storyboards/check/'+s.id,'PATCH',{fileKey:s.fileKey,sheet:s.sheet,expectedVersion:s.version,decisions:s.issues.map(i=>({issueId:i.id,action:'alias',value:i.suggestions[0].value}))});}
    const s=checked.data,confirmed=await request('/api/storyboards/check/'+s.id+'/confirm','POST',{fileKey:s.fileKey,sheet:s.sheet,expectedVersion:s.version});assert.equal(confirmed.status,200,JSON.stringify(confirmed.data));
    return request('/api/projects/rule-layout','POST',{project,importCheck:confirmed.data.receipt});
  };
  return {request,saveReviewedRuleProject,studio,url,directory,calls};
}
const shotRows=()=>normalizeRows([
 {description:'两人面对面核对线索，中景。',dialogue:'甲：发现了吗？\n乙：看这里。',sceneType:'一对一',shotScale:'中景',participants:'甲、乙',sceneId:'A',characterPositions:'甲:右;乙:左'},
 {description:'乙指向信封的印记，特写。',dialogue:'乙：就是这个印记。',sceneType:'操作',shotScale:'特写',participants:'甲、乙',sceneId:'A'}
]);
async function workbook(sheets){
 const entries=[{name:'xl/workbook.xml',text:'<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'+
   sheets.map((s,i)=>'<sheet name="'+s.name+'" sheetId="'+(i+1)+'" r:id="r'+i+'"/>').join('')+'</sheets></workbook>'},
  {name:'xl/_rels/workbook.xml.rels',text:'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+sheets.map((s,i)=>'<Relationship Id="r'+i+'" Target="worksheets/sheet'+i+'.xml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"/>').join('')+'</Relationships>'}];
 sheets.forEach((s,i)=>entries.push({name:'xl/worksheets/sheet'+i+'.xml',text:s.xml}));
 const blob=zipStore(entries.map(e=>({name:e.name,bytes:new TextEncoder().encode(e.text)})));
 return Buffer.from(await blob.arrayBuffer()).toString('base64');
}
const sheetXml=(header='画面描述',formula=false)=>'<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>'+header+'</t></is></c><c r="B1" t="inlineStr"><is><t>台词</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>两人回头，中景</t></is></c><c r="B2" t="inlineStr">'+(formula?'<f>A1</f>':'<is><t>甲：先看原文。</t></is>')+'</c></row></sheetData></worksheet>';
test('首次部署为空，重启不会植入示例、图片、任务或模板',async t=>{
 const f=await fixture(t),r=await f.request('/api/state');
 assert.deepEqual(r.data.projects,[]);assert.deepEqual(r.data.assets,[]);assert.deepEqual(r.data.jobs,[]);assert.deepEqual(r.data.layouts,[]);
 assert.deepEqual(f.calls,[]);assert.ok(!fs.existsSync(path.join(f.directory,'assets')));
});
test('XLSX 选择实际分镜工作表，保留中文原文，不计算公式',async t=>{
 const f=await fixture(t),dataBase64=await workbook([{name:'备注',xml:sheetXml('说明')},{name:'正式分镜',xml:sheetXml()}]);
 const r=await f.request('/api/storyboards/parse','POST',{name:'分镜.xlsx',dataBase64});
 assert.equal(r.status,200,JSON.stringify(r.data));assert.equal(r.data.sheet,'正式分镜');assert.equal(r.data.shots[0].dialogue,'甲：先看原文。');
 assert.deepEqual(r.data.sheets,['备注','正式分镜']);assert.deepEqual(f.calls,[]);
 const bad=await f.request('/api/storyboards/parse','POST',{name:'公式.xlsx',dataBase64:await workbook([{name:'表1',xml:sheetXml('画面描述',true)}])});
 assert.equal(bad.status,400);assert.match(bad.data.error,/公式/);
});
test('文本编码、空表和未知文件有明确错误',async t=>{
 const f=await fixture(t);assert.equal((await f.request('/api/storyboards/parse','POST',{text:''})).status,400);
 assert.equal((await f.request('/api/storyboards/parse','POST',{name:'旧.xls',dataBase64:'AAAA'})).status,400);
 const r=await f.request('/api/storyboards/parse','POST',{text:'画面描述\t台词\n两人对峙\t甲：不能删掉。'});
 assert.equal(r.status,200);assert.equal(r.data.shots[0].dialogue,'甲：不能删掉。');assert.deepEqual(f.calls,[]);
});




test('PNG 输出为单张长图，片段交界像素连续、末尾完整、重复完成幂等',async t=>{
 const f=await fixture(t),created=(await f.request('/api/projects','POST',{title:'单张导出测试'})).data;
 created.pages[0].height=9000;const saved=(await f.request('/api/projects/'+created.id,'PUT',created)).data;
 const start=await f.request('/api/strip-exports','POST',{projectId:saved.id,expectedRevision:saved.revision});assert.equal(start.status,201);
 assert.equal(start.data.height,12600);const exportHeight=start.data.height,id=start.data.id;
 const part=(h,color)=>{const c=native.createCanvas(1280,h),context=c.getContext('2d');context.fillStyle=color;context.fillRect(0,0,1280,h);return c.toBuffer('image/png').toString('base64');};
 assert.equal((await f.request('/api/strip-exports/'+id+'/parts','POST',{index:1,y:0,dataBase64:part(1,'red')})).status,400);
 assert.equal((await f.request('/api/strip-exports/'+id+'/parts','POST',{index:0,y:0,dataBase64:part(8192,'#ff0000')})).status,200);
 assert.equal((await f.request('/api/strip-exports/'+id+'/complete','POST',{})).status,400);
 assert.equal((await f.request('/api/strip-exports/'+id+'/parts','POST',{index:1,y:8192,dataBase64:part(exportHeight-8192,'#0000ff')})).status,200);
 const complete=await f.request('/api/strip-exports/'+id+'/complete','POST',{});assert.equal(complete.status,200,JSON.stringify(complete.data));
 assert.equal(complete.data.files,1);assert.equal(complete.data.width,1280);assert.equal(complete.data.height,exportHeight);
 assert.equal((await f.request('/api/strip-exports/'+id+'/complete','POST',{})).data.sha256,complete.data.sha256);
 const bytes=Buffer.from(await (await fetch(f.url+complete.data.url)).arrayBuffer());
 assert.equal(bytes.readUInt32BE(20),exportHeight);assert.equal(bytes.readUInt32BE(16),1280);
 const compressed=[];for(let offset=8;offset<bytes.length;){const n=bytes.readUInt32BE(offset),kind=bytes.toString('ascii',offset+4,offset+8);if(kind==='IDAT')compressed.push(bytes.subarray(offset+8,offset+8+n));offset+=12+n;}
 const raw=inflateSync(Buffer.concat(compressed)),stride=1280*3+1;assert.equal(raw.length,exportHeight*stride);
 assert.deepEqual([...raw.subarray(8191*stride+1,8191*stride+4)],[255,0,0]);
 assert.deepEqual([...raw.subarray(8192*stride+1,8192*stride+4)],[0,0,255]);
 assert.deepEqual([...raw.subarray((exportHeight-1)*stride+1,(exportHeight-1)*stride+4)],[0,0,255]);assert.deepEqual(f.calls,[]);
});
