// 中控 HTTP 集成测试：真实 node:http 服务 + listen(0) + 两个节点 token。
// 覆盖：health 字段、401/403、鉴权角色隔离、两节点并发抢单、坏图 400 不改状态、
// 结果上传→done→apply pending、通知 seq 增量、资产申请、blob 读写/缩略图、节点设置/吊销、静态页与 SSE 冒烟。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import {createHubServer} from '../lib/hub-server.mjs';
import {sha256} from '../lib/protocol.mjs';

const SILENT = {info() {}, warn() {}, error() {}};

function crcChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(Buffer.concat([typeBuffer, data])) >>> 0, 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function makePng(width = 32, height = 32, color = [90, 140, 220, 255]) {
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
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    crcChunk('IHDR', ihdr),
    crcChunk('IDAT', zlib.deflateSync(raw)),
    crcChunk('IEND', Buffer.alloc(0)),
  ]);
}

function panelTaskBody(overrides = {}) {
  return {
    idempotencyKey: 'E21-003@panelcontent0001@client_test',
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

test('中控 HTTP API 集成（listen(0) 真实请求）', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'collab-hub-http-'));
  const runtime = createHubServer({
    dataDir,
    config: {port: 0, host: '127.0.0.1', heartbeatTimeoutMs: 60000, leaseMs: 120000, maxTasks: 200},
    logger: SILENT,
    startTimers: false,
  });
  await runtime.listen({port: 0, host: '127.0.0.1'});
  const base = `http://127.0.0.1:${runtime.server.address().port}`;
  const pairingCode = runtime.hub.state.pairingCode;

  async function api(method, pathname, body, {token, headers = {}} = {}) {
    const requestHeaders = {...headers};
    if (token) requestHeaders['x-collab-token'] = token;
    let payload;
    if (body !== undefined) {
      if (Buffer.isBuffer(body)) {
        payload = body;
        if (!requestHeaders['content-type']) requestHeaders['content-type'] = 'application/octet-stream';
      } else {
        payload = JSON.stringify(body);
        requestHeaders['content-type'] = 'application/json';
      }
    }
    const response = await fetch(base + pathname, {method, headers: requestHeaders, body: payload});
    const buffer = Buffer.from(await response.arrayBuffer());
    const text = buffer.toString('utf8');
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch {}
    return {status: response.status, headers: response.headers, buffer, text, body: parsed};
  }

  const clientPair = await api('POST', '/api/pair', {pairingCode, role: 'client', name: 'A电脑'});
  assert.equal(clientPair.status, 200);
  const clientToken = clientPair.body.token;
  assert.ok(clientToken, '配对必须返回 token');
  assert.equal(clientPair.body.role, 'client');
  const nodeAPair = await api('POST', '/api/pair', {pairingCode, role: 'node', name: 'B电脑-甲', platform: 'win32', version: '1.0.0'});
  const nodeBPair = await api('POST', '/api/pair', {pairingCode, role: 'node', name: 'B电脑-乙', platform: 'win32', version: '1.0.0'});
  const nodeA = {token: nodeAPair.body.token, id: nodeAPair.body.nodeId};
  const nodeB = {token: nodeBPair.body.token, id: nodeBPair.body.nodeId};

  try {
    await t.test('health 字段完整且无需 token', async () => {
      const result = await api('GET', '/api/health');
      assert.equal(result.status, 200);
      assert.equal(result.body.application, 'photocraft-collab-hub');
      assert.equal(result.body.version, '1.0.0');
      assert.equal(result.body.protocolVersion, '1.0.0');
      assert.match(result.body.hubId, /^hub_/);
      assert.equal(typeof result.body.hubName, 'string');
      assert.equal(typeof result.body.time, 'string');
      assert.equal(typeof result.body.codeRoot, 'string');
      assert.equal(path.isAbsolute(result.body.codeRoot), true);
      assert.equal(result.body.codeRoot,path.resolve(import.meta.dirname,'../..'));
      assert.equal(result.body.dataRoot, runtime.hub.dataDir);
      assert.equal(result.body.pairingRequired, true);
      assert.deepEqual(result.body.tasks, {queued: 0, running: 0, uploading: 0, verifying: 0, done: 0, failed: 0});
      assert.deepEqual(result.body.nodes, {total: 2, online: 0});
      assert.deepEqual(result.body.assets, {total: 0});
    });

    await t.test('鉴权：401 / 403 与角色隔离', async () => {
      const missing = await api('GET', '/api/nodes');
      assert.equal(missing.status, 401);
      assert.equal(missing.body.code, 'missing_token');
      const wrong = await api('GET', '/api/nodes', undefined, {token: 'not-a-real-token'});
      assert.equal(wrong.status, 401);
      assert.equal(wrong.body.code, 'invalid_token');
      const clientOnNode = await api('POST', '/api/node/heartbeat', {freeSlots: 1}, {token: clientToken});
      assert.equal(clientOnNode.status, 403);
      assert.equal(clientOnNode.body.code, 'node_token_required');
      const nodeOnCreateTask = await api('POST', '/api/tasks', panelTaskBody(), {token: nodeA.token});
      assert.equal(nodeOnCreateTask.status, 403);
      assert.equal(nodeOnCreateTask.body.code, 'client_token_required');
      const nodeOnTasksList = await api('GET', '/api/tasks', undefined, {token: nodeA.token});
      assert.equal(nodeOnTasksList.status, 403);
      // 节点 token 允许读通知（保留给节点心跳/恢复使用）。
      const nodeNotifications = await api('GET', '/api/notifications', undefined, {token: nodeA.token});
      assert.equal(nodeNotifications.status, 200);
      // 客户端 token 可读节点列表。
      const nodes = await api('GET', '/api/nodes', undefined, {token: clientToken});
      assert.equal(nodes.status, 200);
      assert.equal(nodes.body.nodes.length, 2);
      assert.equal(nodes.body.nodes.some((node) => 'tokenHash' in node), false, '不得下发 tokenHash');
    });

    let taskId = null;
    let winner = null;
    let attempt = null;
    const image = makePng(48, 36);

    await t.test('两节点并发心跳抢同一任务：恰好一个 assignment', async () => {
      const created = await api('POST', '/api/tasks', panelTaskBody(), {token: clientToken});
      assert.equal(created.status, 201);
      taskId = created.body.task.id;
      assert.equal(created.body.task.status, 'queued');
      assert.ok(created.body.task.generationInput, '创建响应带 generationInput');
      const duplicate = await api('POST', '/api/tasks', panelTaskBody(), {token: clientToken});
      assert.equal(duplicate.status, 200);
      assert.equal(duplicate.body.duplicate, true);
      assert.equal(duplicate.body.task.id, taskId);
      const [first, second] = await Promise.all([
        api('POST', '/api/node/heartbeat', {freeSlots: 1, running: [], local: {active: 0, queued: 0, concurrency: 2, origin: 'http://127.0.0.1:18896'}, capabilities: {providers: ['codex'], version: '1.0.0', platform: 'win32'}, journal: []}, {token: nodeA.token}),
        api('POST', '/api/node/heartbeat', {freeSlots: 1, running: [], local: {active: 0, queued: 0, concurrency: 2}, capabilities: {version: '1.0.0', platform: 'win32'}, journal: []}, {token: nodeB.token}),
      ]);
      assert.equal(first.status, 200);
      assert.equal(second.status, 200);
      const assignments = [...first.body.assignments, ...second.body.assignments];
      assert.equal(assignments.length, 1, '同一任务只能派给一个节点');
      assert.equal(assignments[0].taskId, taskId);
      attempt = assignments[0].attempt;
      winner = first.body.assignments.length === 1 ? nodeA : nodeB;
      // 继续心跳：节点 settings / serverTime 字段存在。
      const heartbeat = first.body.assignments.length === 1 ? first : second;
      assert.ok(heartbeat.body.serverTime);
      assert.deepEqual(heartbeat.body.settings, {enabled: true, paused: false, maxConcurrency: 2});
      assert.equal(heartbeat.body.revoked, false);
      assert.ok(Array.isArray(heartbeat.body.dispositions));
      assert.ok(Array.isArray(heartbeat.body.notifications));
      assert.equal(heartbeat.body.hubId, runtime.hub.state.hubId);
    });

    await t.test('坏图 400 不改状态；正确结果上传 → done + apply pending；apply 只迁移一次', async () => {
      const progress = await api('POST', `/api/node/tasks/${taskId}/progress`, {attempt, phase: 'generating', message: '节点开始生成'}, {token: winner.token});
      assert.equal(progress.status, 200);
      const uploading = await api('POST', `/api/node/tasks/${taskId}/progress`, {attempt, phase: 'uploading'}, {token: winner.token});
      assert.equal(uploading.status, 200);
      const bad = await api('PUT', `/api/node/tasks/${taskId}/result`, Buffer.from('这不是图片'), {
        token: winner.token,
        headers: {'content-type': 'image/png', 'x-attempt': String(attempt)},
      });
      assert.equal(bad.status, 400);
      assert.equal(bad.body.code, 'invalid_image');
      const afterBad = await api('GET', `/api/tasks/${taskId}`, undefined, {token: clientToken});
      assert.equal(afterBad.body.task.status, 'uploading', '坏图不能改变任务状态');
      assert.equal(afterBad.body.task.result, null);
      const wrongSha = await api('PUT', `/api/node/tasks/${taskId}/result`, image, {
        token: winner.token,
        headers: {'content-type': 'image/png', 'x-attempt': String(attempt), 'x-sha256': 'a'.repeat(64)},
      });
      assert.equal(wrongSha.status, 400);
      assert.equal(wrongSha.body.code, 'sha256_mismatch');
      const uploaded = await api('PUT', `/api/node/tasks/${taskId}/result`, image, {
        token: winner.token,
        headers: {'content-type': 'image/png', 'x-attempt': String(attempt), 'x-sha256': sha256(image)},
      });
      assert.equal(uploaded.status, 200);
      assert.equal(uploaded.body.ok, true);
      assert.equal(uploaded.body.duplicate, false);
      assert.equal(uploaded.body.task.status, 'done');
      assert.equal(uploaded.body.apply.status, 'pending');
      assert.equal(uploaded.body.task.result.sha256, sha256(image));
      assert.equal(uploaded.body.task.result.width, 48);
      assert.equal(uploaded.body.task.result.height, 36);
      const duplicateUpload = await api('PUT', `/api/node/tasks/${taskId}/result`, image, {
        token: winner.token,
        headers: {'content-type': 'image/png', 'x-attempt': String(attempt), 'x-sha256': sha256(image)},
      });
      assert.equal(duplicateUpload.status, 200);
      assert.equal(duplicateUpload.body.duplicate, true);
      // apply pending → applied（幂等）
      const applied = await api('POST', `/api/tasks/${taskId}/apply`, {status: 'applied', detail: '自动回填成功'}, {token: clientToken});
      assert.equal(applied.status, 200);
      assert.equal(applied.body.apply.status, 'applied');
      assert.equal(applied.body.duplicate, false);
      const appliedAgain = await api('POST', `/api/tasks/${taskId}/apply`, {status: 'applied', detail: '自动回填成功'}, {token: clientToken});
      assert.equal(appliedAgain.status, 200);
      assert.equal(appliedAgain.body.duplicate, true);
      const conflict = await api('POST', `/api/tasks/${taskId}/apply`, {status: 'conflict'}, {token: clientToken});
      assert.equal(conflict.status, 409);
      assert.equal(conflict.body.code, 'apply_already_settled');
      // 任务详情 + 列表
      const detail = await api('GET', `/api/tasks/${taskId}`, undefined, {token: clientToken});
      assert.equal(detail.body.task.status, 'done');
      assert.ok(detail.body.task.generationInput, '详情必须带 generationInput');
      const list = await api('GET', '/api/tasks?projectId=project_demo&status=done&include=true', undefined, {token: clientToken});
      assert.equal(list.status, 200);
      assert.equal(list.body.total, 1);
      assert.ok(list.body.tasks[0].generationInput);
      const listWithout = await api('GET', '/api/tasks', undefined, {token: clientToken});
      assert.equal('generationInput' in listWithout.body.tasks[0], false, '列表默认不带 generationInput');
    });

    await t.test('通知 seq 递增：since 增量拉取，节点心跳也带增量通知', async () => {
      const all = await api('GET', '/api/notifications?since=0&limit=200', undefined, {token: clientToken});
      assert.equal(all.status, 200);
      assert.ok(all.body.lastSeq >= 1);
      assert.ok(all.body.notifications.some((item) => item.type === 'task.done'), '应有 task.done 通知');
      assert.ok(all.body.notifications.some((item) => item.type === 'node.online'), '应有 node.online 通知');
      const seqs = all.body.notifications.map((item) => item.seq);
      assert.deepEqual(seqs, [...seqs].sort((a, b) => a - b), '通知按 seq 升序');
      const incremental = await api('GET', `/api/notifications?since=${all.body.lastSeq}`, undefined, {token: clientToken});
      assert.equal(incremental.body.notifications.length, 0);
      const read = await api('POST', '/api/notifications/read', {ids: all.body.notifications.slice(0, 2).map((item) => item.id)}, {token: clientToken});
      assert.equal(read.status, 200);
      assert.equal(read.body.ok, true);
      // 可选 limit 的缺省/空值同样必须走默认 100（与 tasks/assets 同源问题，一起回归）。
      const emptyLimitNotifications = await api('GET', '/api/notifications?since=0&limit=', undefined, {token: clientToken});
      assert.equal(emptyLimitNotifications.status, 200);
      assert.ok(emptyLimitNotifications.body.notifications.length >= 2, '缺省/空值 limit 不能只返回 1 条通知');
      // 节点心跳的 notifications 字段是数组且 seq 递增。
      const heartbeat = await api('POST', '/api/node/heartbeat', {freeSlots: 1, running: [], journal: []}, {token: winner.token});
      assert.equal(heartbeat.status, 200);
      assert.ok(Array.isArray(heartbeat.body.notifications));
      assert.ok(heartbeat.body.lastSeq >= all.body.lastSeq);
    });

    await t.test('共享资产并发申请：HTTP 并发只建 1 个 pending 资产 + 1 个任务；完成后 available + reuse', async () => {
      const requestBody = {
        projectId: 'project_demo',
        kind: 'character',
        name: '叶麟',
        form: '道袍',
        costume: '太玄预备杂役道袍',
        style: '国漫',
        prompt: '叶麟标准立绘',
        size: {w: 1024, h: 1024},
        generationInput: {prompt: '叶麟标准立绘'},
        references: [],
      };
      const responses = await Promise.all(
        Array.from({length: 5}, (_, index) =>
          api('POST', '/api/assets/request', {...requestBody, clientName: `请求者${index}`}, {token: clientToken}),
        ),
      );
      assert.equal(responses.every((item) => item.status === 200), true);
      const modes = responses.map((item) => item.body.mode);
      assert.equal(modes.filter((mode) => mode === 'create').length, 1);
      assert.equal(modes.filter((mode) => mode === 'join').length, 4);
      const created = responses.find((item) => item.body.mode === 'create').body;
      const assetsList = await api('GET', '/api/assets?projectId=project_demo', undefined, {token: clientToken});
      assert.equal(assetsList.body.total, 1);
      assert.equal(assetsList.body.assets[0].status, 'pending');
      const detailBefore = await api('GET', `/api/assets/${created.asset.id}`, undefined, {token: clientToken});
      assert.equal(detailBefore.body.versions.length, 1);
      // 领取资产生成任务并回传结果
      const heartbeat = await api('POST', '/api/node/heartbeat', {freeSlots: 2, running: [], journal: []}, {token: winner.token});
      const assetAssignment = heartbeat.body.assignments.find((item) => item.taskId === created.task.id);
      assert.ok(assetAssignment, '资产生成任务应派给节点');
      const assetImage = makePng(40, 40, [30, 180, 120, 255]);
      await api('POST', `/api/node/tasks/${created.task.id}/progress`, {attempt: assetAssignment.attempt, phase: 'generating'}, {token: winner.token});
      await api('POST', `/api/node/tasks/${created.task.id}/progress`, {attempt: assetAssignment.attempt, phase: 'uploading'}, {token: winner.token});
      const assetUpload = await api('PUT', `/api/node/tasks/${created.task.id}/result`, assetImage, {
        token: winner.token,
        headers: {'content-type': 'image/png', 'x-attempt': String(assetAssignment.attempt), 'x-sha256': sha256(assetImage)},
      });
      assert.equal(assetUpload.status, 200);
      const assetDetail = await api('GET', `/api/assets/${created.asset.id}`, undefined, {token: clientToken});
      assert.equal(assetDetail.body.asset.status, 'available');
      assert.equal(assetDetail.body.asset.sha256, sha256(assetImage));
      assert.equal(assetDetail.body.versions.length, 1);
      const reuse = await api('POST', '/api/assets/request', requestBody, {token: clientToken});
      assert.equal(reuse.body.mode, 'reuse');
      assert.equal(reuse.body.asset.id, created.asset.id);
      const assetNotifications = await api('GET', '/api/notifications?since=0&limit=300', undefined, {token: clientToken});
      assert.ok(assetNotifications.body.notifications.some((item) => item.type === 'asset.created'));
    });

    await t.test('blob 上传/下载/缩略图与 token 方式鉴权', async () => {
      const blobImage = makePng(64, 48, [180, 80, 30, 255]);
      const hash = sha256(blobImage);
      const uploaded = await api('PUT', '/api/blobs', blobImage, {
        token: clientToken,
        headers: {'content-type': 'image/png', 'x-sha256': hash},
      });
      assert.equal(uploaded.status, 200);
      assert.equal(uploaded.body.sha256, hash);
      assert.equal(uploaded.body.deduped, false);
      assert.equal(uploaded.body.width, 64);
      const deduped = await api('PUT', '/api/blobs', blobImage, {token: clientToken, headers: {'content-type': 'image/png'}});
      assert.equal(deduped.body.deduped, true);
      // 图片 GET 允许 ?token=（浏览器 <img> 无法带头）
      const downloaded = await api('GET', `/api/blobs/${hash}?token=${encodeURIComponent(clientToken)}`);
      assert.equal(downloaded.status, 200);
      assert.equal(downloaded.headers.get('content-type'), 'image/png');
      assert.deepEqual(downloaded.buffer, blobImage);
      const byHeader = await api('GET', `/api/blobs/${hash}`, undefined, {token: nodeA.token});
      assert.equal(byHeader.status, 200, '节点 token 允许下载参考图/结果图');
      const badToken = await api('GET', `/api/blobs/${hash}?token=bad-token`);
      assert.equal(badToken.status, 401);
      const thumb = await api('GET', `/api/blobs/${hash}/thumb?token=${encodeURIComponent(clientToken)}`);
      assert.ok([200, 404].includes(thumb.status), '缩略图不可用时返回 404 而不是崩溃');
      if (thumb.status === 200) {
        assert.equal(thumb.headers.get('content-type'), 'image/png');
        assert.deepEqual(thumb.buffer.subarray(0, 4), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
      } else {
        assert.equal(thumb.body.code, 'thumb_unavailable');
      }
      const missing = await api('GET', `/api/blobs/${'f'.repeat(64)}`, undefined, {token: clientToken});
      assert.equal(missing.status, 404);
    });

    await t.test('缺省 limit 回归：GET /api/tasks 与 /api/assets 不传 limit 时返回全部（默认 100），total 自洽', async () => {
      // 任务：建 3 个独立幂等键的任务，验证缺省/空值 limit 走默认分页而不是被 clamp 成 1。
      for (let index = 0; index < 3; index += 1) {
        const created = await api('POST', '/api/tasks', panelTaskBody({
          idempotencyKey: `paging-task-${index}`,
          projectId: 'project_paging',
          panelCode: `E21-P${index}`,
          prompt: `分页回归任务 ${index}`,
        }), {token: clientToken});
        assert.equal(created.status, 201);
      }
      const defaultTasks = await api('GET', '/api/tasks?projectId=project_paging', undefined, {token: clientToken});
      assert.equal(defaultTasks.status, 200);
      assert.equal(defaultTasks.body.total, 3);
      assert.equal(defaultTasks.body.tasks.length, 3, '缺省 limit 不能只返回 1 条（默认应为 100）');
      const explicitTasks = await api('GET', '/api/tasks?projectId=project_paging&limit=100', undefined, {token: clientToken});
      assert.equal(explicitTasks.body.tasks.length, 3);
      const emptyLimitTasks = await api('GET', '/api/tasks?projectId=project_paging&limit=', undefined, {token: clientToken});
      assert.equal(emptyLimitTasks.body.tasks.length, 3, 'limit= 空值应按缺省值处理');
      const limitedTasks = await api('GET', '/api/tasks?projectId=project_paging&limit=1', undefined, {token: clientToken});
      assert.equal(limitedTasks.body.tasks.length, 1);
      assert.equal(limitedTasks.body.total, 3, 'limit 只影响返回条数，total 始终是过滤后的总数');

      // 资产：建 3 个不同 dedupeKey 的资产（走 request，会额外产生 3 个生成任务）。
      for (const name of ['分页角色甲', '分页角色乙', '分页角色丙']) {
        const response = await api('POST', '/api/assets/request', {
          projectId: 'project_paging',
          kind: 'character',
          name,
          form: '道袍',
          costume: '',
          style: '国漫',
          prompt: `${name} 标准立绘`,
          size: {w: 512, h: 512},
          generationInput: {prompt: name},
          references: [],
        }, {token: clientToken});
        assert.equal(response.status, 200);
        assert.equal(response.body.mode, 'create');
      }
      const defaultAssets = await api('GET', '/api/assets?projectId=project_paging&allVersions=true', undefined, {token: clientToken});
      assert.equal(defaultAssets.status, 200);
      assert.equal(defaultAssets.body.total, 3);
      assert.equal(defaultAssets.body.assets.length, 3, '缺省 limit 不能只返回 1 条资产（默认应为 100）');
      const explicitAssets = await api('GET', '/api/assets?projectId=project_paging&allVersions=true&limit=100', undefined, {token: clientToken});
      assert.equal(explicitAssets.body.assets.length, 3);
      const emptyLimitAssets = await api('GET', '/api/assets?projectId=project_paging&allVersions=true&limit=', undefined, {token: clientToken});
      assert.equal(emptyLimitAssets.body.assets.length, 3, 'limit= 空值应按缺省值处理');
      const limitedAssets = await api('GET', '/api/assets?projectId=project_paging&allVersions=true&limit=1', undefined, {token: clientToken});
      assert.equal(limitedAssets.body.assets.length, 1);
      assert.equal(limitedAssets.body.total, 3);
      const offsetAssets = await api('GET', '/api/assets?projectId=project_paging&allVersions=true&offset=1', undefined, {token: clientToken});
      assert.equal(offsetAssets.body.assets.length, 2, '缺省 offset 应为 0、显式 offset=1 应跳过 1 条');
    });

    await t.test('节点设置（并发上限收敛 1–8）与吊销后 403', async () => {
      const settings = await api('POST', `/api/nodes/${nodeA.id}/settings`, {enabled: true, paused: true, maxConcurrency: 99}, {token: clientToken});
      assert.equal(settings.status, 200);
      assert.equal(settings.body.node.settings.maxConcurrency, 8, 'maxConcurrency 必须收敛到 1–8');
      assert.equal(settings.body.node.settings.paused, true);
      // 可选字段 null/空串 = 未提供：不能把 maxConcurrency 收敛成 1，也不能把 enabled 误改成 false。
      const nodeBSettingsBefore = {...runtime.hub.getNode(nodeB.id).settings};
      const nullSettings = await api('POST', `/api/nodes/${nodeB.id}/settings`, {enabled: null, paused: null, maxConcurrency: null}, {token: clientToken});
      assert.equal(nullSettings.status, 200);
      assert.deepEqual(nullSettings.body.node.settings, nodeBSettingsBefore, 'null 可选字段应视为未提供');
      const emptySettings = await api('POST', `/api/nodes/${nodeB.id}/settings`, {enabled: '', paused: '', maxConcurrency: ''}, {token: clientToken});
      assert.equal(emptySettings.status, 200);
      assert.deepEqual(emptySettings.body.node.settings, nodeBSettingsBefore, '空串可选字段应视为未提供');
      const pausedHeartbeat = await api('POST', '/api/node/heartbeat', {freeSlots: 2, running: [], journal: []}, {token: nodeA.token});
      assert.equal(pausedHeartbeat.status, 200);
      assert.equal(pausedHeartbeat.body.assignments.length, 0, '暂停节点不派单');
      const unpause = await api('POST', `/api/nodes/${nodeA.id}/settings`, {paused: false}, {token: clientToken});
      assert.equal(unpause.body.node.settings.paused, false);
      const revoked = await api('POST', `/api/nodes/${nodeA.id}/revoke`, {}, {token: clientToken});
      assert.equal(revoked.status, 200);
      assert.equal(revoked.body.ok, true);
      const nodes = await api('GET', '/api/nodes', undefined, {token: clientToken});
      assert.equal(nodes.body.nodes.find((node) => node.id === nodeA.id).revoked, true);
      const revokedHeartbeat = await api('POST', '/api/node/heartbeat', {freeSlots: 1}, {token: nodeA.token});
      assert.equal(revokedHeartbeat.status, 403);
      assert.equal(revokedHeartbeat.body.code, 'token_revoked');
      const notifications = await api('GET', '/api/notifications?since=0&limit=300', undefined, {token: clientToken});
      assert.ok(notifications.body.notifications.some((item) => item.type === 'node.revoked'));
      const missingNode = await api('POST', '/api/nodes/node_not_exists/settings', {paused: true}, {token: clientToken});
      assert.equal(missingNode.status, 404);
    });

    await t.test('配对码查询/轮换：旧码立即失效', async () => {
      const current = await api('GET', '/api/admin/pairing', undefined, {token: clientToken});
      assert.equal(current.status, 200);
      assert.equal(current.body.pairingCode, runtime.hub.state.pairingCode);
      const rotated = await api('POST', '/api/admin/rotate-pairing', {}, {token: clientToken});
      assert.equal(rotated.status, 200);
      assert.notEqual(rotated.body.pairingCode, current.body.pairingCode);
      assert.equal(rotated.body.pairingCode, runtime.hub.state.pairingCode);
      const oldCode = await api('POST', '/api/pair', {pairingCode: current.body.pairingCode, role: 'client', name: '旧码设备'});
      assert.equal(oldCode.status, 401);
      assert.equal(oldCode.body.code, 'invalid_pairing_code');
      const newCode = await api('POST', '/api/pair', {pairingCode: rotated.body.pairingCode, role: 'client', name: '新码设备'});
      assert.equal(newCode.status, 200);
      assert.ok(newCode.body.token);
    });

    await t.test('静态控制台：public 缺失时 404 不崩溃；目录穿越被拒绝', async () => {
      const home = await api('GET', '/');
      assert.ok([200, 404].includes(home.status), `GET / 只允许 200/404，实际 ${home.status}`);
      if (home.status === 404) {
        assert.equal(home.body.code, 'console_not_found');
      } else {
        assert.match(home.headers.get('content-type') || '', /text\/html/);
      }
      const traversal = await api('GET', '/%2e%2e%2fpackage.json');
      assert.equal(traversal.status, 400);
      assert.equal(traversal.body.code, 'invalid_path');
      const unknown = await api('GET', '/api/not-exists', undefined, {token: clientToken});
      assert.equal(unknown.status, 404);
      assert.equal(unknown.body.code, 'not_found');
    });

    await t.test('SSE /api/events 冒烟：返回事件流并能断开', async () => {
      const controller = new AbortController();
      const response = await fetch(`${base}/api/events`, {
        headers: {'x-collab-token': clientToken},
        signal: controller.signal,
      });
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type') || '', /text\/event-stream/);
      assert.equal(runtime.sseClients.size, 1);
      controller.abort();
      await new Promise((resolve) => setTimeout(resolve, 100));
      assert.equal(runtime.sseClients.size, 0, '断开后 SSE 客户端应被清理');
    });

    await t.test('health 汇总随任务/资产变化', async () => {
      const health = await api('GET', '/api/health');
      assert.ok(health.body.tasks.done >= 1, '至少一个面板任务完成');
      assert.ok(health.body.assets.total >= 1);
      assert.equal(health.body.nodes.total, 1, '已吊销节点不计入健康统计的节点总数');
    });
  } finally {
    await runtime.close();
    fs.rmSync(dataDir, {recursive: true, force: true});
  }
});
