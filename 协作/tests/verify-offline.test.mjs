// 独立验证（第一阶段）：中控 / 节点协议级故障注入。
//
// 独立于实现自带测试（hub-*.test.mjs、node-*.test.mjs），由 adversarial verifier 编写。
// 原则：
//   - 真实 HTTP 服务（listen(0) 随机端口）、真实 hub-server/hub-state/hub-queue/hub-assets 模块；
//   - 不 mock 被测状态机；只允许「假图片字节」与「可控时钟」；
//   - 每个场景使用独立临时目录，结束清理；全部离线，不调用真实生图/账号/外网；
//   - 断言失败时打印实际报文关键字段。
//
// 覆盖（对应任务书 a–h）：
//   a) 两节点同时 heartbeat 竞争：恰好一个 assignment、任务仅 1 条 attempt；重复心跳不重复派
//   b) 排他性并发：两个节点各 5 个并发心跳仍只派 1 次
//   c) 租约过期两种裁决：claimed→queued/abandoned；generating→verifying/unknown 且不自动重派
//   d) 中控重启：任务/节点/资产/apply 恢复；uploading 保持、done+pending 保留、令牌仍有效
//   e) 幂等提交 / 重复回传 / 旧尝试迟到结果只登记不覆盖
//   f) 共享资产并发申请、语义字段不合并、版本保留
//   g) 坏图 400 不改状态、无 token 401、node token 调 client 接口 403
//   h) 错误格式 {error,code}、PNG/JPEG 头与像素尺寸校验
//
// 运行（包内 node，TEMP/TMP 指向 开发/临时文件）：
//   $env:TEMP='...\开发\临时文件'; $env:TMP=$env:TEMP
//   & "...\开发\workbench\运行环境\node\node.exe" --test --test-concurrency=1 "开发/协作/tests/verify-offline.test.mjs"
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {sha256} from '../lib/protocol.mjs';
import {
  makePng,
  makeJpeg,
  pairDevice,
  jsonBrief,
  removeDir,
  startHub,
  tempDir,
} from './helpers/harness.mjs';

// ---------------------------------------------------------------------------
// 测试夹具
// ---------------------------------------------------------------------------
function panelTaskBody(overrides = {}) {
  return {
    idempotencyKey: 'verify-offline-panel',
    type: 'panel-generation',
    projectId: 'project_verify',
    projectName: '验证用演示漫画',
    episode: 21,
    panelCode: 'E21-003',
    panelId: 'panel_3',
    shotCode: 'E21-003',
    prompt: '叶麟站在山门前，国漫风',
    style: '国漫',
    size: {w: 1280, h: 900},
    target: {
      expected: {revision: 7, panelContentKey: 'pc_1', geometryKey: 'g_1', referenceKey: 'r_1', generationToken: 'gt_1'},
    },
    generationInput: {prompt: '叶麟站在山门前，国漫风', ratio: '16:9'},
    references: [],
    ...overrides,
  };
}

function assetRequestBody(overrides = {}) {
  return {
    projectId: 'project_asset',
    kind: 'character',
    name: '叶麟',
    form: '道袍',
    costume: '太玄道袍',
    style: '国漫',
    prompt: '叶麟标准立绘',
    size: {w: 256, h: 256},
    generationInput: {prompt: '叶麟标准立绘', ratio: '1:1'},
    references: [],
    ...overrides,
  };
}

function heartbeatBody({freeSlots = 0, running = [], journal = []} = {}) {
  return {
    freeSlots,
    running,
    local: {active: 0, queued: 0, concurrency: 4, origin: 'http://127.0.0.1:18896'},
    capabilities: {providers: ['codex'], version: '1.0.0', platform: process.platform},
    journal,
  };
}

async function uploadResult(api, {taskId, attempt, buffer, token, mime = 'image/png', headers = {}}) {
  return api('PUT', `/api/node/tasks/${encodeURIComponent(taskId)}/result`, buffer, {
    token,
    headers: {
      'content-type': mime,
      'x-attempt': String(attempt),
      'x-sha256': sha256(buffer),
      ...headers,
    },
  });
}

function brief(result) {
  return jsonBrief({
    status: result.status,
    body: result.body && typeof result.body === 'object' ? result.body : result.text,
  });
}

function assertStatus(result, expected, label) {
  assert.equal(result.status, expected, `${label}：期望 HTTP ${expected}，实际 ${result.status}；报文=${brief(result)}`);
  return result;
}

// 所有错误响应必须是 {error: 非空中文/字符串, code: machine_code}。
function assertErrorBody(result, expectedStatus, expectedCode, label) {
  assert.equal(result.status, expectedStatus, `${label}：期望 HTTP ${expectedStatus}，实际 ${result.status}；报文=${brief(result)}`);
  assert.ok(result.body && typeof result.body === 'object', `${label}：错误响应不是 JSON 对象；报文=${brief(result)}`);
  assert.equal(typeof result.body.error, 'string', `${label}：error 必须是字符串；报文=${brief(result)}`);
  assert.ok(result.body.error.length > 0, `${label}：error 不能为空；报文=${brief(result)}`);
  assert.equal(typeof result.body.code, 'string', `${label}：code 必须是字符串；报文=${brief(result)}`);
  assert.match(result.body.code, /^[a-z0-9_]+$/, `${label}：code 格式异常；报文=${brief(result)}`);
  if (expectedCode) {
    assert.equal(result.body.code, expectedCode, `${label}：期望 code=${expectedCode}，实际 ${result.body.code}；报文=${brief(result)}`);
  }
  return result;
}

async function createPanelTask(api, token, overrides = {}) {
  const result = await api('POST', '/api/tasks', panelTaskBody(overrides), {token});
  assert.equal(result.status, 201, `创建任务失败：${brief(result)}`);
  return result.body.task;
}

async function getTask(api, token, taskId) {
  const result = await api('GET', `/api/tasks/${encodeURIComponent(taskId)}`, undefined, {token});
  assert.equal(result.status, 200, `读取任务 ${taskId} 失败：${brief(result)}`);
  return result.body.task;
}

async function heartbeat(api, token, options = {}) {
  const result = await api('POST', '/api/node/heartbeat', heartbeatBody(options), {token});
  assert.equal(result.status, 200, `心跳失败：${brief(result)}`);
  return result.body;
}

async function pairAll(env, {client = true, nodes = []} = {}) {
  const pairingCode = env.runtime.hub.state.pairingCode;
  const result = {};
  if (client) result.client = await pairDevice(env.api, pairingCode, 'client', 'A电脑-验证');
  for (const name of nodes) {
    const key = name.includes('甲') ? 'nodeA' : name.includes('乙') ? 'nodeB' : name;
    result[key] = await pairDevice(env.api, pairingCode, 'node', name);
  }
  return result;
}

