// 中控共享资产单元测试（离线、临时目录、真实 PNG 字节）。
// 覆盖：并发同 dedupeKey、form/costume/style 不合并、blob 内容去重、版本保留、结果入库回填请求、懒缩略图。
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

function makePng(width = 32, height = 32, color = [40, 160, 90, 255]) {
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

function createStack() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'collab-hub-assets-'));
  const clock = {value: CLOCK_START};
  const hub = new HubState({
    dataDir: dir,
    config: {port: 0, heartbeatTimeoutMs: 15000, leaseMs: 60000, maxTasks: 200, maxNotifications: 2000},
    now: () => clock.value,
    logger: SILENT,
  });
  const assets = new HubAssets({hub, logger: SILENT});
  const queue = new HubQueue({hub, assets, logger: SILENT});
  assets.attachQueue(queue);
  return {
    dir,
    clock,
    hub,
    assets,
    queue,
    pairNode(name = 'B电脑') {
      return hub.pair({pairingCode: hub.state.pairingCode, role: 'node', name, platform: 'win32', version: '1.0.0'});
    },
    close() {
      queue.stopTimers();
      hub.close();
    },
  };
}

const BASE_REQUEST = {
  projectId: 'project_demo',
  projectName: '演示漫画',
  kind: 'character',
  name: '叶麟',
  form: '道袍',
  costume: '太玄预备杂役道袍',
  style: '国漫',
  prompt: '叶麟标准立绘，国漫风',
  size: {w: 1024, h: 1024},
  generationInput: {prompt: '叶麟标准立绘，国漫风', referenceRoles: []},
  references: [],
};

function dispose(stack) {
  try {
    stack.close();
  } catch {}
  try {
    fs.rmSync(stack.dir, {recursive: true, force: true});
  } catch {}
}

function assetRequest(overrides = {}) {
  return {...BASE_REQUEST, ...overrides};
}

// 领取并完成当前排队的资产生成任务（返回上传结果）。
function runAssetTask(stack, node, image) {
  const top = stack.hub.state.tasks
    .filter((task) => task.status === 'queued' && task.type === 'asset-generation')
    .sort((a, b) => String(a.submittedAt).localeCompare(String(b.submittedAt)))[0];
  assert.ok(top, '应存在排队的资产生成任务');
  const heartbeat = stack.queue.heartbeat(node.node.id, {freeSlots: 2, running: []});
  const assignment = heartbeat.assignments.find((item) => item.taskId === top.id);
  assert.ok(assignment, '资产生成任务应被派单');
  stack.queue.progress(top.id, {attempt: assignment.attempt, phase: 'generating'}, node.node.id);
  stack.queue.progress(top.id, {attempt: assignment.attempt, phase: 'uploading'}, node.node.id);
  return stack.queue.uploadResult(top.id, {
    attempt: assignment.attempt,
    sha256: sha256(image),
    buffer: image,
    nodeId: node.node.id,
  });
}

test('并发同 dedupeKey：只建 1 个 pending 资产 + 1 个任务，其余 join', async () => {
  const stack = createStack();
  try {
    const results = await Promise.all(
      Array.from({length: 5}, (_, index) => Promise.resolve().then(() => stack.assets.requestAsset(assetRequest(), {clientId: `client_${index}`}))),
    );
    const creates = results.filter((item) => item.mode === 'create');
    const joins = results.filter((item) => item.mode === 'join');
    assert.equal(creates.length, 1, '并发申请只能有一个创建者');
    assert.equal(joins.length, 4, '其余申请必须 join');
    assert.equal(stack.hub.state.assets.length, 1);
    assert.equal(stack.hub.state.assets[0].status, 'pending');
    assert.equal(stack.hub.state.assetRequests.length, 1);
    assert.equal(stack.hub.state.assetRequests[0].status, 'pending');
    assert.equal(stack.hub.state.tasks.length, 1);
    assert.equal(stack.hub.state.tasks[0].type, 'asset-generation');
    assert.equal(stack.hub.state.tasks[0].status, 'queued');
    const assetId = creates[0].asset.id;
    for (const result of results) assert.equal(result.asset.id, assetId);
    assert.equal(stack.hub.state.assetRequests[0].waiters.length, 5, '所有申请者都记录为等待者');
    assert.equal(creates[0].asset.dedupeKey, stack.assets.assetDedupeKey(assetRequest()));
    assert.match(creates[0].asset.dedupeKey, /^v1\|project_demo\|character\|/);
    assert.equal(creates[0].request.taskId, stack.hub.state.tasks[0].id);
  } finally {
    dispose(stack);
  }
});

