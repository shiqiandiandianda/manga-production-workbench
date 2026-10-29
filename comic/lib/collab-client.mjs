// 漫画服务协作客户端（A 端与中控交互，协议 §7.2 / §7.3 / §8.2 / §9 / §10）。
// 负责：配置与配对、把本机 /api/jobs 同构的生成输入 prepare 出去、上传参考图并建中控任务、
// 后台轮询已完成任务→下载结果→按 §8 回填→上报 apply 状态、本地通知、共享资产按需下载。
// 全部使用 Node 内置 fetch；不新增依赖；测试时 hubUrl 指向本机假中控。
import {referencePackingRoles} from './reference-packing.mjs';
import {panelTextAssets} from '../public/panel-text-assets.js';
import fs from 'node:fs';
import path from 'node:path';
import {CollabError, check, inspectImageBuffer, normalizeOrigin, nowIso, readJson, readJsonBody, sha256, uid, writeJsonAtomic} from '../../协作/lib/protocol.mjs';
import {ensurePanelGeneration, panelContentKey, panelProductionShot, panelProductionSnapshot} from '../public/panel-generation.js';
import {prepareProductionFrame} from '../public/production-package-model.js';
import {verifyProductionReferenceFiles,productionReferenceVersions} from './production-reference-files.mjs';
import {panelReferenceKey, referencesForPanel} from '../public/panel-references.js';
import {pageEpisode} from '../public/episode-boards.js';
import {localImagePath} from './image-files.mjs';
import {cleanId} from './store.mjs';
import {applyCollabResult, markCollabResultSkipped, panelGeometryKey, registerLocalImageAsset} from './collab-apply.mjs';

const DEFAULT_POLL_MS = 3000;
const MIN_POLL_MS = 30;
const MAX_POLL_MS = 60000;
const NOTIFICATION_LIMIT = 500;
const RESULT_DOWNLOAD_TIMEOUT_MS = 60000;

export const COLLAB_POLL_DEFAULT_MS = DEFAULT_POLL_MS;

