// 中控任务队列单元测试（全部离线、临时目录、可控时钟）。
// 覆盖：排他派单、租约过期两种裁决、重启恢复、幂等建任务、重复回传、旧尝试迟到、cancel/retry、apply 只迁移一次、journal 裁决。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import {HubState} from '../lib/hub-state.mjs';
import {HubQueue} from '../lib/hub-queue.mjs';
import {HubAssets} from '../lib/hub-assets.mjs';
import {CollabError, sha256} from '../lib/protocol.mjs';

const SILENT = {info() {}, warn() {}, error() {}};
const CLOCK_START = 1700000000000;

function crcChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(Buffer.concat([typeBuffer, data])) >>> 0, 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

// 真实可解码的 PNG（@napi-rs/canvas 能读取，用于缩略图/结果校验链路）。
function makePng(width = 32, height = 32, color = [210, 60, 60, 255]) {
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = y * stride + 1 + x * 4;
      raw[offset] = color[0];
      raw[offset + 1] = color[1];
      raw[offset + 2] = color[2];
      raw[offset + 3] = color[3];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    crcChunk('IHDR', ihdr),
    crcChunk('IDAT', zlib.deflateSync(raw)),
    crcChunk('IEND', Buffer.alloc(0)),
  ]);
}

function createStack({dataDir, clock} = {}) {
  const dir = dataDir || fs.mkdtempSync(path.join(os.tmpdir(), 'collab-hub-queue-'));
  const time = clock || {value: CLOCK_START};
  const hub = new HubState({
    dataDir: dir,
    config: {port: 0, heartbeatTimeoutMs: 15000, leaseMs: 60000, maxTasks: 200, maxNotifications: 2000},
    now: () => time.value,
    logger: SILENT,
  });
  const assets = new HubAssets({hub, logger: SILENT});
  const queue = new HubQueue({hub, assets, logger: SILENT});
  assets.attachQueue(queue);
  return {
    dir,
    clock: time,
    hub,
    assets,
    queue,
    save() {
      hub.dirty = true;
      hub.flush();
    },
    close() {
      queue.stopTimers();
      hub.close();
    },
  };
}

function pairNode(stack, name = 'B电脑') {
  return stack.hub.pair({pairingCode: stack.hub.state.pairingCode, role: 'node', name, platform: 'win32', version: '1.0.0'});
}

function dispose(stack) {
  try {
    stack.close();
  } catch {}
  try {
    fs.rmSync(stack.dir, {recursive: true, force: true});
  } catch {}
}

function pairClient(stack, name = 'A电脑') {
  return stack.hub.pair({pairingCode: stack.hub.state.pairingCode, role: 'client', name});
}

function panelPayload(overrides = {}) {
  return {
    idempotencyKey: 'E21-003@abc123@client_test',
    type: 'panel-generation',
    projectId: 'project_demo',
    projectName: '演示漫画',
    episode: 21,
    panelCode: 'E21-003',
    panelId: 'panel_3',
    shotCode: 'E21-003',
    prompt: '叶麟站在山门前，国漫风',
    style: '国漫',
    size: {w: 1280, h: 900},
    target: {expected: {revision: 7, panelContentKey: 'pc_1', geometryKey: 'g_1', referenceKey: 'r_1', generationToken: 'gt_1'}},
    generationInput: {prompt: '叶麟站在山门前，国漫风', ratio: '16:9'},
    references: [{sha256: 'a'.repeat(64), role: 'character', name: '叶麟', mime: 'image/png', size: 1024}],
    ...overrides,
  };
}

function createTask(stack, overrides = {}) {
  return stack.queue.submitTask(panelPayload(overrides), {clientId: 'client_submitter'}).task;
}

// 让任务完成（需要已分配）：进度 → 上传结果。
function completeTask(stack, task, nodeId, {attempt, buffer = makePng(20, 20), phase = true} = {}) {
  const attemptNumber = attempt || task.activeAttempt;
  if (phase) {
    stack.queue.progress(task.id, {attempt: attemptNumber, phase: 'generating', message: '开始生成'}, nodeId);
    stack.queue.progress(task.id, {attempt: attemptNumber, phase: 'uploading', message: '开始上传'}, nodeId);
  }
  return stack.queue.uploadResult(task.id, {
    attempt: attemptNumber,
    sha256: sha256(buffer),
    buffer,
    nodeId,
  });
}

