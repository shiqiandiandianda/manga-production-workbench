// 中控 HTTP 服务：§4 全部路由 + 鉴权 + 角色隔离 + 大小限制 + 静态控制台 + 简版 SSE。
// 只依赖 node: 内置模块与协作 lib 下的模块；错误统一 {error, code}，中文原因。
import http from 'node:http';
import fsp from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  CollabError,
  HUB_APPLICATION,
  HUB_VERSION,
  PROTOCOL_VERSION,
  bearerToken,
  check,
  clampInteger,
  inspectImageBuffer,
  json,
  publicNode,
  readBody,
  readJsonBody,
} from './protocol.mjs';
import {HubState} from './hub-state.mjs';
import {HubQueue} from './hub-queue.mjs';
import {HubAssets} from './hub-assets.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PUBLIC_DIR = path.join(HERE, '..', 'public');
const SILENT_LOGGER = {info() {}, warn() {}, error() {}};
const STATIC_FILES = new Map([
  ['/', 'index.html'],
  ['/index.html', 'index.html'],
  ['/app.js', 'app.js'],
  ['/style.css', 'style.css'],
  ['/favicon.svg', 'favicon.svg'],
]);
const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
};
const SSE_HEARTBEAT_MS = 15000;

function invalidPath(message = '请求路径无效') {
  return new CollabError(message, {status: 400, code: 'invalid_path'});
}

function decodeSegments(pathname) {
  if (pathname.includes('\\') || pathname.includes('\u0000')) throw invalidPath();
  const raw = pathname.split('/').filter((part) => part.length > 0);
  const segments = [];
  for (const part of raw) {
    let decoded;
    try {
      decoded = decodeURIComponent(part);
    } catch {
      throw invalidPath('请求路径包含非法的百分号编码');
    }
    if (decoded === '.' || decoded === '..' || decoded.includes('/') || decoded.includes('\\') || decoded.includes('\u0000')) {
      throw invalidPath('请求路径包含非法片段');
    }
    segments.push(decoded);
  }
  return segments;
}

function positiveInt(value, fieldName) {
  const number = Number(value);
  check(Number.isInteger(number) && number > 0, `${fieldName} 必须是正整数`, 400, 'invalid_number');
  return number;
}

function boolValue(value, fallback = false) {
  if (value === undefined || value === null) return fallback;
  return value === true || value === 'true' || value === 1 || value === '1';
}

// 可选数值参数（query/body）：缺省或空值一律视为「未提供」，交给下游默认值。
// 不能把 null 直接交给 protocol.clampInteger：Number(null)=0 会被收敛成最小值（缺省 limit 变成 1 的 bug）。
function optionalValue(value) {
  return value === null || value === undefined || value === '' ? undefined : value;
}

async function readOptionalJson(request, maxBytes) {
  if (!request.headers['content-length'] && !request.headers['transfer-encoding']) return {};
  return readJsonBody(request, maxBytes);
}

function sendJson(response, status, value) {
  json(response, status, value);
  return true;
}

function sendError(runtime, response, error) {
  if (response.headersSent) {
    try {
      response.destroy();
    } catch {}
    return;
  }
  if (error instanceof CollabError) {
    sendJson(response, error.status || 400, {error: error.message, code: error.code || 'collab_error'});
    return;
  }
  runtime.logger.error?.(`[中控] 请求处理异常：${(error && error.stack) || error}`);
  sendJson(response, 500, {error: '中控内部错误', code: 'internal_error'});
}

function requestToken(request, url) {
  let token = bearerToken(request);
  if (!token && request.method === 'GET' && (url.pathname.startsWith('/api/blobs/') || url.pathname === '/api/events')) {
    token = url.searchParams.get('token') || '';
  }
  return String(token || '').trim();
}

function authenticate(runtime, request, url) {
  const token = requestToken(request, url);
  if (!token) throw new CollabError('缺少访问令牌', {status: 401, code: 'missing_token'});
  const client = runtime.hub.findClientByToken(token);
  if (!client) throw new CollabError('令牌无效或设备未配对', {status: 401, code: 'invalid_token'});
  if (client.revoked) throw new CollabError('令牌已被吊销', {status: 403, code: 'token_revoked'});
  return client;
}

function requireClient(ctx) {
  if (ctx.client.role !== 'client') {
    throw new CollabError('该接口仅允许客户端令牌访问', {status: 403, code: 'client_token_required'});
  }
}

