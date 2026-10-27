// 协作执行适配层测试（协议 §7.1）：真实走 createStudio 的 pump/名额/fake bridge，
// 断言结果文件校验、工作目录隔离、工程数据不被修改、坏参数 400、取消语义、重启后状态如实反映。
// fake bridge 返回的是本文件生成的合成 PNG，明确不是真实生图。
// 这些用例验证休眠的协作执行适配层；线上默认已移除团队帮忙生图。
process.env.COMIC_TEAM_HELP='1';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createStudio} from '../server.mjs';
import {Store, uid} from '../lib/store.mjs';
import {inspectImageBuffer, nowIso} from '../../协作/lib/protocol.mjs';
import {collabGenerationPayload, createComicFixture, makePng, seedProject, sha256Hex, sleep, waitFor} from './helpers/collab-fixture.mjs';

test('POST /api/collab/generation 真实调用生图桥，结果校验后写 collabResult，工作目录隔离且不碰工程', async t => {
  const fixture = await createComicFixture(t);
  await seedProject(fixture, {referenceCount: 1});
  const projectsBefore = JSON.stringify(fixture.studio.store.db.projects);
  const refFile = path.join(fixture.root, 'b-side-reference.png');
  fs.writeFileSync(refFile, makePng(20, 16, {r: 200, g: 80, b: 40}));

  const submitted = await fixture.api('/api/collab/generation', 'POST', collabGenerationPayload({referenceFile: refFile, taskId: 'task_jobs_test_1'}));
  assert.equal(submitted.status, 202);
  const jobId = submitted.value.jobId;
  assert.match(jobId, /^job_[0-9a-f-]{36}$/);

  await waitFor(async () => (await fixture.api('/api/collab/generation/' + jobId)).value.status === 'done', '协作任务没有在限定时间内完成');
  const view = (await fixture.api('/api/collab/generation/' + jobId)).value;
  assert.equal(view.status, 'done');
  assert.equal(view.phase, 'done');
  assert.equal(view.taskId, 'task_jobs_test_1');
  assert.equal(view.attempt, 1);
  assert.equal(view.interrupted, false);
  assert.ok(view.startedAt && view.completedAt);
  assert.equal(view.error, null);
  assert.ok(view.result, '完成的任务必须有 result');

  const result = view.result;
  assert.ok(fs.existsSync(result.filePath), '结果文件必须真实存在');
  assert.equal(path.dirname(path.resolve(result.filePath)), path.resolve(fixture.dataDir, 'collab', 'jobs', jobId, 'out'));
  const resultBytes = fs.readFileSync(result.filePath);
  assert.equal(result.sha256, sha256Hex(resultBytes));
  assert.equal(result.size, resultBytes.length);
  const info = inspectImageBuffer(resultBytes);
  assert.ok(info);
  assert.equal(result.mime, info.mime);
  assert.equal(result.width, info.width);
  assert.equal(result.height, info.height);
  assert.ok(fixture.studio.store.db.assets.some(asset => asset.id === result.assetId), '结果必须登记为本地资产');

  // fake bridge 确实被调用，并且用的是 collab 工作目录
  assert.equal(fixture.calls.length, 1);
  assert.equal(fixture.calls[0].directory, path.join(fixture.dataDir, 'collab', 'jobs', jobId));
  assert.equal(fixture.calls[0].options.signal?.aborted ?? false, false);

  const job = fixture.studio.store.db.jobs.find(item => item.id === jobId);
  assert.equal(job.kind, 'collab-generation');
  assert.equal(job.projectId, 'collab');
  assert.equal(job.panelId, '');
  assert.equal(job.provider, 'codex');
  assert.equal(job.shotCode, 'E01-001');
  assert.equal(job.collab.taskId, 'task_jobs_test_1');
  assert.equal(job.collab.attempt, 1);
  assert.equal(job.collab.projectId, 'project_synthetic');
  assert.equal(job.collab.panelId, 'panel_synthetic');
  assert.ok(job.collabResult && job.collabResult.sha256 === result.sha256, 'job 上必须落 collabResult');

  // 参考图登记为本地路径资产；referenceRoles 顺序/角色保持，assetId 换成本机编号
  const referenceAssets = fixture.studio.store.db.assets.filter(asset => asset.source === 'collab-reference');
  assert.equal(referenceAssets.length, 1);
  assert.equal(referenceAssets[0].filePath, fs.realpathSync(refFile));
  assert.equal(referenceAssets[0].width, 20);
  const sentReferenceRoles = fixture.calls[0].input.referenceRoles;
  assert.equal(sentReferenceRoles.length, 1);
  assert.equal(sentReferenceRoles[0].role, 'character');
  assert.equal(sentReferenceRoles[0].assetId, referenceAssets[0].id);
  assert.equal(fixture.calls[0].refs[0], fs.realpathSync(refFile));

  // 原有工程数据完全未被修改（协作任务不 apply）
  assert.equal(JSON.stringify(fixture.studio.store.db.projects), projectsBefore);

  const missing = await fixture.api('/api/collab/generation/job_00000000-0000-0000-0000-000000000000');
  assert.equal(missing.status, 404);
  assert.match(missing.value.error, /不存在/);
});