test('两节点竞争同一任务：恰好一个 assignment，另一个空手', () => {
  const stack = createStack();
  try {
    pairClient(stack);
    const nodeA = pairNode(stack, 'B1');
    const nodeB = pairNode(stack, 'B2');
    const task = createTask(stack);
    const [resultA, resultB] = [stack.queue.heartbeat(nodeA.node.id, {freeSlots: 1, running: []}), stack.queue.heartbeat(nodeB.node.id, {freeSlots: 1, running: []})];
    const assignments = [...resultA.assignments, ...resultB.assignments];
    assert.equal(assignments.length, 1, '同一任务只能派给一个节点');
    const winnerId = resultA.assignments.length === 1 ? nodeA.node.id : nodeB.node.id;
    assert.equal(task.status, 'running');
    assert.equal(task.activeAttempt, 1);
    assert.equal(task.assignedNodeId, winnerId);
    assert.equal(task.attempts.length, 1);
    assert.equal(task.attempts[0].status, 'claimed');
    // 败者后续继续心跳也领不到正在执行的任务。
    const loser = winnerId === nodeA.node.id ? nodeB : nodeA;
    const retry = stack.queue.heartbeat(loser.node.id, {freeSlots: 3, running: []});
    assert.equal(retry.assignments.length, 0);
    // 派单 payload 含 generationInput 与参考图。
    assert.ok(assignments[0].payload.generationInput);
    assert.equal(assignments[0].references.length, 1);
  } finally {
    dispose(stack);
  }
});

test('租约过期：claimed → queued/abandoned 可重派；generating → verifying/unknown 不自动重派', () => {
  const stack = createStack();
  try {
    const node1 = pairNode(stack, 'B1');
    const node2 = pairNode(stack, 'B2');
    // 场景一：claimed 过期
    const claimedTask = createTask(stack, {idempotencyKey: 'k-claimed'});
    stack.queue.heartbeat(node1.node.id, {freeSlots: 1, running: []});
    assert.equal(claimedTask.status, 'running');
    stack.clock.value += 61000 + 1000;
    const sweep1 = stack.queue.sweepExpiredLeases();
    assert.deepEqual(sweep1.requeued, [claimedTask.id]);
    assert.equal(claimedTask.status, 'queued');
    assert.equal(claimedTask.attempts[0].status, 'abandoned');
    const reassign = stack.queue.heartbeat(node2.node.id, {freeSlots: 1, running: []});
    assert.equal(reassign.assignments.length, 1);
    assert.equal(reassign.assignments[0].taskId, claimedTask.id);
    assert.equal(reassign.assignments[0].attempt, 2);
    assert.equal(claimedTask.activeAttempt, 2);
    assert.equal(claimedTask.attempts.length, 2, '旧尝试永久保留');

    // 场景二：generating 过期
    stack.clock.value = CLOCK_START + 300000;
    const generatingTask = createTask(stack, {idempotencyKey: 'k-generating'});
    stack.queue.heartbeat(node1.node.id, {freeSlots: 2, running: []});
    stack.queue.progress(generatingTask.id, {attempt: 1, phase: 'generating'}, node1.node.id);
    stack.clock.value += 61000 + 1000;
    const sweep2 = stack.queue.sweepExpiredLeases();
    assert.deepEqual(sweep2.verifying, [generatingTask.id]);
    assert.equal(generatingTask.status, 'verifying');
    assert.equal(generatingTask.attempts[0].status, 'unknown');
    // 节点再心跳也不会被派单（禁止自动重派）。
    const after = stack.queue.heartbeat(node2.node.id, {freeSlots: 3, running: []});
    assert.equal(after.assignments.some((item) => item.taskId === generatingTask.id), false);
    assert.equal(generatingTask.status, 'verifying');
    // 人工核实无结果 → 失败，然后可以重试。
    stack.queue.verifyTask(generatingTask.id, {attempt: 1, outcome: 'no_result', message: '本机无 job'}, node1.node.id);
    assert.equal(generatingTask.status, 'failed');
    const retried = stack.queue.retryTask(generatingTask.id, {reason: '人工重试'});
    assert.equal(retried.task.status, 'queued');
    assert.equal(generatingTask.activeAttempt, 1);
  } finally {
    dispose(stack);
  }
});

