import test from 'node:test';
import assert from 'node:assert/strict';
import {createServiceRecovery} from '../service-recovery.mjs';
function fixture(options={}){
 let clock=1000,live=false,blocked=false,portFree=true,starts=0;const events=[];
 const recovery=createServiceRecovery({now:()=>clock,alive:()=>live,blocked:()=>blocked,available:async()=>portFree,start:async()=>{starts++;live=true;},log:(...v)=>events.push(v),...options});
 return {recovery,events,setClock:v=>clock=v,setLive:v=>live=v,setBlocked:v=>blocked=v,setPort:v=>portFree=v,starts:()=>starts};
}
test('退出记录保留代码和信号，恢复一次且不触碰仍在运行的进程',async()=>{
 const f=fixture();f.recovery.exited({pid:123,code:1,signal:null});assert.equal(await f.recovery.tick(),false);f.setClock(2000);assert.equal(await f.recovery.tick(),true);assert.equal(await f.recovery.tick(),false);assert.equal(f.starts(),1);assert.equal(f.recovery.status().lastExit.code,1);
});
test('升级和主动关闭期间不恢复；被占用的端口不停止或替换',async()=>{
 const f=fixture();f.setBlocked(true);f.recovery.exited({code:0});f.setClock(9999);assert.equal(await f.recovery.tick(),false);assert.equal(f.recovery.status().lastExit.expected,true);f.setBlocked(false);f.setPort(false);assert.equal(await f.recovery.tick(),false);assert.equal(f.starts(),0);assert.match(f.recovery.status().lastError,/占用/);
});
test('连续失败最多三次，窗口内暂停，防止无限重启',async()=>{
 const f=fixture({start:async()=>{throw Error('crash');}});for(const n of [1000,6100,22000]){f.setClock(n);await f.recovery.tick();}f.setClock(90000);await f.recovery.tick();assert.equal(f.recovery.status().attempts,3);assert.equal(f.events.filter(e=>e[0]==='recovering').length,3);assert.match(f.recovery.status().lastError,/暂停/);
});
test('并发检查只启动一次，等待端口期间进入升级则取消恢复',async()=>{
 let release;const wait=new Promise(r=>release=r),f=fixture({available:()=>wait});const first=f.recovery.tick();assert.equal(await f.recovery.tick(),false);f.setBlocked(true);release(true);await first;assert.equal(f.starts(),0);
});