test('form / costume / style 任一不同都不合并；仅空白差异与参考图不同仍合并', () => {
  const stack = createStack();
  try {
    const base = stack.assets.requestAsset(assetRequest(), {clientId: 'c1'});
    assert.equal(base.mode, 'create');
    const sameSemantics = stack.assets.requestAsset(assetRequest({
      name: ' 叶麟 ',
      form: ' 道袍 ',
      costume: '太玄预备杂役道袍 ',
      style: ' 国漫',
      references: [{sha256: 'f'.repeat(64), role: 'reference', name: '参考图', mime: 'image/png', size: 10}],
    }), {clientId: 'c2'});
    assert.equal(sameSemantics.mode, 'join', '只忽略空白差异，参考图/文件名不影响查重');
    const formDiff = stack.assets.requestAsset(assetRequest({form: '便装'}), {clientId: 'c3'});
    assert.equal(formDiff.mode, 'create');
    const costumeDiff = stack.assets.requestAsset(assetRequest({costume: '便装外袍'}), {clientId: 'c4'});
    assert.equal(costumeDiff.mode, 'create');
    const styleDiff = stack.assets.requestAsset(assetRequest({style: '水墨'}), {clientId: 'c5'});
    assert.equal(styleDiff.mode, 'create');
    assert.equal(stack.hub.state.assets.length, 4, '基础 + 三个不同语义字段各一条');
    assert.equal(new Set(stack.hub.state.assets.map((asset) => asset.dedupeKey)).size, 4);
  } finally {
    dispose(stack);
  }
});

test('blob 内容寻址：同内容幂等、路径 blobs/<前2位>/<sha256>、坏图 400', () => {
  const stack = createStack();
  try {
    const png = makePng(18, 12);
    const hash = sha256(png);
    const first = stack.assets.putBlobBuffer(png);
    assert.equal(first.deduped, false);
    assert.equal(first.sha256, hash);
    assert.equal(first.blobId, `blob_${hash}`);
    assert.equal(first.mime, 'image/png');
    assert.equal(first.width, 18);
    assert.equal(first.height, 12);
    const expectedPath = path.join(stack.dir, 'blobs', hash.slice(0, 2), hash);
    assert.equal(fs.existsSync(expectedPath), true, `blob 应按内容寻址落盘：${expectedPath}`);
    const second = stack.assets.putBlobBuffer(png, {expectedSha256: hash});
    assert.equal(second.deduped, true);
    assert.deepEqual(fs.readFileSync(expectedPath), png);
    assert.throws(
      () => stack.assets.putBlobBuffer(Buffer.from('不是图片')),
      (error) => error instanceof CollabError && error.status === 400 && error.code === 'invalid_image',
    );
    assert.throws(
      () => stack.assets.putBlobBuffer(png, {expectedSha256: 'a'.repeat(64)}),
      (error) => error instanceof CollabError && error.status === 400 && error.code === 'sha256_mismatch',
    );
  } finally {
    dispose(stack);
  }
});

