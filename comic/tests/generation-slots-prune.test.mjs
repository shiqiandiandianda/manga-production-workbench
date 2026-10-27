// 生成队列记录不再无限增长：已结束记录只留最近 24 小时 / 约 1000 条；进行中的从不清理，最近结束的仍拒绝重复提交。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {GenerationSlots} from '../lib/generation-slots.mjs';

function slots(t,options={}){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'slots-prune-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return {dir,slots:new GenerationSlots({directory:dir,limit:6,isAlive:()=>true,...options})};}

test('已结束的生成记录有上限，文件大小与单次耗时不再随历史增长',async t=>{
 const {dir,slots:s}=slots(t);
 for(let i=0;i<6500;i++){const lease=s.tryAcquire({ownerId:'comic:job_'+i,requestId:'attempt_'+i});lease.release({completed:true});}
 const ended=Object.values(s.state.requests).filter(r=>r.status!=='active').length;
 assert.ok(ended<=1200,String(ended));
 assert.ok(fs.statSync(path.join(dir,'leases.json')).size<160*1024);
 // 最近结束的身份仍拒绝重复提交
 assert.throws(()=>s.tryAcquire({ownerId:'comic:job_6499',requestId:'attempt_6499'}),/已结束/);
});

test('超过 24 小时的已结束记录被清理，进行中的租约和记录保留',t=>{
 const {slots:s}=slots(t);
 const active=s.tryAcquire({ownerId:'comic:active',requestId:'a1'});
 s.state.requests['comic:old:r1']={status:'released',endedAt:Date.now()-25*3600*1000};s.lastPrune=0;
 s.state.requests['comic:recent:r1']={status:'released',endedAt:Date.now()-3600*1000};
 s.save();
 assert.equal(s.state.requests['comic:old:r1'],undefined);
 assert.equal(s.state.requests['comic:recent:r1'].status,'released');
 assert.equal(s.state.requests['comic:active:a1'].status,'active');
 const reopened=new GenerationSlots({directory:path.dirname(s.file),limit:6,isAlive:()=>true});
 assert.equal(reopened.state.leases.length,1);active.release({completed:true});
});
