// 节点本机适配层测试（离线、随机端口、临时目录）：
// 假漫画服务 + 假中控（blob 下载），验证提交/轮询/取消、参考图下载、结果校验、journal 原子读写。
// 运行：node --test --test-concurrency=1 tests/node-local.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import {
  MAX_RESULT_BYTES,
  createJournal,
  createLocalComicClient,
  isAbortedError,
  journalEntryForHeartbeat,
  requestJson,
  sleep,
} from '../lib/node-local.mjs';
import {CollabError, sha256, inspectImageBuffer} from '../lib/protocol.mjs';

test('容量探测使用轻量 health，不下载巨大工程；待核实云任务占用名额',async t=>{
 let stateRequests=0,unknown=0;const server=http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');if(req.url==='/api/health')res.end(JSON.stringify({generation:{running:1,queued:2,concurrency:3,remoteUnknown:unknown}}));else{stateRequests++;res.end(JSON.stringify({projects:[{source:'x'.repeat(15*1024*1024)}]}));}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close();});const local=createLocalComicClient({origin:'http://127.0.0.1:'+server.address().port});
 assert.deepEqual((await local.readState()).scheduler,{active:1,queued:2,concurrency:3});unknown=1;assert.equal((await local.readState()).scheduler.active,2);assert.equal(stateRequests,0);
});

// ---------------------------------------------------------------------------
// 测试工具：最小 PNG 生成（不依赖任何图像库 / npm 包）
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

function makePng(width = 4, height = 3, color = 0x3366cc) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2; // RGB
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