test('中控重启恢复：续跑排盘、uploading 保持、done+apply=pending 保留、节点 token 保留', () => {
  const stack = createStack();
  let restarted = null;
  try {
    const node = pairNode(stack, 'B电脑');
    stack.hub.updateNodeSettings(node.node.id,{maxConcurrency:3}); // 本用例同时保留三条不同阶段的任务。
    const taskA = createTask(stack, {idempotencyKey: 'restart-claimed', panelCode: 'E21-001'});
    stack.queue.heartbeat(node.node.id, {freeSlots: 1, running: []}); // A 领取但未开始
    const taskB = createTask(stack, {idempotencyKey: 'restart-uploading', panelCode: 'E21-002'});
    stack.queue.heartbeat(node.node.id, {freeSlots: 2, running: [taskA.id]});
    stack.queue.progress(taskB.id, {attempt: 1, phase: 'generating'}, node.node.id);
    stack.queue.progress(taskB.id, {attempt: 1, phase: 'uploading'}, node.node.id); // 上传中断
    const taskC = createTask(stack, {idempotencyKey: 'restart-done', panelCode: 'E21-003'});
    stack.queue.heartbeat(node.node.id, {freeSlots: 2, running: [taskB.id]});
    completeTask(stack, taskC, node.node.id);
    assert.equal(taskC.status, 'done');
    assert.equal(taskC.apply.status, 'pending');
    stack.clock.value += 120000;
    stack.close();

    restarted = createStack({dataDir: stack.dir, clock: {value: stack.clock.value}});
    // 未调用恢复前：活动状态原样在盘上。
    assert.equal(restarted.hub.getTask(taskA.id).status, 'running');
    const recovery = restarted.queue.recoverAfterRestart();
    assert.equal(recovery.expiredLeases, 1);
    assert.equal(recovery.requeued, 1);
    assert.equal(recovery.uploadingWithoutResult, 1);
    assert.equal(recovery.donePendingApply, 1);
    // claimed 过期 → 回队
    assert.equal(restarted.hub.getTask(taskA.id).status, 'queued');
    assert.equal(restarted.hub.getTask(taskA.id).attempts[0].status, 'abandoned');
    // uploading 且无结果 → 保持，等待节点重传
    assert.equal(restarted.hub.getTask(taskB.id).status, 'uploading');
    assert.equal(restarted.hub.getTask(taskB.id).result, null);
    // 已完成但 apply=pending → 原样保留
    assert.equal(restarted.hub.getTask(taskC.id).status, 'done');
    assert.equal(restarted.hub.getTask(taskC.id).apply.status, 'pending');
    // 节点 token / 节点记录保留
    assert.ok(restarted.hub.findClientByToken(node.token), '重启后节点 token 仍有效');
    assert.equal(restarted.hub.getNode(node.node.id).name, 'B电脑');
    // 重启后节点心跳继续领到回队的任务
    const heartbeat = restarted.queue.heartbeat(node.node.id, {freeSlots: 2, running: []});
    assert.equal(heartbeat.assignments.some((item) => item.taskId === taskA.id), true);
    assert.equal(heartbeat.assignments.some((item) => item.taskId === taskB.id), false);
    assert.equal(heartbeat.assignments.some((item) => item.taskId === taskC.id), false);
    assert.equal(restarted.hub.getNode(node.node.id).status.online, true);
  } finally {
    try {
      stack.close();
    } catch {}
    if (restarted) dispose(restarted);
    try {
      fs.rmSync(stack.dir, {recursive: true, force: true});
    } catch {}
  }
});

test('幂等建任务：同键同 payload → duplicate；同键不同 payload → 409', () => {
  const stack = createStack();
  try {
    const first = stack.queue.submitTask(panelPayload(), {clientId: 'client_a'});
    assert.equal(first.duplicate, false);
    const second = stack.queue.submitTask(panelPayload(), {clientId: 'client_a'});
    assert.equal(second.duplicate, true);
    assert.equal(second.task.id, first.task.id);
    assert.equal(stack.hub.state.tasks.length, 1);
    assert.throws(
      () => stack.queue.submitTask(panelPayload({prompt: '完全不同的提示词'}), {clientId: 'client_a'}),
      (error) => error instanceof CollabError && error.status === 409 && error.code === 'idempotency_conflict',
    );
    // 缺省幂等键：同 payload 自动视为同一次提交。
    const auto1 = stack.queue.submitTask(panelPayload({idempotencyKey: ''}), {clientId: 'client_b'});
    const auto2 = stack.queue.submitTask(panelPayload({idempotencyKey: ''}), {clientId: 'client_b'});
    assert.equal(auto1.duplicate, false);
    assert.equal(auto2.duplicate, true);
    assert.equal(auto2.task.id, auto1.task.id);
  } finally {
    dispose(stack);
  }
});

