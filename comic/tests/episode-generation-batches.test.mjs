import test from 'node:test';
import assert from 'node:assert/strict';
import {createEpisodeGenerationBatches} from '../lib/episode-generation-batches.mjs';
import {episodeBatchLabel} from '../public/episode-generation-batches.js';

function fixture(count=30){
 let now=1000,limit=4,random=0,blocked=new Map(),db={jobs:[]},calls=[];
 const options={db,save(){},capacity:()=>limit,clock:()=>now,random:()=>random,select:(_p,id)=>blocked.get(id),submit:async(input,hooks)=>{hooks.beforeCommit();const jobs=input.panelIds.map(panelId=>({id:'job-'+calls.length+'-'+panelId,panelId,status:'running'}));hooks.onCommitted(jobs);db.jobs.push(...jobs);calls.push(jobs);return jobs;}};
 let queue=createEpisodeGenerationBatches(options);
 const request={projectId:'p',episode:71,pageId:'page',panelIds:Array.from({length:count},(_,i)=>'panel'+i),request:{provider:'codex'}},plan=queue.start(request);
 return {get queue(){return queue;},db,calls,plan,request,options,blocked,setTime:v=>now=v,setLimit:v=>limit=v,setRandom:v=>random=v,finish:()=>calls.at(-1).forEach(j=>j.status='done'),reload(){queue.close();queue=createEpisodeGenerationBatches(options);}};
}
test('30 张超过旧 24 张限制：4/4/4/4/4/4/4/2，不重叠，每批结束后随机 60–180 秒',async()=>{
 const f=fixture();await f.queue.tick();assert.equal(f.calls.length,1);assert.equal(f.calls[0].length,4);
 for(let wave=1;wave<8;wave++){
  f.setTime(wave*1000000);await f.queue.tick();assert.equal(f.calls.length,wave,'运行中不可开下一批');
  f.finish();f.setRandom([0,.5,1][wave%3]);await f.queue.tick();const plan=f.queue.snapshot()[0];assert.equal(plan.finished,wave*4);assert.equal(plan.state,'waiting');
  assert.ok(plan.nextAt>=wave*1000000+60000&&plan.nextAt<=wave*1000000+180000);
  f.setTime(plan.nextAt-1);await f.queue.tick();assert.equal(f.calls.length,wave);
  f.setTime(plan.nextAt);await f.queue.tick();assert.equal(f.calls.length,wave+1);
 }
 f.finish();await f.queue.tick();assert.equal(f.queue.snapshot()[0].finished,30);assert.equal(f.queue.snapshot()[0].state,'done');
 assert.deepEqual(f.calls.map(b=>b.length),[4,4,4,4,4,4,4,2]);assert.equal(new Set(f.calls.flat().map(j=>j.panelId)).size,30);
});
test('去重、等待状态恢复、倒计时保持、并发变更和跳过已填图项',async()=>{
 const f=fixture(10);assert.equal(f.queue.start(f.request).id,f.plan.id);await f.queue.tick();f.finish();await f.queue.tick();
 const next=f.plan.nextAt;f.reload();await f.queue.tick();assert.equal(f.calls.length,1);assert.equal(f.plan.nextAt,next);
 f.blocked.set('panel4','已有图片');f.setLimit(3);f.setTime(next);await f.queue.tick();assert.deepEqual(f.calls[1].map(j=>j.panelId),['panel5','panel6','panel7']);assert.equal(f.queue.snapshot()[0].skipped,1);
 f.queue.stop(f.plan.id);f.finish();f.setTime(next+999999);await f.queue.tick();assert.equal(f.calls.length,2);assert.equal(f.queue.snapshot()[0].state,'stopped');
});
test('崩溃恢复已持久化的批次只跟踪原任务；未知状态与待批准不会触发下一批',async()=>{
 const f=fixture(6);await f.queue.tick();f.plan.state='submitting';f.reload();await f.queue.tick();assert.equal(f.calls.length,1);
 for(const status of ['recoverable','awaiting_confirmation','delegated']){f.calls[0].forEach(j=>j.status=status);f.setTime(999999);await f.queue.tick();assert.equal(f.calls.length,1);assert.equal(f.plan.state,'running');}
 f.finish();await f.queue.tick();assert.equal(f.plan.state,'waiting');
});
test('提交准备期间停止能阻断迟到提交，失败不会自动重试',async()=>{
 const f=fixture();let release;f.options.submit=async(input,hooks)=>{await new Promise(r=>release=r);hooks.beforeCommit();throw Error('不应继续');};f.reload();const pending=f.queue.tick();f.queue.stop(f.plan.id);release();await pending;assert.equal(f.calls.length,0);assert.equal(f.plan.state,'stopped');
 const g=fixture();g.options.submit=async()=>{throw Error('参考文件缺失');};g.reload();await g.queue.tick();assert.equal(g.plan.state,'failed');assert.match(g.plan.message,/参考文件缺失/);g.setTime(999999);await g.queue.tick();assert.equal(g.calls.length,0);
});
test('提交前崩溃且尚未存入任何任务，重启后仅建立一次本地批次；最后一批失败也会结束',async()=>{
 const f=fixture(4);Object.assign(f.plan,{state:'submitting',wave:1,cursor:4,waveStart:0});f.reload();await f.queue.tick();assert.equal(f.calls.length,1);f.calls[0].forEach(j=>j.status='failed');await f.queue.tick();const p=f.queue.snapshot()[0];assert.equal(p.state,'done');assert.equal(p.failed,4);assert.equal(p.finished,4);assert.match(episodeBatchLabel(p),/失败 4/);
});