function startServer(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      resolve({
        server,
        origin: `http://127.0.0.1:${server.address().port}`,
        port: server.address().port,
      });
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

async function readRequestBody(request) {
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

test('本机漫画服务客户端：提交/查询/取消只访问固定接口', async (t) => {
  const calls = [];
  const local = await startServer(async (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    const raw = await readRequestBody(request);
    calls.push({method: request.method, pathname: url.pathname, headers: request.headers, body: raw.toString('utf8')});
    if (request.method === 'POST' && url.pathname === '/api/collab/generation') {
      sendJson(response, 202, {jobId: 'job_test_001'});
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/collab/generation/job_test_001') {
      sendJson(response, 200, {
        jobId: 'job_test_001',
        status: 'running',
        phase: 'generating',
        message: '正在生成',
        progress: 42,
        result: null,
        error: null,
        startedAt: new Date().toISOString(),
      });
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/collab/generation/job_test_001/cancel') {
      sendJson(response, 200, {ok: true});
      return;
    }
    sendJson(response, 404, {error: '没有该接口'});
  });
  t.after(() => closeServer(local.server));

  const dataDir = tempDir('pc-node-local-client-');
  t.after(() => removeDir(dataDir));
  const client = createLocalComicClient({origin: local.origin, provider: 'codex', dataDir});

  const generationInput = {prompt: '林间少年抬头', size: {w: 1280, h: 900}};
  const submitted = await client.submitGeneration({
    taskId: 'task_A',
    attempt: 2,
    generationInput,
    referenceFiles: [{role: 'character', name: '叶麟', filePath: 'C:\\refs\\1-叶麟.png'}],
  });
  assert.equal(submitted.jobId, 'job_test_001');

  const submitCall = calls.find((call) => call.method === 'POST' && call.pathname === '/api/collab/generation');
  assert.ok(submitCall, '应调用 POST /api/collab/generation');
  const submitBody = JSON.parse(submitCall.body);
  assert.equal(submitBody.taskId, 'task_A');
  assert.equal(submitBody.attempt, 2);
  assert.equal(submitBody.provider, 'codex');
  assert.deepEqual(submitBody.generationInput, generationInput);
  assert.equal(submitBody.referenceFiles.length, 1);
  assert.equal(submitBody.referenceFiles[0].filePath, 'C:\\refs\\1-叶麟.png');

  const job = await client.queryGeneration('job_test_001');
  assert.equal(job.status, 'running');
  assert.equal(job.progress, 42);

  const cancelled = await client.cancelGeneration('job_test_001');
  assert.equal(cancelled.ok, true);
  assert.ok(calls.some((call) => call.method === 'POST' && call.pathname === '/api/collab/generation/job_test_001/cancel'));
});

test('本机漫画服务客户端：读取 /api/state 名额与 /api/generation-settings 兜底', async (t) => {
  let schedulerMode = 'full';
  const local = await startServer(async (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (url.pathname === '/api/state') {
      if (schedulerMode === 'none') {
        sendJson(response, 200, {projects: [], jobs: []});
        return;
      }
      sendJson(response, 200, {projects: [], jobs: [], scheduler: {concurrency: 4, active: 1, queued: 2}});
      return;
    }
    if (url.pathname === '/api/generation-settings') {
      sendJson(response, 200, {totalConcurrency: 4, platforms: {main: 4}, sharedLimit: 6});
      return;
    }
    if (url.pathname === '/api/health') {
      sendJson(response, 200, {application: 'comic-merged-studio', version: 'test'});
      return;
    }
    sendJson(response, 404, {error: '没有该接口'});
  });
  t.after(() => closeServer(local.server));

  const dataDir = tempDir('pc-node-local-state-');
  t.after(() => removeDir(dataDir));
  const client = createLocalComicClient({origin: local.origin, dataDir});

  const state = await client.readState();
  assert.deepEqual(state.scheduler, {concurrency: 4, active: 1, queued: 2});
  assert.equal(state.origin, local.origin);

  const settings = await client.readGenerationSettings();
  assert.equal(settings.totalConcurrency, 4);

  const health = await client.readHealth();
  assert.equal(health.application, 'comic-merged-studio');

  schedulerMode = 'none';
  const fallbackState = await client.readState();
  assert.equal(fallbackState.scheduler, null, '旧接口没有 scheduler 时应返回 null 供调用方兜底');
});

test('参考图下载：写入 refs 目录、校验 sha256、携带 token、文件名不越界', async (t) => {
  const png = makePng(6, 5, 0xcc3366);
  const digest = sha256(png);
  const blobs = new Map([[digest, png]]);
  const blobRequests = [];
  const hub = await startServer(async (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    blobRequests.push({pathname: url.pathname, token: request.headers['x-collab-token'] || ''});
    if (request.headers['x-collab-token'] !== 'test-token') {
      sendJson(response, 401, {error: 'token 无效'});
      return;
    }
    const match = url.pathname.match(/^\/api\/blobs\/([0-9a-f]{64})$/);
    if (match && blobs.has(match[1])) {
      sendBuffer(response, 200, blobs.get(match[1]), {'content-type': 'image/png'});
      return;
    }
    sendJson(response, 404, {error: '没有该 blob'});
  });
  t.after(() => closeServer(hub.server));

  const dataDir = tempDir('pc-node-local-refs-');
  t.after(() => removeDir(dataDir));
  const client = createLocalComicClient({origin: 'http://127.0.0.1:18896', dataDir});

  const files = await client.downloadReferences({
    taskId: 'task_ref/../A',
    attempt: 1,
    hubUrl: hub.origin,
    token: 'test-token',
    references: [
      {sha256: digest, role: 'character', name: '叶麟', mime: 'image/png', size: png.length},
      {sha256: digest, role: 'scene', name: '../../越界名字.png', mime: 'image/png', size: png.length},
    ],
  });
  assert.equal(files.length, 2);
  assert.equal(blobRequests.length, 2);
  assert.ok(blobRequests.every((entry) => entry.token === 'test-token'), '下载参考图必须带 x-collab-token');
  assert.ok(blobRequests.every((entry) => entry.pathname === `/api/blobs/${digest}`), '只允许固定 blob 路径');

  const expectedDir = path.join(dataDir, 'tasks', 'task_ref_.._A', '1', 'refs');
  for (const file of files) {
    assert.ok(fs.existsSync(file.filePath), `参考图应落盘：${file.filePath}`);
    assert.equal(path.dirname(file.filePath), expectedDir);
    assert.deepEqual(fs.readFileSync(file.filePath), png);
    assert.equal(file.sha256, digest);
    assert.equal(file.mime, 'image/png');
    assert.equal(file.size, png.length);
  }
  assert.equal(path.basename(files[0].filePath), '1-叶麟.png');
  assert.ok(files[1].filePath.startsWith(expectedDir), '带路径分隔符的参考图名不能写出 refs 目录');

  // sha 不一致必须拒绝
  const wrongDigest = sha256(Buffer.from('another image'));
  await assert.rejects(
    () => client.downloadReferences({
      taskId: 'task_A',
      attempt: 1,
      hubUrl: hub.origin,
      token: 'test-token',
      references: [{sha256: wrongDigest, role: 'character', name: '假图', mime: 'image/png'}],
    }),
    (error) => error instanceof CollabError && /参考图/.test(error.message),
  );
});

test('参考图下载：中控 token 失效时给出中文错误且不落盘', async (t) => {
  const hub = await startServer(async (request, response) => {
    sendJson(response, 401, {error: 'token 无效'});
  });
  t.after(() => closeServer(hub.server));
  const dataDir = tempDir('pc-node-local-token-');
  t.after(() => removeDir(dataDir));
  const client = createLocalComicClient({origin: 'http://127.0.0.1:18896', dataDir});
  const png = makePng();
  await assert.rejects(
    () => client.downloadReferences({
      taskId: 'task_A',
      attempt: 1,
      hubUrl: hub.origin,
      token: 'bad-token',
      references: [{sha256: sha256(png), role: 'character', name: '叶麟', mime: 'image/png'}],
    }),
    (error) => error instanceof CollabError && error.status === 401 && /token/.test(error.message),
  );
  assert.equal(fs.existsSync(path.join(dataDir, 'tasks', 'task_A', '1', 'refs', '1-叶麟.png')), false);
});

test('结果文件校验：存在/大小/sha256/像素尺寸，坏文件中文报错', async (t) => {
  const dataDir = tempDir('pc-node-local-result-');
  t.after(() => removeDir(dataDir));
  const client = createLocalComicClient({origin: 'http://127.0.0.1:18896', dataDir});
  const resultFile = path.join(dataDir, '结果-v1.png');
  const png = makePng(1280, 900, 0x112233);
  fs.writeFileSync(resultFile, png);
  const digest = sha256(png);

  const result = await client.readResultFile({filePath: resultFile, sha256: digest, size: png.length, mime: 'image/png'});
  assert.equal(result.sha256, digest);
  assert.equal(result.size, png.length);
  assert.equal(result.mime, 'image/png');
  assert.equal(result.width, 1280);
  assert.equal(result.height, 900);
  assert.deepEqual(result.buffer, png);

  // sha 不一致
  await assert.rejects(
    () => client.readResultFile({filePath: resultFile, sha256: sha256(Buffer.from('bad'))}),
    (error) => error instanceof CollabError && /sha256/.test(error.message),
  );
  // 大小不一致
  await assert.rejects(
    () => client.readResultFile({filePath: resultFile, sha256: digest, size: png.length + 1}),
    (error) => error instanceof CollabError && /大小/.test(error.message),
  );
  // 文件不存在
  await assert.rejects(
    () => client.readResultFile({filePath: path.join(dataDir, '不存在.png'), sha256: digest}),
    (error) => error instanceof CollabError && /不存在或不可读/.test(error.message),
  );
  // 不是有效图片
  const badFile = path.join(dataDir, '坏文件.png');
  fs.writeFileSync(badFile, Buffer.from('这不是图片内容，只是普通文本，长度足够但格式不对。'));
  await assert.rejects(
    () => client.readResultFile({filePath: badFile}),
    (error) => error instanceof CollabError && /PNG\/JPEG\/WebP/.test(error.message),
  );
  // 空文件
  const emptyFile = path.join(dataDir, '空文件.png');
  fs.writeFileSync(emptyFile, Buffer.alloc(0));
  await assert.rejects(
    () => client.readResultFile({filePath: emptyFile}),
    (error) => error instanceof CollabError && /为空/.test(error.message),
  );
  // 超过 64MB 上限（用稀疏文件避免真的写 64MB 内容）
  const hugeFile = path.join(dataDir, '超大文件.png');
  fs.writeFileSync(hugeFile, Buffer.alloc(16));
  fs.truncateSync(hugeFile, MAX_RESULT_BYTES + 1);
  await assert.rejects(
    () => client.readResultFile({filePath: hugeFile}),
    (error) => error instanceof CollabError && /超过大小上限/.test(error.message),
  );
});

test('journal：原子读写、字段齐全、再次加载可恢复、损坏文件拒绝启动', async (t) => {
  const dataDir = tempDir('pc-node-local-journal-');
  t.after(() => removeDir(dataDir));
  const journal = createJournal({dataDir});
  journal.load();
  assert.equal(journal.count(), 0);

  journal.upsert('task_1', 1, {
    stage: 'claimed',
    jobId: null,
    resultPath: null,
    sha256: null,
    likelyGenerated: false,
    generationInput: {prompt: '测试'},
    references: [{sha256: 'a'.repeat(64), role: 'character', name: '叶麟'}],
  });
  const submitted = journal.upsert('task_1', 1, {stage: 'submitted', jobId: 'job_abc'});
  assert.equal(submitted.stage, 'submitted');
  assert.equal(submitted.jobId, 'job_abc');
  for (const key of ['taskId', 'attempt', 'stage', 'jobId', 'resultPath', 'sha256', 'updatedAt']) {
    assert.ok(Object.hasOwn(submitted, key), `journal 记录必须包含 ${key}`);
  }

  const journalFile = path.join(dataDir, 'journal.json');
  assert.ok(fs.existsSync(journalFile), 'journal 必须在 dataDir/journal.json');
  const onDisk = JSON.parse(fs.readFileSync(journalFile, 'utf8'));
  assert.equal(onDisk.version, 1);
  assert.ok(onDisk.updatedAt);
  assert.ok(onDisk.entries);

  // 新实例重新加载，模拟节点重启恢复
  const reloaded = createJournal({dataDir});
  const entries = reloaded.load();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].taskId, 'task_1');
  assert.equal(entries[0].stage, 'submitted');
  assert.deepEqual(entries[0].generationInput, {prompt: '测试'});
  assert.deepEqual(entries[0].references[0].name, '叶麟');

  const summary = journalEntryForHeartbeat(reloaded.get('task_1', 1));
  assert.deepEqual(summary, {
    taskId: 'task_1',
    attempt: 1,
    stage: 'submitted',
    hasResult: false,
    likelyGenerated: false,
  });

  // 上传失败阶段 + 心跳摘要 hasResult/likelyGenerated
  reloaded.upsert('task_1', 1, {stage: 'upload_failed', resultPath: 'C:\\r\\1.png', sha256: 'b'.repeat(64), likelyGenerated: true});
  const failedSummary = journalEntryForHeartbeat(reloaded.get('task_1', 1));
  assert.equal(failedSummary.stage, 'upload_failed');
  assert.equal(failedSummary.hasResult, true);
  assert.equal(failedSummary.likelyGenerated, true);

  assert.equal(reloaded.remove('task_1', 1), true);
  assert.equal(reloaded.count(), 0);
  assert.equal(reloaded.get('task_1', 1), null);

  // 损坏的 journal.json 必须拒绝启动（避免覆盖恢复记录）
  fs.writeFileSync(journalFile, '{这不是 JSON');
  const corrupted = createJournal({dataDir});
  assert.throws(
    () => corrupted.load(),
    (error) => error instanceof CollabError && error.code === 'journal_corrupt',
  );
});

