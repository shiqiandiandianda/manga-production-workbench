import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {CodexBridge} from '../lib/codex.mjs';
import {bridgeError,cancelledError} from '../lib/process.mjs';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==','base64');
const input={action:'generate',shot:{description:'桥接测试'},style:'测试画风',panel:{w:200,h:100,points:[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}]},referenceRoles:[]};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const gate=()=>{let release;const promise=new Promise(resolve=>release=resolve);return {promise,release};};
function produce(payload){
  if(payload.action==='status')return {connected:true,transport:'app-server / stdio'};
  if(payload.action==='probe')return {connected:true,sessionReady:true,probeOnly:true,turnStartSent:false,transport:'app-server / stdio'};
  const savedPath=path.join(payload.directory,'out','native.png');fs.writeFileSync(savedPath,png);
  const result={savedPath,imageToolSeen:true,description:'仅用于桥接回归测试',timings:{prepareMs:1,nativeMs:1}};fs.writeFileSync(path.join(payload.directory,'result.json'),JSON.stringify(result));return result;
}
function fixture(t,handler=async payload=>produce(payload),options={}){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'comic-bridge-test-')),workers=[],requests=[],commands=[];
  const workerFactory=(command,args,settings)=>{
    const worker={closed:false,busy:false,pending:null,request(payload,{signal,onEvent}={}){
      assert.equal(this.busy,false,'每个持久 worker 必须串行');this.busy=true;requests.push({worker:this,payload,settings});
      return new Promise((resolve,reject)=>{
        const abort=()=>this.close(cancelledError());let finished=false;
        const finish=(error,result)=>{if(finished)return;finished=true;this.busy=false;this.pending=null;signal?.removeEventListener('abort',abort);if(error)reject(error);else resolve(result);};
        this.pending=finish;signal?.addEventListener('abort',abort,{once:true});
        if(signal?.aborted){abort();return;}
        Promise.resolve().then(()=>handler(payload,{worker:this,onEvent})).then(result=>finish(null,result),error=>finish(error));
      });
    },close(error=bridgeError('测试连接关闭',{code:'worker_closed'})){this.closed=true;this.pending?.(error);}};
    workers.push(worker);return worker;
  };
  const bridge=new CodexBridge({poolSize:2,env:{...process.env,COMIC_CODEX_BIN:process.execPath,COMIC_PYTHON_BIN:process.execPath,OPENAI_API_KEY:'test-must-not-pass',CODEX_API_KEY:'test-must-not-pass'},workerFactory,runner:async(command,args)=>{commands.push(args);return {code:0,stdout:args[0]==='--version'?'codex-test':'image_generation experimental true',stderr:''};},...options});
  const task=name=>{const taskDirectory=path.join(directory,name);fs.mkdirSync(taskDirectory);return taskDirectory;};
  t.after(()=>{bridge.close();assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(directory,{recursive:true,force:true});});
  return {bridge,task,workers,requests,commands,directory};
}