function requireNodeToken(ctx) {
  if (ctx.client.role !== 'node') {
    throw new CollabError('该接口仅允许节点令牌访问', {status: 403, code: 'node_token_required'});
  }
  if (!ctx.node) throw new CollabError('节点记录不存在', {status: 403, code: 'node_not_found'});
  if (ctx.node.revoked) throw new CollabError('节点已被吊销', {status: 403, code: 'node_revoked'});
}

// ---------------------------------------------------------------------------
// 路由处理
// ---------------------------------------------------------------------------
async function handleRequest(runtime, request, response) {
  const method = String(request.method || 'GET').toUpperCase();
  let url;
  try {
    url = new URL(request.url || '/', 'http://hub.local');
  } catch {
    throw invalidPath();
  }
  const pathname = url.pathname;
  const segments = decodeSegments(pathname);

  // §4.1 公共接口：health / pair 不需要令牌。
  if (pathname === '/api/health' && method === 'GET') return handleHealth(runtime, response);
  if (pathname === '/api/pair' && method === 'POST') return handlePair(runtime, request, response);

  if (!pathname.startsWith('/api/')) {
    if (method !== 'GET') throw new CollabError('接口不存在', {status: 404, code: 'not_found'});
    return handleStatic(runtime, response, pathname);
  }

  const client = authenticate(runtime, request, url);
  const ctx = {client, node: null};
  if (client.role === 'node') {
    const node = runtime.hub.getNode(client.nodeId);
    if (!node) throw new CollabError('节点记录不存在', {status: 403, code: 'node_not_found'});
    if (node.revoked) throw new CollabError('节点已被吊销', {status: 403, code: 'node_revoked'});
    ctx.node = node;
  }

  const api = segments.slice(1); // 去掉 api 段
  const head = api[0] || '';

  switch (head) {
    case 'node':
      return handleNodeRoute(runtime, ctx, method, api, request, response);
    case 'blobs':
      return handleBlobRoute(runtime, ctx, method, api, request, response, url);
    case 'tasks':
      return handleTaskRoute(runtime, ctx, method, api, request, response, url);
    case 'assets':
      return handleAssetRoute(runtime, ctx, method, api, request, response, url);
    case 'notifications':
      return handleNotificationRoute(runtime, ctx, method, api, request, response, url);
    case 'nodes':
      return handleNodesRoute(runtime, ctx, method, api, request, response);
    case 'admin':
      return handleAdminRoute(runtime, ctx, method, api, response);
    case 'events':
      if (method === 'GET' && api.length === 1) return handleEvents(runtime, ctx, request, response);
      break;
    default:
      break;
  }
  throw new CollabError('接口不存在', {status: 404, code: 'not_found'});
}

function handleHealth(runtime, response) {
  const {hub} = runtime;
  const counts = hub.counts();
  sendJson(response, 200, {
    application: HUB_APPLICATION,
    version: HUB_VERSION,
    protocolVersion: PROTOCOL_VERSION,
    hubId: hub.state.hubId,
    hubName: hub.state.hubName,
    codeRoot: path.resolve(HERE, '..', '..'),
    dataRoot: hub.dataDir,
    time: hub.nowIso(),
    pairingRequired: hub.config.pairingEnabled,
    nodes: {total: counts.nodes.total, online: counts.nodes.online},
    tasks: {
      queued: counts.tasks.queued,
      running: counts.tasks.running,
      uploading: counts.tasks.uploading,
      verifying: counts.tasks.verifying,
      done: counts.tasks.done,
      failed: counts.tasks.failed,
    },
    assets: {total: counts.assets.total},
  });
  return true;
}

async function handlePair(runtime, request, response) {
  const body = await readJsonBody(request, runtime.config.jsonBodyMaxBytes);
  const result = runtime.hub.pair(body);
  // 日志绝不打印 token。
  runtime.logger.info?.(`[中控] 设备配对成功：${result.client.role === 'node' ? '节点' : '客户端'}「${result.client.name}」`);
  sendJson(response, 200, {
    clientId: result.client.id,
    nodeId: result.node ? result.node.id : null,
    token: result.token,
    role: result.client.role,
    hubId: runtime.hub.state.hubId,
    hubName: runtime.hub.state.hubName,
    protocolVersion: PROTOCOL_VERSION,
  });
  return true;
}