test('资产生命周期：结果入库 available + 请求 done + 通知；新版本保留旧版；复用最新版', () => {
  const stack = createStack();
  try {
    const node = stack.pairNode();
    const created = stack.assets.requestAsset(assetRequest(), {clientId: 'client_a'});
    assert.equal(created.mode, 'create');
    const assetV1 = created.asset;
    const request = created.request;
    const png1 = makePng(44, 33, [200, 50, 50, 255]);
    const upload = runAssetTask(stack, node, png1);
    assert.equal(upload.ok, true);
    assert.equal(assetV1.status, 'available');
    assert.equal(assetV1.sha256, sha256(png1));
    assert.equal(assetV1.width, 44);
    assert.equal(assetV1.height, 33);
    assert.equal(assetV1.sourceTaskId, created.task.id);
    assert.equal(assetV1.sourceNodeId, node.node.id);
    assert.equal(request.status, 'done');
    assert.equal(created.task.status, 'done');
    assert.equal(created.task.apply.status, 'skipped', '资产生成任务无需 A 端回填');
    const blobPath = path.join(stack.dir, 'blobs', sha256(png1).slice(0, 2), sha256(png1));
    assert.equal(fs.existsSync(blobPath), true);
    const createdNotification = stack.hub.state.notifications.find((item) => item.type === 'asset.created');
    assert.ok(createdNotification, '资产入库必须发 asset.created 通知');
    assert.equal(createdNotification.assetId, assetV1.id);

    // 已有可用版本 → 复用
    const reuse = stack.assets.requestAsset(assetRequest(), {clientId: 'client_b'});
    assert.equal(reuse.mode, 'reuse');
    assert.equal(reuse.asset.id, assetV1.id);
    assert.equal(stack.hub.state.tasks.length, 1, '复用不应新建任务');

    // forceNewVersion → 新版本，旧版本保留
    const createdV2 = stack.assets.requestAsset(assetRequest({forceNewVersion: true}), {clientId: 'client_c'});
    assert.equal(createdV2.mode, 'create');
    assert.equal(createdV2.asset.version, 2);
    assert.equal(createdV2.asset.parentAssetId, assetV1.id);
    assert.equal(createdV2.asset.lineageId, assetV1.lineageId);
    const png2 = makePng(44, 33, [50, 50, 200, 255]);
    runAssetTask(stack, node, png2);
    const assetV2 = createdV2.asset;
    assert.equal(assetV2.status, 'available');
    assert.equal(assetV2.sha256, sha256(png2));
    assert.equal(stack.hub.getAsset(assetV1.id).status, 'available', '旧版本保持可用');
    assert.equal(stack.hub.getAsset(assetV1.id).sha256, sha256(png1), '旧版本内容不变');

    const detail = stack.assets.getAssetDetail(assetV1.id);
    assert.equal(detail.asset.id, assetV1.id);
    assert.deepEqual(detail.versions.map((item) => item.version), [2, 1], '同 lineage 版本按新→旧返回');
    assert.equal(stack.assets.getAssetDetail(assetV2.id).versions.length, 2);

    // 复用返回最新可用版本
    const reuseLatest = stack.assets.requestAsset(assetRequest(), {clientId: 'client_d'});
    assert.equal(reuseLatest.mode, 'reuse');
    assert.equal(reuseLatest.asset.id, assetV2.id);

    // 列表：默认只给每个 lineage 的最新版本；allVersions 给全部
    const latestOnly = stack.assets.listAssets({projectId: 'project_demo'});
    assert.equal(latestOnly.total, 1);
    assert.equal(latestOnly.assets[0].id, assetV2.id);
    const allVersions = stack.assets.listAssets({projectId: 'project_demo', allVersions: true});
    assert.equal(allVersions.total, 2);
  } finally {
    dispose(stack);
  }
});

test('缩略图懒生成：真实 PNG 可生成小图并缓存；缺失/非法时不崩溃', async () => {
  const stack = createStack();
  try {
    const png = makePng(640, 480, [10, 80, 160, 255]);
    const blob = stack.assets.putBlobBuffer(png);
    const thumb = await stack.assets.ensureThumb(blob.sha256);
    assert.ok(thumb, '包内 @napi-rs/canvas 可用时应能生成缩略图');
    assert.equal(thumb.mime, 'image/png');
    assert.deepEqual(thumb.buffer.subarray(0, 8), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const thumbFile = path.join(stack.dir, 'thumbs', `${blob.sha256}.png`);
    assert.equal(fs.existsSync(thumbFile), true);
    const cached = await stack.assets.ensureThumb(blob.sha256);
    assert.equal(cached.fromCache, true);
    assert.deepEqual(cached.buffer, thumb.buffer);
    const missing = await stack.assets.ensureThumb('c'.repeat(64));
    assert.equal(missing, null, '不存在的 blob 返回 null（路由层 404）');
    await assert.rejects(
      stack.assets.ensureThumb('bad-sha'),
      (error) => error instanceof CollabError && error.status === 400,
    );
  } finally {
    dispose(stack);
  }
});

test('资产生成失败后请求 failed；retry 重置为 pending 并可在新尝试中入库', () => {
  const stack = createStack();
  try {
    const node = stack.pairNode();
    const created = stack.assets.requestAsset(assetRequest(), {clientId: 'client_a'});
    stack.queue.heartbeat(node.node.id, {freeSlots: 1, running: []});
    stack.queue.progress(created.task.id, {attempt: 1, phase: 'generating'}, node.node.id);
    stack.queue.failTask(created.task.id, {attempt: 1, error: '本机生图失败', likelyGenerated: false}, node.node.id);
    assert.equal(created.task.status, 'failed');
    assert.equal(created.asset.status, 'failed');
    assert.equal(created.request.status, 'failed');
    const retried = stack.queue.retryTask(created.task.id, {reason: '重试'});
    assert.equal(retried.task.status, 'queued');
    assert.equal(created.request.status, 'pending', '重试后请求回到 pending');
    assert.equal(created.asset.status, 'pending');
    const png = makePng(20, 20);
    const upload = runAssetTask(stack, node, png);
    assert.equal(upload.ok, true);
    assert.equal(created.request.status, 'done');
    assert.equal(created.asset.status, 'available');
  } finally {
    dispose(stack);
  }
});
