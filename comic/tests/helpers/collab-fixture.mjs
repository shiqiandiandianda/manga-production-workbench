// 协作接入层测试夹具：合成 PNG、createStudio(fake bridge) 实例、假中控、工程种子数据。
// 全部离线：不调用真实 AI/登录/外网；PNG 为本文件用 zlib 生成的合成图（明确非真实生图）。
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';
import http from 'node:http';
import {createHash} from 'node:crypto';
import {createStudio} from '../../server.mjs';
import {createProject, id, panel} from '../../public/model.js';
import {ensureProjectPanelGeneration} from '../../public/panel-generation.js';
import {inspectImageBuffer} from '../../../协作/lib/protocol.mjs';

export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function waitFor(check, message, {timeout = 8000, interval = 15} = {}) {
  const started = Date.now();
  let lastError = null;
  while (Date.now() - started < timeout) {
    try {
      if (await check()) return;
    } catch (error) {
      lastError = error;
    }
    await sleep(interval);
  }
  throw new Error(message + (lastError ? '（最后一次错误：' + lastError.message + '）' : ''));
}

// ---------------------------------------------------------------------------
// 合成 PNG（RGB、8bit）：纯 zlib + 手写 CRC，避免依赖原生 canvas。
// ---------------------------------------------------------------------------
const CRC_TABLE = Uint32Array.from({length: 256}, (_, n) => {
  let value = n;
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  return value >>> 0;
});
function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBytes, data]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}
export function makePng(width = 64, height = 48, {r = 40, g = 120, b = 200} = {}) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const row = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x++) {
    row[1 + x * 3] = r;
    row[2 + x * 3] = g;
    row[3 + x * 3] = b;
  }
  const raw = Buffer.concat(Array.from({length: height}, (_, y) => {
    const line = Buffer.from(row);
    line[0] = 0;
    line[1] = (r + y) % 256;
    return line;
  }));
  return Buffer.concat([signature, pngChunk('IHDR', ihdr), pngChunk('IDAT', zlib.deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0))]);
}
export const sha256Hex = value => createHash('sha256').update(value).digest('hex');

// ---------------------------------------------------------------------------
// createStudio + fake bridge 实例
// ---------------------------------------------------------------------------
/**
 * @param {object} test node:test 的 t
 * @param {{directory?:string, maxConcurrent?:number, generatedBytes?:Buffer, prefix?:string}} [options]
 */