// ---------------------------------------------------------------------------
// 节点接口（role=node）
// ---------------------------------------------------------------------------
async function handleNodeRoute(runtime, ctx, method, api, request, response) {
  requireNodeToken(ctx);
  const {queue} = runtime;
  if(api.length===2&&api[1]==='volunteer'&&method==='POST'){
    const body=await readJsonBody(request,4096);check(typeof body.taskId==='string'&&body.taskId.length<=160,'请选择待接单任务',400,'invalid_task');
    sendJson(response,202,queue.requestVolunteer(ctx.node.id,body.taskId));return true;
  }
  if(api.length===2&&api[1]==='settings'&&method==='POST'){
    const body=await readJsonBody(request,runtime.config.jsonBodyMaxBytes);
    const node=runtime.hub.updateNodeSettings(ctx.node.id,body);
    sendJson(response,200,{node:publicNode(node)});return true;
  }
  // POST /api/node/heartbeat
  if (api.length === 2 && api[1] === 'heartbeat' && method === 'POST') {
    const body = await readJsonBody(request, runtime.config.jsonBodyMaxBytes);
    check(body && typeof body === 'object' && !Array.isArray(body), '心跳请求必须是对象', 400, 'invalid_body');
    const result = queue.heartbeat(ctx.node.id, body);
    sendJson(response, 200, result);
    return true;
  }
  if (api.length === 4 && api[1] === 'tasks') {
    const taskId = api[2];
    const action = api[3];
    if (action === 'progress' && method === 'POST') {
      const body = await readJsonBody(request, runtime.config.jsonBodyMaxBytes);
      const result = queue.progress(taskId, {
        attempt: positiveInt(body.attempt, 'attempt'),
        phase: String(body.phase || ''),
        message: String(body.message || ''),
      }, ctx.node.id);
      sendJson(response, 200, result);
      return true;
    }
    if (action === 'fail' && method === 'POST') {
      const body = await readJsonBody(request, runtime.config.jsonBodyMaxBytes);
      const result = queue.failTask(taskId, {
        attempt: positiveInt(body.attempt, 'attempt'),
        error: body.error === undefined ? '' : body.error,
        likelyGenerated: boolValue(body.likelyGenerated, false),
      }, ctx.node.id);
      sendJson(response, 200, result);
      return true;
    }
    if (action === 'result' && method === 'PUT') {
      const attempt = positiveInt(request.headers['x-attempt'], 'x-attempt');
      const declaredSha = request.headers['x-sha256'] ? String(request.headers['x-sha256']).trim().toLowerCase() : null;
      const buffer = await readBody(request, runtime.config.resultMaxBytes);
      const result = queue.uploadResult(taskId, {attempt, sha256: declaredSha, buffer, nodeId: ctx.node.id});
      sendJson(response, 200, result);
      return true;
    }
    if (action === 'verify' && method === 'POST') {
      const body = await readJsonBody(request, runtime.config.jsonBodyMaxBytes);
      const result = queue.verifyTask(taskId, {
        attempt: positiveInt(body.attempt, 'attempt'),
        outcome: String(body.outcome || ''),
        message: String(body.message || ''),
      }, ctx.node.id);
      sendJson(response, 200, result);
      return true;
    }
  }
  throw new CollabError('节点接口不存在', {status: 404, code: 'not_found'});
}

