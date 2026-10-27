import test from 'node:test';
import assert from 'node:assert/strict';
import {run} from '../lib/process.mjs';
test('进程输出按 UTF-8 跨字节块解码',async()=>{
  const lines=[];
  const script=`const b=Buffer.from('中文\\n');process.stdout.write(b.subarray(0,1));process.stderr.write(b.subarray(0,1));setTimeout(()=>{process.stdout.write(b.subarray(1));process.stderr.write(b.subarray(1));},40);`;
  const result=await run([process.execPath],['-e',script],{onLine:line=>lines.push(line)});
  assert.equal(result.code,0);assert.equal(result.stdout,'中文\n');assert.equal(result.stderr,'中文\n');assert.deepEqual(lines,['中文']);
});

import {JsonLineWorker,stopChild} from '../lib/process.mjs';
const workerScript=`
const readline=require('node:readline');
readline.createInterface({input:process.stdin}).on('line',line=>{
  const request=JSON.parse(line);
  if(request.mode==='slow'){process.stdout.write(JSON.stringify({id:request.id,type:'progress',stage:'turn/start',message:'开始处理'})+'\\n');return;}
  if(request.mode==='error'){process.stdout.write(JSON.stringify({id:request.id,type:'error',code:'workspace_routing_timeout',stage:'account/read',retryable:true,message:'路由超时 Bearer should-be-redacted'})+'\\n');return;}
  process.stdout.write(JSON.stringify({id:request.id+10,type:'result',message:'不得误用其他请求'})+'\\n');
  const bytes=Buffer.from(JSON.stringify({id:request.id,type:'result',message:'中文完成',pid:process.pid})+'\\n');
  const split=bytes.indexOf(Buffer.from('中'))+1;process.stdout.write(bytes.subarray(0,split));setTimeout(()=>process.stdout.write(bytes.subarray(split)),15);
});`;
test('持久JSONL连接跨块UTF-8解码、按请求ID匹配并复用同一进程',async t=>{
  const worker=new JsonLineWorker([process.execPath],['-e',workerScript]);t.after(()=>worker.close());
  const first=await worker.request({action:'test'}),second=await worker.request({action:'test'});assert.equal(first.message,'中文完成');assert.equal(second.message,'中文完成');assert.equal(first.pid,second.pid);
});
test('持久JSONL连接保持单实例串行，超时保留阶段与已启动标识',async t=>{
  const worker=new JsonLineWorker([process.execPath],['-e',workerScript]);t.after(()=>worker.close());
  const pending=worker.request({mode:'slow'},{timeout:2000});const observed=assert.rejects(pending,error=>error.code==='worker_timeout'&&error.stage==='turn/start'&&error.mayHaveStarted===true);
  await assert.rejects(worker.request({action:'other'}),error=>error.code==='worker_busy');await observed;assert.equal(worker.closed,true);
});
test('持久JSONL连接返回分类错误并隐藏凭据，后续请求仍可执行',async t=>{
  const worker=new JsonLineWorker([process.execPath],['-e',workerScript]);t.after(()=>worker.close());
  await assert.rejects(worker.request({mode:'error'}),error=>error.code==='workspace_routing_timeout'&&error.stage==='account/read'&&error.retryable===true&&!error.message.includes('should-be-redacted'));
  assert.equal((await worker.request({action:'test'})).message,'中文完成');
});
test('stopChild 兼容操作句柄，只调用该镜头cancel',()=>{
  let cancelled=0;stopChild({exitCode:null,cancel:()=>cancelled++});assert.equal(cancelled,1);
});

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {findPython} from '../lib/process.mjs';
test('真正Node到Python serve管道以UTF-8收中文目录，连续请求与surrogate错误均返回正确ID',async t=>{
  const python=findPython();if(!python){t.skip('本机未安装Python');return;}
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'漫画中文IPC-')),workerDirectory=fileURLToPath(new URL('../python',import.meta.url));
  const script=`import sys\nsys.path.insert(0,sys.argv[1])\nimport codex_worker\nclass FixtureSession:\n def __init__(self,*args): pass\n def close(self): pass\n def execute(self,action,directory=None,force=False):\n  codex_worker.progress("中文请求已处理", "fixture", "reference")\n  if force: raise RuntimeError("可见测试错误含孤立代理:"+chr(0xdcaa))\n  return {"connected":True,"directory":str(directory) if directory else None,"inputEncoding":sys.stdin.encoding,"text":"中文回包"}\ncodex_worker.WorkerSession=FixtureSession\ncodex_worker.serve(["fixture-no-app-server"])\n`;
  const worker=new JsonLineWorker([python],['-c',script,workerDirectory],{env:{...process.env,PYTHONUTF8:'0',PYTHONIOENCODING:'gbk',TEMP:os.tmpdir(),TMP:os.tmpdir(),PYTHONPYCACHEPREFIX:path.join(fileURLToPath(new URL('../',import.meta.url)),'.runtime','pycache')}});
  t.after(()=>{worker.close();assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(directory,{recursive:true,force:true});});
  const events=[];
  const first=await worker.request({action:'status'},{timeout:5000,onEvent:event=>events.push(event)});
  const second=await worker.request({action:'generate',directory},{timeout:5000,onEvent:event=>events.push(event)});
  assert.equal(first.id,1);assert.equal(second.id,2);assert.equal(first.inputEncoding,'utf-8');assert.equal(second.inputEncoding,'utf-8');assert.equal(path.resolve(second.directory),path.resolve(directory));assert.equal(second.text,'中文回包');
  assert.ok(events.some(event=>event.id===1&&event.stage==='worker/read'));assert.ok(events.some(event=>event.id===2&&event.stage==='worker/read'));
  await assert.rejects(worker.request({action:'status',force:true},{timeout:5000,onEvent:event=>events.push(event)}),error=>error.code==='generation_failed'&&error.message.includes('可见测试错误含孤立代理:')&&error.message.includes(String.fromCharCode(0xdcaa)));
  assert.ok(events.some(event=>event.id===3&&event.type==='error'));
  const fourth=await worker.request({action:'status'},{timeout:5000});assert.equal(fourth.id,4);assert.equal(fourth.connected,true);
});
test('无ID的Python致命错误立即结束当前请求，避免等待长生图超时',async t=>{
  const script=`process.stdin.once('data',()=>process.stdout.write(JSON.stringify({type:'error',code:'worker_encoding_error',stage:'worker/read',message:'输入编码错误'})+'\\n'));`;
  const worker=new JsonLineWorker([process.execPath],['-e',script]);t.after(()=>worker.close());
  await assert.rejects(worker.request({action:'test'},{timeout:3000}),error=>error.code==='worker_encoding_error'&&error.stage==='worker/read');assert.equal(worker.closed,true);
});
test('没有收包确认的worker在IPC阶段结束，不等待16分钟，也不标记已生图',async t=>{
  const worker=new JsonLineWorker([process.execPath],['-e',"process.stdin.resume();"]);t.after(()=>worker.close());
  await assert.rejects(worker.request({action:'test'},{timeout:5000,ackTimeout:100}),error=>error.code==='worker_ipc_timeout'&&error.stage==='worker/read'&&error.mayHaveStarted===false);
});