test('结果回传：坏图 400 不改状态；重复同 sha duplicate；apply 只从 pending 迁移一次', () => {
  const stack = createStack();
  try {
    const node = pairNode(stack, 'B电脑');
    const task = createTask(stack);
    stack.queue.heartbeat(node.node.id, {freeSlots: 1, running: []});
    stack.queue.progress(task.id, {attempt: 1, phase: 'generating'}, node.node.id);
    stack.queue.progress(task.id, {attempt: 1, phase: 'uploading'}, node.node.id);
    // 坏图：400，任务状态保持 uploading
    assert.throws(
      () => stack.queue.uploadResult(task.id, {attempt: 1, buffer: Buffer.from('not an image'), nodeId: node.node.id}),
      (error) => error instanceof CollabError && error.status === 400 && error.code === 'invalid_image',
    );
    assert.equal(task.status, 'uploading');
    assert.equal(task.result, null);
    // 声明 sha 与实际不一致：400
    const png = makePng(24, 18);
    assert.throws(
      () => stack.queue.uploadResult(task.id, {attempt: 1, sha256: 'b'.repeat(64), buffer: png, nodeId: node.node.id}),
      (error) => error instanceof CollabError && error.status === 400 && error.code === 'sha256_mismatch',
    );
    assert.equal(task.status, 'uploading');
    // 正常上传 → done + apply=pending
    const success = stack.queue.uploadResult(task.id, {attempt: 1, sha256: sha256(png), buffer: png, nodeId: node.node.id});
    assert.equal(success.ok, true);
    assert.equal(success.duplicate, false);
    assert.equal(task.status, 'done');
    assert.equal(task.phase, 'done');
    assert.equal(task.result.sha256, sha256(png));
    assert.equal(task.result.width, 24);
    assert.equal(task.result.height, 18);
    assert.equal(task.apply.status, 'pending');
    // 重复回传同 sha → duplicate，不重复登记
    const duplicate = stack.queue.uploadResult(task.id, {attempt: 1, sha256: sha256(png), buffer: png, nodeId: node.node.id});
    assert.equal(duplicate.duplicate, true);
    assert.equal(task.lateResults.length, 0);
    // apply 只迁移一次
    const applied = stack.queue.applyTask(task.id, {status: 'applied', detail: '自动回填成功', by: 'client_a'});
    assert.equal(applied.ok, true);
    assert.equal(applied.duplicate, false);
    assert.equal(task.apply.status, 'applied');
    const again = stack.queue.applyTask(task.id, {status: 'applied', detail: '自动回填成功', by: 'client_a'});
    assert.equal(again.duplicate, true);
    assert.throws(
      () => stack.queue.applyTask(task.id, {status: 'conflict', detail: '改主意'}),
      (error) => error instanceof CollabError && error.status === 409 && error.code === 'apply_already_settled',
    );
  } finally {
    dispose(stack);
  }
});