// ---------------------------------------------------------------------------
// 图片 blob（节点只读；客户端可读写）
// ---------------------------------------------------------------------------
async function handleBlobRoute(runtime, ctx, method, api, request, response, url) {
  const {assets} = runtime;
  if (api.length === 1 && method === 'PUT') {
    requireClient(ctx);
    const expectedSha = request.headers['x-sha256'] ? String(request.headers['x-sha256']).trim() : null;
    const buffer = await readBody(request, runtime.config.resultMaxBytes);
    const blob = assets.putBlobBuffer(buffer, {expectedSha256: expectedSha, maxBytes: runtime.config.resultMaxBytes});
    sendJson(response, 200, blob);
    return true;
  }
  if (api.length === 2 && method === 'GET') {
    const sha = api[1];
    let buffer;
    try {
      buffer = assets.readBlob(sha);
    } catch {
      buffer = null;
    }
    if (!buffer) throw new CollabError('图片不存在', {status: 404, code: 'blob_not_found'});
    const info = inspectImageBuffer(buffer);
    const mime = info ? info.mime : 'application/octet-stream';
    response.writeHead(200, {
      'Content-Type': mime,
      'Content-Length': buffer.length,
      'Cache-Control': 'private, max-age=86400',
      'X-Content-Type-Options': 'nosniff',
    });
    response.end(buffer);
    return true;
  }
  if (api.length === 3 && api[2] === 'thumb' && method === 'GET') {
    const sha = api[1];
    const thumb = await assets.ensureThumb(sha);
    if (!thumb) throw new CollabError('缩略图暂不可用，请回退原图', {status: 404, code: 'thumb_unavailable'});
    response.writeHead(200, {
      'Content-Type': thumb.mime || 'image/png',
      'Content-Length': thumb.buffer.length,
      'Cache-Control': 'private, max-age=86400',
      'X-Content-Type-Options': 'nosniff',
    });
    response.end(thumb.buffer);
    return true;
  }
  void url;
  throw new CollabError('图片接口不存在', {status: 404, code: 'not_found'});
}

// ---------------------------------------------------------------------------
// 任务（role=client）
// ---------------------------------------------------------------------------
async function handleTaskRoute(runtime, ctx, method, api, request, response, url) {
  requireClient(ctx);
  const {queue} = runtime;
  if (api.length === 1 && method === 'POST') {
    const body = await readJsonBody(request, runtime.config.jsonBodyMaxBytes);
    const result = queue.submitTask(body, {clientId: ctx.client.id});
    if (result.duplicate) {
      sendJson(response, 200, {task: queue.publicTask(result.task, {includeInput: true}), duplicate: true});
    } else {
      sendJson(response, 201, {task: queue.publicTask(result.task, {includeInput: true})});
    }
    return true;
  }
  if (api.length === 1 && method === 'GET') {
    const result = queue.listTasks({
      projectId: url.searchParams.get('projectId'),
      submittedBy: url.searchParams.get('submittedBy'),
      status: url.searchParams.get('status'),
      applyStatus: url.searchParams.get('applyStatus'),
      since: url.searchParams.get('since'),
      // 缺省 limit 必须交给 listTasks 的 fallback（100），不能把 null 传进去（clampInteger(null)→1）。
      limit: optionalValue(url.searchParams.get('limit')),
      include: url.searchParams.get('include'),
    });
    sendJson(response, 200, result);
    return true;
  }
  if (api.length === 2 && method === 'GET') {
    sendJson(response, 200, {task: queue.getTaskDetail(api[1])});
    return true;
  }
  if (api.length === 3 && method === 'POST') {
    const taskId = api[1];
    const action = api[2];
    check(queue.getTaskOrThrow(taskId).submittedBy===ctx.client.id,'只能管理自己发起的生成请求',403,'task_owner_required');
    if (action === 'cancel') {
      sendJson(response, 200, queue.cancelTask(taskId, {by: ctx.client.id}));
      return true;
    }
    if (action === 'retry') {
      const body = await readOptionalJson(request, runtime.config.jsonBodyMaxBytes);
      sendJson(response, 200, queue.retryTask(taskId, {reason: String(body.reason || ''), by: ctx.client.id}));
      return true;
    }
    if (action === 'apply') {
      const body = await readJsonBody(request, runtime.config.jsonBodyMaxBytes);
      const result = queue.applyTask(taskId, {
        status: String(body.status || ''),
        detail: String(body.detail || ''),
        by: body.by || ctx.client.id,
      });
      sendJson(response, 200, result);
      return true;
    }
  }
  throw new CollabError('任务接口不存在', {status: 404, code: 'not_found'});
}