// ---------------------------------------------------------------------------
// 主流程：每个子场景独立中控实例
// ---------------------------------------------------------------------------
test('第一阶段：中控协议级故障注入（真实 HTTP + 真实状态机，离线）', async (t) => {
  // =========================================================================
  // a) 两节点同时 heartbeat 竞争
  // =========================================================================
  await t.test('a) 两节点同时心跳竞争：恰好一个 assignment、任务仅 1 条 attempt，重复心跳不重复派', async (t2) => {
    const dataDir = tempDir('photocraft-verify-a-');
    const env = await startHub({dataDir, config: {leaseMs: 120000, heartbeatTimeoutMs: 60000, maxTasks: 200}});
    t2.after(async () => {
      await env.close();
      removeDir(dataDir);
    });
    const {client, nodeA, nodeB} = await pairAll(env, {nodes: ['B电脑-甲', 'B电脑-乙']});
    const task = await createPanelTask(env.api, client.token, {idempotencyKey: 'verify-a-1'});

    const [first, second] = await Promise.all([
      heartbeat(env.api, nodeA.token, {freeSlots: 1}),
      heartbeat(env.api, nodeB.token, {freeSlots: 1}),
    ]);
    const assignments = [...(first.assignments || []), ...(second.assignments || [])];
    assert.equal(
      assignments.length,
      1,
      `两节点并发心跳应恰好产生 1 个 assignment，实际 ${assignments.length} 个；A=${jsonBrief(first.assignments)}，B=${jsonBrief(second.assignments)}`,
    );
    assert.equal(assignments[0].taskId, task.id, `assignment 指向了错误任务：${jsonBrief(assignments[0])}`);
    assert.equal(assignments[0].attempt, 1, `首次派单 attempt 应为 1：${jsonBrief(assignments[0])}`);
    const winner = first.assignments.length === 1 ? nodeA : nodeB;
    const detail = await getTask(env.api, client.token, task.id);
    assert.equal(detail.status, 'running', `领取后任务状态应为 running，实际 ${detail.status}`);
    assert.equal(detail.attempts.length, 1, `任务应只有 1 条 attempt，实际 ${detail.attempts.length}：${jsonBrief(detail.attempts)}`);
    assert.equal(detail.attempts[0].status, 'claimed', `attempt 状态应为 claimed，实际 ${detail.attempts[0].status}`);
    assert.equal(detail.activeAttempt, 1, `activeAttempt 应为 1，实际 ${detail.activeAttempt}`);

    // 重复心跳（含获胜节点连续 5 次）：不得重复派单
    const repeats = await Promise.all(
      Array.from({length: 5}, () => heartbeat(env.api, winner.token, {freeSlots: 2})),
    );
    const repeatAssignments = repeats.flatMap((item) => item.assignments || []);
    assert.equal(
      repeatAssignments.length,
      0,
      `任务已派发后重复心跳不得再派，实际 ${repeatAssignments.length} 个：${jsonBrief(repeatAssignments)}`,
    );
    const after = await getTask(env.api, client.token, task.id);
    assert.equal(after.attempts.length, 1, `重复心跳后 attempt 数应仍为 1，实际 ${after.attempts.length}`);
    assert.equal(after.status, 'running', `重复心跳不应改变任务状态，实际 ${after.status}`);
  });

  // =========================================================================
  // b) 排他性并发：两个节点各 5 个并发心跳
  // =========================================================================
  await t.test('b) 排他并发：两节点各 5 个并发心跳仍只派 1 次', async (t2) => {
    const dataDir = tempDir('photocraft-verify-b-');
    const env = await startHub({dataDir, config: {leaseMs: 120000, heartbeatTimeoutMs: 60000, maxTasks: 200}});
    t2.after(async () => {
      await env.close();
      removeDir(dataDir);
    });
    const {client, nodeA, nodeB} = await pairAll(env, {nodes: ['B电脑-甲', 'B电脑-乙']});

    const makeWave = (token) => Array.from({length: 5}, () => heartbeat(env.api, token, {freeSlots: 1}));

    const task1 = await createPanelTask(env.api, client.token, {idempotencyKey: 'verify-b-1'});
    const wave1 = await Promise.all([...makeWave(nodeA.token), ...makeWave(nodeB.token)]);
    const assignments1 = wave1.flatMap((item) => item.assignments || []);
    assert.equal(
      assignments1.length,
      1,
      `10 个并发心跳（每节点 5 个）只允许派 1 次，实际 ${assignments1.length} 个：${jsonBrief(assignments1)}`,
    );
    assert.equal(assignments1[0].taskId, task1.id, `派单任务错误：${jsonBrief(assignments1[0])}`);
    const detail1 = await getTask(env.api, client.token, task1.id);
    assert.equal(detail1.attempts.length, 1, `任务 1 应只有 1 条 attempt，实际 ${detail1.attempts.length}`);

    // 已派发任务再并发 10 次心跳：仍然 0 次
    const wave2 = await Promise.all([...makeWave(nodeA.token), ...makeWave(nodeB.token)]);
    const assignments2 = wave2.flatMap((item) => item.assignments || []);
    assert.equal(
      assignments2.length,
      0,
      `已领取任务不应被重复派发，实际 ${assignments2.length} 个：${jsonBrief(assignments2)}`,
    );

    // 新建第二个任务：并发 10 次心跳恰好再派 1 次，且任务 1 尝试数不变
    const task2 = await createPanelTask(env.api, client.token, {idempotencyKey: 'verify-b-2', panelCode: 'E21-004'});
    const wave3 = await Promise.all([...makeWave(nodeA.token), ...makeWave(nodeB.token)]);
    const assignments3 = wave3.flatMap((item) => item.assignments || []);
    assert.equal(
      assignments3.length,
      1,
      `第二个任务并发心跳应恰好派 1 次，实际 ${assignments3.length} 个：${jsonBrief(assignments3)}`,
    );
    assert.equal(assignments3[0].taskId, task2.id, `第二次派单任务错误：${jsonBrief(assignments3[0])}`);
    const detail1After = await getTask(env.api, client.token, task1.id);
    const detail2 = await getTask(env.api, client.token, task2.id);
    assert.equal(detail1After.attempts.length, 1, `任务 1 尝试数被重复写入：${detail1After.attempts.length}`);
    assert.equal(detail2.attempts.length, 1, `任务 2 尝试数异常：${detail2.attempts.length}`);
  });

  // =========================================================================
  // c) 租约过期两种裁决（小 leaseMs + 可控时钟）
  // =========================================================================
  await t.test('c) 租约过期：claimed→queued/abandoned；generating→verifying/unknown 且不自动重派', async (t2) => {
    const dataDir = tempDir('photocraft-verify-c-');
    let clock = Date.now();
    const env = await startHub({dataDir, config: {leaseMs: 2000, heartbeatTimeoutMs: 60000, maxTasks: 200}, now: () => clock});
    t2.after(async () => {
      await env.close();
      removeDir(dataDir);
    });
    const {client, nodeA, nodeB} = await pairAll(env, {nodes: ['B电脑-甲', 'B电脑-乙']});

    // 任务 1：被甲领取但未开始生成（claimed）
    const claimedTask = await createPanelTask(env.api, client.token, {idempotencyKey: 'verify-c-claimed'});
    const claimBeat = await heartbeat(env.api, nodeA.token, {freeSlots: 1});
    assert.equal(claimBeat.assignments.length, 1, `任务 1 应被领取：${jsonBrief(claimBeat.assignments)}`);
    assert.equal(claimBeat.assignments[0].taskId, claimedTask.id);
    assert.equal(claimBeat.assignments[0].attempt, 1);

    // 任务 2：被甲领取并上报 generating
    const generatingTask = await createPanelTask(env.api, client.token, {idempotencyKey: 'verify-c-generating', panelCode: 'E21-005'});
    const secondBeat = await heartbeat(env.api, nodeA.token, {freeSlots: 1});
    assert.equal(secondBeat.assignments.length, 1, `任务 2 应被领取：${jsonBrief(secondBeat.assignments)}`);
    assert.equal(secondBeat.assignments[0].taskId, generatingTask.id);
    const attempt2 = secondBeat.assignments[0].attempt;
    const progress = await env.api('POST', `/api/node/tasks/${generatingTask.id}/progress`, {
      attempt: attempt2,
      phase: 'generating',
      message: '独立验证：模拟已开始生成',
    }, {token: nodeA.token});
    assertStatus(progress, 200, '任务 2 上报 generating');

    // 推进可控时钟超过租约；用乙的空闲为 0 心跳触发全局过期裁决（不派单）
    clock += 5000;
    const sweepBeat = await heartbeat(env.api, nodeB.token, {freeSlots: 0});
    assert.ok(Array.isArray(sweepBeat.expired && sweepBeat.expired.requeued), `心跳应返回过期裁决明细：${jsonBrief(sweepBeat.expired)}`);
    assert.ok(
      (sweepBeat.expired.requeued || []).includes(claimedTask.id),
      `claimed 任务应回队：${jsonBrief(sweepBeat.expired)}`,
    );
    assert.ok(
      (sweepBeat.expired.verifying || []).includes(generatingTask.id),
      `generating 任务应转待核实：${jsonBrief(sweepBeat.expired)}`,
    );

    const claimedAfter = await getTask(env.api, client.token, claimedTask.id);
    assert.equal(claimedAfter.status, 'queued', `claimed 过期后任务应回 queued，实际 ${claimedAfter.status}`);
    assert.equal(claimedAfter.attempts.length, 1, `过期不应新增 attempt，实际 ${claimedAfter.attempts.length}`);
    assert.equal(
      claimedAfter.attempts[0].status,
      'abandoned',
      `claimed 过期后 attempt 应为 abandoned，实际 ${claimedAfter.attempts[0].status}`,
    );
    assert.equal(claimedAfter.assignedNodeId, null, `回队任务不应保留 assignedNodeId：${claimedAfter.assignedNodeId}`);

    const generatingAfter = await getTask(env.api, client.token, generatingTask.id);
    assert.equal(generatingAfter.status, 'verifying', `generating 过期后任务应转 verifying，实际 ${generatingAfter.status}`);
    assert.equal(generatingAfter.attempts.length, 1, `待核实任务不得自动新增 attempt，实际 ${generatingAfter.attempts.length}`);
    assert.equal(
      generatingAfter.attempts[0].status,
      'unknown',
      `generating 过期后 attempt 应为 unknown，实际 ${generatingAfter.attempts[0].status}`,
    );

    // 乙此时有 2 个名额：只能领回队的任务 1（第 2 次尝试），绝不能自动重派 verifying 的任务 2
    const dispatchBeat = await heartbeat(env.api, nodeB.token, {freeSlots: 2});
    const dispatched = dispatchBeat.assignments || [];
    assert.equal(dispatched.length, 1, `待核实任务不得自动重派，应只派回队任务：${jsonBrief(dispatched)}`);
    assert.equal(dispatched[0].taskId, claimedTask.id, `重派任务错误：${jsonBrief(dispatched)}`);
    assert.equal(dispatched[0].attempt, 2, `重派应使用第 2 次尝试，实际 ${dispatched[0].attempt}`);
    const generatingFinal = await getTask(env.api, client.token, generatingTask.id);
    assert.equal(generatingFinal.status, 'verifying', `待核实任务状态被改变为 ${generatingFinal.status}`);
    assert.equal(generatingFinal.attempts.length, 1, `待核实任务被自动重派：attempts=${generatingFinal.attempts.length}`);
    assert.equal(generatingFinal.activeAttempt, attempt2, `待核实任务 activeAttempt 被改变：${generatingFinal.activeAttempt}`);
  });

  // =========================================================================
  // d) 中控重启恢复：任务/节点/资产/apply；uploading 保持、done+pending 保留
  // =========================================================================
  await t.test('d) 中控重启：任务/节点/资产/apply 恢复，uploading 保持、done+pending 保留、令牌仍有效', async (t2) => {
    const dataDir = tempDir('photocraft-verify-d-');
    let clock = Date.now();
    const config = {leaseMs: 2000, heartbeatTimeoutMs: 60000, maxTasks: 200};
    const hub1 = await startHub({dataDir, config, now: () => clock});
    let hub2 = null;
    try {
      const {client, nodeA, nodeB} = await pairAll(hub1, {nodes: ['B电脑-甲', 'B电脑-乙']});
      const hubId = hub1.runtime.hub.state.hubId;
      const pairingCode = hub1.runtime.hub.state.pairingCode;

      // 1) 已完成但 apply=pending
      const doneTask = await createPanelTask(hub1.api, client.token, {idempotencyKey: 'verify-d-done', panelCode: 'E21-d1'});
      const doneBeat = await heartbeat(hub1.api, nodeA.token, {freeSlots: 1});
      assert.equal(doneBeat.assignments[0].taskId, doneTask.id, `done 任务派单错误：${jsonBrief(doneBeat.assignments)}`);
      const pngDone = makePng(60, 40, [30, 120, 210, 255]);
      await assertStatus(
        await hub1.api('POST', `/api/node/tasks/${doneTask.id}/progress`, {attempt: 1, phase: 'generating'}, {token: nodeA.token}),
        200,
        'done 任务上报 generating',
      );
      await assertStatus(await uploadResult(hub1.api, {taskId: doneTask.id, attempt: 1, buffer: pngDone, token: nodeA.token}), 200, 'done 任务上传结果');

      // 2) uploading 且没有结果（应保持等待重传）
      const uploadingTask = await createPanelTask(hub1.api, client.token, {idempotencyKey: 'verify-d-uploading', panelCode: 'E21-d2'});
      const uploadingBeat = await heartbeat(hub1.api, nodeA.token, {freeSlots: 1});
      assert.equal(uploadingBeat.assignments[0].taskId, uploadingTask.id, `uploading 任务派单错误：${jsonBrief(uploadingBeat.assignments)}`);
      await assertStatus(
        await hub1.api('POST', `/api/node/tasks/${uploadingTask.id}/progress`, {attempt: 1, phase: 'generating'}, {token: nodeA.token}),
        200,
        'uploading 任务上报 generating',
      );
      await assertStatus(
        await hub1.api('POST', `/api/node/tasks/${uploadingTask.id}/progress`, {attempt: 1, phase: 'uploading'}, {token: nodeA.token}),
        200,
        'uploading 任务上报 uploading',
      );

      // 3) 租约将过期的 claimed / generating 任务（重启时按 §5.9 裁决）
      const claimedTask = await createPanelTask(hub1.api, client.token, {idempotencyKey: 'verify-d-claimed', panelCode: 'E21-d3'});
      const claimedBeat = await heartbeat(hub1.api, nodeA.token, {freeSlots: 1});
      assert.equal(claimedBeat.assignments[0].taskId, claimedTask.id, `claimed 任务派单错误：${jsonBrief(claimedBeat.assignments)}`);
      const generatingTask = await createPanelTask(hub1.api, client.token, {idempotencyKey: 'verify-d-generating', panelCode: 'E21-d4'});
      const generatingBeat = await heartbeat(hub1.api, nodeA.token, {freeSlots: 1});
      assert.equal(generatingBeat.assignments[0].taskId, generatingTask.id, `generating 任务派单错误：${jsonBrief(generatingBeat.assignments)}`);
      await assertStatus(
        await hub1.api('POST', `/api/node/tasks/${generatingTask.id}/progress`, {attempt: 1, phase: 'generating'}, {token: nodeA.token}),
        200,
        'generating 任务上报 generating',
      );

      // 4) pending 资产 + 排队资产生成任务
      const assetCreated = await hub1.api('POST', '/api/assets/request', assetRequestBody(), {token: client.token});
      await assertStatus(assetCreated, 200, '资产申请');
      assert.equal(assetCreated.body.mode, 'create', `资产申请应为 create：${brief(assetCreated)}`);
      assert.equal(assetCreated.body.asset.status, 'pending', `初始资产应为 pending：${jsonBrief(assetCreated.body.asset && assetCreated.body.asset.status)}`);

      // 让乙也上线（重启后应只剩一条离线处理路径）
      await heartbeat(hub1.api, nodeB.token, {freeSlots: 0});
      // 推进时钟越过租约，随后关闭中控（不触发额外心跳，确保裁决发生在重启恢复阶段）
      clock += 5000;
      const assetsBefore = await hub1.api('GET', '/api/assets?projectId=project_asset&limit=100', undefined, {token: client.token});
      await assertStatus(assetsBefore, 200, '重启前资产列表');
      assert.equal(assetsBefore.body.total, 1, `重启前资产条数异常：${assetsBefore.body.total}`);

      await hub1.close();

      // ---------------- 同一 dataDir 重启 ----------------
      hub2 = await startHub({dataDir, config, now: () => clock});
      const recovery = hub2.recovery;
      assert.ok(recovery, '重启恢复摘要缺失');
      assert.equal(recovery.expiredLeases, 2, `重启恢复应发现 2 条过期租约，实际 ${jsonBrief(recovery)}`);
      assert.equal(recovery.requeued, 1, `重启恢复应回队 1 个任务，实际 ${jsonBrief(recovery)}`);
      assert.equal(recovery.verifying, 1, `重启恢复应转待核实 1 个任务，实际 ${jsonBrief(recovery)}`);
      assert.equal(recovery.uploadingWithoutResult, 1, `重启恢复应保留 1 个 uploading 任务，实际 ${jsonBrief(recovery)}`);
      assert.equal(recovery.donePendingApply, 1, `重启恢复应保留 1 个待回填任务，实际 ${jsonBrief(recovery)}`);
      assert.equal(recovery.pendingAssetRequests, 1, `重启恢复应保留 1 个 pending 资产申请，实际 ${jsonBrief(recovery)}`);
      assert.equal(recovery.nodesMarkedOffline, 2, `重启恢复应把 2 个在线节点置离线，实际 ${jsonBrief(recovery)}`);

      assert.equal(hub2.runtime.hub.state.hubId, hubId, '重启后 hubId 变化，状态未从同一 dataDir 读回');
      assert.equal(hub2.runtime.hub.state.pairingCode, pairingCode, '重启后配对码未保留');

      // 令牌仍有效 + 任务状态恢复
      const doneAfter = await getTask(hub2.api, client.token, doneTask.id);
      assert.equal(doneAfter.status, 'done', `已完成任务重启后状态异常：${doneAfter.status}`);
      assert.equal(doneAfter.result && doneAfter.result.sha256, sha256(pngDone), `已完成任务结果丢失：${jsonBrief(doneAfter.result)}`);
      assert.equal(doneAfter.apply && doneAfter.apply.status, 'pending', `done+apply=pending 未被保留：${jsonBrief(doneAfter.apply)}`);

      const uploadingAfter = await getTask(hub2.api, client.token, uploadingTask.id);
      assert.equal(uploadingAfter.status, 'uploading', `uploading 任务重其后状态应为 uploading，实际 ${uploadingAfter.status}`);
      assert.equal(uploadingAfter.result, null, `uploading 任务不应凭空出现结果：${jsonBrief(uploadingAfter.result)}`);

      const claimedAfter = await getTask(hub2.api, client.token, claimedTask.id);
      assert.equal(claimedAfter.status, 'queued', `重启后 claimed 过期任务应回 queued，实际 ${claimedAfter.status}`);
      assert.equal(claimedAfter.attempts[0].status, 'abandoned', `重启后 claimed 尝试应为 abandoned，实际 ${claimedAfter.attempts[0].status}`);

      const generatingAfter = await getTask(hub2.api, client.token, generatingTask.id);
      assert.equal(generatingAfter.status, 'verifying', `重启后 generating 过期任务应转 verifying，实际 ${generatingAfter.status}`);
      assert.equal(generatingAfter.attempts[0].status, 'unknown', `重启后 generating 尝试应为 unknown，实际 ${generatingAfter.attempts[0].status}`);

      const health = await hub2.api('GET', '/api/health');
      await assertStatus(health, 200, '重启后 health');
      assert.deepEqual(
        health.body.tasks,
        {queued: 2, running: 0, uploading: 1, verifying: 1, done: 1, failed: 0},
        `重启后 health 任务统计异常：${jsonBrief(health.body.tasks)}`,
      );

      // 节点记录保留且被置离线
      const nodesAfter = await hub2.api('GET', '/api/nodes', undefined, {token: client.token});
      await assertStatus(nodesAfter, 200, '重启后节点列表');
      assert.equal(nodesAfter.body.nodes.length, 2, `节点记录丢失：${jsonBrief(nodesAfter.body.nodes)}`);
      assert.equal(nodesAfter.body.nodes.every((node) => node.status && node.status.online === false), true, `重启后节点应全部离线：${jsonBrief(nodesAfter.body.nodes)}`);

      // 资产 pending 保留（同一事务的请求也应保留）
      const assetsAfter = await hub2.api('GET', '/api/assets?projectId=project_asset&limit=100', undefined, {token: client.token});
      await assertStatus(assetsAfter, 200, '重启后资产列表');
      assert.equal(assetsAfter.body.total, 1, `重启后 pending 资产丢失：${jsonBrief(assetsAfter.body)}`);
      assert.equal(assetsAfter.body.assets[0].status, 'pending', `重启后资产状态异常：${assetsAfter.body.assets[0].status}`);
      const requestsAfter = hub2.runtime.hub.state.assetRequests.filter((item) => item.projectId === 'project_asset');
      assert.equal(requestsAfter.length, 1, `资产申请记录丢失：${jsonBrief(requestsAfter)}`);
      assert.equal(requestsAfter[0].status, 'pending', `资产申请状态异常：${requestsAfter[0].status}`);

      // blob 文件内容持久化
      const blob = await hub2.api('GET', `/api/blobs/${sha256(pngDone)}`, undefined, {token: client.token});
      await assertStatus(blob, 200, '重启后下载结果 blob');
      assert.equal(sha256(blob.buffer), sha256(pngDone), '重启后 blob 内容不一致');

      // uploading 任务：重连节点可继续重传（不重新生成）
      const pngUploading = makePng(52, 44, [200, 90, 40, 255]);
      const retransmit = await uploadResult(hub2.api, {taskId: uploadingTask.id, attempt: 1, buffer: pngUploading, token: nodeA.token});
      await assertStatus(retransmit, 200, '重启后重传 uploading 结果');
      const uploadingFinal = await getTask(hub2.api, client.token, uploadingTask.id);
      assert.equal(uploadingFinal.status, 'done', `重传成功后 uploading 任务应为 done，实际 ${uploadingFinal.status}`);
      assert.equal(uploadingFinal.result.sha256, sha256(pngUploading), `重传结果 sha 不一致：${jsonBrief(uploadingFinal.result)}`);
      assert.equal(uploadingFinal.attempts[0].status, 'succeeded', `重传后 attempt 状态异常：${uploadingFinal.attempts[0].status}`);

      // done+pending 的 apply 可正常迁移（A 端恢复回填）
      const apply = await hub2.api('POST', `/api/tasks/${doneTask.id}/apply`, {status: 'applied', detail: '重启恢复后自动回填'}, {token: client.token});
      await assertStatus(apply, 200, '重启后回填 apply');
      assert.equal(apply.body.apply.status, 'applied', `apply 状态异常：${jsonBrief(apply.body.apply)}`);
      assert.equal(apply.body.duplicate, false, '首次 apply 不应是 duplicate');

      // 重启后节点令牌仍有效：心跳成功并重新上线
      const revive = await heartbeat(hub2.api, nodeB.token, {freeSlots: 0});
      assert.equal(revive.hubId, hubId, `心跳返回 hubId 与重启前不一致：${jsonBrief(revive.hubId)}`);
      const nodesOnline = await hub2.api('GET', '/api/nodes', undefined, {token: client.token});
      const nodeBPublic = nodesOnline.body.nodes.find((node) => node.id === nodeB.nodeId);
      assert.ok(nodeBPublic && nodeBPublic.status.online === true, `重启后节点心跳应能上线：${jsonBrief(nodeBPublic)}`);
    } finally {
      try {
        if (hub2) await hub2.close();
      } catch {}
      try {
        await hub1.close();
      } catch {}
      removeDir(dataDir);
    }
  });

  // =========================================================================
  // e) 幂等提交 / 重复回传 / 旧尝试迟到结果
  // =========================================================================
  await t.test('e) 重复提交幂等；重复回传 duplicate；旧 attempt 迟到只登记 lateResults 不覆盖', async (t2) => {
    const dataDir = tempDir('photocraft-verify-e-');
    let clock = Date.now();
    const env = await startHub({dataDir, config: {leaseMs: 2000, heartbeatTimeoutMs: 60000, maxTasks: 200}, now: () => clock});
    t2.after(async () => {
      await env.close();
      removeDir(dataDir);
    });
    const {client, nodeA, nodeB} = await pairAll(env, {nodes: ['B电脑-甲', 'B电脑-乙']});

    const body = panelTaskBody({idempotencyKey: 'verify-e-idem', prompt: '第一次提交的提示词'});
    const created = await env.api('POST', '/api/tasks', body, {token: client.token});
    await assertStatus(created, 201, '首次提交任务');
    const taskId = created.body.task.id;

    const duplicate = await env.api('POST', '/api/tasks', body, {token: client.token});
    await assertStatus(duplicate, 200, '同幂等键同内容重复提交');
    assert.equal(duplicate.body.duplicate, true, `重复提交应返回 duplicate=true：${brief(duplicate)}`);
    assert.equal(duplicate.body.task.id, taskId, '重复提交返回了不同任务');

    const conflict = await env.api('POST', '/api/tasks', {...body, prompt: '完全不同的提示词'}, {token: client.token});
    assertErrorBody(conflict, 409, 'idempotency_conflict', '同幂等键不同内容提交');

    const list = await env.api('GET', '/api/tasks?projectId=project_verify&limit=100', undefined, {token: client.token});
    await assertStatus(list, 200, '任务列表');
    assert.equal(list.body.total, 1, `重复提交不应新建任务：total=${list.body.total}`);

    // 甲领取并开始生成后租约过期 → 待核实 → 人工 retry → 乙接管
    const beatA = await heartbeat(env.api, nodeA.token, {freeSlots: 1});
    assert.equal(beatA.assignments.length, 1, `首次派单失败：${jsonBrief(beatA.assignments)}`);
    const attempt1 = beatA.assignments[0].attempt;
    await assertStatus(
      await env.api('POST', `/api/node/tasks/${taskId}/progress`, {attempt: attempt1, phase: 'generating'}, {token: nodeA.token}),
      200,
      '首次尝试上报 generating',
    );
    clock += 5000;
    const sweep = await heartbeat(env.api, nodeB.token, {freeSlots: 0});
    assert.ok((sweep.expired.verifying || []).includes(taskId), `任务应转待核实：${jsonBrief(sweep.expired)}`);
    const retry = await env.api('POST', `/api/tasks/${taskId}/retry`, {reason: '独立验证：旧尝试租约过期'}, {token: client.token});
    await assertStatus(retry, 200, '人工 retry 待核实任务');
    assert.equal(retry.body.task.status, 'queued', `retry 后应回 queued，实际 ${retry.body.task.status}`);

    const beatB = await heartbeat(env.api, nodeB.token, {freeSlots: 1});
    assert.equal(beatB.assignments.length, 1, `第二次尝试未被领取：${jsonBrief(beatB.assignments)}`);
    assert.equal(beatB.assignments[0].attempt, 2, `接手尝试号应为 2，实际 ${beatB.assignments[0].attempt}`);
    const attempt2 = beatB.assignments[0].attempt;
    await assertStatus(
      await env.api('POST', `/api/node/tasks/${taskId}/progress`, {attempt: attempt2, phase: 'generating'}, {token: nodeB.token}),
      200,
      '第二次尝试上报 generating',
    );
    await assertStatus(
      await env.api('POST', `/api/node/tasks/${taskId}/progress`, {attempt: attempt2, phase: 'uploading'}, {token: nodeB.token}),
      200,
      '第二次尝试上报 uploading',
    );
    const imageB = makePng(44, 33, [20, 160, 90, 255]);
    const uploadB = await uploadResult(env.api, {taskId, attempt: attempt2, buffer: imageB, token: nodeB.token});
    await assertStatus(uploadB, 200, '第二次尝试上传结果');
    assert.equal(uploadB.body.duplicate, false, `首次上传不应 duplicate：${brief(uploadB)}`);
    assert.equal(uploadB.body.late, false, `新尝试上传不应 late：${brief(uploadB)}`);
    assert.equal(uploadB.body.task.status, 'done', `上传后任务应 done，实际 ${uploadB.body.task.status}`);
    assert.equal(uploadB.body.task.result.sha256, sha256(imageB), '结果 sha 不一致');

    // 重复回传同 sha：duplicate，不重复入库
    const uploadBDup = await uploadResult(env.api, {taskId, attempt: attempt2, buffer: imageB, token: nodeB.token});
    await assertStatus(uploadBDup, 200, '重复回传同 sha');
    assert.equal(uploadBDup.body.duplicate, true, `重复回传应 duplicate=true：${brief(uploadBDup)}`);
    assert.equal(uploadBDup.body.task.lateResults.length, 0, `重复回传不应写入 lateResults：${jsonBrief(uploadBDup.body.task.lateResults)}`);

    // 旧 attempt 迟到结果：只登记 lateResults，不覆盖当前 result，也不触发回填
    const imageA = makePng(44, 33, [200, 40, 40, 255]);
    const lateUpload = await uploadResult(env.api, {taskId, attempt: attempt1, buffer: imageA, token: nodeA.token});
    await assertStatus(lateUpload, 200, '旧尝试迟到结果上传');
    assert.equal(lateUpload.body.late, true, `旧尝试结果应 late=true：${brief(lateUpload)}`);
    assert.equal(lateUpload.body.duplicate, false, `首次迟到结果不应 duplicate：${brief(lateUpload)}`);
    const detail = await getTask(env.api, client.token, taskId);
    assert.equal(detail.status, 'done', `迟到结果不应改变任务状态：${detail.status}`);
    assert.equal(detail.result.sha256, sha256(imageB), `迟到结果覆盖了当前结果：${jsonBrief(detail.result)}`);
    assert.equal(detail.lateResults.length, 1, `lateResults 应有 1 条，实际 ${detail.lateResults.length}`);
    assert.equal(detail.lateResults[0].sha256, sha256(imageA), `lateResults sha 错误：${jsonBrief(detail.lateResults[0])}`);
    assert.equal(detail.lateResults[0].attempt, attempt1, `lateResults attempt 错误：${jsonBrief(detail.lateResults[0])}`);
    assert.equal(detail.lateResults[0].reason, 'stale_attempt', `lateResults reason 错误：${jsonBrief(detail.lateResults[0])}`);
    assert.equal(detail.apply && detail.apply.status, 'pending', `迟到结果不应触发/改变 apply：${jsonBrief(detail.apply)}`);
    assert.equal(detail.activeAttempt, attempt2, `activeAttempt 被迟到结果改变：${detail.activeAttempt}`);

    // 同一迟到结果再传：duplicate + late，不重复登记
    const lateAgain = await uploadResult(env.api, {taskId, attempt: attempt1, buffer: imageA, token: nodeA.token});
    await assertStatus(lateAgain, 200, '重复迟到结果上传');
    assert.equal(lateAgain.body.duplicate, true, `重复迟到结果应 duplicate=true：${brief(lateAgain)}`);
    assert.equal(lateAgain.body.late, true, `重复迟到结果应 late=true：${brief(lateAgain)}`);
    const detailAgain = await getTask(env.api, client.token, taskId);
    assert.equal(detailAgain.lateResults.length, 1, `lateResults 被重复写入：${detailAgain.lateResults.length}`);

    const notifications = await env.api('GET', '/api/notifications?since=0&limit=200', undefined, {token: client.token});
    await assertStatus(notifications, 200, '通知列表');
    assert.ok(
      notifications.body.notifications.some((item) => item.type === 'task.late_result'),
      `缺少 task.late_result 通知：${jsonBrief(notifications.body.notifications.map((item) => item.type))}`,
    );
    assert.ok(
      notifications.body.notifications.some((item) => item.type === 'task.done'),
      `缺少 task.done 通知：${jsonBrief(notifications.body.notifications.map((item) => item.type))}`,
    );
  });

  // =========================================================================
  // f) 共享资产并发申请 / 语义不合并 / 版本保留
  // =========================================================================
  await t.test('f) 资产并发申请只建 1 个 pending 资产+1 任务；form/costume/style 不合并；v2 保留 v1', async (t2) => {
    const dataDir = tempDir('photocraft-verify-f-');
    const env = await startHub({dataDir, config: {leaseMs: 120000, heartbeatTimeoutMs: 60000, maxTasks: 200}});
    t2.after(async () => {
      await env.close();
      removeDir(dataDir);
    });
    const {client, nodeA} = await pairAll(env, {nodes: ['B电脑-甲']});

    // 并发 5 次同一 dedupeKey 申请：1 create + 4 join
    const baseBody = assetRequestBody();
    const responses = await Promise.all(Array.from({length: 5}, () => env.api('POST', '/api/assets/request', baseBody, {token: client.token})));
    responses.forEach((item, index) => assertStatus(item, 200, `并发资产申请 #${index + 1}`));
    const modes = responses.map((item) => item.body.mode);
    assert.equal(
      modes.filter((mode) => mode === 'create').length,
      1,
      `并发申请应恰好 1 个 create，实际 modes=${jsonBrief(modes)}`,
    );
    assert.equal(
      modes.filter((mode) => mode === 'join').length,
      4,
      `其余并发申请应为 join，实际 modes=${jsonBrief(modes)}`,
    );
    const created = responses.find((item) => item.body.mode === 'create').body;
    assert.equal(created.asset.status, 'pending', `新建资产应为 pending：${jsonBrief(created.asset)}`);
    assert.equal(created.asset.version, 1, `首个资产版本应为 1，实际 ${created.asset.version}`);
    responses.filter((item) => item.body.mode === 'join').forEach((item) => {
      assert.equal(item.body.taskId, created.task.id, `join 返回了不同任务：${jsonBrief(item.body)}`);
    });

    const assetsList = await env.api('GET', '/api/assets?projectId=project_asset&limit=100', undefined, {token: client.token});
    await assertStatus(assetsList, 200, '并发申请后资产列表');
    assert.equal(assetsList.body.total, 1, `并发申请应只产生 1 个资产，实际 ${assetsList.body.total}`);
    assert.equal(assetsList.body.assets.length, 1, `资产列表条数与 total 不一致：total=${assetsList.body.total}，count=${assetsList.body.assets.length}`);
    const queuedTasks = await env.api('GET', '/api/tasks?projectId=project_asset&status=queued&limit=100', undefined, {token: client.token});
    await assertStatus(queuedTasks, 200, '并发申请后任务列表');
    assert.equal(queuedTasks.body.total, 1, `并发申请应只产生 1 个任务，实际 ${queuedTasks.body.total}`);
    assert.equal(queuedTasks.body.tasks[0].type, 'asset-generation', `资产生成任务类型错误：${queuedTasks.body.tasks[0].type}`);

    // 完成 v1：节点领取资产生成任务并回传
    const assetBeat = await heartbeat(env.api, nodeA.token, {freeSlots: 1});
    assert.equal(assetBeat.assignments.length, 1, `资产生成任务未被领取：${jsonBrief(assetBeat.assignments)}`);
    assert.equal(assetBeat.assignments[0].taskId, created.task.id, `领取到错误任务：${jsonBrief(assetBeat.assignments)}`);
    const assetAttempt = assetBeat.assignments[0].attempt;
    await assertStatus(
      await env.api('POST', `/api/node/tasks/${created.task.id}/progress`, {attempt: assetAttempt, phase: 'generating'}, {token: nodeA.token}),
      200,
      '资产任务上报 generating',
    );
    const image1 = makePng(48, 48, [10, 200, 120, 255]);
    const assetUpload1 = await uploadResult(env.api, {taskId: created.task.id, attempt: assetAttempt, buffer: image1, token: nodeA.token});
    await assertStatus(assetUpload1, 200, '资产任务上传 v1 结果');
    const v1Detail = await env.api('GET', `/api/assets/${created.asset.id}`, undefined, {token: client.token});
    await assertStatus(v1Detail, 200, 'v1 资产详情');
    assert.equal(v1Detail.body.asset.status, 'available', `资产完成后应为 available：${v1Detail.body.asset.status}`);
    assert.equal(v1Detail.body.asset.sha256, sha256(image1), `v1 资产 sha 错误：${v1Detail.body.asset.sha256}`);
    assert.equal(v1Detail.body.asset.version, 1, `v1 资产版本错误：${v1Detail.body.asset.version}`);
    const requestRow = env.runtime.hub.state.assetRequests.find((item) => item.assetId === created.asset.id);
    assert.ok(requestRow && requestRow.status === 'done', `资产生成完成后请求应置 done：${jsonBrief(requestRow)}`);

    // 已有可用版本 → reuse
    const reuse = await env.api('POST', '/api/assets/request', baseBody, {token: client.token});
    await assertStatus(reuse, 200, '复用已有资产');
    assert.equal(reuse.body.mode, 'reuse', `已有可用版本应 reuse：${brief(reuse)}`);
    assert.equal(reuse.body.asset.id, created.asset.id, `reuse 资产 id 错误：${jsonBrief(reuse.body.asset && reuse.body.asset.id)}`);

    // forceNewVersion → v2，且 v1 保留
    const forceBody = {...baseBody, forceNewVersion: true};
    const v2Created = await env.api('POST', '/api/assets/request', forceBody, {token: client.token});
    await assertStatus(v2Created, 200, '强制新版本资产申请');
    assert.equal(v2Created.body.mode, 'create', `forceNewVersion 应 create：${brief(v2Created)}`);
    const v2Asset = v2Created.body.asset;
    assert.equal(v2Asset.version, 2, `新版本应为 v2，实际 ${v2Asset.version}`);
    assert.equal(v2Asset.parentAssetId, created.asset.id, `v2 的 parentAssetId 应指向 v1：${jsonBrief(v2Asset.parentAssetId)}`);
    assert.equal(v2Asset.lineageId, v1Detail.body.asset.lineageId, `v2 与 v1 应在同一 lineage：${jsonBrief({v2: v2Asset.lineageId, v1: v1Detail.body.asset.lineageId})}`);
    assert.equal(v2Asset.status, 'pending', `v2 初始应为 pending，实际 ${v2Asset.status}`);

    // 领取 v2 资产生成任务（此时队列中只有它）
    const v2Beat = await heartbeat(env.api, nodeA.token, {freeSlots: 1});
    assert.equal(v2Beat.assignments.length, 1, `v2 资产任务未被领取：${jsonBrief(v2Beat.assignments)}`);
    assert.equal(v2Beat.assignments[0].taskId, v2Created.body.task.id, `v2 领取到错误任务：${jsonBrief(v2Beat.assignments)}`);
    const v2Attempt = v2Beat.assignments[0].attempt;
    await assertStatus(
      await env.api('POST', `/api/node/tasks/${v2Created.body.task.id}/progress`, {attempt: v2Attempt, phase: 'generating'}, {token: nodeA.token}),
      200,
      'v2 资产任务上报 generating',
    );
    const image2 = makePng(48, 48, [120, 90, 240, 255]);
    await assertStatus(
      await uploadResult(env.api, {taskId: v2Created.body.task.id, attempt: v2Attempt, buffer: image2, token: nodeA.token}),
      200,
      'v2 资产任务上传结果',
    );

    const detailAfterV2 = await env.api('GET', `/api/assets/${created.asset.id}`, undefined, {token: client.token});
    await assertStatus(detailAfterV2, 200, 'v2 完成后资产详情');
    assert.equal(detailAfterV2.body.versions.length, 2, `同 lineage 应有 2 个版本：${jsonBrief(detailAfterV2.body.versions.map((item) => item.version))}`);
    assert.equal(detailAfterV2.body.versions[0].version, 2, `版本应按新→旧排序：${jsonBrief(detailAfterV2.body.versions.map((item) => item.version))}`);
    assert.equal(detailAfterV2.body.versions[0].sha256, sha256(image2), 'v2 内容 sha 错误');
    const v1Preserved = detailAfterV2.body.versions.find((item) => item.version === 1);
    assert.ok(v1Preserved, `v1 版本丢失：${jsonBrief(detailAfterV2.body.versions)}`);
    assert.equal(v1Preserved.status, 'available', `v1 应保持 available：${v1Preserved.status}`);
    assert.equal(v1Preserved.sha256, sha256(image1), `v1 内容被覆盖：${v1Preserved.sha256}`);

    const allVersions = await env.api('GET', '/api/assets?projectId=project_asset&allVersions=true&limit=100', undefined, {token: client.token});
    await assertStatus(allVersions, 200, '全部版本资产列表');
    assert.equal(allVersions.body.total, 2, `allVersions 应有 2 条，实际 ${allVersions.body.total}`);
    const latestOnly = await env.api('GET', '/api/assets?projectId=project_asset&limit=100', undefined, {token: client.token});
    await assertStatus(latestOnly, 200, '默认资产列表');
    assert.equal(latestOnly.body.total, 1, `默认列表只应返回最新版本：${latestOnly.body.total}`);
    assert.equal(latestOnly.body.assets[0].version, 2, `默认列表最新版本错误：${latestOnly.body.assets[0].version}`);

    // form / costume / style 任一不同都不合并；仅空白/大小写差异应归一化后合并
    const variantForm = await env.api('POST', '/api/assets/request', assetRequestBody({form: '短打'}), {token: client.token});
    await assertStatus(variantForm, 200, 'form 不同申请');
    assert.equal(variantForm.body.mode, 'create', `form 不同应新建：${brief(variantForm)}`);
    assert.equal(variantForm.body.asset.version, 1, `新 lineage 版本应为 1：${variantForm.body.asset.version}`);
    assert.notEqual(variantForm.body.asset.lineageId, v1Detail.body.asset.lineageId, 'form 不同不应并入原 lineage');

    const variantFormNormalized = await env.api('POST', '/api/assets/request', assetRequestBody({form: '  短打  ', name: ' 叶麟 '}), {token: client.token});
    await assertStatus(variantFormNormalized, 200, 'form 仅空白差异申请');
    assert.equal(
      variantFormNormalized.body.mode,
      'join',
      `仅空白/大小写差异应归一到同一 dedupeKey（join），实际 ${variantFormNormalized.body.mode}：${brief(variantFormNormalized)}`,
    );
    assert.equal(variantFormNormalized.body.taskId, variantForm.body.task.id, `归一化后应关联同一任务：${brief(variantFormNormalized)}`);

    const variantCostume = await env.api('POST', '/api/assets/request', assetRequestBody({costume: '玄色道袍'}), {token: client.token});
    await assertStatus(variantCostume, 200, 'costume 不同申请');
    assert.equal(variantCostume.body.mode, 'create', `costume 不同应新建：${brief(variantCostume)}`);

    const variantStyle = await env.api('POST', '/api/assets/request', assetRequestBody({style: '水墨'}), {token: client.token});
    await assertStatus(variantStyle, 200, 'style 不同申请');
    assert.equal(variantStyle.body.mode, 'create', `style 不同应新建：${brief(variantStyle)}`);

    const finalAssets = await env.api('GET', '/api/assets?projectId=project_asset&allVersions=true&limit=100', undefined, {token: client.token});
    await assertStatus(finalAssets, 200, '最终全部版本资产列表');
    // v1+v2（同 lineage）+ form 变体 + costume 变体 + style 变体 = 5 条
    assert.equal(finalAssets.body.total, 5, `资产总条数错误（存在错误合并/丢失）：${jsonBrief(finalAssets.body.assets.map((item) => ({v: item.version, f: item.form, c: item.costume, s: item.style})))}`);
    const pendingVariants = finalAssets.body.assets.filter((item) => item.status === 'pending');
    assert.equal(pendingVariants.length, 3, `应保留 3 个 pending 变体资产，实际 ${pendingVariants.length}`);
    const pendingQueued = await env.api('GET', '/api/tasks?projectId=project_asset&status=queued&limit=100', undefined, {token: client.token});
    await assertStatus(pendingQueued, 200, '变体任务列表');
    assert.equal(pendingQueued.body.total, 3, `应有 3 个排队资产生成任务，实际 ${pendingQueued.body.total}`);
  });

  // =========================================================================
  // 回归：列表接口缺省 limit 语义（bug#1，hub-core 已修复）
  //   历史问题：GET /api/tasks、GET /api/assets 不传 limit 时，hub-server 把 null 传进
  //   clampInteger → Number(null)=0 → 收敛为 1，列表只返回 1 条（total 仍正确）。
  //   期望：缺省 limit 使用默认 100，返回条数与 total 自洽。
  //   复现（修复前）：建 3 个任务 → GET /api/tasks（无 limit）→ tasks.length=1、total=3。
  // =========================================================================
  await t.test(
    '列表接口缺省 limit：应使用默认 100，返回条数与 total 自洽（bug#1 回归）',
    async (t3) => {
      const dataDir = tempDir('photocraft-verify-limit-');
      const env = await startHub({dataDir, config: {leaseMs: 120000, heartbeatTimeoutMs: 60000, maxTasks: 200}});
      t3.after(async () => {
        await env.close();
        removeDir(dataDir);
      });
      const {client} = await pairAll(env, {});
      for (let index = 1; index <= 3; index += 1) {
        await createPanelTask(env.api, client.token, {
          idempotencyKey: `verify-limit-task-${index}`,
          panelCode: `E21-L${index}`,
        });
      }
      for (let index = 1; index <= 3; index += 1) {
        const result = await env.api('POST', '/api/assets/request', assetRequestBody({
          projectId: 'project_limit',
          name: `验证角色${index}`,
        }), {token: client.token});
        assertStatus(result, 200, `缺省 limit 用例：创建资产 ${index}`);
      }
      const tasks = await env.api('GET', '/api/tasks', undefined, {token: client.token});
      await assertStatus(tasks, 200, '缺省 limit 任务列表');
      const assets = await env.api('GET', '/api/assets?allVersions=true', undefined, {token: client.token});
      await assertStatus(assets, 200, '缺省 limit 资产列表');
      const actual = {taskCount: tasks.body.tasks.length, taskTotal: tasks.body.total, assetCount: assets.body.assets.length, assetTotal: assets.body.total};
      const expected = {
        taskCount: Math.min(tasks.body.total, 100),
        taskTotal: tasks.body.total,
        assetCount: Math.min(assets.body.total, 100),
        assetTotal: assets.body.total,
      };
      assert.deepEqual(
        actual,
        expected,
        `缺省 limit 时列表条数应与 total 自洽（默认最多 100）；期望 ${jsonBrief(expected)}，实际 ${jsonBrief(actual)}；`
          + '复现：GET /api/tasks 与 GET /api/assets?allVersions=true 均不带 limit 参数',
      );
      // 显式 limit 仍生效（分页语义不被修复破坏）
      const limited = await env.api('GET', '/api/tasks?limit=1', undefined, {token: client.token});
      await assertStatus(limited, 200, '显式 limit=1 任务列表');
      assert.equal(limited.body.tasks.length, 1, `显式 limit=1 应只返回 1 条：${brief(limited)}`);
      assert.equal(limited.body.total, tasks.body.total, `显式 limit 不应改变 total：${limited.body.total} vs ${tasks.body.total}`);
    },
  );

  // =========================================================================
  // g/h) 鉴权、错误格式、坏图不改状态、PNG/JPEG 像素校验
  // =========================================================================
  await t.test('g/h) 坏图 400 不改状态；无 token 401；node token 调 client 接口 403；错误格式 {error,code}；PNG/JPEG 像素校验', async (t2) => {
    const dataDir = tempDir('photocraft-verify-gh-');
    const env = await startHub({dataDir, config: {leaseMs: 120000, heartbeatTimeoutMs: 60000, maxTasks: 200}});
    t2.after(async () => {
      await env.close();
      removeDir(dataDir);
    });
    const {client, nodeA} = await pairAll(env, {nodes: ['B电脑-甲']});
    const {api} = env;

    // ---- 鉴权 ----
    assertErrorBody(await api('GET', '/api/tasks'), 401, 'missing_token', '无 token 读取任务');
    assertErrorBody(await api('GET', '/api/tasks', undefined, {token: 'invalid-token'}), 401, 'invalid_token', '错误 token 读取任务');
    assertErrorBody(await api('POST', '/api/tasks', panelTaskBody(), {token: nodeA.token}), 403, 'client_token_required', '节点 token 建任务');
    assertErrorBody(await api('GET', '/api/assets', undefined, {token: nodeA.token}), 403, 'client_token_required', '节点 token 读资产');
    assertErrorBody(
      await api('POST', `/api/nodes/${nodeA.nodeId}/settings`, {paused: true}, {token: nodeA.token}),
      403,
      'client_token_required',
      '节点 token 改节点设置',
    );
    assertErrorBody(await api('POST', '/api/node/heartbeat', heartbeatBody({freeSlots: 1}), {token: client.token}), 403, 'node_token_required', '客户端 token 发心跳');
    assertErrorBody(await api('GET', '/api/tasks/task_not_exists', undefined, {token: client.token}), 404, 'task_not_found', '不存在的任务');
    assertErrorBody(await api('GET', '/api/assets/asset_not_exists', undefined, {token: client.token}), 404, 'asset_not_found', '不存在的资产');
    assertErrorBody(await api('GET', '/api/not-a-route', undefined, {token: client.token}), 404, 'not_found', '不存在的路由');
    assertErrorBody(await api('GET', `/api/blobs/${'f'.repeat(64)}`, undefined, {token: client.token}), 404, 'blob_not_found', '不存在的 blob');
    assertErrorBody(await api('POST', '/api/tasks', {}, {token: client.token}), 400, 'invalid_task_type', '空任务请求');

    // ---- 坏图上传 400 且任务状态不变 ----
    const task = await createPanelTask(api, client.token, {idempotencyKey: 'verify-gh-1'});
    const beat = await heartbeat(api, nodeA.token, {freeSlots: 1});
    assert.equal(beat.assignments.length, 1, `任务未领取：${jsonBrief(beat.assignments)}`);
    const attempt = beat.assignments[0].attempt;
    await assertStatus(
      await api('POST', `/api/node/tasks/${task.id}/progress`, {attempt, phase: 'generating'}, {token: nodeA.token}),
      200,
      '坏图测试前上报 generating',
    );

    const truncatedPng = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(8)]);
    assertErrorBody(
      await uploadResult(api, {taskId: task.id, attempt, buffer: truncatedPng, token: nodeA.token}),
      400,
      'invalid_image',
      '截断 PNG 上传',
    );
    const afterBad = await getTask(api, client.token, task.id);
    assert.equal(afterBad.status, 'running', `坏图改变了任务状态：${afterBad.status}`);
    assert.equal(afterBad.result, null, `坏图不应产生结果：${jsonBrief(afterBad.result)}`);
    assert.equal(afterBad.attempts[0].status, 'generating', `坏图改变了 attempt 状态：${afterBad.attempts[0].status}`);

    const goodPng = makePng(70, 50, [15, 80, 200, 255]);
    assertErrorBody(
      await uploadResult(api, {taskId: task.id, attempt, buffer: goodPng, token: nodeA.token, headers: {'x-sha256': 'a'.repeat(64)}}),
      400,
      'sha256_mismatch',
      'sha256 声明不一致上传',
    );
    const afterWrongSha = await getTask(api, client.token, task.id);
    assert.equal(afterWrongSha.status, 'running', `sha 不一致上传改变了任务状态：${afterWrongSha.status}`);
    assert.equal(afterWrongSha.result, null, 'sha 不一致上传不应产生结果');

    // ---- blob 图片校验：PNG / JPEG 头与像素 ----
    const blobPng = makePng(70, 50, [10, 20, 30, 255]);
    const pngBlob = await api('PUT', '/api/blobs', blobPng, {
      token: client.token,
      headers: {'content-type': 'image/png', 'x-sha256': sha256(blobPng)},
    });
    await assertStatus(pngBlob, 200, 'PNG blob 上传');
    assert.equal(pngBlob.body.mime, 'image/png', `PNG mime 错误：${jsonBrief(pngBlob.body)}`);
    assert.equal(pngBlob.body.width, 70, `PNG 宽度错误：${jsonBrief(pngBlob.body)}`);
    assert.equal(pngBlob.body.height, 50, `PNG 高度错误：${jsonBrief(pngBlob.body)}`);
    assert.equal(pngBlob.body.deduped, false, `首次上传不应 deduped：${jsonBrief(pngBlob.body)}`);

    const blobJpeg = makeJpeg(88, 66);
    const jpegBlob = await api('PUT', '/api/blobs', blobJpeg, {
      token: client.token,
      headers: {'content-type': 'image/jpeg', 'x-sha256': sha256(blobJpeg)},
    });
    await assertStatus(jpegBlob, 200, 'JPEG blob 上传');
    assert.equal(jpegBlob.body.mime, 'image/jpeg', `JPEG mime 错误：${jsonBrief(jpegBlob.body)}`);
    assert.equal(jpegBlob.body.width, 88, `JPEG 宽度错误：${jsonBrief(jpegBlob.body)}`);
    assert.equal(jpegBlob.body.height, 66, `JPEG 高度错误：${jsonBrief(jpegBlob.body)}`);

    assertErrorBody(
      await api('PUT', '/api/blobs', Buffer.from('这不是图片内容', 'utf8'), {token: client.token, headers: {'content-type': 'image/png'}}),
      400,
      'invalid_image',
      '非图片字节 blob 上传',
    );
    assertErrorBody(
      await api('PUT', '/api/blobs', Buffer.alloc(0), {token: client.token, headers: {'content-type': 'image/png'}}),
      400,
      'empty_image',
      '空 blob 上传',
    );

    // ---- 结果也可以用 JPEG，像素尺寸必须正确 ----
    const resultJpeg = makeJpeg(52, 41);
    const uploadJpeg = await uploadResult(api, {taskId: task.id, attempt, buffer: resultJpeg, token: nodeA.token, mime: 'image/jpeg'});
    await assertStatus(uploadJpeg, 200, 'JPEG 结果上传');
    assert.equal(uploadJpeg.body.task.status, 'done', `JPEG 结果上传后任务应 done：${uploadJpeg.body.task.status}`);
    assert.equal(uploadJpeg.body.task.result.mime, 'image/jpeg', `结果 mime 错误：${jsonBrief(uploadJpeg.body.task.result)}`);
    assert.equal(uploadJpeg.body.task.result.width, 52, `结果宽度错误：${jsonBrief(uploadJpeg.body.task.result)}`);
    assert.equal(uploadJpeg.body.task.result.height, 41, `结果高度错误：${jsonBrief(uploadJpeg.body.task.result)}`);
    assert.equal(uploadJpeg.body.task.result.sha256, sha256(resultJpeg), '结果 sha 错误');

    // 同幂等键不同 payload 属于客户端接口错误格式的一部分（409）
    const conflictBody = panelTaskBody({idempotencyKey: 'verify-gh-1', prompt: '另一个提示词'});
    assertErrorBody(await api('POST', '/api/tasks', conflictBody, {token: client.token}), 409, 'idempotency_conflict', '幂等键冲突');
  });
});