test('文字修订使用独立动作并复用连接，返回提示词，不走生图动作',async t=>{
 const f=fixture(t,async payload=>{assert.equal(payload.action,'rewrite-prompt');return {prompt:'按意见修改的完整提示词'};});
 const result=await f.bridge.rewritePrompt(f.task('rewrite'),{},{});assert.equal(result.prompt,'按意见修改的完整提示词');assert.equal(f.requests.length,1);assert.equal(f.commands.length,0);
});
test('文字修订返回空结果时失败，取消信号可中断等待',async t=>{
 const f=fixture(t,async()=>({prompt:''}));await assert.rejects(f.bridge.rewritePrompt(f.task('invalid'),{},{}),/有效/);
 const wait=gate(),g=fixture(t,()=>wait.promise),controller=new AbortController(),promise=g.bridge.rewritePrompt(g.task('cancel'),{},{signal:controller.signal});await tick();controller.abort();await assert.rejects(promise,/取消/);wait.release({prompt:'迟到结果'});
});
test('连续镜头复用持久 worker，generate 不重复执行状态和CLI检查',async t=>{
  const f=fixture(t);
  for(let i=0;i<5;i++){const result=await f.bridge.generate(f.task('shot-'+i),input,[]);assert.deepEqual(result.bytes,png);assert.equal(result.imageToolSeen,true);}
  assert.equal(f.workers.length,1);assert.equal(f.requests.length,5);assert.ok(f.requests.every(request=>request.payload.action==='generate'));assert.equal(f.commands.length,0);
  const settings=f.requests[0].settings;assert.equal(settings.env.OPENAI_API_KEY,undefined);assert.equal(settings.env.CODEX_API_KEY,undefined);assert.equal(settings.env.PYTHONUTF8,'1');assert.equal(settings.env.PYTHONIOENCODING,'utf-8:strict');assert.equal(path.resolve(settings.env.TEMP),path.resolve(import.meta.dirname,'../.runtime/temp'));assert.equal(path.resolve(settings.env.PYTHONPYCACHEPREFIX),path.resolve(import.meta.dirname,'../.runtime/pycache'));
});

test('三个并发镜头只创建两个 worker，空闲后复用连接继续第三个',async t=>{
  const held=gate(),f=fixture(t,async payload=>{await held.promise;return produce(payload);});
  const tasks=[0,1,2].map(i=>f.bridge.generate(f.task('parallel-'+i),input,[]));await tick();
  assert.equal(f.workers.length,2);assert.equal(f.requests.length,2);assert.equal(f.bridge.waiters.length,1);
  held.release();await Promise.all(tasks);assert.equal(f.workers.length,2);assert.equal(f.requests.length,3);
});

test('六路 Codex worker 同时运行，额外任务排队并复用空闲连接',async t=>{
  const held=gate(),f=fixture(t,async payload=>{await held.promise;return produce(payload);},{poolSize:6});
  const tasks=Array.from({length:9},(_,i)=>f.bridge.generate(f.task('six-'+i),input,[]));await tick();
  assert.equal(f.workers.length,6);assert.equal(f.requests.length,6);assert.equal(f.bridge.waiters.length,3);
  held.release();await Promise.all(tasks);assert.equal(f.workers.length,6);assert.equal(f.requests.length,9);
});

test('运行中将 Codex 连接池从两路扩到八路，不中断原任务且第九路等待',async t=>{
  const held=gate(),f=fixture(t,async payload=>{await held.promise;return produce(payload);});
  const tasks=Array.from({length:9},(_,i)=>f.bridge.generate(f.task('eight-'+i),input,[]));await tick();
  assert.equal(f.requests.length,2);f.bridge.ensurePoolSize(8);await tick();
  assert.equal(f.bridge.slots.length,8);assert.equal(f.workers.length,8);assert.equal(f.requests.length,8);assert.equal(f.bridge.waiters.length,1);
  f.bridge.ensurePoolSize(20);assert.equal(f.bridge.slots.length,8);
  held.release();await Promise.all(tasks);assert.equal(f.requests.length,9);
});

test('取消等待连接的镜头不会发送生成请求或影响另外两个镜头',async t=>{
  const held=gate(),f=fixture(t,async payload=>{await held.promise;return produce(payload);}),controller=new AbortController();
  const first=f.bridge.generate(f.task('first'),input,[]),second=f.bridge.generate(f.task('second'),input,[]),waiting=f.bridge.generate(f.task('waiting'),input,[],{signal:controller.signal});
  const cancelled=assert.rejects(waiting,error=>error.code==='COMIC_CANCELLED');await tick();controller.abort();await cancelled;
  assert.equal(f.requests.length,2);assert.ok(f.workers.every(worker=>!worker.closed));held.release();await Promise.all([first,second]);
});