// ---------------------------------------------------------------------------
// 资产（role=client）
// ---------------------------------------------------------------------------
async function handleAssetRoute(runtime, ctx, method, api, request, response, url) {
  requireClient(ctx);
  const {assets} = runtime;
  if (api.length === 1 && method === 'GET') {
    sendJson(response, 200, {
      ...assets.listAssets({
        projectId: url.searchParams.get('projectId'),
        q: url.searchParams.get('q'),
        kind: url.searchParams.get('kind'),
        status: url.searchParams.get('status'),
        allVersions: url.searchParams.get('allVersions'),
        // null / 空串 → undefined，让 listAssets 使用默认 limit=100 / offset=0。
        limit: optionalValue(url.searchParams.get('limit')),
        offset: optionalValue(url.searchParams.get('offset')),
      }),
      lastSeq: runtime.hub.state.counters.notificationSeq,
    });
    return true;
  }
  if (api.length === 2 && api[1] === 'request' && method === 'POST') {
    const body = await readJsonBody(request, runtime.config.jsonBodyMaxBytes);
    const result = assets.requestAsset(body, {clientId: ctx.client.id});
    sendJson(response, 200, result);
    return true;
  }
  if (api.length === 2 && method === 'GET') {
    sendJson(response, 200, assets.getAssetDetail(api[1]));
    return true;
  }
  throw new CollabError('资产接口不存在', {status: 404, code: 'not_found'});
}

// ---------------------------------------------------------------------------
// 通知（客户端 / 节点均可读）
// ---------------------------------------------------------------------------
async function handleNotificationRoute(runtime, ctx, method, api, request, response, url) {
  const {hub} = runtime;
  if (api.length === 1 && method === 'GET') {
    const limitParam = url.searchParams.get('limit');
    const sinceParam = url.searchParams.get('since');
    let since = 0;
    if (sinceParam !== null && sinceParam !== '') {
      since = clampInteger(sinceParam, 0, Number.MAX_SAFE_INTEGER, 0);
    } else if (ctx.client.role === 'node') {
      since = hub.notificationSinceForClient(ctx.client.id);
    }
    const result = hub.notificationsFor({
      clientId: ctx.client.id,
      since,
      // 缺省 / 空串 limit 用默认 100；数字才进入 clamp。
      limit: clampInteger(optionalValue(limitParam), 1, 500, 100),
      advance: ctx.client.role === 'node',
    });
    sendJson(response, 200, result);
    return true;
  }
  if (api.length === 2 && api[1] === 'read' && method === 'POST') {
    requireClient(ctx);
    const body = await readJsonBody(request, runtime.config.jsonBodyMaxBytes);
    const changed = hub.markNotificationsRead(body.ids, ctx.client.id);
    sendJson(response, 200, {ok: true, read: changed});
    return true;
  }
  throw new CollabError('通知接口不存在', {status: 404, code: 'not_found'});
}

// ---------------------------------------------------------------------------
// 节点管理（role=client）
// ---------------------------------------------------------------------------
async function handleNodesRoute(runtime, ctx, method, api, request, response) {
  requireClient(ctx);
  const {hub} = runtime;
  if (api.length === 1 && method === 'GET') {
    sendJson(response, 200, {nodes: hub.allNodes().map((node) => publicNode(node))});
    return true;
  }
  if (api.length === 3 && method === 'POST') {
    const nodeId = api[1];
    if (api[2] === 'settings') {
      const body = await readJsonBody(request, runtime.config.jsonBodyMaxBytes);
      // 可选字段的 null/空串视为「未提供」，避免 maxConcurrency=null 被 clamp 成 1、enabled=null 被当成 false。
      const patch = {...body};
      for (const key of ['enabled', 'paused', 'maxConcurrency']) {
        if (patch[key] === null || patch[key] === '') delete patch[key];
      }
      const node = hub.updateNodeSettings(nodeId, patch);
      sendJson(response, 200, {node: publicNode(node)});
      return true;
    }
    if (api[2] === 'revoke') {
      const result = hub.revokeNode(nodeId);
      sendJson(response, 200, {ok: true, alreadyRevoked: result.alreadyRevoked, node: publicNode(result.node)});
      return true;
    }
  }
  throw new CollabError('节点管理接口不存在', {status: 404, code: 'not_found'});
}

function handleAdminRoute(runtime, ctx, method, api, response) {
  requireClient(ctx);
  const {hub} = runtime;
  if (api.length === 2 && api[1] === 'pairing' && method === 'GET') {
    sendJson(response, 200, {pairingCode: hub.rotationCode()});
    return true;
  }
  if (api.length === 2 && api[1] === 'rotate-pairing' && method === 'POST') {
    const pairingCode = hub.rotatePairing();
    runtime.logger.info?.('[中控] 配对码已轮换');
    sendJson(response, 200, {pairingCode});
    return true;
  }
  throw new CollabError('管理接口不存在', {status: 404, code: 'not_found'});
}

