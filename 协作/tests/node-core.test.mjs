// 节点主循环测试（离线、随机端口、临时目录）：
// 假中控（heartbeat/assignment/progress/fail/verify/result/blob）+ 假本机漫画服务（collab generation/job/state），
// 驱动真实 createNodeAgent 完成 领取→下载参考→提交→轮询→校验→上传 全链路，以及恢复/白名单/名额/暂停等规则。
// 运行：node --test --test-concurrency=1 tests/node-core.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import {computeFreeSlots, createNodeAgent, normalizeNodeConfig} from '../lib/node-core.mjs';
import {createJournal} from '../lib/node-local.mjs';
import {sha256, inspectImageBuffer} from '../lib/protocol.mjs';

// ---------------------------------------------------------------------------
// 测试基础设施：PNG / HTTP / 临时目录
// ---------------------------------------------------------------------------
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function makePng(width = 32, height = 24, color = 0x3366cc) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const rowBytes = width * 3 + 1;
  const raw = Buffer.alloc(rowBytes * height);
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * rowBytes;
    raw[rowOffset] = 0;
    for (let x = 0; x < width; x += 1) {
      const offset = rowOffset + 1 + x * 3;
      raw[offset] = (color >> 16) & 0xff;
      raw[offset + 1] = (color >> 8) & 0xff;
      raw[offset + 2] = color & 0xff;
    }
  }
  const idat = zlib.deflateSync(raw);
  return Buffer.concat([signature, pngChunk('IHDR', ihdr), pngChunk('IDAT', idat), pngChunk('IEND', Buffer.alloc(0))]);
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function sendJson(response, status, value) {
  const body = Buffer.from(JSON.stringify(value));
  response.writeHead(status, {'content-type': 'application/json; charset=utf-8', 'content-length': body.length});
  response.end(body);
}

function sendBuffer(response, status, buffer, headers = {}) {
  response.writeHead(status, {'content-length': buffer.length, ...headers});
  response.end(buffer);
}

function startServer(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      resolve({server, origin: `http://127.0.0.1:${server.address().port}`});
    });
  });
}

function closeServer(server) {
  return new Promise((resolve) => {
    if (!server) return resolve();
    server.close(() => resolve());
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
  });
}

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function removeDir(directory) {
  try {
    fs.rmSync(directory, {recursive: true, force: true});
  } catch {
    // 忽略清理失败
  }
}

async function waitFor(predicate, {timeout = 8000, interval = 10, label = '条件'} = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  throw new Error(`等待${label}超时（${timeout}ms）`);
}