test('旧尝试迟到结果：写入 lateResults 并通知，不覆盖当前 result/apply', () => {
  const stack = createStack();
  try {
    const node1 = pairNode(stack, 'B1');
    const node2 = pairNode(stack, 'B2');
    const task = createTask(stack, {idempotencyKey: 'late-stale'});
    stack.queue.heartbeat(node1.node.id, {freeSlots: 1, running: []}); // attempt 1 归 node1
    stack.queue.progress(task.id, {attempt: 1, phase: 'generating'}, node1.node.id);
    // 租约过期 → 待核实；人工重试 → 新尝试
    stack.clock.value += 61000;
    stack.queue.sweepExpiredLeases();
    stack.queue.retryTask(task.id, {reason: '租约过期后重试'});
    const assign = stack.queue.heartbeat(node2.node.id, {freeSlots: 1, running: []});
    assert.equal(assign.assignments.length, 1);
    assert.equal(assign.assignments[0].attempt, 2);
    const newImage = makePng(30, 30, [20, 120, 220, 255]);
    completeTask(stack, task, node2.node.id, {attempt: 2, buffer: newImage});
    assert.equal(task.status, 'done');
    const currentSha = task.result.sha256;
    // 旧尝试（#1）迟到上传不同图片
    const lateImage = makePng(30, 30, [220, 220, 20, 255]);
    const late = stack.queue.uploadResult(task.id, {attempt: 1, sha256: sha256(lateImage), buffer: lateImage, nodeId: node1.node.id});
    assert.equal(late.late, true);
    assert.equal(late.duplicate, false);
    assert.equal(task.lateResults.length, 1);
    assert.equal(task.lateResults[0].reason, 'stale_attempt');
    assert.equal(task.result.sha256, currentSha, '迟到结果不覆盖当前结果');
    assert.equal(task.apply.status, 'pending', '迟到结果不触发回填');
    const lateNotification = stack.hub.state.notifications.find((item) => item.type === 'task.late_result');
    assert.ok(lateNotification, '迟到结果要有通知');
    assert.equal(lateNotification.taskId, task.id);
    // 同一旧尝试再传同一张 → duplicate，不重复登记
    const again = stack.queue.uploadResult(task.id, {attempt: 1, sha256: sha256(lateImage), buffer: lateImage, nodeId: node1.node.id});
    assert.equal(again.duplicate, true);
    assert.equal(task.lateResults.length, 1);
    // 已完成后同尝试上传不同图 → task_already_done 迟到登记
    const afterDone = stack.queue.uploadResult(task.id, {attempt: 2, sha256: sha256(lateImage), buffer: lateImage, nodeId: node2.node.id});
    assert.equal(afterDone.late, true);
    assert.equal(task.lateResults.length, 2);
    assert.equal(task.lateResults[1].reason, 'task_already_done');
    assert.equal(task.result.sha256, currentSha);
  } finally {
    dispose(stack);
  }
});

test('cancel / retry：未完成可取消，失败/待核实/已取消可重派，apply 状态保留历史', () => {
  const stack = createStack();
  try {
    const node = pairNode(stack, 'B电脑');
    const task = createTask(stack);
    stack.queue.heartbeat(node.node.id, {freeSlots: 1, running: []});
    const cancelled = stack.queue.cancelTask(task.id, {by: 'client_a'});
    assert.equal(cancelled.task.status, 'cancelled');
    assert.equal(task.attempts[0].status, 'abandoned');
    assert.throws(
      () => stack.queue.cancelTask(task.id),
      (error) => error instanceof CollabError && error.status === 409,
    );
    const retried = stack.queue.retryTask(task.id, {reason: '重新生成'});
    assert.equal(retried.task.status, 'queued');
    const assign = stack.queue.heartbeat(node.node.id, {freeSlots: 1, running: []});
    assert.equal(assign.assignments[0].attempt, 2);
    // 生成失败（likelyGenerated=false）→ failed，可重试
    stack.queue.progress(task.id, {attempt: 2, phase: 'generating'}, node.node.id);
    stack.queue.failTask(task.id, {attempt: 2, error: '桥返回错误', likelyGenerated: false}, node.node.id);
    assert.equal(task.status, 'failed');
    assert.equal(task.attempts[1].status, 'failed');
    assert.equal(stack.queue.retryTask(task.id, {reason: '失败重试'}).task.status, 'queued');
    const assign3 = stack.queue.heartbeat(node.node.id, {freeSlots: 1, running: []});
    assert.equal(assign3.assignments[0].attempt, 3);
    // likelyGenerated=true → verifying，禁止自动重派，但允许人工 retry
    stack.queue.progress(task.id, {attempt: 3, phase: 'generating'}, node.node.id);
    stack.queue.failTask(task.id, {attempt: 3, error: '超时', likelyGenerated: true}, node.node.id);
    assert.equal(task.status, 'verifying');
    assert.equal(task.attempts[2].status, 'unknown');
    const noAuto = stack.queue.heartbeat(node.node.id, {freeSlots: 3, running: []});
    assert.equal(noAuto.assignments.some((item) => item.taskId === task.id), false);
    const retriedAgain = stack.queue.retryTask(task.id, {reason: '人工核实后重试'});
    assert.equal(retriedAgain.task.status, 'queued');
    // 已完成的取消 → 409。
    // 注意：Clock 固定不前进时多个任务的 submittedAt 完全相同，单给 1 个 slot 时派到谁取决于排队兜底顺序；
    // 这里用 freeSlots=2 让 retriedAgain 与 doneTask 都被派发，并显式断言 doneTask 已被领取，断言不依赖派单先后。
    const doneTask = createTask(stack, {idempotencyKey: 'cancel-done'});
    const doneAssign = stack.queue.heartbeat(node.node.id, {freeSlots: 2, running: []});
    assert.ok(
      doneAssign.assignments.some((item) => item.taskId === doneTask.id),
      'doneTask 必须被本轮心跳领取（同时间戳下派单顺序不应影响本用例）',
    );
    assert.equal(doneTask.status, 'running');
    assert.ok(doneTask.activeAttempt > 0);
    completeTask(stack, doneTask, node.node.id);
    assert.equal(doneTask.status, 'done');
    assert.throws(
      () => stack.queue.cancelTask(doneTask.id),
      (error) => error instanceof CollabError && error.status === 409,
    );
  } finally {
    dispose(stack);
  }
});