test('取消运行镜头仅淘汰该 worker，另一个继续，下一镜头使用新连接',async t=>{
  const held=gate(),f=fixture(t,async payload=>{if(payload.directory.endsWith('other'))await held.promise;else if(payload.directory.endsWith('cancel'))await new Promise(()=>{});return produce(payload);}),controller=new AbortController();
  const cancelledDirectory=f.task('cancel'),running=f.bridge.generate(cancelledDirectory,input,[],{signal:controller.signal}),other=f.bridge.generate(f.task('other'),input,[]);
  const rejected=assert.rejects(running,error=>error.code==='COMIC_CANCELLED');await tick();controller.abort();await rejected;
  assert.equal(f.workers.filter(worker=>worker.closed).length,1);assert.equal(f.workers.filter(worker=>!worker.closed).length,1);
  await f.bridge.generate(f.task('replacement'),input,[]);assert.equal(f.workers.length,3);held.release();await other;
});

test('预先取消的镜头不建worker，operation兼容句柄取消也不暴露共享pid',async t=>{
  const f=fixture(t),controller=new AbortController();controller.abort();
  await assert.rejects(f.bridge.generate(f.task('already-cancelled'),input,[],{signal:controller.signal}),error=>error.code==='COMIC_CANCELLED');assert.equal(f.workers.length,0);
  await assert.rejects(f.bridge.generate(f.task('handle-cancelled'),input,[],{onChild:handle=>{assert.equal(handle.pid,undefined);handle.cancel();}}),error=>error.code==='COMIC_CANCELLED');assert.equal(f.workers.length,0);
});

test('状态检查合并在途请求并缓存版本/功能，显式force才刷新账号',async t=>{
  const f=fixture(t),results=await Promise.all([f.bridge.status(),f.bridge.status(),f.bridge.status()]);
  assert.ok(results.every(result=>result.connected));assert.equal(f.commands.length,2);assert.equal(f.requests.length,1);
  const cached=await f.bridge.status();assert.equal(cached.cached,true);assert.equal(f.requests.length,1);
  await f.bridge.status({force:true});assert.equal(f.commands.length,2);assert.equal(f.requests.length,2);assert.equal(f.requests[1].payload.force,true);
});

test('工作区路由超时显示临时连接失败，不误判登出；失败缓存可强制重查',async t=>{
  const f=fixture(t,async()=>{throw bridgeError('官方 Codex 工作区路由发现超时（account/read）；账号状态尚未确认。',{code:'workspace_routing_timeout',stage:'account/read',retryable:true});});
  const status=await f.bridge.status();assert.equal(status.connected,false);assert.equal(status.needsLogin,false);assert.equal(status.connectionState,'temporary_failure');assert.equal(status.errorCode,'workspace_routing_timeout');assert.equal(status.stage,'account/read');assert.match(status.message,/账号状态尚未确认/);
  await f.bridge.status();assert.equal(f.requests.length,1);await f.bridge.status({force:true});assert.equal(f.requests.length,2);
});

test('官方登录在另一个进程完成后，强制检查会回收此前未登录的空闲连接',async t=>{
  let signedIn=false;const f=fixture(t,async(payload,{worker})=>{if(worker.accountAtStart===undefined)worker.accountAtStart=signedIn;return {connected:worker.accountAtStart,transport:'app-server / stdio'};});
  const initial=await f.bridge.status();assert.equal(initial.needsLogin,true);const original=f.workers[0];signedIn=true;
  assert.equal((await f.bridge.status()).connected,false);assert.equal(f.workers.length,1);
  const refreshed=await f.bridge.status({force:true});assert.equal(refreshed.connected,true);assert.equal(refreshed.needsLogin,false);assert.equal(original.closed,true);assert.equal(f.workers.length,2);assert.equal(f.commands.length,2);
});

test('关闭连接池取消运行任务并拒绝等待任务，不留下可用连接',async t=>{
  const f=fixture(t,async()=>new Promise(()=>{}));const tasks=[0,1,2].map(i=>f.bridge.generate(f.task('closing-'+i),input,[]));
  const observed=tasks.map(task=>assert.rejects(task));await tick();f.bridge.close();await Promise.all(observed);assert.ok(f.workers.every(worker=>worker.closed));assert.equal(f.bridge.waiters.length,0);
  await assert.rejects(f.bridge.generate(f.task('after-close'),input,[]),/连接池已关闭/);
});