function readJournalFile(dataDir) {
  const file = path.join(dataDir, 'journal.json');
  if (!fs.existsSync(file)) return {version: 1, entries: {}};
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// ---------------------------------------------------------------------------
// 假中控：实现节点用到的协议接口（§4.2）
// ---------------------------------------------------------------------------
async function createFakeHub(options = {}) {
  const state = {
    token: options.token || 'hub-token-for-test',
    settings: {enabled: true, paused: false, maxConcurrency: 2, ...(options.settings || {})},
    pending: [...(options.pending || [])],
    dispositions: [...(options.dispositions || [])],
    blobs: new Map(Object.entries(options.blobs || {})),
    resultFailuresRemaining: Number(options.resultFailures) || 0,
    heartbeats: [],
    dispositionsSent: [],
    progress: [],
    fails: [],
    verifies: [],
    results: [],
    resultAttempts: 0,
    resultFailureLog: [],
    assignedTaskIds: new Set(),
    doneTaskIds: new Set(),
  };

  const server = await startServer(async (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    const method = request.method;
    if (url.pathname !== '/api/health' && request.headers['x-collab-token'] !== state.token) {
      sendJson(response, 401, {error: '节点 token 无效', code: 'invalid_token'});
      return;
    }
    const body = method === 'GET' || method === 'HEAD' ? Buffer.alloc(0) : await readBody(request);

    if (method === 'POST' && url.pathname === '/api/node/heartbeat') {
      const heartbeat = JSON.parse(body.toString('utf8') || '{}');
      state.heartbeats.push(heartbeat);
      const dispositions = state.dispositions.splice(0);
      state.dispositionsSent.push(...dispositions);
      const candidates = state.pending.filter(
        (assignment) => !state.doneTaskIds.has(assignment.taskId) && !state.assignedTaskIds.has(assignment.taskId),
      );
      const freeSlots = Math.max(0, Math.min(Number(heartbeat.freeSlots) || 0, candidates.length));
      const assignments = candidates.slice(0, freeSlots);
      for (const assignment of assignments) state.assignedTaskIds.add(assignment.taskId);
      sendJson(response, 200, {
        serverTime: new Date().toISOString(),
        hubId: 'hub_test_001',
        settings: {...state.settings},
        revoked: false,
        dispositions,
        assignments,
        notifications: [],
      });
      return;
    }

    let match = url.pathname.match(/^\/api\/node\/tasks\/([^/]+)\/progress$/);
    if (method === 'POST' && match) {
      const taskId = decodeURIComponent(match[1]);
      const payload = JSON.parse(body.toString('utf8') || '{}');
      state.progress.push({taskId, ...payload});
      sendJson(response, 200, {ok: true});
      return;
    }

    match = url.pathname.match(/^\/api\/node\/tasks\/([^/]+)\/fail$/);
    if (method === 'POST' && match) {
      const taskId = decodeURIComponent(match[1]);
      const payload = JSON.parse(body.toString('utf8') || '{}');
      state.fails.push({taskId, ...payload});
      sendJson(response, 200, {ok: true});
      return;
    }

    match = url.pathname.match(/^\/api\/node\/tasks\/([^/]+)\/verify$/);
    if (method === 'POST' && match) {
      const taskId = decodeURIComponent(match[1]);
      const payload = JSON.parse(body.toString('utf8') || '{}');
      state.verifies.push({taskId, ...payload});
      sendJson(response, 200, {ok: true});
      return;
    }

    match = url.pathname.match(/^\/api\/node\/tasks\/([^/]+)\/result$/);
    if (method === 'PUT' && match) {
      const taskId = decodeURIComponent(match[1]);
      state.resultAttempts += 1;
      if (state.resultFailuresRemaining > 0) {
        state.resultFailuresRemaining -= 1;
        state.resultFailureLog.push({taskId, attempt: request.headers['x-attempt']});
        sendJson(response, 500, {error: '中控临时故障（测试模拟）', code: 'internal'});
        return;
      }
      const headers = {
        contentType: request.headers['content-type'],
        attempt: Number(request.headers['x-attempt']),
        sha256Header: String(request.headers['x-sha256'] || ''),
      };
      const actual = sha256(body);
      state.results.push({taskId, attempt: headers.attempt, sha256: actual, body, headers});
      state.doneTaskIds.add(taskId);
      sendJson(response, 200, {ok: true, task: {id: taskId}, apply: {status: 'pending'}});
      return;
    }

    match = url.pathname.match(/^\/api\/blobs\/([0-9a-f]{64})$/);
    if (method === 'GET' && match) {
      const blob = state.blobs.get(match[1]);
      if (!blob) {
        sendJson(response, 404, {error: '没有该 blob', code: 'not_found'});
        return;
      }
      sendBuffer(response, 200, blob, {'content-type': 'image/png'});
      return;
    }

    if (method === 'GET' && url.pathname === '/api/health') {
      sendJson(response, 200, {application: 'photocraft-collab-hub', version: '1.0.0', protocolVersion: '1.0.0'});
      return;
    }

    sendJson(response, 404, {error: '测试中控没有该接口'});
  });

  return {
    origin: server.origin,
    server: server.server,
    state,
    addPending(assignment) {
      state.pending.push(assignment);
    },
    pushDisposition(disposition) {
      state.dispositions.push(disposition);
    },
    setSettings(settings) {
      Object.assign(state.settings, settings);
    },
    close() {
      return closeServer(server.server);
    },
  };
}

// ---------------------------------------------------------------------------
// 假本机漫画服务：实现 §7.1 节点侧三个接口 + /api/state、/api/health
// ---------------------------------------------------------------------------
async function createFakeLocal(options = {}) {
  const resultDir = options.resultDir || tempDir('pc-fake-local-result-');
  const state = {
    scheduler: {concurrency: 4, active: 0, queued: 0, ...(options.scheduler || {})},
    submitCalls: [],
    queryCalls: [],
    cancelCalls: [],
    jobs: new Map(),
    plans: new Map(),
    jobSeq: 0,
    maxActive: 0,
  };

  function planFor(taskId) {
    return state.plans.get(taskId) || {statuses: ['queued', 'running', 'done'], queryCount: 0};
  }

  function ensureResult(job) {
    const plan = job.plan;
    if (plan.resultBuffer) {
      if (!plan.resultFile) {
        plan.resultFile = path.join(resultDir, `${job.jobId}-result.png`);
        fs.writeFileSync(plan.resultFile, plan.resultBuffer);
      }
    } else if (!plan.resultFile) {
      const info = plan.pixels || {width: 32, height: 24, color: 0x2244aa};
      const buffer = makePng(info.width || 32, info.height || 24, info.color === undefined ? 0x2244aa : info.color);
      plan.resultFile = path.join(resultDir, `${job.jobId}-result.png`);
      fs.writeFileSync(plan.resultFile, buffer);
    }
    const buffer = fs.readFileSync(plan.resultFile);
    const info = inspectImageBuffer(buffer);
    return {
      filePath: plan.resultFile,
      sha256: sha256(buffer),
      size: buffer.length,
      mime: info ? info.mime : 'image/png',
      width: info ? info.width : 0,
      height: info ? info.height : 0,
      assetId: null,
    };
  }

  function markActive(job, active) {
    if (active && !job.activeCounted) {
      job.activeCounted = true;
      state.scheduler.active += 1;
      state.maxActive = Math.max(state.maxActive, state.scheduler.active);
    } else if (!active && job.activeCounted) {
      job.activeCounted = false;
      state.scheduler.active = Math.max(0, state.scheduler.active - 1);
    }
  }

  function queryJob(job) {
    const plan = job.plan;
    let status = '';
    if (plan.forcedStatus) {
      status = plan.forcedStatus;
    } else {
      const sequence = Array.isArray(plan.statuses) && plan.statuses.length ? plan.statuses : ['done'];
      const index = Math.min(job.queryCount, sequence.length - 1);
      status = sequence[index];
      job.queryCount += 1;
    }
    if (status === 'running') {
      if (!job.startedAt) job.startedAt = new Date().toISOString();
      markActive(job, true);
    }
    const terminal = status === 'done' || status === 'failed' || status === 'cancelled';
    if (terminal) {
      if (!job.completedAt) job.completedAt = new Date().toISOString();
      markActive(job, false);
    }
    let result = null;
    let error = null;
    if (status === 'done') result = ensureResult(job);
    if (status === 'failed') error = {message: plan.error || '模拟本机生成失败'};
    return {
      jobId: job.jobId,
      status,
      phase: status,
      message: status === 'running' ? '模拟生成中' : '',
      progress: status === 'running' ? 50 : status === 'done' ? 100 : 0,
      result,
      error,
      startedAt: job.startedAt || null,
      completedAt: job.completedAt || null,
    };
  }

  const server = await startServer(async (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    const method = request.method;
    const body = method === 'GET' || method === 'HEAD' ? Buffer.alloc(0) : await readBody(request);

    if (method === 'POST' && url.pathname === '/api/collab/generation') {
      const payload = JSON.parse(body.toString('utf8') || '{}');
      state.submitCalls.push(payload);
      const jobId = `job_mock_${state.jobSeq += 1}`;
      const plan = {...planFor(payload.taskId)};
      plan.queryCount = 0;
      const job = {
        jobId,
        taskId: payload.taskId,
        attempt: payload.attempt,
        generationInput: payload.generationInput,
        referenceFiles: payload.referenceFiles || [],
        plan,
        queryCount: 0,
        startedAt: null,
        completedAt: null,
        activeCounted: false,
      };
      state.jobs.set(jobId, job);
      sendJson(response, 202, {jobId});
      return;
    }

    let match = url.pathname.match(/^\/api\/collab\/generation\/([^/]+)\/cancel$/);
    if (method === 'POST' && match) {
      const jobId = decodeURIComponent(match[1]);
      state.cancelCalls.push(jobId);
      const job = state.jobs.get(jobId);
      if (job) {
        job.plan.forcedStatus = 'cancelled';
        markActive(job, false);
      }
      sendJson(response, 200, {ok: true});
      return;
    }

    match = url.pathname.match(/^\/api\/collab\/generation\/([^/]+)$/);
    if (method === 'GET' && match) {
      const jobId = decodeURIComponent(match[1]);
      const job = state.jobs.get(jobId);
      state.queryCalls.push(jobId);
      if (!job) {
        sendJson(response, 404, {error: '没有该协作任务', code: 'job_not_found'});
        return;
      }
      sendJson(response, 200, queryJob(job));
      return;
    }

    if (method === 'GET' && url.pathname === '/api/state') {
      sendJson(response, 200, {projects: [], jobs: [], scheduler: {...state.scheduler}});
      return;
    }
    if (method === 'GET' && url.pathname === '/api/generation-settings') {
      sendJson(response, 200, {totalConcurrency: state.scheduler.concurrency, platforms: {main: state.scheduler.concurrency}});
      return;
    }
    if (method === 'GET' && url.pathname === '/api/health') {
      sendJson(response, 200, {application: 'comic-merged-studio', version: '测试版'});
      return;
    }
    sendJson(response, 404, {error: '假本机服务没有该接口'});
  });

  return {
    origin: server.origin,
    server: server.server,
    state,
    setPlan(taskId, plan) {
      state.plans.set(taskId, {...plan, queryCount: 0});
    },
    addJob({jobId, taskId, attempt = 1, plan = {}}) {
      const job = {
        jobId,
        taskId,
        attempt,
        plan: {...plan, queryCount: 0},
        queryCount: 0,
        startedAt: null,
        completedAt: null,
        activeCounted: false,
      };
      state.jobs.set(jobId, job);
      return job;
    },
    release(taskId) {
      const jobs = taskId ? [...state.jobs.values()].filter((job) => job.taskId === taskId) : [...state.jobs.values()];
      for (const job of jobs) job.plan.forcedStatus = 'done';
    },
    releaseAll() {
      for (const job of state.jobs.values()) job.plan.forcedStatus = 'done';
    },
    close() {
      return closeServer(server.server);
    },
  };
}

// ---------------------------------------------------------------------------
// 测试夹具
// ---------------------------------------------------------------------------
function makeAssignment({
  taskId = 'task_1',
  attempt = 1,
  type = 'panel-generation',
  projectId = 'project_A',
  references = [],
  generationInput = {prompt: '测试画格提示词', size: {w: 64, h: 48}},
  payloadExtra = {},
} = {}) {
  return {
    taskId,
    attempt,
    leaseMs: 120000,
    leaseExpiresAt: new Date(Date.now() + 120000).toISOString(),
    payload: {
      type,
      projectId,
      projectName: '测试项目',
      episode: 21,
      panelCode: 'E21-003',
      panelId: 'panel_001',
      shotCode: 'E21-003',
      prompt: '测试画格提示词',
      style: '国漫',
      size: {w: 64, h: 48},
      target: {},
      generationInput,
      ...payloadExtra,
    },
    references,
  };
}

function makeConfig(hub, local, dataDir, overrides = {}) {
  return normalizeNodeConfig({
    hubUrl: hub.origin,
    token: hub.state.token,
    nodeName: 'B电脑-测试',
    dataDir,
    localComic: {origin: local.origin, provider: 'codex'},
    maxConcurrency: 2,
    enabled: true,
    paused: false,
    allowedProjectIds: [],
    allowedTaskTypes: ['panel-generation', 'asset-generation'],
    heartbeatMs: 60000,
    pollMs: 10,
    uploadRetries: 2,
    uploadBackoffMs: 5,
    taskTimeoutMs: 30000,
    hubTimeoutMs: 5000,
    autoHeartbeat: false,
    ...overrides,
  });
}

function makeAgent(config, logs) {
  return createNodeAgent({
    config,
    logger: (level, message) => logs.push({level, message}),
  });
}

async function createEnvironment(t, options = {}) {
  const dataDir = tempDir('pc-node-core-');
  const resultDir = tempDir('pc-node-core-result-');
  const local = await createFakeLocal({resultDir, scheduler: options.scheduler});
  const hub = await createFakeHub(options.hub);
  t.after(async () => {
    await hub.close();
    await local.close();
    removeDir(dataDir);
    removeDir(resultDir);
  });
  return {dataDir, resultDir, local, hub};
}

// ---------------------------------------------------------------------------
// 1. 全链路
// ---------------------------------------------------------------------------
test('全链路：领取→下载参考→提交本机→轮询→校验→上传，journal 阶段与名额正确', async (t) => {
  const referencePng = makePng(8, 6, 0x123456);
  const resultPng = makePng(64, 48, 0xabcdef);
  const assignment = makeAssignment({
    taskId: 'task_full_chain',
    generationInput: {prompt: '叶麟站在山巅', size: {w: 64, h: 48}},
    references: [{sha256: sha256(referencePng), role: 'character', name: '叶麟', mime: 'image/png', size: referencePng.length}],
  });
  const env = await createEnvironment(t, {
    hub: {pending: [assignment], blobs: {[sha256(referencePng)]: referencePng}},
  });
  env.local.setPlan('task_full_chain', {statuses: ['queued', 'running'], resultBuffer: resultPng});
  const logs = [];
  const config = makeConfig(env.hub, env.local, env.dataDir);
  const agent = makeAgent(config, logs);
  t.after(() => agent.stop().catch(() => {}));
  await agent.start();

  const firstHeartbeat = await agent.heartbeatOnce();
  assert.equal(firstHeartbeat.assignments.length, 1, '第一次心跳应领到任务');
  assert.equal(env.hub.state.heartbeats[0].freeSlots, 2, '空闲名额应为 min(2-0, 4-0)=2');
  assert.deepEqual(env.hub.state.heartbeats[0].journal, [], '首次心跳 journal 应为空');
  assert.equal(env.hub.state.heartbeats[0].local.origin, env.local.origin, '心跳应上报本机漫画服务地址');
  assert.deepEqual(env.hub.state.heartbeats[0].capabilities.providers, ['codex']);
  assert.equal(env.hub.state.heartbeats[0].capabilities.platform, process.platform);
  assert.ok(env.hub.state.heartbeats[0].capabilities.version, '心跳应上报节点版本');

  await waitFor(() => env.local.state.submitCalls.length === 1, {label: '提交本机任务'});
  const submitCall = env.local.state.submitCalls[0];
  assert.equal(submitCall.taskId, 'task_full_chain');
  assert.equal(submitCall.attempt, 1);
  assert.equal(submitCall.provider, 'codex');
  assert.deepEqual(submitCall.generationInput, assignment.payload.generationInput);
  assert.equal(submitCall.referenceFiles.length, 1);
  const referenceFile = submitCall.referenceFiles[0];
  assert.equal(referenceFile.role, 'character');
  assert.equal(referenceFile.name, '叶麟');
  assert.ok(referenceFile.filePath.startsWith(path.join(env.dataDir, 'tasks', 'task_full_chain', '1', 'refs')));
  assert.ok(fs.existsSync(referenceFile.filePath), '参考图应下载到本地 refs 目录');
  assert.equal(sha256(fs.readFileSync(referenceFile.filePath)), sha256(referencePng));

  await waitFor(() => env.hub.state.progress.some((entry) => entry.phase === 'generating'), {label: '上报 generating 进度'});
  const generatingHeartbeat = await agent.heartbeatOnce();
  assert.equal(generatingHeartbeat.assignments.length, 0, '任务执行中不应重复派单');
  const runningJournal = env.hub.state.heartbeats.at(-1).journal;
  assert.equal(runningJournal.length, 1, '执行中应把 journal 随心跳上报');
  assert.equal(runningJournal[0].taskId, 'task_full_chain');
  assert.equal(runningJournal[0].stage, 'generating');
  assert.equal(runningJournal[0].likelyGenerated, true);
  assert.equal(runningJournal[0].hasResult, false);

  env.local.release('task_full_chain');
  await waitFor(() => env.hub.state.results.length === 1, {label: '上传结果'});
  const uploaded = env.hub.state.results[0];
  assert.equal(uploaded.taskId, 'task_full_chain');
  assert.equal(uploaded.attempt, 1);
  assert.equal(uploaded.headers.contentType, 'image/png');
  assert.equal(uploaded.headers.attempt, 1);
  assert.equal(uploaded.headers.sha256Header, sha256(resultPng));
  assert.equal(uploaded.sha256, sha256(resultPng));
  assert.deepEqual(uploaded.body, resultPng, '上传的应是本机结果文件原始字节');

  const phases = env.hub.state.progress.map((entry) => entry.phase);
  assert.ok(phases.includes('generating'), `应上报 generating：${phases.join(',')}`);
  assert.ok(phases.includes('uploading'), `应上报 uploading：${phases.join(',')}`);

  await waitFor(() => agent.status().runningTasks.length === 0, {label: '任务执行结束'});
  assert.equal(agent.status().journal.length, 0, '任务完成后 journal 应清理');
  assert.deepEqual(readJournalFile(env.dataDir).entries, {}, 'journal.json 磁盘记录应清空');
  assert.ok(env.local.state.queryCalls.length >= 2, '应轮询本机 job');

  // 所有心跳都符合名额公式
  for (const heartbeat of env.hub.state.heartbeats) {
    const expected = Math.max(
      0,
      Math.min(
        env.hub.state.settings.maxConcurrency - heartbeat.running.length,
        heartbeat.local.concurrency - heartbeat.local.active,
      ),
    );
    assert.equal(heartbeat.freeSlots, expected, `心跳名额公式不符：${JSON.stringify(heartbeat)}`);
  }

  // 日志中文、不含 token
  const joinedLogs = logs.map((entry) => entry.message).join('\n');
  assert.ok(joinedLogs.includes('领取任务'), '日志应包含中文执行信息');
  assert.ok(!joinedLogs.includes(env.hub.state.token), '日志绝不能出现 token');
});

// ---------------------------------------------------------------------------
// 2. 上传失败一次后重传成功
// ---------------------------------------------------------------------------
test('上传失败一次后自动退避重传成功，journal 不残留', async (t) => {
  const env = await createEnvironment(t, {
    hub: {
      pending: [makeAssignment({taskId: 'task_retry_upload'})],
      resultFailures: 1,
      blobs: {},
    },
  });
  const logs = [];
  const config = makeConfig(env.hub, env.local, env.dataDir, {uploadBackoffMs: 10});
  const agent = makeAgent(config, logs);
  t.after(() => agent.stop().catch(() => {}));
  await agent.start();
  await agent.heartbeatOnce();
  await waitFor(() => env.hub.state.results.length === 1, {label: '重传后上传成功'});

  assert.equal(env.hub.state.resultAttempts, 2, '第一次上传失败后应重传一次');
  assert.equal(env.hub.state.resultFailureLog.length, 1);
  assert.equal(env.hub.state.results[0].taskId, 'task_retry_upload');
  await waitFor(() => agent.status().journal.length === 0, {label: 'journal 清理'});
  const uploadFailedLog = logs.find((entry) => /结果上传失败/.test(entry.message));
  assert.ok(uploadFailedLog, '应记录中文重传日志');
});

test('上传连续失败超过阈值：上报 fail(likelyGenerated=true) 并保留 upload_failed journal', async (t) => {
  const env = await createEnvironment(t, {
    hub: {
      pending: [makeAssignment({taskId: 'task_upload_exhaust'})],
      resultFailures: 10,
    },
  });
  const config = makeConfig(env.hub, env.local, env.dataDir, {uploadRetries: 1, uploadBackoffMs: 5});
  const agent = makeAgent(config, []);
  t.after(() => agent.stop().catch(() => {}));
  await agent.start();
  await agent.heartbeatOnce();
  await waitFor(() => env.hub.state.fails.length === 1, {label: '上传失败阈值上报'});

  assert.equal(env.hub.state.resultAttempts, 2, 'uploadRetries=1 时应总共尝试 2 次');
  const fail = env.hub.state.fails[0];
  assert.equal(fail.taskId, 'task_upload_exhaust');
  assert.equal(fail.likelyGenerated, true, '结果已生成但上传失败，应标记可能已生成');
  assert.match(fail.error, /上传失败/, '失败原因应为中文');
  const status = agent.status();
  assert.equal(status.journal.length, 1);
  assert.equal(status.journal[0].stage, 'upload_failed');
  assert.equal(readJournalFile(env.dataDir).entries['task_upload_exhaust#1'].stage, 'upload_failed');
  await agent.stop();
  assert.equal(agent.status().running, false);
});

// ---------------------------------------------------------------------------
// 3. paused / enabled=false 不领单
// ---------------------------------------------------------------------------
test('paused 与 enabled=false：freeSlots=0、不领单、不执行本机生成', async (t) => {
  const env = await createEnvironment(t, {
    hub: {
      pending: [makeAssignment({taskId: 'task_paused'})],
      settings: {enabled: true, paused: true, maxConcurrency: 2},
    },
  });
  const logs = [];
  const agent = makeAgent(makeConfig(env.hub, env.local, env.dataDir, {paused: true}), logs);
  t.after(() => agent.stop().catch(() => {}));
  await agent.start();
  const response = await agent.heartbeatOnce();
  assert.equal(response.assignments.length, 0, '暂停时中控不应派单');
  assert.equal(env.hub.state.heartbeats[0].freeSlots, 0, '暂停时 freeSlots 必须为 0');
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(env.local.state.submitCalls.length, 0, '暂停时不得调用本机生成');
  assert.equal(env.hub.state.fails.length, 0, '暂停只是不领单，不应上报失败');
  assert.equal(agent.status().settings.paused, true, '节点应保持中控下发的暂停状态');
  assert.equal(agent.status().freeSlots, 0);

  // 中控把节点设为 enabled=false：即使本轮心跳已带回派单，也绝不执行
  env.hub.setSettings({paused: false, enabled: false});
  const disabledAgentLogs = [];
  const agent2 = makeAgent(makeConfig(env.hub, env.local, env.dataDir, {paused: false}), disabledAgentLogs);
  t.after(() => agent2.stop().catch(() => {}));
  await agent2.start();
  await agent2.heartbeatOnce();
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(env.local.state.submitCalls.length, 0, 'enabled=false 时不得调用本机生成');
  assert.equal(env.hub.state.fails.length, 0, 'enabled=false 只是不领单，不应上报失败');
  await agent2.heartbeatOnce();
  assert.equal(env.hub.state.heartbeats.at(-1).freeSlots, 0, '禁用后下一轮 freeSlots 必须为 0');
  assert.ok(disabledAgentLogs.some((entry) => /禁用/.test(entry.message)), '应有中文禁用日志');
});

// ---------------------------------------------------------------------------
// 4. 名额计算与 maxConcurrency
// ---------------------------------------------------------------------------
test('名额：maxConcurrency 生效、本机 scheduler.active 变化影响 freeSlots', async (t) => {
  // 纯函数校验
  assert.equal(computeFreeSlots({settings: {maxConcurrency: 2}, runningCount: 0, local: {concurrency: 4, active: 0}}), 2);
  assert.equal(computeFreeSlots({settings: {maxConcurrency: 2}, runningCount: 2, local: {concurrency: 4, active: 2}}), 0);
  assert.equal(computeFreeSlots({settings: {maxConcurrency: 2}, runningCount: 1, local: {concurrency: 4, active: 3}}), 1);
  assert.equal(computeFreeSlots({settings: {maxConcurrency: 2}, runningCount: 0, local: {concurrency: 0, active: 0}}), 0);

  const env = await createEnvironment(t, {
    hub: {
      pending: [
        makeAssignment({taskId: 'task_a'}),
        makeAssignment({taskId: 'task_b'}),
        makeAssignment({taskId: 'task_c'}),
      ],
    },
    scheduler: {concurrency: 4, active: 0},
  });
  env.local.setPlan('task_a', {statuses: ['queued', 'running'], resultBuffer: makePng(16, 16, 0x111111)});
  env.local.setPlan('task_b', {statuses: ['queued', 'running'], resultBuffer: makePng(16, 16, 0x222222)});
  env.local.setPlan('task_c', {statuses: ['queued', 'running'], resultBuffer: makePng(16, 16, 0x333333)});
  const agent = makeAgent(makeConfig(env.hub, env.local, env.dataDir, {maxConcurrency: 2}), []);
  t.after(() => agent.stop().catch(() => {}));
  await agent.start();

  const first = await agent.heartbeatOnce();
  assert.equal(first.assignments.length, 2, '第一次心跳最多按 freeSlots=2 领 2 个任务');
  await waitFor(() => env.local.state.submitCalls.length === 2, {label: '两个本机任务提交'});
  await waitFor(() => env.local.state.scheduler.active === 2, {label: '本机两个任务进入 running'});
  assert.equal(env.local.state.maxActive, 2);

  const second = await agent.heartbeatOnce();
  assert.equal(env.hub.state.heartbeats.at(-1).freeSlots, 0, '两个协作任务在跑且本机 active=2 时 freeSlots=0');
  assert.equal(second.assignments.length, 0, '没有空余名额时不应再领任务');

  env.local.release('task_a');
  await waitFor(() => env.hub.state.results.length === 1, {label: '任务 A 上传完成'});
  await waitFor(() => agent.status().runningTasks.length === 1, {label: '任务 A 执行结束'});
  await agent.heartbeatOnce();
  assert.equal(env.hub.state.heartbeats.at(-1).freeSlots, 1, '完成一个后 freeSlots 应为 1');
  await waitFor(() => env.local.state.submitCalls.length === 3, {label: '任务 C 提交'});
  const submittedTaskIds = env.local.state.submitCalls.map((call) => call.taskId).sort();
  assert.deepEqual(submittedTaskIds, ['task_a', 'task_b', 'task_c']);

  env.local.releaseAll();
  await waitFor(() => env.hub.state.results.length === 3, {label: '三个任务全部上传'});
  assert.equal(env.local.state.maxActive <= 2, true, `本机同时活跃任务不得超过 maxConcurrency，实际 ${env.local.state.maxActive}`);
  assert.equal(new Set(env.hub.state.results.map((entry) => entry.taskId)).size, 3);
});

// ---------------------------------------------------------------------------
// 5. 断线恢复：submitted / upload_failed / submitting / verify
// ---------------------------------------------------------------------------
test('断线恢复：keep(submitted 继续查 job)、retry_upload 重传、keep(submitting 重交本机)、verify 核实', async (t) => {
  const resultDir = tempDir('pc-node-core-recover-result-');
  const dataDir = tempDir('pc-node-core-recover-');
  const local = await createFakeLocal({resultDir});
  const hub = await createFakeHub({});
  t.after(async () => {
    await hub.close();
    await local.close();
    removeDir(dataDir);
    removeDir(resultDir);
  });

  const keepResult = makePng(20, 10, 0x101010);
  const uploadResult = makePng(20, 10, 0x202020);
  const verifyResult = makePng(20, 10, 0x303030);
  const uploadResultFile = path.join(dataDir, '已生成-上传失败.png');
  fs.writeFileSync(uploadResultFile, uploadResult);

  // 本机已有 job：keep 场景（submitted）与 verify 场景（结果已生成）
  local.addJob({jobId: 'job_keep', taskId: 'task_keep', attempt: 1, plan: {statuses: ['running', 'done'], resultBuffer: keepResult}});
  local.addJob({jobId: 'job_verify', taskId: 'task_verify', attempt: 1, plan: {forcedStatus: 'done', resultBuffer: verifyResult}});
  local.setPlan('task_submitting', {statuses: ['queued', 'running', 'done'], resultBuffer: makePng(20, 10, 0x404040)});

  const journal = createJournal({dataDir});
  journal.load();
  journal.upsert('task_keep', 1, {stage: 'submitted', jobId: 'job_keep', generationInput: {prompt: '恢复 keep'}, likelyGenerated: true});
  journal.upsert('task_upload', 1, {
    stage: 'upload_failed',
    jobId: null,
    resultPath: uploadResultFile,
    sha256: sha256(uploadResult),
    size: uploadResult.length,
    likelyGenerated: true,
  });
  journal.upsert('task_submitting', 1, {
    stage: 'submitting',
    jobId: null,
    generationInput: {prompt: '恢复重提交'},
    references: [],
    likelyGenerated: true,
  });
  journal.upsert('task_verify', 1, {stage: 'submitted', jobId: 'job_verify', likelyGenerated: true});

  hub.pushDisposition({taskId: 'task_keep', attempt: 1, disposition: 'keep'});
  hub.pushDisposition({taskId: 'task_upload', attempt: 1, disposition: 'retry_upload'});
  hub.pushDisposition({taskId: 'task_submitting', attempt: 1, disposition: 'keep'});
  hub.pushDisposition({taskId: 'task_verify', attempt: 1, disposition: 'verify'});

  const logs = [];
  const agent = makeAgent(makeConfig(hub, local, dataDir, {maxConcurrency: 4}), logs);
  t.after(() => agent.stop().catch(() => {}));
  await agent.start();
  await agent.heartbeatOnce();

  await waitFor(() => hub.state.results.length === 4, {label: '四个恢复结果上传'});
  const resultTaskIds = hub.state.results.map((entry) => entry.taskId).sort();
  assert.deepEqual(resultTaskIds, ['task_keep', 'task_submitting', 'task_upload', 'task_verify']);
  assert.equal(local.state.submitCalls.length, 1, 'keep(submitted) 与 retry_upload 不应重新生成；只有 submitting 需要重交');
  assert.equal(local.state.submitCalls[0].taskId, 'task_submitting');
  assert.equal(local.state.submitCalls[0].attempt, 1);
  assert.deepEqual(local.state.submitCalls[0].generationInput, {prompt: '恢复重提交'});

  const verifyRecord = hub.state.verifies.find((entry) => entry.taskId === 'task_verify');
  assert.ok(verifyRecord, 'verify 裁决必须先上报核实结果');
  assert.equal(verifyRecord.outcome, 'result_available');

  await waitFor(() => agent.status().journal.length === 0, {label: '恢复后 journal 清空'});
  assert.deepEqual(readJournalFile(dataDir).entries, {});
  assert.ok(logs.some((entry) => /中控裁决/.test(entry.message)), '应记录中文裁决日志');
});

// ---------------------------------------------------------------------------
// 6. 白名单拒绝
// ---------------------------------------------------------------------------
test('白名单：不允许的任务类型/项目拒绝执行并上报 fail（likelyGenerated=false）', async (t) => {
  const env = await createEnvironment(t, {
    hub: {
      pending: [
        makeAssignment({taskId: 'task_bad_type', type: 'panel-generation', projectId: 'project_allowed'}),
        makeAssignment({taskId: 'task_bad_project', type: 'asset-generation', projectId: 'project_other'}),
      ],
    },
  });
  const logs = [];
  const agent = makeAgent(makeConfig(env.hub, env.local, env.dataDir, {
    allowedTaskTypes: ['asset-generation'],
    allowedProjectIds: ['project_allowed'],
  }), logs);
  t.after(() => agent.stop().catch(() => {}));
  await agent.start();
  await agent.heartbeatOnce();
  await waitFor(() => env.hub.state.fails.length === 2, {label: '白名单拒绝上报失败'});

  const byTask = new Map(env.hub.state.fails.map((entry) => [entry.taskId, entry]));
  const typeFail = byTask.get('task_bad_type');
  const projectFail = byTask.get('task_bad_project');
  assert.ok(typeFail, '不允许的任务类型应上报 fail');
  assert.match(typeFail.error, /白名单.*任务类型/, '拒绝原因应为中文且说明任务类型');
  assert.equal(typeFail.likelyGenerated, false);
  assert.ok(projectFail, '不允许的项目应上报 fail');
  assert.match(projectFail.error, /白名单.*项目/, '拒绝原因应为中文且说明项目');
  assert.equal(projectFail.likelyGenerated, false);
  assert.equal(env.local.state.submitCalls.length, 0, '白名单拒绝的任务绝不能调用本机生成');
  assert.ok(logs.some((entry) => /拒绝执行任务/.test(entry.message)));
});

// ---------------------------------------------------------------------------
// 7. 失败时 likelyGenerated 判定
// ---------------------------------------------------------------------------
test('本机生成失败：进入过 generating → likelyGenerated=true；未开始即失败 → false', async (t) => {
  const env = await createEnvironment(t, {
    hub: {
      pending: [
        makeAssignment({taskId: 'task_fail_after_running'}),
        makeAssignment({taskId: 'task_fail_immediately'}),
      ],
    },
  });
  env.local.setPlan('task_fail_after_running', {statuses: ['running', 'failed'], error: '模拟桥接断开'});
  env.local.setPlan('task_fail_immediately', {statuses: ['failed'], error: '模拟输入校验失败'});
  const agent = makeAgent(makeConfig(env.hub, env.local, env.dataDir, {maxConcurrency: 2}), []);
  t.after(() => agent.stop().catch(() => {}));
  await agent.start();
  await agent.heartbeatOnce();
  await waitFor(() => env.hub.state.fails.length === 2, {label: '两个失败上报'});

  const byTask = new Map(env.hub.state.fails.map((entry) => [entry.taskId, entry]));
  assert.equal(byTask.get('task_fail_after_running').likelyGenerated, true, '进入过 generating 的任务应标记可能已生成');
  assert.match(byTask.get('task_fail_after_running').error, /本机协作生成失败/);
  assert.equal(byTask.get('task_fail_immediately').likelyGenerated, false, '未开始生成的任务不应标记可能已生成');
});

// ---------------------------------------------------------------------------
// 8. done / late / abandoned 裁决清理 journal
// ---------------------------------------------------------------------------
test('裁决清理：done 直接清理、abandoned 取消本机 job、late 不覆盖且清理', async (t) => {
  const dataDir = tempDir('pc-node-core-cleanup-');
  const resultDir = tempDir('pc-node-core-cleanup-result-');
  const local = await createFakeLocal({resultDir});
  const hub = await createFakeHub({});
  t.after(async () => {
    await hub.close();
    await local.close();
    removeDir(dataDir);
    removeDir(resultDir);
  });
  local.addJob({jobId: 'job_abandoned', taskId: 'task_abandoned', attempt: 1, plan: {statuses: ['running']}});
  local.addJob({jobId: 'job_late', taskId: 'task_late', attempt: 1, plan: {statuses: ['running']}});
  local.addJob({jobId: 'job_done', taskId: 'task_done', attempt: 1, plan: {statuses: ['done']}});

  const journal = createJournal({dataDir});
  journal.load();
  journal.upsert('task_done', 1, {stage: 'submitted', jobId: 'job_done'});
  journal.upsert('task_abandoned', 1, {stage: 'submitted', jobId: 'job_abandoned'});
  journal.upsert('task_late', 1, {stage: 'submitted', jobId: 'job_late'});

  hub.pushDisposition({taskId: 'task_done', attempt: 1, disposition: 'done'});
  hub.pushDisposition({taskId: 'task_abandoned', attempt: 1, disposition: 'abandoned'});
  hub.pushDisposition({taskId: 'task_late', attempt: 1, disposition: 'late', message: '已有新尝试接管'});

  const agent = makeAgent(makeConfig(hub, local, dataDir), []);
  t.after(() => agent.stop().catch(() => {}));
  await agent.start();
  await agent.heartbeatOnce();
  await waitFor(() => agent.status().journal.length === 0, {label: 'journal 清理'});
  assert.deepEqual(readJournalFile(dataDir).entries, {});
  await waitFor(() => local.state.cancelCalls.includes('job_abandoned') && local.state.cancelCalls.includes('job_late'), {
    label: '取消被放弃/迟到的本机 job',
  });
  assert.ok(!local.state.cancelCalls.includes('job_done'), 'done 裁决不需要取消本机 job');
  assert.equal(hub.state.results.length, 0, '没有结果文件时不应上传');
});

// ---------------------------------------------------------------------------
// 10. 自动心跳循环
// ---------------------------------------------------------------------------
test('自动心跳循环：按 heartbeatMs 周期发送，stop() 后不再心跳', async (t) => {
  const env = await createEnvironment(t, {
    hub: {settings: {enabled: true, paused: false, maxConcurrency: 2}},
    scheduler: {concurrency: 2, active: 0},
  });
  const agent = makeAgent(makeConfig(env.hub, env.local, env.dataDir, {autoHeartbeat: true, heartbeatMs: 20}), []);
  await agent.start();
  await waitFor(() => env.hub.state.heartbeats.length >= 2, {label: '自动心跳'});
  await agent.stop();
  const countAfterStop = env.hub.state.heartbeats.length;
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.equal(env.hub.state.heartbeats.length, countAfterStop, 'stop() 后必须清理心跳定时器，不再发送心跳');
  assert.equal(agent.status().running, false);
});

// ---------------------------------------------------------------------------
// 11. stop() 中断在途任务并保留 journal
// ---------------------------------------------------------------------------
test('stop() 优雅停止：中断轮询与在途请求，journal 保留待下次恢复', async (t) => {
  const env = await createEnvironment(t, {
    hub: {pending: [makeAssignment({taskId: 'task_stop'})]},
  });
  env.local.setPlan('task_stop', {statuses: ['queued', 'running']});
  const agent = makeAgent(makeConfig(env.hub, env.local, env.dataDir), []);
  await agent.start();
  await agent.heartbeatOnce();
  await waitFor(() => env.hub.state.progress.some((entry) => entry.phase === 'generating'), {label: '进入 generating'});
  const startedAt = Date.now();
  await agent.stop();
  assert.ok(Date.now() - startedAt < 3000, 'stop() 不应长时间卡住');
  const status = agent.status();
  assert.equal(status.running, false);
  assert.equal(status.runningTasks.length, 0);
  assert.equal(status.journal.length, 1, '停止后未完成任务应保留 journal');
  assert.ok(['submitted', 'generating'].includes(status.journal[0].stage));
  assert.equal(readJournalFile(env.dataDir).entries['task_stop#1'].taskId, 'task_stop');
});