export async function createComicFixture(test, {directory = null, maxConcurrent = 6, generatedBytes = null, prefix = 'comic-collab-',teamProductionNodeFile=null,teamProductionFetcher=async()=>({ok:true,json:async()=>({items:[],members:[]})})} = {}) {
  const root = directory || fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const dataDir = path.join(root, 'data');
  const synthetic = generatedBytes || makePng(64, 48);
  const calls = [];
  const pendingHolds = [];
  const bridge = {
    close() {},
    status: async () => ({connected: true, imageFeature: true}),
    async generate(directoryArg, input, refs, options = {}) {
      calls.push({directory: directoryArg, input: JSON.parse(JSON.stringify(input)), refs: [...refs], options});
      if (pendingHolds.length) await pendingHolds.shift().promise;
      return {bytes: synthetic, imageToolSeen: true, description: '合成测试图（非真实生图）'};
    },
  };
  const studio = createStudio({dataDir, teamProductionNodeFile,teamProductionFetcher,maxConcurrent, bridge, jimengBridge: bridge, storyboardGenerator: {close() {}}});
  await new Promise((resolve, reject) => {
    studio.server.once('error', reject);
    studio.server.listen(0, '127.0.0.1', resolve);
  });
  const origin = 'http://127.0.0.1:' + studio.server.address().port;
  const request = async (route, method = 'GET', value, {timeoutMs = 15000} = {}) => {
    const response = await fetch(origin + route, {
      method,
      headers: value === undefined ? {} : {'Content-Type': 'application/json'},
      body: value === undefined ? undefined : JSON.stringify(value),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await response.text();
    let parsed = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
    return {status: response.status, value: parsed, headers: response.headers};
  };
  const requestRaw = async route => {
    const response = await fetch(origin + route, {signal: AbortSignal.timeout(15000)});
    return {status: response.status, bytes: Buffer.from(await response.arrayBuffer()), headers: response.headers};
  };
  const holdNext = () => {
    let release;
    const promise = new Promise(resolve => { release = resolve; });
    pendingHolds.push({promise, release});
    return release;
  };
  const releaseAllHolds = () => { while (pendingHolds.length) pendingHolds.shift().release(); };
  const waitForCalls = (count, message = 'fake bridge 没有被调用') => waitFor(() => calls.length >= count, message);
  const fixture = {
    root,
    dataDir,
    directory: root,
    studio,
    calls,
    origin,
    api: request,
    apiRaw: requestRaw,
    holdNext,
    releaseAllHolds,
    waitForCalls,
    waitFor: (check, message, options) => waitFor(check, message, options),
    settle: async () => {
      await waitFor(async () => (await request('/api/state')).value.jobs.every(job => !['queued', 'running'].includes(job.status)), '任务没有在限定时间内结束');
      return (await request('/api/state')).value;
    },
  };
  test.after(async () => {
    releaseAllHolds();
    try { studio.close(); } catch {}
    await new Promise(resolve => {
      try { studio.server.close(() => resolve()); } catch { resolve(); }
      setTimeout(resolve, 2000).unref?.();
    });
    fs.rmSync(root, {recursive: true, force: true});
  });
  return fixture;
}

/** 建一个带参考资产和 N 个画格的工程，返回引用（画格来自 store 内的当前对象）。 */
export async function seedProject(fixture, {title = '协作接入测试工程', referenceCount = 1, panelCount = 1} = {}) {
  const {api, directory, studio} = fixture;
  const project = createProject(title);
  const assets = [];
  for (let index = 0; index < referenceCount; index++) {
    const filePath = path.join(directory, 'reference-' + index + '.png');
    fs.writeFileSync(filePath, makePng(32, 24, {r: 30 + index * 40, g: 90, b: 160}));
    const created = await api('/api/assets', 'POST', {filePath});
    if (created.status !== 201) throw new Error('登记参考资产失败：' + JSON.stringify(created.value));
    assets.push(created.value);
  }
  project.references = assets.map((asset, index) => ({assetId: asset.id, name: '角色' + index, role: 'character'}));
  project.shots[0].referenceIds = assets.map(asset => asset.id);
  while (project.pages[0].panels.length < panelCount) {
    const shot = JSON.parse(JSON.stringify(project.shots[0]));
    shot.id = id('shot');
    shot.code = 'S' + String(project.shots.length + 1).padStart(2, '0');
    shot.referenceIds = assets.map(asset => asset.id);
    project.shots.push(shot);
    project.pages[0].panels.push(panel(shot.id, 100, 100 + project.pages[0].panels.length * 220, 420, 200));
  }
  ensureProjectPanelGeneration(project, assets);
  studio.store.db.projects.push(project);
  studio.store.save();
  return {project, panels: project.pages[0].panels, assets, references: project.references};
}

/** 直接改内存工程并保存（模拟用户在等待期间的编辑）。revision 默认 +1。 */
export function mutateProject(studio, projectId, mutate, {bumpRevision = true} = {}) {
  const project = studio.store.project(projectId);
  mutate(project);
  if (bumpRevision) project.revision += 1;
  project.updated = new Date().toISOString();
  studio.store.markProject?.(project);
  studio.store.save();
  return project;
}

/** B 端 POST /api/collab/generation 用的自包含请求（不是 A 端 prepare 的替代品，只用于执行层测试）。 */
export function collabGenerationPayload({referenceFile = null, role = 'character', name = '叶麟', taskId = 'task_synthetic_0001', attempt = 1, provider = 'codex', shotCode = 'E01-001', projectId = 'project_synthetic', panelId = 'panel_synthetic'} = {}) {
  const referenceRoles = referenceFile ? [{assetId: 'asset_remote_a', name, role}] : [];
  const referenceFiles = referenceFile ? [{role, name, filePath: referenceFile}] : [];
  return {
    taskId,
    attempt,
    provider,
    projectId,
    panelId,
    panelCode: shotCode,
    target: {projectId, panelId, panelCode: shotCode, episode: 1, expected: {revision: 0, panelContentKey: 'x'.repeat(40), geometryKey: 'g'.repeat(40), referenceKey: 'r'.repeat(40), generationToken: null}},
    generationInput: {
      action: 'generate',
      projectId,
      projectTitle: '合成工程',
      shot: {id: 'shot_synthetic', code: shotCode, title: '合成镜头', description: '合成提示词：人物站在门口', productionPrompt: '合成提示词：人物站在门口', negativePrompt: ''},
      style: '合成画风',
      panel: {id: panelId, name: shotCode, w: 800, h: 600},
      nativeSizing: null,
      editPrompt: '',
      cropBox: null,
      maskPolygon: null,
      feather: 0,
      border: 4,
      referenceRoles,
    },
    referenceFiles,
  };
}

// ---------------------------------------------------------------------------
// 假中控（内置 http，只实现本客户端用到的 §4 子集）
// ---------------------------------------------------------------------------
const sendJson = (response, status, value) => {
  const body = Buffer.from(JSON.stringify(value));
  response.writeHead(status, {'Content-Type': 'application/json; charset=utf-8', 'Content-Length': body.length});
  response.end(body);
};
const sendBytes = (response, bytes, mime = 'image/png') => {
  response.writeHead(200, {'Content-Type': mime, 'Content-Length': bytes.length});
  response.end(bytes);
};
async function readBody(request, maxBytes = 8 * 1024 * 1024) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > maxBytes) throw Object.assign(new Error('请求体过大'), {status: 413});
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
async function readJsonBody(request) {
  const buffer = await readBody(request);
  return JSON.parse(buffer.toString('utf8') || '{}');
}

export async function startFakeHub(test, {pairingCode = 'PAIR01', token = 'tok_synthetic', clientId = 'client_synthetic'} = {}) {
  const state = {
    pairingCode,
    token,
    clientId,
    hubId: 'hub_synthetic',
    hubName: '合成协作中控',
    blobs: new Map(),
    tasks: new Map(),
    idempotency: new Map(),
    assets: new Map(),
    notifications: [],
    applies: [],
    reads: [],
    calls: [],
    taskSeq: 0,
  };
  const server = http.createServer(async (request, response) => {
    let pathname = '/';
    try {
      const url = new URL(request.url, 'http://127.0.0.1');
      pathname = decodeURIComponent(url.pathname);
      state.calls.push({method: request.method, path: pathname, query: url.search});
      const headerToken = String(request.headers['x-collab-token'] || request.headers['x-node-token'] || '').trim() || (String(request.headers.authorization || '').toLowerCase().startsWith('bearer ') ? String(request.headers.authorization).slice(7).trim() : '');
      const publicRoute = pathname === '/api/health' || pathname === '/api/pair';
      if (!publicRoute && headerToken !== state.token) return sendJson(response, 401, {error: '访问令牌无效', code: 'unauthorized'});
      if (request.method === 'POST' && pathname === '/api/pair') {
        const payload = await readJsonBody(request);
        if (payload.pairingCode !== state.pairingCode) return sendJson(response, 401, {error: '配对码不正确', code: 'bad_pairing_code'});
        return sendJson(response, 200, {clientId: state.clientId, nodeId: null, token: state.token, role: payload.role || 'client', hubId: state.hubId, hubName: state.hubName, protocolVersion: '1.0.0'});
      }
      if (request.method === 'GET' && pathname === '/api/health') return sendJson(response, 200, {application: 'photocraft-collab-hub', version: '1.0.0', protocolVersion: '1.0.0', hubId: state.hubId, hubName: state.hubName, time: new Date().toISOString(), pairingRequired: true, nodes: {total: 1, online: 1}, tasks: {queued: 0, running: 0, done: 0}, assets: {total: state.assets.size}});
      if (request.method === 'PUT' && pathname === '/api/blobs') {
        const bytes = await readBody(request);
        const sha = String(request.headers['x-sha256'] || '').toLowerCase();
        if (!/^[0-9a-f]{64}$/.test(sha) || sha256Hex(bytes) !== sha) return sendJson(response, 400, {error: 'sha256 不一致', code: 'invalid_sha256'});
        const info = inspectImageBuffer(bytes);
        if (!info) return sendJson(response, 400, {error: '不是有效图片', code: 'invalid_image'});
        const deduped = state.blobs.has(sha);
        state.blobs.set(sha, {bytes, mime: info.mime});
        return sendJson(response, 200, {sha256: sha, blobId: 'blob_' + sha, size: bytes.length, mime: info.mime, width: info.width, height: info.height, deduped});
      }
      let match = pathname.match(/^\/api\/blobs\/([0-9a-f]{64})(\/thumb)?$/);
      if (request.method === 'GET' && match) {
        const blob = state.blobs.get(match[1]);
        if (!blob) return sendJson(response, 404, {error: '图片不存在', code: 'blob_not_found'});
        if (match[2]) return sendJson(response, 404, {error: '缩略图不可用', code: 'thumb_unavailable'});
        return sendBytes(response, blob.bytes, blob.mime);
      }
      if (request.method === 'POST' && pathname === '/api/tasks') {
        const payload = await readJsonBody(request);
        const key = String(payload.idempotencyKey || '');
        if (!key) return sendJson(response, 400, {error: '缺少幂等键', code: 'missing_idempotency_key'});
        const payloadHash = sha256Hex(Buffer.from(JSON.stringify(payload)));
        const existingId = state.idempotency.get(key);
        if (existingId) {
          const existing = state.tasks.get(existingId);
          if (existing.payloadHash !== payloadHash) return sendJson(response, 409, {error: '幂等键对应的内容不同', code: 'idempotency_conflict'});
          return sendJson(response, 200, {task: existing.task, duplicate: true});
        }
        const taskId = 'task_' + String(++state.taskSeq).padStart(4, '0');
        const task = {
          id: taskId,
          idempotencyKey: key,
          type: payload.type || 'panel-generation',
          status: 'queued',
          phase: 'queued',
          projectId: payload.projectId,
          projectName: payload.projectName,
          episode: payload.episode ?? null,
          panelCode: payload.panelCode,
          panelId: payload.panelId,
          shotCode: payload.shotCode,
          prompt: payload.prompt,
          style: payload.style,
          size: payload.size,
          target: payload.target,
          generationInput: payload.generationInput,
          references: payload.references,
          submittedBy: payload.submittedBy,
          submittedAt: new Date().toISOString(),
          activeAttempt: 0,
          attempts: [],
          result: null,
          apply: {status: 'pending', detail: '', at: null, by: null},
        };
        state.idempotency.set(key, taskId);
        state.tasks.set(taskId, {task, payloadHash, payload});
        return sendJson(response, 201, {task});
      }
      if (request.method === 'GET' && pathname === '/api/tasks') {
        const url = new URL(request.url, 'http://127.0.0.1');
        const submittedBy = url.searchParams.get('submittedBy');
        const status = url.searchParams.get('status');
        const applyStatus = url.searchParams.get('applyStatus');
        const projectId = url.searchParams.get('projectId');
        const limit = Number(url.searchParams.get('limit') || 100);
        const offset = Number(url.searchParams.get('offset') || 0);
        let tasks = [...state.tasks.values()].map(item => item.task);
        if (submittedBy) tasks = tasks.filter(task => task.submittedBy === submittedBy);
        if (projectId) tasks = tasks.filter(task => task.projectId === projectId);
        if (status) tasks = tasks.filter(task => task.status === status);
        if (applyStatus) tasks = tasks.filter(task => task.apply?.status === applyStatus);
        const total = tasks.length;
        tasks = tasks.slice(Number.isFinite(offset) && offset > 0 ? offset : 0);
        tasks = tasks.slice(0, Number.isFinite(limit) && limit > 0 ? limit : 100);
        return sendJson(response, 200, {tasks, total});
      }
      match = pathname.match(/^\/api\/tasks\/([^/]+)(\/(apply|retry|cancel))?$/);
      if (match) {
        const stored = state.tasks.get(match[1]);
        if (!stored) return sendJson(response, 404, {error: '任务不存在', code: 'task_not_found'});
        const task = stored.task;
        if (request.method === 'GET' && !match[2]) return sendJson(response, 200, {task});
        const action = match[3];
        if (request.method === 'POST' && action) {
          const payload = await readJsonBody(request);
          if (action === 'apply') {
            if (task.apply?.status === payload.status) return sendJson(response, 200, {ok: true, duplicate: true});
            if (task.apply?.status === 'applied' && payload.status !== 'applied') return sendJson(response, 409, {error: '已回填的任务不能再改状态', code: 'apply_final'});
            task.apply = {status: payload.status, detail: payload.detail || '', at: new Date().toISOString(), by: payload.by || ''};
            state.applies.push({taskId: task.id, ...task.apply});
            return sendJson(response, 200, {ok: true});
          }
          if (action === 'retry') { task.status = 'queued'; task.phase = 'queued'; return sendJson(response, 200, {ok: true, task}); }
          task.status = 'cancelled';
          task.phase = 'cancelled';
          return sendJson(response, 200, {ok: true, task});
        }
      }
      if (request.method === 'GET' && pathname === '/api/notifications') {
        const url = new URL(request.url, 'http://127.0.0.1');
        const since = Number(url.searchParams.get('since') || 0);
        const notifications = state.notifications.filter(item => item.seq > since);
        return sendJson(response, 200, {notifications, lastSeq: state.notifications.length});
      }
      if (request.method === 'POST' && pathname === '/api/notifications/read') {
        const payload = await readJsonBody(request);
        state.reads.push(payload);
        return sendJson(response, 200, {ok: true});
      }
      if (request.method === 'GET' && pathname === '/api/assets') {
        return sendJson(response, 200, {assets: [...state.assets.values()], total: state.assets.size});
      }
      match = pathname.match(/^\/api\/assets\/([^/]+)$/);
      if (request.method === 'GET' && match) {
        const asset = state.assets.get(match[1]);
        if (!asset) return sendJson(response, 404, {error: '资产不存在', code: 'asset_not_found'});
        return sendJson(response, 200, {asset, versions: [asset]});
      }
      if (request.method === 'POST' && pathname === '/api/assets/request') {
        const payload = await readJsonBody(request);
        return sendJson(response, 200, {mode: 'create', asset: {id: 'asset_requested', ...payload}, request: {id: 'areq_1'}, task: {id: 'task_asset_1'}});
      }
      if (request.method === 'GET' && pathname === '/api/nodes') return sendJson(response, 200, {nodes: [{id: 'node_synthetic', name: 'B电脑', status: {online: true, freeSlots: 2}}]});
      return sendJson(response, 404, {error: '接口不存在', code: 'not_found'});
    } catch (error) {
      if (!response.headersSent) sendJson(response, error.status || 500, {error: error.message, code: error.code || 'fake_hub_error'});
      else response.end();
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const origin = 'http://127.0.0.1:' + server.address().port;
  test.after(() => new Promise(resolve => {
    try { server.close(() => resolve()); } catch { resolve(); }
    setTimeout(resolve, 2000).unref?.();
  }));
  const api = {
    origin,
    state,
    /** 把任务置为 done 并写入结果 blob；返回 {sha256, task}。 */
    setTaskDone(taskId, bytes, {mime = 'image/png'} = {}) {
      const stored = state.tasks.get(taskId);
      if (!stored) throw new Error('假中控没有这个任务：' + taskId);
      const sha256 = sha256Hex(bytes);
      state.blobs.set(sha256, {bytes, mime});
      const info = inspectImageBuffer(bytes);
      stored.task.status = 'done';
      stored.task.phase = 'done';
      stored.task.apply = {status: 'pending', detail: '', at: null, by: null};
      stored.task.result = {sha256, blobId: 'blob_' + sha256, size: bytes.length, mime: info?.mime || mime, width: info?.width ?? null, height: info?.height ?? null, nodeId: 'node_synthetic', attempt: 1, uploadedAt: new Date().toISOString()};
      return {sha256, task: stored.task};
    },
    addAsset(asset, bytes) {
      const sha256 = bytes ? sha256Hex(bytes) : asset.sha256;
      if (bytes) state.blobs.set(sha256, {bytes, mime: inspectImageBuffer(bytes)?.mime || 'image/png'});
      const value = {...asset, sha256};
      state.assets.set(value.id, value);
      return value;
    },
    addNotification(notification) {
      const value = {...notification, seq: state.notifications.length + 1, createdAt: notification.createdAt || new Date().toISOString()};
      state.notifications.push(value);
      return value;
    },
    task: taskId => state.tasks.get(taskId)?.task || null,
    taskCount: () => state.tasks.size,
    applyOf(taskId) {
      const stored = state.tasks.get(taskId);
      return stored?.task.apply || null;
    },
    /** 等待中控收到某任务 apply 状态。 */
    waitForApply: (taskId, status) => waitFor(() => state.tasks.get(taskId)?.task.apply?.status === status, '中控没有收到 apply 状态 ' + status + '（任务 ' + taskId + '）'),
  };
  return api;
}