const json = (response, status, value) => {
  const body = Buffer.from(JSON.stringify(value));
  response.writeHead(status, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Length': body.length});
  response.end(body);
};

function writeBytes(response, bytes, mime = 'application/octet-stream') {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  response.writeHead(200, {'Content-Type': mime || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Length': buffer.length});
  response.end(buffer);
}

const userMessage = error => String(error?.message || error || '未知错误').slice(0, 900);
const clampPollMs = value => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return DEFAULT_POLL_MS;
  return Math.min(MAX_POLL_MS, Math.max(MIN_POLL_MS, Math.floor(numeric)));
};
const shortText = (value, max = 240) => String(value ?? '').trim().slice(0, max);
const isPlainObject = value => !!value && typeof value === 'object' && !Array.isArray(value);

function findPanel(project, panelId) {
  for (const page of project.pages || []) {
    const panel = (page.panels || []).find(item => item.id === panelId);
    if (panel) return {page, panel};
  }
  return null;
}

function hubHttpError(status, payload) {
  const raw = typeof payload === 'string' ? payload : (payload?.error || payload?.message || '');
  const detail = String(raw || '').trim().slice(0, 500);
  if (status === 401) return new CollabError('中控鉴权失败：' + (detail || '访问令牌无效或已过期，请重新配对'), {status: 401, code: 'hub_unauthorized'});
  if (status === 403) return new CollabError('中控拒绝访问：设备可能已被吊销，请在中控控制台重新配对', {status: 403, code: 'hub_forbidden'});
  if (status >= 500) return new CollabError('协作中控内部错误（HTTP ' + status + '）' + (detail ? '：' + detail : ''), {status: 502, code: 'hub_server_error'});
  return new CollabError('中控返回：' + (detail || 'HTTP ' + status), {status, code: payload?.code || 'hub_error'});
}

/**
 * 创建 A 端协作客户端。
 * @param {object} options
 * @param {import('./store.mjs').Store} options.store
 * @param {string} options.dataDir 漫画数据目录
 * @param {string} options.root 漫画服务代码根（定位旧版配置文件）
 * @param {object} [options.environment] 环境变量（测试可注入）
 */
export function createCollabClient({store, dataDir, root, environment = process.env, canApply=async()=>true} = {}) {
  check(store && typeof store === 'object', '缺少工程数据存储', 500);
  check(typeof dataDir === 'string' && dataDir, '缺少漫画数据目录', 500);
  const baseRoot = root || path.resolve('.');
  const legacyConfigFile = path.join(baseRoot, '..', '运行数据', '协作', '客户端.json');
  const configFile = () => (environment.COLLAB_CLIENT_CONFIG ? path.resolve(environment.COLLAB_CLIENT_CONFIG) : path.join(dataDir, 'collab', 'client-config.json'));

  function normalizeConfig(value) {
    const source = value && typeof value === 'object' ? value : {};
    let hubUrl = '';
    if (typeof source.hubUrl === 'string' && source.hubUrl.trim()) {
      try { hubUrl = normalizeOrigin(source.hubUrl); } catch { hubUrl = ''; }
    }
    return {
      hubUrl,
      token: typeof source.token === 'string' ? source.token.trim() : '',
      clientId: typeof source.clientId === 'string' ? source.clientId.trim() : '',
      clientName: typeof source.clientName === 'string' ? source.clientName.trim().slice(0, 80) : '',
      enabled: source.enabled !== false,
      autoApply: source.autoApply !== false,
      pollMs: Number.isFinite(Number(source.pollMs)) && Number(source.pollMs) > 0 ? clampPollMs(source.pollMs) : null,
    };
  }

  function loadConfig() {
    let value = readJson(configFile(), null);
    if (!value && !environment.COLLAB_CLIENT_CONFIG) {
      const legacy = readJson(legacyConfigFile, null);
      if (legacy) value = legacy;
    }
    return normalizeConfig(value);
  }

  let config = loadConfig();
  let closed = false;
  let pollTimer = null;
  let tickRunning = false;
  let lastSyncAt = null;
  let lastError = null;
  let lastPendingApply = 0;
  let recoveryWarned = false;
  const shutdown = new AbortController();
  // 同一次运行里参考图按 sha256 只上传一次；中控本身也按内容幂等。
  const uploadedBlobShas = new Set();

  // ---------------------------------------------------------------------------
  // 本地通知：dataDir/collab/notifications.json，追加、最多 500 条；合并本地回填事件与中控通知。
  // ---------------------------------------------------------------------------
  const notificationsFile = () => path.join(dataDir, 'collab', 'notifications.json');
  function loadNotifications() {
    const saved = readJson(notificationsFile(), null);
    if (!saved || typeof saved !== 'object' || !Array.isArray(saved.items)) return {version: 1, seq: 0, items: []};
    const items = saved.items.filter(item => item && typeof item === 'object').slice(-NOTIFICATION_LIMIT);
    return {version: 1, seq: Math.max(Number(saved.seq) || 0, ...items.map(item => Number(item.seq) || 0)), items};
  }
  const notificationState = loadNotifications();
  let hubNotificationSince = Math.max(0, ...notificationState.items.map(item => Number(item.hubSeq) || 0));
  function saveNotifications() {
    writeJsonAtomic(notificationsFile(), {version: 1, seq: notificationState.seq, items: notificationState.items.slice(-NOTIFICATION_LIMIT)});
  }
  function appendNotification(entry) {
    const item = {
      id: uid('ntf'),
      seq: ++notificationState.seq,
      level: ['info', 'success', 'warn', 'error'].includes(entry.level) ? entry.level : 'info',
      type: shortText(entry.type, 60) || 'collab',
      title: shortText(entry.title, 180),
      body: shortText(entry.body, 2000),
      taskId: entry.taskId || null,
      assetId: entry.assetId || null,
      source: entry.source === 'hub' ? 'hub' : 'local',
      hubSeq: Number.isInteger(entry.hubSeq) ? entry.hubSeq : null,
      createdAt: entry.createdAt || nowIso(),
      read: false,
    };
    notificationState.items.push(item);
    if (notificationState.items.length > NOTIFICATION_LIMIT) notificationState.items = notificationState.items.slice(-NOTIFICATION_LIMIT);
    saveNotifications();
    return item;
  }
  function listNotifications(since = 0) {
    const from = Number(since) || 0;
    const items = notificationState.items.filter(item => item.seq > from).slice(-200);
    return {notifications: items, lastSeq: notificationState.seq};
  }
  function markNotificationsRead(ids) {
    const wanted = new Set((Array.isArray(ids) ? ids : []).map(String));
    if (!wanted.size) return 0;
    let changed = 0;
    for (const item of notificationState.items) if (wanted.has(item.id) && !item.read) { item.read = true; changed++; }
    if (changed) saveNotifications();
    return changed;
  }

  function configView() {
    return {
      hubUrl: config.hubUrl,
      clientId: config.clientId,
      clientName: config.clientName,
      enabled: config.enabled,
      autoApply: config.autoApply,
      tokenSet: Boolean(config.token),
      configured: Boolean(config.hubUrl && config.token),
      pollMs: pollInterval(),
      configFile: configFile(),
    };
  }
  function writeConfig() {
    fs.mkdirSync(path.dirname(configFile()), {recursive: true});
    writeJsonAtomic(configFile(), config);
  }

  // ---------------------------------------------------------------------------
  // 中控 HTTP 封装：统一 token、超时、中文错误；不可达一律 502，鉴权错误透传 401/403。
  // ---------------------------------------------------------------------------
  async function hubFetch({method = 'GET', hubUrl, route, body, raw = false, timeoutMs = 15000, headers = {}, token = ''}) {
    const base = normalizeOrigin(hubUrl);
    let url;
    try { url = new URL(base + route); } catch { throw new CollabError('中控接口地址无效：' + route, {status: 500, code: 'hub_bad_route'}); }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(1000, Math.min(120000, Number(timeoutMs) || 15000)));
    timer.unref?.();
    const abort = () => controller.abort();
    shutdown.signal.addEventListener('abort', abort, {once: true});
    const finalHeaders = {...headers};
    if (token) finalHeaders['x-collab-token'] = token;
    let requestBody;
    if (body !== undefined && body !== null) {
      if (Buffer.isBuffer(body) || body instanceof Uint8Array) {
        requestBody = body;
        if (!finalHeaders['Content-Type'] && !finalHeaders['content-type']) finalHeaders['Content-Type'] = 'application/octet-stream';
      } else if (typeof body === 'string') {
        requestBody = body;
      } else {
        requestBody = JSON.stringify(body);
        finalHeaders['Content-Type'] = 'application/json; charset=utf-8';
      }
    }
    let response;
    try {
      response = await fetch(url, {method, headers: finalHeaders, body: requestBody, signal: controller.signal});
    } catch (error) {
      if (shutdown.signal.aborted) throw new CollabError('协作客户端正在关闭，请求已取消', {status: 503, code: 'service_closing'});
      if (error?.name === 'AbortError') throw new CollabError('连接协作中控超时（' + base + '），请检查中控是否启动、IP/端口与防火墙设置', {status: 504, code: 'hub_timeout'});
      const code = error?.cause?.code || error?.code || '';
      throw new CollabError('无法连接协作中控（' + base + '）' + (code ? '：' + code : '') + '，请确认中控已启动、地址正确且在同一局域网', {status: 502, code: 'hub_unreachable'});
    } finally {
      clearTimeout(timer);
      shutdown.signal.removeEventListener('abort', abort);
    }
    if (raw) {
      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw hubHttpError(response.status, detail);
      }
      return {status: response.status, headers: response.headers, bytes: Buffer.from(await response.arrayBuffer())};
    }
    const text = await response.text().catch(() => '');
    let value = null;
    if (text) {
      try { value = JSON.parse(text); } catch { if (response.ok) throw new CollabError('协作中控返回了无法解析的响应（HTTP ' + response.status + '）', {status: 502, code: 'hub_bad_response'}); }
    }
    if (!response.ok) throw hubHttpError(response.status, value === null ? text : value);
    return value === null ? {} : value;
  }

  async function hubRequest(method, route, options = {}) {
    check(config.hubUrl, '尚未配置协作中控地址，请先填写中控地址（http://IP:18897）', 409);
    check(config.token, '尚未完成中控配对，请先输入中控显示的配对码完成配对', 409);
    return hubFetch({method, hubUrl: config.hubUrl, route, token: config.token, ...options});
  }

  // ---------------------------------------------------------------------------
  // 后台轮询：完成且 apply=pending 的任务 → 下载校验 → 自动回填 → 上报 apply。
  // ---------------------------------------------------------------------------
  function pollInterval() {
    if (config.pollMs) return clampPollMs(config.pollMs);
    const fromEnvironment = Number(environment.COLLAB_POLL_MS);
    if (Number.isFinite(fromEnvironment) && fromEnvironment > 0) return clampPollMs(fromEnvironment);
    return DEFAULT_POLL_MS;
  }
  function shouldPoll() {
    return !closed && config.enabled && Boolean(config.hubUrl && config.token && config.clientId);
  }
  function stop() {
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = null;
    api.pollTimer = null;
  }
  function schedule() {
    if (closed || pollTimer || !shouldPoll()) return;
    pollTimer = setTimeout(() => {
      pollTimer = null;
      api.pollTimer = null;
      void tick();
    }, pollInterval());
    pollTimer.unref?.();
    api.pollTimer = pollTimer;
  }
  function start() {
    if (!shouldPoll()) { stop(); return; }
    schedule();
  }
  async function tick() {
    if (closed) return;
    if (tickRunning) { schedule(); return; }
    tickRunning = true;
    try {
      await pollOnce();
    } catch (error) {
      lastError = userMessage(error);
    } finally {
      tickRunning = false;
      if (!closed) schedule();
    }
  }

  async function reportApply(taskId, status, detail) {
    const body = {status, detail: shortText(detail, 900), by: config.clientId || ''};
    try {
      await hubRequest('POST', '/api/tasks/' + encodeURIComponent(taskId) + '/apply', {body, timeoutMs: 15000});
      return true;
    } catch (error) {
      lastError = '上报中控回填状态失败：' + userMessage(error);
      return false;
    }
  }

  async function cacheResultBlob(result) {
    const expected = String(result?.sha256 || '').toLowerCase();
    check(/^[0-9a-f]{64}$/.test(expected), '中控任务缺少有效的结果校验值，无法回填', 502);
    const directory = path.join(dataDir, 'collab', 'results');
    fs.mkdirSync(directory, {recursive: true});
    const mime = String(result.mime || 'image/png').toLowerCase();
    const extension = mime === 'image/jpeg' ? '.jpg' : mime === 'image/webp' ? '.webp' : '.png';
    const filePath = path.join(directory, expected + extension);
    if (fs.existsSync(filePath)) {
      try {
        const existing = fs.readFileSync(filePath);
        if (sha256(existing) === expected) return {filePath, sha256: expected, size: existing.length, mime};
      } catch {}
    }
    const downloaded = await hubRequest('GET', '/api/blobs/' + expected, {raw: true, timeoutMs: RESULT_DOWNLOAD_TIMEOUT_MS});
    const actual = sha256(downloaded.bytes);
    check(actual === expected, '下载的协作结果与中控校验值不一致，已拒绝回填', 409);
    const temporary = filePath + '.' + process.pid + '.' + Date.now() + '.tmp';
    fs.writeFileSync(temporary, downloaded.bytes);
    fs.renameSync(temporary, filePath);
    const headerMime = String(downloaded.headers?.get?.('content-type') || '').split(';')[0].trim();
    return {filePath, sha256: expected, size: downloaded.bytes.length, mime: headerMime || inspectImageBuffer(downloaded.bytes)?.mime || mime};
  }

  async function applyHubTask(task) {
    if (!task || task.status !== 'done' || task.apply?.status !== 'pending') return null;
    if (config.autoApply === false) return null; // 关闭自动回填：保留 pending，由页面选择「仍然应用/仅存候选/丢弃」
    const result = task.result;
    check(result && result.sha256, '中控任务缺少结果内容', 502);
    const cached = await cacheResultBlob(result);
    let outcome;
    try {
      outcome = applyCollabResult({
        store,
        dataDir,
        projectId: String(task.projectId || ''),
        panelId: String(task.panelId || ''),
        taskId: String(task.id || ''),
        filePath: cached.filePath,
        sha256: result.sha256,
        expected: task.target?.expected || null,
        mode:await canApply(task)?'auto':'candidate',
        name: '协作结果 ' + (task.panelCode || ''),
      });
    } catch (error) {
      // 工程/画格已被删除时不再无限重试：上报 failed，让中控把任务从 pending 移走。
      if (error?.status === 404) {
        await reportApply(task.id, 'failed', '本地工程或画格已不存在：' + userMessage(error));
        appendNotification({level: 'error', type: 'task.failed', title: '协作结果无法回填', body: (task.panelCode || task.panelId || '') + '：' + userMessage(error), taskId: task.id});
        return {status: 'failed'};
      }
      throw error;
    }
    const label = task.panelCode || task.panelId || '';
    const detail = outcome.status === 'applied'
      ? '已自动回填到画格 ' + label + (outcome.duplicate ? '（此前已回填）' : '')
      : '回填冲突，结果已保留为候选：' + outcome.mismatches.join('、');
    await reportApply(task.id, outcome.status, detail);
    appendNotification(outcome.status === 'applied'
      ? {level: 'success', type: 'task.done', title: '协作结果已回填', body: label + ' 的协作图已自动回填到工程', taskId: task.id, assetId: outcome.assetId}
      : {level: 'warn', type: 'task.conflict', title: '协作结果需要确认', body: label + ' 的协作结果与当前编辑冲突，已保留为候选：' + outcome.mismatches.join('、'), taskId: task.id, assetId: outcome.assetId});
    return outcome;
  }

  async function syncHubNotifications() {
    const query = '?since=' + encodeURIComponent(String(hubNotificationSince)) + '&clientId=' + encodeURIComponent(config.clientId || '');
    let response;
    try {
      response = await hubRequest('GET', '/api/notifications' + query, {timeoutMs: 15000});
    } catch (error) {
      if (error.status === 404) return; // 旧版中控没有通知接口时忽略，不影响回填
      throw error;
    }
    const notifications = Array.isArray(response?.notifications) ? response.notifications : [];
    for (const notification of notifications) {
      const hubSeq = Number(notification?.seq);
      if (!Number.isInteger(hubSeq) || hubSeq <= 0) continue;
      if (notificationState.items.some(item => item.source === 'hub' && item.hubSeq === hubSeq)) continue;
      appendNotification({
        level: notification.level,
        type: notification.type,
        title: notification.title,
        body: notification.body,
        taskId: notification.taskId || null,
        assetId: notification.assetId || null,
        createdAt: notification.createdAt,
        source: 'hub',
        hubSeq,
      });
    }
    const lastSeq = Number(response?.lastSeq);
    if (Number.isFinite(lastSeq) && lastSeq > hubNotificationSince) hubNotificationSince = lastSeq;
  }

  async function pollOnce() {
    if (closed) return {skipped: true};
    if (!shouldPoll()) return {skipped: true};
    const query = new URLSearchParams({submittedBy: config.clientId, status: 'done', applyStatus: 'pending', limit: '20'});
    const list = await hubRequest('GET', '/api/tasks?' + query.toString(), {timeoutMs: 20000});
    const tasks = Array.isArray(list?.tasks) ? list.tasks : [];
    lastPendingApply = tasks.length;
    let applied = 0;
    let conflicts = 0;
    let failed = 0;
    for (const task of tasks) {
      try {
        const outcome = await applyHubTask(task);
        if (outcome?.status === 'applied') applied++;
        else if (outcome?.status === 'conflict') conflicts++;
      } catch (error) {
        failed++;
        lastError = '协作结果自动回填失败（' + (task?.id || '未知任务') + '）：' + userMessage(error);
        console.error('协作结果自动回填失败：' + lastError);
      }
    }
    try {
      await syncHubNotifications();
    } catch (error) {
      lastError = lastError || ('同步中控通知失败：' + userMessage(error));
    }
    lastSyncAt = nowIso();
    if (failed) console.error('本轮有 ' + failed + ' 个协作结果回填失败，将在下次轮询重试');
    return {pendingApply: tasks.length, applied, conflicts, failed, skipped: false};
  }

  // ---------------------------------------------------------------------------
  // 配置 / 配对 / 状态
  // ---------------------------------------------------------------------------
  function updateConfig(input) {
    check(isPlainObject(input), '协作配置格式无效');
    const next = {...config};
    if (input.hubUrl !== undefined) {
      const value = String(input.hubUrl || '').trim();
      next.hubUrl = value ? normalizeOrigin(value) : '';
    }
    if (input.clientName !== undefined) next.clientName = String(input.clientName || '').trim().slice(0, 80);
    if (input.clientId !== undefined && input.clientId !== null) {
      const value = String(input.clientId).trim();
      check(!value || /^[A-Za-z0-9_-]{1,120}$/.test(value), '客户端编号无效');
      next.clientId = value;
    }
    if (input.token !== undefined && input.token !== null) {
      const value = String(input.token).trim();
      check(value.length <= 500, '访问令牌过长，请检查是否粘贴了完整令牌');
      next.token = value;
    }
    if (input.enabled !== undefined) next.enabled = input.enabled !== false;
    if (input.autoApply !== undefined) next.autoApply = input.autoApply !== false;
    if (input.pollMs !== undefined) next.pollMs = input.pollMs === null ? null : clampPollMs(input.pollMs);
    config = next;
    writeConfig();
    start();
    return configView();
  }

  async function pair(input) {
    check(isPlainObject(input), '配对参数无效');
    const hubUrl = normalizeOrigin(input.hubUrl);
    const pairingCode = String(input.pairingCode || '').trim();
    check(/^[A-Za-z0-9]{4,12}$/.test(pairingCode), '请输入中控终端显示的配对码（4—12 位字母或数字）');
    const clientName = String(input.clientName || input.name || 'A电脑').trim().slice(0, 80) || 'A电脑';
    const response = await hubFetch({
      method: 'POST',
      hubUrl,
      route: '/api/pair',
      token: '',
      timeoutMs: 20000,
      body: {pairingCode, role: 'client', name: clientName},
    });
    check(response && typeof response.token === 'string' && response.token.trim(), '中控没有返回访问令牌，配对失败', 502);
    config = {...config, hubUrl, token: response.token.trim(), clientId: String(response.clientId || '').trim(), clientName: String(response.name || clientName).slice(0, 80), enabled: true};
    writeConfig();
    lastError = null;
    start();
    return {
      ok: true,
      hub: {hubId: response.hubId || null, hubName: response.hubName || '', protocolVersion: response.protocolVersion || null},
      client: {id: config.clientId, name: config.clientName},
    };
  }

  async function status() {
    const view = configView();
    let hubReachable = false;
    let hub = null;
    let error = lastError;
    if (view.configured) {
      try {
        const health = await hubRequest('GET', '/api/health', {timeoutMs: 2500});
        hubReachable = true;
        error = null;
        hub = {hubId: health.hubId || null, hubName: health.hubName || '', version: health.version || null, protocolVersion: health.protocolVersion || null};
      } catch (failure) {
        error = userMessage(failure);
        hub = null;
      }
    }
    return {
      configured: view.configured,
      hubReachable,
      enabled: view.enabled,
      tokenSet: view.tokenSet,
      autoApply: view.autoApply,
      hub,
      client: config.clientId ? {id: config.clientId, name: config.clientName} : null,
      pendingApply: lastPendingApply,
      lastSyncAt,
      lastError: error,
    };
  }

  // ---------------------------------------------------------------------------
  // prepare：与现有 POST /api/jobs 为同一画格组装的 input 完全一致（shot/panel/style/referenceRoles）。
  // ---------------------------------------------------------------------------
  function prepareReference(ref) {
    const asset = store.asset(ref.assetId);
    let filePath;
    try {
      filePath = localImagePath(store.assetPath(asset.id));
    } catch (error) {
      throw new CollabError('参考图无法读取：' + (ref.name || asset.name || asset.id) + '：' + error.message, {status: error.status || 400, code: 'reference_unreadable'});
    }
    const bytes = fs.readFileSync(filePath);
    const info = inspectImageBuffer(bytes);
    check(info, '参考图不是可识别的 PNG/JPEG/WebP 图片：' + (ref.name || filePath));
    return {role: ref.role, name: ref.name || asset.name, assetId: asset.id, filePath, sha256: sha256(bytes), size: bytes.length, mime: info.mime};
  }

  function buildGenerationInput(project, panel, shot, refs) {
    const input = {
      action: 'generate',
      projectId: project.id,
      projectTitle: project.title,
      shot,
      style: [project.style,project.productionPolicy?'项目规范 v'+project.productionPolicy.number+'：'+JSON.stringify(project.productionPolicy.rules):''].filter(Boolean).join('\n'),
      ...(project.productionPolicy?{projectPolicy:project.productionPolicy}:{}),
      panel: panelProductionSnapshot(panel, project),
      nativeSizing: panel.nativeSizing || null,
      referenceRoles: referencePackingRoles(refs,{project,assets:store.db.assets,panelId:panel.id}),
      textAssetReferences: panelTextAssets(project,panel,store.db.assets),
      editPrompt: '',
      cropBox: null,
      maskPolygon: null,
      feather: panel.feather,
      border: panel.border,
    };
    if(project.productionPackage)input.productionSource={packageId:project.productionPackage.id,packageHash:project.productionPackage.hash,segmentId:panel.productionSegment||panel.productionBackground||panel.panelSlice?.segmentId,gridId:panel.panelSlice?.panelId,source:panel.panelSlice?.sourceLocation,originalPrompt:shot.description,promptSource:shot.promptSource,textAssetReferences:input.textAssetReferences,referenceOrder:refs.map(r=>r.assetId),referenceVersions:productionReferenceVersions(project,panel,refs,store.db.assets)};
    // 与 /api/jobs 的 job.input（clone 后无 undefined 字段）保持完全一致。
    return JSON.parse(JSON.stringify(input));
  }

  function prepare(input) {
    check(isPlainObject(input), '协作准备参数无效');
    const projectId = String(input.projectId || '').trim();
    check(projectId, '请提供工程编号');
    const project = store.project(cleanId(projectId));
    const panelIds = input.panelIds;
    check(Array.isArray(panelIds) && panelIds.length > 0 && panelIds.length <= 100 && new Set(panelIds).size === panelIds.length, '请选择 1—100 个不同画格');
    const assets = store.db.assets;
    const panels = panelIds.map(rawPanelId => {
      const panelId = cleanId(rawPanelId);
      const found = findPanel(project, panelId);
      check(found, '画格不存在', 404);
      const {page, panel} = found;
      check(!panel.locked, '请先解锁格子');
      check(panel.coordinateSource?.generation !== '不生成', '该格标记为不生成，仅显示边框与文字');
      check(!panel.breakoutForeground, '透明前景请通过原画格的破框功能生成');
      const productionPlan=prepareProductionFrame(project,panel,assets);
      verifyProductionReferenceFiles(productionPlan,assets);
      check(!productionPlan?.dependencies.length,'接续前段尚无已采用成图，请先完成前段，或在制作资料中跳过可选接续参考',409);
      ensurePanelGeneration(project, panel, assets);
      const shot = panelProductionShot(project, panel, assets);
      check(shot.description.trim(), '请先填写本格提示词');
      const refs = referencesForPanel(project, panel, assets);
      const references = refs.map(prepareReference);
      const panelCode = String(shot.code || '').trim() || panel.id;
      const expected = {
        revision: project.revision,
        panelContentKey: panelContentKey(project, panel, assets),
        geometryKey: panelGeometryKey(panel),
        referenceKey: panelReferenceKey(project, panel, assets),
        generationToken: panel.generationToken || null,
      };
      const episode = pageEpisode(project, page);
      return {
        panelId: panel.id,
        panelCode,
        shotCode: panelCode,
        prompt: shot.description,
        style: project.style,
        size: {w: Math.round(panel.w), h: Math.round(panel.h)},
        target: {projectId: project.id, panelId: panel.id, panelCode, episode, expected},
        generationInput: buildGenerationInput(project, panel, shot, refs),
        references,
      };
    });
    return {projectId: project.id, projectTitle: project.title, style: project.style, panels};
  }

  async function uploadBlob(reference) {
    const bytes = fs.readFileSync(reference.filePath);
    const response = await hubFetch({
      method: 'PUT',
      hubUrl: config.hubUrl,
      token: config.token,
      route: '/api/blobs',
      body: bytes,
      headers: {'Content-Type': reference.mime || 'application/octet-stream', 'x-sha256': reference.sha256},
      timeoutMs: 60000,
    });
    check(response && String(response.sha256 || '').toLowerCase() === reference.sha256, '中控返回的参考图校验值与本地不一致，已中止提交', 502);
    return response;
  }

  async function distribute(input) {
    const prepared = prepare(input);
    check(config.hubUrl, '尚未配置协作中控地址，请先填写中控地址并保存', 409);
    check(config.token, '尚未完成中控配对，请先输入配对码完成配对', 409);
    check(config.clientId, '协作客户端编号缺失，请重新配对', 409);
    const tasks = [];
    const errors = [];
    const uploaded = uploadedBlobShas;
    // 中控 409「同一幂等键不同内容」兼容兜底（Lead 要求保留）：按 projectId 拉任务列表找回原任务。
    // 正常路径下幂等键已含目标指纹，不会再出现 409；这里只覆盖旧版本任务、或输入快照极端差异等情况，
    // 找到同键旧任务时仍回落为 duplicate，而不是把 409 暴露成用户错误。
    let projectTasksCache = null;
    async function findExistingTask(idempotencyKey) {
      if (projectTasksCache === null) {
        projectTasksCache = [];
        try {
          let offset = 0;
          let total = 0;
          do {
            const listing = await hubRequest('GET', '/api/tasks?projectId=' + encodeURIComponent(prepared.projectId) + '&limit=500&offset=' + offset, {timeoutMs: 20000});
            const page = Array.isArray(listing?.tasks) ? listing.tasks : [];
            projectTasksCache.push(...page);
            total = Number(listing?.total) || (offset + page.length);
            offset += page.length;
            if (!page.length || offset >= 2500) break;
          } while (offset < total);
        } catch {
          projectTasksCache = [];
        }
      }
      return projectTasksCache.find(task => task && task.idempotencyKey === idempotencyKey) || null;
    }
    for (const panel of prepared.panels) {
      try {
        const references = [];
        for (const reference of panel.references) {
          if (!uploaded.has(reference.sha256)) {
            await uploadBlob(reference);
            uploaded.add(reference.sha256);
          }
          references.push({sha256: reference.sha256, role: reference.role, name: reference.name, mime: reference.mime, size: reference.size});
        }
        // 幂等键 = projectId:panelId:目标指纹前 16 位。
        // 目标指纹 = sha256(panelContentKey \n geometryKey \n referenceKey \n revision)（protocol.sha256 的字符串哈希）：
        //  - 同内容连点：快照完全相同 → 同键 → 中控 duplicate，不重复建任务；
        //  - 结果回填后（imageAssetId/imageTransform 改变 → geometryKey 变化）或用户改提示词/参考/几何/保存版本：
        //    新键 → 新建任务 = 重新生成一张（Lead 决策，与现有工具“再次点生成=再生成”的直觉一致）。
        const expected = panel.target.expected || {};
        const targetFingerprint = sha256([
          expected.panelContentKey ?? '',
          expected.geometryKey ?? '',
          expected.referenceKey ?? '',
          expected.revision === undefined || expected.revision === null ? '' : String(expected.revision),
        ].join('\n')).slice(0, 16);
        const idempotencyKey = prepared.projectId + ':' + panel.panelId + ':' + targetFingerprint;
        let response;
        try {
          response = await hubRequest('POST', '/api/tasks', {
            timeoutMs: 30000,
            body: {
              idempotencyKey,
              type: 'panel-generation',
              projectId: prepared.projectId,
              projectName: prepared.projectTitle,
              episode: panel.target.episode ?? null,
              panelCode: panel.panelCode,
              panelId: panel.panelId,
              shotCode: panel.shotCode,
              prompt: panel.prompt,
              style: panel.style,
              size: panel.size,
              target: panel.target,
              generationInput: panel.generationInput,
              references,
              submittedBy: config.clientId,
              preferredNodeId: input.preferredNodeId||null,
              requesterName: input.requesterName||config.clientName,
            },
          });
        } catch (error) {
          if (error?.status === 409 && error?.code === 'idempotency_conflict') {
            const existing = await findExistingTask(idempotencyKey);
            if (existing && typeof existing.id === 'string' && existing.id) {
              tasks.push({taskId: existing.id, panelId: panel.panelId, panelCode: panel.panelCode, duplicate: true});
              continue;
            }
            errors.push({panelId: panel.panelId, error: '该画格内容与上次提交相同，但中控任务记录暂时对不上；请刷新任务列表确认，不要重复提交'});
            continue;
          }
          throw error;
        }
        const task = response?.task || response;
        check(task && typeof task.id === 'string' && task.id, '中控没有返回任务编号，提交失败', 502);
        tasks.push({taskId: task.id, panelId: panel.panelId, panelCode: panel.panelCode, duplicate: response?.duplicate === true});
      } catch (error) {
        errors.push({panelId: panel.panelId, error: userMessage(error)});
      }
    }
    lastSyncAt = nowIso();
    if (tasks.length) start();
    return {tasks, errors};
  }

  // ---------------------------------------------------------------------------
  // 任务 / 资产 / 通知代理
  // ---------------------------------------------------------------------------
  const withPreview = task => {
    if (!isPlainObject(task)) return task;
    if (!task.result || !task.result.sha256) return task;
    return {...task, previewUrl: '/api/collab/tasks/' + encodeURIComponent(String(task.id || '')) + '/result'};
  };
  const withTaskPreviews = value => {
    if (!isPlainObject(value)) return value;
    if (Array.isArray(value.tasks)) return {...value, tasks: value.tasks.map(withPreview)};
    return withPreview(value);
  };
  const withAssetLinks = value => {
    if (!isPlainObject(value)) return value;
    if (!Array.isArray(value.assets)) return value;
    return {
      ...value,
      assets: value.assets.map(asset => {
        if (!isPlainObject(asset) || typeof asset.id !== 'string') return asset;
        const encoded = encodeURIComponent(asset.id);
        return {...asset, thumbUrl: '/api/collab/assets/' + encoded + '/thumb', downloadUrl: '/api/collab/assets/' + encoded + '/download'};
      }),
    };
  };

  async function taskResultFile(taskId) {
    check(typeof taskId === 'string' && taskId.trim(), '任务编号无效');
    const response = await hubRequest('GET', '/api/tasks/' + encodeURIComponent(taskId.trim()), {timeoutMs: 15000});
    const task = response?.task || response;
    check(task && typeof task === 'object', '中控任务不存在', 404);
    check(task.result && task.result.sha256, '这个任务还没有可预览的结果', 404);
    const file = await cacheResultBlob(task.result);
    if (!file.bytes) file.bytes = fs.readFileSync(file.filePath);
    return {task, file};
  }

  async function applyChoice(taskId, input) {
    const choice = String(input?.choice || '').trim();
    check(['safe','force', 'candidate', 'discard'].includes(choice), '处理方式无效：只支持 safe/force/candidate/discard');
    check(typeof taskId === 'string' && taskId.trim(), '任务编号无效');
    const response = await hubRequest('GET', '/api/tasks/' + encodeURIComponent(taskId.trim()), {timeoutMs: 15000});
    const task = response?.task || response;
    check(task && typeof task === 'object' && task.id, '中控任务不存在', 404);
    check(task.submittedBy===config.clientId,'只能接回自己发起的生成结果',403);
    if (choice === 'discard') {
      if (task.apply?.status === 'skipped') return {ok: true, status: 'skipped', duplicate: true};
      markCollabResultSkipped({dataDir, taskId: task.id, sha256: task.result?.sha256 || null, projectId: task.projectId, panelId: task.panelId, by: config.clientId});
      const reported = await reportApply(task.id, 'skipped', '用户选择丢弃协作结果，本地画格未改动');
      appendNotification({level: 'info', type: 'task.skipped', title: '已丢弃协作结果', body: (task.panelCode || task.panelId || '') + ' 的协作结果按用户选择丢弃', taskId: task.id});
      return {ok: true, status: 'skipped', detail: '本地画格未改动，中控已标记 skipped', reported};
    }
    if (task.apply?.status === 'applied' || (task.status === 'done' && task.apply?.status === 'applied')) return {ok: true, status: 'applied', duplicate: true};
    check(task.result && task.result.sha256, '任务还没有可用结果，无法处理', 409);
    check(task.projectId && task.panelId, '任务缺少工程或画格编号，无法回填', 409);
    const cached = await cacheResultBlob(task.result);
    const mode = choice === 'force' ? 'force' : choice==='safe'&&await canApply(task)?'auto':'candidate';
    const outcome = applyCollabResult({
      store,
      dataDir,
      projectId: String(task.projectId),
      panelId: String(task.panelId),
      taskId: String(task.id),
      filePath: cached.filePath,
      sha256: task.result.sha256,
      expected: task.target?.expected || null,
      mode,
      name: '协作结果 ' + (task.panelCode || ''),
      by: config.clientId,
    });
    const applied=outcome.status==='applied';
    const reported = await reportApply(task.id,outcome.status,applied?'协作结果已接回原画格':choice==='safe'?'画格已有变化，协作结果已保留为候选':'用户选择仅存候选');
    appendNotification({level:applied?'success':'info',type:applied?'task.done':'task.candidate',title:applied?'协作结果已接回原画格':'协作结果已保留为候选',body:(task.panelCode||task.panelId||'')+(applied?' 的协作结果已写入画格':' 的协作结果已加入候选，当前画面保留'),taskId:task.id,assetId:outcome.assetId});
    return {ok: true, status: outcome.status, duplicate: outcome.duplicate === true, assetId: outcome.assetId, mismatches: outcome.mismatches, reported};
  }

  async function assetDetail(assetId) {
    check(typeof assetId === 'string' && /^[A-Za-z0-9_-]{1,120}$/.test(assetId), '资产编号无效');
    return hubRequest('GET', '/api/assets/' + encodeURIComponent(assetId), {timeoutMs: 15000});
  }

  async function cacheAssetBlob(sha256Value, {thumb = false} = {}) {
    const expected = String(sha256Value || '').toLowerCase();
    check(/^[0-9a-f]{64}$/.test(expected), '协作资产缺少有效的内容校验值', 502);
    const directory = path.join(dataDir, 'collab', 'asset-cache');
    fs.mkdirSync(directory, {recursive: true});
    const thumbFile = path.join(directory, expected + '.thumb');
    if (thumb && fs.existsSync(thumbFile)) {
      try {
        const existing = fs.readFileSync(thumbFile);
        if (inspectImageBuffer(existing)) return {filePath: thumbFile, bytes: existing};
      } catch {}
    }
    if (!thumb) {
      let cachedName = null;
      try { cachedName = fs.readdirSync(directory).find(name => name.startsWith(expected + '.') && /\.(png|jpe?g|webp)$/i.test(name)); } catch {}
      if (cachedName) {
        const cachedFile = path.join(directory, cachedName);
        try {
          const existing = fs.readFileSync(cachedFile);
          if (sha256(existing) === expected) return {filePath: cachedFile, bytes: existing};
        } catch {}
      }
    }
    let downloaded;
    if (thumb) {
      try {
        downloaded = await hubRequest('GET', '/api/blobs/' + expected + '/thumb', {raw: true, timeoutMs: 30000});
      } catch (error) {
        if (error.status !== 404) throw error;
        downloaded = await hubRequest('GET', '/api/blobs/' + expected, {raw: true, timeoutMs: RESULT_DOWNLOAD_TIMEOUT_MS});
      }
      // 缩略图通常不是原图内容（sha 不同），只要像图片就缓存；否则退回原图字节。
      let bytes = inspectImageBuffer(downloaded.bytes) ? downloaded.bytes : null;
      if (!bytes) {
        const original = await hubRequest('GET', '/api/blobs/' + expected, {raw: true, timeoutMs: RESULT_DOWNLOAD_TIMEOUT_MS});
        check(sha256(original.bytes) === expected, '下载的协作资产与中控校验值不一致', 409);
        bytes = original.bytes;
      }
      fs.writeFileSync(thumbFile, bytes);
      return {filePath: thumbFile, bytes};
    } else {
      downloaded = await hubRequest('GET', '/api/blobs/' + expected, {raw: true, timeoutMs: RESULT_DOWNLOAD_TIMEOUT_MS});
    }
    check(sha256(downloaded.bytes) === expected, '下载的协作资产与中控校验值不一致', 409);
    const info = inspectImageBuffer(downloaded.bytes);
    check(info, '下载的协作资产不是可识别的 PNG/JPEG/WebP 图片', 502);
    const extension = info.mime === 'image/jpeg' ? '.jpg' : info.mime === 'image/webp' ? '.webp' : '.png';
    const filePath = path.join(directory, expected + extension);
    fs.writeFileSync(filePath, downloaded.bytes);
    return {filePath, bytes: downloaded.bytes};
  }

  async function assetThumb(assetId) {
    const response = await assetDetail(assetId);
    const asset = response?.asset || response;
    check(asset && asset.sha256, '协作资产缺少内容校验值', 502);
    const cached = await cacheAssetBlob(asset.sha256, {thumb: true});
    const mime = inspectImageBuffer(cached.bytes)?.mime || 'image/png';
    return {bytes: cached.bytes, mime};
  }

  async function assetDownload(assetId) {
    const response = await assetDetail(assetId);
    const asset = response?.asset || response;
    check(asset && asset.sha256, '协作资产缺少内容校验值', 502);
    const cached = await cacheAssetBlob(asset.sha256, {thumb: false});
    const local = registerLocalImageAsset({
      store,
      dataDir,
      filePath: cached.filePath,
      name: asset.name || '协作资产',
      source: 'collab-download',
      expectedSha256: asset.sha256,
    });
    return {assetId: local.id, filePath: local.filePath, name: local.name, sha256: local.sha256, remoteAssetId: asset.id};
  }

  async function assetsRequest(input) {
    check(isPlainObject(input), '资产申请参数无效');
    check(isPlainObject(input.generationInput), '资产申请需要页面先提供 generationInput（协资产在本机准备完成后再申请），当前接口只做中控代理', 400);
    const payload = {...input, submittedBy: config.clientId || input.submittedBy || ''};
    return hubRequest('POST', '/api/assets/request', {body: payload, timeoutMs: 30000});
  }

  async function readNotifications(input) {
    const ids = Array.isArray(input?.ids) ? input.ids.map(String).slice(0, 500) : [];
    const changed = markNotificationsRead(ids);
    if (ids.length && config.token && config.hubUrl) {
      try {
        await hubRequest('POST', '/api/notifications/read', {body: {ids, clientId: config.clientId || ''}, timeoutMs: 10000});
      } catch (error) {
        lastError = '同步已读状态到中控失败：' + userMessage(error);
      }
    }
    return {ok: true, changed};
  }

  // ---------------------------------------------------------------------------
  // HTTP 路由分发（只处理 /api/collab/*；返回 false 表示不是本模块路由）
  // ---------------------------------------------------------------------------
  async function handle(request, response, {pathname, method, url}) {
    if (!pathname.startsWith('/api/collab/')) return false;
    try {
      if (pathname === '/api/collab/config') {
        if (method === 'GET') { json(response, 200, configView()); return true; }
        if (method === 'PUT') { json(response, 200, updateConfig(await readJsonBody(request))); return true; }
      }
      if (method === 'POST' && pathname === '/api/collab/pair') { json(response, 200, await pair(await readJsonBody(request))); return true; }
      if (method === 'POST' && pathname === '/api/collab/prepare') { json(response, 200, prepare(await readJsonBody(request))); return true; }
      if (method === 'POST' && pathname === '/api/collab/distribute') { json(response, 200, await distribute(await readJsonBody(request))); return true; }
      if (method === 'GET' && pathname === '/api/collab/status') { json(response, 200, await status()); return true; }
      if (method === 'GET' && pathname === '/api/collab/tasks') { json(response, 200, withTaskPreviews(await hubRequest('GET', '/api/tasks' + (url.search || '')))); return true; }
      let match = pathname.match(/^\/api\/collab\/tasks\/([^/]+)\/result$/);
      if (match && method === 'GET') {
        const {file} = await taskResultFile(match[1]);
        writeBytes(response, file.bytes, file.mime || 'image/png');
        return true;
      }
      match = pathname.match(/^\/api\/collab\/tasks\/([^/]+)\/apply-choice$/);
      if (match && method === 'POST') { json(response, 200, await applyChoice(match[1], await readJsonBody(request))); return true; }
      match = pathname.match(/^\/api\/collab\/tasks\/([^/]+)\/(retry|cancel|apply)$/);
      if (match && method === 'POST') {
        const payload = await readJsonBody(request);
        json(response, 200, await hubRequest('POST', '/api/tasks/' + encodeURIComponent(match[1]) + '/' + match[2], {body: payload, timeoutMs: 20000}));
        return true;
      }
      match = pathname.match(/^\/api\/collab\/tasks\/([^/]+)$/);
      if (match && method === 'GET') {
        const value = await hubRequest('GET', '/api/tasks/' + encodeURIComponent(match[1]), {timeoutMs: 15000});
        const task = value?.task || value;
        json(response, 200, {task: withPreview(task)});
        return true;
      }
      if (method === 'GET' && pathname === '/api/collab/assets') { json(response, 200, withAssetLinks(await hubRequest('GET', '/api/assets' + (url.search || ''), {timeoutMs: 15000}))); return true; }
      if (method === 'POST' && pathname === '/api/collab/assets/request') { json(response, 200, await assetsRequest(await readJsonBody(request))); return true; }
      match = pathname.match(/^\/api\/collab\/assets\/([^/]+)\/thumb$/);
      if (match && method === 'GET') {
        const thumb = await assetThumb(match[1]);
        writeBytes(response, thumb.bytes, thumb.mime);
        return true;
      }
      match = pathname.match(/^\/api\/collab\/assets\/([^/]+)\/download$/);
      if (match && method === 'GET') { json(response, 200, await assetDownload(match[1])); return true; }
      match = pathname.match(/^\/api\/collab\/assets\/([^/]+)$/);
      if (match && method === 'GET') { json(response, 200, await assetDetail(match[1])); return true; }
      if (method === 'GET' && pathname === '/api/collab/notifications') { json(response, 200, listNotifications(url.searchParams.get('since') || 0)); return true; }
      if (method === 'POST' && pathname === '/api/collab/notifications/read') { json(response, 200, await readNotifications(await readJsonBody(request))); return true; }
      if (method === 'GET' && pathname === '/api/collab/nodes') { json(response, 200, await hubRequest('GET', '/api/nodes', {timeoutMs: 15000})); return true; }
      return false;
    } catch (error) {
      if (!response.headersSent) {
        json(response, error.status || error.statusCode || 500, {error: userMessage(error), ...(error.code ? {code: error.code} : {})});
      } else response.end();
      return true;
    }
  }

  const api = {
    pollTimer: null,
    configFile,
    configView,
    updateConfig,
    pair,
    status,
    prepare,
    distribute,
    async overview(){const [tasks,nodes]=await Promise.all([hubRequest('GET','/api/tasks?limit=500',{timeoutMs:10000}),hubRequest('GET','/api/nodes',{timeoutMs:10000})]);return {...tasks,nodes:nodes.nodes||[]};},
    pollOnce,
    applyChoice,
    assetDetail,
    assetThumb,
    assetDownload,
    assetsRequest,
    listNotifications,
    readNotifications,
    taskResultFile,
    handle,
    start,
    stop,
    close() {
      closed = true;
      stop();
      try { shutdown.abort(); } catch {}
    },
    get closed() { return closed; },
    get running() { return pollTimer !== null; },
  };
  // 启动：只有已配对且启用的配置才轮询；没有配置时完全不产生定时器。
  if (config.enabled && config.hubUrl && config.token && config.clientId) start();
  if (!recoveryWarned && config.hubUrl && config.token && !config.clientId) {
    recoveryWarned = true;
    lastError = '协作配置缺少客户端编号，请重新配对';
  }
  return Object.defineProperty(api, 'config', {get: () => ({...config})});
}