test('journal：阶段白名单拒绝非法值，attempt 必须为正整数', async (t) => {
  const dataDir = tempDir('pc-node-local-journal-bad-');
  t.after(() => removeDir(dataDir));
  const journal = createJournal({dataDir});
  journal.load();
  assert.throws(() => journal.upsert('task_x', 0, {stage: 'claimed'}), /attempt/);
  assert.throws(() => journal.upsert('task_x', 1, {stage: '乱写阶段'}), /阶段/);
  assert.equal(journal.count(), 0);
});

test('HTTP 工具：请求可被 AbortController 取消，错误为中文且不泄露 URL 查询串', async (t) => {
  const server = await startServer(async (request, response) => {
    await sleep(200);
    sendJson(response, 200, {ok: true});
  });
  t.after(() => closeServer(server.server));
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 30);
  await assert.rejects(
    () => requestJson(`${server.origin}/api/health?token=secret-token`, {signal: controller.signal, timeoutMs: 5000}),
    (error) => isAbortedError(error) && !String(error.message).includes('secret-token'),
  );
  // 超时映射为中文
  await assert.rejects(
    () => requestJson(`${server.origin}/api/health`, {timeoutMs: 40}),
    (error) => error instanceof CollabError && /超时/.test(error.message),
  );
});

test('本地图片解析与 protocol.inspectImageBuffer 保持同一尺寸结论', async () => {
  const png = makePng(320, 480, 0x00ff00);
  const info = inspectImageBuffer(png);
  assert.deepEqual(info, {mime: 'image/png', ext: '.png', width: 320, height: 480});
});