// ---------------------------------------------------------------------------
// SSE（简版，控制台可用轮询替代）
// ---------------------------------------------------------------------------
function handleEvents(runtime, ctx, request, response) {
  response.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  response.write('retry: 3000\n\n');
  runtime.sseClients.add(response);
  const ping = setInterval(() => {
    try {
      response.write(': ping\n\n');
    } catch {
      // 连接已断开时由 close 事件清理。
    }
  }, SSE_HEARTBEAT_MS);
  ping.unref?.();
  request.on('close', () => {
    clearInterval(ping);
    runtime.sseClients.delete(response);
  });
  void ctx;
  return true;
}

function broadcastSse(runtime, event) {
  if (runtime.sseClients.size === 0) return;
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const response of runtime.sseClients) {
    try {
      response.write(payload);
    } catch {
      runtime.sseClients.delete(response);
    }
  }
}

// ---------------------------------------------------------------------------
// 静态控制台（白名单，防目录穿越；public 目录还不存在时 404 而不是崩溃）
// ---------------------------------------------------------------------------
async function handleStatic(runtime, response, pathname) {
  const relative = STATIC_FILES.get(pathname);
  if (!relative) throw new CollabError('页面不存在', {status: 404, code: 'not_found'});
  const publicRoot = path.resolve(runtime.publicDir);
  const target = path.resolve(publicRoot, relative);
  if (target !== publicRoot && !target.startsWith(`${publicRoot}${path.sep}`)) {
    throw invalidPath('静态文件路径越界');
  }
  let buffer;
  try {
    buffer = await fsp.readFile(target);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') {
      throw new CollabError('控制台页面尚未安装（开发/协作/public 目录不存在）', {status: 404, code: 'console_not_found'});
    }
    throw error;
  }
  const extension = path.extname(target).toLowerCase();
  response.writeHead(200, {
    'Content-Type': CONTENT_TYPES[extension] || 'application/octet-stream',
    'Content-Length': buffer.length,
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(buffer);
  return true;
}

// ---------------------------------------------------------------------------
// 创建 / 关闭
// ---------------------------------------------------------------------------
export function createHubServer({
  dataDir,
  config = {},
  hubName,
  publicDir = DEFAULT_PUBLIC_DIR,
  logger,
  now,
  startTimers = true,
  recoverOnStart = true,
} = {}) {
  const resolvedLogger = logger && typeof logger === 'object' ? {...SILENT_LOGGER, ...logger} : SILENT_LOGGER;
  const hub = new HubState({dataDir, config, hubName, now, logger: resolvedLogger});
  const assets = new HubAssets({hub, logger: resolvedLogger});
  const queue = new HubQueue({hub, assets, logger: resolvedLogger});
  assets.attachQueue(queue);
  const runtime = {
    hub,
    queue,
    assets,
    config: hub.config,
    dataDir: hub.dataDir,
    publicDir,
    logger: resolvedLogger,
    sseClients: new Set(),
    server: null,
    recovery: null,
    closed: false,
  };
  runtime.server = http.createServer((request, response) => {
    handleRequest(runtime, request, response).catch((error) => sendError(runtime, response, error));
  });
  hub.onEvent((event) => broadcastSse(runtime, event));
  if (recoverOnStart) runtime.recovery = queue.recoverAfterRestart();
  if (startTimers) queue.startTimers();
  runtime.listen = (options = {}) =>
    new Promise((resolve, reject) => {
      const onError = (error) => {
        runtime.server.off('listening', onListening);
        reject(error);
      };
      const onListening = () => {
        runtime.server.off('error', onError);
        resolve(runtime.server.address());
      };
      runtime.server.once('error', onError);
      runtime.server.once('listening', onListening);
      runtime.server.listen(options.port, options.host);
    });
  runtime.close = async () => {
    if (runtime.closed) return;
    runtime.closed = true;
    queue.stopTimers();
    for (const response of runtime.sseClients) {
      try {
        response.end();
      } catch {}
    }
    runtime.sseClients.clear();
    if (runtime.server.listening) {
      await new Promise((resolve) => {
        runtime.server.close(() => resolve());
        runtime.server.closeAllConnections?.();
      });
    }
    hub.close();
  };
  return runtime;
}

export {DEFAULT_PUBLIC_DIR, STATIC_FILES};