test('journal 断线恢复裁决：keep / retry_upload / late / done / abandoned', () => {
  const stack = createStack();
  try {
    const node1 = pairNode(stack, 'B1');
    const node2 = pairNode(stack, 'B2');
    const task = createTask(stack);
    stack.queue.heartbeat(node1.node.id, {freeSlots: 1, running: []});
    stack.queue.progress(task.id, {attempt: 1, phase: 'generating'}, node1.node.id);
    const normal = stack.queue.heartbeat(node1.node.id, {
      freeSlots: 1,
      running: [task.id],
      journal: [{taskId: task.id, attempt: 1, stage: 'generating', hasResult: false}],
    });
    assert.equal(normal.dispositions[0].disposition, 'keep');
    const uploadFailed = stack.queue.heartbeat(node1.node.id, {
      freeSlots: 1,
      running: [task.id],
      journal: [{taskId: task.id, attempt: 1, stage: 'upload_failed', hasResult: false}],
    });
    assert.equal(uploadFailed.dispositions[0].disposition, 'retry_upload');
    const hasResult = stack.queue.heartbeat(node1.node.id, {
      freeSlots: 1,
      running: [task.id],
      journal: [{taskId: task.id, attempt: 1, stage: 'submitted', hasResult: true}],
    });
    assert.equal(hasResult.dispositions[0].disposition, 'retry_upload');
    const unknownTask = stack.queue.heartbeat(node1.node.id, {
      freeSlots: 1,
      running: [],
      journal: [{taskId: 'task_not_exists', attempt: 1, stage: 'claimed', hasResult: false}],
    });
    assert.equal(unknownTask.dispositions[0].disposition, 'done');
    // 已被新尝试接管 → late
    stack.clock.value += 61000;
    stack.queue.sweepExpiredLeases();
    stack.queue.retryTask(task.id, {reason: '恢复'});
    stack.queue.heartbeat(node2.node.id, {freeSlots: 1, running: []});
    const staleJournal = stack.queue.heartbeat(node1.node.id, {
      freeSlots: 0,
      running: [],
      journal: [{taskId: task.id, attempt: 1, stage: 'generating', hasResult: true}],
    });
    assert.equal(staleJournal.dispositions[0].disposition, 'late');
    // 已完成 → done；已取消 → abandoned
    const doneTask = createTask(stack, {idempotencyKey: 'journal-done'});
    stack.queue.heartbeat(node2.node.id, {freeSlots: 1, running: []});
    completeTask(stack, doneTask, node2.node.id);
    const doneDisposition = stack.queue.heartbeat(node2.node.id, {
      freeSlots: 0,
      running: [],
      journal: [{taskId: doneTask.id, attempt: 1, stage: 'generating', hasResult: false}],
    }).dispositions[0];
    assert.equal(doneDisposition.disposition, 'done');
    const cancelledTask = createTask(stack, {idempotencyKey: 'journal-cancel'});
    stack.queue.cancelTask(cancelledTask.id);
    const abandonedDisposition = stack.queue.heartbeat(node2.node.id, {
      freeSlots: 0,
      running: [],
      journal: [{taskId: cancelledTask.id, attempt: 0, stage: 'claimed', hasResult: false}],
    }).dispositions[0];
    assert.equal(abandonedDisposition.disposition, 'abandoned');
  } finally {
    dispose(stack);
  }
});