test('进度包含真实阶段字段，返回保留原图与阶段耗时',async t=>{
  const updates=[],f=fixture(t,async(payload,{onEvent})=>{onEvent?.({type:'progress',message:'正在生图',phase:'generating',stage:'image_generation',elapsedMs:13});return produce(payload);});
  const result=await f.bridge.generate(f.task('progress'),input,[],{onProgress:(message,event)=>updates.push({message,event})});assert.equal(updates.at(-1).event.phase,'generating');assert.equal(updates.at(-1).message,'正在生图');assert.equal(result.timings.nativeMs,1);
});

test('native标识、输出目录与对齐图路径仍逐一校验',async t=>{
  for(const mode of ['missing-native','outside-aligned','outside-native']){
    const f=fixture(t,async payload=>{const result=produce(payload);if(mode==='missing-native')result.imageToolSeen=false;if(mode==='outside-aligned')result.alignedPath=path.join(f.directory,'outside.png');if(mode==='outside-native')result.savedPath=path.join(f.directory,'outside.png');fs.writeFileSync(path.join(payload.directory,'result.json'),JSON.stringify(result));return result;});
    await assert.rejects(f.bridge.generate(f.task(mode),input,[]),mode==='missing-native'?/内置生图|测试/:/路径|目录/);
  }
});

test('参考图片哈希缓存会在文件修改后失效',async t=>{
  const f=fixture(t),reference=path.join(f.directory,'reference.png');fs.writeFileSync(reference,Buffer.from('first reference'));const first=f.bridge._digest(reference);assert.equal(f.bridge._digest(reference),first);
  fs.writeFileSync(reference,Buffer.from('changed reference'));assert.notEqual(f.bridge._digest(reference),first);
});

test('generation transport failure invalidates green cached status; only an explicit empty-session probe clears it without replaying generation',async t=>{
 const f=fixture(t,async payload=>{if(payload.action==='generate')throw bridgeError('thread/start transport closed',{code:'app_server_closed',stage:'thread/start',retryable:true});return produce(payload);});
 assert.equal((await f.bridge.status()).connected,true);assert.ok(f.bridge.statusCache);
 await assert.rejects(f.bridge._request('generate',{directory:f.task('failed-transport')}),error=>error.code==='app_server_closed');
 assert.equal(f.bridge.statusCache,null);const failed=await f.bridge.status();assert.equal(failed.connected,false);assert.equal(failed.accountConnected,true);assert.equal(failed.connectionState,'temporary_failure');assert.equal(failed.stage,'thread/start');assert.equal(failed.needsLogin,false);
 const checked=await f.bridge.status({force:true,checkSession:true});assert.equal(checked.connected,true);assert.equal(checked.sessionReady,true);assert.equal(f.requests.filter(r=>r.payload.action==='generate').length,1);assert.equal(f.requests.filter(r=>r.payload.action==='probe').length,1);
});

test('Codex 原生生成目录的结果只返回路径，不复制到任务 out',async t=>{
 const f=fixture(t),nativeRoot=path.join(f.directory,'codex-home','generated_images');fs.mkdirSync(nativeRoot,{recursive:true});f.bridge.env.CODEX_HOME=path.dirname(nativeRoot);
 const file=path.join(nativeRoot,'native.png');fs.writeFileSync(file,png);f.bridge._request=async(action,payload)=>{const result={savedPath:file,imageToolSeen:true};fs.writeFileSync(path.join(payload.directory,'result.json'),JSON.stringify(result));return result;};
 const directory=f.task('native-path'),result=await f.bridge.generate(directory,input,[]);assert.equal(result.filePath,fs.realpathSync(file));assert.deepEqual(fs.readdirSync(path.join(directory,'out')),[]);
});