test('POST /api/collab/generation 参数校验：任务/通道/参考图数量/角色顺序/文件存在性均返回 400 中文错误', async t => {
  const fixture = await createComicFixture(t);
  const refFile = path.join(fixture.root, 'bad-params-ref.png');
  fs.writeFileSync(refFile, makePng(10, 10));
  const base = collabGenerationPayload({referenceFile: refFile});
  const cases = [
    [{...base, provider: 'dall-e'}, /不支持/],
    [{...base, taskId: ''}, /taskId/],
    [{...base, attempt: 0}, /attempt/],
    [{...base, generationInput: null}, /generationInput/],
    [{...base, referenceFiles: []}, /不一致/],
    [{...base, referenceFiles: [{role: 'scene', name: '场景', filePath: refFile}]}, /顺序不一致/],
    [{...base, referenceFiles: [{role: 'character', name: '叶麟', filePath: path.join(fixture.root, 'missing.png')}]}, /无法读取/],
    [{...base, referenceFiles: [{role: 'character', name: '叶麟'}]}, /filePath/],
  ];
  for (const [payload, expected] of cases) {
    const response = await fixture.api('/api/collab/generation', 'POST', payload);
    assert.equal(response.status, 400, '应为 400：' + JSON.stringify(payload).slice(0, 120));
    assert.match(String(response.value.error || ''), expected);
  }
  assert.equal(fixture.studio.store.db.jobs.length, 0, '坏参数不能留下 job');
  assert.equal(fixture.calls.length, 0, '坏参数不能调用生图桥');
});

test('POST /api/collab/generation/:id/cancel 复用现有取消机制，取消后不再登记结果', async t => {
  const fixture = await createComicFixture(t);
  const release = fixture.holdNext();
  const submitted = await fixture.api('/api/collab/generation', 'POST', collabGenerationPayload({shotCode: 'E01-002', taskId: 'task_cancel_1'}));
  assert.equal(submitted.status, 202);
  const jobId = submitted.value.jobId;
  await fixture.waitForCalls(1);
  // 等任务真正进入 running，确保取消的是运行中的任务
  await waitFor(async () => (await fixture.api('/api/collab/generation/' + jobId)).value.status === 'running', '任务没有进入 running');

  const cancelled = await fixture.api('/api/collab/generation/' + jobId + '/cancel', 'POST');
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.value.ok, true);
  assert.equal(cancelled.value.status, 'cancelled');
  release();
  await waitFor(async () => (await fixture.api('/api/collab/generation/' + jobId)).value.status === 'cancelled', '任务没有保持 cancelled');
  const view = (await fixture.api('/api/collab/generation/' + jobId)).value;
  assert.equal(view.result, null, '取消的任务不应登记协作结果');

  const again = await fixture.api('/api/collab/generation/' + jobId + '/cancel', 'POST');
  assert.equal(again.status, 409);
  assert.match(again.value.error, /已结束/);
});

test('服务重启后 queued/running 的协作 job 变 failed 并标记 interrupted，查询层如实反映', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'comic-collab-restart-'));
  const dataDir = path.join(root, 'data');
  const orphanId = uid('job');
  const store = new Store(dataDir);
  store.db.jobs.push({
    id: orphanId,
    kind: 'collab-generation',
    provider: 'codex',
    projectId: 'collab',
    panelId: '',
    shotId: '',
    shotCode: 'E09-001',
    shotTitle: '重启测试',
    action: 'generate',
    status: 'queued',
    phase: 'queued',
    message: '排队',
    created: nowIso(),
    updated: nowIso(),
    collab: {taskId: 'task_restart_1', attempt: 1},
  });
  store.save();
  store.close();
  const fake = {close() {}, status: async () => ({connected: true, imageFeature: true}), generate: async () => ({bytes: makePng()})};
  const studio = createStudio({dataDir, bridge: fake, jimengBridge: fake, storyboardGenerator: {close() {}}});
  await new Promise((resolve, reject) => { studio.server.once('error', reject); studio.server.listen(0, '127.0.0.1', resolve); });
  t.after(async () => {
    try { studio.close(); } catch {}
    await new Promise(resolve => studio.server.close(() => resolve()));
    fs.rmSync(root, {recursive: true, force: true});
  });
  const response = await fetch('http://127.0.0.1:' + studio.server.address().port + '/api/collab/generation/' + orphanId);
  const view = await response.json();
  assert.equal(response.status, 200);
  assert.equal(view.status, 'failed');
  assert.equal(view.interrupted, true);
  assert.match(String(view.error || view.message), /中断|未知|生成/);
  assert.equal(view.result, null);
});
