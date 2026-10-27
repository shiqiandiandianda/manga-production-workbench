import test from 'node:test';
import assert from 'node:assert/strict';
import {jobTiming,formatJobTime} from '../public/job-timing.js';
const example={status:'done',created:'2026-10-12T11:29:06.629Z',startedAt:'2026-10-12T11:29:06.655Z',generationStartedAt:'2026-10-12T11:30:49.685Z',completedAt:'2026-10-12T11:32:22.922Z'};

test('已有任务的总处理包含生图，历史缺少结束事件时仅显示已知分段估算',()=>{
 const t=jobTiming(example);assert.equal(t.totalMs,196267);assert.equal(t.preImageMs,103030);assert.equal(t.imageMs,null);assert.equal(t.outputMs,null);assert.equal(t.estimatedImageAndOutputMs,93237);
 assert.match(formatJobTime(example),/总处理 3分16秒（包含以下阶段） · 生图前 1分43秒 · 生图及收尾约 1分33秒/);
 assert.ok(!formatJobTime(example).includes('收尾 1分43秒'));
});

test('新任务使用单调时钟的原生生图耗时，分段与总处理不会重复相加',()=>{
 const job={...example,generationCompletedAt:'2026-10-12T11:32:22.455Z',timings:{imageGenerationMs:92770,dispatchEffort:'low'}},t=jobTiming(job);
 assert.equal(t.imageMs,92770);assert.equal(t.outputMs,467);assert.equal(t.preImageMs+t.imageMs+t.outputMs,t.totalMs);
 assert.match(formatJobTime(job),/生图 1分32秒 · 收尾 0秒/);assert.equal(t.effort,'low');
});

test('生图结束后界面只增加收尾时间，原生生图时间保持固定',()=>{
 const base=Date.parse('2026-10-12T12:00:00Z'),job={status:'running',created:new Date(base).toISOString(),startedAt:new Date(base).toISOString(),generationStartedAt:new Date(base+10000).toISOString(),generationCompletedAt:new Date(base+40000).toISOString(),imageGenerationMs:30000};
 assert.equal(jobTiming(job,base+45000).imageMs,30000);assert.equal(jobTiming(job,base+45000).outputMs,5000);
 assert.equal(jobTiming(job,base+55000).imageMs,30000);assert.equal(jobTiming(job,base+55000).outputMs,15000);
 assert.match(formatJobTime(job,base+55000),/生图 30秒 · 收尾 15秒/);
});

test('排队、等待批准与没有开始时间的历史状态显示有效耗时',()=>{
 assert.equal(formatJobTime({status:'queued',created:'2026-10-12T12:00:00Z'},Date.parse('2026-10-12T12:00:12Z')),'排队 12秒');
 assert.equal(formatJobTime({status:'awaiting_confirmation',created:'2026-10-12T12:00:00Z',startedAt:'2026-10-12T12:00:01Z',updated:'2026-10-12T12:00:03Z'},Date.parse('2026-10-12T12:00:09Z')),'已处理 2秒 · 等待批准 6秒');
 assert.equal(formatJobTime({status:'failed',created:'2026-10-12T12:00:00Z',updated:'2026-10-12T12:00:20Z'}),'总耗时 20秒');
});
